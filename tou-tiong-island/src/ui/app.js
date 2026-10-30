/**
 * 把 3D 地圖、遊戲狀態與各個畫面接起來。
 *
 * 兩條重要規則：
 *   故事畫面開啟時 scene.pause()，地圖完全不渲染；關閉時 resume()。
 *   天氣由玩家的每日打卡決定，進站時就套用，所以一打開看到的就是「你昨天決定的天氣」。
 */
import { SceneManager } from '../world/sceneManager.js';
import { GameState } from '../core/gameState.js';
import { content } from '../core/content.js';
import { StoryView } from './storyView.js';
import { ResultView } from './resultView.js';
import {
  Sheet, trustPanel, islandPanel, dailyPanel, weeklyPanel, lighthousePanel,
  letterPanel, wishPanel, wishBoardPanel, recordsPanel, backupPanel, loginPanel,
  atlasPanel, collectionPanel, aboutPanel,
} from './panels.js';
import * as vaultClient from '../core/vaultClient.js';
import { buildDemoSave } from '../core/demoData.js';
import { hasIslandScene, loadIslandScene } from '../core/islandScenes.js';

const WEATHER_LINE = { sunny: '今天島上出太陽', cloudy: '今天島上多雲', rainy: '今天島上下雨' };

export class App {
  constructor() {
    this.content = content;
    this.state = new GameState(content);
    this.overlay = document.getElementById('overlay');
    this.sheet = new Sheet(this.overlay);
    this.toastEl = document.getElementById('toast');
    this.app = document.getElementById('app');
    this.weatherLine = document.getElementById('weather-line');

    this.scene = new SceneManager({
      canvas: document.getElementById('map'),
      labelLayer: document.getElementById('labels'),
      skyLayer: document.getElementById('sky'),
      veilLayer: document.getElementById('veil'),
      map: content.islandMap,
      onSelectIsland: (id) => this.selectIsland(id),
      onSelectInteraction: (id) => this.openInteraction(id),
    });

    this.storyView = new StoryView({
      mount: this.app,
      onFinish: (payload) => this.finishStory(payload),
      onQuit: () => this.quitStory(),
      onSave: (ctx) => this.state.saveSession(ctx),
    });

    this.resultView = new ResultView({
      mount: this.overlay, content, state: this.state,
      onDone: (outcome) => this.afterStory(outcome),
    });

    this._wireHud();
    this.applyWeather(this.state.todayWeather, { animate: false });
    this.refreshWorld();
    this.scene.focusHome();
    this.refreshCloudLabel();
    this._fadeHint();
    this._firstRun();
  }

  _wireHud() {
    const viewBtn = document.querySelector('[data-action="reset-view"]');
    const viewLabel = viewBtn.querySelector('[data-label-view]');
    viewBtn.addEventListener('click', () => {
      const wide = this.scene.resetView();
      viewLabel.textContent = wide ? '回島' : '全景';
      viewBtn.setAttribute('aria-label', wide ? '回到透中島' : '看整座群島');
      this.scene.select(null);
    });
    document.querySelector('[data-action="records"]')
      .addEventListener('click', () => this.openInteraction('records'));
    document.querySelector('[data-action="login"]')
      .addEventListener('click', () => this.openInteraction('login'));
    document.querySelector('[data-action="about"]')
      .addEventListener('click', () => aboutPanel(this.sheet, { content: this.content }));
  }

  _fadeHint() {
    setTimeout(() => document.getElementById('hint').classList.add('is-hidden'), 6500);
  }

  /** 第一次進站先講三行信任說明；之後直接進地圖，有沒打完的故事就問要不要接續。 */
  _firstRun() {
    if (this._demoRequested()) return;
    if (!this.state.settings.trust_seen) {
      trustPanel(this.sheet, {
        onDone: () => { this.state.setSetting('trust_seen', true); this._maybeResume(); },
      });
      return;
    }
    this._maybeResume();
  }

  /**
   * 網址帶 ?demo=1 時載入示範資料，方便 demo 與錄影。
   * 已經有真實紀錄的話先問過——不能因為一個網址參數就把人家的島換掉。
   */
  _demoRequested() {
    const params = new URLSearchParams(location.search);
    if (params.get('demo') !== '1') return false;
    const d = this.state.data;
    const hasReal = !d.demo && (Object.keys(d.islands).length || Object.keys(d.daily).length
      || d.weekly.length || d.letters.length || d.wishes.length);
    if (!hasReal) { this.loadDemo({ openRecords: false }); return true; }
    this.sheet.open({
      title: '要換成示範資料嗎',
      subtitle: '這台裝置已經有紀錄了',
      mini: true,
      body: `<p class="card__text">網址帶了 <code>?demo=1</code>。載入示範資料會<b>蓋掉</b>你現在的島。</p>
             <p class="tiny">想留著的話，先去「我的紀錄 → 保存紀錄」下載一份備份檔。</p>`,
      actions: [
        { label: '換成示範資料', onClick: () => { this.sheet.close(); this.loadDemo({ openRecords: false }); } },
        { label: '保留我的紀錄', className: 'btn btn--ghost', onClick: () => { this.sheet.close(); this._maybeResume(); } },
      ],
    });
    return true;
  }

  toast(text, ms = 2600) {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { this.toastEl.hidden = true; }, ms);
  }

  refreshWorld() {
    this.islands = this.scene.rebuild(this.state.progressForWorld(), {
      count: this.state.wishes().length,
      board: this.content.wishBoard,
    });
  }

  /** 這週的溫度計還沒做時，雲朵上多一個小提示；不打斷任何事。 */
  refreshCloudLabel() {
    const el = this.scene.labels.get('spot:daily')?.el;
    if (!el) return;
    const pending = !this.state.thisWeekEntry();
    el.querySelector('.map-spot__text').textContent = pending ? '今天的天氣 ・' : '今天的天氣';
    el.classList.toggle('map-spot--badge', pending);
  }

  /** 上帝視角：玩家選的天氣會套到整座群島——天空、太陽、海水、光線、雲雨與島民在做的事。 */
  applyWeather(id, { animate = true } = {}) {
    const w = this.scene.setWeather(id, { animate });
    this.weatherLine.textContent = WEATHER_LINE[w.id] ?? '中午十二點的島';
    return w;
  }

  // ── 地圖互動 ────────────────────────────────────────────
  selectIsland(islandId) {
    const island = this.scene.islandsById.get(islandId);
    if (!island) return;
    this.scene.autoFit = false;
    this.scene.select(islandId);
    // 主島與願望島本來就在預設鏡頭裡。再推近它們，主島那一圈入口（燈塔、郵筒、
    // 我的紀錄…）就全部被擠出畫面，人會卡在那裡不知道怎麼回去。
    if (island.kind === 'home') return undefined;   // 主島直接點島上的文字就好
    if (island.kind === 'wish') return this.openInteraction('wishboard');
    this.scene.focus(islandId);
    return islandPanel(this.sheet, {
      island, state: this.state, content: this.content,
      onPlay: (storyId) => this.play(storyId),
      onVisit: hasIslandScene(islandId) ? () => this.visitIsland(islandId) : null,
    });
  }

  openInteraction(id) {
    switch (id) {
      case 'daily':
        return dailyPanel(this.sheet, {
          content: this.content, state: this.state,
          onPick: (moodId) => {
            this.applyWeather(moodId);
            this.toast(WEATHER_LINE[moodId] + '了');
          },
          onWeekly: () => this.openInteraction('weekly'),
          onClose: () => this.refreshCloudLabel(),
        });
      case 'weekly':
        return weeklyPanel(this.sheet, {
          content: this.content, state: this.state,
          onSafety: () => this.openInteraction('lighthouse-now'),
          onSaved: () => { this.toast('燈塔的紀錄本上多了一頁'); this.refreshCloudLabel(); },
        });
      case 'lighthouse':
        // 先亮燈、光束掃出去，面板稍後才進來——燈塔代表的是有人在指路
        this.scene.lightTheLighthouse();
        setTimeout(() => lighthousePanel(this.sheet, { content: this.content }), 650);
        return undefined;
      case 'lighthouse-now':
        // 從心情溫度計導過來的：需要電話的人不該等動畫
        this.scene.lightTheLighthouse();
        return lighthousePanel(this.sheet, { content: this.content });
      case 'letter':
        return letterPanel(this.sheet, { state: this.state, content: this.content });
      case 'wish':
        return wishPanel(this.sheet, {
          state: this.state, content: this.content,
          onSent: () => {
            // 小船要馬上看得到，但不能把鏡頭整個推到願望島上——那樣主島的入口
            // 就全部跑出畫面了。focusHome 本來就把兩座島一起框住，船看得到，
            // 燈塔、郵筒、我的紀錄也都還在手邊。
            this.refreshWorld();
            this.scene.focusHome({ animate: true });
            this.toast('小船出發了，停在願望島');
          },
        });
      case 'wishboard':
        return wishBoardPanel(this.sheet, {
          state: this.state, content: this.content,
          onWish: () => this.openInteraction('wish'),
        });
      case 'records':
        return recordsPanel(this.sheet, {
          state: this.state, content: this.content,
          onAtlas: () => this.openInteraction('atlas'),
          onCollection: () => this.openInteraction('collection'),
          onBackup: () => this.openInteraction('backup'),
          onDemo: () => this.loadDemo(),
          onClearDemo: () => this.clearDemo(),
        });
      case 'login':
        return loginPanel(this.sheet, {
          state: this.state, vaultClient,
          onRestored: () => this._afterRestore(),
        });
      case 'backup':
        return backupPanel(this.sheet, {
          state: this.state, vaultClient,
          onRestored: () => this._afterRestore(),
        });
      case 'atlas':
        return atlasPanel(this.sheet, { state: this.state, onPlay: (s) => this.play(s) });
      case 'collection':
        return collectionPanel(this.sheet, { state: this.state });
      default:
        return undefined;
    }
  }

  // ── 故事 ────────────────────────────────────────────────
  async play(storyId, session = null) {
    this.sheet.close();
    const story = await this.content.loadStory(storyId);
    this.scene.pause();
    document.getElementById('hint').classList.add('is-hidden');
    this.storyView.open(story, session);
  }

  quitStory() {
    this.storyView.close();
    this.scene.resume();
    this.toast('進度留著了，隨時可以接續');
  }

  finishStory({ recap, ending, route, story }) {
    this.storyView.close();
    this.resultView.open({ recap, ending, route, story });
  }

  afterStory(outcome) {
    this.refreshWorld();
    this.scene.resume();
    const island = this.content.islandMap.islands.find((i) => i.story_id === outcome.storyId);
    if (island) {
      this.scene.select(island.island_id);
      this.scene.focus(island.island_id);
    }
    if (outcome.firstPlay) this.toast('新的島嶼出現在地圖上了');
    else if (outcome.newRoute) this.toast('島上長出了新的地景');
  }

  /**
   * 載入示範資料。
   *
   * 永遠不自動發生——只有從「我的紀錄」按下去，或網址帶 ?demo=1 才會進來。
   * 真的使用者第一次進站就看到一整個月不是他打的卡，那是在他的紀錄裡塞假東西。
   */
  loadDemo({ openRecords = true } = {}) {
    this.state.replaceAll(buildDemoSave(this.content));
    this._afterRestore();
    this.toast('載入示範資料了，隨時可以清掉');
    // 從「我的紀錄」按下去的，要把填好的那一頁重開給他看；
    // 從 ?demo=1 進來的要看到島，不是一進站就被一張面板蓋住。
    if (openRecords) this.openInteraction('records');
  }

  clearDemo() {
    this.state.resetAll();
    this._afterRestore();
    this.toast('清掉了，這是一座全新的島');
  }

  /**
   * 走進一座島。
   *
   * 群島暫停，島內場景接手同一個 renderer 與 canvas。這座島的道具與場景資料
   * 到這一刻才下載（規格：進入單島才載入其完整道具與居民）。
   */
  async visitIsland(islandId) {
    if (this._visiting) return;
    this._visiting = true;
    this.sheet.close();
    this.toast('正在走進島上…', 1800);
    try {
      const { IslandScene, data, props } = await loadIslandScene(islandId);
      this.scene.pause();
      document.getElementById('hint')?.classList.add('is-hidden');
      this.islandScene = new IslandScene({
        renderer: this.scene.renderer,
        canvas: this.scene.canvas,
        skyLayer: this.scene.skyLayer,
        labelLayer: this.scene.labelLayer,
        data, props,
        onPickResident: (id) => this._residentCard(data, id),
      });
      this._paintIslandSky(data);
      this.islandScene.start();
      this._showVisitHud(data);
    } catch (err) {
      console.error(err);
      this.scene.resume();
      this.toast('這座島還沒做好，先回群島');
    } finally {
      this._visiting = false;
    }
  }

  leaveIsland() {
    if (!this.islandScene) return;
    this.islandScene.dispose();
    this.islandScene = null;
    document.getElementById('visit-hud')?.remove();
    this.app.classList.remove('is-visiting');
    this.scene.resume();
    this.applyWeather(this.state.todayWeather, { animate: false });
    this.scene.resize();
  }

  _paintIslandSky(data) {
    const sky = data.sky ?? {};
    this.scene.skyLayer.style.background =
      `linear-gradient(170deg, ${sky.top} 0%, ${sky.top} 24%, ${sky.bottom} 100%)`;
  }

  /** 島內的頂部列：島名、主題，與一個回群島的鍵。 */
  _showVisitHud(data) {
    document.getElementById('visit-hud')?.remove();
    const el = document.createElement('div');
    el.id = 'visit-hud';
    el.className = 'visit-hud';
    el.innerHTML = `
      <button type="button" class="visit-hud__back">← 回群島</button>
      <div class="visit-hud__title">
        <b>${data.name}</b>
        <span>${data.theme}</span>
      </div>`;
    el.querySelector('.visit-hud__back').addEventListener('click', () => this.leaveIsland());
    this.app.appendChild(el);
    this.app.classList.add('is-visiting');
  }

  /** 點居民：說牠是誰、在做什麼。規格要的打招呼動作由場景本身播。 */
  _residentCard(data, id) {
    const r = (data.residents ?? []).find((x) => x.id === id);
    if (!r) return;
    this.toast(`${r.species}・${r.zone}　${r.action}`, 3200);
  }

  /** 還原進來的是另一台裝置的島：天氣、島嶼、小船全部重畫一次。 */
  _afterRestore() {
    this.applyWeather(this.state.todayWeather, { animate: false });
    this.refreshWorld();
    this.scene.focusHome({ animate: true });
    this.refreshCloudLabel();
    this.toast('紀錄接回來了');
  }

  _maybeResume() {
    const session = this.state.activeSession;
    if (!session?.story_id) return;
    const entry = this.content.storyIndex.find((s) => s.story_id === session.story_id);
    if (!entry) { this.state.dropSession(); return; }
    this.sheet.open({
      title: '上次還沒走完',
      subtitle: `《${entry.title}》`,
      mini: true,
      body: `<p class="muted">你上次在這篇故事的途中離開了。要從原本的地方接下去嗎？</p>
             <p class="tiny">重新開始不會刪掉已經解鎖的島嶼或航線。</p>`,
      dismissable: false,
      actions: [
        { label: '接著走', onClick: () => this.play(session.story_id, session) },
        { label: '重新開始', className: 'btn btn--ghost', onClick: () => { this.state.dropSession(); this.sheet.close(); } },
      ],
    });
  }
}

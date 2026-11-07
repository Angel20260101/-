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
  breathePanel, noisePanel, bookingPanel,
  atlasPanel, collectionPanel, aboutPanel,
} from './panels.js';
import * as vaultClient from '../core/vaultClient.js';
import { buildDemoSave } from '../core/demoData.js';
import { IndexPanel } from './indexPanel.js';
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
      residents: content.residents,
      practiceCards: content.practiceCards,
      onSelectIsland: (id) => this.selectIsland(id),
      onSelectInteraction: (id) => this.openInteraction(id),
    });

    // 開發用出口。調光線、陰影、材質的時候需要能在 console 直接量到
    // renderer.info 與各物件的 shadow 旗標，否則只能靠肉眼猜。
    // vite build 會把 import.meta.env.DEV 常數摺疊成 false，整段被搖掉，不會進到產物。
    if (import.meta.env.DEV) window.__island = this.scene;

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

    // 島嶼索引。寬螢幕常駐右側，窄螢幕由主選單的「清單」滑出。
    this.indexPanel = new IndexPanel({
      root: document.getElementById('index'),
      content,
      onPick: (id) => { this._closeIndexOnNarrow(); this.selectIsland(id); },
      onSpot: (id) => { this._closeIndexOnNarrow(); this.openInteraction(id); },
    });

    this._wireHud();
    this.applyWeather(this.state.todayWeather, { animate: false });
    this.refreshWorld();
    // 開場框住整座群島，而不是只框主島與願望島。
    // 研究裡最大的斷點在「進入」（擔心被貼標籤 6/9），而一張只看得到兩座島、
    // 其餘都在畫面外的地圖，讀起來是空的、沒有「想去哪一座」可言。
    // 先讓人看見整個世界，再讓他自己決定推進哪一座。
    // padding 0.82 而不是預設的 1.02：預設值是給「全景」按鈕用的，留白較多；
    // 開場這一眼要讓島夠大、看得出上面有東西，不是一張衛星照。
    this.scene.fitToWorld({ padding: 0.82 });
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
    /*
     * 自己走走看。
     *
     * 開啟時鏡頭會飛到主角身邊——光是打開跟隨不夠，他在全景下只有 12 像素，
     * 開了還是找不到人。手機同時亮出左下角的搖桿；桌機沒有搖桿，用 WASD。
     */
    const walkBtn = document.querySelector('[data-action="walk"]');
    const walkLabel = walkBtn.querySelector('[data-label-walk]');
    const stick = document.getElementById('stick');
    walkBtn.addEventListener('click', () => {
      const on = this.scene.setWalkMode(!this.scene.followPlayer);
      walkBtn.setAttribute('aria-pressed', String(on));
      walkLabel.textContent = on ? '看全島' : '走走看';
      walkBtn.setAttribute('aria-label', on ? '離開走路模式，看整座群島' : '自己走走看');
      stick?.classList.toggle('is-on', on);
      stick?.setAttribute('aria-hidden', String(!on));
      if (on) this.toast('用 WASD 或方向鍵走，點地面也可以', 2600);
    });

    document.querySelector('[data-action="records"]')
      .addEventListener('click', () => this.openInteraction('records'));
    document.querySelector('[data-action="login"]')
      .addEventListener('click', () => this.openInteraction('login'));
    document.querySelector('[data-action="about"]')
      .addEventListener('click', () => aboutPanel(this.sheet, { content: this.content }));
    const indexBtn = document.querySelector('[data-action="index"]');
    indexBtn.addEventListener('click', () => {
      const open = this.indexPanel.toggle();
      indexBtn.setAttribute('aria-expanded', String(open));
    });
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
    // 索引要跟著解鎖狀態與命名走，不然會顯示舊的「未探索」
    this.indexPanel?.update(this.islands);
  }

  /**
   * 窄螢幕上索引是蓋在地圖上的，選完一座島要讓開——不然使用者點了
   * 之後只看到同一塊面板，不知道鏡頭已經飛過去了。
   * 寬螢幕的索引是常駐在側邊、不擋地圖，所以不收。
   */
  _closeIndexOnNarrow() {
    if (window.matchMedia('(max-width: 1039px)').matches) {
      this.indexPanel?.toggle(false);
      document.querySelector('[data-action="index"]')?.setAttribute('aria-expanded', 'false');
    }
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
  applyWeather(id, { animate = true, keepVeil = false } = {}) {
    const w = this.scene.setWeather(id, { animate, keepVeil });
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
    if (island.kind === 'post') return this.openInteraction('letter');   // E5 時光郵局
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
        setTimeout(() => lighthousePanel(this.sheet, {
          content: this.content,
          onRecords: () => this.openInteraction('records'),
          onCalm: (id) => this.openInteraction(id === 'noise' ? 'calm-noise' : 'calm-breathe'),
          onBook: () => this.openInteraction('booking'),
        }), 650);
        return undefined;
      case 'lighthouse-now':
        // 從心情溫度計導過來的：需要電話的人不該等動畫
        this.scene.lightTheLighthouse();
        return lighthousePanel(this.sheet, {
          content: this.content,
          onRecords: () => this.openInteraction('records'),
          onCalm: (id) => this.openInteraction(id === 'noise' ? 'calm-noise' : 'calm-breathe'),
          onBook: () => this.openInteraction('booking'),
        });
      // 燈塔出口二：當場就能做的自助。不留紀錄、不回報，所以沒有 state 參與
      case 'calm-breathe': {
        const cfg = this.content.dailyWeekly.safety.calm?.items?.find((i) => i.id === 'breathe');
        return breathePanel(this.sheet, { seconds: cfg?.seconds ?? 60 });
      }
      case 'calm-noise':
        return noisePanel(this.sheet);
      // 轉介預約登記：全系統唯一會留下稱呼與聯絡方式的地方
      case 'booking':
        return bookingPanel(this.sheet, {
          content: this.content,
          onDone: () => this.toast('登記好了，職護會跟你聯絡'),
        });
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
  /**
   * 走進島上。
   *
   * 島內是另一個 three.js 場景，所以中間一定有一次硬切——這點改不掉。
   * 能改的是讓硬切發生在「兩邊長得最像」的那一瞬間，人就讀不出來。
   *
   * 原本的做法是：暫停群島 → 建立島內場景 → 直接顯示。前後兩幀之間
   * 鏡頭位置、天空顏色、霧色全部不同，所以會明顯讀成「換了一頁」。
   *
   * 現在分成五拍，中間那一拍才是真正的交換：
   *   1. 先把資料載完——飛到一半才卡住比直接等還糟
   *   2. 天空先走（CSS 1100ms），讓它領先鏡頭，眼睛先適應新色溫
   *   3. 群島鏡頭俯衝到那座島，霧色同步推向島內的霧色
   *   4. 用島內的霧色蓋住 180ms——蓋的是霧色不是黑色，所以不是「黑場」
   *      而是「霧散開」；交換在這 180ms 裡發生
   *   5. 揭幕，島內鏡頭把剩下的下降走完
   */
  async visitIsland(islandId) {
    if (this._visiting) return;
    this._visiting = true;
    this.sheet.close();
    let loaded;
    try {
      loaded = await loadIslandScene(islandId);
    } catch (err) {
      console.error(err);
      this.toast('這座島還沒做好，先回群島');
      this._visiting = false;
      return;
    }
    const { IslandScene, data, props } = loaded;
    const fog = data.sky?.fog ?? '#f2e6cd';
    try {
      document.getElementById('hint')?.classList.add('is-hidden');
      this._paintIslandSky(data);                       // 2
      const apparent = await this.scene.diveTo(islandId, { fog });   // 3
      // 回來時要放回這個位置。不記的話 resize() 會在 autoFit 下重新取景，
      // 揭幕第一幀就從「貼著島」跳成「整個群島」。
      this._returnCam = this.scene.cameraState();
      await this._veil(fog, 180);                       // 4
      this.scene.pause();
      this.islandScene = new IslandScene({
        renderer: this.scene.renderer,
        canvas: this.scene.canvas,
        skyLayer: this.scene.skyLayer,
        labelLayer: this.scene.labelLayer,
        data, props,
        entry: { apparent },
        onPickResident: (id) => this._residentCard(data, id),
      });
      this.islandScene.start();
      this._visitedFrom = islandId;
      this._showVisitHud(data);
      await this._veil(null, 420);                      // 5
      this.islandScene.settle(760);
    } catch (err) {
      console.error(err);
      this._veil(null, 200);
      this.scene.resume();
      this.toast('這座島還沒做好，先回群島');
    } finally {
      this._visiting = false;
    }
  }

  /**
   * 把遮罩推到某個顏色，或推回透明（color = null）。
   *
   * 故意不用黑色：黑場是「這一段結束了」的語彙，而走進島上並沒有結束什麼。
   * 推到目的地的霧色，讀起來是霧湧上來又散開，前後是同一個世界。
   */
  _veil(color, ms) {
    const el = this.scene.veilLayer;
    if (!el) return Promise.resolve();
    el.style.transition = `background ${ms}ms ease`;
    el.style.background = color ?? 'transparent';
    return new Promise((r) => setTimeout(() => {
      // 還原成 CSS 裡的 1100ms：天氣的遮罩本來就該慢慢換，
      // 不該沿用這裡為了換場臨時調短的秒數。
      if (!color) el.style.transition = '';
      r();
    }, ms));
  }

  /**
   * 回群島——把進來那五拍倒著放一次。
   *
   * 關鍵是群島的鏡頭「還停在剛才俯衝下去的位置」：整趟沒有人動過它，
   * 所以揭幕的第一幀，看到的就是當初離開群島的最後一幀。接著才往上拉回
   * 看得到全局的高度，讀起來是從島上浮起來，不是跳回地圖。
   */
  async leaveIsland() {
    if (!this.islandScene || this._leaving) return;
    this._leaving = true;
    const fog = this.islandScene.data?.sky?.fog ?? '#f2e6cd';
    try {
      await this._veil(fog, 180);
      this.islandScene.dispose();
      this.islandScene = null;
      document.getElementById('visit-hud')?.remove();
      this.app.classList.remove('is-visiting');
      this.scene.resume();
      this.scene.resize();
      this.scene.restoreCamera(this._returnCam);   // 蓋著的時候放回去，看不到這一下
      // 天空與霧色在還被遮著的時候就開始換回今天的天氣（各自 1100ms），
      // 揭幕之後才慢慢走完——顏色比鏡頭慢，人會先認出地形再認出天色。
      // keepVeil：不讓天氣去寫遮罩，不然還沒揭幕就先被換掉。
      this.applyWeather(this.state.todayWeather, { animate: true, keepVeil: true });
      const weatherVeil = this.scene.weatherVeil();
      // 揭幕是「收回天氣的遮罩」而不是「收到全透明」——雨天本來就有一層灰，
      // 收到透明會讓雨天的群島在回去的瞬間亮一下，再暗回來。
      await this._veil(weatherVeil === 'transparent' ? null : weatherVeil, 300);
      // 揭幕之後才往上拉。俯仰角一起回到預設，不然會停在俯衝時的低角度。
      if (this._visitedFrom) this.scene.focus(this._visitedFrom, { distance: 20, polar: 42 * Math.PI / 180 });
      document.getElementById('hint')?.classList.remove('is-hidden');
    } finally {
      this._leaving = false;
    }
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
    // 還原存檔會改變群島的形狀（解鎖了哪些島、長出了哪些航線），
    // 所以要重新取景而不是回到主島——否則新解鎖的島會留在畫面外，
    // 載入示範資料的人會以為「怎麼還是只有這幾座」。
    this.scene.fitToWorld({ padding: 0.82, animate: true });
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

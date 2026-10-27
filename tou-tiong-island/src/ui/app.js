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
  letterPanel, wishPanel, recordsPanel, atlasPanel, collectionPanel, aboutPanel,
} from './panels.js';

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
    viewBtn.addEventListener('click', () => {
      const wide = this.scene.resetView();
      viewBtn.textContent = wide ? '回島' : '全覽';
      this.scene.select(null);
    });
    document.querySelector('[data-action="about"]')
      .addEventListener('click', () => aboutPanel(this.sheet, { content: this.content }));
  }

  _fadeHint() {
    setTimeout(() => document.getElementById('hint').classList.add('is-hidden'), 6500);
  }

  /** 第一次進站先講三行信任說明；之後直接進地圖，有沒打完的故事就問要不要接續。 */
  _firstRun() {
    if (!this.state.settings.trust_seen) {
      trustPanel(this.sheet, {
        onDone: () => { this.state.setSetting('trust_seen', true); this._maybeResume(); },
      });
      return;
    }
    this._maybeResume();
  }

  toast(text, ms = 2600) {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { this.toastEl.hidden = true; }, ms);
  }

  refreshWorld() {
    this.islands = this.scene.rebuild(this.state.progressForWorld());
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
    this.scene.focus(islandId);
    if (island.kind === 'home') return;       // 主島直接點島上的文字就好
    islandPanel(this.sheet, {
      island, state: this.state, content: this.content,
      onPlay: (storyId) => this.play(storyId),
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
          onSent: () => this.toast('小船出發了'),
        });
      case 'records':
        return recordsPanel(this.sheet, {
          state: this.state, content: this.content,
          onAtlas: () => this.openInteraction('atlas'),
          onCollection: () => this.openInteraction('collection'),
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

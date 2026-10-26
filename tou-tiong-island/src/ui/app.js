/**
 * 把 3D 地圖、遊戲狀態與各個畫面接起來。
 *
 * 一條重要的規則：故事畫面開啟時 scene.pause()，關閉時 scene.resume()。
 * 地圖在故事進行中完全不渲染，手機的電力與發熱都留給劇情。
 */
import { SceneManager } from '../world/sceneManager.js';
import { GameState } from '../core/gameState.js';
import { content } from '../core/content.js';
import { StoryView } from './storyView.js';
import { ResultView } from './resultView.js';
import {
  Sheet, islandPanel, dailyPanel, weeklyPanel, atlasPanel, collectionPanel, aboutPanel,
} from './panels.js';

export class App {
  constructor() {
    this.content = content;
    this.state = new GameState(content);
    this.overlay = document.getElementById('overlay');
    this.sheet = new Sheet(this.overlay);
    this.toastEl = document.getElementById('toast');
    this.app = document.getElementById('app');

    this.scene = new SceneManager({
      canvas: document.getElementById('map'),
      labelLayer: document.getElementById('labels'),
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
      mount: this.overlay,
      content,
      state: this.state,
      onDone: (outcome) => this.afterStory(outcome),
    });

    this._wireHud();
    this.refreshWorld({ fit: true });
    this._maybeResume();
    this._fadeHint();
  }

  _wireHud() {
    document.querySelector('[data-action="reset-view"]')
      .addEventListener('click', () => { this.scene.resetView(); this.scene.select(null); });
    document.querySelector('[data-action="about"]')
      .addEventListener('click', () => aboutPanel(this.sheet, { content: this.content }));
  }

  _fadeHint() {
    const hint = document.getElementById('hint');
    setTimeout(() => hint.classList.add('is-hidden'), 6000);
  }

  toast(text, ms = 2600) {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { this.toastEl.hidden = true; }, ms);
  }

  refreshWorld({ fit = false } = {}) {
    this.islands = this.scene.rebuild(this.state.progressForWorld());
    if (fit) { this.scene.autoFit = true; this.scene.fitToWorld(); }
  }

  // ── 地圖互動 ────────────────────────────────────────────
  selectIsland(islandId) {
    if (!islandId) return;
    const island = this.scene.islandsById.get(islandId);
    if (!island) return;
    this.scene.autoFit = false;
    this.scene.select(islandId);
    this.scene.focus(islandId);
    islandPanel(this.sheet, {
      island,
      state: this.state,
      content: this.content,
      onPlay: (storyId) => this.play(storyId),
    });
  }

  openInteraction(id) {
    switch (id) {
      case 'daily':
        return dailyPanel(this.sheet, {
          content: this.content, state: this.state,
          onSaved: () => this.toast('今天的天氣記在碼頭上了'),
        });
      case 'weekly':
        return weeklyPanel(this.sheet, {
          content: this.content, state: this.state,
          onSaved: () => this.toast('燈塔的紀錄本上多了一頁'),
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
    this.scene.pause();              // 故事進行中，地圖完全停止渲染
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

  /** 中斷恢復：上次沒走完的故事，回來可以接續或重新開始。 */
  _maybeResume() {
    const session = this.state.activeSession;
    if (!session?.story_id) return;
    const entry = this.content.storyIndex.find((s) => s.story_id === session.story_id);
    if (!entry) { this.state.dropSession(); return; }

    this.sheet.open({
      title: '上次還沒走完',
      subtitle: `《${entry.title}》`,
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

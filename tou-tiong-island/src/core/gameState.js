/**
 * 遊戲狀態：島嶼進度、每日／每週任務、收藏、進行中的故事。
 *
 * 所有寫入都會立刻自動存檔，所以關掉分頁、手機來電、瀏覽器被回收之後，
 * 回來都能接續。島嶼只會長大，不會因為沒玩而退化。
 */
import * as storage from './storage.js';
import { isoWeekKey, dateKey } from './storage.js';

export class GameState extends EventTarget {
  constructor(content) {
    super();
    this.content = content;
    this.data = storage.load();
  }

  persist() {
    storage.save(this.data);
    this.dispatchEvent(new CustomEvent('change', { detail: this.data }));
  }

  // ── 島嶼 ────────────────────────────────────────────────
  islandState(islandId) {
    return this.data.islands[islandId] ?? { unlocked: false, name: '', routes: [], plays: 0, endings: {} };
  }

  progressForWorld() {
    const out = {};
    for (const [id, s] of Object.entries(this.data.islands)) {
      out[id] = { unlocked: s.unlocked, name: s.name, routes: s.routes ?? [] };
    }
    return out;
  }

  /**
   * 完成一次故事。回傳這次實際發生了什麼，讓結算畫面知道要不要演「島嶼長大」。
   * 重複走到已發現的航線不會重複解鎖，也不會有任何懲罰。
   */
  completeStory({ storyId, islandId, routeId, endingId, cardId }) {
    const prev = this.data.islands[islandId];
    const state = prev ?? { unlocked: false, name: '', routes: [], plays: 0, endings: {}, first_completed_at: null };
    const firstPlay = !state.unlocked;
    const newRoute = !state.routes.includes(routeId);

    state.unlocked = true;
    state.plays += 1;
    state.endings[endingId] = (state.endings[endingId] ?? 0) + 1;
    state.last_played_at = Date.now();
    if (firstPlay) {
      state.first_completed_at = Date.now();
      state.name = state.name || '';
    }
    if (newRoute) state.routes.push(routeId);
    this.data.islands[islandId] = state;

    if (cardId && !this.data.cards.includes(cardId)) this.data.cards.push(cardId);

    const island = this.content.islandMap.islands.find((i) => i.island_id === islandId);
    const growth = island?.growth.find((g) => g.route_id === routeId) ?? null;

    this.data.active_session = null;
    this.persist();

    return {
      firstPlay,
      newRoute,
      plays: state.plays,
      discovered: state.routes.length,
      total: island?.growth.length ?? 3,
      growth: newRoute ? growth : null,
      needsNaming: firstPlay,
      storyId,
    };
  }

  renameIsland(islandId, name) {
    const state = this.data.islands[islandId];
    if (!state) return;
    state.name = (name ?? '').trim().slice(0, 12);
    this.persist();
  }

  // ── 進行中的故事（中斷恢復） ─────────────────────────────
  saveSession(session) {
    this.data.active_session = session;
    this.persist();
  }

  get activeSession() {
    return this.data.active_session;
  }

  dropSession() {
    this.data.active_session = null;
    this.persist();
  }

  // ── 每日任務 ────────────────────────────────────────────
  get todayKey() { return dateKey(); }

  todayCheckin() {
    return this.data.daily[this.todayKey] ?? null;
  }

  saveCheckin({ moodId, energy, note }) {
    this.data.daily[this.todayKey] = {
      mood_id: moodId,
      energy: energy ?? null,
      note: (note ?? '').slice(0, 140) || null,
      at: Date.now(),
    };
    this.persist();
    return this.data.daily[this.todayKey];
  }

  recentCheckins(days = 14) {
    const out = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = dateKey(d);
      out.push({ date: key, entry: this.data.daily[key] ?? null });
    }
    return out;
  }

  // ── 每週任務 ────────────────────────────────────────────
  get weekKey() { return isoWeekKey(); }

  thisWeekEntry() {
    return this.data.weekly.find((w) => w.week === this.weekKey) ?? null;
  }

  saveThermometer({ answers, score, bandId, safetyValue }) {
    const existing = this.thisWeekEntry();
    const pool = this.content.dailyWeekly.weekly.reward.keepsakes;
    const owned = new Set(this.data.keepsakes);
    const next = pool.find((k) => !owned.has(k.keepsake_id)) ?? pool[this.data.weekly.length % pool.length];

    const entry = {
      week: this.weekKey,
      answers,
      score,
      band_id: bandId,
      safety_flagged: (safetyValue ?? 0) > 0,
      keepsake_id: next.keepsake_id,
      at: Date.now(),
    };
    if (existing) Object.assign(existing, entry);
    else this.data.weekly.push(entry);
    if (!owned.has(next.keepsake_id)) this.data.keepsakes.push(next.keepsake_id);
    this.persist();
    return { entry, keepsake: next };
  }

  // ── 天氣（上帝視角） ────────────────────────────────────
  /** 今天島上的天氣；沒打卡就維持晴天。 */
  get todayWeather() {
    return this.todayCheckin()?.mood_id ?? 'sunny';
  }

  // ── 時光郵局（E5） ──────────────────────────────────────
  saveLetter({ text, openInDays, byAi = false }) {
    const now = Date.now();
    const letter = {
      letter_id: `ltr_${now.toString(36)}`,
      text: String(text ?? '').slice(0, 800),
      written_at: now,
      open_at: now + (openInDays ?? 7) * 86400000,
      by_ai: byAi,
      opened: false,
    };
    this.data.letters.push(letter);
    this.persist();
    return letter;
  }

  letters() {
    const now = Date.now();
    return this.data.letters.map((l) => ({ ...l, ready: now >= l.open_at }));
  }

  openLetter(id) {
    const l = this.data.letters.find((x) => x.letter_id === id);
    if (l) { l.opened = true; this.persist(); }
    return l;
  }

  // ── 碼頭許願（E6） ──────────────────────────────────────
  /** 原文只存在這台裝置。送到企業端的只有主題與次數，由後端的 AI 去識別化後彙整。 */
  saveWish({ text, theme }) {
    const wish = {
      wish_id: `wsh_${Date.now().toString(36)}`,
      text: String(text ?? '').slice(0, 300),
      theme: theme ?? null,
      created_at: Date.now(),
      submitted: true,
    };
    this.data.wishes.push(wish);
    this.persist();
    return wish;
  }

  wishes() { return this.data.wishes; }

  // ── 收藏與統計 ──────────────────────────────────────────
  collection() {
    const cards = this.content.practiceCards.cards.filter((c) => this.data.cards.includes(c.card_id));
    const keepsakes = this.content.dailyWeekly.weekly.reward.keepsakes
      .filter((k) => this.data.keepsakes.includes(k.keepsake_id));
    return { cards, keepsakes };
  }

  atlas() {
    return this.content.islandMap.islands.map((island) => {
      const state = this.islandState(island.island_id);
      const story = this.content.storyIndex.find((s) => s.story_id === island.story_id);
      return {
        island_id: island.island_id,
        story_id: island.story_id,
        order: island.order,
        title: story?.title ?? '',
        subtitle: story?.subtitle ?? '',
        name: state.name || island.default_name,
        biome: this.content.islandMap.biomes?.[island.biome]?.name ?? '',
        unlocked: state.unlocked,
        plays: state.plays ?? 0,
        routes: island.growth.map((g) => ({
          route_id: g.route_id,
          label: g.label,
          found: (state.routes ?? []).includes(g.route_id),
        })),
      };
    });
  }

  /** 還原備份：整份換掉。島嶼進度、紀錄、信件、小船一起回來。 */
  replaceAll(data) {
    this.data = storage.migrate(data);
    this.data.active_session = null;   // 別把別台裝置沒走完的故事帶過來
    this.persist();
    return this.data;
  }

  exportJSON() { return storage.exportSave(this.data); }

  /** 清空成一座全新的島。信任說明看過就不再重看。 */
  resetAll() {
    const seen = this.data.settings?.trust_seen;
    this.data = storage.emptySave();
    this.data.settings.trust_seen = Boolean(seen);
    this.persist();
    return this.data;
  }

  get settings() { return this.data.settings; }

  setSetting(key, value) {
    this.data.settings[key] = value;
    this.persist();
  }
}

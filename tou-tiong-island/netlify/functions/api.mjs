/**
 * 《透中島》後端 REST API 參考實作（Netlify Function）。
 *
 * 重點是「共用同一套劇情引擎」：航線判定、狀態推進、結局結算，伺服器端呼叫的是
 * src/core/ 裡前端也在用的那幾支純函式。同一組選擇，前端與後端一定得到同一條航線。
 *
 * 儲存層抽成 Store 介面。預設是行程內記憶體實作（Netlify Function 會被回收，
 * 所以只適合開發與示範）；正式環境請換成 docs/06 的 PostgreSQL schema，
 * 介面不變，呼叫端不用改。
 *
 * 隱私：player_id 是匿名識別碼，不含個資。任何給雇主或團隊看的統計，
 * 都必須經過 aggregate() 的 k 匿名門檻，個人層級的資料不開放查詢。
 */
import {
  createSession, presentNode, advance, choose, indexNodes, buildRecap,
} from '../../src/core/storyEngine.js';
import storyIndex from '../../content/story_index.json' with { type: 'json' };
import islandMap from '../../content/island_map.json' with { type: 'json' };
import practiceCards from '../../content/practice_cards.json' with { type: 'json' };
import dailyWeekly from '../../content/daily_weekly.json' with { type: 'json' };
import wishBoard from '../../content/wish_board.json' with { type: 'json' };
// 六篇劇本靜態 import：打包後的 Function 不含專案檔案，執行時讀不到 content/stories/
import story01 from '../../content/stories/story_01_late_message.json' with { type: 'json' };
import story02 from '../../content/stories/story_02_forty_seventh_call.json' with { type: 'json' };
import story03 from '../../content/stories/story_03_three_am_alarm.json' with { type: 'json' };
import story04 from '../../content/stories/story_04_name_on_the_deck.json' with { type: 'json' };
import story05 from '../../content/stories/story_05_before_the_reunion_dinner.json' with { type: 'json' };
import story06 from '../../content/stories/story_06_sunday_eleven_pm.json' with { type: 'json' };

const API = '/api/v1';
const K_ANONYMITY_MIN = 10; // 團隊統計的最小人數門檻

// ── 劇本 ──────────────────────────────────────────────────
const STORIES = Object.fromEntries(
  [story01, story02, story03, story04, story05, story06].map((s) => [s.story_id, s]),
);
const getStory = (storyId) => STORIES[storyId] ?? null;

// ── Store 介面 ────────────────────────────────────────────
/**
 * 正式環境實作需要提供同樣這幾個方法（見 docs/06-後端規格與API.md 的 SQL）。
 * 所有方法都是 async，方便換成資料庫而不用改呼叫端。
 */
class MemoryStore {
  constructor() {
    this.sessions = new Map();
    this.progress = new Map();   // player_id -> { islands: {...} }
    this.checkins = new Map();   // `${player_id}:${date}` -> row
    this.weekly = new Map();     // `${player_id}:${week}` -> row
  }
  async createSession(row) { this.sessions.set(row.session_id, row); return row; }
  async getSession(id) { return this.sessions.get(id) ?? null; }
  async updateSession(row) { this.sessions.set(row.session_id, row); return row; }
  async getProgress(playerId) {
    if (!this.progress.has(playerId)) this.progress.set(playerId, { player_id: playerId, islands: {} });
    return this.progress.get(playerId);
  }
  async saveProgress(row) { this.progress.set(row.player_id, row); return row; }
  async putCheckin(row) { this.checkins.set(`${row.player_id}:${row.date}`, row); return row; }
  async listCheckins(playerId, from, to) {
    return [...this.checkins.values()]
      .filter((r) => r.player_id === playerId && r.date >= from && r.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  async putWeekly(row) { this.weekly.set(`${row.player_id}:${row.week}`, row); return row; }
  async listWeekly(playerId) {
    return [...this.weekly.values()].filter((r) => r.player_id === playerId)
      .sort((a, b) => a.week.localeCompare(b.week));
  }
  async aggregate({ from, to }) {
    const rows = [...this.checkins.values()].filter((r) => r.date >= from && r.date <= to);
    const players = new Set(rows.map((r) => r.player_id));
    if (players.size < K_ANONYMITY_MIN) return { suppressed: true, min_group_size: K_ANONYMITY_MIN };
    const byMood = {};
    for (const r of rows) byMood[r.mood_id] = (byMood[r.mood_id] ?? 0) + 1;
    return { suppressed: false, player_count: players.size, entries: rows.length, mood_distribution: byMood };
  }
}

const store = new MemoryStore();

/**
 * 保存代碼的保險庫。
 *
 * 存進去的永遠是前端加密好的密文（src/core/vault.js），伺服器沒有密碼、
 * 解不開，也拿不到任何可以對應到個人的東西。
 *
 * Netlify Blobs 要站台本身有開才拿得到；拿不到就退回記憶體，
 * 讓本機開發跑得動，但 available=false 會一路傳到介面上，不會假裝有備份。
 */
class VaultStore {
  constructor() { this.memory = new Map(); this.blobs = undefined; }

  async _store() {
    if (this.blobs !== undefined) return this.blobs;
    try {
      const { getStore } = await import('@netlify/blobs');
      this.blobs = getStore({ name: 'tti-vault', consistency: 'strong' });
    } catch {
      this.blobs = null;        // 本機或沒開 Blobs：記憶體頂著，但會誠實回報
    }
    return this.blobs;
  }

  async durable() { return (await this._store()) !== null; }

  async get(code) {
    const b = await this._store();
    if (!b) return this.memory.get(code) ?? null;
    try { return await b.get(code, { type: 'json' }); } catch { return null; }
  }

  async put(code, row) {
    const b = await this._store();
    if (!b) { this.memory.set(code, row); return row; }
    await b.setJSON(code, row);
    return row;
  }
}

const vault = new VaultStore();

/**
 * 轉介預約登記。
 *
 * 這是整個系統裡**唯一**會存到可識別資料的地方——稱呼與聯絡方式。
 * 其餘所有畫面（天氣、溫度計、故事、願望）都只有匿名代碼。
 * E1 的第三行就是在講這件事：「只有你自己按下預約，職護才會知道你是誰。」
 *
 * 所以這裡刻意跟 vault 分開一個 store：
 *   - 兩者的保存期限與存取對象不同（備份是玩家自己的，預約是要給職護看的）
 *   - 混在一起會讓「哪些資料含個資」這件事變得說不清楚
 *
 * 安全邊界：
 *   - 預約代碼才查得到自己那一筆，沒有列表端點，不能枚舉
 *   - 不接受自由文字以外的任何欄位，長度全部設上限
 *   - 跟遊戲存檔完全不關聯，查預約不會洩漏玩了哪些島
 */
class BookingStore {
  constructor() { this.memory = new Map(); this.blobs = undefined; }

  async _store() {
    if (this.blobs !== undefined) return this.blobs;
    try {
      const { getStore } = await import('@netlify/blobs');
      this.blobs = getStore({ name: 'tti-bookings', consistency: 'strong' });
    } catch {
      this.blobs = null;      // 本機沒開 Blobs：記憶體頂著，但 durable=false 會傳到介面
    }
    return this.blobs;
  }

  async durable() { return (await this._store()) !== null; }

  async get(ref) {
    const b = await this._store();
    if (!b) return this.memory.get(ref) ?? null;
    try { return await b.get(ref, { type: 'json' }); } catch { return null; }
  }

  async put(ref, row) {
    const b = await this._store();
    if (!b) { this.memory.set(ref, row); return row; }
    await b.setJSON(ref, row);
    return row;
  }
}

const bookings = new BookingStore();

const BOOK_RE = /^BK-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const BOOK_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // 去掉 0/O/1/I/L，唸出來不會聽錯
function newBookingRef() {
  let out = '';
  for (let i = 0; i < 6; i++) out += BOOK_ALPHABET[Math.floor(Math.random() * BOOK_ALPHABET.length)];
  return `BK-${out}`;
}

const BOOK_TARGETS = new Set(['nurse', 'counselor']);
const BOOK_MODES = new Set(['onsite', 'remote']);
const BOOK_CATEGORIES = new Set(['work', 'life', 'private']);

/** 只接受白名單欄位，長度全部設上限。自由文字最短的那條防線。 */
function validateBooking(b) {
  if (!b || typeof b !== 'object') return '沒有內容';
  if (!BOOK_TARGETS.has(b.target)) return '轉介對象不合法';
  if (!BOOK_MODES.has(b.mode)) return '會談方式不合法';
  if (!BOOK_CATEGORIES.has(b.category)) return '主題分類不合法';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date ?? '')) return '日期格式不對';
  if (!/^\d{2}:\d{2}$/.test(b.slot ?? '')) return '時段格式不對';
  const day = new Date(`${b.date}T00:00:00`);
  if (Number.isNaN(day.getTime())) return '日期不存在';
  const days = Math.round((day - new Date(new Date().toDateString())) / 86400000);
  if (days < 0) return '不能預約過去的日期';
  if (days > 60) return '只能預約兩個月內';
  if (!b.name || String(b.name).trim().length > 40) return '稱呼不能空白，也不要超過 40 字';
  if (!b.contact || String(b.contact).trim().length > 60) return '請留一個聯絡方式';
  if (b.note && String(b.note).length > 500) return '備註太長了';
  return null;
}

const CODE_RE = /^TTI-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const MAX_CIPHERTEXT = 512 * 1024;   // 存檔再大也不該超過這個，超過就是有人在亂丟東西
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** 只收密文。任何看起來像明文的欄位都擋掉，免得哪天有人改前端改錯方向。 */
function validateSealed(body) {
  const allowed = ['v', 'salt', 'iv', 'ct', 'verifier'];
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length) return `不該出現的欄位：${extra.join(', ')}`;
  for (const k of ['salt', 'iv', 'ct', 'verifier']) {
    if (typeof body[k] !== 'string' || !body[k] || !B64_RE.test(body[k])) return `${k} 必須是 base64 字串`;
  }
  if (body.ct.length > MAX_CIPHERTEXT) return '備份內容太大';
  return null;
}


// ── 工具 ──────────────────────────────────────────────────
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const err = (code, message, status) => json({ error: code, message }, status);
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** 只回傳用戶端需要的 session 欄位，不外洩伺服器內部狀態。 */
const publicSession = (s) => ({
  session_id: s.session_id, player_id: s.player_id, story_id: s.story_id,
  story_version: s.story_version, status: s.status, current_node_id: s.ctx.current_node_id,
  chosen: s.ctx.chosen, vars: s.ctx.vars, tags: s.ctx.tags,
  ending_id: s.ctx.ending_id, route_id: s.ctx.route_id,
  started_at: s.started_at, updated_at: s.ctx.updated_at, completed_at: s.ctx.completed_at,
});

function applyCompletion(progress, { islandId, routeId, endingId }) {
  const island = islandMap.islands.find((i) => i.island_id === islandId);
  const state = progress.islands[islandId] ?? { unlocked: false, name: '', routes: [], plays: 0, endings: {} };
  const firstPlay = !state.unlocked;
  const newRoute = !state.routes.includes(routeId);
  state.unlocked = true;
  state.plays += 1;
  state.endings[endingId] = (state.endings[endingId] ?? 0) + 1;
  state.last_played_at = new Date().toISOString();
  if (firstPlay) state.first_completed_at = state.last_played_at;
  if (newRoute) state.routes.push(routeId);
  progress.islands[islandId] = state;
  const growth = newRoute ? (island?.growth.find((g) => g.route_id === routeId) ?? null) : null;
  return {
    first_play: firstPlay, new_route: newRoute, plays: state.plays,
    discovered: state.routes.length, total: island?.growth.length ?? 3, growth,
  };
}

// ── 路由 ──────────────────────────────────────────────────
export default async (request) => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  const seg = path.startsWith(API) ? path.slice(API.length).split('/').filter(Boolean) : null;
  if (!seg) return err('not_found', '未知的路徑', 404);

  let body = {};
  if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
    // 空 body 是合法的（例如 advance 不需要任何參數），只有「有內容但不是 JSON」才算錯
    const raw = (await request.text()).trim();
    if (raw) {
      try { body = JSON.parse(raw); } catch { return err('invalid_json', '請求內容不是合法 JSON', 400); }
    }
  }

  try {
    // GET /api/v1/health
    if (seg[0] === 'health') return json({ ok: true, stories: storyIndex.length, store: 'memory' });

    // GET /api/v1/content/stories[/:id]
    if (seg[0] === 'content' && seg[1] === 'stories') {
      if (!seg[2]) return json({ stories: storyIndex });
      const story = getStory(seg[2]);
      return story ? json(story) : err('story_not_found', '找不到這篇故事', 404);
    }
    if (seg[0] === 'content' && seg[1] === 'islands') return json(islandMap);
    if (seg[0] === 'content' && seg[1] === 'practice-cards') return json(practiceCards);
    if (seg[0] === 'content' && seg[1] === 'tasks') return json(dailyWeekly);

    // POST /api/v1/sessions
    if (seg[0] === 'sessions' && !seg[1] && method === 'POST') {
      const { player_id: playerId, story_id: storyId } = body;
      if (!playerId || !storyId) return err('invalid_request', '需要 player_id 與 story_id', 400);
      const story = getStory(storyId);
      if (!story) return err('story_not_found', '找不到這篇故事', 404);
      const ctx = createSession(story, { session_id: newId('sess') });
      const row = {
        session_id: ctx.session_id, player_id: playerId, story_id: storyId,
        story_version: story.version, status: 'in_progress', ctx,
        started_at: new Date().toISOString(),
      };
      await store.createSession(row);
      const view = presentNode(story, ctx);
      return json({ session: publicSession(row), node: { ...view.node, dialogue: view.dialogue, choices: view.choices } }, 201);
    }

    if (seg[0] === 'sessions' && seg[1]) {
      const row = await store.getSession(seg[1]);
      if (!row) return err('session_not_found', '找不到這個遊玩階段', 404);
      const story = getStory(row.story_id);
      const nodes = indexNodes(story);

      // GET /api/v1/sessions/:id  —— 中斷恢復
      if (!seg[2] && method === 'GET') {
        const view = presentNode(story, row.ctx, nodes);
        return json({ session: publicSession(row), node: { ...view.node, dialogue: view.dialogue, choices: view.choices } });
      }

      // POST /api/v1/sessions/:id/advance —— 推進非決策節點
      if (seg[2] === 'advance' && method === 'POST') {
        if (row.status === 'completed') return err('already_completed', '這個階段已經結束', 409);
        const step = advance(story, row.ctx, nodes);
        await store.updateSession(row);
        if (step?.kind === 'ending') {
          row.status = 'completed';
          await store.updateSession(row);
          return json({ session: publicSession(row), ending: step.ending, route: step.route });
        }
        const view = presentNode(story, row.ctx, nodes);
        return json({ session: publicSession(row), node: { ...view.node, dialogue: view.dialogue, choices: view.choices } });
      }

      // POST /api/v1/sessions/:id/choices —— 記錄一次選擇
      if (seg[2] === 'choices' && method === 'POST') {
        if (row.status === 'completed') return err('already_completed', '這個階段已經結束', 409);
        if (!body.choice_id) return err('invalid_request', '需要 choice_id', 400);
        let result;
        try {
          result = choose(story, row.ctx, body.choice_id, nodes);
        } catch (e) {
          return err('invalid_choice', String(e.message), 400);
        }
        await store.updateSession(row);
        return json({
          session: publicSession(row),
          immediate: result.immediate,
          inner_voice_clue: result.clue,
          consequence: result.choice.consequence,
          next_node_id: result.next_node_id,
        });
      }

      // POST /api/v1/sessions/:id/complete —— 結算：結局、航線、練習卡、島嶼成長
      if (seg[2] === 'complete' && method === 'POST') {
        if (row.ctx.status !== 'completed') return err('not_finished', '這個階段還沒走到結局', 409);
        const recap = buildRecap(story, row.ctx);
        const card = practiceCards.cards.find((c) => c.card_id === recap.route.practice_card_id);
        const progress = await store.getProgress(row.player_id);
        const outcome = applyCompletion(progress, {
          islandId: story.island_id, routeId: recap.route.route_id, endingId: recap.ending.ending_id,
        });
        await store.saveProgress(progress);
        return json({ recap, practice_card: card, island: outcome, replay_hints: story.replay_hints ?? [] });
      }
    }

    // 玩家進度與任務
    if (seg[0] === 'players' && seg[1]) {
      const playerId = seg[1];

      if (seg[2] === 'progress' && method === 'GET') {
        return json(await store.getProgress(playerId));
      }

      // PATCH /api/v1/players/:pid/islands/:iid —— island naming
      if (seg[2] === 'islands' && seg[3] && method === 'PATCH') {
        const progress = await store.getProgress(playerId);
        const state = progress.islands[seg[3]];
        if (!state?.unlocked) return err('island_locked', '這座島還沒解鎖', 409);
        state.name = String(body.name ?? '').trim().slice(0, 12);
        await store.saveProgress(progress);
        return json({ island_id: seg[3], name: state.name });
      }

      if (seg[2] === 'checkins' && method === 'POST') {
        const { date, mood_id: moodId, energy, note } = body;
        const valid = dailyWeekly.daily.options.some((o) => o.mood_id === moodId);
        if (!date || !valid) return err('invalid_request', '需要 date 與合法的 mood_id', 400);
        const row = {
          player_id: playerId, date, mood_id: moodId,
          energy: energy ?? null, note: note ? String(note).slice(0, 140) : null,
          created_at: new Date().toISOString(),
        };
        await store.putCheckin(row);
        return json({ checkin: row, closing: dailyWeekly.daily.closing_lines[moodId] ?? '' }, 201);
      }

      if (seg[2] === 'checkins' && method === 'GET') {
        const from = url.searchParams.get('from') ?? '0000-01-01';
        const to = url.searchParams.get('to') ?? '9999-12-31';
        return json({ checkins: await store.listCheckins(playerId, from, to) });
      }

      if (seg[2] === 'thermometer' && method === 'POST') {
        const inst = dailyWeekly.weekly.instrument;
        const { week, answers, safety_value: safetyValue } = body;
        if (!week || typeof answers !== 'object') return err('invalid_request', '需要 week 與 answers', 400);
        const missing = inst.items.filter((i) => typeof answers[i.item_id] !== 'number');
        if (missing.length) return err('invalid_request', `缺少題目 ${missing.map((m) => m.item_id).join(', ')}`, 400);
        const score = inst.items.reduce((s, i) => s + answers[i.item_id], 0);
        const band = inst.bands.find((b) => score >= b.min && score <= b.max);
        const row = {
          player_id: playerId, week, answers, score, band_id: band.band_id,
          safety_flagged: (safetyValue ?? 0) >= dailyWeekly.weekly.safety_item.trigger_threshold,
          created_at: new Date().toISOString(),
        };
        await store.putWeekly(row);
        return json({
          entry: row, band,
          safety: row.safety_flagged ? dailyWeekly.safety : null,
          disclaimer: inst.disclaimer,
        }, 201);
      }

      if (seg[2] === 'thermometer' && method === 'GET') {
        return json({ entries: await store.listWeekly(playerId) });
      }
    }

    // ── 保存代碼（E8）────────────────────────────────────
    // 伺服器全程只碰得到密文。沒有帳號、沒有 email，弄丟密碼就真的解不開。
    if (seg[0] === 'vault') {
      if (seg[1] === 'status' && method === 'GET') {
        return json({ durable: await vault.durable() });
      }
      const code = (seg[1] ?? '').toUpperCase();
      if (!CODE_RE.test(code)) return err('invalid_code', '代碼格式不對', 400);

      if (method === 'GET') {
        const row = await vault.get(code);
        if (!row) return err('not_found', '找不到這組代碼的備份', 404);
        // verifier 不回傳：知道代碼的人不該因此就能覆蓋別人的備份
        return json({ v: row.v, salt: row.salt, iv: row.iv, ct: row.ct, updated_at: row.updated_at });
      }

      if (method === 'PUT') {
        const bad = validateSealed(body);
        if (bad) return err('invalid_request', bad, 400);
        const existing = await vault.get(code);
        if (existing && existing.verifier !== body.verifier) {
          return err('wrong_password', '這組代碼已經有備份了，密碼不對就不能覆蓋', 409);
        }
        const row = {
          v: body.v ?? 1, salt: body.salt, iv: body.iv, ct: body.ct, verifier: body.verifier,
          created_at: existing?.created_at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        await vault.put(code, row);
        return json({ code, updated_at: row.updated_at, durable: await vault.durable() }, existing ? 200 : 201);
      }
    }

    // ── 轉介預約登記 ──────────────────────────────────────
    // POST /api/v1/bookings          建立一筆，回傳預約代碼
    // GET  /api/v1/bookings/:ref     用代碼查自己那一筆
    // 沒有列表端點：代碼是唯一的入口，不能枚舉。
    if (seg[0] === 'bookings') {
      if (!seg[1] && method === 'POST') {
        const bad = validateBooking(body);
        if (bad) return err('invalid_request', bad, 400);
        const ref = newBookingRef();
        const row = {
          ref,
          target: body.target, mode: body.mode, category: body.category,
          date: body.date, slot: body.slot,
          name: String(body.name).trim(),
          contact: String(body.contact).trim(),
          note: body.note ? String(body.note).trim() : '',
          status: 'requested',
          created_at: new Date().toISOString(),
        };
        await bookings.put(ref, row);
        return json({
          ref, date: row.date, slot: row.slot, status: row.status,
          durable: await bookings.durable(),
        }, 201);
      }
      if (seg[1] === 'status' && method === 'GET') {
        return json({ durable: await bookings.durable() });
      }
      if (seg[1] && method === 'GET') {
        const ref = seg[1].toUpperCase();
        if (!BOOK_RE.test(ref)) return err('invalid_code', '預約代碼格式不對', 400);
        const row = await bookings.get(ref);
        if (!row) return err('not_found', '查不到這組預約代碼', 404);
        // 聯絡方式不回傳：知道代碼的人不該因此看到別人的電話
        return json({
          ref: row.ref, target: row.target, mode: row.mode, category: row.category,
          date: row.date, slot: row.slot, status: row.status, created_at: row.created_at,
        });
      }
    }

    // GET /api/v1/wishes/board —— 願望看板：公司對每個主題的回應
    if (seg[0] === 'wishes' && seg[1] === 'board' && method === 'GET') {
      return json({
        statuses: wishBoard.statuses,
        themes: wishBoard.themes,
        k_anonymity_min: wishBoard.k_anonymity_min,
        note: '只回傳主題與公司的回應。沒有任何人寫的願望原文會經過這裡——原文留在使用者自己的裝置上。',
      });
    }

    // GET /api/v1/insights/team —— 團隊統計：低於 k 匿名門檻一律不回傳
    if (seg[0] === 'insights' && seg[1] === 'team' && method === 'GET') {
      const from = url.searchParams.get('from') ?? '0000-01-01';
      const to = url.searchParams.get('to') ?? '9999-12-31';
      const agg = await store.aggregate({ from, to });
      return json({
        ...agg,
        note: '只回傳彙總統計。個人的故事選擇、心情紀錄與 AI 回饋不開放查詢，也不會對應到任何可辨識的個人。',
      });
    }

    return err('not_found', '未知的路徑', 404);
  } catch (e) {
    return err('server_error', String(e.message ?? e), 500);
  }
};

export const config = { path: '/api/v1/*' };
export { MemoryStore, applyCompletion, K_ANONYMITY_MIN };

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
  if (method === 'POST' || method === 'PATCH') {
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

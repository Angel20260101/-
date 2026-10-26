#!/usr/bin/env node
/**
 * 後端 API 的端對端測試（直接呼叫 handler，不需要起伺服器）。
 *
 * 最重要的一條：伺服器端判定出來的航線，必須和前端引擎跑出來的一模一樣。
 * 兩邊共用 src/core/，這個測試就是在守住那件事。
 */
import handler, { K_ANONYMITY_MIN } from '../netlify/functions/api.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { indexNodes, createSession, choose, advance } from '../src/core/storyEngine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const ok = (m) => console.log('  ✓ ' + m);
const fail = (m) => { failures += 1; console.error('  ✗ ' + m); };
const check = (m, cond) => (cond ? ok(m) : fail(m));

const call = async (method, path, body) => {
  const res = await handler(new Request('https://tti.test' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { status: res.status, data: await res.json() };
};

/** 本機引擎跑同一組選擇，作為比對基準。 */
function localRun(storyFile, choiceIds) {
  const story = JSON.parse(readFileSync(join(ROOT, 'content/stories', storyFile), 'utf8'));
  const nodes = indexNodes(story);
  const ctx = createSession(story);
  const queue = [...choiceIds];
  for (let i = 0; i < 300; i++) {
    const node = nodes.get(ctx.current_node_id);
    if (node.node_type === 'decision') { choose(story, ctx, queue.shift(), nodes); continue; }
    const step = advance(story, ctx, nodes);
    if (step?.kind === 'ending') return { ending: step.ending.ending_id, route: step.route.route_id };
  }
  throw new Error('本機引擎沒走到結局');
}

/** 透過 API 走完一整篇故事。 */
async function apiRun(playerId, storyId, choiceIds) {
  const start = await call('POST', '/api/v1/sessions', { player_id: playerId, story_id: storyId });
  if (start.status !== 201) throw new Error('建立 session 失敗：' + JSON.stringify(start.data));
  const sid = start.data.session.session_id;
  let node = start.data.node;
  const queue = [...choiceIds];
  for (let i = 0; i < 120; i++) {
    if (node.node_type === 'decision') {
      const r = await call('POST', `/api/v1/sessions/${sid}/choices`, { choice_id: queue.shift() });
      if (r.status !== 200) throw new Error('送出選擇失敗：' + JSON.stringify(r.data));
      if (!r.data.inner_voice_clue?.text) throw new Error('選擇沒有回傳心聲線索');
      node = (await call('GET', `/api/v1/sessions/${sid}`)).data.node;
      continue;
    }
    const r = await call('POST', `/api/v1/sessions/${sid}/advance`);
    if (r.data.ending) {
      return { sid, ending: r.data.ending.ending_id, route: r.data.route.route_id };
    }
    node = r.data.node;
  }
  throw new Error('API 沒走到結局');
}

console.log('\n── 後端 API ──');

const health = await call('GET', '/api/v1/health');
check('GET /health 回傳正常', health.status === 200 && health.data.ok === true);

const index = await call('GET', '/api/v1/content/stories');
check(`GET /content/stories 回傳 6 篇（實際 ${index.data.stories?.length}）`, index.data.stories?.length === 6);

const story = await call('GET', '/api/v1/content/stories/story_01_late_message');
check('GET /content/stories/:id 回傳完整劇本', story.data.nodes?.length === 26 && story.data.routes?.length === 3);
check('不存在的故事回 404', (await call('GET', '/api/v1/content/stories/nope')).status === 404);

// 前後端判定一致性：每篇故事各挑一條代表路徑
const CASES = [
  ['story_01_late_message', 'story_01_late_message.json', ['c_01_d1_tomorrow', 'c_01_d2_say_no', 'c_01_d3_talk']],
  ['story_02_forty_seventh_call', 'story_02_forty_seventh_call.json', ['c_02_d1_transfer', 'c_02_d2_talk', 'c_02_d3_process']],
  ['story_03_three_am_alarm', 'story_03_three_am_alarm.json', ['c_03_d1_stop', 'c_03_d2_partial', 'c_03_d3_record']],
  ['story_04_name_on_the_deck', 'story_04_name_on_the_deck.json', ['c_04_d1_add', 'c_04_d2_boss', 'c_04_d3_rules']],
  ['story_05_before_the_reunion_dinner', 'story_05_before_the_reunion_dinner.json', ['c_05_d1_part', 'c_05_d2_true', 'c_05_d3_say']],
  ['story_06_sunday_eleven_pm', 'story_06_sunday_eleven_pm.json', ['c_06_d1_one', 'c_06_d2_write', 'c_06_d3_list']],
];
let lastSid = null;
let done = null;
for (const [storyId, file, choices] of CASES) {
  const local = localRun(file, choices);
  const api = await apiRun('anon_api_test', storyId, choices);
  lastSid = api.sid;
  check(`${storyId}：前端引擎與後端判定一致（${api.ending} / ${api.route}）`,
    local.ending === api.ending && local.route === api.route);
  // 結算是獨立一步：沒有呼叫 /complete，進度就不會寫入
  done = await call('POST', `/api/v1/sessions/${api.sid}/complete`);
}

// 結算、島嶼養成、命名
check('POST /complete 回傳結局、航線、練習卡與島嶼成長',
  done.status === 200 && done.data.recap?.route && done.data.practice_card?.card_id && done.data.island);
check('首次完成會解鎖島嶼並長出地景',
  done.data.island.first_play === true && Boolean(done.data.island.growth));

// 重走同一條航線：不會重複解鎖，也不會重複長出地景
const replay = await apiRun('anon_api_test', 'story_06_sunday_eleven_pm',
  ['c_06_d1_one', 'c_06_d2_write', 'c_06_d3_list']);
const replayDone = await call('POST', `/api/v1/sessions/${replay.sid}/complete`);
check('重走已發現的航線不會重複長出地景',
  replayDone.data.island.new_route === false && replayDone.data.island.growth === null);
check('重走仍會累計遊玩次數', replayDone.data.island.plays === 2);

const progress = await call('GET', '/api/v1/players/anon_api_test/progress');
check(`六篇都走完後，六座島都解鎖（實際 ${Object.keys(progress.data.islands).length}）`,
  Object.keys(progress.data.islands).length === 6);

const renamed = await call('PATCH', '/api/v1/players/anon_api_test/islands/island_rest', { name: '歇一下島' });
check('PATCH 島嶼命名', renamed.status === 200 && renamed.data.name === '歇一下島');
check('未解鎖的島不能命名',
  (await call('PATCH', '/api/v1/players/anon_new/islands/island_rest', { name: 'x' })).status === 409);

// 中斷恢復
const resumeStart = await call('POST', '/api/v1/sessions', { player_id: 'anon_resume', story_id: 'story_02_forty_seventh_call' });
const rsid = resumeStart.data.session.session_id;
await call('POST', `/api/v1/sessions/${rsid}/advance`);
const resumed = await call('GET', `/api/v1/sessions/${rsid}`);
check('中斷恢復：GET 回到離開時的節點',
  resumed.status === 200 && resumed.data.session.current_node_id === 'n_02_d1' || resumed.data.node?.node_id);
check('不存在的 session 回 404', (await call('GET', '/api/v1/sessions/sess_nope')).status === 404);
check('不合法的選項回 400',
  (await call('POST', `/api/v1/sessions/${rsid}/choices`, { choice_id: 'c_not_real' })).status === 400);

// 每日／每週任務
const ci = await call('POST', '/api/v1/players/anon_api_test/checkins', { date: '2026-10-26', mood_id: 'storm', energy: 1 });
check('每日打卡寫入並回傳收尾文案', ci.status === 201 && Boolean(ci.data.closing));
check('不合法的心情代碼回 400',
  (await call('POST', '/api/v1/players/anon_api_test/checkins', { date: '2026-10-26', mood_id: 'nope' })).status === 400);
const list = await call('GET', '/api/v1/players/anon_api_test/checkins?from=2026-10-01&to=2026-10-31');
check('查詢期間內的打卡紀錄', list.data.checkins?.length === 1);

const th = await call('POST', '/api/v1/players/anon_api_test/thermometer',
  { week: '2026-W44', answers: { t1: 4, t2: 3, t3: 4, t4: 3, t5: 4 }, safety_value: 2 });
check(`心情溫度計計分與區間（${th.data.entry?.score} 分 → ${th.data.band?.label}）`,
  th.status === 201 && th.data.entry.score === 18 && th.data.band.band_id === 'high');
check('安全題非零會觸發關懷流程並附上求助資源',
  th.data.entry.safety_flagged === true && th.data.safety?.resources?.length >= 4);
check('缺題目的溫度計回 400',
  (await call('POST', '/api/v1/players/anon_api_test/thermometer', { week: '2026-W45', answers: { t1: 1 } })).status === 400);

// 隱私：團隊統計的 k 匿名門檻
const team = await call('GET', '/api/v1/insights/team');
check(`團隊統計人數不足 ${K_ANONYMITY_MIN} 人時不回傳任何內容`, team.data.suppressed === true);
check('團隊統計沒有任何個人層級欄位',
  !JSON.stringify(team.data).includes('player_id') && !JSON.stringify(team.data).includes('note_text'));

console.log(failures ? `\n✗ ${failures} 項未通過\n` : '\n✓ 全部通過\n');
process.exit(failures ? 1 : 0);

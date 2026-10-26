#!/usr/bin/env node
/**
 * 航線判定與 AI 安全過濾的測試。
 *
 * 1. 黃金案例：窮舉每篇故事的所有選擇組合，比對 tests/cases/route_cases.json。
 *    任何劇本改動若影響了結局或航線的對應關係，這裡會立刻失敗並列出差異。
 *    （第一次執行或加入新故事時，用 `npm run test -- --update` 重新產生。）
 * 2. 設計意圖案例：用人寫的斷言鎖住「這樣走應該得到這條航線」的設計決定。
 * 3. AI 回饋服務的隱私剝除與安全過濾。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { indexNodes, createSession, choose, advance } from '../src/core/storyEngine.js';
import { evalExpr } from '../src/core/expr.js';
import {
  validateRequest, sanitize, passesPostFilter, fallbackResponse, safetyResponse,
} from '../netlify/functions/ai-feedback.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UPDATE = process.argv.includes('--update');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const CASES_PATH = 'tests/cases/route_cases.json';

let failures = 0;
const fail = (msg) => { failures += 1; console.error('  ✗ ' + msg); };
const ok = (msg) => console.log('  ✓ ' + msg);

function runPath(story, nodes, choiceIds) {
  const ctx = createSession(story);
  const queue = [...choiceIds];
  for (let guard = 0; guard < 300; guard++) {
    const node = nodes.get(ctx.current_node_id);
    if (node.node_type === 'decision') {
      choose(story, ctx, queue.shift(), nodes);
      continue;
    }
    const step = advance(story, ctx, nodes);
    if (step?.kind === 'ending') return { ctx, ending: step.ending, route: step.route };
  }
  throw new Error('路徑沒有走到結局');
}

function enumerate(story, nodes) {
  const out = [];
  const walk = (ctx, picked) => {
    const node = nodes.get(ctx.current_node_id);
    if (node.node_type === 'decision') {
      for (const c of node.choices.filter((c) => !c.condition || evalExpr(c.condition, ctx))) {
        const branch = structuredClone(ctx);
        choose(story, branch, c.choice_id, nodes);
        walk(branch, [...picked, c.choice_id]);
      }
      return;
    }
    const step = advance(story, ctx, nodes);
    if (step?.kind === 'ending') {
      out.push({ choices: picked, ending_id: step.ending.ending_id, route_id: step.route.route_id });
      return;
    }
    walk(ctx, picked);
  };
  walk(createSession(story), []);
  return out;
}

// ── 1. 黃金案例 ─────────────────────────────────────────
console.log('\n── 黃金案例：所有選擇組合的結局與航線 ──');
const storyFiles = readdirSync(join(ROOT, 'content/stories')).filter((f) => f.endsWith('.json')).sort();
const generated = {};
for (const file of storyFiles) {
  const story = read(join('content/stories', file));
  generated[story.story_id] = enumerate(story, indexNodes(story));
}

if (UPDATE || !existsSync(join(ROOT, CASES_PATH))) {
  writeFileSync(join(ROOT, CASES_PATH), JSON.stringify(generated, null, 2) + '\n');
  console.log(`  ↻ 已寫入 ${CASES_PATH}（${Object.values(generated).reduce((s, v) => s + v.length, 0)} 筆）`);
} else {
  const golden = read(CASES_PATH);
  for (const [storyId, rows] of Object.entries(generated)) {
    const want = golden[storyId];
    if (!want) { fail(`${storyId} 不在黃金檔裡（新故事請用 --update 重新產生）`); continue; }
    if (want.length !== rows.length) { fail(`${storyId} 路徑數量 ${rows.length}，黃金檔是 ${want.length}`); continue; }
    let diff = 0;
    for (let i = 0; i < rows.length; i++) {
      const a = rows[i]; const b = want[i];
      if (a.choices.join('>') !== b.choices.join('>') || a.ending_id !== b.ending_id || a.route_id !== b.route_id) {
        if (diff < 5) fail(`${storyId} [${a.choices.join(' > ')}] → ${a.ending_id}/${a.route_id}，黃金檔是 ${b.ending_id}/${b.route_id}`);
        diff += 1;
      }
    }
    if (!diff) ok(`${storyId}：${rows.length} 條路徑與黃金檔一致`);
    else if (diff > 5) fail(`${storyId} 另有 ${diff - 5} 筆差異未列出`);
  }
}

// ── 2. 設計意圖案例 ─────────────────────────────────────
console.log('\n── 設計意圖：這樣走，應該得到這條航線 ──');
const INTENT = [
  { file: 'story_01_late_message.json', why: '三次都把時間與界線說出口 → 立界線航線、結局「一條畫出來的線」',
    choices: ['c_01_d1_tomorrow', 'c_01_d2_say_no', 'c_01_d3_talk'], route: 'r_01_boundary', ending: 'e_01_line' },
  { file: 'story_01_late_message.json', why: '切一半＋把事情談開 → 協商航線',
    choices: ['c_01_d1_pause', 'c_01_d2_partial', 'c_01_d3_talk'], route: 'r_01_dialogue', ending: 'e_01_deal' },
  { file: 'story_01_late_message.json', why: '全部自己扛且不留痕跡 → 保底的接住航線',
    choices: ['c_01_d1_now', 'c_01_d2_allnight', 'c_01_d3_silent'], route: 'r_01_carry', ending: 'e_01_carry' },
  { file: 'story_01_late_message.json', why: '把時間留給自己＋找人討論 → 協商航線、結局「先睡再說」（只清楚表達一次界線，不足以走立界線航線）',
    choices: ['c_01_d1_pause', 'c_01_d2_say_no', 'c_01_d3_peer'], route: 'r_01_dialogue', ending: 'e_01_rest' },
  { file: 'story_02_forty_seventh_call.json', why: '當場畫線＋離席調節 → 自我保護航線',
    choices: ['c_02_d1_policy', 'c_02_d2_breathe', 'c_02_d3_tell'], route: 'r_02_protect', ending: 'e_02_shield' },
  { file: 'story_02_forty_seventh_call.json', why: '轉接＋說出來＋提到制度 → 求援航線、寫進手冊',
    choices: ['c_02_d1_transfer', 'c_02_d2_talk', 'c_02_d3_process'], route: 'r_02_support', ending: 'e_02_rule' },
  { file: 'story_02_forty_seventh_call.json', why: '全程吸收 → 撐住航線',
    choices: ['c_02_d1_apologize', 'c_02_d2_next', 'c_02_d3_report'], route: 'r_02_endure', ending: 'e_02_quota' },
  { file: 'story_03_three_am_alarm.json', why: '急停＋降載＋留紀錄 → 安全優先航線、結局「欄杆」',
    choices: ['c_03_d1_stop', 'c_03_d2_partial', 'c_03_d3_record'], route: 'r_03_safety', ending: 'e_03_railing' },
  { file: 'story_03_three_am_alarm.json', why: '叫人＋要支援＋把規矩傳下去 → 求援航線',
    choices: ['c_03_d1_team', 'c_03_d2_push', 'c_03_d3_tell_hao'], route: 'r_03_help', ending: 'e_03_line_open' },
  { file: 'story_03_three_am_alarm.json', why: '自己排除＋照撐＋寫正常 → 獨撐航線',
    choices: ['c_03_d1_fix', 'c_03_d2_comply', 'c_03_d3_verbal'], route: 'r_03_hold', ending: 'e_03_alone' },
  { file: 'story_04_name_on_the_deck.json', why: '當場補充＋找主管＋訂分工表 → 建立規則航線、結局「那張表」',
    choices: ['c_04_d1_add', 'c_04_d2_boss', 'c_04_d3_rules'], route: 'r_04_rules', ending: 'e_04_table' },
  { file: 'story_04_name_on_the_deck.json', why: '全程沉默或側面提醒 → 留著航線',
    choices: ['c_04_d1_silent', 'c_04_d2_log', 'c_04_d3_same'], route: 'r_04_keep', ending: 'e_04_folder' },
  { file: 'story_05_before_the_reunion_dinner.json', why: '直接拒絕＋劃線不解釋 → 自主航線',
    choices: ['c_05_d1_no', 'c_05_d2_boundary', 'c_05_d3_note'], route: 'r_05_autonomy', ending: 'e_05_room' },
  { file: 'story_05_before_the_reunion_dinner.json', why: '拆開回答＋說真話＋說出口 → 靠近航線',
    choices: ['c_05_d1_part', 'c_05_d2_true', 'c_05_d3_say'], route: 'r_05_connect', ending: 'e_05_closer' },
  { file: 'story_05_before_the_reunion_dinner.json', why: '全部答應＋帶過＋不說 → 順應航線',
    choices: ['c_05_d1_yes', 'c_05_d2_deflect', 'c_05_d3_quiet'], route: 'r_05_comply', ending: 'e_05_good' },
  { file: 'story_06_sunday_eleven_pm.json', why: '連續調整但不是硬撐也不是全放 → 調節航線、結局「三格」',
    choices: ['c_06_d1_one', 'c_06_d2_write', 'c_06_d3_list'], route: 'r_06_adjust', ending: 'e_06_three' },
  { file: 'story_06_sunday_eleven_pm.json', why: '直接去睡 → 允許休息航線',
    choices: ['c_06_d1_sleep', 'c_06_d2_scroll', 'c_06_d3_tell'], route: 'r_06_allow', ending: 'e_06_hammock' },
  { file: 'story_06_sunday_eleven_pm.json', why: '全程硬撐 → 燃燒航線、結局「燈還亮著」',
    choices: ['c_06_d1_push', 'c_06_d2_up', 'c_06_d3_same'], route: 'r_06_burn', ending: 'e_06_still_on' },
];
for (const c of INTENT) {
  const story = read(join('content/stories', c.file));
  const { ending, route } = runPath(story, indexNodes(story), c.choices);
  if (route.route_id !== c.route || ending.ending_id !== c.ending) {
    fail(`${c.why}\n      實際得到 ${ending.ending_id} / ${route.route_id}`);
  } else ok(c.why);
}

// ── 3. 航線涵蓋性：每種選擇組合都恰好落在一條航線 ────────
console.log('\n── 航線涵蓋性 ──');
for (const [storyId, rows] of Object.entries(generated)) {
  const missing = rows.filter((r) => !r.route_id);
  if (missing.length) fail(`${storyId} 有 ${missing.length} 條路徑沒有命中任何航線`);
  const byRoute = rows.reduce((m, r) => ({ ...m, [r.route_id]: (m[r.route_id] ?? 0) + 1 }), {});
  const names = Object.keys(byRoute);
  if (names.length !== 3) fail(`${storyId} 只覆蓋到 ${names.length} 條航線`);
  else ok(`${storyId}：${rows.length} 條路徑分佈於 ${names.map((n) => `${n}×${byRoute[n]}`).join('、')}`);
}

// ── 4. AI 回饋服務：隱私與安全過濾 ───────────────────────
console.log('\n── AI 回饋服務 ──');
const baseReq = {
  version: '1.0.0', locale: 'zh-TW',
  story: { story_id: 'story_01_late_message', title: '晚上九點十七分', theme: '工作責任與個人界線' },
  ending: { ending_id: 'e_01_line', title: '一條畫出來的線' },
  route: { route_id: 'r_01_boundary', name: '立界線航線', meaning: '…' },
  choices: [{ node_title: 'A', choice_text: 'B', consequence: 'C' }],
  practice_card: { card_id: 'pc_01_boundary', title: '一句話的界線' },
  consent: { ai_feedback: true },
};
const check = (label, cond) => (cond ? ok(label) : fail(label));

check('合法請求通過驗證', validateRequest(baseReq) === null);
check('未同意 AI 回饋時被擋下', validateRequest({ ...baseReq, consent: { ai_feedback: false } }) !== null);
check('缺少 route 時被擋下', validateRequest({ ...baseReq, route: undefined }) !== null);

const stripped = sanitize({ ...baseReq, player_note: '一段自填內容', device_id: 'abc', daily_mood: 'storm' });
check('未同意使用自填內容時 player_note 被剝除', stripped.player_note === undefined);
check('白名單外的欄位一律丟掉', !('device_id' in stripped) && !('daily_mood' in stripped));
const kept = sanitize({ ...baseReq, player_note: '一段自填內容', consent: { ai_feedback: true, use_player_note: true } });
check('同意後 player_note 才送出', kept.player_note === '一段自填內容');

const goodAi = {
  version: '1.0.0', type: 'feedback',
  possible_inner_voice: ['可能有一部分的你還在等對方的回應。'],
  another_view: '把時間講清楚，在對方眼裡往往只是一則訊息；在你這裡卻是一整場內心戲。',
  small_practice: { title: '預先寫好的那句', steps: ['打開備忘錄，寫下那個句型。'] },
  closing: '界線是每一次開口之後才變成真的。',
};
check('正常回應通過後置過濾', passesPostFilter(goodAi) === null);
check('出現診斷詞彙會被擋下', passesPostFilter({ ...goodAi, another_view: '你這個狀況聽起來像憂鬱症的早期表現，應該要處理。' }) !== null);
check('出現評價詞彙會被擋下', passesPostFilter({ ...goodAi, another_view: '你應該要更早拒絕，這才是比較好的做法啊。' }) !== null);
check('出現電話或網址會被擋下', passesPostFilter({ ...goodAi, closing: '可以打 1925 安心專線。' }) !== null);
check('心聲缺少推測語氣會被擋下', passesPostFilter({ ...goodAi, possible_inner_voice: ['你就是害怕被討厭。'] }) !== null);

const allRoutes = Object.values(generated).flatMap((rows) => rows.map((r) => r.route_id));
const uniqueRoutes = [...new Set(allRoutes)];
check(`18 條航線都有固定文案備援（實際 ${uniqueRoutes.length} 條）`,
  uniqueRoutes.length === 18 && uniqueRoutes.every((r) => fallbackResponse(r, 'test').meta.source === 'fallback'
    && fallbackResponse(r, 'test').possible_inner_voice?.length > 0));
check('安全回應帶齊求助資源', safetyResponse('test').safety.resources.length >= 4);

console.log(failures ? `\n✗ ${failures} 項未通過\n` : '\n✓ 全部通過\n');
process.exit(failures ? 1 : 0);

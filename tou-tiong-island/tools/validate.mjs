#!/usr/bin/env node
/**
 * 劇情資料驗收腳本。CI 與 `npm test` 都跑這一支。
 *
 * 檢查項目：
 *   1. 每篇故事符合 schema/story.schema.json
 *   2. node_id / choice_id / ending_id / clue_id 全域唯一且無重複
 *   3. 所有 next_node_id、default_next_node_id、conditions 指向存在的節點（無無效連結）
 *   4. 無孤兒節點（每個節點都從 start_node_id 可達）
 *   5. 非結局節點一定有出口；結局節點一定對應 endings[] 的一筆
 *   6. 窮舉所有選擇組合：每條路徑都能走到結局、都落在恰好一條航線
 *   7. 每個結局、每條航線至少有一條路徑可達（沒有寫了卻看不到的內容）
 *   8. state_effects / 條件運算式只引用 state_vars 宣告過的變數
 *   9. 航線的 practice_card_id 與 island_growth_id 在內容庫中存在
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validate } from './jsonschema.mjs';
import { indexNodes, createSession, choose, advance } from '../src/core/storyEngine.js';
import { evalExpr } from '../src/core/expr.js';
import { sortedRoutes } from '../src/core/routeResolver.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const schema = read('schema/story.schema.json');
const practiceCards = read('content/practice_cards.json');
const islandMap = read('content/island_map.json');

const storyDir = join(ROOT, 'content/stories');
const storyFiles = readdirSync(storyDir).filter((f) => f.endsWith('.json')).sort();

const problems = [];
const report = [];
const seenGlobal = { story_id: new Set(), ending_id: new Set(), choice_id: new Set(), clue_id: new Set(), route_id: new Set() };

const cardIds = new Set(practiceCards.cards.map((c) => c.card_id));
const growthIds = new Set(islandMap.islands.flatMap((i) => i.growth.map((g) => g.growth_id)));

for (const file of storyFiles) {
  const story = read(join('content/stories', file));
  const fail = (msg) => problems.push(`[${file}] ${msg}`);

  // 1. schema
  for (const err of validate(schema, story)) fail(`schema ${err}`);

  // 2. 唯一性
  const nodes = indexNodes(story);
  if (nodes.size !== story.nodes.length) fail('node_id 有重複');
  for (const key of ['story_id']) {
    if (seenGlobal[key].has(story[key])) fail(`${key} 與其他故事重複：${story[key]}`);
    seenGlobal[key].add(story[key]);
  }
  for (const e of story.endings) {
    if (seenGlobal.ending_id.has(e.ending_id)) fail(`ending_id 全域重複：${e.ending_id}`);
    seenGlobal.ending_id.add(e.ending_id);
  }
  for (const r of story.routes) {
    if (seenGlobal.route_id.has(r.route_id)) fail(`route_id 全域重複：${r.route_id}`);
    seenGlobal.route_id.add(r.route_id);
  }

  // 3 + 5. 連結與出口
  const declaredVars = new Set(story.state_vars.map((v) => v.key));
  const link = (target, where) => {
    if (!target) return fail(`${where} 指向空值`);
    if (!nodes.has(target)) fail(`${where} 指向不存在的節點 ${target}`);
  };
  const checkEffects = (effects, where) => {
    for (const eff of effects ?? []) {
      if (!declaredVars.has(eff.var)) fail(`${where} 使用未宣告的變數 ${eff.var}`);
    }
  };
  const checkExprVars = (expr, where) => {
    if (!expr || typeof expr !== 'object') return;
    if ('var' in expr && !declaredVars.has(expr.var)) fail(`${where} 條件使用未宣告的變數 ${expr.var}`);
    for (const sub of expr.all ?? expr.any ?? []) checkExprVars(sub, where);
    if (expr.not) checkExprVars(expr.not, where);
  };

  const endingIds = new Set(story.endings.map((e) => e.ending_id));
  const endingNodeFor = new Map();
  for (const node of story.nodes) {
    const where = `節點 ${node.node_id}`;
    checkEffects(node.state_effects, where);
    for (const block of node.conditional_dialogue ?? []) checkExprVars(block.condition, `${where} 條件式對白`);

    switch (node.node_type) {
      case 'narration':
      case 'converge':
        link(node.next_node_id, `${where}.next_node_id`);
        if (!node.dialogue?.length) fail(`${where} 沒有任何對白`);
        break;
      case 'decision':
        if (!node.choices?.length) fail(`${where} 沒有選項`);
        for (const c of node.choices ?? []) {
          link(c.next_node_id, `${where} 選項 ${c.choice_id}.next_node_id`);
          checkEffects(c.state_effects, `${where} 選項 ${c.choice_id}`);
          checkExprVars(c.condition, `${where} 選項 ${c.choice_id}`);
          if (seenGlobal.choice_id.has(c.choice_id)) fail(`choice_id 全域重複：${c.choice_id}`);
          seenGlobal.choice_id.add(c.choice_id);
          if (seenGlobal.clue_id.has(c.inner_voice_clue.clue_id)) fail(`clue_id 全域重複：${c.inner_voice_clue.clue_id}`);
          seenGlobal.clue_id.add(c.inner_voice_clue.clue_id);
        }
        break;
      case 'conditional':
        if (!node.conditions?.length) fail(`${where} 沒有任何 conditions`);
        for (const [i, br] of (node.conditions ?? []).entries()) {
          link(br.next_node_id, `${where}.conditions[${i}]`);
          checkExprVars(br.condition, `${where}.conditions[${i}]`);
        }
        link(node.default_next_node_id, `${where}.default_next_node_id`);
        break;
      case 'ending':
        if (!node.ending_id) fail(`${where} 缺少 ending_id`);
        else if (!endingIds.has(node.ending_id)) fail(`${where} 的 ending_id ${node.ending_id} 不在 endings[] 中`);
        else endingNodeFor.set(node.ending_id, node.node_id);
        break;
      default:
        fail(`${where} 未知的 node_type`);
    }
  }
  for (const e of story.endings) {
    if (!endingNodeFor.has(e.ending_id)) fail(`結局 ${e.ending_id} 沒有對應的 ending 節點`);
  }

  // 航線規則：最後一條必須保底
  const ordered = sortedRoutes(story);
  const priorities = ordered.map((r) => r.priority);
  if (new Set(priorities).size !== priorities.length) fail('航線 priority 有重複');
  const last = ordered[ordered.length - 1];
  if (!('always' in last.rule) || last.rule.always !== true) {
    fail(`最後一條航線 ${last.route_id} 必須是 {"always": true} 保底規則`);
  }
  for (const r of story.routes) {
    checkExprVars(r.rule, `航線 ${r.route_id}`);
    if (!cardIds.has(r.practice_card_id)) fail(`航線 ${r.route_id} 的練習卡 ${r.practice_card_id} 不存在`);
    if (!growthIds.has(r.island_growth_id)) fail(`航線 ${r.route_id} 的島嶼成長 ${r.island_growth_id} 不存在`);
  }

  // 4 + 6 + 7. 窮舉所有選擇組合
  const reachedNodes = new Set();
  const reachedEndings = new Map();
  const reachedRoutes = new Map();
  let pathCount = 0;

  const walk = (ctx, depth) => {
    if (depth > 60) { fail('路徑深度超過 60，疑似循環'); return; }
    reachedNodes.add(ctx.current_node_id);
    const node = nodes.get(ctx.current_node_id);
    if (node.node_type === 'decision') {
      const visible = node.choices.filter((c) => !c.condition || evalExpr(c.condition, ctx));
      if (!visible.length) { fail(`節點 ${node.node_id} 在某些狀態下沒有任何可見選項`); return; }
      for (const c of visible) {
        const branch = structuredClone(ctx);
        choose(story, branch, c.choice_id, nodes);
        walk(branch, depth + 1);
      }
      return;
    }
    const step = advance(story, ctx, nodes);
    if (step && step.kind === 'ending') {
      pathCount += 1;
      reachedEndings.set(step.ending.ending_id, (reachedEndings.get(step.ending.ending_id) ?? 0) + 1);
      reachedRoutes.set(step.route.route_id, (reachedRoutes.get(step.route.route_id) ?? 0) + 1);
      return;
    }
    walk(ctx, depth + 1);
  };
  walk(createSession(story), 0);

  for (const node of story.nodes) {
    if (!reachedNodes.has(node.node_id)) fail(`孤兒節點：${node.node_id} 從 start_node_id 不可達`);
  }
  for (const e of story.endings) {
    if (!reachedEndings.has(e.ending_id)) fail(`結局 ${e.ending_id} 沒有任何路徑可以到達`);
  }
  for (const r of story.routes) {
    if (!reachedRoutes.has(r.route_id)) fail(`航線 ${r.route_id} 沒有任何路徑可以到達`);
  }

  report.push({
    file,
    story_id: story.story_id,
    title: story.title,
    nodes: story.nodes.length,
    decisions: story.nodes.filter((n) => n.node_type === 'decision').length,
    choices: story.nodes.reduce((s, n) => s + (n.choices?.length ?? 0), 0),
    paths: pathCount,
    endings: Object.fromEntries(reachedEndings),
    routes: Object.fromEntries(reachedRoutes),
  });
}

// 練習卡與島嶼成長反向檢查：不應該有寫了卻沒有航線指到的內容
const usedCards = new Set();
const usedGrowth = new Set();
for (const file of storyFiles) {
  const story = read(join('content/stories', file));
  for (const r of story.routes) { usedCards.add(r.practice_card_id); usedGrowth.add(r.island_growth_id); }
}
for (const c of practiceCards.cards) if (!usedCards.has(c.card_id)) problems.push(`[practice_cards] ${c.card_id} 沒有任何航線使用`);
for (const i of islandMap.islands) {
  for (const g of i.growth) if (!usedGrowth.has(g.growth_id)) problems.push(`[island_map] ${g.growth_id} 沒有任何航線使用`);
}

console.log('\n=== 透中島 劇情資料驗收 ===\n');
for (const r of report) {
  console.log(`${r.story_id}  《${r.title}》`);
  console.log(`  節點 ${r.nodes} ／ 決策點 ${r.decisions} ／ 選項 ${r.choices} ／ 可走完的路徑 ${r.paths}`);
  console.log(`  結局分布：${JSON.stringify(r.endings)}`);
  console.log(`  航線分布：${JSON.stringify(r.routes)}\n`);
}
console.log(`故事總數：${report.length}　路徑總數：${report.reduce((s, r) => s + r.paths, 0)}　航線總數：${seenGlobal.route_id.size}`);

if (problems.length) {
  console.error(`\n✗ 發現 ${problems.length} 個問題：\n`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('\n✓ 全部通過：無無效連結、無孤兒節點、所有結局與航線皆可到達。\n');

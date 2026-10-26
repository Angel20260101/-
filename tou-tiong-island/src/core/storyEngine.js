/**
 * 資料驅動劇情引擎。
 *
 * 引擎本身不認識任何一篇故事——所有節點、分支、匯流、結局與航線都來自
 * story JSON。新增故事＝新增一份 JSON，不需要改這個檔案。
 */
import { evalExpr, applyEffects, addTags } from './expr.js';
import { resolveRoute } from './routeResolver.js';

export const SESSION_SCHEMA_VERSION = '1.0.0';

export function indexNodes(story) {
  const map = new Map();
  for (const node of story.nodes) map.set(node.node_id, node);
  return map;
}

export function createSession(story, { session_id = null, now = Date.now() } = {}) {
  const vars = {};
  for (const v of story.state_vars) vars[v.key] = v.init;
  return {
    session_schema_version: SESSION_SCHEMA_VERSION,
    session_id: session_id ?? `sess_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    story_id: story.story_id,
    story_version: story.version,
    current_node_id: story.start_node_id,
    vars,
    tags: {},
    chosen: [],
    clues: [],
    consequences: [],
    path: [story.start_node_id],
    ending_id: null,
    route_id: null,
    status: 'in_progress',
    started_at: now,
    updated_at: now,
    completed_at: null,
  };
}

/** 取得目前節點的「可播放內容」：基本對白 ＋ 命中的條件式對白 ＋ 可見選項。 */
export function presentNode(story, ctx, nodes = indexNodes(story)) {
  const node = nodes.get(ctx.current_node_id);
  if (!node) throw new Error(`[${story.story_id}] 找不到節點 ${ctx.current_node_id}`);

  const dialogue = [...(node.dialogue ?? [])];
  for (const block of node.conditional_dialogue ?? []) {
    if (evalExpr(block.condition, ctx)) dialogue.push(...block.dialogue);
  }

  const choices = (node.choices ?? []).filter(
    (c) => !c.condition || evalExpr(c.condition, ctx),
  );

  return { node, dialogue, choices, speakers: story.characters };
}

/**
 * 推進非決策節點。narration / converge 直接走 next_node_id；
 * conditional 依序評估 conditions，沒命中則走 default_next_node_id；
 * ending 則結算結局與航線。回傳 null 表示已到結局。
 */
export function advance(story, ctx, nodes = indexNodes(story)) {
  const node = nodes.get(ctx.current_node_id);
  if (!node) throw new Error(`[${story.story_id}] 找不到節點 ${ctx.current_node_id}`);
  if (node.node_type === 'decision') return null; // 等待玩家選擇

  applyEffects(ctx, node.state_effects);

  if (node.node_type === 'ending') {
    return finishStory(story, ctx, node);
  }

  let next = node.next_node_id ?? null;
  if (node.node_type === 'conditional') {
    next = node.default_next_node_id;
    for (const branch of node.conditions ?? []) {
      if (evalExpr(branch.condition, ctx)) { next = branch.next_node_id; break; }
    }
  }
  if (!next) throw new Error(`[${story.story_id}] 節點 ${node.node_id} 沒有出口`);

  ctx.current_node_id = next;
  ctx.path.push(next);
  ctx.updated_at = Date.now();
  return { kind: 'moved', node_id: next };
}

/** 玩家做出選擇：套用效果、記錄心聲線索與後果、跳到下一個節點。 */
export function choose(story, ctx, choiceId, nodes = indexNodes(story)) {
  const { node, choices } = presentNode(story, ctx, nodes);
  if (node.node_type !== 'decision') {
    throw new Error(`[${story.story_id}] 節點 ${node.node_id} 不是決策節點`);
  }
  const choice = choices.find((c) => c.choice_id === choiceId);
  if (!choice) throw new Error(`[${story.story_id}] 節點 ${node.node_id} 沒有可選的 ${choiceId}`);

  applyEffects(ctx, choice.state_effects);
  addTags(ctx, choice.tags);
  ctx.chosen.push(choice.choice_id);
  ctx.clues.push({ ...choice.inner_voice_clue, node_id: node.node_id, choice_id: choice.choice_id });
  ctx.consequences.push({
    node_id: node.node_id,
    node_title: node.title ?? node.node_id,
    choice_id: choice.choice_id,
    choice_text: choice.text,
    consequence: choice.consequence,
  });
  ctx.current_node_id = choice.next_node_id;
  ctx.path.push(choice.next_node_id);
  ctx.updated_at = Date.now();

  return {
    kind: 'chose',
    choice,
    immediate: choice.immediate,
    clue: choice.inner_voice_clue,
    next_node_id: choice.next_node_id,
  };
}

function finishStory(story, ctx, endingNode) {
  const ending = story.endings.find((e) => e.ending_id === endingNode.ending_id);
  if (!ending) throw new Error(`[${story.story_id}] 找不到結局 ${endingNode.ending_id}`);
  ctx.ending_id = ending.ending_id;
  const route = resolveRoute(story, ctx);
  ctx.route_id = route.route_id;
  ctx.status = 'completed';
  ctx.completed_at = Date.now();
  ctx.updated_at = ctx.completed_at;
  return { kind: 'ending', ending, route };
}

/** 結局回顧：結局文案 ＋ 玩家每個決策點的實際後果 ＋ 心聲線索。 */
export function buildRecap(story, ctx) {
  const ending = story.endings.find((e) => e.ending_id === ctx.ending_id);
  const route = story.routes.find((r) => r.route_id === ctx.route_id);
  return {
    story: { story_id: story.story_id, title: story.title, version: story.version },
    ending,
    route,
    choices: ctx.consequences,
    clues: ctx.clues,
    vars: { ...ctx.vars },
    tags: { ...ctx.tags },
  };
}

/** 一口氣跑完一條指定選擇序列，驗證器與自動測試用。 */
export function runPath(story, choiceIds, { nodes = indexNodes(story) } = {}) {
  const ctx = createSession(story);
  const queue = [...choiceIds];
  let guard = 0;
  for (;;) {
    if (++guard > 500) throw new Error(`[${story.story_id}] 疑似無限迴圈`);
    const node = nodes.get(ctx.current_node_id);
    if (node.node_type === 'decision') {
      const choiceId = queue.shift();
      if (!choiceId) throw new Error(`[${story.story_id}] 在 ${node.node_id} 缺少選擇`);
      choose(story, ctx, choiceId, nodes);
      continue;
    }
    const step = advance(story, ctx, nodes);
    if (step && step.kind === 'ending') return { ctx, ending: step.ending, route: step.route };
  }
}

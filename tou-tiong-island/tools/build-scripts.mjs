#!/usr/bin/env node
/**
 * 由 content/stories/*.json 產生可閱讀的完整劇本與 Mermaid 流程圖。
 *
 * 劇本只有一份真實來源（JSON）。文件是產生出來的，所以不會出現
 * 「文件寫的和程式跑的不一樣」這種事。改完劇本跑 `npm run docs` 就好。
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describeExpr } from '../src/core/expr.js';
import { sortedRoutes } from '../src/core/routeResolver.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/scripts');
mkdirSync(OUT, { recursive: true });

const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const cards = read('content/practice_cards.json');
const islandMap = read('content/island_map.json');

const NODE_KIND = {
  narration: '旁白', decision: '決策點', converge: '匯流',
  conditional: '條件分流', ending: '結局',
};
const SPEAKER_STYLE = {
  narration: '', inner: '（心聲）', sfx: '（音效）', message: '（訊息）', line: '',
};

function speakerName(story, id) {
  if (id === 'narration') return '旁白';
  if (id === 'inner') return '內心';
  if (id === 'sfx') return '音效';
  return story.characters.find((c) => c.character_id === id)?.name ?? id;
}

function renderDialogue(story, lines, indent = '') {
  return lines.map((l) => {
    const who = speakerName(story, l.speaker);
    const tag = SPEAKER_STYLE[l.style ?? 'narration'] ?? '';
    if (l.speaker === 'narration') return `${indent}> ${l.text}`;
    return `${indent}> **${who}**${tag}：${l.text}`;
  }).join(`\n${indent}>\n`);
}

/** Mermaid 流程圖：決策點用菱形、匯流用圓角、結局用雙框。 */
function mermaid(story) {
  const lines = ['flowchart TD'];
  const safe = (id) => id.replace(/-/g, '_');
  const label = (t) => String(t).replace(/"/g, "'").replace(/\n/g, ' ');

  for (const node of story.nodes) {
    const id = safe(node.node_id);
    const title = label(node.title ?? node.node_id);
    switch (node.node_type) {
      case 'decision':   lines.push(`  ${id}{"${title}"}`); break;
      case 'conditional':lines.push(`  ${id}{{"${title}"}}`); break;
      case 'converge':   lines.push(`  ${id}(["${title}"])`); break;
      case 'ending':     lines.push(`  ${id}[["${title}"]]`); break;
      default:           lines.push(`  ${id}["${title}"]`);
    }
  }
  lines.push('');
  for (const node of story.nodes) {
    const id = safe(node.node_id);
    if (node.node_type === 'decision') {
      for (const c of node.choices) lines.push(`  ${id} -->|"${label(c.text)}"| ${safe(c.next_node_id)}`);
    } else if (node.node_type === 'conditional') {
      for (const b of node.conditions) {
        lines.push(`  ${id} -.->|"${label(b.note ?? describeExpr(b.condition))}"| ${safe(b.next_node_id)}`);
      }
      lines.push(`  ${id} -.->|"其餘"| ${safe(node.default_next_node_id)}`);
    } else if (node.next_node_id) {
      lines.push(`  ${id} --> ${safe(node.next_node_id)}`);
    }
  }
  lines.push('');
  lines.push(`  classDef ending fill:#f7e6c8,stroke:#d9a23f,stroke-width:2px;`);
  lines.push(`  class ${story.nodes.filter((n) => n.node_type === 'ending').map((n) => safe(n.node_id)).join(',')} ending;`);
  return lines.join('\n');
}

function buildStoryDoc(story) {
  const labels = Object.fromEntries(story.state_vars.map((v) => [v.key, v.label]));
  const island = islandMap.islands.find((i) => i.island_id === story.island_id);
  const out = [];
  const p = (s = '') => out.push(s);

  p(`# ${String(story.order).padStart(2, '0')}｜《${story.title}》`);
  p();
  p(`> ${story.subtitle}　・　主題：${story.theme}`);
  p(`>`);
  p(`> ${story.logline}`);
  p();
  p('<!-- 這份文件由 tools/build-scripts.mjs 從 ' + `content/stories/${story.story_id}.json` + ' 產生，請勿手動編輯。 -->');
  p();
  p('| 項目 | 內容 |');
  p('|---|---|');
  p(`| story_id | \`${story.story_id}\` |`);
  p(`| 版本 | ${story.version}（schema ${story.schema_version}） |`);
  p(`| 對應島嶼 | ${island?.default_name ?? story.island_id}（\`${story.island_id}\`） |`);
  p(`| 預估時間 | 約 ${story.estimated_minutes} 分鐘 |`);
  p(`| 節點 / 決策點 / 選項 | ${story.nodes.length} / ${story.nodes.filter((n) => n.node_type === 'decision').length} / ${story.nodes.reduce((s, n) => s + (n.choices?.length ?? 0), 0)} |`);
  p(`| 固定結局 / 航線 | ${story.endings.length} / ${story.routes.length} |`);
  p(`| 內容提醒 | ${(story.content_notes ?? []).join('、') || '—'} |`);
  p();

  p('## 場景與情緒衝突');
  p();
  p(`- **地點**：${story.setting.location}`);
  p(`- **時間**：${story.setting.time}`);
  p(`- **衝突**：${story.setting.conflict}`);
  p();

  p('## 人物');
  p();
  p('| 角色 | 身分 | 設定 | 說話方式 |');
  p('|---|---|---|---|');
  for (const c of story.characters) {
    p(`| ${c.name} | ${c.role} | ${c.profile ?? ''} | ${c.voice ?? ''} |`);
  }
  p();

  p('## 狀態變數');
  p();
  p('航線判定只讀這些變數與選項標記，不讀其他任何東西。');
  p();
  p('| key | 名稱 | 初始值 | 說明 |');
  p('|---|---|---|---|');
  for (const v of story.state_vars) p(`| \`${v.key}\` | ${v.label} | ${v.init} | ${v.description ?? ''} |`);
  p();

  p('## 流程圖');
  p();
  p('```mermaid');
  p(mermaid(story));
  p('```');
  p();

  p('## 完整劇本');
  p();
  for (const node of story.nodes) {
    if (node.node_type === 'ending') continue;
    p(`### ${node.title ?? node.node_id}`);
    p();
    p(`\`${node.node_id}\`　・　${NODE_KIND[node.node_type]}` +
      (node.converge_from ? `　・　承接：${node.converge_from.map((n) => `\`${n}\``).join('、')}` : ''));
    if (node.scene) {
      const s = node.scene;
      p();
      p(`*${[s.location, s.time, s.mood].filter(Boolean).join('　・　')}*`);
    }
    p();
    if (node.dialogue?.length) { p(renderDialogue(story, node.dialogue)); p(); }

    for (const block of node.conditional_dialogue ?? []) {
      p(`**條件式對白**　若：${describeExpr(block.condition, labels)}`);
      p();
      p(renderDialogue(story, block.dialogue));
      p();
    }

    if (node.node_type === 'decision') {
      for (const c of node.choices) {
        p(`#### 選項：${c.text}`);
        p();
        p(`\`${c.choice_id}\`${c.hint ? `　・　副標：「${c.hint}」` : ''}`);
        if (c.condition) p(`\n出現條件：${describeExpr(c.condition, labels)}`);
        p();
        p('**立即反應**');
        p();
        p(renderDialogue(story, c.immediate));
        p();
        p(`**實際後果**：${c.consequence}`);
        p();
        p(`**心聲線索「${c.inner_voice_clue.title}」**（\`${c.inner_voice_clue.clue_id}\`）`);
        p();
        p(`> ${c.inner_voice_clue.text}`);
        p();
        const effects = (c.state_effects ?? []).map((e) => `${labels[e.var] ?? e.var} ${e.op === 'add' ? (e.value >= 0 ? '+' : '') + e.value : `${e.op} ${e.value}`}`);
        p(`**狀態影響**：${effects.join('、') || '無'}　|　**標記**：${(c.tags ?? []).map((t) => `\`${t}\``).join('、') || '無'}　|　**前往**：\`${c.next_node_id}\``);
        p();
      }
    } else if (node.node_type === 'conditional') {
      p('| 順序 | 條件 | 前往 | 說明 |');
      p('|---|---|---|---|');
      node.conditions.forEach((b, i) => {
        p(`| ${i + 1} | ${describeExpr(b.condition, labels)} | \`${b.next_node_id}\` | ${b.note ?? ''} |`);
      });
      p(`| 保底 | 以上皆不成立 | \`${node.default_next_node_id}\` | — |`);
      p();
    } else if (node.next_node_id) {
      p(`**前往**：\`${node.next_node_id}\``);
      p();
    }
    if (node.replay_note) { p(`*重玩提示：${node.replay_note}*`); p(); }
  }

  p('## 結局');
  p();
  for (const e of story.endings) {
    const node = story.nodes.find((n) => n.ending_id === e.ending_id);
    p(`### ${e.title}`);
    p();
    p(`\`${e.ending_id}\`　・　節點 \`${node?.node_id}\`　・　標籤：${(e.tags ?? []).map((t) => `\`${t}\``).join('、') || '—'}`);
    p();
    p(renderDialogue(story, e.dialogue));
    p();
    p(`**結局回顧**：${e.recap.summary}`);
    if (e.recap.closing) { p(); p(`> ${e.recap.closing}`); }
    p();
  }

  p('## 結局判定');
  p();
  const check = story.nodes.find((n) => n.node_type === 'conditional' && n.node_id.includes('ending'));
  if (check) {
    p('| 順序 | 條件 | 結局 |');
    p('|---|---|---|');
    check.conditions.forEach((b, i) => {
      const node = story.nodes.find((n) => n.node_id === b.next_node_id);
      p(`| ${i + 1} | ${describeExpr(b.condition, labels)} | ${node?.title ?? b.next_node_id} |`);
    });
    const dflt = story.nodes.find((n) => n.node_id === check.default_next_node_id);
    p(`| 保底 | 以上皆不成立 | ${dflt?.title ?? check.default_next_node_id} |`);
    p();
  }

  p('## 三條航線');
  p();
  p('航線由固定規則判定，依 priority 由小到大評估，第一個命中的即為結果；最後一條是保底規則，');
  p('所以任何遊玩組合都會落在恰好一條航線上。AI 不參與這個判定。');
  p();
  for (const r of sortedRoutes(story)) {
    const card = cards.cards.find((c) => c.card_id === r.practice_card_id);
    const growth = island?.growth.find((g) => g.growth_id === r.island_growth_id);
    p(`### ${r.priority}. ${r.name}`);
    p();
    p(`\`${r.route_id}\``);
    p();
    p(`**敘事意涵**：${r.meaning}`);
    p();
    p(`**判定規則**：${describeExpr(r.rule, labels)}`);
    p();
    p('**航線解析（玩家看到的文案）**');
    p();
    p(r.narrative_explain.split('\n').map((l) => `> ${l}`).join('\n>\n'));
    p();
    p(`**情緒練習卡**：${card ? `《${card.title}》${card.subtitle}（\`${card.card_id}\`，約 ${card.duration_minutes} 分鐘）` : r.practice_card_id}`);
    p();
    p(`**島嶼地景**：${growth ? `${growth.label}　——　${growth.description}` : r.island_growth_id}`);
    if (growth) {
      p();
      p(`> ${growth.unlock_line}`);
      p();
      p(`新增地塊 ${growth.hexes?.length ?? 0} 個、新增物件 ${growth.landmarks?.length ?? 0} 個。`);
    }
    p();
  }

  p('## 重新遊玩可以探索的');
  p();
  for (const h of story.replay_hints ?? []) p(`- ${h}`);
  p();

  return out.join('\n');
}

const files = readdirSync(join(ROOT, 'content/stories')).filter((f) => f.endsWith('.json')).sort();
const summaries = [];
for (const file of files) {
  const story = read(join('content/stories', file));
  const name = `story_${String(story.order).padStart(2, '0')}.md`;
  writeFileSync(join(OUT, name), buildStoryDoc(story) + '\n');
  summaries.push({ story, name });
  console.log(`  ✓ docs/scripts/${name}`);
}

// 十八條航線總表（docs/04 引用）
const rt = [];
rt.push('# 十八條航線總表');
rt.push('');
rt.push('由 `npm run docs` 從 `content/stories/*.json`、`content/practice_cards.json` 與');
rt.push('`content/island_map.json` 產生，請勿手動編輯。');
rt.push('');
rt.push('判定方式：每篇故事的三條航線依 priority 由小到大評估，第一個命中的即為結果；');
rt.push('第三條一律是 `{"always": true}` 保底，所以任何遊玩組合都落在恰好一條航線上。');
rt.push('');
for (const { story } of summaries.sort((a, b) => a.story.order - b.story.order)) {
  const labels = Object.fromEntries(story.state_vars.map((v) => [v.key, v.label]));
  const island = islandMap.islands.find((i) => i.island_id === story.island_id);
  rt.push(`## ${story.order}. 《${story.title}》　→　${island?.default_name ?? story.island_id}`);
  rt.push('');
  rt.push('| # | 航線 | route_id | 判定規則 | 情緒練習卡 | 島嶼地景 |');
  rt.push('|---|---|---|---|---|---|');
  for (const r of sortedRoutes(story)) {
    const card = cards.cards.find((c) => c.card_id === r.practice_card_id);
    const growth = island?.growth.find((g) => g.growth_id === r.island_growth_id);
    rt.push(`| ${r.priority} | ${r.name} | \`${r.route_id}\` | ${describeExpr(r.rule, labels)} | 《${card?.title ?? r.practice_card_id}》 | ${growth?.label ?? r.island_growth_id} |`);
  }
  rt.push('');
  rt.push('**敘事意涵**');
  rt.push('');
  for (const r of sortedRoutes(story)) rt.push(`- **${r.name}**：${r.meaning}`);
  rt.push('');
}
writeFileSync(join(OUT, '航線總表.md'), rt.join('\n') + '\n');
console.log('  ✓ docs/scripts/航線總表.md');

// 索引
const idx = [];
idx.push('# 六篇完整劇本');
idx.push('');
idx.push('每一篇都包含：場景與人物設定、流程圖、逐節點的完整旁白與對白、每個選項的立即反應與');
idx.push('實際後果、心聲線索、狀態影響、所有分支與匯流、條件式對白、全部固定結局與結局判定表、');
idx.push('三條航線的敘事意涵與判定規則、對應的情緒練習卡與島嶼地景，以及重玩可探索的內容。');
idx.push('');
idx.push('這些文件由 `npm run docs` 從 `content/stories/*.json` 產生，JSON 才是唯一的真實來源。');
idx.push('');
idx.push('| # | 故事 | 主題 | 節點 | 結局 | 航線 | 文件 |');
idx.push('|---|---|---|---|---|---|---|');
for (const { story, name } of summaries.sort((a, b) => a.story.order - b.story.order)) {
  idx.push(`| ${story.order} | 《${story.title}》 | ${story.theme} | ${story.nodes.length} | ${story.endings.length} | ${story.routes.map((r) => r.name).join('、')} | [${name}](./${name}) |`);
}
idx.push('');
idx.push('另有 [十八條航線總表](./航線總表.md)，列出每條航線的判定規則、練習卡與島嶼地景。');
idx.push('');
writeFileSync(join(OUT, 'README.md'), idx.join('\n') + '\n');
console.log('  ✓ docs/scripts/README.md');

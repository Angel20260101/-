#!/usr/bin/env node
/**
 * 效能預算守門員。
 *
 * `src/world/perf.js` 的 BUDGET 本來只是寫在那裡沒人檢查的數字，
 * 所以加地面細節的時候 draw calls 從 40 悄悄爬到 48 都沒人發現。
 * 這支把它變成會擋下來的測試。
 *
 * 這裡算的是**估算值**，而且刻意算得比實際高一點（目前估 50、瀏覽器實測 48），
 * 寧可早一步擋下來。真正的數字以瀏覽器量到的為準，公式見下面 estimateDrawCalls()。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildWorld } from '../src/world/islandBuilder.js';
import { BUDGET } from '../src/world/perf.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

let failures = 0;
const ok = (m) => console.log('  ✓ ' + m);
const fail = (m) => { failures += 1; console.error('  ✗ ' + m); };
const check = (m, cond) => (cond ? ok(m) : fail(m));

const map = read('content/island_map.json');
const board = read('content/wish_board.json');

/** 全部解鎖、所有航線都長出來——這是最吃資源的狀態。 */
const fullProgress = Object.fromEntries(map.islands.map((i) => [
  i.island_id,
  { unlocked: true, name: i.default_name, routes: i.growth.map((g) => g.route_id) },
]));

/**
 * 每一項都對應場景裡真的會送出去的一次繪製：
 *   道具   每種型別一個 InstancedMesh
 *   島民   同上，但晴天與雨天各一組造型，取多的那邊
 *   地形   每座島的六角地塊合併成一個 mesh
 *   小船   一個 InstancedMesh（沒有船就沒有）
 *   固定   水面、雲、雨、淺灘、燈室、光束
 * 點選用的代理圓柱 material.visible = false，不會進渲染，所以不算。
 */
function estimateDrawCalls(world) {
  const animalTypes = new Set();
  const rainyTypes = new Set();
  for (const a of world.animals) {
    animalTypes.add(a.forms.default.type);
    rainyTypes.add(a.forms.rainy.type);
  }
  return world.props.size
    + Math.max(animalTypes.size, rainyTypes.size)
    + world.islands.filter((i) => i.geometry).length
    + (world.boats.length ? 1 : 0)
    + 6;
}

console.log('\n效能預算（src/world/perf.js 的 BUDGET）\n');

const full = buildWorld(map, fullProgress, { count: 6, board });
const fresh = buildWorld(map, {}, { count: 0, board });

const estFull = estimateDrawCalls(full);
const estFresh = estimateDrawCalls(fresh);

check(`全新存檔估算 ${estFresh} 個 draw call，在預算 ${BUDGET.maxDrawCalls} 內`,
  estFresh <= BUDGET.maxDrawCalls);
check(`六島全開估算 ${estFull} 個 draw call，在預算 ${BUDGET.maxDrawCalls} 內`,
  estFull <= BUDGET.maxDrawCalls);

// 剩下多少空間還能加新東西——加一種新道具就少一個
const room = BUDGET.maxDrawCalls - estFull;
console.log(`    還可以再加 ${room} 種新道具型別。不夠用的時候要嘛合併型別，`);
console.log('    要嘛重新檢討 BUDGET，不要偷偷超過。');

check('沒有使用貼圖（BUDGET.maxTextureSize = 0）', BUDGET.maxTextureSize === 0);
check('沒有後製、粒子、動態光源',
  !BUDGET.postProcessing && !BUDGET.particles && BUDGET.dynamicLights === 0);

/**
 * 陰影自 2026-10 起是開的，但它便宜的唯一理由是「只烘焙一次」。
 * 哪天有人把 autoUpdate 打開，每幀都會多跑一次完整的陰影 pass，
 * 成本直接翻倍而且不會有任何錯誤訊息——所以在這裡把它釘死。
 */
const sceneSrc = readFileSync(join(ROOT, 'src/world/sceneManager.js'), 'utf8');
check('陰影是靜態烘焙的（shadowMap.autoUpdate = false）',
  /shadowMap\.autoUpdate\s*=\s*false/.test(sceneSrc));
check('會動的物件不投影（島民、小船、雲用 cast: false）',
  /MOVING_SHADOW\s*=\s*\{\s*cast:\s*false/.test(sceneSrc)
  && /NO_SHADOW\s*=\s*\{\s*cast:\s*false/.test(sceneSrc));

// 實例總數：三角形幾乎是免費的，但矩陣更新是 CPU 成本，還是要盯著
const instances = [...full.props.values()].reduce((n, m) => n + m.length, 0);
check(`道具實例總數 ${instances}，在 2000 以內`, instances <= 2000);

// 地面細節的型別都真的存在，不然資料寫錯只會安靜地少東西
const { PROP_FACTORIES } = await import('../src/world/props.js');
const missing = [];
for (const [surface, spec] of Object.entries(map.ground_clutter ?? {})) {
  if (surface.startsWith('_')) continue;
  for (const t of spec.types ?? []) if (!PROP_FACTORIES[t]) missing.push(`${surface}:${t}`);
}
check('ground_clutter 指到的道具型別都存在', missing.length === 0);
if (missing.length) console.error('    找不到：' + missing.join(', '));

// 每一種地表都要有細節，不然拉近會看到一整片空的色塊
const surfaces = new Set();
for (const i of [map.home, map.wish_island, ...map.islands.flatMap((x) => [x.base, ...x.growth])]) {
  for (const h of i?.hexes ?? []) surfaces.add(h.surface);
}
const bare = [...surfaces].filter((s) => !(map.ground_clutter?.[s]?.count));
check('所有用到的地表種類都有地面細節', bare.length === 0);
if (bare.length) console.error('    沒有細節的地表：' + bare.join(', '));

console.log(failures ? `\n✗ ${failures} 項未通過\n` : '\n✓ 全部通過\n');
process.exit(failures ? 1 : 0);

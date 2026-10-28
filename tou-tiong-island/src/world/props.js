/**
 * 低多邊形道具庫。
 *
 * 每一種道具都被壓成「一個」帶頂點色的 BufferGeometry，底部對齊 y=0。
 * 場景會把同型別的道具收成一個 InstancedMesh，所以不論島上長出幾百棵樹，
 * 每種道具都只佔一個 draw call。
 *
 * 所有幾何都刻意用極低的分段數（錐體 5～6 面、球體用 IcosahedronGeometry detail 0），
 * 搭配 flatShading 取得參考圖那種塊面感，同時把三角形數壓到最低。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette.js';

function paint(geo, hex) {
  const color = new THREE.Color(hex);
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

const box = (w, h, d, color, x = 0, y = 0, z = 0, rotY = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  paint(g, color);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return g;
};
const cyl = (rt, rb, h, seg, color, x = 0, y = 0, z = 0) => {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  paint(g, color);
  g.translate(x, y, z);
  return g;
};
const cone = (r, h, seg, color, x = 0, y = 0, z = 0) => {
  const g = new THREE.ConeGeometry(r, h, seg);
  paint(g, color);
  g.translate(x, y, z);
  return g;
};
const blob = (r, color, x = 0, y = 0, z = 0) => {
  const g = new THREE.IcosahedronGeometry(r, 0);
  paint(g, color);
  g.translate(x, y, z);
  return g;
};

/**
 * 可以壓扁拉長的球。detail 1 是 80 面，比 blob 的 20 面圓得多。
 *
 * 島民身上才用它：鏡頭可以拉到看得見單一隻動物，20 面的球在那個距離是一顆
 * 稜角分明的石頭，不是一隻動物。地形與草木維持 blob，遠看不出差別又便宜。
 */
const ball = (r, color, x = 0, y = 0, z = 0, sy = 1, sz = 1, detail = 1) => {
  const g = new THREE.IcosahedronGeometry(r, detail);
  paint(g, color);
  g.scale(1, sy, sz);
  g.translate(x, y, z);
  return g;
};

/**
 * 頭是一顆球，臉上的東西要貼在**球面**上。
 * 直接寫死 z 座標會整個埋進頭裡面——第一版就是這樣，渲染出來一隻眼睛都看不到。
 */
const onHead = (head, dx, dy) =>
  head.z + Math.sqrt(Math.max(head.r * head.r - dx * dx - dy * dy, 1e-4));

/**
 * 一張臉：兩顆眼睛、兩團腮紅。
 *
 * 原本的島民一隻眼睛都沒有——遠看沒差，拉近就是一團沒有表情的毛。
 * 參考圖那隻企鵝之所以討喜，一半是這對眼睛，另一半是腮紅。
 * 眼睛的球心就落在頭的表面上，所以剛好露出半顆，像兩顆豆子貼上去。
 *
 * @param head {x,y,z,r} 頭那顆球
 */
const face = (head, { spread, up = 0.028, eye = 0.03, cheek = 0.023, cheekDown = 0.055, cheekOut = 0.052 } = {}) => {
  const out = [];
  for (const sx of [-1, 1]) {
    const dx = sx * spread;
    const z = onHead(head, dx, up);
    const x = head.x + dx;
    const y = head.y + up;
    // 白眼球 → 黑眼珠 → 一點反光。三層一層一層往外疊，
    // 單純一顆深色的點只會讓動物看起來沒有精神。
    out.push(ball(eye, PALETTE.eyeWhite, x, y, z, 1.18, 0.42, 1));
    out.push(ball(eye * 0.56, PALETTE.eyeDark, x, y - eye * 0.06, z + eye * 0.3, 1.1, 0.5, 1));
    out.push(ball(eye * 0.2, PALETTE.eyeWhite, x - sx * eye * 0.18, y + eye * 0.3, z + eye * 0.46, 1, 0.6, 0));
    const cdx = sx * (spread + cheekOut);
    out.push(ball(cheek, PALETTE.cheek, head.x + cdx, head.y - cheekDown,
      onHead(head, cdx, cheekDown), 0.7, 0.35, 0));
  }
  return out;
};

const merge = (parts) => {
  // IcosahedronGeometry 沒有 index，Cylinder/Cone/Box 有，混在一起無法合併。
  // 統一轉成非索引之後再合併——低多邊形的頂點數很少，付得起這點重複。
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const geo = mergeGeometries(flat, false);
  flat.forEach((g, i) => { if (g !== parts[i]) g.dispose(); });
  parts.forEach((g) => g.dispose());
  geo.computeVertexNormals();
  return geo;
};

/**
 * 一只有碟子、杯口與把手的茶杯。
 *
 * 原本只是一個 0.03 高的小圓柱——沒有開口、沒有把手，鏡頭拉近就是一個白點。
 * 讓它看得出來是杯子的其實只有三件事：**薄一圈的杯口、看得到裡面的茶、側邊的把手**。
 * 這些加起來才一百多個三角形，在這個鏡頭距離下值得。
 */
const teacup = (x, y, z) => {
  const parts = [
    cyl(0.055, 0.05, 0.007, 12, PALETTE.teaCup, 0, 0.0035, 0),        // 碟
    cyl(0.056, 0.052, 0.003, 12, PALETTE.teaCupRim, 0, 0.0085, 0),    // 碟緣
    cyl(0.038, 0.025, 0.044, 12, PALETTE.teaCup, 0, 0.032, 0),        // 杯身（上寬下窄）
    cyl(0.041, 0.039, 0.004, 12, PALETTE.teaCupRim, 0, 0.056, 0),     // 杯口
    // 茶要疊在杯口「上面」。圓柱是實心的，放在杯口下面會被它的頂蓋整個蓋住，
    // 看起來就變成一只蓋著蓋子的白杯子。
    cyl(0.036, 0.036, 0.0025, 12, PALETTE.tea, 0, 0.0593, 0),
  ];
  const handle = new THREE.TorusGeometry(0.019, 0.0055, 4, 10, Math.PI * 1.45);
  paint(handle, PALETTE.teaCup);
  handle.rotateZ(-Math.PI * 0.28);
  handle.translate(0.044, 0.034, 0);
  parts.push(handle);
  const geo = merge(parts);
  geo.translate(x, y, z);
  return geo;
};

/** 外帶咖啡：杯身、杯蓋、中間一圈隔熱紙套。 */
const coffeecup = (x, y, z) => {
  const geo = merge([
    cyl(0.03, 0.023, 0.058, 12, PALETTE.teaCup, 0, 0.029, 0),
    cyl(0.029, 0.027, 0.022, 12, PALETTE.wood, 0, 0.027, 0),          // 紙套
    cyl(0.033, 0.032, 0.008, 12, PALETTE.clothWarm, 0, 0.062, 0),     // 杯蓋
    cyl(0.018, 0.018, 0.006, 8, PALETTE.clothWarm, 0, 0.069, 0),      // 飲口
  ]);
  geo.translate(x, y, z);
  return geo;
};

/** 碟子上的小點心。原本是一顆粉紅色的球。 */
const biscuit = (x, y, z) => {
  const geo = merge([
    cyl(0.042, 0.04, 0.005, 10, PALETTE.teaCup, 0, 0.0025, 0),
    cyl(0.026, 0.026, 0.011, 10, PALETTE.biscuit, 0, 0.0105, 0),
    cyl(0.025, 0.025, 0.006, 10, PALETTE.flowerA, 0, 0.019, 0),
    cyl(0.026, 0.026, 0.011, 10, PALETTE.biscuit, 0, 0.0275, 0),
  ]);
  geo.translate(x, y, z);
  return geo;
};

/** 道具工廠。key 對應 island_map.json 的 landmark.type 與 flora_table 的樹種。 */
export const PROP_FACTORIES = {
  tree_pine: () => merge([
    cyl(0.055, 0.075, 0.34, 5, PALETTE.trunk, 0, 0.17, 0),
    cone(0.30, 0.62, 6, PALETTE.leafPine, 0, 0.62, 0),
    cone(0.22, 0.44, 6, PALETTE.leafPine, 0, 0.98, 0),
  ]),

  tree_round: () => merge([
    cyl(0.05, 0.07, 0.38, 5, PALETTE.trunk, 0, 0.19, 0),
    blob(0.30, PALETTE.leafRound, 0, 0.62, 0),
  ]),

  tree_blob: () => merge([
    cyl(0.05, 0.07, 0.30, 5, PALETTE.trunk, 0, 0.15, 0),
    blob(0.22, PALETTE.leafLime, -0.12, 0.46, 0.04),
    blob(0.26, PALETTE.leafRound, 0.10, 0.56, -0.06),
    blob(0.18, PALETTE.leafTeal, 0.02, 0.72, 0.10),
  ]),

  tree_pink: () => merge([
    cyl(0.045, 0.06, 0.42, 5, PALETTE.trunkDark, 0, 0.21, 0),
    blob(0.26, PALETTE.leafPink, 0, 0.62, 0),
    blob(0.16, PALETTE.leafPinkHi, 0.12, 0.78, 0.08),
  ]),

  tree_coral: () => merge([
    cyl(0.05, 0.07, 0.30, 5, PALETTE.trunkDark, 0, 0.15, 0),
    blob(0.24, PALETTE.leafCoral, 0, 0.48, 0),
    blob(0.15, PALETTE.leafPink, -0.14, 0.62, 0.06),
  ]),

  palm: () => {
    const parts = [cyl(0.045, 0.07, 0.86, 5, PALETTE.palmTrunk, 0, 0.43, 0)];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const leaf = new THREE.ConeGeometry(0.10, 0.42, 4);
      paint(leaf, i % 2 ? PALETTE.palmLeaf : PALETTE.leafPink);
      leaf.rotateZ(Math.PI / 2.4);
      leaf.rotateY(a);
      leaf.translate(Math.cos(a) * 0.16, 0.92, Math.sin(a) * 0.16);
      parts.push(leaf);
    }
    parts.push(blob(0.07, PALETTE.leafPinkHi, 0, 0.90, 0));
    return merge(parts);
  },

  grass_tuft: () => merge([
    cone(0.05, 0.16, 4, PALETTE.grassDark, 0, 0.08, 0),
    cone(0.04, 0.12, 4, PALETTE.leafLime, 0.07, 0.06, 0.03),
    cone(0.04, 0.13, 4, PALETTE.grassTop, -0.06, 0.065, -0.04),
  ]),

  rock: () => merge([
    blob(0.22, PALETTE.stone, 0, 0.12, 0),
    blob(0.13, PALETTE.rockSide, 0.18, 0.07, 0.08),
  ]),

  flower_patch: () => {
    const parts = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const x = Math.cos(a) * 0.12;
      const z = Math.sin(a) * 0.12;
      parts.push(cyl(0.012, 0.012, 0.14, 3, PALETTE.grassDark, x, 0.07, z));
      parts.push(blob(0.045, i % 2 ? PALETTE.flowerA : PALETTE.flowerB, x, 0.16, z));
    }
    return merge(parts);
  },

  // ── 氣候區專屬植被 ────────────────────────────────────
  // 沙漠島長仙人掌與旱生灌木，珊瑚海島長珊瑚扇。
  // 每種型別一個 draw call，所以氣候區的代價是固定的三個，不隨島數增加。

  cactus: () => {
    const parts = [
      cyl(0.075, 0.095, 0.46, 7, PALETTE.cactus, 0, 0.23, 0),
      ball(0.078, PALETTE.cactus, 0, 0.455, 0, 0.7, 1, 0),
    ];
    for (const sx of [-1, 1]) {
      const arm = new THREE.CylinderGeometry(0.042, 0.048, 0.17, 6);
      paint(arm, PALETTE.cactus);
      arm.rotateZ(sx * Math.PI / 2);
      arm.translate(sx * 0.105, 0.26, 0);
      parts.push(arm);
      parts.push(cyl(0.042, 0.046, 0.16, 6, PALETTE.cactus, sx * 0.175, 0.335, 0));
      parts.push(ball(0.044, PALETTE.cactus, sx * 0.175, 0.412, 0, 0.7, 1, 0));
    }
    // 淡淡的縱紋：拉近才看得到，但那就是這個鏡頭現在做得到的距離
    for (const sx of [-1, 1]) parts.push(box(0.012, 0.42, 0.012, PALETTE.cactusDark, sx * 0.07, 0.23, 0.045));
    parts.push(ball(0.022, PALETTE.flowerA, 0, 0.5, 0, 1, 1, 0));
    return merge(parts);
  },

  desert_shrub: () => merge([
    cone(0.05, 0.12, 4, PALETTE.aridLeaf, 0, 0.06, 0),
    cone(0.042, 0.095, 4, PALETTE.aridLeaf, 0.07, 0.048, 0.04),
    cone(0.04, 0.085, 4, PALETTE.cactusDark, -0.062, 0.042, -0.045),
    ball(0.055, PALETTE.pebbleWarm, 0, 0.012, 0, 0.35, 1, 0),
  ]),

  coral_fan: () => {
    const parts = [ball(0.06, PALETTE.shellIvory, 0, 0.018, 0, 0.4, 1, 0)];
    const cols = [PALETTE.coralA, PALETTE.coralC, PALETTE.coralB];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const fan = new THREE.CylinderGeometry(0.012, 0.02, 0.17, 5);
      paint(fan, cols[i]);
      fan.rotateZ(Math.cos(a) * 0.45);
      fan.rotateX(Math.sin(a) * 0.45);
      fan.translate(Math.cos(a) * 0.035, 0.095, Math.sin(a) * 0.035);
      parts.push(fan);
      parts.push(ball(0.045, cols[i], Math.cos(a) * 0.06, 0.18, Math.sin(a) * 0.06, 0.85, 0.5, 0));
    }
    return merge(parts);
  },

  // ── 地面細節 ──────────────────────────────────────────
  // 鏡頭可以拉到很近，草地與沙灘不能是一整片沒東西的色塊。
  // 這幾個刻意做得極小（每個幾十個三角形），靠數量鋪出質感；
  // 同型別收成一個 InstancedMesh，鋪幾百個也只多一個 draw call。

  pebble: () => merge([
    blob(0.062, PALETTE.pebbleWarm, 0, 0.028, 0),
    blob(0.038, PALETTE.pebbleWarmD, 0.085, 0.018, 0.045),
  ]),

  clover: () => merge([
    blob(0.062, PALETTE.cloverDark, 0, 0.04, 0),
    blob(0.048, PALETTE.leafPine, 0.072, 0.03, 0.045),
    blob(0.044, PALETTE.bushLeaf, -0.058, 0.028, -0.05),
  ]),

  bush: () => merge([
    blob(0.16, PALETTE.bushLeaf, 0, 0.13, 0),
    blob(0.11, PALETTE.leafRound, 0.13, 0.09, 0.05),
    blob(0.085, PALETTE.leafPine, -0.10, 0.08, -0.07),
  ]),

  flower_sm: () => merge([
    cyl(0.009, 0.009, 0.13, 3, PALETTE.grassDark, 0, 0.065, 0),
    blob(0.047, PALETTE.flowerA, 0, 0.15, 0),
  ]),

  flower_sm_gold: () => merge([
    cyl(0.009, 0.009, 0.115, 3, PALETTE.grassDark, 0, 0.058, 0),
    blob(0.043, PALETTE.flowerB, 0, 0.135, 0),
  ]),

  mushroom: () => merge([
    cyl(0.026, 0.033, 0.10, 5, PALETTE.hutWall, 0, 0.05, 0),
    cone(0.095, 0.085, 6, PALETTE.mushroomCap, 0, 0.125, 0),
  ]),

  shell: () => merge([
    cone(0.085, 0.065, 5, PALETTE.shellIvory, 0, 0.032, 0),
    blob(0.03, PALETTE.shellPink, 0, 0.024, 0.045),
  ]),

  driftwood: () => {
    // cyl() 是先上色再位移，躺下來要自己轉，所以這裡直接建幾何
    const log = new THREE.CylinderGeometry(0.024, 0.029, 0.21, 5);
    paint(log, PALETTE.wood);
    log.rotateZ(Math.PI / 2);
    log.translate(0, 0.029, 0);
    const stub = new THREE.CylinderGeometry(0.012, 0.015, 0.08, 4);
    paint(stub, PALETTE.woodDark);
    stub.rotateZ(Math.PI / 2.6);
    stub.translate(0.065, 0.06, 0.02);
    return merge([log, stub]);
  },

  stone_path: () => {
    const parts = [];
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      parts.push(cyl(0.13, 0.13, 0.05, 6, PALETTE.stone, (t - 0.5) * 1.2, 0.025, Math.sin(t * 3) * 0.07));
    }
    return merge(parts);
  },

  stepping_stone: () => merge([
    cyl(0.34, 0.30, 0.16, 6, PALETTE.stone, 0, 0.08, 0),
  ]),

  buoy: () => merge([
    cyl(0.09, 0.13, 0.22, 6, PALETTE.towerRed, 0, 0.11, 0),
    cone(0.07, 0.16, 6, PALETTE.towerWhite, 0, 0.30, 0),
  ]),

  lamp_post: () => merge([
    cyl(0.035, 0.05, 0.86, 5, PALETTE.lampPost, 0, 0.43, 0),
    box(0.20, 0.03, 0.03, PALETTE.lampPost, 0.08, 0.84, 0),
    blob(0.075, PALETTE.lampGlow, 0.16, 0.80, 0),
  ]),

  signpost: () => merge([
    cyl(0.04, 0.05, 0.62, 5, PALETTE.woodDark, 0, 0.31, 0),
    box(0.44, 0.17, 0.035, PALETTE.wood, 0.10, 0.52, 0, -0.25),
    box(0.34, 0.14, 0.035, PALETTE.rope, -0.07, 0.33, 0, 0.30),
  ]),

  bench: () => merge([
    box(0.62, 0.05, 0.22, PALETTE.wood, 0, 0.20, 0),
    box(0.62, 0.20, 0.04, PALETTE.wood, 0, 0.32, -0.10),
    box(0.05, 0.20, 0.20, PALETTE.woodDark, -0.26, 0.10, 0),
    box(0.05, 0.20, 0.20, PALETTE.woodDark, 0.26, 0.10, 0),
  ]),

  hut: () => merge([
    box(0.70, 0.46, 0.60, PALETTE.hutWall, 0, 0.23, 0),
    cone(0.62, 0.40, 4, PALETTE.hutRoof, 0, 0.66, 0),
    box(0.18, 0.28, 0.03, PALETTE.woodDark, 0, 0.14, 0.31),
    box(0.14, 0.14, 0.03, PALETTE.towerGlass, -0.22, 0.30, 0.31),
  ]),

  pier: () => {
    const parts = [];
    for (let i = 0; i < 7; i++) {
      parts.push(box(0.46, 0.045, 0.14, i % 2 ? PALETTE.wood : PALETTE.woodDark, 0, 0.30, i * 0.17 - 0.5));
    }
    for (const z of [-0.45, 0, 0.45]) {
      parts.push(cyl(0.035, 0.035, 0.66, 5, PALETTE.woodDark, -0.18, 0.0, z));
      parts.push(cyl(0.035, 0.035, 0.66, 5, PALETTE.woodDark, 0.18, 0.0, z));
    }
    parts.push(cyl(0.05, 0.05, 0.34, 5, PALETTE.wood, -0.20, 0.44, 0.58));
    parts.push(cyl(0.05, 0.05, 0.34, 5, PALETTE.wood, 0.20, 0.44, 0.58));
    return merge(parts);
  },

  rope_bridge: () => {
    const parts = [];
    const span = 2.0;
    const planks = 9;
    for (let i = 0; i < planks; i++) {
      const t = i / (planks - 1);
      const x = (t - 0.5) * span;
      const sag = Math.sin(t * Math.PI) * 0.22;
      parts.push(box(0.17, 0.035, 0.46, i % 2 ? PALETTE.wood : PALETTE.woodDark, x, 0.40 - sag, 0));
    }
    for (let i = 0; i < planks - 1; i++) {
      const t = (i + 0.5) / (planks - 1);
      const x = (t - 0.5) * span;
      const sag = Math.sin(t * Math.PI) * 0.22;
      parts.push(box(0.26, 0.018, 0.018, PALETTE.rope, x, 0.60 - sag, -0.22));
      parts.push(box(0.26, 0.018, 0.018, PALETTE.rope, x, 0.60 - sag, 0.22));
    }
    for (const x of [-span / 2, span / 2]) {
      parts.push(cyl(0.045, 0.05, 0.80, 5, PALETTE.woodDark, x, 0.40, -0.22));
      parts.push(cyl(0.045, 0.05, 0.80, 5, PALETTE.woodDark, x, 0.40, 0.22));
    }
    return merge(parts);
  },

  lighthouse: () => merge([
    cyl(0.40, 0.52, 0.18, 8, PALETTE.towerWhite, 0, 0.09, 0),
    cyl(0.26, 0.38, 0.52, 8, PALETTE.towerWhite, 0, 0.44, 0),
    cyl(0.245, 0.265, 0.18, 8, PALETTE.towerRed, 0, 0.79, 0),
    cyl(0.21, 0.245, 0.40, 8, PALETTE.towerWhite, 0, 1.08, 0),
    cyl(0.20, 0.21, 0.16, 8, PALETTE.towerRed, 0, 1.36, 0),
    cyl(0.24, 0.24, 0.26, 8, PALETTE.towerGlass, 0, 1.57, 0),
    cyl(0.30, 0.30, 0.04, 8, PALETTE.towerWhite, 0, 1.72, 0),
    cone(0.32, 0.30, 8, PALETTE.towerRoof, 0, 1.89, 0),
  ]),

  // ── 島民 ──────────────────────────────────────────────
  //
  // 不做擬人化。沒有站立的人形姿勢、沒有圓柱腿、不讓動物拿工具——
  // 那種做法在低多邊形下只會變成「一顆球插兩根棍子」，鏡頭一拉近就露餡。
  //
  // 改成：圓滾滾的動物本體 ＋ 一件衣服 ＋ 一張臉，牠在做的事交給旁邊的道具去講
  //（水壺、茶几、釣竿、傘都跟動物合併成同一個模型，所以還是一個 draw call）。
  // 討喜感的來源很具體：圓的身體、大眼睛、腮紅、一點點對比色。
  //
  // 體型約 0.4 單位高。遠看是會動的小點，靠近才看得出是誰、在幹嘛。

  animal_bear_mow: () => merge([
    // 熊：圓身體，下半身是吊帶工作褲
    ball(0.145, PALETTE.furBear, 0, 0.135, 0, 0.98),
    ball(0.148, PALETTE.cloth, 0, 0.105, 0, 0.62),
    ball(0.062, PALETTE.cloth, 0, 0.19, 0.082, 0.8, 0.35, 0),
    box(0.022, 0.075, 0.014, PALETTE.cloth, -0.052, 0.2, 0.108),
    box(0.022, 0.075, 0.014, PALETTE.cloth, 0.052, 0.2, 0.108),
    ball(0.048, PALETTE.furBear, -0.145, 0.15, 0.015, 0.9, 0.9),
    ball(0.048, PALETTE.furBear, 0.145, 0.15, 0.015, 0.9, 0.9),
    ball(0.05, PALETTE.furBearDark, -0.062, 0.028, 0.055, 0.45, 1.2),
    ball(0.05, PALETTE.furBearDark, 0.062, 0.028, 0.055, 0.45, 1.2),
    ball(0.108, PALETTE.furBear, 0, 0.30, 0.012),
    ball(0.04, PALETTE.furBear, -0.078, 0.375, -0.005, 0.9, 0.7),
    ball(0.04, PALETTE.furBear, 0.078, 0.375, -0.005, 0.9, 0.7),
    ball(0.021, PALETTE.furBearDark, -0.078, 0.381, 0.02, 0.9, 0.5, 0),
    ball(0.021, PALETTE.furBearDark, 0.078, 0.381, 0.02, 0.9, 0.5, 0),
    cyl(0.072, 0.082, 0.05, 10, PALETTE.rope, 0, 0.395, 0.005),
    cyl(0.155, 0.155, 0.014, 12, PALETTE.rope, 0, 0.372, 0.005),
    cyl(0.085, 0.085, 0.012, 10, PALETTE.clothWarm, 0, 0.378, 0.005),
    ball(0.055, PALETTE.snout, 0, 0.272, 0.078, 0.78, 0.7),
    ball(0.019, PALETTE.eyeDark, 0, 0.288, onHead({ x: 0, y: 0.30, z: 0.012, r: 0.108 }, 0, -0.012) + 0.03, 0.8, 0.8, 0),
    ...face({ x: 0, y: 0.30, z: 0.012, r: 0.108 }, { spread: 0.048 }),
    // 水壺放在腳邊，不是拿在手上
    cyl(0.052, 0.06, 0.085, 8, PALETTE.leafTeal, 0.255, 0.043, 0.02),
    cyl(0.055, 0.052, 0.012, 8, PALETTE.leafPine, 0.255, 0.09, 0.02),
    (() => {                                   // 壺嘴：斜斜地往外指才看得出是水壺
      const g = new THREE.CylinderGeometry(0.012, 0.019, 0.1, 5);
      paint(g, PALETTE.leafTeal);
      g.rotateZ(-0.75); g.translate(0.325, 0.072, 0.02);
      return g;
    })(),
    box(0.012, 0.055, 0.03, PALETTE.leafPine, 0.205, 0.095, 0.02),
    box(0.03, 0.012, 0.03, PALETTE.leafPine, 0.2165, 0.12, 0.02),
  ]),

  animal_rabbit_tea: () => merge([
    // 小圓桌
    cyl(0.026, 0.032, 0.125, 5, PALETTE.woodDark, 0.21, 0.062, 0),
    cyl(0.105, 0.105, 0.022, 10, PALETTE.wood, 0.21, 0.136, 0),
    teacup(0.188, 0.147, 0.022),
    biscuit(0.246, 0.147, -0.028),
    // 兔子：圍一條圍巾
    ball(0.125, PALETTE.furRabbit, -0.06, 0.115, 0, 0.95),
    ball(0.042, PALETTE.furRabbit, -0.125, 0.025, 0.05, 0.45, 1.2),
    ball(0.042, PALETTE.furRabbit, -0.005, 0.025, 0.05, 0.45, 1.2),
    cyl(0.072, 0.078, 0.038, 10, PALETTE.clothWarm, -0.06, 0.215, 0),
    box(0.035, 0.07, 0.016, PALETTE.clothWarm, -0.022, 0.19, 0.062),
    ball(0.095, PALETTE.furRabbit, -0.06, 0.285, 0.012),
    ball(0.032, PALETTE.furRabbit, -0.102, 0.40, -0.01, 2.1, 0.6),
    ball(0.032, PALETTE.furRabbit, -0.018, 0.40, -0.01, 2.1, 0.6),
    ball(0.016, PALETTE.furRabbitIn, -0.102, 0.405, 0.012, 2.0, 0.4, 0),
    ball(0.016, PALETTE.furRabbitIn, -0.018, 0.405, 0.012, 2.0, 0.4, 0),
    ball(0.026, PALETTE.flowerA, -0.085, 0.378, 0.03, 0.8, 0.6, 0),
    ball(0.026, PALETTE.flowerA, -0.035, 0.378, 0.03, 0.8, 0.6, 0),
    ball(0.013, PALETTE.clothWarm, -0.06, 0.378, 0.038, 1, 0.8, 0),
    ball(0.044, PALETTE.snout, -0.06, 0.262, 0.072, 0.72, 0.7),
    ball(0.015, PALETTE.furRabbitIn, -0.06, 0.275, onHead({ x: -0.06, y: 0.285, z: 0.012, r: 0.095 }, 0, -0.01) + 0.028, 0.8, 0.8, 0),
    ...face({ x: -0.06, y: 0.285, z: 0.012, r: 0.095 }, { spread: 0.044, eye: 0.027 }),
  ]),

  animal_cat_nap: () => merge([
    // 貓：蜷成一團在墊子上睡覺。睡著的眼睛是一條線，不是兩顆珠子
    cyl(0.175, 0.175, 0.018, 10, PALETTE.rope, 0, 0.009, 0),
    ball(0.115, PALETTE.furCat, 0, 0.082, -0.012, 0.72, 1.05),
    ball(0.028, PALETTE.furCat, -0.03, 0.055, -0.14, 0.6, 1.9),
    ball(0.075, PALETTE.furCat, 0.045, 0.095, 0.085),
    ball(0.026, PALETTE.furCat, 0.005, 0.148, 0.072, 1.1, 0.5),
    ball(0.026, PALETTE.furCat, 0.085, 0.148, 0.072, 1.1, 0.5),
    ball(0.013, PALETTE.furRabbitIn, 0.005, 0.151, 0.083, 1.0, 0.4, 0),
    ball(0.013, PALETTE.furRabbitIn, 0.085, 0.151, 0.083, 1.0, 0.4, 0),
    ball(0.03, PALETTE.snout, 0.045, 0.082, onHead({ x: 0.045, y: 0.095, z: 0.085, r: 0.075 }, 0, -0.013) + 0.012, 0.7, 0.6),
    ball(0.011, PALETTE.eyeDark, 0.045, 0.092, onHead({ x: 0.045, y: 0.095, z: 0.085, r: 0.075 }, 0, -0.003) + 0.038, 0.7, 0.7, 0),
    ball(0.016, PALETTE.eyeDark, 0.012, 0.107, onHead({ x: 0.045, y: 0.095, z: 0.085, r: 0.075 }, -0.033, 0.012), 0.22, 0.5, 0),
    ball(0.016, PALETTE.eyeDark, 0.078, 0.107, onHead({ x: 0.045, y: 0.095, z: 0.085, r: 0.075 }, 0.033, 0.012), 0.22, 0.5, 0),
    ball(0.02, PALETTE.cheek, -0.012, 0.085, onHead({ x: 0.045, y: 0.095, z: 0.085, r: 0.075 }, -0.057, -0.01), 0.7, 0.35, 0),
    ball(0.02, PALETTE.cheek, 0.102, 0.085, onHead({ x: 0.045, y: 0.095, z: 0.085, r: 0.075 }, 0.057, -0.01), 0.7, 0.35, 0),
    // 項圈：牠也有「穿」一件東西
    cyl(0.062, 0.066, 0.022, 10, PALETTE.clothWarm, 0.03, 0.055, 0.045),
    ball(0.019, PALETTE.gold, 0.03, 0.05, 0.102, 1, 1, 0),
  ]),

  animal_fox_fish: () => merge([
    // 狐狸：穿一件小背心，釣竿插在旁邊
    ball(0.128, PALETTE.furFox, 0, 0.118, 0, 0.95),
    ball(0.131, PALETTE.cloth, 0, 0.098, 0, 0.58),
    ball(0.042, PALETTE.furFox, -0.058, 0.024, 0.05, 0.45, 1.2),
    ball(0.042, PALETTE.furFox, 0.058, 0.024, 0.05, 0.45, 1.2),
    ball(0.06, PALETTE.furFox, -0.145, 0.085, -0.075, 1.0, 1.9),
    ball(0.032, PALETTE.snout, -0.175, 0.075, -0.145, 1.0, 1.1),
    ball(0.098, PALETTE.furFox, 0, 0.272, 0.012),
    ball(0.034, PALETTE.furFox, -0.072, 0.355, -0.008, 1.5, 0.55),
    ball(0.034, PALETTE.furFox, 0.072, 0.355, -0.008, 1.5, 0.55),
    ball(0.098, PALETTE.leafPine, 0, 0.332, 0.004, 0.52, 1),
    ball(0.072, PALETTE.leafPine, 0, 0.322, 0.082, 0.18, 0.7, 0),
    ball(0.042, PALETTE.snout, 0, 0.245, 0.08, 0.7, 0.85),
    ball(0.015, PALETTE.eyeDark, 0, 0.252, onHead({ x: 0, y: 0.272, z: 0.012, r: 0.098 }, 0, -0.02) + 0.032, 0.8, 0.8, 0),
    ...face({ x: 0, y: 0.272, z: 0.012, r: 0.098 }, { spread: 0.044, eye: 0.027 }),
    // 釣竿插在地上，魚簍放旁邊
    cyl(0.009, 0.009, 0.38, 4, PALETTE.woodDark, 0.175, 0.17, 0.02),
    box(0.005, 0.15, 0.005, PALETTE.rope, 0.175, 0.26, 0.175),
    cyl(0.05, 0.042, 0.075, 7, PALETTE.rope, 0.255, 0.038, -0.03),
  ]),

  animal_bird: () => merge([
    // 小鳥：身體與頭連成一顆蛋，翅膀是壓扁的橢圓球而不是兩塊板子
    ball(0.062, PALETTE.furBird, 0, 0.062, -0.008, 1.0, 1.15),
    ball(0.046, PALETTE.furBird, 0, 0.122, 0.022),
    cone(0.016, 0.046, 5, PALETTE.flowerB, 0, 0.118, 0.07),
    ball(0.013, PALETTE.eyeDark, -0.025, 0.136, onHead({ x: 0, y: 0.122, z: 0.022, r: 0.046 }, -0.025, 0.014), 1.1, 0.5, 0),
    ball(0.013, PALETTE.eyeDark, 0.025, 0.136, onHead({ x: 0, y: 0.122, z: 0.022, r: 0.046 }, 0.025, 0.014), 1.1, 0.5, 0),
    ball(0.016, PALETTE.cheek, -0.044, 0.112, onHead({ x: 0, y: 0.122, z: 0.022, r: 0.046 }, -0.044, -0.01), 0.7, 0.35, 0),
    ball(0.016, PALETTE.cheek, 0.044, 0.112, onHead({ x: 0, y: 0.122, z: 0.022, r: 0.046 }, 0.044, -0.01), 0.7, 0.35, 0),
    ball(0.062, PALETTE.furBird, -0.072, 0.07, -0.015, 0.3, 0.55, 0),
    ball(0.062, PALETTE.furBird, 0.072, 0.07, -0.015, 0.3, 0.55, 0),
    ball(0.04, PALETTE.furBird, 0, 0.055, -0.08, 0.5, 1.4, 0),
    cyl(0.04, 0.044, 0.016, 10, PALETTE.clothWarm, 0, 0.094, 0.005),
  ]),

  // ── 天氣 ───────────────────────────────────────────────
  cloud: () => merge([
    blob(0.42, PALETTE.towerWhite, 0, 0, 0),
    blob(0.32, PALETTE.towerWhite, 0.45, -0.06, 0.05),
    blob(0.28, PALETTE.towerWhite, -0.42, -0.08, -0.04),
    blob(0.24, PALETTE.towerWhite, 0.14, 0.16, -0.08),
  ]),

  raindrop: () => merge([
    box(0.018, 0.34, 0.018, PALETTE.foam, 0, 0, 0),
  ]),

  // 燈塔的燈：獨立一顆，才能在點擊時單獨亮起來
  lighthouse_lamp: () => merge([
    blob(0.085, PALETTE.towerGlass, 0, 0, 0),
  ]),

  // ── 之後幾批會用到的小物 ─────────────────────────────
  mailbox: () => merge([
    cyl(0.035, 0.042, 0.42, 5, PALETTE.woodDark, 0, 0.21, 0),
    box(0.22, 0.2, 0.17, PALETTE.towerRed, 0, 0.52, 0),
    cyl(0.1, 0.1, 0.18, 6, PALETTE.towerRed, 0, 0.62, 0),
    box(0.13, 0.025, 0.02, PALETTE.towerWhite, 0, 0.55, 0.09),
    blob(0.03, PALETTE.gold, 0.1, 0.63, 0.06),
  ]),

  boat: () => merge([
    box(0.3, 0.07, 0.14, PALETTE.wood, 0, 0.035, 0),
    cone(0.07, 0.16, 4, PALETTE.wood, 0.17, 0.045, 0),
    cyl(0.012, 0.012, 0.3, 4, PALETTE.woodDark, 0, 0.2, 0),
    box(0.015, 0.2, 0.14, PALETTE.towerWhite, 0, 0.23, 0.05),
  ]),

  // 願望島：公司還在處理 → 樹苗；做到了 → 大樹。
  wish_sapling: () => merge([
    cyl(0.025, 0.04, 0.22, 4, PALETTE.trunk, 0, 0.11, 0),
    blob(0.12, PALETTE.leafLime, 0, 0.28, 0),
    blob(0.07, PALETTE.leafRound, 0.07, 0.34, 0.04),
  ]),

  wish_tree: () => merge([
    cyl(0.07, 0.1, 0.46, 5, PALETTE.trunk, 0, 0.23, 0),
    blob(0.34, PALETTE.leafRound, 0, 0.72, 0),
    blob(0.2, PALETTE.leafLime, 0.22, 0.86, 0.08),
    blob(0.16, PALETTE.leafPink, -0.2, 0.84, -0.06),
    blob(0.05, PALETTE.gold, 0.1, 0.95, 0.12),
  ]),

  // ── 島民・雨天版 ──────────────────────────────────────
  // 天氣是玩家決定的，島民會照著天氣換穿的、換做的事：熊換雨衣去整理花園、
  // 兔子撐傘出門買咖啡、狐狸穿雨衣繼續釣、貓躲到屋簷下。
  // 換的是模型與行為，不是多畫一次。

  animal_bear_rain: () => merge([
    // 熊：黃色雨衣加帽兜，只露出一張臉
    ball(0.148, PALETTE.flowerB, 0, 0.135, 0, 1.0),
    ball(0.152, PALETTE.flowerB, 0, 0.105, 0, 0.66),
    ball(0.05, PALETTE.furBearDark, -0.062, 0.028, 0.055, 0.45, 1.2),
    ball(0.05, PALETTE.furBearDark, 0.062, 0.028, 0.055, 0.45, 1.2),
    ball(0.05, PALETTE.flowerB, -0.145, 0.15, 0.015, 0.9, 0.9),
    ball(0.05, PALETTE.flowerB, 0.145, 0.15, 0.015, 0.9, 0.9),
    ball(0.122, PALETTE.flowerB, 0, 0.305, -0.015),
    ball(0.1, PALETTE.furBear, 0, 0.298, 0.035),
    ball(0.052, PALETTE.snout, 0, 0.272, 0.095, 0.78, 0.7),
    ball(0.018, PALETTE.eyeDark, 0, 0.288, onHead({ x: 0, y: 0.298, z: 0.035, r: 0.1 }, 0, -0.01) + 0.028, 0.8, 0.8, 0),
    ...face({ x: 0, y: 0.298, z: 0.035, r: 0.1 }, { spread: 0.046 }),
    // 花圃：兩叢花在腳邊
    ball(0.055, PALETTE.leafRound, 0.24, 0.035, 0.03, 0.6, 1),
    ball(0.022, PALETTE.flowerA, 0.255, 0.075, 0.05, 1, 1, 0),
    ball(0.02, PALETTE.flowerA, 0.215, 0.07, 0.005, 1, 1, 0),
  ]),

  animal_rabbit_brolly: () => merge([
    // 傘插在旁邊，不是拿在手上——拿在手上就又變成人形姿勢了
    cyl(0.007, 0.007, 0.44, 4, PALETTE.woodDark, 0.17, 0.22, 0),
    cone(0.185, 0.1, 10, PALETTE.flowerA, 0.17, 0.465, 0),
    ball(0.016, PALETTE.wood, 0.17, 0.525, 0, 1, 1, 0),
    // 兔子：圍巾＋手邊一杯咖啡
    ball(0.125, PALETTE.furRabbit, -0.055, 0.115, 0, 0.95),
    ball(0.042, PALETTE.furRabbit, -0.12, 0.025, 0.05, 0.45, 1.2),
    ball(0.042, PALETTE.furRabbit, 0.0, 0.025, 0.05, 0.45, 1.2),
    cyl(0.072, 0.078, 0.038, 10, PALETTE.clothWarm, -0.055, 0.215, 0),
    box(0.035, 0.07, 0.016, PALETTE.clothWarm, -0.017, 0.19, 0.062),
    ball(0.095, PALETTE.furRabbit, -0.055, 0.285, 0.012),
    ball(0.032, PALETTE.furRabbit, -0.097, 0.40, -0.01, 2.1, 0.6),
    ball(0.032, PALETTE.furRabbit, -0.013, 0.40, -0.01, 2.1, 0.6),
    ball(0.016, PALETTE.furRabbitIn, -0.097, 0.405, 0.012, 2.0, 0.4, 0),
    ball(0.016, PALETTE.furRabbitIn, -0.013, 0.405, 0.012, 2.0, 0.4, 0),
    ball(0.044, PALETTE.snout, -0.055, 0.262, 0.072, 0.72, 0.7),
    ball(0.015, PALETTE.furRabbitIn, -0.055, 0.275, onHead({ x: -0.055, y: 0.285, z: 0.012, r: 0.095 }, 0, -0.01) + 0.028, 0.8, 0.8, 0),
    ...face({ x: -0.055, y: 0.285, z: 0.012, r: 0.095 }, { spread: 0.044, eye: 0.027 }),
    coffeecup(0.078, 0, 0.082),
  ]),

  animal_fox_brolly: () => merge([
    ball(0.128, PALETTE.leafTeal, 0, 0.118, 0, 0.98),
    ball(0.131, PALETTE.leafTeal, 0, 0.098, 0, 0.6),
    ball(0.042, PALETTE.furFox, -0.058, 0.024, 0.05, 0.45, 1.2),
    ball(0.042, PALETTE.furFox, 0.058, 0.024, 0.05, 0.45, 1.2),
    ball(0.06, PALETTE.furFox, -0.145, 0.085, -0.075, 1.0, 1.9),
    ball(0.032, PALETTE.snout, -0.175, 0.075, -0.145, 1.0, 1.1),
    ball(0.112, PALETTE.leafTeal, 0, 0.278, -0.012),
    ball(0.094, PALETTE.furFox, 0, 0.272, 0.028),
    ball(0.042, PALETTE.snout, 0, 0.245, 0.095, 0.7, 0.85),
    ball(0.015, PALETTE.eyeDark, 0, 0.252, onHead({ x: 0, y: 0.272, z: 0.028, r: 0.094 }, 0, -0.02) + 0.032, 0.8, 0.8, 0),
    ...face({ x: 0, y: 0.272, z: 0.028, r: 0.094 }, { spread: 0.044, eye: 0.027 }),
    cyl(0.008, 0.008, 0.4, 4, PALETTE.woodDark, 0.185, 0.2, 0.02),
    cone(0.17, 0.095, 10, PALETTE.leafTeal, 0.185, 0.425, 0.02),
    cyl(0.009, 0.009, 0.36, 4, PALETTE.woodDark, -0.015, 0.16, 0.19),
    box(0.005, 0.13, 0.005, PALETTE.rope, -0.015, 0.24, 0.33),
  ]),

  animal_cat_shelter: () => merge([
    // 屋簷
    box(0.38, 0.024, 0.32, PALETTE.woodDark, 0, 0.32, 0),
    cyl(0.015, 0.015, 0.32, 4, PALETTE.woodDark, -0.16, 0.16, -0.13),
    cyl(0.015, 0.015, 0.32, 4, PALETTE.woodDark, 0.16, 0.16, -0.13),
    // 貓：醒著，看著外面的雨
    cyl(0.175, 0.175, 0.018, 10, PALETTE.rope, 0, 0.009, 0),
    ball(0.115, PALETTE.furCat, 0, 0.082, -0.012, 0.72, 1.05),
    ball(0.028, PALETTE.furCat, -0.03, 0.055, -0.14, 0.6, 1.9),
    ball(0.075, PALETTE.furCat, 0.03, 0.098, 0.082),
    ball(0.026, PALETTE.furCat, -0.01, 0.151, 0.07, 1.1, 0.5),
    ball(0.026, PALETTE.furCat, 0.07, 0.151, 0.07, 1.1, 0.5),
    ball(0.013, PALETTE.furRabbitIn, -0.01, 0.154, 0.081, 1.0, 0.4, 0),
    ball(0.013, PALETTE.furRabbitIn, 0.07, 0.154, 0.081, 1.0, 0.4, 0),
    ball(0.03, PALETTE.snout, 0.03, 0.085, onHead({ x: 0.03, y: 0.098, z: 0.082, r: 0.075 }, 0, -0.013) + 0.012, 0.7, 0.6),
    ball(0.011, PALETTE.eyeDark, 0.03, 0.095, onHead({ x: 0.03, y: 0.098, z: 0.082, r: 0.075 }, 0, -0.003) + 0.038, 0.7, 0.7, 0),
    ...face({ x: 0.03, y: 0.098, z: 0.082, r: 0.075 }, { spread: 0.03, eye: 0.016, up: 0.022, cheekOut: 0.034, cheekDown: 0.03, cheek: 0.019 }),
    cyl(0.062, 0.066, 0.022, 10, PALETTE.clothWarm, 0.03, 0.058, 0.042),
  ]),
};

export const PROP_TYPES = Object.keys(PROP_FACTORIES);

/** 道具的大致高度，給 DOM 標籤定位用。 */
export const PROP_HEIGHT = {
  lighthouse: 2.1, hut: 0.9, pier: 0.6, rope_bridge: 0.8, signpost: 0.7,
  bench: 0.4, lamp_post: 0.9, palm: 1.0, tree_pine: 1.2, tree_round: 0.9,
};

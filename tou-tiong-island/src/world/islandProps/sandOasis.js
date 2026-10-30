/**
 * 01 砂屋綠洲（主題：界線）的場景道具。
 *
 * 這一包只有「走進這座島」才會載入，所以它的道具種類不佔群島總覽的預算。
 * 規格把這座島拆成五區：咖啡庭院、綠洲池岸、砂岩坡、紅磚主屋、風車工作區，
 * 每一區的道具都放在這裡，一個 key 一種道具。
 *
 * 配色：奶油金砂、陶土紅磚、鼠尾草綠、湖藍水池、靛藍門框。
 * 規格明講「風景以砂丘高低、仙人掌輪廓和矮牆形成，不靠滿地植物」，
 * 所以這裡的重點是建築與輪廓，不是把地面鋪滿。
 */
import * as THREE from 'three';
import { paint, box, cyl, cone, blob, ball, merge, teacup } from '../shapes.js';

/** 這座島自己的色票。跟群島共用的 PALETTE 分開，才不會改一處動全身。 */
export const OASIS = {
  sandTop: '#f2dfae', sandSide: '#dcbd82',
  duneTop: '#e8cf96', duneSide: '#cda868',
  rockTop: '#d9b584', rockSide: '#b98f5e',
  brick: '#c4724f', brickDark: '#a85b3d',
  roof: '#9e4b35', roofDark: '#863d2b',
  plaster: '#f7ead2',
  indigo: '#3f5f86', indigoDark: '#324c6b',
  cream: '#fbf3e2',
  wood: '#c08f5c', woodDark: '#9b6c40',
  sage: '#8fae84', sageDark: '#6f8d68',
  cactus: '#7fa578', cactusDark: '#5f8259',
  water: '#4f9fc0', waterShallow: '#8fd0dc',
  clay: '#cd8f63', clayDark: '#a96f48',
  cloth: '#f4ead6', clothWarm: '#e2a079',
  lamp: '#ffd9a0',
  rug: '#c98a6e', rugAlt: '#8aa88e',
  green: '#7f9e6e',
};

const C = OASIS;

/* ── 主屋 ───────────────────────────────────────────── */

/**
 * 紅磚單層屋。規格：深陶紅雙斜瓦頂、短煙囪、靛藍門、兩扇奶油窗框、
 * 兩級寬階、屋簷一盞暖色壁燈；牆面用四五塊大磚面，不逐磚建模。
 */
export const brick_house = () => {
  const parts = [
    box(2.1, 0.92, 1.6, C.brick, 0, 0.46, 0),
    box(2.14, 0.1, 1.64, C.brickDark, 0, 0.05, 0),            // 牆腳一道深色
    box(2.16, 0.06, 1.66, C.plaster, 0, 0.9, 0),              // 簷下一道淺帶
  ];
  // 雙斜瓦頂。兩片要「對向」倒成人字形：
  //   屋簷在 (±1.2, 0.92)、屋脊在 (0, 1.37)，每片的中點就在 (±0.6, 1.145)，
  //   傾角 atan(0.45 / 1.2) ≈ 0.36。第一版兩片同方向轉，屋頂就垮成兩塊斜板。
  const RISE = 0.45, EAVE = 1.2, WALL = 0.92;
  const slopeLen = Math.hypot(EAVE, RISE);
  const tilt = Math.atan2(RISE, EAVE);
  for (const sx of [-1, 1]) {
    const slope = new THREE.BoxGeometry(slopeLen, 0.085, 1.86);
    paint(slope, C.roof);
    slope.rotateZ(-sx * tilt);
    slope.translate(sx * EAVE / 2, WALL + RISE / 2, 0);
    parts.push(slope);
  }
  parts.push(box(0.16, 0.1, 1.92, C.roofDark, 0, WALL + RISE + 0.02, 0));   // 屋脊
  parts.push(box(0.24, 0.5, 0.24, C.brickDark, 0.6, 1.3, -0.42));           // 煙囪
  parts.push(box(0.3, 0.07, 0.3, C.plaster, 0.6, 1.58, -0.42));
  // 靛藍門 ＋ 兩扇奶油窗
  parts.push(box(0.46, 0.76, 0.05, C.indigo, 0, 0.38, 0.81));
  parts.push(box(0.5, 0.08, 0.07, C.plaster, 0, 0.78, 0.82));
  parts.push(blob(0.035, C.lamp, 0.17, 0.44, 0.84));
  for (const x of [-0.68, 0.68]) {
    parts.push(box(0.4, 0.38, 0.05, C.cream, x, 0.56, 0.81));
    parts.push(box(0.34, 0.32, 0.03, C.indigoDark, x, 0.56, 0.83));
    parts.push(box(0.44, 0.05, 0.08, C.plaster, x, 0.35, 0.82));
  }
  // 屋簷壁燈
  parts.push(box(0.07, 0.14, 0.07, C.woodDark, -0.42, 0.92, 0.84));
  parts.push(cone(0.1, 0.13, 6, C.lamp, -0.42, 0.86, 0.84));
  // 兩級寬階
  parts.push(box(0.9, 0.09, 0.26, C.plaster, 0, 0.045, 0.94));
  parts.push(box(1.1, 0.09, 0.22, C.plaster, 0, 0.045, 1.14));
  return merge(parts);
};

/* ── 咖啡庭院 ───────────────────────────────────────── */

export const cafe_table = () => merge([
  cyl(0.055, 0.07, 0.34, 8, C.woodDark, 0, 0.17, 0),
  cyl(0.19, 0.19, 0.03, 14, C.wood, 0, 0.355, 0),
  cyl(0.2, 0.2, 0.012, 14, C.cream, 0, 0.376, 0),
  cyl(0.16, 0.13, 0.025, 10, C.woodDark, 0, 0.0125, 0),
]);

export const cafe_chair = () => merge([
  cyl(0.015, 0.018, 0.2, 5, C.woodDark, -0.08, 0.1, -0.08),
  cyl(0.015, 0.018, 0.2, 5, C.woodDark, 0.08, 0.1, -0.08),
  cyl(0.015, 0.018, 0.2, 5, C.woodDark, -0.08, 0.1, 0.08),
  cyl(0.015, 0.018, 0.2, 5, C.woodDark, 0.08, 0.1, 0.08),
  box(0.24, 0.035, 0.24, C.wood, 0, 0.215, 0),
  box(0.24, 0.26, 0.035, C.wood, 0, 0.35, -0.1),
  box(0.2, 0.04, 0.045, C.woodDark, 0, 0.46, -0.1),
]);

/** 米白大傘。規格要「一把米白傘」，所以傘面用大面幾何、不做傘骨。 */
export const parasol = () => {
  const parts = [
    cyl(0.028, 0.034, 1.25, 6, C.woodDark, 0, 0.625, 0),
    cone(0.74, 0.3, 12, C.cloth, 0, 1.33, 0),
    cyl(0.74, 0.7, 0.03, 12, C.clothWarm, 0, 1.19, 0),
    blob(0.05, C.woodDark, 0, 1.5, 0),
    cyl(0.17, 0.2, 0.05, 10, C.rockSide ?? C.clayDark, 0, 0.025, 0),
  ];
  return merge(parts);
};

export const bench_long = () => merge([
  box(1.0, 0.06, 0.3, C.wood, 0, 0.3, 0),
  box(1.0, 0.3, 0.05, C.wood, 0, 0.46, -0.13),
  box(1.02, 0.05, 0.06, C.woodDark, 0, 0.62, -0.13),
  box(0.07, 0.3, 0.26, C.woodDark, -0.44, 0.15, 0),
  box(0.07, 0.3, 0.26, C.woodDark, 0.44, 0.15, 0),
]);

export const teapot_small = () => {
  const parts = [
    ball(0.085, C.cream, 0, 0.082, 0, 0.85, 1),
    cyl(0.055, 0.07, 0.012, 10, C.clayDark, 0, 0.006, 0),
    cyl(0.045, 0.05, 0.02, 10, C.cream, 0, 0.158, 0),
    blob(0.026, C.clothWarm, 0, 0.176, 0),
  ];
  const spout = new THREE.CylinderGeometry(0.014, 0.022, 0.1, 6);
  paint(spout, C.cream);
  spout.rotateZ(-0.8);
  spout.translate(0.098, 0.105, 0);
  parts.push(spout);
  const handle = new THREE.TorusGeometry(0.035, 0.009, 4, 10, Math.PI * 1.3);
  paint(handle, C.cream);
  handle.rotateZ(Math.PI * 0.75);
  handle.translate(-0.092, 0.09, 0);
  parts.push(handle);
  return merge(parts);
};

export const open_book = () => {
  const parts = [];
  for (const sx of [-1, 1]) {
    const page = new THREE.BoxGeometry(0.11, 0.012, 0.14);
    paint(page, C.cream);
    page.rotateZ(sx * 0.14);
    page.translate(sx * 0.056, 0.012, 0);
    parts.push(page);
    const cover = new THREE.BoxGeometry(0.115, 0.008, 0.148);
    paint(cover, C.indigo);
    cover.rotateZ(sx * 0.14);
    cover.translate(sx * 0.058, 0.004, 0);
    parts.push(cover);
  }
  return merge(parts);
};

/** 織紋地毯：規格要「一塊織紋色片地毯」，用兩層色塊表示紋路。 */
export const rug_woven = () => merge([
  box(1.5, 0.014, 1.1, C.rug, 0, 0.007, 0),
  box(1.3, 0.016, 0.9, C.rugAlt, 0, 0.009, 0),
  box(1.0, 0.018, 0.6, C.rug, 0, 0.011, 0),
  box(0.6, 0.02, 0.3, C.cream, 0, 0.013, 0),
]);

/* ── 綠洲池岸 ───────────────────────────────────────── */

export const boulder = () => merge([
  ball(0.3, C.rockTop, 0, 0.14, 0, 0.72, 1.1, 0),
  ball(0.17, C.rockSide, 0.26, 0.075, 0.1, 0.65, 1, 0),
]);

export const deck_wood = () => {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    parts.push(box(0.9, 0.035, 0.17, i % 2 ? C.wood : C.woodDark, 0, 0.17, i * 0.19 - 0.38));
  }
  for (const [x, z] of [[-0.38, -0.33], [0.38, -0.33], [-0.38, 0.33], [0.38, 0.33]]) {
    parts.push(cyl(0.035, 0.035, 0.34, 5, C.woodDark, x, 0, z));
  }
  return merge(parts);
};

export const foot_stool = () => merge([
  cyl(0.14, 0.15, 0.035, 10, C.wood, 0, 0.165, 0),
  cyl(0.02, 0.024, 0.16, 5, C.woodDark, -0.08, 0.08, -0.05),
  cyl(0.02, 0.024, 0.16, 5, C.woodDark, 0.08, 0.08, -0.05),
  cyl(0.02, 0.024, 0.16, 5, C.woodDark, 0, 0.08, 0.09),
]);

export const water_pump = () => {
  const parts = [
    box(0.26, 0.05, 0.26, C.rockTop, 0, 0.025, 0),
    cyl(0.05, 0.06, 0.46, 8, C.indigoDark, 0, 0.28, 0),
    ball(0.075, C.indigo, 0, 0.52, 0, 0.8, 1),
  ];
  const spout = new THREE.CylinderGeometry(0.028, 0.034, 0.2, 6);
  paint(spout, C.indigoDark);
  spout.rotateZ(-1.05);
  spout.translate(0.1, 0.46, 0);
  parts.push(spout);
  const lever = new THREE.BoxGeometry(0.26, 0.028, 0.035);
  paint(lever, C.woodDark);
  lever.rotateZ(0.3);
  lever.translate(-0.13, 0.55, 0);
  parts.push(lever);
  return merge(parts);
};

export const water_jar = () => merge([
  ball(0.17, C.clay, 0, 0.17, 0, 1.05, 1),
  cyl(0.1, 0.13, 0.03, 10, C.clayDark, 0, 0.015, 0),
  cyl(0.075, 0.065, 0.09, 10, C.clay, 0, 0.33, 0),
  cyl(0.088, 0.085, 0.022, 10, C.clayDark, 0, 0.382, 0),
]);

export const planter_trough = () => merge([
  box(0.62, 0.22, 0.3, C.clay, 0, 0.11, 0),
  box(0.66, 0.05, 0.34, C.clayDark, 0, 0.225, 0),
  box(0.52, 0.04, 0.2, C.woodDark, 0, 0.245, 0),
  ball(0.09, C.sage, -0.15, 0.3, 0, 0.8, 1, 0),
  ball(0.08, C.green, 0.06, 0.29, 0.02, 0.8, 1, 0),
  ball(0.07, C.sage, 0.2, 0.285, -0.02, 0.8, 1, 0),
]);

/* ── 沙漠植物 ───────────────────────────────────────── */

/** 柱狀仙人掌：規格要三株，是砂丘上的垂直節奏。 */
export const cactus_column = () => merge([
  cyl(0.11, 0.135, 1.0, 8, C.cactus, 0, 0.5, 0),
  ball(0.115, C.cactus, 0, 0.99, 0, 0.72, 1, 1),
  box(0.014, 0.92, 0.014, C.cactusDark, 0.085, 0.5, 0.055),
  box(0.014, 0.92, 0.014, C.cactusDark, -0.085, 0.5, 0.055),
  box(0.014, 0.92, 0.014, C.cactusDark, 0, 0.5, -0.1),
  ball(0.04, '#f3d08c', 0, 1.07, 0, 1, 1, 0),
]);

/** 大型三叉掌：規格要「一株大型三叉掌」當主要輪廓。 */
export const cactus_tri = () => {
  const parts = [
    cyl(0.12, 0.15, 1.15, 8, C.cactus, 0, 0.575, 0),
    ball(0.125, C.cactus, 0, 1.14, 0, 0.75, 1, 1),
  ];
  for (const [sx, h, lift] of [[-1, 0.5, 0.52], [1, 0.62, 0.42]]) {
    const arm = new THREE.CylinderGeometry(0.065, 0.075, 0.26, 7);
    paint(arm, C.cactus);
    arm.rotateZ(sx * Math.PI / 2);
    arm.translate(sx * 0.17, lift, 0);
    parts.push(arm);
    parts.push(cyl(0.065, 0.07, h, 7, C.cactus, sx * 0.29, lift + h / 2, 0));
    parts.push(ball(0.068, C.cactus, sx * 0.29, lift + h, 0, 0.75, 1, 1));
  }
  for (const sx of [-1, 1]) parts.push(box(0.016, 1.05, 0.016, C.cactusDark, sx * 0.1, 0.56, 0.07));
  parts.push(ball(0.05, '#f0b9c4', 0, 1.22, 0, 1, 1, 0));
  return merge(parts);
};

/** 扁圓掌（仙人掌的耳朵片）。 */
export const cactus_pad = () => {
  const parts = [ball(0.2, C.cactus, 0, 0.21, 0, 1.15, 0.33, 1)];
  for (const [sx, s] of [[-1, 0.62], [1, 0.52]]) {
    parts.push(ball(0.2 * s, C.cactus, sx * 0.19, 0.38, 0, 1.15, 0.33, 1));
  }
  parts.push(ball(0.045, '#f3d08c', 0.19, 0.5, 0, 1, 1, 0));
  return merge(parts);
};

export const succulent = () => {
  const parts = [cyl(0.1, 0.12, 0.05, 8, C.clay, 0, 0.025, 0)];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const leaf = new THREE.ConeGeometry(0.035, 0.13, 4);
    paint(leaf, i % 2 ? C.sage : C.sageDark);
    leaf.rotateZ(Math.cos(a) * 0.7);
    leaf.rotateX(Math.sin(a) * 0.7);
    leaf.translate(Math.cos(a) * 0.045, 0.095, Math.sin(a) * 0.045);
    parts.push(leaf);
  }
  parts.push(cone(0.03, 0.1, 4, C.sage, 0, 0.11, 0));
  return merge(parts);
};

/** 棗椰：比群島上的 palm 高大，是這座島的天際線。 */
export const date_palm = () => {
  const parts = [];
  // 樹幹微微側彎，整支筆直看起來像電線桿
  let tx = 0;
  for (let i = 0; i < 6; i++) {
    tx += i * 0.006;
    parts.push(cyl(0.07 - i * 0.005, 0.082 - i * 0.005, 0.3, 7,
      i % 2 ? C.wood : C.woodDark, tx, 0.15 + i * 0.28, 0));
  }
  const top = 1.72;

  /**
   * 一片葉：拆成三段，每一段比前一段更往下彎，連起來是一道弧。
   *
   * 試過「一個壓扁的錐體」，但四面錐壓扁之後是一根楔子，不管怎麼轉都像一根尖刺。
   * 葉子要有「弧」才像葉子，而弧在低多邊形裡就是分段折線。
   */
  const frond = (a, colour, { segs = 3, L = 0.3, w0 = 0.3, tilt = 0.3, bend = 0.52 } = {}) => {
    let px = 0, py = 0, ang = tilt;          // 在葉子自己的垂直平面裡往外走
    for (let i = 0; i < segs; i++) {
      const w = w0 * (1 - i / (segs + 0.7));
      const seg = new THREE.BoxGeometry(L * 1.04, 0.028, w);
      paint(seg, colour);
      seg.rotateZ(ang);
      seg.translate(px + Math.cos(ang) * L / 2, py + Math.sin(ang) * L / 2, 0);
      seg.rotateY(a);                         // 再轉到這片葉子的方位
      seg.translate(tx, top, 0);
      parts.push(seg);
      px += Math.cos(ang) * L;
      py += Math.sin(ang) * L;
      ang -= bend;
    }
  };

  // 外圈六片長葉下垂、內圈三片短葉上揚
  for (let i = 0; i < 6; i++) {
    frond((i / 6) * Math.PI * 2 + 0.25, i % 2 ? C.sage : C.sageDark,
      { L: 0.32, w0: 0.32, tilt: 0.34, bend: 0.56 });
  }
  for (let i = 0; i < 3; i++) {
    frond((i / 3) * Math.PI * 2 - 0.5, i % 2 ? C.sageDark : C.sage,
      { segs: 2, L: 0.27, w0: 0.24, tilt: 0.72, bend: 0.42 });
  }
  parts.push(ball(0.1, C.sageDark, tx, top, 0, 0.7, 1, 0));
  // 椰棗：一小串垂在樹冠下
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(ball(0.042, '#c87a4a', tx + Math.cos(a) * 0.1, top - 0.13, Math.sin(a) * 0.1, 1, 1, 0));
  }
  return merge(parts);
};

/* ── 砂岩、小徑 ─────────────────────────────────────── */

/** 矮岩拱：規格要「一座矮岩拱」，是左後砂岩坡的辨識物。 */
export const rock_arch = () => {
  const parts = [
    box(0.42, 0.95, 0.5, C.rockTop, -0.62, 0.475, 0),
    box(0.44, 0.9, 0.48, C.rockTop, 0.62, 0.45, 0),
    box(0.36, 0.12, 0.44, C.rockSide, -0.62, 0.06, 0),
  ];
  const span = new THREE.BoxGeometry(1.52, 0.3, 0.48);
  paint(span, C.rockTop);
  span.translate(0, 1.05, 0);
  parts.push(span);
  parts.push(box(1.58, 0.1, 0.52, C.rockSide, 0, 1.24, 0));
  return merge(parts);
};

export const boardwalk = () => {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    parts.push(box(0.62, 0.03, 0.14, i % 2 ? C.wood : C.woodDark, 0, 0.1, i * 0.17 - 0.42));
  }
  parts.push(box(0.05, 0.1, 1.1, C.woodDark, -0.26, 0.05, 0));
  parts.push(box(0.05, 0.1, 1.1, C.woodDark, 0.26, 0.05, 0));
  return merge(parts);
};

/* ── 風車水塔與工作區 ───────────────────────────────── */

/**
 * 矮風車水塔，四片寬葉。葉片單獨做成一個 key，場景再把它當會轉的零件掛上去——
 * 規格要求「風車緩轉」，所以塔身與葉片必須分件。
 */
export const windmill_tower = () => {
  const parts = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = new THREE.CylinderGeometry(0.035, 0.055, 1.5, 5);
    paint(leg, C.woodDark);
    leg.rotateZ(-sx * 0.07);
    leg.rotateX(sz * 0.07);
    leg.translate(sx * 0.26, 0.75, sz * 0.26);
    parts.push(leg);
  }
  for (const y of [0.42, 0.95]) {
    parts.push(box(0.6, 0.035, 0.05, C.wood, 0, y, -0.26));
    parts.push(box(0.6, 0.035, 0.05, C.wood, 0, y, 0.26));
    parts.push(box(0.05, 0.035, 0.6, C.wood, -0.26, y, 0));
    parts.push(box(0.05, 0.035, 0.6, C.wood, 0.26, y, 0));
  }
  parts.push(cyl(0.3, 0.33, 0.44, 10, C.clay, 0, 1.72, 0));       // 水槽
  parts.push(cyl(0.34, 0.32, 0.04, 10, C.clayDark, 0, 1.96, 0));
  parts.push(box(0.14, 0.14, 0.14, C.woodDark, 0, 1.52, 0.3));    // 風車軸座
  return merge(parts);
};

/** 風車葉片。原點在軸心，場景每幀繞 Z 軸轉。 */
export const windmill_blades = () => {
  const parts = [cyl(0.055, 0.055, 0.12, 8, C.woodDark, 0, 0, 0)];
  parts[0].rotateX(Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const blade = new THREE.BoxGeometry(0.24, 0.56, 0.03);
    paint(blade, i % 2 ? C.cloth : C.clothWarm);
    blade.translate(0, 0.34, 0);
    blade.rotateZ(a);
    parts.push(blade);
    const spar = new THREE.BoxGeometry(0.03, 0.6, 0.04);
    paint(spar, C.woodDark);
    spar.translate(0, 0.3, 0.02);
    spar.rotateZ(a);
    parts.push(spar);
  }
  return merge(parts);
};

/** 三柱遮陽棚。 */
export const shade_canopy = () => {
  const parts = [
    cyl(0.04, 0.05, 1.3, 6, C.woodDark, -0.62, 0.65, -0.42),
    cyl(0.04, 0.05, 1.3, 6, C.woodDark, 0.62, 0.65, -0.42),
    cyl(0.04, 0.05, 1.3, 6, C.woodDark, 0, 0.65, 0.5),
  ];
  const cloth = new THREE.BoxGeometry(1.5, 0.045, 1.15);
  paint(cloth, C.cloth);
  cloth.rotateX(0.09);
  cloth.translate(0, 1.32, 0.02);
  parts.push(cloth);
  parts.push(box(1.56, 0.05, 0.08, C.clothWarm, 0, 1.3, 0.56));
  return merge(parts);
};

export const tool_rack = () => merge([
  box(0.9, 0.06, 0.1, C.wood, 0, 0.86, 0),
  cyl(0.035, 0.04, 0.88, 5, C.woodDark, -0.4, 0.44, 0),
  cyl(0.035, 0.04, 0.88, 5, C.woodDark, 0.4, 0.44, 0),
  box(0.05, 0.5, 0.05, C.woodDark, -0.24, 0.6, 0.07),
  box(0.16, 0.08, 0.04, C.sageDark, -0.24, 0.36, 0.07),
  box(0.04, 0.46, 0.04, C.woodDark, 0.06, 0.62, 0.07),
  cone(0.09, 0.14, 5, C.rockSide, 0.06, 0.39, 0.07),
  box(0.04, 0.4, 0.04, C.woodDark, 0.3, 0.64, 0.07),
  box(0.13, 0.1, 0.03, C.indigoDark, 0.3, 0.44, 0.07),
]);

export const work_bench = () => merge([
  box(1.1, 0.07, 0.5, C.wood, 0, 0.62, 0),
  box(1.14, 0.04, 0.54, C.woodDark, 0, 0.66, 0),
  cyl(0.04, 0.045, 0.6, 5, C.woodDark, -0.48, 0.3, -0.18),
  cyl(0.04, 0.045, 0.6, 5, C.woodDark, 0.48, 0.3, -0.18),
  cyl(0.04, 0.045, 0.6, 5, C.woodDark, -0.48, 0.3, 0.18),
  cyl(0.04, 0.045, 0.6, 5, C.woodDark, 0.48, 0.3, 0.18),
  box(1.0, 0.04, 0.3, C.woodDark, 0, 0.2, 0),
  cyl(0.1, 0.12, 0.16, 8, C.clay, -0.32, 0.76, 0.04),
  box(0.22, 0.09, 0.16, C.sageDark, 0.26, 0.72, 0.02),
]);

export const clay_pot = () => merge([
  cyl(0.14, 0.1, 0.24, 10, C.clay, 0, 0.12, 0),
  cyl(0.155, 0.15, 0.035, 10, C.clayDark, 0, 0.235, 0),
  ball(0.12, C.sage, 0, 0.3, 0, 0.8, 1, 0),
  ball(0.08, C.green, 0.08, 0.34, 0.04, 0.8, 1, 0),
]);

/* ── 邊界與擺設 ─────────────────────────────────────── */

/** 彎曲低砂岩牆的一段。場景把好幾段接成一條彎牆。 */
export const sand_wall = () => merge([
  box(1.0, 0.44, 0.22, C.duneTop, 0, 0.22, 0),
  box(1.04, 0.06, 0.26, C.duneSide, 0, 0.47, 0),
  box(0.98, 0.08, 0.24, C.rockSide, 0, 0.04, 0),
]);

export const gate_wood = () => merge([
  cyl(0.06, 0.07, 0.86, 6, C.woodDark, -0.46, 0.43, 0),
  cyl(0.06, 0.07, 0.86, 6, C.woodDark, 0.46, 0.43, 0),
  box(0.92, 0.07, 0.04, C.wood, 0, 0.7, 0),
  box(0.92, 0.07, 0.04, C.wood, 0, 0.42, 0),
  box(0.05, 0.6, 0.04, C.wood, -0.24, 0.42, 0),
  box(0.05, 0.6, 0.04, C.wood, 0, 0.42, 0),
  box(0.05, 0.6, 0.04, C.wood, 0.24, 0.42, 0),
  cone(0.09, 0.1, 5, C.clayDark, -0.46, 0.91, 0),
  cone(0.09, 0.1, 5, C.clayDark, 0.46, 0.91, 0),
]);

/** 門外的包裹收件架。這座島的主題是界線——東西放在門外，不進家門。 */
export const parcel_rack = () => merge([
  cyl(0.035, 0.04, 0.6, 5, C.woodDark, -0.26, 0.3, 0),
  cyl(0.035, 0.04, 0.6, 5, C.woodDark, 0.26, 0.3, 0),
  box(0.64, 0.05, 0.34, C.wood, 0, 0.6, 0),
  box(0.64, 0.05, 0.34, C.wood, 0, 0.32, 0),
  box(0.3, 0.2, 0.24, '#d9b98f', -0.12, 0.72, 0),
  box(0.32, 0.03, 0.06, C.clothWarm, -0.12, 0.83, 0),
  box(0.22, 0.14, 0.18, '#c9a87e', 0.18, 0.41, 0.02),
]);

/** 輪子。CylinderGeometry 的軸預設朝上，不轉的話會變成躺在地上的盤子。 */
const wheel = (r, x, y, z) => {
  const g = new THREE.CylinderGeometry(r, r, 0.05, 10);
  paint(g, C.woodDark);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return g;
};

export const hand_cart = () => merge([
  box(0.56, 0.05, 0.38, C.wood, 0, 0.3, 0),
  box(0.56, 0.16, 0.04, C.wood, 0, 0.38, -0.19),
  box(0.04, 0.16, 0.38, C.wood, -0.28, 0.38, 0),
  box(0.04, 0.16, 0.38, C.wood, 0.28, 0.38, 0),
  wheel(0.14, -0.3, 0.14, 0.04),
  wheel(0.14, 0.3, 0.14, 0.04),
  box(0.04, 0.04, 0.42, C.woodDark, -0.2, 0.33, 0.38),
  box(0.04, 0.04, 0.42, C.woodDark, 0.2, 0.33, 0.38),
  box(0.44, 0.04, 0.04, C.woodDark, 0, 0.33, 0.58),
]);

export const rope_fence = () => {
  const parts = [
    cyl(0.04, 0.05, 0.5, 6, C.woodDark, -0.5, 0.25, 0),
    cyl(0.04, 0.05, 0.5, 6, C.woodDark, 0.5, 0.25, 0),
    blob(0.055, C.wood, -0.5, 0.52, 0),
    blob(0.055, C.wood, 0.5, 0.52, 0),
  ];
  // 下垂的繩子：三段折線近似
  const pts = [[-0.5, 0.42], [-0.17, 0.33], [0.17, 0.33], [0.5, 0.42]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i]; const [x2, y2] = pts[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const seg = new THREE.CylinderGeometry(0.014, 0.014, len, 5);
    paint(seg, '#e3cfa6');
    seg.rotateZ(Math.PI / 2 - Math.atan2(y2 - y1, x2 - x1));
    seg.translate((x1 + x2) / 2, (y1 + y2) / 2, 0);
    parts.push(seg);
  }
  return merge(parts);
};

export const path_sign = () => merge([
  cyl(0.04, 0.05, 0.78, 6, C.woodDark, 0, 0.39, 0),
  box(0.46, 0.15, 0.04, C.wood, 0.13, 0.7, 0),
  box(0.42, 0.11, 0.02, C.cream, 0.13, 0.7, 0.025),
  box(0.38, 0.13, 0.04, C.wood, -0.1, 0.52, 0),
  box(0.34, 0.09, 0.02, C.cream, -0.1, 0.52, 0.025),
]);

export const low_lamp = () => merge([
  cyl(0.07, 0.09, 0.05, 8, C.rockSide, 0, 0.025, 0),
  cyl(0.028, 0.032, 0.52, 6, C.indigoDark, 0, 0.26, 0),
  box(0.15, 0.16, 0.15, C.lamp, 0, 0.58, 0),
  cone(0.13, 0.08, 4, C.indigoDark, 0, 0.7, 0),
]);

/* ── 咖啡杯（庭院桌上） ─────────────────────────────── */
/** 跟群島共用同一只杯子，造型語言才一致。 */
export const coffee_cup = () => teacup(0, 0, 0);

export const PROPS = {
  brick_house, cafe_table, cafe_chair, parasol, bench_long, teapot_small, open_book, rug_woven,
  boulder, deck_wood, foot_stool, water_pump, water_jar, planter_trough,
  cactus_column, cactus_tri, cactus_pad, succulent, date_palm,
  rock_arch, boardwalk,
  windmill_tower, windmill_blades, shade_canopy, tool_rack, work_bench, clay_pot,
  sand_wall, gate_wood, parcel_rack, hand_cart, rope_fence, path_sign, low_lamp,
  coffee_cup,
};

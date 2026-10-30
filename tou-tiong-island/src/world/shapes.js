/**
 * 低多邊形幾何的共用小工具。
 *
 * 群島上的道具（props.js）與走進島裡之後才載入的場景道具（islandProps/）都用這一組，
 * 所以兩邊的造型語言一致：一樣的上色方式、一樣的圓度、一樣的合併規則。
 *
 * 全部都回傳「已經上好頂點色、底部對齊 y=0」的 BufferGeometry。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette.js';

export function paint(geo, hex) {
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

export const box = (w, h, d, color, x = 0, y = 0, z = 0, rotY = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  paint(g, color);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return g;
};
export const cyl = (rt, rb, h, seg, color, x = 0, y = 0, z = 0) => {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  paint(g, color);
  g.translate(x, y, z);
  return g;
};
export const cone = (r, h, seg, color, x = 0, y = 0, z = 0) => {
  const g = new THREE.ConeGeometry(r, h, seg);
  paint(g, color);
  g.translate(x, y, z);
  return g;
};
export const blob = (r, color, x = 0, y = 0, z = 0) => {
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
export const ball = (r, color, x = 0, y = 0, z = 0, sy = 1, sz = 1, detail = 1) => {
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
export const onHead = (head, dx, dy) =>
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
export const face = (head, { spread, up = 0.028, eye = 0.03, cheek = 0.023, cheekDown = 0.055, cheekOut = 0.052 } = {}) => {
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

export const merge = (parts) => {
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
export const teacup = (x, y, z) => {
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
export const coffeecup = (x, y, z) => {
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
export const biscuit = (x, y, z) => {
  const geo = merge([
    cyl(0.042, 0.04, 0.005, 10, PALETTE.teaCup, 0, 0.0025, 0),
    cyl(0.026, 0.026, 0.011, 10, PALETTE.biscuit, 0, 0.0105, 0),
    cyl(0.025, 0.025, 0.006, 10, PALETTE.flowerA, 0, 0.019, 0),
    cyl(0.026, 0.026, 0.011, 10, PALETTE.biscuit, 0, 0.0275, 0),
  ]);
  geo.translate(x, y, z);
  return geo;
};


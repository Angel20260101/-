/**
 * 走進島裡之後的地形。
 *
 * 群島總覽用六角地塊（hexGeometry.js），那是為了「一眼看出有幾座島」。
 * island 內部不一樣——規格要的是「不對稱橢圓島、左後兩層砂岩、底部三塊大岩面
 * 向下收尖」，六角格排不出那種輪廓。所以這裡改用自由多邊形：
 *
 *   上面一片平台 ＋ 往下往內收的裙邊
 *
 * 裙邊往內收就會形成「向下收尖」的岩體，不用做底面（從上方視角看不到）。
 * 一座島的所有層都合併成一個幾何，所以不論分幾層都只佔一個 draw call。
 */
import * as THREE from 'three';

/**
 * 多邊形的繞向。外框寫成順時針或逆時針都合理，但三角形的正面是由繞向決定的，
 * 繞反了整片就朝下，從上面看會整個消失（小徑就這樣不見過一次）。
 * 所以畫之前一律轉成同一個方向。
 */
function signedArea(points) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]; const b = points[(i + 1) % points.length];
    s += (b[0] - a[0]) * (b[1] + a[1]);
  }
  return s;
}
const faceUp = (points) => (signedArea(points) > 0 ? [...points].reverse() : points);

/** 多邊形的重心，裙邊往這裡收。 */
function centroid(points) {
  let x = 0, z = 0;
  for (const p of points) { x += p[0]; z += p[1]; }
  return [x / points.length, z / points.length];
}

/**
 * 一層地塊。
 * @param {Array<[number,number]>} outline 俯視的多邊形外框（順時針或逆時針都可以）
 * @param {object} o
 *   top       平台高度
 *   depth     往下的厚度
 *   inset     裙邊收進去的比例（0 = 直上直下，0.4 = 明顯收尖）
 *   topColor / sideColor
 *   rings     裙邊分幾段。多一段就多一圈折角，岩體看起來比較厚實
 */
export function layer(outline, {
  top = 0, depth = 0.9, inset = 0.3, topColor = '#f2dfae', sideColor = '#dcbd82', rings = 2,
} = {}) {
  outline = faceUp(outline);
  const [cx, cz] = centroid(outline);
  const pos = [];
  const col = [];
  const tc = new THREE.Color(topColor);
  const sc = new THREE.Color(sideColor);

  const push = (x, y, z, c) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); };

  // 頂面：從重心扇形切。島的外框都做成凸形或接近凸形，扇形切就夠用。
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    push(cx, top, cz, tc);
    push(b[0], top, b[1], tc);
    push(a[0], top, a[1], tc);
  }

  // 裙邊：一圈一圈往下往內收
  const ringAt = (t) => outline.map(([x, z]) => {
    const k = 1 - inset * t * t;                 // 平方讓收尖集中在下半段
    return [cx + (x - cx) * k, cz + (z - cz) * k, top - depth * t];
  });
  let prev = ringAt(0);
  for (let r = 1; r <= rings; r++) {
    const next = ringAt(r / rings);
    const shade = sc.clone().multiplyScalar(1 - 0.07 * r);
    for (let i = 0; i < outline.length; i++) {
      const j = (i + 1) % outline.length;
      const [ax, az, ay] = prev[i]; const [bx, bz, by] = prev[j];
      const [cx2, cz2, cy] = next[i]; const [dx, dz2, dy] = next[j];
      push(ax, ay, az, shade); push(cx2, cy, cz2, shade); push(dx, dy, dz2, shade);
      push(ax, ay, az, shade); push(dx, dy, dz2, shade); push(bx, by, bz, shade);
    }
    prev = next;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  geo.computeVertexNormals();
  return geo;
}

/** 一片平的多邊形（水面、地毯、廣場鋪面都用這個）。不做厚度，從上面看不出來。 */
export function slab(outline, { y = 0, color = '#4f9fc0' } = {}) {
  outline = faceUp(outline);
  const [cx, cz] = centroid(outline);
  const pos = [];
  const col = [];
  const c = new THREE.Color(color);
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    pos.push(cx, y, cz, b[0], y, b[1], a[0], y, a[1]);
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * 以多邊形外框產生一圈「縮放版」，用來做淺水邊、岸線或鋪面外框。
 * @param {number} k 1.2 = 外擴兩成，0.8 = 內縮兩成
 */
export const scaleOutline = (outline, k) => {
  const [cx, cz] = centroid(outline);
  return outline.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k]);
};

/** 把一條折線變成多邊形（給小徑、棧道用）：沿著路徑左右各推開 width/2。 */
export function ribbon(points, width = 0.6) {
  const left = []; const right = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const a = points[Math.max(i - 1, 0)];
    const b = points[Math.min(i + 1, points.length - 1)];
    const dx = b[0] - a[0]; const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len * width / 2; const nz = dx / len * width / 2;
    left.push([p[0] + nx, p[1] + nz]);
    right.push([p[0] - nx, p[1] - nz]);
  }
  return [...left, ...right.reverse()];
}

/** 橢圓外框，給島的基本形狀用。jitter 讓它不對稱，看起來像自然的島而不是一顆蛋。 */
export function blobOutline(rx, rz, segments = 16, jitter = 0.12, seed = 1) {
  let h = seed * 2654435761 >>> 0;
  const rand = () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 4294967296;
  };
  const out = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const k = 1 + (rand() - 0.5) * 2 * jitter;
    out.push([Math.cos(a) * rx * k, Math.sin(a) * rz * k]);
  }
  return out;
}

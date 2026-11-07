/**
 * 可走範圍：主角能站在哪裡。
 *
 * 群島是六角地塊拼出來的，所以判斷「這裡有沒有地」最準的做法就是直接問
 * 「這個座標落在哪一塊地塊上、那塊地塊存不存在」——不必像政策島那樣用
 * 一個大六角形去近似島的輪廓，因為我們的島本來就是一格一格記下來的。
 *
 * 兩種可站的地方：
 *   地塊  島上的六角格，往內縮一點，人不會走到懸崖最邊緣
 *   橋    兩座島之間的折線，有寬度，所以人走得過去也掉得下來
 *
 * 用的是「點在不在」而不是尋路——走路時每幀問一次就夠了，
 * 撞到不能走的地方就沿邊滑（slide），不需要先算出一條路。
 */

import { axialToWorld } from './hexGeometry.js';

const SQ3 = Math.sqrt(3);

// 接縫正好落在 d === R 上，而浮點會讓它差最後一位（0.8660254037844387 vs
// ...386），於是兩塊相鄰地塊中間出現一條走不過去的縫。給一點容差。
const EPS = 1e-9;

/**
 * 世界座標 → 軸座標（浮點，未取整）。
 *
 * 必須是 hexGeometry.axialToWorld 的反函數，所以那個公式長什麼樣這裡就要
 * 跟著長什麼樣——它是**平頂**六角（x = 1.5·size·q，z = √3·size·(r + q/2)），
 * 不是尖頂。第一版照尖頂寫，53 塊地有 34 塊的中心判定成「站不住」。
 * 正向轉換直接 import，不自己再寫一份。
 */
function worldToAxial(x, z, size) {
  const q = x / (1.5 * size);
  const r = z / (SQ3 * size) - q / 2;
  return { q, r };
}

/** 浮點軸座標取整。六角格不能直接 round，要先轉成立方座標再修正最大誤差的那一軸。 */
function roundAxial(q, r) {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

/** 點到線段的最短距離。 */
function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  const cx = ax + dx * t, cz = az + dz * t;
  return Math.hypot(px - cx, pz - cz);
}

/**
 * @param hexes    Set of "q,r"（世界軸座標）
 * @param bridges  折線陣列，每條是 [{x,z}, ...]
 * @param size     六角格大小
 * @param margin   懸崖邊的留白。只在「那一側沒有鄰居」時才內縮——
 *                 有鄰居的那一側是接縫，不能縮，否則兩塊地中間會有一條走不過去的縫。
 * @param bridgeHalf  橋面可走的半寬
 */
export function makeWalkable({ hexes, bridges = [], size = 1, margin = 0.2, bridgeHalf = 0.42 }) {
  const R = size * (SQ3 / 2);          // 內切圓半徑＝中心到邊中點
  const has = (q, r) => hexes.has(`${q},${r}`);

  // 六個邊的法向量：從中心指向該方向的鄰居。六角形就是這六個半平面的交集，
  // 所以「點在不在格子裡」＝六個方向的投影都不超過 R。
  const NORMALS = NEIGHBOURS.map(([dq, dr]) => {
    const n = axialToWorld(dq, dr, 1);
    const len = Math.hypot(n.x, n.z);
    return { x: n.x / len, z: n.z / len };
  });

  /**
   * 這個座標站得住嗎？
   *
   * 第一版用「離格子中心夠近」當判準，結果兩塊相鄰地塊中間的接縫被判成
   * 站不住——接縫正好在內切圓上（0.866·size），而內縮之後的半徑只有
   * 0.693·size，兩邊都排斥它。53 塊地裡只有 12 條接縫走得過去。
   *
   * 正確的模型是逐邊判斷：六個方向分別看，只有「那一側沒有鄰居」才需要
   * 留白——那是真的懸崖；有鄰居的那一側是連續的地面，一寸都不能縮。
   */
  function canStand(x, z) {
    const a = worldToAxial(x, z, size);
    const { q, r } = roundAxial(a.q, a.r);
    if (has(q, r)) {
      const c = axialToWorld(q, r, size);
      const px = x - c.x, pz = z - c.z;
      let inside = true;
      for (let i = 0; i < 6; i++) {
        const [dq, dr] = NEIGHBOURS[i];
        const d = px * NORMALS[i].x + pz * NORMALS[i].z;
        const edge = has(q + dq, r + dr) ? R : R - margin;
        if (d > edge + EPS) { inside = false; break; }
      }
      if (inside) return true;
    }
    return onBridge(x, z);
  }

  /** 在橋上嗎？ */
  function onBridge(x, z) {
    for (const line of bridges) {
      for (let i = 0; i < line.length - 1; i++) {
        if (distToSegment(x, z, line[i].x, line[i].z, line[i + 1].x, line[i + 1].z) <= bridgeHalf) return true;
      }
    }
    return false;
  }

  /**
   * 從 (x,z) 往 (nx,nz) 走，回傳實際能走到的位置。
   *
   * 擋住的時候不是停下來，而是沿著擋住的方向滑——貼著島緣走的時候，
   * 「停住」會讓人覺得卡住了，「滑過去」才像真的在走路。
   * 分別試 x 與 z 兩軸，哪一軸通就走哪一軸。
   */
  function move(x, z, nx, nz) {
    if (canStand(nx, nz)) return { x: nx, z: nz };
    if (canStand(nx, z)) return { x: nx, z };
    if (canStand(x, nz)) return { x, z: nz };
    return { x, z };
  }

  /** 離 (x,z) 最近、站得住的地方。用在出生點或被擠出界的時候。 */
  function nearestStand(x, z, radius = 6) {
    if (canStand(x, z)) return { x, z };
    for (let step = 0.25; step <= radius; step += 0.25) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const px = x + Math.cos(a) * step, pz = z + Math.sin(a) * step;
        if (canStand(px, pz)) return { x: px, z: pz };
      }
    }
    return null;
  }

  return { canStand, onBridge, move, nearestStand };
}

// 平頂六角的六個鄰居。不是憑印象寫的——是拿 axialToWorld 量出來的：
// 這六個偏移到中心的距離都是 √3·size，其餘最近的也有 3·size。
const NEIGHBOURS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

/**
 * 步道與路徑跟隨。
 *
 * 舊版的島民是「以原地為中心的三角函數擺盪」：
 *
 *     const sweep = Math.sin(p) * a.range;        // 沿軸來回滑
 *     e.y = a.rot + (Math.cos(p) >= 0 ? 0 : PI);  // 中點瞬間翻 180°
 *
 * 三個不自然同時來自這兩行：沒有真正的路徑、轉身用跳的、而且 sin() 讓角色
 * 在兩端慢到停住、中間最快，看起來是在滑冰而不是走路。
 *
 * 這裡改成路徑是一等資料：先定義一條折線，角色沿著**弧長**等速前進，
 * 朝向直接取路徑切線。於是「人走的路」和「看得到的路」是同一條，
 * 轉彎會自然地轉，速度從頭到尾一致。
 *
 * 路徑只在世界重建時算一次並快取——每幀只做一次二分搜尋與一次內插。
 */

/**
 * 把一串控制點變成可取樣的路徑。
 *
 * @param pts   [{x,y,z}]，至少兩點
 * @param loop  true 時頭尾相接，角色會一直繞；false 則走到底折返
 */
export function makeRoute(pts, { loop = true, smooth = true } = {}) {
  let p = pts.map((q) => ({ x: q.x, y: q.y, z: q.z }));
  if (loop && p.length > 2) p = [...p, p[0]];
  if (smooth && p.length > 2) p = chaikin(p, loop ? 2 : 1);

  const lens = [0];
  let total = 0;
  for (let i = 1; i < p.length; i++) {
    total += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y, p[i].z - p[i - 1].z);
    lens.push(total);
  }
  return { pts: p, lens, total, loop };
}

/**
 * 轉角切圓角。
 *
 * 折線直接走會在每個控制點硬轉一個角，角色看起來像機器人。Chaikin 每跑一輪
 * 就把每段切成 1/4 與 3/4 兩點，角會被削掉，兩輪之後就夠圓滑了。
 * 比 Catmull-Rom 便宜，而且不會像樣條那樣甩出路面。
 */
function chaikin(p, rounds) {
  for (let r = 0; r < rounds; r++) {
    const out = [];
    const n = p.length;
    if (!out.length) out.push(p[0]);
    for (let i = 0; i < n - 1; i++) {
      const a = p[i], b = p[i + 1];
      out.push(
        { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25, z: a.z * 0.75 + b.z * 0.25 },
        { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75, z: a.z * 0.25 + b.z * 0.75 },
      );
    }
    out.push(p[n - 1]);
    p = out;
  }
  return p;
}

/**
 * 取樣：給一個弧長 s，回傳那個位置與前進方向。
 *
 * 用弧長而不是用「第幾段的 t」是重點——後者在長短不一的段落之間會忽快忽慢。
 * 回傳的 dir 已正規化且壓平 y，角色只繞 Y 軸轉，不會因為上下坡而前傾後仰。
 */
export function sampleRoute(route, s) {
  const { pts, lens, total, loop } = route;
  if (total < 1e-6) return { x: pts[0].x, y: pts[0].y, z: pts[0].z, heading: 0 };

  // loop 直接取模；非 loop 用三角波折返，走到底會轉頭走回來
  let d = loop ? ((s % total) + total) % total : triangle(s, total);

  // 二分搜尋落在哪一段
  let lo = 0, hi = lens.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (lens[mid] <= d) lo = mid; else hi = mid;
  }
  const a = pts[lo], b = pts[hi];
  const seg = lens[hi] - lens[lo] || 1;
  const t = Math.min(1, Math.max(0, (d - lens[lo]) / seg));

  let dx = b.x - a.x, dz = b.z - a.z;
  // 折返段要反向，否則走回程時會倒退著走
  if (!loop && isReturning(s, total)) { dx = -dx; dz = -dz; }
  const m = Math.hypot(dx, dz) || 1;

  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    heading: Math.atan2(dx / m, dz / m),
  };
}

/** 三角波：0→total→0，用來做折返。 */
function triangle(s, total) {
  const span = total * 2;
  const u = ((s % span) + span) % span;
  return u <= total ? u : span - u;
}
const isReturning = (s, total) => {
  const span = total * 2;
  return (((s % span) + span) % span) > total;
};

/**
 * 環島步道。
 *
 * 沿六角島的內圈佈一圈點。半徑取 INNER 與邊界之間，角色才不會穿牆也不會
 * 走在半空中。jitter 讓每座島的步道略有差異，避免看起來是複製貼上。
 */
export function ringRoute(centre, radius, y, { points = 12, jitter = 0.06, seed = 0 } = {}) {
  const pts = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    // 確定性抖動：同一座島每次重建都長一樣，不會每次 reload 就換一條路
    const n = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    const r = radius * (1 + ((n - Math.floor(n)) - 0.5) * jitter * 2);
    pts.push({ x: centre.x + Math.cos(a) * r, y, z: centre.z + Math.sin(a) * r });
  }
  return makeRoute(pts, { loop: true });
}

/**
 * 兩點之間的步道，中間拉一個弧。
 *
 * 直線連兩座島會從水面上切過去，看起來像在水上飄。給一點側向偏移並抬高
 * 中段，讀起來就像一座橋或一條繞過去的小路。
 */
export function linkRoute(from, to, { lift = 0.05, bow = 0.25 } = {}) {
  const mx = (from.x + to.x) / 2, mz = (from.z + to.z) / 2;
  const dx = to.x - from.x, dz = to.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  // 法線方向偏移，讓中段鼓出去
  const nx = -dz / len, nz = dx / len;
  return makeRoute([
    from,
    { x: mx + nx * len * bow, y: Math.max(from.y, to.y) + lift, z: mz + nz * len * bow },
    to,
  ], { loop: false });
}

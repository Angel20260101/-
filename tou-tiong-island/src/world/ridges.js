/**
 * 遠景稜線。
 *
 * 群島以外原本是一片空的——海是一塊有限的圓盤，再外面就直接是 CSS 天空漸層，
 * 所以鏡頭一拉遠，畫面就只剩兩塊色。這裡補上遠方的山。
 *
 * 做法參考 puma.taipei 的 HEART 政策島，而它便宜得出乎意料：
 * 每一層就是一圈「垂直布幕」——沿著一個橢圓鋪 N 段，每段兩個頂點（底在水面下、
 * 頂在噪聲決定的高度）。三層加起來約 1,300 個三角形、3 個 draw call。
 * 那個傳說中的 90 萬三角形是他們的山坡森林，不是稜線。
 *
 * 三個關鍵材質設定：
 *   MeshBasicMaterial  不吃光。遠山是剪影，給它打光只會讓它跟近景搶注意力。
 *   fog: false         不吃霧。朦朧感由「往地平線色混多少」決定，不是由霧距離決定，
 *                      否則鏡頭一拉遠整排山會一起消失。
 *   renderOrder: -5    畫在所有東西後面。
 *
 * 愈遠的層：愈高、愈往地平線色混（tint 愈大），所以自然產生空氣透視。
 */
import * as THREE from 'three';

/**
 * 三層的參數：[半徑, 最低高度, 最高高度, 噪聲種子, 朦朧度]
 *
 * 半徑相對於群島的尺度。群島約 20 單位寬、相機最遠 72，所以最外層 68
 * 剛好在拉到最遠時仍然在視野裡、又不會穿進近景。
 */
const LAYERS = [
  [26, 2.2, 4.6, 3, 0.26],
  [34, 3.0, 6.4, 9, 0.50],
  [44, 3.8, 8.2, 17, 0.74],
];

/**
 * 近→遠的基底色：苔綠 → 灰藍 → 淡藍。
 * 跟著 PALETTE 的暖調走，不照抄 puma 的色（那是他們的品牌）。
 */
const BASE = [0x6f8f72, 0x8ca3a4, 0xadc0c4];

/** 每段的細分數。220 段在最遠處仍然看不出是折線，再多只是浪費。 */
const SEGMENTS = 220;

/** 以整數為種子的 1D 值噪聲，線性內插。不需要 simplex——遠山不會被看那麼細。 */
function valueNoise(seed) {
  const hash = (n) => {
    let h = Math.imul(n ^ seed, 0x27d4eb2d);
    h ^= h >>> 15;
    return ((h >>> 0) % 10000) / 10000;
  };
  return (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const s = f * f * (3 - 2 * f);            // 平滑內插，避免折角
    return hash(i) * (1 - s) + hash(i + 1) * s;
  };
}

/** 疊三個頻率的噪聲：大起伏 + 中等山形 + 細碎峰頂。 */
function fbm(noise, x) {
  return noise(x) * 0.55 + noise(x * 2.3) * 0.3 + noise(x * 5.1) * 0.15;
}

/**
 * 建立三層稜線並加進場景。
 *
 * @returns {{ layers: Array, setHorizon: (hex:string, k:number) => void, dispose: () => void }}
 *   setHorizon 讓天氣系統每幀把山色往當下的地平線色靠。
 */
export function createRidges(scene, { cx = 0, cz = 0, horizon = '#f3e8cf' } = {}) {
  const layers = [];

  LAYERS.forEach(([rad, hmin, hmax, seed, tint], i) => {
    const noise = valueNoise(seed);
    const pos = [];
    const idx = [];
    for (let k = 0; k <= SEGMENTS; k++) {
      const a = (k / SEGMENTS) * Math.PI * 2;
      // 噪聲沿著角度取樣，而且頭尾要接得起來，所以用 cos/sin 當輸入而不是 k 本身
      const n = fbm(noise, Math.cos(a) * 3 + seed);
      // 第二組噪聲取絕對值再開根，造出尖一點的峰頂；只用 fbm 會太圓、像丘陵
      const peak = Math.pow(Math.abs(noise(Math.sin(a) * 9 + seed) * 2 - 1), 0.7);
      const h = hmin + (hmax - hmin) * (0.55 * n + 0.45 * peak);
      const x = cx + Math.cos(a) * rad;
      // Z 方向壓扁一點，正圓看起來會像一個碗
      const z = cz + Math.sin(a) * rad * 0.92;
      pos.push(x, -3, z, x, h, z);
      if (k < SEGMENTS) {
        const b = k * 2;
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      color: BASE[i], fog: false, side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -5;
    mesh.frustumCulled = false;
    scene.add(mesh);
    layers.push({ mesh, mat, tint, base: new THREE.Color(BASE[i]) });
  });

  /* ── 稜線上的森林 ───────────────────────────────────────
   *
   * 這一段不是裝飾，是辨識度本身。
   *
   * 只有布幕的話，從這個俯角看下去就是幾條平的色弧——因為相機永遠在稜線上方，
   * 看到的是它的內側，沒有任何高低起伏的線索。灑上樹之後，每一棵都在色弧上
   * 切出一個小剪影，輪廓線變得破碎，大腦才讀得出「那是有植被的地形」。
   * puma 那 90 萬三角形的山坡森林做的就是這件事。
   *
   * 成本控制：一個 InstancedMesh、一種錐體幾何、不吃光不吃霧，跟布幕同一層。
   * 只長在最內圈（看得最清楚的那一層），外兩層靠混色交代就夠。
   */
  const TREES = 260;
  const treeGeo = new THREE.ConeGeometry(1, 2.4, 5);
  treeGeo.translate(0, 1.2, 0);          // 底部對齊原點，方便直接擺在稜線高度上
  const treeMat = new THREE.MeshBasicMaterial({ color: 0x55735c, fog: false, depthWrite: false });
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, TREES);
  trees.renderOrder = -4;                // 在布幕之上、其餘一切之下
  trees.frustumCulled = false;
  {
    const [rad, hmin, hmax, seed] = LAYERS[0];
    const noise = valueNoise(seed);
    const jit = valueNoise(seed + 101);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    for (let k = 0; k < TREES; k++) {
      const a = (k / TREES) * Math.PI * 2;
      const n = fbm(noise, Math.cos(a) * 3 + seed);
      const peak = Math.pow(Math.abs(noise(Math.sin(a) * 9 + seed) * 2 - 1), 0.7);
      const h = hmin + (hmax - hmin) * (0.55 * n + 0.45 * peak);
      // 往內外各散一點，樹才不會排成一條完美的線
      const r = rad + (jit(k * 1.7) - 0.5) * 2.6;
      const s = 0.5 + jit(k * 0.9) * 0.7;
      v.set(cx + Math.cos(a) * r, h - 0.6, cz + Math.sin(a) * r * 0.92);
      sc.set(s, s * (0.8 + jit(k * 2.3) * 0.6), s);
      trees.setMatrixAt(k, m.compose(v, q, sc));
    }
    trees.instanceMatrix.needsUpdate = true;
  }
  scene.add(trees);

  const tmp = new THREE.Color();
  /**
   * 把山色往地平線色靠。
   * @param k 額外的混合倍率（0 = 完全是基底色，1 = 照 tint 混）。
   */
  const treeBase = new THREE.Color(0x55735c);
  const setHorizon = (hex, k = 1) => {
    tmp.set(hex);
    for (const L of layers) L.mat.color.copy(L.base).lerp(tmp, L.tint * 0.75 * k);
    // 森林混得比最內圈布幕少一點，才會在那層色弧上浮出來
    treeMat.color.copy(treeBase).lerp(tmp, layers[0].tint * 0.5 * k);
  };
  setHorizon(horizon);

  return {
    layers,
    setHorizon,
    setVisible: (v) => { trees.visible = v; for (const L of layers) L.mesh.visible = v; },
    dispose: () => {
      scene.remove(trees);
      treeGeo.dispose();
      treeMat.dispose();
      for (const L of layers) {
        scene.remove(L.mesh);
        L.mesh.geometry.dispose();
        L.mat.dispose();
      }
      layers.length = 0;
    },
  };
}

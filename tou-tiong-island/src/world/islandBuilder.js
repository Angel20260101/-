/**
 * 依據 content/island_map.json 與玩家進度，產生整座群島的幾何資料。
 *
 * 產出的是「資料」而不是場景物件：地形各自一份合併幾何，道具則收成
 * { type -> matrix[] }，交給 sceneManager 變成 InstancedMesh。
 * 島嶼解鎖或長出新地景時整個重建一次——群島規模小，重建比增量更新單純可靠。
 */
import * as THREE from 'three';
import { buildTerrainGeometry, axialToWorld, hexTopPosition } from './hexGeometry.js';
import { SPECIES, SPECIES_BY_ZH } from './species.js';

/** 以字串為種子的亂數：同一座島每次重建長出來的草木位置都一樣。 */
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const matrixOf = (x, y, z, rotY = 0, scale = 1) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
    new THREE.Vector3(scale, scale, scale),
  );

/**
 * @param {object} map       content/island_map.json
 * @param {object} progress  { [island_id]: { unlocked, name, routes: string[] } }
 * @param {object} wish      { count: number, board: content/wish_board.json }
 */
export function buildWorld(map, progress = {}, wish = {}, residentData = null) {
  const cfg = map.hex;
  const islands = [];
  const props = new Map();   // type -> Matrix4[]（靜態道具）
  const animals = [];        // 會動的島民，交給 sceneManager 逐幀更新
  const boats = [];          // 停在願望島的小船，會隨海浪上下
  const residents = [];      // 動物居民：每島 10 隻，照美術文件的配置表
  const addProp = (type, matrix) => {
    if (!props.has(type)) props.set(type, []);
    props.get(type).push(matrix);
  };

  const placeLandmarks = (landmarks, hexes, origin) => {
    for (const lm of landmarks ?? []) {
      const hex = hexes.find((h) => h.q === lm.hex[0] && h.r === lm.hex[1]);
      if (!hex) continue;
      const base = hexTopPosition(hex, cfg, origin);
      const [dx, dz] = lm.offset ?? [0, 0];
      addProp(lm.type, matrixOf(base.x + dx, base.y, base.z + dz, lm.rot ?? 0, lm.scale ?? 1));
    }
  };

  /**
   * 佔位半徑。散佈時用「兩者半徑相加」判斷太不太近，所以大東西讓得多、
   * 小東西可以擠在一起——地面細節本來就該密。
   */
  const R = { landmark: 0.40, flora: 0.26, clutter: 0.085 };
  const clashes = (occupied, x, z, r) =>
    occupied.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < (p.r + r) ** 2);

  /** @param density 1 = 照密度表；未破關的島用 0.5，有輪廓但比較冷清 */
  const scatterFlora = (hexes, origin, floraKind, seedKey, occupied, density = 1) => {
    const rand = seeded(seedKey);
    for (const hex of hexes) {
      const kind = hex.flora ?? 'none';
      const count = Math.round((map.flora_density[kind] ?? 0) * density);
      if (!count) continue;
      const kinds = map.flora_table[floraKind]?.[kind] ?? [];
      if (!kinds.length) continue;
      const base = hexTopPosition(hex, cfg, origin);
      for (let i = 0; i < count; i++) {
        const angle = rand() * Math.PI * 2;
        const radius = 0.18 + rand() * 0.6;
        const x = base.x + Math.cos(angle) * radius;
        const z = base.z + Math.sin(angle) * radius;
        if (clashes(occupied, x, z, R.flora)) continue;
        const type = kinds[Math.floor(rand() * kinds.length)];
        addProp(type, matrixOf(x, base.y, z, rand() * Math.PI * 2, 0.8 + rand() * 0.45));
        // 樹也要彼此讓開，不然同一格裡會長成一叢分不開的團塊
        occupied.push({ x, z, r: R.flora });
      }
    }
  };

  /**
   * 地面細節：石子、三葉草、小花、蘑菇、貝殼、漂流木。
   *
   * 鏡頭可以拉到看得見單一棵樹的距離，草地與沙灘不能是一整片空的色塊。
   * 這一道照 hex 的 surface 鋪，所以連 flora 設成 none 的空地也有東西看。
   * 跟著同一組種子亂數，位置每次重建都一樣。
   */
  const scatterClutter = (hexes, origin, seedKey, occupied) => {
    const table = map.ground_clutter;
    if (!table) return;
    const rand = seeded(seedKey);
    for (const hex of hexes) {
      const spec = table[hex.surface];
      if (!spec?.count || !spec.types?.length) continue;
      const base = hexTopPosition(hex, cfg, origin);
      // 亂丟點會越丟越容易撞到已經放好的東西，丟 count 次大概只會成功一半。
      // 所以「嘗試次數」要和「目標數量」分開：最多丟三倍，放滿就停。
      let placed = 0;
      for (let i = 0; i < spec.count * 3 && placed < spec.count; i++) {
        const angle = rand() * Math.PI * 2;
        const radius = 0.1 + rand() * 0.72;
        const x = base.x + Math.cos(angle) * radius;
        const z = base.z + Math.sin(angle) * radius;
        if (clashes(occupied, x, z, R.clutter)) continue;
        const type = spec.types[Math.floor(rand() * spec.types.length)];
        addProp(type, matrixOf(x, base.y, z, rand() * Math.PI * 2, 0.75 + rand() * 0.5));
        occupied.push({ x, z, r: R.clutter });
        placed += 1;
      }
    }
  };

  /** 島民：只記下世界座標與行為參數，動畫由 sceneManager 負責。 */
  const placeAnimals = (list, hexes, origin, islandCenter) => {
    for (const a of list ?? []) {
      const hex = hexes.find((h) => h.q === a.hex[0] && h.r === a.hex[1]);
      if (!hex) continue;
      const base = hexTopPosition(hex, cfg, origin);
      const [dx, dz] = a.offset ?? [0, 0];
      const form = (src, fallback = {}) => ({
        type: src.type ?? fallback.type,
        behaviour: src.behaviour ?? fallback.behaviour ?? 'breathe',
        axis: src.axis ?? fallback.axis ?? 'x',
        range: src.range ?? fallback.range ?? 0.5,
        radius: src.radius ?? fallback.radius ?? 2,
        height: src.height ?? fallback.height ?? 2.2,
        speed: src.speed ?? fallback.speed ?? 0.6,
        hidden: src.hidden ?? false,
      });
      const def = form(a);
      animals.push({
        base: { x: base.x + dx, y: base.y, z: base.z + dz },
        centre: islandCenter,
        rot: a.rot ?? 0,
        phase: Math.random() * Math.PI * 2,
        // 天氣是玩家決定的，島民照著天氣換事情做
        forms: { default: def, rainy: a.rainy ? form(a.rainy, def) : def },
      });
    }
  };

  /**
   * 島與島之間的步道。
   *
   * 走的路線不是我發明的——每座故事島的 sea_route_from_home 本來就已經
   * 標好了兩個海上航點，過去只拿來擺踏腳石。這裡沿同一條折線鋪木橋，
   * 所以「看得到的橋」與「資料上的航線」永遠是同一條，不會各走各的。
   *
   * 兩端各退一個島半徑，橋才會從岸邊開始、不會插進島裡。
   */
  const BRIDGE_SPAN = 2.0;      // rope_bridge 的幾何跨距，沿 X 軸
  const placeBridge = (points, { trimFrom = 2.0, trimTo = 1.5 } = {}) => {
    // 把折線切成等長段，每段放一座橋
    for (let i = 0; i < points.length - 1; i++) {
      let [ax, az] = points[i];
      let [bx, bz] = points[i + 1];
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const ux = dx / len, uz = dz / len;
      // 第一段從起點島的岸邊開始，最後一段到終點島的岸邊為止
      const start = i === 0 ? trimFrom : 0;
      const end = i === points.length - 2 ? len - trimTo : len;
      const usable = end - start;
      if (usable < 0.4) continue;
      const n = Math.max(1, Math.round(usable / BRIDGE_SPAN));
      const step = usable / n;
      // rope_bridge 沿 +X 鋪。繞 Y 轉 rotY 後，X 軸會指向 (cos, -sin)，
      // 所以要讓它對齊 (ux, uz)，rotY = atan2(-uz, ux)。
      const rotY = Math.atan2(-uz, ux);
      for (let k = 0; k < n; k++) {
        const t = start + step * (k + 0.5);
        addProp('rope_bridge', matrixOf(ax + ux * t, -0.08, az + uz * t, rotY, step / BRIDGE_SPAN));
      }
    }
  };

/**
 * 從原文推導巡迴路線的形狀。
 *
 * 文件寫的是「沿三槽慢走」「由出餐檯走到固定桌，再返程」「沿兩個停靠點走動」
 * 「跳兩段短路線」——每一條都隱含了停靠點數與距離。這裡把那些描述轉成
 * { stops, span, curved }，跟動作一樣直接吃原文，不另外維護對照表。
 *
 * 場景元素（出餐檯、三個種植槽）還沒建，所以停靠點的實際座標先用居民
 * 自己位置附近的等分點。等場景建好，換成讀真正的座標就行，形狀不用改。
 */
const ROUTE_RULES = [
  // 明確講了三個點的
  [/三槽|三個涉水點|三個|三段/, { stops: 3, span: 0.95 }],
  // 枝架之間的短跳（松鼠、貓頭鷹）：距離很短，而且不該跨過主要道路
  [/短跳|跳兩段/, { stops: 2, span: 0.42 }],
  // 兩個定點之間
  [/兩個[^，。]*間|兩停靠點|兩個停靠點|兩枝架|兩個平坦岩台/, { stops: 2, span: 0.85 }],
  // 由 A 到 B 再回來——文件裡最常見的一類（送托盤、搬箱、推車）
  [/由[^，。]*到|從[^，。]*送到|返程|返回|再回|走回|轉身回/, { stops: 2, span: 1.0 }],
  // 沿著某個邊緣走：外圈、水路、圍欄、田埂、步道
  [/沿[^，。]*(外圈|外緣|水路|水段|圍欄|田埂|步道|石路|低坡|彎路|圓弧|S形)/, { stops: 4, span: 1.3, curved: true }],
  // 其餘的「沿…走」：沿槽、沿架前、沿窗台
  [/沿[^，。]*(緩走|慢走|慢行|緩行|走動|巡看|慢游|划行|前走)/, { stops: 3, span: 0.9, curved: true }],
  // 只走幾步
  [/走兩步|走至|走到/, { stops: 2, span: 0.5 }],
];
/** 推不出來就給一段很短的往返——總比讓牠在原地滑動好。 */
function routeSpecFromLoop(text) {
  for (const [re, spec] of ROUTE_RULES) if (re.test(text)) return spec;
  return { stops: 2, span: 0.55 };
}

/**
 * 從美術文件的中文描述推導動作。
 *
 * 文件的「日常動作與路線」是給人看的散文，不是列舉型別。與其另外維護一份
 * 對照表（一定會跟文件走鐘），不如用關鍵字直接從原文推——文件改了，行為跟著改。
 * 推不出來就回 idle，不會是錯的，只是比較安靜。
 */
const ACTIVITY_KEYWORDS = [
  [/舉杯|喝水|喝|啜|保溫杯/, 'sip'],
  [/翻書|翻頁|看書|閱讀|讀地圖/, 'read'],
  [/澆水|傾壺|水壺/, 'water'],
  [/搬|送|推車|推小|運|托盤|郵袋|包裹|箱/, 'carry'],
  [/洗|擦拭|擦乾|梳理/, 'wash'],
  [/揉陶|壓陶|織|挑揀|挑色|分類|整理|修理|工作|鋤|曬/, 'work'],
  [/泡腳|泡湯|足湯|浸/, 'soak'],
  [/曬背|伏下|趴/, 'bask'],
  [/划行|游|水路/, 'paddle'],
  [/涉水|單腳站立/, 'wade'],
  [/棲|轉頭|看時鐘|觀察|看景|看水|看遠方|看風向/, 'perch'],
  [/小跳|跳兩段|跳/, 'hop'],
  [/走|巡|散步|來回|移動|前進|繞/, 'walk'],
  [/坐|躺|休息|曬太陽/, 'sit'],
];
function activityFromLoop(text, rig) {
  for (const [re, act] of ACTIVITY_KEYWORDS) if (re.test(text)) return act;
  return rig === 'bird' ? 'perch' : rig === 'pinniped' ? 'bask' : 'idle';
}

/** 手持物也從原文推。沒提到就空手——文件說「居民動作各對應一件可見道具」，但不是每一隻都有。 */
const HELD_KEYWORDS = [
  [/托盤/, 'tray'], [/郵袋|包裹/, 'mail'], [/箱/, 'box'], [/籃/, 'basket'],
  [/水壺|澆/, 'can'], [/杯|壺/, 'cup'], [/書|地圖/, 'book'],
  [/工具|鋤|鏟|推車/, 'tool'],
];
function heldFromLoop(text) {
  for (const [re, id] of HELD_KEYWORDS) if (re.test(text)) return id;
  return 'none';
}

  /**
   * 島民配置。
   *
   * 美術文件給的「固定位置」是描述性的（「前景 咖啡桌」「中景 池畔」），
   * 而那些場景元素還沒建——六座島的完整場景排在凍結後。所以這一階段用
   * 演算法配置，只保住文件真正在意的那件事：**前後景的層次**。
   *
   *   01–03 前景重點互動居民 → 放在最靠鏡頭的那一排，彼此拉開
   *   04–10 中後景生活居民   → 散佈到其餘地塊
   *
   * 等場景建好之後，這裡換成讀座標就行，資料結構不用動。
   */
  const placeResidents = (islandId, hexes, origin, list, occupied) => {
    if (!list?.length) return;
    const rand = seeded(`${islandId}-residents`);
    // 鏡頭從 +z 方向俯看，所以 z 大的是前景
    const spots = hexes.map((h) => ({ h, p: hexTopPosition(h, cfg, origin) }))
      .sort((a, b) => b.p.z - a.p.z);

    list.forEach((r, i) => {
      const front = r.no <= 3;
      // 前景三隻擠在最前面那一兩格，中後景平均散到其餘格
      const spot = front
        ? spots[i % Math.min(2, spots.length)]
        : spots[(i - 3) % spots.length];
      const base = spot.p;

      // 在格子裡找一個不撞到地標與樹的位置。找不到就退而求其次放在偏移處——
      // 少一隻居民比把牠塞進樹裡糟。
      let x = base.x, z = base.z;
      for (let k = 0; k < 14; k++) {
        const a = rand() * Math.PI * 2;
        const rad = (front ? 0.2 : 0.25) + rand() * 0.45;
        const cx = base.x + Math.cos(a) * rad;
        const cz = base.z + Math.sin(a) * rad;
        if (!clashes(occupied, cx, cz, 0.16)) { x = cx; z = cz; break; }
        if (k === 13) { x = base.x + Math.cos(a) * rad; z = base.z + Math.sin(a) * rad; }
      }
      occupied.push({ x, z, r: 0.16 });

      const species = SPECIES_BY_ZH[r.animal];
      if (!species) return;                        // 資料寫錯時安靜跳過，不要整座島爆掉
      const rig = SPECIES[species]?.rig ?? 'quad';
      let activity = activityFromLoop(r.loop, rig);
      // 兔子的「走」在文件裡明確是小跳，不是一般步行
      if (species === 'rabbit' && activity === 'walk') activity = 'hop';

      residents.push({
        island_id: islandId,
        no: r.no,
        front,
        species,
        activity,
        held: heldFromLoop(r.loop),
        greet: r.greet,
        spot: r.spot,
        route: routeSpecFromLoop(r.loop),
        base: { x, y: base.y, z },
        // 面向大致朝鏡頭，前景的更正對一點，中後景隨機一些才不會像列隊
        rot: front ? (rand() - 0.5) * 0.9 : rand() * Math.PI * 2,
        phase: rand() * 12,
        speed: 0.28 + rand() * 0.16,
      });
    });
  };

  const occupiedOf = (landmarks, hexes, origin) =>
    (landmarks ?? []).flatMap((lm) => {
      const hex = hexes.find((h) => h.q === lm.hex[0] && h.r === lm.hex[1]);
      if (!hex) return [];
      const base = hexTopPosition(hex, cfg, origin);
      const [dx, dz] = lm.offset ?? [0, 0];
      return [{ x: base.x + dx, z: base.z + dz, r: R.landmark }];
    });

  // ── 透中島（主島，永遠存在） ─────────────────────────────
  {
    const home = map.home;
    const origin = home.origin;
    const hexes = home.hexes.map((h) => ({ ...h, q: h.q + origin.q, r: h.r + origin.r }));
    const { geometry, bounds } = buildTerrainGeometry(hexes, cfg);
    const landmarks = home.landmarks;
    placeLandmarks(landmarks, home.hexes, origin);
    const homeOccupied = occupiedOf(landmarks, home.hexes, origin);
    scatterFlora(home.hexes, origin, home.flora, `${home.island_id}-flora`, homeOccupied);
    scatterClutter(home.hexes, origin, `${home.island_id}-clutter`, homeOccupied);

    const anchors = {};
    for (const lm of landmarks) {
      if (!lm.interaction) continue;
      const hex = home.hexes.find((h) => h.q === lm.hex[0] && h.r === lm.hex[1]);
      const base = hexTopPosition(hex, cfg, origin);
      const [dx, dz] = lm.offset ?? [0, 0];
      anchors[lm.interaction] = { x: base.x + dx, y: base.y + 0.5, z: base.z + dz, label: lm.label };
    }

    const homeCentre = axialToWorld(origin.q, origin.r, cfg.size);
    placeAnimals(home.animals, home.hexes, origin, homeCentre);

    islands.push({
      island_id: home.island_id,
      kind: 'home',
      sky_anchor: home.sky_anchor ?? null,
      name: home.name,
      tagline: home.tagline,
      geometry,
      bounds,
      anchors,
      interactions: home.interactions,
      unlocked: true,
      growthCount: 0,
      growthTotal: 0,
    });
  }

  // ── 時光郵局島 ───────────────────────────────────────────
  // E5 原本只是本島上的一個郵筒。獨立成一座中型島，是為了讓地圖上的
  // 三個常駐去處（許願、寫信、求助）在尺度上各有份量，而不是全部擠在本島。
  if (map.post_island) {
    const pi = map.post_island;
    const origin = pi.origin;
    const hexes = pi.hexes.map((h) => ({ ...h, q: h.q + origin.q, r: h.r + origin.r }));
    const { geometry, bounds } = buildTerrainGeometry(hexes, cfg);
    placeLandmarks(pi.landmarks, pi.hexes, origin);
    const occupied = occupiedOf(pi.landmarks, pi.hexes, origin);
    scatterFlora(pi.hexes, origin, pi.flora, `${pi.island_id}-flora`, occupied);
    scatterClutter(pi.hexes, origin, `${pi.island_id}-clutter`, occupied);
    const centre = axialToWorld(origin.q, origin.r, cfg.size);
    placeAnimals(pi.animals, pi.hexes, origin, centre);

    const sign = (pi.landmarks ?? []).find((lm) => lm.interaction);
    const anchors = {};
    if (sign) {
      const hex = pi.hexes.find((h) => h.q === sign.hex[0] && h.r === sign.hex[1]);
      const base = hexTopPosition(hex, cfg, origin);
      const [dx, dz] = sign.offset ?? [0, 0];
      anchors[sign.interaction] = { x: base.x + dx, y: base.y + 0.5, z: base.z + dz, label: sign.label };
    }

    islands.push({
      island_id: pi.island_id,
      kind: 'post',
      name: pi.name,
      tagline: pi.tagline,
      geometry, bounds, anchors,
      interaction: sign?.interaction ?? null,
      unlocked: true,
      growthCount: 0,
      growthTotal: 0,
    });
  }

  // ── 願望島 ───────────────────────────────────────────────
  // 碼頭放出的每一艘小船都停在這裡；公司回應一個主題，島上就長出一棵樹。
  // 玩家自己寫的願望原文從來不會離開這台裝置，這裡呈現的只有「船的數量」與公司的回應。
  if (map.wish_island) {
    const w = map.wish_island;
    const origin = w.origin;
    const hexes = w.hexes.map((h) => ({ ...h, q: h.q + origin.q, r: h.r + origin.r }));
    const { geometry, bounds } = buildTerrainGeometry(hexes, cfg);
    placeLandmarks(w.landmarks, w.hexes, origin);

    const statusOf = new Map((wish.board?.themes ?? []).map((t) => [t.theme, t.status]));
    const growthOf = new Map((wish.board?.statuses ?? []).map((s2) => [s2.status_id, s2.growth]));
    const occupied = occupiedOf(w.landmarks, w.hexes, origin);
    let trees = 0;
    for (const slot of w.tree_slots ?? []) {
      const growth = growthOf.get(statusOf.get(slot.theme)) ?? 'none';
      if (growth === 'none') continue;
      const hex = w.hexes.find((h) => h.q === slot.hex[0] && h.r === slot.hex[1]);
      if (!hex) continue;
      const base = hexTopPosition(hex, cfg, origin);
      const [dx, dz] = slot.offset ?? [0, 0];
      addProp(growth === 'tree' ? 'wish_tree' : 'wish_sapling',
        matrixOf(base.x + dx, base.y, base.z + dz, slot.rot ?? 0, slot.scale ?? 1));
      occupied.push({ x: base.x + dx, z: base.z + dz });
      trees++;
    }
    scatterFlora(w.hexes, origin, w.flora, `${w.island_id}-flora`, occupied);
    scatterClutter(w.hexes, origin, `${w.island_id}-clutter`, occupied);

    const centre = axialToWorld(origin.q, origin.r, cfg.size);
    placeAnimals(w.animals, w.hexes, origin, centre);

    // 小船：放出幾艘就停幾艘，停靠位用完就不再增加（島不會被船淹沒）
    const docked = Math.min(wish.count ?? 0, (w.dock_slots ?? []).length);
    for (let i = 0; i < docked; i++) {
      const slot = w.dock_slots[i];
      boats.push({
        x: centre.x + slot.dx,
        z: centre.z + slot.dz,
        rot: slot.rot ?? 0,
        phase: (i * 1.7) % (Math.PI * 2),
      });
    }

    const sign = (w.landmarks ?? []).find((lm) => lm.interaction);
    const anchors = {};
    if (sign) {
      const hex = w.hexes.find((h) => h.q === sign.hex[0] && h.r === sign.hex[1]);
      const base = hexTopPosition(hex, cfg, origin);
      const [dx, dz] = sign.offset ?? [0, 0];
      anchors[sign.interaction] = { x: base.x + dx, y: base.y + 0.5, z: base.z + dz, label: sign.label };
    }

    islands.push({
      island_id: w.island_id,
      kind: 'wish',
      name: w.name,
      tagline: w.tagline,
      geometry,
      bounds,
      anchors,
      interaction: sign?.interaction ?? null,
      boats: docked,
      trees,
      unlocked: true,
      growthCount: trees,
      growthTotal: (w.tree_slots ?? []).length,
    });
  }

  // ── 六座故事島 ───────────────────────────────────────────
  for (const island of map.islands) {
    const origin = island.origin;
    const state = progress[island.island_id] ?? { unlocked: false, routes: [] };
    const unlockedRoutes = new Set(state.routes ?? []);

    // 海上航線的踏腳石：解鎖後才會浮出來
    if (state.unlocked) {
      const rand = seeded(`${island.island_id}-route`);
      for (const [q, r] of island.sea_route_from_home ?? []) {
        const { x, z } = axialToWorld(q, r, cfg.size);
        addProp('stepping_stone', matrixOf(x, -0.12, z, rand() * Math.PI, 0.7 + rand() * 0.4));
      }
    }

    if (!state.unlocked) {
      /* 未破關的島：地形照蓋，只是還沒醒過來。
       *
       * 舊版這裡是 geometry: null——整座島只有兩顆礁石和一個浮標，
       * 六座裡五座是空海面，所以地圖一打開就是空的，沒有「想去哪一座」可言。
       *
       * 改成蓋出完整地形與地標，但褪成霧色、沒有名字、沒有居民。
       * 看得到、走得到、點得進去；破關之後它會長出名字、恢復彩度、住進島民。
       * 這樣既解決「空空的」，也保住 PDF 第 24 頁「破關一座」的獎勵——
       * 而且前後對比比「多出一座島」更看得出來。
       */
      const localHexes = [...island.base.hexes];
      const hexes = localHexes.map((h) => ({ ...h, q: h.q + origin.q, r: h.r + origin.r }));
      const { geometry, bounds } = buildTerrainGeometry(hexes, cfg, { dormant: true });
      // 不放地標。道具是跨島依型別分批的 InstancedMesh，沒辦法只把某幾座島上的
      // 屋頂調色——結果會是褪色的地配上全彩的橘屋頂，比沒有建築更突兀。
      // 剛好「建築長出來」也可以當成破關的獎勵之一。
      const occupied = [];
      // 植被照長，但密度減半：有輪廓、但看得出來比已破關的島冷清
      scatterFlora(localHexes, origin, island.flora, `${island.island_id}-flora-dormant`, occupied, 0.5);
      // 不放島民——「住進居民」是破關的獎勵
      islands.push({
        island_id: island.island_id,
        kind: 'story',
        story_id: island.story_id,
        order: island.order,
        name: island.locked_label,
        unlocked: false,
        geometry,
        bounds,
        growthCount: 0,
        growthTotal: island.growth.length,
      });
      continue;
    }

    // 已解鎖：基本地塊 ＋ 已發現航線帶來的地景
    const localHexes = [...island.base.hexes];
    const localLandmarks = [...(island.base.landmarks ?? [])];
    const grown = [];
    for (const growth of island.growth) {
      if (!unlockedRoutes.has(growth.route_id)) continue;
      localHexes.push(...(growth.hexes ?? []));
      localLandmarks.push(...(growth.landmarks ?? []));
      grown.push(growth);
    }

    const hexes = localHexes.map((h) => ({ ...h, q: h.q + origin.q, r: h.r + origin.r }));
    const { geometry, bounds } = buildTerrainGeometry(hexes, cfg);
    placeLandmarks(localLandmarks, localHexes, origin);
    const occupied = occupiedOf(localLandmarks, localHexes, origin);
    scatterFlora(localHexes, origin, island.flora, `${island.island_id}-flora-${grown.length}`, occupied);
    scatterClutter(localHexes, origin, `${island.island_id}-clutter-${grown.length}`, occupied);
    placeAnimals(island.animals, localHexes, origin, axialToWorld(origin.q, origin.r, cfg.size));
    // 美術文件的十隻居民。只有破關的島才有人——未破關的島是褪色、無人的，
    // 「住進居民」本來就是破關的獎勵之一。
    placeResidents(island.island_id, localHexes, origin,
      residentData?.islands?.[island.island_id]?.residents, occupied);

    islands.push({
      island_id: island.island_id,
      kind: 'story',
      story_id: island.story_id,
      order: island.order,
      name: state.name || island.default_name,
      default_name: island.default_name,
      unlocked: true,
      geometry,
      bounds,
      growthCount: grown.length,
      growthTotal: island.growth.length,
      grown: grown.map((g) => ({ growth_id: g.growth_id, route_id: g.route_id, label: g.label })),
    });
  }

  // ── 島間步道 ─────────────────────────────────────────────
  // 本島是樞紐：每一座島都有一條橋通回本島，所以主角從哪裡出發都走得到。
  // 橋對所有島都鋪，包含還沒破關的——「走得過去」是邀請，
  // 把橋藏起來等於又回到那張看不出能去哪裡的空地圖。
  {
    const w = (q, r) => {
      const { x, z } = axialToWorld(q, r, cfg.size);
      return [x, z];
    };
    const homePt = w(map.home.origin.q, map.home.origin.r);
    // 本島 7 格、中型島 5 格、故事島 3 格，半徑依序約 2 / 1.7 / 1.4
    for (const [key, trimTo] of [['post_island', 1.7], ['wish_island', 1.7]]) {
      const isl = map[key];
      if (!isl) continue;
      placeBridge([homePt, w(isl.origin.q, isl.origin.r)], { trimFrom: 2.0, trimTo });
    }
    for (const island of map.islands) {
      const via = (island.sea_route_from_home ?? []).map(([q, r]) => w(q, r));
      placeBridge([homePt, ...via, w(island.origin.q, island.origin.r)],
        { trimFrom: 2.0, trimTo: 1.4 });
    }
  }

  return { islands, props, animals, boats, residents };
}

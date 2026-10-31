/**
 * 依據 content/island_map.json 與玩家進度，產生整座群島的幾何資料。
 *
 * 產出的是「資料」而不是場景物件：地形各自一份合併幾何，道具則收成
 * { type -> matrix[] }，交給 sceneManager 變成 InstancedMesh。
 * 島嶼解鎖或長出新地景時整個重建一次——群島規模小，重建比增量更新單純可靠。
 */
import * as THREE from 'three';
import { buildTerrainGeometry, axialToWorld, hexTopPosition } from './hexGeometry.js';

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
export function buildWorld(map, progress = {}, wish = {}) {
  const cfg = map.hex;
  const islands = [];
  const props = new Map();   // type -> Matrix4[]（靜態道具）
  const animals = [];        // 會動的島民，交給 sceneManager 逐幀更新
  const boats = [];          // 停在願望島的小船，會隨海浪上下
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

  return { islands, props, animals, boats };
}

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
 */
export function buildWorld(map, progress = {}) {
  const cfg = map.hex;
  const islands = [];
  const props = new Map(); // type -> Matrix4[]
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

  const scatterFlora = (hexes, origin, floraKind, seedKey, occupied) => {
    const rand = seeded(seedKey);
    for (const hex of hexes) {
      const kind = hex.flora ?? 'none';
      const count = map.flora_density[kind] ?? 0;
      if (!count) continue;
      const kinds = map.flora_table[floraKind]?.[kind] ?? [];
      if (!kinds.length) continue;
      const base = hexTopPosition(hex, cfg, origin);
      for (let i = 0; i < count; i++) {
        const angle = rand() * Math.PI * 2;
        const radius = 0.18 + rand() * 0.6;
        const x = base.x + Math.cos(angle) * radius;
        const z = base.z + Math.sin(angle) * radius;
        const tooClose = occupied.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 0.26);
        if (tooClose) continue;
        const type = kinds[Math.floor(rand() * kinds.length)];
        addProp(type, matrixOf(x, base.y, z, rand() * Math.PI * 2, 0.8 + rand() * 0.45));
      }
    }
  };

  const occupiedOf = (landmarks, hexes, origin) =>
    (landmarks ?? []).flatMap((lm) => {
      const hex = hexes.find((h) => h.q === lm.hex[0] && h.r === lm.hex[1]);
      if (!hex) return [];
      const base = hexTopPosition(hex, cfg, origin);
      const [dx, dz] = lm.offset ?? [0, 0];
      return [{ x: base.x + dx, z: base.z + dz }];
    });

  // ── 透中島（主島，永遠存在） ─────────────────────────────
  {
    const home = map.home;
    const origin = home.origin;
    const hexes = home.hexes.map((h) => ({ ...h, q: h.q + origin.q, r: h.r + origin.r }));
    const { geometry, bounds } = buildTerrainGeometry(hexes, cfg);
    const landmarks = home.landmarks;
    placeLandmarks(landmarks, home.hexes, origin);
    scatterFlora(home.hexes, origin, home.flora, `${home.island_id}-flora`, occupiedOf(landmarks, home.hexes, origin));

    const anchors = {};
    for (const lm of landmarks) {
      if (!lm.interaction) continue;
      const hex = home.hexes.find((h) => h.q === lm.hex[0] && h.r === lm.hex[1]);
      const base = hexTopPosition(hex, cfg, origin);
      const [dx, dz] = lm.offset ?? [0, 0];
      anchors[lm.interaction] = { x: base.x + dx, y: base.y + 0.5, z: base.z + dz, label: lm.label };
    }

    islands.push({
      island_id: home.island_id,
      kind: 'home',
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
      // 未解鎖：海面上只有一小叢礁石與一個浮標
      const rand = seeded(`${island.island_id}-locked`);
      const { x, z } = axialToWorld(origin.q, origin.r, cfg.size);
      addProp('rock', matrixOf(x, -0.05, z, rand() * Math.PI, 1.1));
      addProp('rock', matrixOf(x + 0.8, -0.08, z + 0.5, rand() * Math.PI, 0.8));
      addProp('buoy', matrixOf(x - 0.7, -0.05, z - 0.6, 0, 0.9));
      islands.push({
        island_id: island.island_id,
        kind: 'story',
        story_id: island.story_id,
        order: island.order,
        name: island.locked_label,
        unlocked: false,
        geometry: null,
        bounds: { minX: x - 1.4, maxX: x + 1.4, minZ: z - 1.4, maxZ: z + 1.4, maxY: 0 },
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
    scatterFlora(localHexes, origin, island.flora, `${island.island_id}-flora-${grown.length}`,
      occupiedOf(localLandmarks, localHexes, origin));

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

  return { islands, props };
}

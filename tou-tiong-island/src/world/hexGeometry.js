/**
 * 六角地塊幾何。
 *
 * 效能重點：同一座島上的所有地塊會被合併成「一個」BufferGeometry，
 * 顏色寫在頂點色裡，因此整座島的地形只佔一個 draw call。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SURFACE_COLORS } from './palette.js';

const SQRT3 = Math.sqrt(3);

/** flat-top 軸向座標 → 世界座標（y 由呼叫端決定）。 */
export function axialToWorld(q, r, size = 1) {
  return { x: size * 1.5 * q, z: size * SQRT3 * (r + q / 2) };
}

/**
 * 把 CylinderGeometry 的 group（0=側面、1=頂面、2=底面）轉成頂點色，
 * 之後就能用單一材質合併。
 */
function paintHex(geo, topColor, sideColor) {
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const side = new THREE.Color(sideColor);
  const top = new THREE.Color(topColor);

  // CylinderGeometry 的 index 分三段：側面 / 頂蓋 / 底蓋
  const fill = (start, end, color) => {
    const index = geo.index.array;
    for (let i = start; i < end; i++) {
      const v = index[i];
      colors[v * 3] = color.r;
      colors[v * 3 + 1] = color.g;
      colors[v * 3 + 2] = color.b;
    }
  };
  const groups = geo.groups;
  fill(groups[0].start, groups[0].start + groups[0].count, side);
  if (groups[1]) fill(groups[1].start, groups[1].start + groups[1].count, top);
  if (groups[2]) fill(groups[2].start, groups[2].start + groups[2].count, side);

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.clearGroups();
  return geo;
}

/**
 * 產生一座島的地形幾何（已合併）。
 * @param {Array} hexes content/island_map.json 的 hexes 陣列
 * @param {object} cfg  { size, level_height, base_depth }
 * @param {object} surfaces 氣候區的地表配色覆寫；沒寫到的地表沿用 SURFACE_COLORS
 * @returns {{ geometry: THREE.BufferGeometry, bounds: {minX,maxX,minZ,maxZ,maxY} }}
 */
export function buildTerrainGeometry(hexes, cfg, surfaces = {}) {
  const { size = 1, level_height: levelH = 0.42, base_depth: depth = 0.55 } = cfg;
  const parts = [];
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, maxY: 0 };

  for (const hex of hexes) {
    const top = (hex.level ?? 0) * levelH;
    const height = depth + top;
    const { x, z } = axialToWorld(hex.q, hex.r, size);

    // radialSegments = 6，半徑略縮讓地塊之間留一道海水的縫
    const geo = new THREE.CylinderGeometry(size * 0.985, size * 0.985, height, 6, 1);
    const colors = surfaces[hex.surface] ?? SURFACE_COLORS[hex.surface] ?? SURFACE_COLORS.sand;
    paintHex(geo, colors.top, colors.side);
    geo.translate(x, height / 2 - depth, z);
    parts.push(geo);

    bounds.minX = Math.min(bounds.minX, x - size);
    bounds.maxX = Math.max(bounds.maxX, x + size);
    bounds.minZ = Math.min(bounds.minZ, z - size);
    bounds.maxZ = Math.max(bounds.maxZ, z + size);
    bounds.maxY = Math.max(bounds.maxY, top);
  }

  const geometry = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  geometry.computeVertexNormals();
  return { geometry, bounds };
}

/** 某個 hex 的頂面世界座標，給道具擺放用。 */
export function hexTopPosition(hex, cfg, origin = { q: 0, r: 0 }) {
  const { size = 1, level_height: levelH = 0.42 } = cfg;
  const { x, z } = axialToWorld(hex.q + origin.q, hex.r + origin.r, size);
  return { x, y: (hex.level ?? 0) * levelH, z };
}

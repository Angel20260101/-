/**
 * 低多邊形道具庫。
 *
 * 每一種道具都被壓成「一個」帶頂點色的 BufferGeometry，底部對齊 y=0。
 * 場景會把同型別的道具收成一個 InstancedMesh，所以不論島上長出幾百棵樹，
 * 每種道具都只佔一個 draw call。
 *
 * 所有幾何都刻意用極低的分段數（錐體 5～6 面、球體用 IcosahedronGeometry detail 0），
 * 搭配 flatShading 取得參考圖那種塊面感，同時把三角形數壓到最低。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette.js';

function paint(geo, hex) {
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

const box = (w, h, d, color, x = 0, y = 0, z = 0, rotY = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  paint(g, color);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return g;
};
const cyl = (rt, rb, h, seg, color, x = 0, y = 0, z = 0) => {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  paint(g, color);
  g.translate(x, y, z);
  return g;
};
const cone = (r, h, seg, color, x = 0, y = 0, z = 0) => {
  const g = new THREE.ConeGeometry(r, h, seg);
  paint(g, color);
  g.translate(x, y, z);
  return g;
};
const blob = (r, color, x = 0, y = 0, z = 0) => {
  const g = new THREE.IcosahedronGeometry(r, 0);
  paint(g, color);
  g.translate(x, y, z);
  return g;
};

const merge = (parts) => {
  // IcosahedronGeometry 沒有 index，Cylinder/Cone/Box 有，混在一起無法合併。
  // 統一轉成非索引之後再合併——低多邊形的頂點數很少，付得起這點重複。
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const geo = mergeGeometries(flat, false);
  flat.forEach((g, i) => { if (g !== parts[i]) g.dispose(); });
  parts.forEach((g) => g.dispose());
  geo.computeVertexNormals();
  return geo;
};

/** 道具工廠。key 對應 island_map.json 的 landmark.type 與 flora_table 的樹種。 */
export const PROP_FACTORIES = {
  tree_pine: () => merge([
    cyl(0.055, 0.075, 0.34, 5, PALETTE.trunk, 0, 0.17, 0),
    cone(0.30, 0.62, 6, PALETTE.leafPine, 0, 0.62, 0),
    cone(0.22, 0.44, 6, PALETTE.leafPine, 0, 0.98, 0),
  ]),

  tree_round: () => merge([
    cyl(0.05, 0.07, 0.38, 5, PALETTE.trunk, 0, 0.19, 0),
    blob(0.30, PALETTE.leafRound, 0, 0.62, 0),
  ]),

  tree_blob: () => merge([
    cyl(0.05, 0.07, 0.30, 5, PALETTE.trunk, 0, 0.15, 0),
    blob(0.22, PALETTE.leafLime, -0.12, 0.46, 0.04),
    blob(0.26, PALETTE.leafRound, 0.10, 0.56, -0.06),
    blob(0.18, PALETTE.leafTeal, 0.02, 0.72, 0.10),
  ]),

  tree_pink: () => merge([
    cyl(0.045, 0.06, 0.42, 5, PALETTE.trunkDark, 0, 0.21, 0),
    blob(0.26, PALETTE.leafPink, 0, 0.62, 0),
    blob(0.16, PALETTE.leafPinkHi, 0.12, 0.78, 0.08),
  ]),

  tree_coral: () => merge([
    cyl(0.05, 0.07, 0.30, 5, PALETTE.trunkDark, 0, 0.15, 0),
    blob(0.24, PALETTE.leafCoral, 0, 0.48, 0),
    blob(0.15, PALETTE.leafPink, -0.14, 0.62, 0.06),
  ]),

  palm: () => {
    const parts = [cyl(0.045, 0.07, 0.86, 5, PALETTE.palmTrunk, 0, 0.43, 0)];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const leaf = new THREE.ConeGeometry(0.10, 0.42, 4);
      paint(leaf, i % 2 ? PALETTE.palmLeaf : PALETTE.leafPink);
      leaf.rotateZ(Math.PI / 2.4);
      leaf.rotateY(a);
      leaf.translate(Math.cos(a) * 0.16, 0.92, Math.sin(a) * 0.16);
      parts.push(leaf);
    }
    parts.push(blob(0.07, PALETTE.leafPinkHi, 0, 0.90, 0));
    return merge(parts);
  },

  grass_tuft: () => merge([
    cone(0.05, 0.16, 4, PALETTE.grassDark, 0, 0.08, 0),
    cone(0.04, 0.12, 4, PALETTE.leafLime, 0.07, 0.06, 0.03),
    cone(0.04, 0.13, 4, PALETTE.grassTop, -0.06, 0.065, -0.04),
  ]),

  rock: () => merge([
    blob(0.22, PALETTE.stone, 0, 0.12, 0),
    blob(0.13, PALETTE.rockSide, 0.18, 0.07, 0.08),
  ]),

  flower_patch: () => {
    const parts = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const x = Math.cos(a) * 0.12;
      const z = Math.sin(a) * 0.12;
      parts.push(cyl(0.012, 0.012, 0.14, 3, PALETTE.grassDark, x, 0.07, z));
      parts.push(blob(0.045, i % 2 ? PALETTE.flowerA : PALETTE.flowerB, x, 0.16, z));
    }
    return merge(parts);
  },

  stone_path: () => {
    const parts = [];
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      parts.push(cyl(0.13, 0.13, 0.05, 6, PALETTE.stone, (t - 0.5) * 1.2, 0.025, Math.sin(t * 3) * 0.07));
    }
    return merge(parts);
  },

  stepping_stone: () => merge([
    cyl(0.34, 0.30, 0.16, 6, PALETTE.stone, 0, 0.08, 0),
  ]),

  buoy: () => merge([
    cyl(0.09, 0.13, 0.22, 6, PALETTE.towerRed, 0, 0.11, 0),
    cone(0.07, 0.16, 6, PALETTE.towerWhite, 0, 0.30, 0),
  ]),

  lamp_post: () => merge([
    cyl(0.035, 0.05, 0.86, 5, PALETTE.lampPost, 0, 0.43, 0),
    box(0.20, 0.03, 0.03, PALETTE.lampPost, 0.08, 0.84, 0),
    blob(0.075, PALETTE.lampGlow, 0.16, 0.80, 0),
  ]),

  signpost: () => merge([
    cyl(0.04, 0.05, 0.62, 5, PALETTE.woodDark, 0, 0.31, 0),
    box(0.44, 0.17, 0.035, PALETTE.wood, 0.10, 0.52, 0, -0.25),
    box(0.34, 0.14, 0.035, PALETTE.rope, -0.07, 0.33, 0, 0.30),
  ]),

  bench: () => merge([
    box(0.62, 0.05, 0.22, PALETTE.wood, 0, 0.20, 0),
    box(0.62, 0.20, 0.04, PALETTE.wood, 0, 0.32, -0.10),
    box(0.05, 0.20, 0.20, PALETTE.woodDark, -0.26, 0.10, 0),
    box(0.05, 0.20, 0.20, PALETTE.woodDark, 0.26, 0.10, 0),
  ]),

  hut: () => merge([
    box(0.70, 0.46, 0.60, PALETTE.hutWall, 0, 0.23, 0),
    cone(0.62, 0.40, 4, PALETTE.hutRoof, 0, 0.66, 0),
    box(0.18, 0.28, 0.03, PALETTE.woodDark, 0, 0.14, 0.31),
    box(0.14, 0.14, 0.03, PALETTE.towerGlass, -0.22, 0.30, 0.31),
  ]),

  pier: () => {
    const parts = [];
    for (let i = 0; i < 7; i++) {
      parts.push(box(0.46, 0.045, 0.14, i % 2 ? PALETTE.wood : PALETTE.woodDark, 0, 0.30, i * 0.17 - 0.5));
    }
    for (const z of [-0.45, 0, 0.45]) {
      parts.push(cyl(0.035, 0.035, 0.66, 5, PALETTE.woodDark, -0.18, 0.0, z));
      parts.push(cyl(0.035, 0.035, 0.66, 5, PALETTE.woodDark, 0.18, 0.0, z));
    }
    parts.push(cyl(0.05, 0.05, 0.34, 5, PALETTE.wood, -0.20, 0.44, 0.58));
    parts.push(cyl(0.05, 0.05, 0.34, 5, PALETTE.wood, 0.20, 0.44, 0.58));
    return merge(parts);
  },

  rope_bridge: () => {
    const parts = [];
    const span = 2.0;
    const planks = 9;
    for (let i = 0; i < planks; i++) {
      const t = i / (planks - 1);
      const x = (t - 0.5) * span;
      const sag = Math.sin(t * Math.PI) * 0.22;
      parts.push(box(0.17, 0.035, 0.46, i % 2 ? PALETTE.wood : PALETTE.woodDark, x, 0.40 - sag, 0));
    }
    for (let i = 0; i < planks - 1; i++) {
      const t = (i + 0.5) / (planks - 1);
      const x = (t - 0.5) * span;
      const sag = Math.sin(t * Math.PI) * 0.22;
      parts.push(box(0.26, 0.018, 0.018, PALETTE.rope, x, 0.60 - sag, -0.22));
      parts.push(box(0.26, 0.018, 0.018, PALETTE.rope, x, 0.60 - sag, 0.22));
    }
    for (const x of [-span / 2, span / 2]) {
      parts.push(cyl(0.045, 0.05, 0.80, 5, PALETTE.woodDark, x, 0.40, -0.22));
      parts.push(cyl(0.045, 0.05, 0.80, 5, PALETTE.woodDark, x, 0.40, 0.22));
    }
    return merge(parts);
  },

  lighthouse: () => merge([
    cyl(0.40, 0.52, 0.18, 8, PALETTE.towerWhite, 0, 0.09, 0),
    cyl(0.26, 0.38, 0.52, 8, PALETTE.towerWhite, 0, 0.44, 0),
    cyl(0.245, 0.265, 0.18, 8, PALETTE.towerRed, 0, 0.79, 0),
    cyl(0.21, 0.245, 0.40, 8, PALETTE.towerWhite, 0, 1.08, 0),
    cyl(0.20, 0.21, 0.16, 8, PALETTE.towerRed, 0, 1.36, 0),
    cyl(0.24, 0.24, 0.26, 8, PALETTE.towerGlass, 0, 1.57, 0),
    cyl(0.30, 0.30, 0.04, 8, PALETTE.towerWhite, 0, 1.72, 0),
    cone(0.32, 0.30, 8, PALETTE.towerRoof, 0, 1.89, 0),
    blob(0.05, PALETTE.lampGlow, 0, 2.08, 0),
  ]),
};

export const PROP_TYPES = Object.keys(PROP_FACTORIES);

/** 道具的大致高度，給 DOM 標籤定位用。 */
export const PROP_HEIGHT = {
  lighthouse: 2.1, hut: 0.9, pier: 0.6, rope_bridge: 0.8, signpost: 0.7,
  bench: 0.4, lamp_post: 0.9, palm: 1.0, tree_pine: 1.2, tree_round: 0.9,
};

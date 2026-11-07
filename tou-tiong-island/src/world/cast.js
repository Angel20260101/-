/**
 * 群戲：一批角色的批次建立與每幀擺姿勢。
 *
 * 群島（sceneManager）與走進島裡之後的場景（islandScene）都要畫同一批動物，
 * 所以這段從 sceneManager 抽出來共用——跟 shapes.js 把幾何工具抽出來是同一個理由：
 * 兩邊各寫一份，造型與動作遲早會各走各的。
 *
 * 分批的規則是**依幾何種類**而不是依角色或物種：一隻兔子的部件會散進
 * rbox / cyl / cone / sphere 四個批次裡。所以不管場上有幾隻、幾種動物，
 * draw call 固定就是 CHARACTER_KINDS 那麼多個——「每島十隻」才付得起。
 *
 * actor 的形狀：
 *   { character, base:{x,y,z}, rot, activity, phase, speed, route?, scale? }
 *
 * scale 是整隻動物的放大倍率，預設 1。島內場景的世界比群島大（同一座島
 * 在那邊是 10.2×14.2，在群島上只有 4.3×3），BASE_HEIGHT 是照群島調的，
 * 直接搬過去動物會小掉快一半——所以由呼叫端決定要放多大。
 *
 * route 一定是 makeRoute() 做出來的弧長路徑物件，不是原始的座標陣列——
 * 兩者都叫 route 撞過一次：島內居民的資料裡 route 是 [x,z] 節點清單，
 * 傳進來會讓 sampleRoute 直接爆掉。自己算位置的呼叫端請不要用這個欄位名。
 * buildCast() 會在每個 actor 上補一個 slots，stepCast() 只讀它。
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { poseCharacter } from './activities.js';
import { sampleRoute } from './routes.js';

const GEO = new Map();

/** 部件的單位幾何。四種就夠，所有角色都是這四種縮放拼出來的。 */
export function charGeometry(kind) {
  if (GEO.has(kind)) return GEO.get(kind);
  let g;
  switch (kind) {
    case 'rbox': g = new RoundedBoxGeometry(1, 1, 1, 2, 0.14); break;
    case 'cyl': g = new THREE.CylinderGeometry(1, 1, 1, 10); break;
    case 'cone': g = new THREE.ConeGeometry(1, 1, 8); break;
    default: g = new THREE.IcosahedronGeometry(1, 1); break;
  }
  // 頂點色先填白：實際顏色由 instanceColor 一隻一隻給
  const n = g.attributes.position.count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  GEO.set(kind, g);
  return g;
}

/**
 * 建立一批角色的 InstancedMesh，並把每個部件配到自己的格子。
 *
 * @param actors    已經有 character 的角色陣列（會被就地補上 slots）
 * @param material  共用材質
 * @param parent    要掛進去的 Object3D
 * @param onMesh    每建立一個批次就回呼一次，讓呼叫端登記到自己的清單裡
 * @returns { meshes } 建立出來的批次，每幀要把 instanceMatrix 標記為需更新
 */
export function buildCast(actors, { material, parent, onMesh }) {
  const slots = new Map();
  for (const a of actors) {
    for (const p of a.character.parts) slots.set(p.kind, (slots.get(p.kind) ?? 0) + 1);
  }

  const meshes = [];
  const byKind = new Map();
  for (const [kind, count] of slots) {
    if (!count) continue;
    const mesh = new THREE.InstancedMesh(charGeometry(kind), material, count);
    mesh.frustumCulled = false;
    // 會動的東西不投影：靜態陰影只烘焙一次，動起來陰影會卡在原地
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    parent.add(mesh);
    meshes.push(mesh);
    onMesh?.(mesh);
    byKind.set(kind, { mesh, next: 0 });
  }

  // 配位：每個部件拿到自己在該種類批次裡的索引，之後每幀只更新矩陣
  const colour = new THREE.Color();
  for (const actor of actors) {
    actor.slots = actor.character.parts.map((p) => {
      const b = byKind.get(p.kind);
      const i = b.next++;
      b.mesh.setColorAt(i, colour.set(p.color));
      return { mesh: b.mesh, index: i };
    });
  }
  for (const { mesh } of byKind.values()) {
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  return { meshes };
}

// 每幀重用，不要在迴圈裡配置
const _m = new THREE.Matrix4();
const _mWorld = new THREE.Matrix4();
const _mPart = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _scl = new THREE.Vector3(1, 1, 1);

/**
 * 每幀擺出所有角色的姿勢。
 *
 * 矩陣組法：世界位置 × 朝向 → 部件基準位置 → 繞 pivot 的通道旋轉 → 縮放。
 * pivot 是關鍵：手臂的 pivot 在肩膀，所以舉手是繞著肩膀轉，
 * 不是繞自己的中心翻轉。
 */
export function stepCast(actors, t, meshes) {
  if (!actors?.length) return;
  for (const actor of actors) {
    let x = actor.base.x, y = actor.base.y, z = actor.base.z, heading = actor.rot;
    if (actor.route) {
      // 等速前進：距離 = 速度 × 時間。不用 sin()，所以沒有兩端變慢的滑冰感。
      const s = sampleRoute(actor.route, (t + actor.phase) * actor.speed);
      x = s.x; y = s.y; z = s.z;
      heading = s.heading;      // 朝向直接取路徑切線，轉彎自然跟著轉
    }
    const k = actor.scale ?? 1;
    _mWorld.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(0, heading, 0)), _scl.set(k, k, k));

    const pose = poseCharacter(actor.character, actor.activity, t, actor.phase, actor.speed);
    for (let i = 0; i < pose.length; i++) {
      const p = pose[i];
      const slot = actor.slots[i];
      const [px, py, pz] = p.pos;
      if (p.pivot) {
        const [ax, ay, az] = p.pivot;
        _mPart.makeTranslation(px + ax, py + ay, pz + az);
        _mPart.multiply(_m.makeRotationFromEuler(_e.set(p.rot[0], p.rot[1], p.rot[2])));
        _mPart.multiply(_m.makeTranslation(-ax, -ay, -az));
      } else {
        _mPart.makeTranslation(px, py, pz);
        _mPart.multiply(_m.makeRotationFromEuler(_e.set(p.rot[0], p.rot[1], p.rot[2])));
      }
      _mPart.multiply(_m.makeScale(p.scale[0], p.scale[1], p.scale[2]));
      slot.mesh.setMatrixAt(slot.index, _m.multiplyMatrices(_mWorld, _mPart));
    }
  }
  for (const mesh of meshes ?? []) mesh.instanceMatrix.needsUpdate = true;
}

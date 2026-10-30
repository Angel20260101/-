/**
 * 走進一座島之後的場景。
 *
 * 跟群島總覽（sceneManager.js）**共用同一個 renderer 與 canvas**，但各有自己的
 * Scene、相機與控制器。進島時群島暫停、這裡接手；離開時反過來。
 * 規格要求「進入單島才載入其完整道具與 10 隻居民」，所以這支和它的道具包
 * 都是動態 import 進來的，首屏不會下載。
 *
 * 另一條規格要求是「不能以按需渲染為由將活躍島凍結」——島上要一直有生活感。
 * 所以這裡跟群島相反，是**持續渲染**，只有切到背景分頁或離開才停。
 *
 * 一座島的所有地形合併成一個幾何；同型別的道具收成一個 InstancedMesh；
 * 會轉的零件（風車葉）另外掛，因為它要獨立旋轉。
 */
import * as THREE from 'three';
import { CameraController } from './cameraController.js';
import { layer, slab, scaleOutline, ribbon, blobOutline } from './landmass.js';
import { detectTier, profileFor, prefersReducedMotion } from './perf.js';

const MAX_FPS = { 'mobile-low': 24, mobile: 30, desktop: 36 };

export class IslandScene {
  /**
   * @param {object} o
   *   renderer   跟群島共用
   *   canvas     同上
   *   skyLayer   CSS 天空圖層，進島時換成這座島的配色
   *   labelLayer DOM 標籤層
   *   data       content/islands/*.json
   *   props      這座島的道具工廠 { name: () => BufferGeometry }
   *   onPickResident(id)
   */
  constructor({ renderer, canvas, skyLayer, labelLayer, data, props, onPickResident }) {
    this.renderer = renderer;
    this.canvas = canvas;
    this.skyLayer = skyLayer;
    this.labelLayer = labelLayer;
    this.data = data;
    this.propFactories = props;
    this.onPickResident = onPickResident;

    this.tier = detectTier();
    this.profile = profileFor(this.tier);
    this.reducedMotion = prefersReducedMotion();

    this.scene = new THREE.Scene();
    const sky = data.sky ?? {};
    this.scene.fog = new THREE.Fog(sky.fog ?? '#f2e6cd', 22, 64);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.3, 120);

    const light = data.light ?? {};
    this.hemi = new THREE.HemisphereLight(
      light.sky ?? '#fff6dc', light.ground ?? '#e0b98a', light.hemi ?? 1.15,
    );
    this.dir = new THREE.DirectionalLight(light.sun ?? '#fff6e2', light.dir ?? 1.4);
    this.dir.position.set(-12, 20, 9);
    this.dir.castShadow = false;
    this.scene.add(this.hemi, this.dir);

    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.waterMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.pickMaterial = new THREE.MeshBasicMaterial({ visible: false });

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.geometryCache = new Map();
    this.spinners = [];        // 會自轉的零件（風車葉）
    this.residents = [];
    this.pickTargets = [];
    this._clock = 0;
    this._lastFrame = 0;
    this._rafId = 0;
    this._running = false;
    this._raycaster = new THREE.Raycaster();

    this._build();

    this.controls = new CameraController(
      this.camera, canvas, data.camera ?? {},
      () => {}, (pos) => this._handleTap(pos),
    );
    this.resize();
    this._tick = this._tick.bind(this);
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  // ── 組裝 ────────────────────────────────────────────────
  _geometry(type) {
    if (!this.geometryCache.has(type)) {
      const f = this.propFactories[type];
      if (!f) return null;
      this.geometryCache.set(type, f());
    }
    return this.geometryCache.get(type);
  }

  _build() {
    const d = this.data;

    // 地形：所有層合併成一個幾何
    const landParts = [];
    for (const l of d.land ?? []) {
      const outline = l.outline === 'blob'
        ? blobOutline(l.rx, l.rz, l.segments ?? 16, l.jitter ?? 0.12, l.seed ?? 1)
        : l.outline;
      const shifted = (l.at ? outline.map(([x, z]) => [x + l.at[0], z + l.at[1]]) : outline);
      landParts.push(layer(shifted, l));
    }
    if (landParts.length) {
      const merged = mergeRaw(landParts);
      const mesh = new THREE.Mesh(merged, this.material);
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
    }

    // 平面：水池、鋪面、地毯
    const flatParts = [];
    for (const f of d.flats ?? []) {
      const outline = f.outline === 'ribbon' ? ribbon(f.points, f.width) : f.outline;
      const shifted = (f.at ? outline.map(([x, z]) => [x + f.at[0], z + f.at[1]]) : outline);
      if (f.rim) flatParts.push(slab(scaleOutline(shifted, f.rim.scale ?? 1.18),
        { y: (f.y ?? 0) - 0.01, color: f.rim.color }));
      flatParts.push(slab(shifted, f));
    }
    if (flatParts.length) {
      const mesh = new THREE.Mesh(mergeRaw(flatParts), this.waterMaterial);
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      this.waterMesh = mesh;
    }

    // 道具：同型別收成一個 InstancedMesh
    const byType = new Map();
    for (const p of d.props ?? []) {
      if (!byType.has(p.type)) byType.set(p.type, []);
      byType.get(p.type).push(p);
    }
    this.instanced = [];
    for (const [type, list] of byType) {
      const geo = this._geometry(type);
      if (!geo) { console.warn('島上找不到道具型別', type); continue; }
      const mesh = new THREE.InstancedMesh(geo, this.material, list.length);
      mesh.frustumCulled = false;
      const m = new THREE.Matrix4();
      list.forEach((p, i) => {
        m.compose(
          new THREE.Vector3(p.at[0], p.at[1] ?? 0, p.at[2]),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.rot ?? 0, 0)),
          new THREE.Vector3(p.scale ?? 1, p.scale ?? 1, p.scale ?? 1),
        );
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.root.add(mesh);
      this.instanced.push(mesh);
    }

    // 會自轉的零件：風車葉之類，必須獨立於塔身
    for (const s of d.spinners ?? []) {
      const geo = this._geometry(s.type);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.position.set(s.at[0], s.at[1], s.at[2]);
      mesh.rotation.y = s.face ?? 0;
      this.root.add(mesh);
      this.spinners.push({ mesh, speed: s.speed ?? 0.5, axis: s.axis ?? 'z' });
    }

    this._buildResidents();
  }

  /**
   * 居民。
   *
   * 現在用群島上既有的動物模型佔位——真正的 20 種模型等匯入。
   * 位置、動作循環與點擊區都照規格先排好，換模型時只要改 species 對應的型別名。
   */
  _buildResidents() {
    const byType = new Map();
    for (const r of this.data.residents ?? []) {
      const type = r.model;
      if (!this.propFactories[type]) continue;
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push(r);
    }
    this.residentMeshes = [];
    for (const [type, list] of byType) {
      const geo = this._geometry(type);
      const mesh = new THREE.InstancedMesh(geo, this.material, list.length);
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.residentMeshes.push(mesh);
      list.forEach((r, i) => {
        this.residents.push({
          ...r, mesh, index: i,
          // 動作循環的相位錯開：規格要求「10 隻從不同循環時間點開始」
          phase: (this.residents.length * 1.37) % (Math.PI * 2),
          period: r.period ?? (r.rank === 'front' ? 9 : 14),
          greetUntil: 0,
        });
      });
    }
    // 點擊用的隱形代理：動物太小，直接射線打模型很難點中
    for (const r of this.residents) {
      const proxy = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 6), this.pickMaterial);
      proxy.position.set(r.at[0], (r.at[1] ?? 0) + 0.45, r.at[2]);
      proxy.userData.residentId = r.id;
      this.root.add(proxy);
      this.pickTargets.push(proxy);
      r.proxy = proxy;
    }
    this._stepResidents(0);
  }

  // ── 每幀 ────────────────────────────────────────────────
  _stepResidents(t) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3(1, 1, 1);
    for (const r of this.residents) {
      const k = ((t / r.period) + r.phase) % 1;
      const base = r.at;
      let x = base[0]; let z = base[2];
      const y = base[1] ?? 0;
      let face = r.rot ?? 0;
      let bob = 0;

      if (r.route && r.route.length > 1) {
        // 在 2～4 個固定節點之間走，走一段停一段（規格：行走與停靠分段）
        const n = r.route.length;
        const leg = k * n;
        const i = Math.floor(leg) % n;
        const f = leg - Math.floor(leg);
        const hold = 0.45;                       // 前 45% 停著，後面才移動
        const move = f < hold ? 0 : (f - hold) / (1 - hold);
        const a = r.route[i];
        const b = r.route[(i + 1) % n];
        x = a[0] + (b[0] - a[0]) * ease(move);
        z = a[1] + (b[1] - a[1]) * ease(move);
        if (move > 0) {
          face = Math.atan2(b[0] - a[0], b[1] - a[1]);
          bob = Math.abs(Math.sin(move * Math.PI * 6)) * 0.035;   // 走路的上下
        }
      } else {
        bob = Math.sin(t * 1.6 + r.phase) * 0.012;                // 坐著也要呼吸
        face += Math.sin(t * 0.6 + r.phase) * 0.18;               // 轉頭張望
      }

      if (t < r.greetUntil) {
        // 打招呼：轉向鏡頭、上下點兩次。規格要求連點不疊加，所以只看 greetUntil
        const g = (r.greetUntil - t);
        face = this._cameraAzimuth();
        bob += Math.abs(Math.sin(g * 7)) * 0.07;
      }

      pos.set(x, y + bob, z);
      e.set(0, face, 0);
      q.setFromEuler(e);
      m.compose(pos, q, scl);
      r.mesh.setMatrixAt(r.index, m);
      if (r.proxy) r.proxy.position.set(x, y + 0.45, z);
    }
    for (const mesh of this.residentMeshes) mesh.instanceMatrix.needsUpdate = true;
  }

  _cameraAzimuth() {
    return Math.atan2(
      this.camera.position.x - this.controls.target.x,
      this.camera.position.z - this.controls.target.z,
    );
  }

  _tick(now) {
    this._rafId = 0;
    if (!this._running) return;
    const fps = MAX_FPS[this.tier] ?? 30;
    if (this._lastFrame && now - this._lastFrame < 1000 / fps - 1) {
      this._rafId = requestAnimationFrame(this._tick);
      return;
    }
    const dt = this._lastFrame ? Math.min((now - this._lastFrame) / 1000, 0.1) : 0.016;
    this._lastFrame = now;
    this._clock += dt;

    if (!this.reducedMotion) {
      for (const s of this.spinners) s.mesh.rotation[s.axis] += s.speed * dt;
      this._stepResidents(this._clock);
    }
    this.renderer.render(this.scene, this.camera);
    this._rafId = requestAnimationFrame(this._tick);
  }

  // ── 點選 ────────────────────────────────────────────────
  _handleTap(pos) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((pos.x - rect.left) / rect.width) * 2 - 1,
      -((pos.y - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(ndc, this.camera);
    const hit = this._raycaster.intersectObjects(this.pickTargets, false)[0];
    if (!hit) return;
    const id = hit.object.userData.residentId;
    const r = this.residents.find((x) => x.id === id);
    // 規格：連點不疊加打招呼，做完一次才回生活狀態
    if (r && this._clock >= r.greetUntil) r.greetUntil = this._clock + 1.6;
    this.onPickResident?.(id);
  }

  // ── 生命週期 ────────────────────────────────────────────
  start() {
    if (this._running) return;
    this._running = true;
    this._lastFrame = 0;
    this.controls.enabled = true;
    this.resize();
    this._rafId = requestAnimationFrame(this._tick);
  }

  stop() {
    this._running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = 0;
    this.controls.enabled = false;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 直向手機的水平視角很窄，跟群島一樣要放寬，否則整座島塞不進來
    this.camera.fov = this.camera.aspect < 0.78 ? 48 : 36;
    this.camera.updateProjectionMatrix();
    this.controls?.apply();
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.controls?.dispose();
    // 地形與鋪面那兩個合併 mesh 用的是共用材質，又不是 InstancedMesh，
    // 以前靠材質判斷會剛好從中間漏掉，每進出一次就留下兩個幾何。
    // 現在改成一律收：場上看得到的每一個幾何都釋放，快取最後再清一次。
    const seen = new Set();
    this.root.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    });
    for (const g of this.geometryCache.values()) if (!seen.has(g)) g.dispose();
    this.geometryCache.clear();
    this.root.children.length = 0;
    this.material.dispose();
    this.waterMaterial.dispose();
    this.pickMaterial.dispose();
  }
}

const ease = (t) => t * t * (3 - 2 * t);

/** 把一堆「只有 position 與 color」的幾何接成一個。 */
function mergeRaw(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

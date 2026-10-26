/**
 * WebGL 場景管理。
 *
 * 效能守則（全部在這個檔案裡被執行，不是口號）：
 *   1. 沒有即時陰影：renderer.shadowMap 關閉，材質也不接收陰影。
 *   2. 只有兩盞靜態光：HemisphereLight ＋ 一盞不投影的 DirectionalLight。
 *   3. 沒有粒子、沒有後製、沒有模糊濾鏡。
 *   4. 不使用任何貼圖，顏色全部走頂點色，材質只有兩種。
 *   5. 同型別道具收成 InstancedMesh，整座群島的 draw call 控制在數十個以內。
 *   6. 按需渲染：沒有輸入、沒有狀態變化就完全不呼叫 render，RAF 也不排程。
 *   7. 故事畫面開啟時 pause()，地圖完全停止渲染。
 *   8. 像素比依裝置分級設上限（低階手機 1.0 / 一般手機 1.5 / 桌機 2.0）。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette.js';
import { PROP_FACTORIES } from './props.js';
import { buildWorld } from './islandBuilder.js';
import { CameraController } from './cameraController.js';
import { detectTier, profileFor } from './perf.js';

export class SceneManager {
  constructor({ canvas, labelLayer, map, onSelectIsland, onSelectInteraction }) {
    this.canvas = canvas;
    this.labelLayer = labelLayer;
    this.map = map;
    this.onSelectIsland = onSelectIsland;
    this.onSelectInteraction = onSelectInteraction;

    this.tier = detectTier();
    this.profile = profileFor(this.tier);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.profile.antialias,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.shadowMap.enabled = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.profile.pixelRatio));
    this.renderer.setClearColor(PALETTE.sky, 1);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.sky);
    this.scene.fog = new THREE.Fog(PALETTE.sky, 60, 150); // near/far 會隨鏡頭距離調整

    this.camera = new THREE.PerspectiveCamera(34, 1, 1, 160);

    // 靜態光：一盞天空／地面補光，一盞方向光（不投影）
    const hemi = new THREE.HemisphereLight(0xffffff, PALETTE.waterDeep, 1.05);
    const dir = new THREE.DirectionalLight(0xffffff, 1.25);
    dir.position.set(-14, 22, 10);
    dir.castShadow = false;
    this.scene.add(hemi, dir);

    // 兩種材質，整個場景共用
    this.terrainMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.propMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.pickMaterial = new THREE.MeshBasicMaterial({ visible: false });

    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    this._buildWater();

    this.propGeometryCache = new Map();
    this.pickTargets = [];
    this.labels = new Map();
    this.islandsById = new Map();
    this.selectedId = null;

    this._raycaster = new THREE.Raycaster();
    this._paused = false;
    this._dirty = true;
    this._rafId = 0;
    this._lastFrame = 0;
    this._tick = this._tick.bind(this);

    this.controls = new CameraController(
      this.camera, canvas, map.camera,
      () => this.invalidate(),
      (pos) => this._handleTap(pos),
    );

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  // ── 海面 ────────────────────────────────────────────────
  _buildWater() {
    const plane = new THREE.PlaneGeometry(260, 260, 1, 1);
    plane.rotateX(-Math.PI / 2);
    plane.translate(0, -0.34, 0);
    // MeshBasicMaterial：海面不需要受光，這是最便宜的材質
    const water = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: PALETTE.water }));
    water.renderOrder = -1;
    this.scene.add(water);
    this.water = water;
  }

  /** 島嶼周圍的淺灘：所有島合併成一個幾何，只佔一個 draw call。 */
  _buildShallows(islands) {
    if (this.shallows) {
      this.scene.remove(this.shallows);
      this.shallows.geometry.dispose();
      this.shallows = null;
    }
    const parts = [];
    for (const island of islands) {
      const b = island.bounds;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      const radius = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 1.1;
      const ring = new THREE.CircleGeometry(radius, 12);
      ring.rotateX(-Math.PI / 2);
      ring.translate(cx, -0.3, cz);
      parts.push(ring);
    }
    if (!parts.length) return;
    const geo = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    this.shallows = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: PALETTE.foam }));
    this.shallows.renderOrder = -1;
    this.scene.add(this.shallows);
  }

  // ── 建立／重建世界 ───────────────────────────────────────
  rebuild(progress) {
    this._clearWorld();
    const { islands, props } = buildWorld(this.map, progress);
    this.islandsById.clear();

    for (const island of islands) {
      this.islandsById.set(island.island_id, island);
      if (island.geometry) {
        const mesh = new THREE.Mesh(island.geometry, this.terrainMaterial);
        mesh.matrixAutoUpdate = false;
        this.worldGroup.add(mesh);
      }
      // 點選代理：不繪製（material.visible = false），只給 raycaster 用
      const b = island.bounds;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      const radius = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 0.4;
      const proxy = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 3.2, 6), this.pickMaterial);
      proxy.position.set(cx, 0.8, cz);
      proxy.userData.islandId = island.island_id;
      this.worldGroup.add(proxy);
      this.pickTargets.push(proxy);
      island.center = { x: cx, y: b.maxY, z: cz };
    }

    for (const [type, matrices] of props) {
      const factory = PROP_FACTORIES[type];
      if (!factory) continue;
      if (!this.propGeometryCache.has(type)) this.propGeometryCache.set(type, factory());
      const geo = this.propGeometryCache.get(type);
      const mesh = new THREE.InstancedMesh(geo, this.propMaterial, matrices.length);
      mesh.frustumCulled = false;
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      this.worldGroup.add(mesh);
      this.instancedMeshes.push(mesh);
    }

    this._buildShallows(islands);
    this._buildLabels(islands);
    this.worldBounds = islands.reduce((acc, i) => ({
      minX: Math.min(acc.minX, i.bounds.minX), maxX: Math.max(acc.maxX, i.bounds.maxX),
      minZ: Math.min(acc.minZ, i.bounds.minZ), maxZ: Math.max(acc.maxZ, i.bounds.maxZ),
    }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
    this.invalidate();
    return islands;
  }

  /**
   * 把整座群島框進畫面。手機是直的、桌機是橫的，需要的距離差很多，
   * 所以用包圍球搭配當下的視野角度算，而不是寫死一個距離。
   */
  fitToWorld({ padding = 1.02, animate = false } = {}) {
    const b = this.worldBounds;
    if (!b || !Number.isFinite(b.minX)) return;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const target = new THREE.Vector3(cx, 0, cz);

    // 相機方向由控制器的球面角度決定，和距離無關
    const { polar, azimuth } = this.controls;
    const dir = new THREE.Vector3(
      Math.sin(polar) * Math.sin(azimuth),
      Math.cos(polar),
      Math.sin(polar) * Math.cos(azimuth),
    ).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, dir).normalize();
    const camUp = new THREE.Vector3().crossVectors(dir, right).normalize();

    const tanV = Math.tan((this.camera.fov * Math.PI) / 360);
    const tanH = tanV * this.camera.aspect;

    // 角點在相機座標的 x、y 必須落在視錐內；距離是線性的，可以直接解出下界
    let need = this.controls.minDistance;
    const w = new THREE.Vector3();
    for (const x of [b.minX, b.maxX]) {
      for (const z of [b.minZ, b.maxZ]) {
        for (const y of [0, 1.6]) {
          w.set(x, y, z).sub(target);
          const along = w.dot(dir);
          need = Math.max(
            need,
            Math.abs(w.dot(right)) / tanH * padding + along,
            Math.abs(w.dot(camUp)) / tanV * padding + along,
          );
        }
      }
    }
    const distance = THREE.MathUtils.clamp(need, this.controls.minDistance, this.controls.maxDistance);
    if (animate) {
      this.controls.flyTo({ target: { x: cx, y: 0, z: cz }, distance }, 600);
    } else {
      this.controls.target.set(cx, 0, cz);
      this.controls.distance = distance;
      this.controls.apply();
    }
  }

  _clearWorld() {
    for (const child of [...this.worldGroup.children]) {
      this.worldGroup.remove(child);
      if (child.isInstancedMesh) child.dispose();
      else if (child.geometry && child.material === this.terrainMaterial) child.geometry.dispose();
      else if (child.material === this.pickMaterial) child.geometry.dispose();
    }
    this.pickTargets = [];
    this.instancedMeshes = [];
  }

  // ── DOM 標籤（比 3D 文字便宜，而且可以直接點、可以被螢幕閱讀器讀到） ──
  _buildLabels(islands) {
    this.labelLayer.replaceChildren();
    this.labels.clear();
    for (const island of islands) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `map-label${island.unlocked ? '' : ' map-label--locked'}${island.kind === 'home' ? ' map-label--home' : ''}`;
      el.dataset.islandId = island.island_id;
      const growth = island.kind === 'story' && island.unlocked
        ? `<span class="map-label__sub">航線 ${island.growthCount}／${island.growthTotal}</span>` : '';
      el.innerHTML = island.unlocked
        ? `<span class="map-label__name">${island.name}</span>${growth}`
        : '<span class="map-label__name">？</span>';
      if (!island.unlocked) el.setAttribute('aria-label', `${island.name}（第 ${island.order} 座島，尚未探索）`);
      el.addEventListener('click', (e) => { e.stopPropagation(); this.onSelectIsland?.(island.island_id); });
      this.labelLayer.appendChild(el);
      const lift = island.kind === 'home' ? 2.9 : (island.unlocked ? 1.5 : 0.9);
      this.labels.set(island.island_id, {
        el, anchor: { ...island.center, y: island.center.y + lift },
      });

      // 透中島上的互動點各自有一顆標籤
      if (island.kind === 'home' && island.anchors) {
        for (const spot of island.interactions ?? []) {
          const anchor = island.anchors[spot.id];
          if (!anchor) continue;
          const dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'map-spot';
          dot.dataset.interaction = spot.id;
          dot.innerHTML = `<span class="map-spot__dot" aria-hidden="true"></span><span class="map-spot__text">${spot.title.split('｜')[0]}</span>`;
          dot.setAttribute('aria-label', spot.title);
          dot.addEventListener('click', (e) => { e.stopPropagation(); this.onSelectInteraction?.(spot.id); });
          this.labelLayer.appendChild(dot);
          this.labels.set(`spot:${spot.id}`, {
            el: dot, anchor: { x: anchor.x, y: anchor.y + 0.6, z: anchor.z }, nearOnly: true,
          });
        }
      }
    }
  }

  /**
   * 標籤定位。遠看時只留島嶼名稱，靠近到一定距離（或聚焦某座島）才顯示
   * 透中島上的互動點，否則小螢幕上會擠成一團。
   */
  _updateLabels() {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3();
    const near = this.controls.distance < 24;
    for (const { el, anchor, nearOnly } of this.labels.values()) {
      v.set(anchor.x, anchor.y, anchor.z).project(this.camera);
      const hidden = v.z > 1 || (nearOnly && !near);
      el.style.transform = `translate(-50%, -100%) translate(${(v.x * 0.5 + 0.5) * rect.width}px, ${(-v.y * 0.5 + 0.5) * rect.height}px)`;
      el.style.opacity = hidden ? '0' : '1';
      el.style.pointerEvents = hidden ? 'none' : 'auto';
    }
  }

  // ── 點選 ────────────────────────────────────────────────
  _handleTap(pos) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((pos.x - rect.left) / rect.width) * 2 - 1,
      -((pos.y - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(ndc, this.camera);
    const hits = this._raycaster.intersectObjects(this.pickTargets, false);
    if (hits.length) this.onSelectIsland?.(hits[0].object.userData.islandId);
  }

  select(islandId) {
    this.selectedId = islandId;
    for (const [key, { el }] of this.labels) {
      if (key.startsWith('spot:')) continue;
      el.classList.toggle('is-selected', key === islandId);
    }
    this.invalidate();
  }

  focus(islandId, { distance } = {}) {
    const island = this.islandsById.get(islandId);
    if (!island) return;
    this.controls.flyTo(
      { target: island.center, distance: distance ?? (island.kind === 'home' ? 15 : 13) },
      700,
    );
  }

  resetView() {
    this.fitToWorld({ animate: true });
  }

  // ── 渲染迴圈 ────────────────────────────────────────────
  invalidate() {
    if (this._paused) return;
    this._dirty = true;
    if (!this._rafId) this._rafId = requestAnimationFrame(this._tick);
  }

  _tick(now) {
    this._rafId = 0;
    if (this._paused) return;
    const minInterval = 1000 / this.profile.maxFps;
    if (now - this._lastFrame < minInterval - 1) {
      this._rafId = requestAnimationFrame(this._tick);
      return;
    }
    this._lastFrame = now;
    if (!this._dirty) return;
    this._dirty = false;
    // 霧與遠裁切面跟著鏡頭距離走，拉遠時遠處的島才不會被整片霧吃掉
    const d = this.controls.distance;
    this.scene.fog.near = d * 0.85;
    this.scene.fog.far = d * 2.6;
    const far = Math.max(160, d * 2.8);
    if (this.camera.far !== far) { this.camera.far = far; this.camera.updateProjectionMatrix(); }
    this.renderer.render(this.scene, this.camera);
    this._updateLabels();
  }

  /** 故事畫面開啟時呼叫：完全停止渲染與 RAF。 */
  pause() {
    this._paused = true;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = 0;
    this.controls.enabled = false;
    this.labelLayer.setAttribute('aria-hidden', 'true');
    this.labelLayer.style.visibility = 'hidden';
  }

  resume() {
    if (!this._paused) return;
    this._paused = false;
    this.controls.enabled = true;
    this.labelLayer.removeAttribute('aria-hidden');
    this.labelLayer.style.visibility = '';
    this.invalidate();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 直向手機的水平視野很窄，用窄的視角會逼著鏡頭退到很遠；這裡依比例放寬
    this.camera.fov = this.camera.aspect < 0.78 ? 46 : 34;
    this.camera.updateProjectionMatrix();
    if (this.autoFit) this.fitToWorld();
    this.invalidate();
  }

  /** 除錯用：目前這一幀畫了幾個 draw call。 */
  stats() {
    const info = this.renderer.info.render;
    return { calls: info.calls, triangles: info.triangles, tier: this.tier, pixelRatio: this.renderer.getPixelRatio() };
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.controls.dispose();
    this._clearWorld();
    for (const geo of this.propGeometryCache.values()) geo.dispose();
    this.renderer.dispose();
  }
}

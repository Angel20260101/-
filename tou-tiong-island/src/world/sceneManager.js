/**
 * WebGL 場景管理。
 *
 * 效能守則（都在這個檔案裡被執行，不是口號）：
 *   1. 陰影是靜態烘焙的：shadowMap.autoUpdate = false，只在世界重建或光源
 *      改變時重算一次。島不會動，所以沒有必要每幀重算。
 *   2. 三盞靜態光：HemisphereLight（天空冷／地面暖）＋ 投影的主太陽
 *      ＋ 一盞不投影的冷色補光。三者的冷暖對比就是立體感的來源。
 *   3. 沒有後製、沒有模糊濾鏡、不使用任何貼圖（顏色全走頂點色）。
 *      tone mapping 不算後製：它沒有額外的 render pass，只是最終著色器
 *      寫出顏色前的一次轉換，不佔 draw call。
 *   4. 天空是 CSS 漸層，不是 3D 物件——換天氣只是改兩個色碼，零 draw call。
 *   5. 同型別道具與島民各收成一個 InstancedMesh；雲與雨各只有一個。
 *   6. 動畫迴圈只在地圖可見時跑，並依裝置分級限制幀率；
 *      使用者開啟「減少動態」時完全不跑，退回按需渲染。
 *   7. 故事畫面開啟時 pause()，地圖完全停止渲染。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, WEATHER } from './palette.js';
import { PROP_FACTORIES } from './props.js';
import { buildWorld } from './islandBuilder.js';
import { CameraController } from './cameraController.js';
import { detectTier, profileFor, prefersReducedMotion } from './perf.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CAST, CHARACTER_KINDS, buildCharacter, poseCharacter } from './characters.js';
import { makeRoute, sampleRoute } from './routes.js';

/**
 * 光比。這兩個值分開調，因為畫面平不平取決於「太陽／環境」的比值，
 * 而不是總亮度。
 *
 * palette.js 原本的 sunny 是 hemi 1.15、dir 1.45——半球光幾乎跟太陽一樣強。
 * 半球光不會被陰影遮擋，所以它等於是均勻打亮整座島的底光：它愈強，
 * 亮面與暗面的差距就愈小，畫面就愈平。這裡把 sunny 的比值從 1.26 拉到約 4.9。
 *
 * 絕對值刻意壓得比原本低，這點反直覺，值得寫下來免得有人又把它調高：
 * ACES 在高光段會把對比壓掉。強度拉太高時，亮面與暗面雙雙被推進曲線的肩部，
 * 線性空間 3.46 : 1.06 的差距，過完 ACES 只剩 0.96 : 0.80——陰影等於白做。
 * 要讓陰影看得見，畫面必須待在曲線的線性段，也就是強度要低、不是要高。
 *
 * 調整順序：先用比值決定立體感，再用 toneMappingExposure 決定明暗。
 * 不要用拉高強度的方式調亮，那會把對比一起吃掉。
 */
const HEMI_GAIN = 0.35;
const SUN_GAIN = 1.35;
/** 補光固定，不隨天氣起伏——它的工作是托住背光面，不是參與表演。 */
const FILL_INTENSITY = 0.21;

/** 會動的物件：不投影（影子會卡住），但照常受影。 */
const MOVING_SHADOW = { cast: false, receive: true };
/** 雲與雨：兩者都不要。 */
const NO_SHADOW = { cast: false, receive: false };

const MAX_CLOUDS = 10;
const MAX_RAIN = 90;
const RAIN_AREA = 26;
const RAIN_TOP = 9;

export class SceneManager {
  constructor({ canvas, labelLayer, skyLayer, veilLayer, map, onSelectIsland, onSelectInteraction }) {
    this.canvas = canvas;
    this.labelLayer = labelLayer;
    this.skyLayer = skyLayer;
    this.veilLayer = veilLayer ?? null;
    this.map = map;
    this.onSelectIsland = onSelectIsland;
    this.onSelectInteraction = onSelectInteraction;

    this.tier = detectTier();
    this.profile = profileFor(this.tier);
    this.reducedMotion = prefersReducedMotion();

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: this.profile.antialias,
      alpha: true,                 // 天空交給 CSS 漸層，WebGL 只畫島
      powerPreference: 'high-performance', stencil: false, depth: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.profile.pixelRatio));
    this.renderer.setClearAlpha(0);

    // 色彩管線。這兩行幾乎不花成本，但沒有它們，所有顏色都會偏灰偏淡：
    // 頂點色是 sRGB，沒宣告的話 three 會當成線性空間直接送進著色器。
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // 靜態陰影：開著，但不每幀更新。invalidate() 會在需要時補一次。
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(PALETTE.haze, 60, 150);
    this.camera = new THREE.PerspectiveCamera(34, 1, 1, 160);

    this.hemi = new THREE.HemisphereLight(0xffffff, PALETTE.sandSide, 1.1 * HEMI_GAIN);
    this.dir = new THREE.DirectionalLight(0xfff6e2, 1.3 * SUN_GAIN);
    this.dir.position.set(-14, 22, 10);

    // 主太陽是唯一投影的光源。shadow.camera 的範圍要剛好包住整座群島：
    // 開太大，陰影貼圖的解析度會被稀釋成糊的；開太小，邊緣的島會沒有陰影。
    this.dir.castShadow = true;
    const sm = this.profile.shadowMapSize;
    this.dir.shadow.mapSize.set(sm, sm);
    Object.assign(this.dir.shadow.camera, {
      left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 90,
    });
    // 這行是必要的，不是保險：three 的 LightShadow.updateMatrices() 只會更新
    // matrixWorld，不會重算投影矩陣。少了它，上面那六個值完全不生效，
    // 陰影相機會停在預設的 ±5，整座島都落在框外，陰影一個都看不到。
    this.dir.shadow.camera.updateProjectionMatrix();
    this.dir.shadow.bias = -0.0006;
    this.dir.shadow.normalBias = 0.045;   // 低多邊形＋flatShading 不加這個會長出陰影痤瘡
    this.dir.shadow.radius = 3;

    // 冷色補光，不投影。它負責把背光面從死黑拉回來，
    // 跟暖色的主太陽形成冷暖對比——這是塊面感的來源，不是亮度問題。
    this.fill = new THREE.DirectionalLight(0xbfd6ff, FILL_INTENSITY);
    this.fill.position.set(12, 14, -16);
    this.fill.castShadow = false;

    this.scene.add(this.hemi, this.dir, this.fill);

    // Lambert 的表面沒有粗糙度概念，光打上去是平的；Standard 走 PBR，
    // 同一個面會隨法線產生細微的明暗過渡，塊面之間才分得出來。
    // 全部維持 metalness = 0：這座島上沒有金屬，給了只會變髒。
    this.terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0,
    });
    this.propMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0,
    });
    this.cloudMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 1, metalness: 0,
      transparent: true, opacity: 0.95,
    });
    this.rainMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.foam, transparent: true, opacity: 0.55 });
    this.pickMaterial = new THREE.MeshBasicMaterial({ visible: false });

    // 角色材質。不開 flatShading——角色是圓的，塊面感留給地形與建築，
    // 臉和身體平滑一點才不會每個轉角都切出一道硬邊。
    this.characterMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.74, metalness: 0,
    });
    this._tmpColor = new THREE.Color();
    this.cast = [];

    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    this.instancedMeshes = [];
    this.propGeometryCache = new Map();
    this.pickTargets = [];
    this.labels = new Map();
    this.islandsById = new Map();
    this.animals = [];
    this.selectedId = null;

    this._buildWater();
    this._buildSky();
    this._buildRain();

    this.weather = WEATHER.sunny;
    this._lightTarget = {
      hemi: this.weather.hemiIntensity * HEMI_GAIN,
      dir: this.weather.dirIntensity * SUN_GAIN,
    };
    this._colourTarget = this._targetsFor(this.weather);

    this._raycaster = new THREE.Raycaster();
    this._paused = false;
    this._dirty = true;
    this._rafId = 0;
    this._lastFrame = 0;
    this._clock = 0;
    this._beam = null;
    this._beamUntil = 0;
    this._tick = this._tick.bind(this);
    this.animating = !this.reducedMotion;

    this.controls = new CameraController(
      this.camera, canvas, map.camera,
      () => this.invalidate(),
      (pos) => this._handleTap(pos),
    );

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  // ── 天空、海、雨 ────────────────────────────────────────
  _buildSky() {
    this.skyLayer.style.transition = 'background 1100ms ease';
    this._paintSky(WEATHER.sunny);
  }

  _paintSky(w) {
    this.skyLayer.style.background =
      `linear-gradient(170deg, ${w.skyTop} 0%, ${w.skyTop} 26%, ${w.skyBottom} 100%)`;
    // 太陽畫在 CSS 圖層上：晴天整顆亮、陰天只剩一團光暈、雨天收起來
    const sun = this.skyLayer.querySelector('.sky__sun');
    if (sun) sun.dataset.weather = w.id;
  }

  /**
   * 海。
   *
   * 不是無邊際的平面——那樣會把整個畫面填滿，天空與太陽就看不到了。
   * 改成剛好裝得下群島的一塊圓形海域，讓島像浮在暖色的天空上，
   * 這也是 V8 原型那種輕盈感的來源。
   */
  _buildWater(radius = 20, cx = 0, cz = 0) {
    if (this.water) { this.scene.remove(this.water); this.water.geometry.dispose(); }
    const disc = new THREE.CircleGeometry(radius, 48);
    disc.rotateX(-Math.PI / 2);
    disc.translate(cx, -0.34, cz);
    this.water = new THREE.Mesh(disc, this.water?.material
      ?? new THREE.MeshBasicMaterial({ color: PALETTE.water }));
    this.water.renderOrder = -2;
    this.scene.add(this.water);
  }

  _buildRain() {
    const geo = PROP_FACTORIES.raindrop();
    this.propGeometryCache.set('raindrop', geo);
    this.rain = new THREE.InstancedMesh(geo, this.rainMaterial, MAX_RAIN);
    this.rain.frustumCulled = false;
    this.rain.count = 0;
    this._rainState = Array.from({ length: MAX_RAIN }, () => ({
      x: (Math.random() - 0.5) * RAIN_AREA,
      z: (Math.random() - 0.5) * RAIN_AREA,
      y: Math.random() * RAIN_TOP,
      v: 7 + Math.random() * 5,
    }));
    this.scene.add(this.rain);
  }

  /**
   * 套用天氣。這是「上帝視角」的出口：玩家一天一次的選擇，
   * 決定整座群島的天空、海水、光線、雲量與有沒有下雨。
   */
  _targetsFor(w) {
    return {
      water: new THREE.Color(w.water),
      foam: new THREE.Color(w.foam),
      fog: new THREE.Color(w.fog),
      dir: new THREE.Color(w.dirColor),
      hemiSky: new THREE.Color(w.hemiSky ?? '#ffffff'),
      hemiGround: new THREE.Color(w.hemiGround ?? PALETTE.sandSide),
      cloud: new THREE.Color(w.cloudColour ?? PALETTE.towerWhite),
    };
  }

  setWeather(id, { animate = true } = {}) {
    const w = WEATHER[id] ?? WEATHER.sunny;
    const changed = this.weather?.id !== w.id;
    this.weather = w;
    this._paintSky(w);
    if (this.veilLayer) this.veilLayer.style.background = w.veil ?? 'transparent';
    this._colourTarget = this._targetsFor(w);
    this._lightTarget = { hemi: w.hemiIntensity * HEMI_GAIN, dir: w.dirIntensity * SUN_GAIN };
    if (this.clouds) {
      this.clouds.count = Math.min(w.clouds, MAX_CLOUDS);
      // 雲高跟著天氣走：晴天高而少，陰雨天低而密，低下來才進得了鏡頭
      const [lo, hi] = w.cloudY ?? [3.4, 6.8];
      for (let i = 1; i < MAX_CLOUDS; i++) {
        const c = this._cloudState?.[i];
        if (c) c.y = lo + ((i * 0.37) % 1) * (hi - lo);
      }
    }
    if (this.rain) this.rain.count = this.reducedMotion ? 0 : Math.min(w.rain, MAX_RAIN);
    if (changed && this._animalSource) this._buildAnimals();   // 島民換上這個天氣該做的事
    if (!animate) {
      this.water.material.color.copy(this._colourTarget.water);
      if (this.shallows) this.shallows.material.color.copy(this._colourTarget.foam);
      this.scene.fog.color.copy(this._colourTarget.fog);
      this.dir.color.copy(this._colourTarget.dir);
      this.hemi.color.copy(this._colourTarget.hemiSky);
      this.hemi.groundColor.copy(this._colourTarget.hemiGround);
      this.cloudMaterial.color.copy(this._colourTarget.cloud);
      this.hemi.intensity = this._lightTarget.hemi;
      this.dir.intensity = this._lightTarget.dir;
    }
    // 太陽的顏色與強度變了，烘焙好的陰影要重算一次
    this.renderer.shadowMap.needsUpdate = true;
    this.invalidate();
    return w;
  }

  // ── 建立／重建世界 ───────────────────────────────────────
  rebuild(progress, wish = {}) {
    this._clearWorld();
    const { islands, props, animals, boats } = buildWorld(this.map, progress, wish);
    this.islandsById.clear();

    for (const island of islands) {
      this.islandsById.set(island.island_id, island);
      if (island.geometry) {
        const mesh = new THREE.Mesh(island.geometry, this.terrainMaterial);
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = true;      // 島的側壁要在鄰島與海面上落下影子
        mesh.receiveShadow = true;
        this.worldGroup.add(mesh);
      }
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
      const mesh = this._instanced(type, matrices.length);
      if (!mesh) continue;
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
    }

    this._buildAnimals(animals);
    this._buildBoats(boats);
    this._buildClouds(islands);
    this._buildShallows(islands);
    this._buildLighthouse(islands);
    this._buildLabels(islands);

    this.worldBounds = islands.reduce((acc, i) => ({
      minX: Math.min(acc.minX, i.bounds.minX), maxX: Math.max(acc.maxX, i.bounds.maxX),
      minZ: Math.min(acc.minZ, i.bounds.minZ), maxZ: Math.max(acc.maxZ, i.bounds.maxZ),
    }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });

    const b = this.worldBounds;
    this._buildWater(
      Math.max(Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 5.5, 12),
      (b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2,
    );
    this.setWeather(this.weather.id, { animate: false });
    this.invalidate();
    return islands;
  }

  /**
   * 陰影的 cast 與 receive 要分開看，差別在成本與正確性：
   *   cast    烘焙進陰影貼圖，只在 needsUpdate 時算一次 → 會動的東西不能投影，
   *           否則影子會留在原地。所以島民、小船、雲一律 cast = false。
   *   receive 在主 pass 每幀計算 → 會動的東西受影完全正確。
   *           島民走進樹蔭下會變暗，這是免費的。
   */
  _instanced(type, count, material = this.propMaterial, shadow = { cast: true, receive: true }) {
    const factory = PROP_FACTORIES[type];
    if (!factory || !count) return null;
    if (!this.propGeometryCache.has(type)) this.propGeometryCache.set(type, factory());
    const mesh = new THREE.InstancedMesh(this.propGeometryCache.get(type), material, count);
    mesh.frustumCulled = false;
    mesh.castShadow = shadow.cast;
    mesh.receiveShadow = shadow.receive;
    this.worldGroup.add(mesh);
    this.instancedMeshes.push(mesh);
    return mesh;
  }

  /**
   * 島民：依目前天氣挑造型與行為，同一種造型收成一個 InstancedMesh。
   * 晴天熊在除草，雨天牠換上雨衣去整理花園——換的是模型與行為，不是多畫一次。
   */
  _buildAnimals(list = this._animalSource) {
    this._animalSource = list ?? [];
    for (const mesh of this._animalMeshes ?? []) {
      this.worldGroup.remove(mesh);
      mesh.dispose();
      const i = this.instancedMeshes.indexOf(mesh);
      if (i >= 0) this.instancedMeshes.splice(i, 1);
    }
    for (const mesh of this._castMeshes ?? []) {
      this.worldGroup.remove(mesh);
      mesh.dispose();
      const i = this.instancedMeshes.indexOf(mesh);
      if (i >= 0) this.instancedMeshes.splice(i, 1);
    }
    this._castMeshes = [];
    this._animalMeshes = [];
    this.animals = [];
    this.cast = [];

    const key = this.weather?.id === 'rainy' ? 'rainy' : 'default';
    const resolved = [];
    for (const a of this._animalSource) {
      const form = a.forms[key] ?? a.forms.default;
      if (!form?.type || form.hidden) continue;
      resolved.push({ ...a, ...form });
    }

    // 有列在選角表的走新的角色系統，其餘維持舊的整塊道具路徑。
    // 這讓遷移可以一隻一隻搬，而不是全有全無。
    this._buildCast(resolved.filter((a) => CAST[a.type]));

    const byType = new Map();
    for (const a of resolved) {
      if (CAST[a.type]) continue;
      if (!byType.has(a.type)) byType.set(a.type, []);
      byType.get(a.type).push(a);
    }
    for (const [type, group] of byType) {
      const mesh = this._instanced(type, group.length, this.propMaterial, MOVING_SHADOW);
      if (!mesh) continue;
      this._animalMeshes.push(mesh);
      group.forEach((a, i) => this.animals.push({ ...a, mesh, index: i }));
    }
    this._stepAnimals(this._clock ?? 0);
    this._stepCast(this._clock ?? 0);
  }

  /**
   * 角色用的單位幾何。
   *
   * 全部做成「單位尺寸」，實際大小交給每個部件的 scale——這樣全島所有角色的
   * 所有頭共用同一個 geometry，不管有幾隻、幾種動物。
   *
   * 每個幾何都補一條全白的 color 屬性：材質開著 vertexColors，而 InstancedMesh
   * 的 instanceColor 是「乘」上去的。沒有這條白色底，缺少的頂點屬性會被當成
   * 黑色，整群角色會變成黑影。
   */
  _charGeometry(kind) {
    if (!this._charGeo) this._charGeo = new Map();
    if (this._charGeo.has(kind)) return this._charGeo.get(kind);
    let g;
    switch (kind) {
      case 'rbox': g = new RoundedBoxGeometry(1, 1, 1, 2, 0.14); break;
      case 'cyl': g = new THREE.CylinderGeometry(1, 1, 1, 10); break;
      case 'cone': g = new THREE.ConeGeometry(1, 1, 8); break;
      default: g = new THREE.IcosahedronGeometry(1, 1); break;
    }
    const n = g.attributes.position.count;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    this._charGeo.set(kind, g);
    return g;
  }

  /**
   * 建立角色。
   *
   * 部件依**幾何種類**分批，不是依角色種類：所有角色的頭進同一個 InstancedMesh，
   * 所有身體進另一個。所以種類固定 4 個 draw call，角色數量不影響預算——
   * 這是「把島填滿」而不撞到 BUDGET.maxDrawCalls 的前提。
   */
  _buildCast(list) {
    const slots = new Map(CHARACTER_KINDS.map((k) => [k, 0]));
    const actors = [];

    for (const a of list) {
      const role = CAST[a.type];
      const seed = (a.base.x * 31.7 + a.base.z * 17.3) % 1;
      const character = buildCharacter({ species: role.species, held: role.held, seed });
      for (const p of character.parts) slots.set(p.kind, (slots.get(p.kind) ?? 0) + 1);

      // patrol 的資料原本只有「沿某軸來回 range 距離」。把它變成一條真正的路徑，
      // 角色就會等速走完並在端點平順地轉身，而不是用 cos>=0 瞬間翻面。
      let route = null;
      if (a.behaviour === 'patrol' && a.range > 0) {
        const ax = a.axis === 'z' ? 'z' : 'x';
        const from = { ...a.base }, to = { ...a.base };
        from[ax] -= a.range; to[ax] += a.range;
        route = makeRoute([from, to], { loop: false, smooth: false });
      }
      actors.push({
        character,
        activity: route ? 'walk' : (role.activity ?? 'idle'),
        route,
        base: a.base,
        rot: a.rot ?? 0,
        speed: a.speed ?? 0.5,
        phase: (seed * 97) % 10,
      });
    }

    this._castMeshes = [];      // 全部角色相關批次，重建時要清掉
    this._castPartMeshes = [];  // 只有會動的部件批次，每幀才需要重傳矩陣
    const meshByKind = new Map();
    for (const [kind, count] of slots) {
      if (!count) continue;
      const mesh = new THREE.InstancedMesh(this._charGeometry(kind), this.characterMaterial, count);
      mesh.frustumCulled = false;
      mesh.castShadow = false;      // 會動，投影會卡住——理由見 _instanced 的說明
      mesh.receiveShadow = true;
      this.worldGroup.add(mesh);
      this.instancedMeshes.push(mesh);
      this._castMeshes.push(mesh);
      this._castPartMeshes.push(mesh);
      meshByKind.set(kind, { mesh, next: 0 });
    }

    // 配位：每個部件拿到自己在該種類批次裡的索引，之後每幀只更新矩陣
    for (const actor of actors) {
      actor.slots = actor.character.parts.map((p) => {
        const b = meshByKind.get(p.kind);
        const i = b.next++;
        b.mesh.setColorAt(i, this._tmpColor.set(p.color));
        return { mesh: b.mesh, index: i };
      });
    }
    for (const { mesh } of meshByKind.values()) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.cast = actors;

    // 家具。從舊的 merge 幾何裡拆出來之後，它需要有人擺回角色旁邊。
    // 擺在角色的「基準位置」而不是當下位置：角色會走動，桌子不會跟著跑。
    const furniture = new Map();
    for (const a of list) {
      const f = CAST[a.type]?.furniture;
      if (!f) continue;
      if (!furniture.has(f)) furniture.set(f, []);
      furniture.set(f, [...furniture.get(f), a]);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);
    for (const [type, group] of furniture) {
      const mesh = this._instanced(type, group.length, this.propMaterial);
      if (!mesh) continue;
      this._castMeshes.push(mesh);
      group.forEach((a, i) => {
        // 擺在角色面前一點，不然角色會站在桌子正中央
        const r = a.rot ?? 0;
        m.compose(
          new THREE.Vector3(a.base.x + Math.sin(r) * 0.17, a.base.y, a.base.z + Math.cos(r) * 0.17),
          q.setFromEuler(e.set(0, r, 0)), one,
        );
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * 每幀擺出所有角色的姿勢。
   *
   * 矩陣組法：世界位置 × 朝向 → 部件基準位置 → 繞 pivot 的通道旋轉 → 縮放。
   * pivot 是關鍵：手臂的 pivot 在肩膀，所以舉手是繞著肩膀轉，
   * 不是繞自己的中心翻轉。
   */
  _stepCast(t) {
    if (!this.cast?.length) return;
    const m = new THREE.Matrix4();
    const mWorld = new THREE.Matrix4();
    const mPart = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);

    for (const actor of this.cast) {
      let x = actor.base.x, y = actor.base.y, z = actor.base.z, heading = actor.rot;
      if (actor.route) {
        // 等速前進：距離 = 速度 × 時間。不用 sin()，所以沒有兩端變慢的滑冰感。
        const s = sampleRoute(actor.route, (t + actor.phase) * actor.speed);
        x = s.x; y = s.y; z = s.z;
        heading = s.heading;      // 朝向直接取路徑切線，轉彎自然跟著轉
      }
      mWorld.compose(v.set(x, y, z), q.setFromEuler(e.set(0, heading, 0)), one);

      const pose = poseCharacter(actor.character, actor.activity, t, actor.phase, actor.speed);
      for (let i = 0; i < pose.length; i++) {
        const p = pose[i];
        const slot = actor.slots[i];
        const [px, py, pz] = p.pos;
        if (p.pivot) {
          const [ax, ay, az] = p.pivot;
          mPart.makeTranslation(px + ax, py + ay, pz + az);
          mPart.multiply(m.makeRotationFromEuler(e.set(p.rot[0], p.rot[1], p.rot[2])));
          mPart.multiply(m.makeTranslation(-ax, -ay, -az));
        } else {
          mPart.makeTranslation(px, py, pz);
          mPart.multiply(m.makeRotationFromEuler(e.set(p.rot[0], p.rot[1], p.rot[2])));
        }
        mPart.multiply(m.makeScale(p.scale[0], p.scale[1], p.scale[2]));
        slot.mesh.setMatrixAt(slot.index, m.multiplyMatrices(mWorld, mPart));
      }
    }
    for (const mesh of this._castPartMeshes ?? []) mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * 願望島的小船。玩家每放出一艘願望就多停一艘，浮在海面上輕輕搖。
   * 全部收成一個 InstancedMesh，所以不管停幾艘都只佔一個 draw call。
   */
  _buildBoats(list = []) {
    if (this._boatMesh) {
      this.worldGroup.remove(this._boatMesh);
      this._boatMesh.dispose();
      const i = this.instancedMeshes.indexOf(this._boatMesh);
      if (i >= 0) this.instancedMeshes.splice(i, 1);
      this._boatMesh = null;
    }
    this._boats = list;
    if (!list.length) return;
    this._boatMesh = this._instanced('boat', list.length, this.propMaterial, MOVING_SHADOW);
    this._stepBoats(this._clock ?? 0);
  }

  _stepBoats(t) {
    if (!this._boatMesh) return;
    const m = new THREE.Matrix4();
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3(1, 1, 1);
    this._boats.forEach((b, i) => {
      const bob = Math.sin(t * 1.1 + b.phase) * 0.035;
      const roll = Math.sin(t * 0.9 + b.phase) * 0.07;
      pos.set(b.x, -0.02 + bob, b.z);
      e.set(roll, b.rot, 0);
      q.setFromEuler(e);
      m.compose(pos, q, scl);
      this._boatMesh.setMatrixAt(i, m);
    });
    this._boatMesh.instanceMatrix.needsUpdate = true;
  }

  _buildClouds(islands) {
    const home = islands.find((i) => i.kind === 'home');
    this.skyAnchor = home?.sky_anchor
      ? { x: home.sky_anchor.x + (home.center?.x ?? 0), y: home.sky_anchor.y, z: home.sky_anchor.z + (home.center?.z ?? 0),
          interaction: home.sky_anchor.interaction, label: home.sky_anchor.label }
      : null;

    this.clouds = this._instanced('cloud', MAX_CLOUDS, this.cloudMaterial, NO_SHADOW);
    this._cloudState = Array.from({ length: MAX_CLOUDS }, (_, i) => {
      // 第 0 朵是打卡用的那一朵，固定在主島上空
      if (i === 0 && this.skyAnchor) {
        return { x: this.skyAnchor.x, y: this.skyAnchor.y, z: this.skyAnchor.z, drift: 0, scale: 1.15, isAnchor: true };
      }
      return {
        x: (Math.random() - 0.5) * 24, y: 3.4 + Math.random() * 3.4,
        z: (Math.random() - 0.5) * 22, drift: 0.16 + Math.random() * 0.3,
        scale: 0.65 + Math.random() * 0.7, isAnchor: false,
      };
    });
    this._stepClouds(0);
  }

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
    this.shallows = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: this.weather.foam }));
    this.shallows.renderOrder = -1;
    this.scene.add(this.shallows);
  }

  /**
   * 燈塔的燈與光束。
   * 燈塔代表的是「有人在指路」，所以點下去不是跳一個面板就算了——
   * 燈先亮起來，光束轉一圈掃過海面，然後才把求助資源交出來。
   */
  _buildLighthouse(islands) {
    for (const old of [this._lamp, this._beam]) if (old) this.scene.remove(old);
    this._lamp = null; this._beam = null;

    const home = islands.find((i) => i.kind === 'home');
    if (!home) return;
    const hex = this.map.home.landmarks.find((l) => l.type === 'lighthouse');
    if (!hex) return;
    const cfg = this.map.hex;
    const h = this.map.home.hexes.find((x) => x.q === hex.hex[0] && x.r === hex.hex[1]);
    const SQRT3 = Math.sqrt(3);
    const q = h.q + this.map.home.origin.q;
    const r = h.r + this.map.home.origin.r;
    const x = cfg.size * 1.5 * q;
    const z = cfg.size * SQRT3 * (r + q / 2);
    const y = (h.level ?? 0) * cfg.level_height + 2.08 * (hex.scale ?? 1);
    this._lampPos = { x, y, z };

    const lampGeo = PROP_FACTORIES.lighthouse_lamp();
    this.propGeometryCache.set('lighthouse_lamp', lampGeo);
    this._lamp = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: PALETTE.towerGlass, transparent: true, opacity: 0.55 }));
    this._lamp.position.set(x, y, z);
    this.scene.add(this._lamp);

    const beamGeo = new THREE.ConeGeometry(1.15, 7.2, 10, 1, true);
    beamGeo.rotateZ(Math.PI / 2);
    beamGeo.translate(3.6, 0, 0);
    this._beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
      color: PALETTE.towerGlass, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    }));
    this._beam.position.set(x, y - 0.1, z);
    this._beam.visible = false;
    this.scene.add(this._beam);
  }

  /** 點燈塔時呼叫：亮燈 ＋ 光束掃過，約 2.6 秒。 */
  lightTheLighthouse(duration = 2600) {
    if (!this._beam) return;
    this._beamUntil = performance.now() + duration;
    this._beam.visible = true;
    this.animating = true;
    this.invalidate();
  }

  _clearWorld() {
    for (const child of [...this.worldGroup.children]) {
      this.worldGroup.remove(child);
      if (child.isInstancedMesh) child.dispose();
      else if (child.geometry && (child.material === this.terrainMaterial || child.material === this.pickMaterial)) {
        child.geometry.dispose();
      }
    }
    this.pickTargets = [];
    this.instancedMeshes = [];
    this.animals = [];
    this._animalMeshes = [];
    this.clouds = null;
    this._boatMesh = null;   // 上面那圈已經 dispose 過了，別再清一次
  }

  // ── DOM 標籤 ────────────────────────────────────────────
  _buildLabels(islands) {
    this.labelLayer.replaceChildren();
    this.labels.clear();

    for (const island of islands) {
      const home = island.kind === 'home';
      // 主島的名字在左上角的 HUD 就有了，地圖上再放一個會壓到島本身
      // 主島的名字只是說明：島上的互動點本身就能點，名牌不該擋在它們上面
      const el = document.createElement(home ? 'div' : 'button');
      if (!home) el.type = 'button';
      el.className = `map-label${island.unlocked ? '' : ' map-label--locked'}${home ? ' map-label--home' : ''}`;
      el.dataset.islandId = island.island_id;
      let growth = '';
      if (island.kind === 'story' && island.unlocked) {
        growth = `<span class="map-label__sub">航線 ${island.growthCount}／${island.growthTotal}</span>`;
      } else if (island.kind === 'wish') {
        growth = `<span class="map-label__sub">${island.boats ? `小船 ${island.boats}` : '還沒有船'}${island.trees ? ` ・ 樹 ${island.trees}` : ''}</span>`;
      }
      const no = island.kind === 'story'
        ? `<span class="map-label__no">${String(island.order).padStart(2, '0')}</span>` : '';
      el.innerHTML = island.unlocked
        ? `<span class="map-label__head">${no}<span class="map-label__name">${island.name}</span></span>${growth}`
        : `<span class="map-label__head">${no}<span class="map-label__name">未探索</span></span>`;
      if (!island.unlocked) el.setAttribute('aria-label', `第 ${island.order} 座島，尚未探索`);
      if (!home) {
        el.addEventListener('click', (e) => { e.stopPropagation(); this.onSelectIsland?.(island.island_id); });
        this.labelLayer.appendChild(el);
        this.labels.set(island.island_id, {
          el, anchor: { ...island.center, y: island.center.y + (island.unlocked ? 1.5 : 0.9) },
        });
      }

      // 主島的互動點：文字一直看得到，直接點文字就進去
      if (island.kind === 'home') {
        // 「我的紀錄」搬到畫面上方的直排選單了，島上剩四個入口，角度重新平均分配
        const RING = { daily: 0, lighthouse: 90, wish: 180, letter: 270 };
        for (const lm of this.map.home.landmarks) {
          if (!lm.interaction) continue;
          this.labels.set(`spot:${lm.interaction}`, {
            el: this._spotLabel(lm.interaction, lm.label),
            anchor: this._landmarkAnchor(lm) ?? island.center,
            spot: true,
            ring: RING[lm.interaction] ?? 0,
          });
        }
      }
    }

    // 雲朵＝每日天氣打卡，排在主島正上方那一格
    if (this.skyAnchor) {
      this.labels.set('spot:daily', {
        el: this._spotLabel('daily', this.skyAnchor.label, 'map-spot--cloud'),
        anchor: { x: this.skyAnchor.x, y: this.skyAnchor.y + 0.55, z: this.skyAnchor.z },
        spot: true, ring: 0,
      });
    }
  }

  _spotLabel(id, text, extra = '') {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `map-spot ${extra}`.trim();
    el.dataset.interaction = id;
    el.innerHTML = `<span class="map-spot__text">${text}</span>`;
    el.addEventListener('click', (e) => { e.stopPropagation(); this.onSelectInteraction?.(id); });
    this.labelLayer.appendChild(el);
    return el;
  }

  _landmarkAnchor(lm) {
    const cfg = this.map.hex;
    const h = this.map.home.hexes.find((x) => x.q === lm.hex[0] && x.r === lm.hex[1]);
    if (!h) return null;
    const q = h.q + this.map.home.origin.q;
    const r = h.r + this.map.home.origin.r;
    const [dx, dz] = lm.offset ?? [0, 0];
    const LIFT = { lighthouse: 2.35, hut: 1.0, pier: 0.75, mailbox: 0.8, bench: 0.55, signpost: 0.8 };
    return {
      x: cfg.size * 1.5 * q + dx,
      y: (h.level ?? 0) * cfg.level_height,
      z: cfg.size * Math.sqrt(3) * (r + q / 2) + dz,
      lift: LIFT[lm.type] ?? 0.8,
    };
  }

  /**
   * 標籤定位。
   *
   * 故事島分散在海上，標籤直接掛在島上方就好。
   * 主島不一樣：五個入口擠在同一座小島上，照地標投影去擺一定會疊在一起，
   * 疊在一起就會點錯。所以主島的入口改成**固定環繞**——角度寫死、半徑隨島的
   * 投影大小縮放、再夾進畫面內。位置可預測，手指不會點到旁邊那一個。
   */
  _updateLabels() {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3();
    const project = (a) => {
      v.set(a.x, a.y, a.z).project(this.camera);
      return { x: (v.x * 0.5 + 0.5) * rect.width, y: (-v.y * 0.5 + 0.5) * rect.height, behind: v.z > 1 };
    };
    // 鏡頭拉近是為了看島上的細節，這時候五個名牌壓在上面最礙事。
    // 近了就淡掉、縮小，但還是可以點；滑過或鍵盤聚焦會回到全不透明（CSS 處理）。
    const near = THREE.MathUtils.clamp((this.controls.distance - 10) / 7, 0, 1);
    const fade = 0.34 + near * 0.66;
    const shrink = 0.8 + near * 0.2;

    // HUD 的標題卡與右側選單會蓋住標籤，所以把它們當成禁區：
    // 撞到就往下讓開，而不是讓標籤躲在按鈕後面點不到。
    const hudRects = this._hudRects ??= [];
    if (!hudRects.length) {
      for (const sel of ['.hud__brand', '.rail']) {
        const node = document.querySelector(sel);
        if (node) hudRects.push(node);
      }
    }
    const blocked = hudRects.map((n) => {
      const b = n.getBoundingClientRect();
      return { l: b.left - rect.left - 6, r: b.right - rect.left + 6, b: b.bottom - rect.top + 6 };
    });
    /** 這個 x 位置上，標籤的上緣最高能到哪裡（HUD 擋住的地方要再往下）。 */
    const floorFor = (cx, w) => {
      let top = 8;
      for (const z of blocked) {
        if (cx + w / 2 > z.l && cx - w / 2 < z.r) top = Math.max(top, z.b);
      }
      return top;
    };

    const place = (el, x, y, hidden) => {
      // 跑到畫面外的標籤就藏起來；硬擠回邊緣只會讓它們疊在一起、點錯
      const off = x < -30 || x > rect.width + 30 || y < -30 || y > rect.height + 30;
      if (hidden || off) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        return;
      }
      const w = el.offsetWidth || 72;
      const h = el.offsetHeight || 30;
      const cx = Math.min(Math.max(x, w / 2 + 8), rect.width - w / 2 - 8);
      const cy = Math.min(Math.max(y, floorFor(cx, w) + h), rect.height - 8);
      el.style.transform = `translate(-50%, -100%) translate(${cx}px, ${cy}px) scale(${shrink.toFixed(3)})`;
      el.style.opacity = fade.toFixed(3);
      el.style.pointerEvents = 'auto';
    };

    // 主島的中心與投影半徑，決定入口要排多大一圈
    const home = this.islandsById.get('island_home');
    let ring = null;
    if (home?.center) {
      const c = project({ x: home.center.x, y: home.center.y, z: home.center.z });
      const edge = project({ x: home.bounds.maxX, y: home.center.y, z: home.center.z });
      const radius = Math.min(Math.max(Math.abs(edge.x - c.x) + 46, 76), 128);
      ring = { ...c, radius };
    }

    // 主島入口先佔位（位置固定，不讓），島名後放，撞到就往下讓
    const taken = [];
    const remember = (el, x, y) => {
      const w = el.offsetWidth || 72;
      const h = el.offsetHeight || 30;
      taken.push({ l: x - w / 2, r: x + w / 2, t: y - h, b: y });
    };

    for (const entry of this.labels.values()) {
      if (entry.ring == null || !ring) continue;
      const a = (entry.ring - 90) * (Math.PI / 180);
      const x = ring.x + Math.cos(a) * ring.radius * 1.12;
      const y = ring.y + Math.sin(a) * ring.radius * 0.78;
      place(entry.el, x, y, ring.behind);
      if (!ring.behind) remember(entry.el, x, y);
    }

    // 島名：由近到遠依序擺。近的（畫面下方）先佔位，遠的撞到就往上讓——
    // 願望島就在主島旁邊，跟故事島的名牌會重疊，所以島名之間也必須互相避讓。
    const named = [];
    for (const entry of this.labels.values()) {
      if (entry.ring != null && ring) continue;
      named.push({ entry, p: project(entry.anchor) });
    }
    named.sort((a, b) => b.p.y - a.p.y);

    for (const { entry, p } of named) {
      const w = entry.el.offsetWidth || 72;
      const h = entry.el.offsetHeight || 30;
      const cx = Math.min(Math.max(p.x, w / 2 + 8), rect.width - w / 2 - 8);
      const top = floorFor(cx, w);
      let y = Math.max(p.y, top + h);
      let fits = false;
      let down = false;     // 一旦被迫往下，就一路往下，免得上下來回彈跳永遠喬不定
      for (let guard = 0; guard < 16; guard++) {
        const box = { l: cx - w / 2, r: cx + w / 2, t: y - h, b: y };
        const hit = taken.find((t) => !(box.r < t.l || box.l > t.r || box.b < t.t || box.t > t.b));
        if (!hit) { fits = true; break; }
        const up = hit.t - 6;
        // 預設往上讓（島名就不會蓋住島本身）；上面是 HUD 就只能往下，
        // 否則讓完又鑽回按鈕底下，等於沒讓。
        if (!down && up - h >= top) y = up;
        else { down = true; y = hit.b + h + 6; }
        if (y > rect.height - 8) break;
      }
      // 喬不出位置就藏起來。疊在一起會點錯島，那比少一個名牌糟糕得多；
      // 島本身還是點得到，轉一下或縮放一下它就會回來。
      place(entry.el, cx, y, p.behind || !fits);
      if (!p.behind && fits) remember(entry.el, cx, y);
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
    this.controls.flyTo({ target: island.center, distance: distance ?? (island.kind === 'home' ? 16 : 13) }, 700);
  }

  fitToWorld({ padding = 1.02, animate = false } = {}) {
    const b = this.worldBounds;
    if (!b || !Number.isFinite(b.minX)) return;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const target = new THREE.Vector3(cx, 0, cz);
    const { polar, azimuth } = this.controls;
    const dir = new THREE.Vector3(
      Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth),
    ).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, dir).normalize();
    const camUp = new THREE.Vector3().crossVectors(dir, right).normalize();
    const tanV = Math.tan((this.camera.fov * Math.PI) / 360);
    const tanH = tanV * this.camera.aspect;
    let need = this.controls.minDistance;
    const w = new THREE.Vector3();
    const pad = 3.2;   // 海域的邊緣
    for (const x of [b.minX - pad, b.maxX + pad]) {
      for (const z of [b.minZ - pad, b.maxZ + pad]) {
        for (const y of [0, 1.6]) {
          w.set(x, y, z).sub(target);
          const along = w.dot(dir);
          need = Math.max(need,
            Math.abs(w.dot(right)) / tanH * padding + along,
            Math.abs(w.dot(camUp)) / tanV * padding + along);
        }
      }
    }
    const distance = THREE.MathUtils.clamp(need, this.controls.minDistance, this.controls.maxDistance);
    if (animate) this.controls.flyTo({ target: { x: cx, y: 0, z: cz }, distance }, 600);
    else {
      this.controls.target.set(cx, 0, cz);
      this.controls.distance = distance;
      this.controls.apply();
    }
  }

  /** 預設視角：聚焦透中島。群島攤開來在直向手機上太小，先讓人看清楚自己的島。 */
  focusHome({ animate = false } = {}) {
    const home = this.islandsById.get('island_home');
    if (!home) return this.fitToWorld({ animate });
    // 主島與願望島一起入鏡：小船從碼頭開出去，要看得到它停在哪裡。
    // 鏡頭中心偏向主島（0.7），願望島落在畫面邊上就好，否則主島會被擠得太小。
    const wish = this.islandsById.get('island_wish');
    const hb = home.bounds;
    const hc = { x: (hb.minX + hb.maxX) / 2, z: (hb.minZ + hb.maxZ) / 2 };
    let target = { x: hc.x, y: 0, z: hc.z };
    let extent = 5.4;           // 島寬約 5 單位，外圈還要放得下一圈入口標籤
    if (wish) {
      const wb = wish.bounds;
      const mid = { x: (Math.min(hb.minX, wb.minX) + Math.max(hb.maxX, wb.maxX)) / 2,
                    z: (Math.min(hb.minZ, wb.minZ) + Math.max(hb.maxZ, wb.maxZ)) / 2 };
      target = { x: hc.x + (mid.x - hc.x) * 0.7, y: 0, z: hc.z + (mid.z - hc.z) * 0.7 };
      const reach = Math.max(
        Math.abs(wb.maxX - target.x), Math.abs(target.x - hb.minX),
        Math.abs(wb.maxZ - target.z), Math.abs(target.z - hb.minZ),
      );
      extent = Math.max(extent, reach + 1.3);
    }
    const tanH = Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect;
    const distance = THREE.MathUtils.clamp(
      extent / Math.max(tanH, 0.12), this.controls.minDistance, this.controls.maxDistance,
    );
    if (animate) this.controls.flyTo({ target, distance }, 650);
    else {
      this.controls.target.set(target.x, 0, target.z);
      this.controls.distance = distance;
      this.controls.apply();
    }
  }

  /** 「視角」鍵：在「看全部」與「回到透中島」之間切換。 */
  resetView() {
    this._wideView = !this._wideView;
    if (this._wideView) this.fitToWorld({ animate: true });
    else this.focusHome({ animate: true });
    return this._wideView;
  }

  // ── 動畫 ────────────────────────────────────────────────
  _stepAnimals(t) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3(1, 1, 1);
    const touched = new Set();

    for (const a of this.animals) {
      const p = t * a.speed + a.phase;
      pos.set(a.base.x, a.base.y, a.base.z);
      e.set(0, a.rot, 0);
      scl.set(1, 1, 1);

      switch (a.behaviour) {
        case 'patrol': {
          const sweep = Math.sin(p) * a.range;
          if (a.axis === 'z') pos.z += sweep; else pos.x += sweep;
          e.y = a.rot + (Math.cos(p) >= 0 ? 0 : Math.PI);
          pos.y += Math.abs(Math.sin(p * 6)) * 0.012;
          break;
        }
        case 'sip':
          pos.y += Math.sin(p) * 0.018;
          e.y = a.rot + Math.sin(p * 0.5) * 0.18;
          break;
        case 'breathe': {
          const s = 1 + Math.sin(p) * 0.045;
          scl.set(s, 1 + Math.sin(p) * 0.07, s);
          break;
        }
        case 'fish':
          pos.y += Math.sin(p) * 0.01;
          e.y = a.rot + Math.sin(p * 0.7) * 0.1;
          e.z = Math.sin(p * 1.6) * 0.05;
          break;
        case 'circle':
          pos.set(
            a.centre.x + Math.cos(p) * a.radius,
            a.base.y + a.height + Math.sin(p * 2) * 0.2,
            a.centre.z + Math.sin(p) * a.radius,
          );
          e.y = -p + Math.PI / 2;
          e.z = Math.sin(p * 3) * 0.12;
          break;
        default: break;
      }
      q.setFromEuler(e);
      m.compose(pos, q, scl);
      a.mesh.setMatrixAt(a.index, m);
      touched.add(a.mesh);
    }
    for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
  }

  _stepClouds(dt) {
    if (!this.clouds) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    for (let i = 0; i < MAX_CLOUDS; i++) {
      const c = this._cloudState[i];
      if (!c.isAnchor) {
        c.x += c.drift * dt;
        if (c.x > 16) c.x = -16;
      }
      const bob = c.isAnchor ? Math.sin(this._clock * 0.9) * 0.1 : 0;
      pos.set(c.x, c.y + bob, c.z);
      const s = c.scale * (c.isAnchor ? 1 + Math.sin(this._clock * 0.9) * 0.03 : 1);
      scl.set(s, s * 0.72, s);
      m.compose(pos, q, scl);
      this.clouds.setMatrixAt(i, m);
    }
    this.clouds.instanceMatrix.needsUpdate = true;
  }

  _stepRain(dt) {
    if (!this.rain || !this.rain.count) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < this.rain.count; i++) {
      const d = this._rainState[i];
      d.y -= d.v * dt;
      if (d.y < -0.5) {
        d.y = RAIN_TOP;
        d.x = (Math.random() - 0.5) * RAIN_AREA;
        d.z = (Math.random() - 0.5) * RAIN_AREA;
      }
      pos.set(d.x, d.y, d.z);
      m.compose(pos, q, scl);
      this.rain.setMatrixAt(i, m);
    }
    this.rain.instanceMatrix.needsUpdate = true;
  }

  _stepBeam(now) {
    if (!this._beam) return;
    const left = this._beamUntil - now;
    if (left <= 0) {
      if (this._beam.visible) {
        this._beam.visible = false;
        this._beam.material.opacity = 0;
        this._lamp.material.opacity = 0.55;
        this._lamp.scale.setScalar(1);
      }
      return;
    }
    // 前 0.4 秒亮起、最後 0.6 秒收掉，中間全亮並持續旋轉
    const fadeIn = Math.min(1, (2600 - left) / 400);
    const fadeOut = Math.min(1, left / 600);
    const k = Math.min(fadeIn, fadeOut);
    this._beam.material.opacity = 0.26 * k;
    this._beam.rotation.y = -this._clock * 1.7;
    this._lamp.material.opacity = 0.55 + 0.45 * k;
    this._lamp.scale.setScalar(1 + 0.5 * k);
  }

  _stepColours(dt) {
    const k = Math.min(1, dt * 2.4);
    const t = this._colourTarget;
    this.water.material.color.lerp(t.water, k);
    if (this.shallows) this.shallows.material.color.lerp(t.foam, k);
    this.scene.fog.color.lerp(t.fog, k);
    this.dir.color.lerp(t.dir, k);
    // 半球光的天空／地面色是低多邊形最吃重的訊號：整座島的色溫跟著天氣走
    this.hemi.color.lerp(t.hemiSky, k);
    this.hemi.groundColor.lerp(t.hemiGround, k);
    this.cloudMaterial.color.lerp(t.cloud, k);
    this.hemi.intensity += (this._lightTarget.hemi - this.hemi.intensity) * k;
    this.dir.intensity += (this._lightTarget.dir - this.dir.intensity) * k;
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
    const fps = this.animating ? Math.min(this.profile.maxFps, this.tier === 'mobile-low' ? 24 : 36) : this.profile.maxFps;
    const minInterval = 1000 / fps;
    if (this._lastFrame && now - this._lastFrame < minInterval - 1) {
      this._rafId = requestAnimationFrame(this._tick);
      return;
    }
    const dt = this._lastFrame ? Math.min((now - this._lastFrame) / 1000, 0.1) : 0.016;
    this._lastFrame = now;

    const beamActive = this._beamUntil > now;
    if (this.animating || beamActive) {
      this._clock += dt;
      this._stepAnimals(this._clock);
      this._stepCast(this._clock);
      this._stepBoats(this._clock);
      this._stepClouds(dt);
      this._stepRain(dt);
      this._stepBeam(now);
      this._stepColours(dt);
      this._dirty = true;
    } else {
      this._stepColours(dt);
    }

    if (this._dirty) {
      this._dirty = false;
      const d = this.controls.distance;
      this.scene.fog.near = d * 0.85;
      this.scene.fog.far = d * this.weather.fogScale;
      const far = Math.max(160, d * 2.8);
      if (this.camera.far !== far) { this.camera.far = far; this.camera.updateProjectionMatrix(); }
      this.renderer.render(this.scene, this.camera);
      this._updateLabels();
    }
    if (this.animating || beamActive) this._rafId = requestAnimationFrame(this._tick);
  }

  setAnimating(on) {
    this.animating = on && !this.reducedMotion;
    if (this.animating) this.invalidate();
  }

  pause() {
    this._paused = true;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = 0;
    this._lastFrame = 0;
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
    this.camera.fov = this.camera.aspect < 0.78 ? 46 : 34;
    this.camera.updateProjectionMatrix();
    if (this._wideView) this.fitToWorld(); else this.focusHome();
    this.invalidate();
  }

  stats() {
    const info = this.renderer.info.render;
    return {
      calls: info.calls, triangles: info.triangles, tier: this.tier,
      pixelRatio: this.renderer.getPixelRatio(), animating: this.animating, weather: this.weather.id,
    };
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.controls.dispose();
    this._clearWorld();
    for (const geo of this.propGeometryCache.values()) geo.dispose();
    this.renderer.dispose();
  }
}

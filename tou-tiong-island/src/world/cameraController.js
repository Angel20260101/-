/**
 * 等角視角的軌道控制。
 *
 * 不用 OrbitControls：這裡只需要旋轉與縮放，自己寫可以精準控制觸控行為，
 * 也能保證「沒有輸入就不渲染」——阻尼會逼著每一幀都重繪，所以刻意不做阻尼。
 * 手機單指拖曳＝旋轉、雙指捏合＝縮放；電腦滑鼠拖曳＝旋轉、滾輪＝縮放。
 * 短按且位移小於 8px 視為「點選」，交給 picking 處理。
 */
import * as THREE from 'three';

const TAP_MS = 350;
const TAP_PX = 8;
const DEG = Math.PI / 180;

export class CameraController {
  constructor(camera, dom, cfg, onChange, onTap) {
    this.camera = camera;
    this.dom = dom;
    this.onChange = onChange;
    this.onTap = onTap;

    this.target = new THREE.Vector3(...(cfg.default_target ?? [0, 0, 0]));
    this.distance = cfg.default_distance ?? 26;
    this.minDistance = cfg.min_distance ?? 10;
    this.maxDistance = cfg.max_distance ?? 46;
    this.polar = (cfg.polar_deg?.default ?? 42) * DEG;
    this.minPolar = (cfg.polar_deg?.min ?? 22) * DEG;
    this.maxPolar = (cfg.polar_deg?.max ?? 68) * DEG;
    this.azimuth = (cfg.azimuth_deg?.default ?? -38) * DEG;

    this.pointers = new Map();
    this.enabled = true;
    this._pinchStart = 0;
    this._downAt = 0;
    this._downPos = { x: 0, y: 0 };
    this._moved = 0;
    // 慣性用的角速度（每秒弧度）。放開手之後由 step() 繼續消化。
    this._velAz = 0;
    this._velPo = 0;

    this._bind();
    this.apply();
  }

  _bind() {
    const dom = this.dom;
    dom.style.touchAction = 'none';
    this._onDown = (e) => {
      if (!this.enabled) return;
      dom.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this._downAt = performance.now();
        this._downPos = { x: e.clientX, y: e.clientY };
        this._moved = 0;
      } else if (this.pointers.size === 2) {
        this._pinchStart = this._pinchDistance();
        this._pinchStartDist = this.distance;
      }
    };
    this._onMove = (e) => {
      if (!this.enabled || !this.pointers.has(e.pointerId)) return;
      const now = performance.now();
      const prev = this.pointers.get(e.pointerId);
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size === 1) {
        this._moved += Math.abs(dx) + Math.abs(dy);
        const dAz = -dx * 0.006, dPo = -dy * 0.005;
        this.azimuth += dAz;
        this.polar = THREE.MathUtils.clamp(this.polar + dPo, this.minPolar, this.maxPolar);
        // 記下瞬時角速度，放開手之後才有東西可以滑。用混合而不是直接覆蓋，
        // 免得最後一個微小的 pointermove 把前面累積的甩動歸零。
        const dt = Math.max(1, now - (this._lastMove ?? now)) / 1000;
        this._velAz = this._velAz * 0.4 + (dAz / dt) * 0.6;
        this._velPo = this._velPo * 0.4 + (dPo / dt) * 0.6;
        this._lastMove = now;
        this.apply();
      } else if (this.pointers.size === 2 && this._pinchStart > 0) {
        this._moved += 20;
        const ratio = this._pinchStart / Math.max(this._pinchDistance(), 1);
        this.distance = THREE.MathUtils.clamp(this._pinchStartDist * ratio, this.minDistance, this.maxDistance);
        this.apply();
      }
    };
    this._onUp = (e) => {
      const wasSingle = this.pointers.size === 1;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this._pinchStart = 0;
      if (!this.enabled) return;
      const quick = performance.now() - this._downAt < TAP_MS;
      if (wasSingle && quick && this._moved < TAP_PX) this.onTap?.(this._downPos);
    };
    this._onWheel = (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      // 乘法縮放，不是加減。線性的 step 會讓近處遠比遠處敏感：
      // 距離 6 時滾一格移動 1.2 單位（20%），距離 140 時同一格只有 0.86%，
      // 差了二十幾倍，所以手感永遠對不準。按比例縮放，每一格的「倍率」才一致。
      const factor = Math.exp(e.deltaY * 0.0014);
      this.distance = THREE.MathUtils.clamp(this.distance * factor, this.minDistance, this.maxDistance);
      this.apply();
    };

    dom.addEventListener('pointerdown', this._onDown);
    dom.addEventListener('pointermove', this._onMove);
    dom.addEventListener('pointerup', this._onUp);
    dom.addEventListener('pointercancel', this._onUp);
    dom.addEventListener('wheel', this._onWheel, { passive: false });
  }

  _pinchDistance() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** 把球面座標套到相機上，並通知場景需要重繪。 */
  /**
   * 慣性。
   *
   * 原本放開手指鏡頭就停死，使用者得靠一連串小拖曳去對準角度，而不是甩一下
   * 讓它滑到定位——這是「很難操控」的主因之一。puma 用 OrbitControls 的
   * dampingFactor 0.07；這裡自己做，因為我們的渲染是按需的，不能每幀無條件更新。
   *
   * @returns {boolean} 還在動嗎。還在動就讓場景排下一幀，停了就讓迴圈睡掉。
   */
  step(dt) {
    if (this.pointers.size) return false;          // 手還按著的時候不要插手
    const speed = Math.abs(this._velAz) + Math.abs(this._velPo);
    if (speed < 0.0015) { this._velAz = this._velPo = 0; return false; }
    const decay = Math.pow(0.0022, Math.min(dt, 0.05));   // 每秒衰減到約 0.2%
    this.azimuth += this._velAz * dt;
    this.polar = THREE.MathUtils.clamp(this.polar + this._velPo * dt, this.minPolar, this.maxPolar);
    // 撞到俯角上下限就把那個方向的速度吃掉，否則會沿著邊界一直滑
    if (this.polar <= this.minPolar || this.polar >= this.maxPolar) this._velPo = 0;
    this._velAz *= decay;
    this._velPo *= decay;
    this.apply();
    return true;
  }

  apply() {
    const sinPolar = Math.sin(this.polar);
    this.camera.position.set(
      this.target.x + this.distance * sinPolar * Math.sin(this.azimuth),
      this.target.y + this.distance * Math.cos(this.polar),
      this.target.z + this.distance * sinPolar * Math.cos(this.azimuth),
    );
    this.camera.lookAt(this.target);
    this.onChange?.();
  }

  /** 平滑地把鏡頭移到某個位置（只有這個動作會短暫開啟連續渲染）。 */
  flyTo({ target, distance }, duration = 650, onFrame) {
    const from = { t: this.target.clone(), d: this.distance };
    const to = { t: new THREE.Vector3(target.x, target.y ?? 0, target.z), d: distance ?? this.distance };
    const start = performance.now();
    const ease = (x) => 1 - Math.pow(1 - x, 3);
    const step = () => {
      const k = Math.min((performance.now() - start) / duration, 1);
      const e = ease(k);
      this.target.lerpVectors(from.t, to.t, e);
      this.distance = from.d + (to.d - from.d) * e;
      this.apply();
      onFrame?.();
      if (k < 1) requestAnimationFrame(step);
    };
    step();
  }

  dispose() {
    const dom = this.dom;
    dom.removeEventListener('pointerdown', this._onDown);
    dom.removeEventListener('pointermove', this._onMove);
    dom.removeEventListener('pointerup', this._onUp);
    dom.removeEventListener('pointercancel', this._onUp);
    dom.removeEventListener('wheel', this._onWheel);
  }
}

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
      const prev = this.pointers.get(e.pointerId);
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size === 1) {
        this._moved += Math.abs(dx) + Math.abs(dy);
        this.azimuth -= dx * 0.006;
        this.polar = THREE.MathUtils.clamp(this.polar - dy * 0.005, this.minPolar, this.maxPolar);
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
      const step = e.deltaY * 0.012;
      this.distance = THREE.MathUtils.clamp(this.distance + step, this.minDistance, this.maxDistance);
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

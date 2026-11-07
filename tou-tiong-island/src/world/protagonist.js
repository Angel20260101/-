/**
 * 主角：島上唯一的人，也是唯一由玩家操控的角色。
 *
 * 其他六十席動物各自有固定的位置或巡迴路線，位置是算出來的；主角相反，
 * 位置是「這一幀被推去哪裡」的結果。所以他不走 routes.js 那套弧長取樣，
 * 而是每幀積分速度，再問 walkable 能不能站。
 *
 * 兩種輸入並存，而且互相讓位：
 *   鍵盤／搖桿  連續的推力。一有推力就取消點擊的目的地——人改變主意時
 *               不該還被舊目的地拉著走
 *   點地面      設一個目的地，自己走過去，到了就停
 *
 * 轉身是漸進的而不是瞬間的：瞬間轉向會讓角色看起來像貼圖在滑，
 * 轉一個角速度上限出來，走路才有重量。
 */

const TAU = Math.PI * 2;

/** 把角度差收進 -π..π，轉身才會挑近的那一邊轉。 */
function wrapAngle(a) {
  return ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

export class Protagonist {
  /**
   * @param walkable  makeWalkable() 的結果
   * @param start     出生點 {x, z}
   * @param speed     最高速度（單位／秒）
   * @param accel     加速度。拉高會變得像冰上滑行，拉低會變得像瞬間啟動
   * @param turnRate  最大角速度（弧度／秒）
   */
  constructor({ walkable, start = { x: 0, z: 0 }, speed = 2.6, accel = 14, turnRate = 9 }) {
    this.walkable = walkable;
    this.speed = speed;
    this.accel = accel;
    this.turnRate = turnRate;

    // 出生點可能落在海上（存檔來自另一張地圖、或本島形狀改過），
    // 所以先找最近站得住的地方，不然主角一出生就動不了。
    const safe = walkable.nearestStand(start.x, start.z) ?? { x: 0, z: 0 };
    this.x = safe.x;
    this.z = safe.z;
    this.heading = 0;
    this.vx = 0;
    this.vz = 0;
    this.target = null;      // 點地面設的目的地
    this.moving = false;
  }

  /** 點地面：走過去。站不住的地方就找附近最近的，不要讓人點了沒反應。 */
  goTo(x, z) {
    const safe = this.walkable.nearestStand(x, z, 3);
    if (safe) this.target = safe;
  }

  stop() {
    this.target = null;
    this.vx = 0;
    this.vz = 0;
    this.moving = false;
  }

  /**
   * @param dt    秒
   * @param push  {x, z} 世界座標下的推力，長度 0..1。鍵盤與搖桿都換算成這個
   * @returns     true 代表這一幀有動，呼叫端據此決定要不要重畫
   */
  step(dt, push = null) {
    let wx = 0, wz = 0;

    if (push && (push.x || push.z)) {
      // 手動推一下就放棄原本的目的地——不然人會被舊目標拉回去
      this.target = null;
      const len = Math.hypot(push.x, push.z);
      wx = push.x / len; wz = push.z / len;
    } else if (this.target) {
      const dx = this.target.x - this.x, dz = this.target.z - this.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.12) {
        this.target = null;
      } else {
        wx = dx / dist; wz = dz / dist;
        // 快到了就減速，不然會衝過頭再彈回來
        if (dist < 0.6) { wx *= dist / 0.6; wz *= dist / 0.6; }
      }
    }

    // 朝想去的方向加速；沒有輸入就減速到停
    const tvx = wx * this.speed, tvz = wz * this.speed;
    const k = Math.min(1, this.accel * dt);
    this.vx += (tvx - this.vx) * k;
    this.vz += (tvz - this.vz) * k;

    const sp = Math.hypot(this.vx, this.vz);
    if (sp < 0.02) {
      this.vx = 0; this.vz = 0;
      const was = this.moving;
      this.moving = false;
      return was;
    }

    // 轉身有角速度上限，才有重量感
    const want = Math.atan2(this.vx, this.vz);
    const diff = wrapAngle(want - this.heading);
    const maxTurn = this.turnRate * dt;
    this.heading += Math.abs(diff) < maxTurn ? diff : Math.sign(diff) * maxTurn;

    const moved = this.walkable.move(this.x, this.z, this.x + this.vx * dt, this.z + this.vz * dt);
    // 真的被擋住（兩軸都沒動）就把速度歸零，否則會持續推牆而原地抖動
    if (moved.x === this.x && moved.z === this.z) {
      this.vx = 0; this.vz = 0;
      this.target = null;
    }
    this.x = moved.x;
    this.z = moved.z;
    this.moving = true;
    return true;
  }
}

/**
 * 鍵盤輸入。WASD 與方向鍵，回傳一個會自己更新的物件。
 *
 * 推力是**相對鏡頭**的：按 W 是「往畫面上方走」，不是「往世界 -Z 走」。
 * 鏡頭轉了之後，同一個鍵的意思要跟著轉，否則轉完視角就不知道該按哪了。
 */
export function keyboardPush(target = window) {
  const keys = new Set();
  const down = (e) => {
    const k = e.key.toLowerCase();
    if (KEYS[k]) { keys.add(k); e.preventDefault(); }
  };
  const up = (e) => keys.delete(e.key.toLowerCase());
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  // 切到別的視窗時鍵會卡住（keyup 送不到這裡），回來就會自己一直走
  const blur = () => keys.clear();
  window.addEventListener('blur', blur);

  return {
    /** @param azimuth 鏡頭的方位角，用來把按鍵換算成世界方向 */
    read(azimuth) {
      let fwd = 0, side = 0;
      for (const k of keys) { fwd += KEYS[k][0]; side += KEYS[k][1]; }
      if (!fwd && !side) return null;
      const sin = Math.sin(azimuth), cos = Math.cos(azimuth);
      return { x: side * cos - fwd * sin, z: -side * sin - fwd * cos };
    },
    get active() { return keys.size > 0; },
    dispose() {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    },
  };
}

// [前後, 左右]
const KEYS = {
  w: [1, 0], arrowup: [1, 0],
  s: [-1, 0], arrowdown: [-1, 0],
  a: [0, -1], arrowleft: [0, -1],
  d: [0, 1], arrowright: [0, 1],
};

/**
 * 虛擬搖桿。
 *
 * 跟鍵盤一樣回傳「相對鏡頭」的推力，所以兩者可以直接換——上層不需要
 * 知道人是用手指還是鍵盤在走。
 *
 * 用 pointer 事件而不是 touch：同一份程式在手寫筆、觸控螢幕筆電上也成立，
 * 而且 setPointerCapture 能保證手指滑出搖桿範圍之後還收得到事件——
 * 少了它，推到底的時候手指一離開圓圈就會卡住不動。
 */
export function joystickPush(el, { radius = 44 } = {}) {
  const knob = el.querySelector('.stick__knob');
  let vec = null;

  const place = (dx, dy) => {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const onMove = (e) => {
    const r = el.getBoundingClientRect();
    let dx = e.clientX - r.left - r.width / 2;
    let dy = e.clientY - r.top - r.height / 2;
    const len = Math.hypot(dx, dy);
    if (len > radius) { dx *= radius / len; dy *= radius / len; }
    place(dx, dy);
    vec = { x: dx / radius, y: dy / radius };
  };
  const onDown = (e) => { el.setPointerCapture(e.pointerId); vec = { x: 0, y: 0 }; onMove(e); };
  const onUp = (e) => {
    try { el.releasePointerCapture(e.pointerId); } catch { /* 已經放開了 */ }
    vec = null; place(0, 0);
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', (e) => { if (vec) onMove(e); });
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);

  return {
    read(azimuth) {
      if (!vec || (!vec.x && !vec.y)) return null;
      // 搖桿的 y 往下是正，但「往上推」要等於「往前走」，所以取負
      const fwd = -vec.y, side = vec.x;
      const sin = Math.sin(azimuth), cos = Math.cos(azimuth);
      return { x: side * cos - fwd * sin, z: -side * sin - fwd * cos };
    },
    get active() { return vec !== null; },
  };
}

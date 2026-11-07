/**
 * 動作。
 *
 * 每個動作是一個純函式：吃時間與相位，回傳各通道的位移／旋轉增量。
 * 全部用連續函式，不用三元運算切換狀態——`cos(p) >= 0 ? 0 : PI` 那種寫法
 * 會讓角色在中點瞬間翻面，是動作僵硬最常見的來源。
 *
 * 動作名稱對應美術文件裡每一隻的「日常動作與路線」。文件還為每一種寫了
 * 「點擊後的招呼與移動」，所以 greet 是一個獨立動作，不是把 idle 加大。
 */

// ── 小工具 ────────────────────────────────────────────────
/** 0→1 的循環相位。 */
const cycle = (t, period) => ((t % period) + period) / period;
/** 在 [a,b] 內是 1、外面是 0，邊緣有過渡——做「舉起、停住、放下」。 */
function bump(c, a, b, edge = 0.12) {
  if (c < a - edge || c > b + edge) return 0;
  if (c < a) return (c - a + edge) / edge;
  if (c > b) return (b + edge - c) / edge;
  return 1;
}
/** 三次緩入緩出，去掉線性變化的機械感。 */
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** 呼吸：所有靜止動作都疊這個，角色才不會像雕像。 */
const breathe = (t, rate = 0.5) => Math.sin(t * rate * Math.PI * 2);
/** 耳朵偶爾抖一下。大部分時間是 0，偶爾一個尖峰——規律的擺動會像節拍器。 */
const twitch = (t, seed = 0) => Math.max(0, Math.sin(t * 0.31 + seed)) ** 12;

/**
 * 四足步態：對角線同相。
 *
 * 左前與右後一起、右前與左後一起，這是小跑（trot）。四條腿各自為政或
 * 左右同相都會看起來像壞掉的玩具。
 */
function quadGait(p, amp = 0.5) {
  const a = Math.sin(p), b = -a;
  return {
    legFL: { rot: [a * amp, 0, 0] }, legBR: { rot: [a * amp, 0, 0] },
    legFR: { rot: [b * amp, 0, 0] }, legBL: { rot: [b * amp, 0, 0] },
  };
}

export const ACTIVITIES = {
  /** 站著：只有呼吸、耳朵偶爾動、重心緩慢轉移。所有動作的保底。 */
  idle: (t) => ({
    body: { pos: [0, breathe(t, 0.5) * 0.004, 0], rot: [0, Math.sin(t * 0.19) * 0.06, 0] },
    head: { rot: [0, Math.sin(t * 0.23) * 0.14, 0] },
    earL: { rot: [0, 0, twitch(t, 0) * 0.5] },
    earR: { rot: [0, 0, -twitch(t, 2.1) * 0.5] },
    tail: { rot: [0, Math.sin(t * 0.4) * 0.12, 0] },
  }),

  /**
   * 人走路。
   *
   * 不能沿用鳥的 waddle：那是左右搖的，因為鳥的重心在兩腿之間晃。
   * 人是前後擺——手臂與同側的腿反相（右腳前進時左手前擺），這是人走路
   * 最好認的特徵，少了它會變成殭屍。身體的起伏是每一步兩次，不是一次。
   */
  stride: (t, speed = 1) => {
    const p = t * 5.2 * speed;
    const s = Math.sin(p);
    return {
      legL: { rot: [s * 0.62, 0, 0] },
      legR: { rot: [-s * 0.62, 0, 0] },
      // 手臂與同側的腿反相，而且擺幅小一點——走路不是行軍
      armL: { rot: [-s * 0.42, 0, 0.06] },
      armR: { rot: [s * 0.42, 0, -0.06] },
      // 兩次起伏：每一步踩實的時候下沉一次
      body: { pos: [0, Math.abs(s) * 0.008, 0], rot: [0, 0, s * 0.03] },
      head: { rot: [0, 0, -s * 0.04] },
    };
  },

  /** 人站著。重心微微換腳，不是立正。 */
  stand: (t) => ({
    body: { pos: [0, breathe(t, 0.45) * 0.005, 0], rot: [0, Math.sin(t * 0.21) * 0.05, 0] },
    head: { rot: [Math.sin(t * 0.3) * 0.05, Math.sin(t * 0.17) * 0.2, 0] },
    armL: { rot: [Math.sin(t * 0.4) * 0.05, 0, 0.1] },
    armR: { rot: [Math.sin(t * 0.4 + 1) * 0.05, 0, -0.1] },
  }),

  /** 四足行走。身體隨步伐輕微起伏，頭跟著反向微擺。 */
  walk: (t, speed = 1) => {
    const p = t * 6 * speed;
    return {
      ...quadGait(p, 0.5),
      body: { pos: [0, Math.abs(Math.sin(p)) * 0.006, 0], rot: [0, 0, Math.sin(p) * 0.025] },
      head: { rot: [0, 0, -Math.sin(p) * 0.03] },
      tail: { rot: [0, Math.sin(p * 0.5) * 0.25, 0] },
    };
  },

  /**
   * 兔子的小跳。
   *
   * 文件特別註明「步行以後腳交替小跳，避免整隻模型直線滑動」。
   * 所以後腿同相、前腿同相，而且整隻會離地——這跟 walk 的對角步完全不同。
   */
  hop: (t, speed = 1) => {
    const p = t * 4.2 * speed;
    const air = Math.max(0, Math.sin(p));
    return {
      legBL: { rot: [-air * 0.9, 0, 0] }, legBR: { rot: [-air * 0.9, 0, 0] },
      legFL: { rot: [air * 0.6, 0, 0] }, legFR: { rot: [air * 0.6, 0, 0] },
      body: { pos: [0, air * 0.022, 0], rot: [-air * 0.22, 0, 0] },
      earL: { rot: [-air * 0.3, 0, 0.1] }, earR: { rot: [-air * 0.3, 0, -0.1] },
    };
  },

  /** 坐。後腿收起、前肢撐直、頭抬著——坐姿是四足能「拿東西」的前提。 */
  sit: (t) => ({
    // 身體只微微後仰。第一版給 -0.3（約 17°）看起來像向後跌倒——
    // 真的坐著的動物是臀部落地、胸口仍然挺著，不是整條脊椎仰起來。
    body: { pos: [0, -0.014 + breathe(t, 0.45) * 0.004, 0], rot: [-0.14, 0, 0] },
    legBL: { rot: [1.05, 0, 0] }, legBR: { rot: [1.05, 0, 0] },
    legFL: { rot: [0.18, 0, 0] }, legFR: { rot: [0.18, 0, 0] },
    head: { rot: [0.2, Math.sin(t * 0.26) * 0.16, 0] },
    earL: { rot: [0, 0, twitch(t, 0) * 0.5] },
    earR: { rot: [0, 0, -twitch(t, 1.4) * 0.5] },
  }),

  /** 坐著舉杯：抬到嘴邊、停一下、放下。文件寫的「坐姿舉杯、放杯、轉耳」。 */
  sip: (t) => {
    const c = cycle(t, 5.0);
    const lift = ease(bump(c, 0.3, 0.6));
    return {
      ...ACTIVITIES.sit(t),
      legFR: { rot: [0.18 - 1.4 * lift, 0, -0.2 * lift] },
      head: { rot: [0.2 + 0.2 * lift, 0, 0] },
    };
  },

  /** 看書：雙前肢捧著，頭規律地左右掃，偶爾翻頁。 */
  read: (t) => {
    const turn = ease(bump(cycle(t, 7.5), 0.82, 0.9, 0.05));
    return {
      ...ACTIVITIES.sit(t),
      legFL: { rot: [-0.9, 0, 0.12] },
      legFR: { rot: [-0.9 - turn * 0.7, 0, -0.12] },
      head: { rot: [0.42, Math.sin(t * 0.5) * 0.17, 0] },
    };
  },

  /** 澆水：身體微傾帶動水壺，停靠時仍有輕微抬頭（陸龜）。 */
  water: (t) => {
    const pour = ease(bump(cycle(t, 6), 0.35, 0.75));
    return {
      body: { rot: [0.1 + 0.12 * pour, 0, 0], pos: [0, breathe(t, 0.4) * 0.003, 0] },
      legFR: { rot: [-0.5 - 0.5 * pour, 0, -0.15] },
      held: { rot: [0, 0, -1.0 * pour] },
      head: { rot: [0.3 - 0.15 * pour, Math.sin(t * 0.22) * 0.1, 0] },
    };
  },

  /** 搬運：走路加上壓低的身體與前伸的前肢。箱子不能擋住眼睛。 */
  carry: (t, speed = 1) => {
    const p = t * 5.4 * speed;
    return {
      ...quadGait(p, 0.38),
      legFL: { rot: [-0.8, 0, 0.1] }, legFR: { rot: [-0.8, 0, -0.1] },
      body: { pos: [0, Math.abs(Math.sin(p)) * 0.004 - 0.006, 0], rot: [0.08, 0, 0] },
      head: { rot: [0.1, 0, 0] },
    };
  },

  /** 洗／擦拭：兩前肢交替來回，尾巴緩慢擺動（浣熊）。 */
  wash: (t) => ({
    ...ACTIVITIES.sit(t),
    legFL: { rot: [-1.0 + Math.sin(t * 3.2) * 0.3, 0, 0.14] },
    legFR: { rot: [-1.0 + Math.sin(t * 3.2 + Math.PI) * 0.3, 0, -0.14] },
    head: { rot: [0.5, Math.sin(t * 0.8) * 0.08, 0] },
    tail: { rot: [0, Math.sin(t * 0.7) * 0.3, 0] },
  }),

  /** 揉陶／搬箱這類工作：肩膀帶動，完成一輪後抬頭（棕熊）。 */
  work: (t) => {
    const c = cycle(t, 6.5);
    const look = ease(bump(c, 0.78, 0.95));
    const push = Math.sin(t * 2.4) * (1 - look);
    return {
      ...ACTIVITIES.sit(t),
      legFL: { rot: [-1.05 + push * 0.25, 0, 0.16] },
      legFR: { rot: [-1.05 - push * 0.25, 0, -0.16] },
      body: { rot: [0.18 - look * 0.18, 0, 0], pos: [0, -0.01, 0] },
      head: { rot: [0.55 - look * 0.65, Math.sin(t * 0.3) * 0.08, 0] },
    };
  },

  /** 泡腳／泡湯：身體半沉、腳掌划動、耳朵轉動（水豚、水獺）。 */
  soak: (t) => ({
    body: { pos: [0, -0.03 + breathe(t, 0.35) * 0.005, 0], rot: [-0.12, 0, 0] },
    legBL: { rot: [1.3 + Math.sin(t * 1.6) * 0.18, 0, 0] },
    legBR: { rot: [1.3 + Math.sin(t * 1.6 + 1.1) * 0.18, 0, 0] },
    legFL: { rot: [0.1, 0, 0] }, legFR: { rot: [0.1, 0, 0] },
    head: { rot: [0.05, Math.sin(t * 0.21) * 0.2, 0] },
    earL: { rot: [0, 0, twitch(t, 0.5) * 0.6] },
    earR: { rot: [0, 0, -twitch(t, 2.6) * 0.6] },
  }),

  /** 曬背：海豹。前鰭推一下身體、抬頭、再伏下但保留微動。 */
  bask: (t) => {
    const c = cycle(t, 9);
    const lift = ease(bump(c, 0.3, 0.48));
    return {
      body: { pos: [0, breathe(t, 0.3) * 0.004, 0], rot: [-0.05 * lift, 0, 0] },
      head: { rot: [-0.45 * lift, Math.sin(t * 0.2) * 0.12, 0] },
      flipL: { rot: [0, 0, -0.5 * lift] },
      flipR: { rot: [0, 0, 0.5 * lift] },
      tail: { rot: [0, Math.sin(t * 0.45) * 0.14, 0] },
    };
  },

  /** 搖擺走：企鵝。雙腳交替、身體左右傾、雙翼小幅平衡。 */
  waddle: (t, speed = 1) => {
    const p = t * 4.4 * speed;
    const s = Math.sin(p);
    return {
      legL: { rot: [s * 0.45, 0, 0] }, legR: { rot: [-s * 0.45, 0, 0] },
      body: { rot: [0, 0, s * 0.16], pos: [0, Math.abs(s) * 0.005, 0] },
      wingL: { rot: [0, 0, 0.25 + s * 0.2] },
      wingR: { rot: [0, 0, -0.25 + s * 0.2] },
      head: { rot: [0, 0, -s * 0.1] },
    };
  },

  /** 划行：鴨子。腳掌簡單交替，靠岸時轉頭梳翅。 */
  paddle: (t, speed = 1) => ({
    legL: { rot: [Math.sin(t * 5 * speed) * 0.5, 0, 0] },
    legR: { rot: [Math.sin(t * 5 * speed + Math.PI) * 0.5, 0, 0] },
    body: { pos: [0, breathe(t, 0.8) * 0.004, 0], rot: [0, 0, Math.sin(t * 1.3) * 0.05] },
    head: { rot: [0, Math.sin(t * 0.4) * 0.3, 0] },
  }),

  /** 涉水：紅鶴。單腳站立換腳，脖子緩慢彎伸。 */
  wade: (t) => {
    const c = cycle(t, 14);
    const swap = ease(bump(c, 0.5, 0.95, 0.1));
    return {
      legL: { rot: [swap * 1.2, 0, 0] },
      legR: { rot: [(1 - swap) * 1.2, 0, 0] },
      head: { rot: [Math.sin(t * 0.18) * 0.5 + 0.2, Math.sin(t * 0.12) * 0.3, 0] },
      body: { pos: [0, breathe(t, 0.25) * 0.004, 0] },
    };
  },

  /** 棲停：貓頭鷹。轉頭、小幅張翼。文件註明轉頭幅度要克制，不整圈旋轉。 */
  perch: (t) => {
    const look = Math.sin(t * 0.33);
    return {
      head: { rot: [0, look * 0.75, 0] },          // 最多約 43°，不是整圈
      wingL: { rot: [0, 0, 0.1 + twitch(t, 1) * 0.5] },
      wingR: { rot: [0, 0, -0.1 - twitch(t, 1) * 0.5] },
      body: { pos: [0, breathe(t, 0.4) * 0.003, 0] },
      earL: { rot: [0, 0, 0.12] }, earR: { rot: [0, 0, -0.12] },
    };
  },

  /**
   * 打招呼：點擊之後的反應。
   *
   * 文件為每一種都寫了這一段，共通結構是「放下手邊物品 → 轉向鏡頭 →
   * 抬前肢揮兩次 → 回到原動作」。這裡做轉向與揮手；位移由呼叫端負責，
   * 因為「向側邊走一步再回來」需要知道牠的路線。
   */
  greet: (t) => {
    const c = cycle(t, 2.6);
    const wave = Math.sin(c * Math.PI * 4) * ease(bump(c, 0.15, 0.8));
    return {
      ...ACTIVITIES.sit(t),
      legFR: { rot: [-1.9, 0, wave * 0.5 - 0.2] },
      wingR: { rot: [0, 0, -1.2 + wave * 0.6] },
      flipR: { rot: [0, 0, 0.9 + wave * 0.5] },
      head: { rot: [-0.1, 0, wave * 0.12] },
      tail: { rot: [0, Math.sin(t * 6) * 0.35, 0] },   // 狗搖尾；其他種幅度小看不出來
    };
  },
};

/** 每種骨架的預設移動動作——同一個「走」在三種身體上是不同的事。 */
export const MOVE_BY_RIG = { quad: 'walk', bird: 'waddle', pinniped: 'bask', biped: 'stride' };

/**
 * 算出某個角色每個部件的最終變換。
 *
 * 純計算，不碰 three 物件，方便單獨測試，也避免每幀配置新物件。
 */
export function poseCharacter(character, activity, t, phase = 0, speed = 1) {
  const fn = ACTIVITIES[activity] ?? ACTIVITIES.idle;
  const d = fn(t + phase, speed);
  const carry = d.body?.pos ?? null;
  const out = [];
  for (const p of character.parts) {
    const ch = d[p.channel] ?? null;
    // 跟隨另一個通道的部件（手持物跟前肢）：兩者旋轉相加，
    // 所以水壺既跟著前肢移動，又保有自己的傾倒。
    const lead = p.follow ? d[p.follow] ?? null : null;
    const base = p.tilt ?? [0, 0, 0];
    out.push({
      kind: p.kind,
      color: p.color,
      scale: p.scale,
      pos: [
        p.pos[0] + (ch?.pos?.[0] ?? 0) + (p.channel === 'body' ? 0 : carry?.[0] ?? 0),
        p.pos[1] + (ch?.pos?.[1] ?? 0) + (p.channel === 'body' ? 0 : carry?.[1] ?? 0),
        p.pos[2] + (ch?.pos?.[2] ?? 0) + (p.channel === 'body' ? 0 : carry?.[2] ?? 0),
      ],
      rot: [
        base[0] + (ch?.rot?.[0] ?? 0) + (lead?.rot?.[0] ?? 0),
        base[1] + (ch?.rot?.[1] ?? 0) + (lead?.rot?.[1] ?? 0),
        base[2] + (ch?.rot?.[2] ?? 0) + (lead?.rot?.[2] ?? 0),
      ],
      pivot: p.pivot ?? null,
    });
  }
  return out;
}

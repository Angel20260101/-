/**
 * 分層角色系統。
 *
 * 角色不是一塊 merge 好的幾何，而是一組**有名字、能各自動**的部件。
 * 這是「兔子舉杯喝茶、桌子不動」與「整隻連桌子一起上下晃」的差別——
 * 舊版把家具和角色 merge 在同一個 geometry 裡，動作只能整塊套用，
 * 所以不管寫什麼行為，看起來都像在滑動或呼吸。
 *
 * 一套骨架同時服務 Q 版人形與擬人化動物：
 * 身體、四肢、手持物、動作全部共用，差別只在頭部配件（耳朵、吻部、尾巴）與配色。
 * 想加一種動物，只要在 SPECIES 多一筆；想加一個動作，只要在 ACTIVITIES 多一筆。
 *
 * 繪製成本：部件依**幾何種類**分批（不是依角色種類），全島所有角色的頭共用
 * 一個 InstancedMesh、所有身體共用另一個。種類固定 6 種，所以角色再多也只佔 6 個
 * draw call——加角色不會再吃預算，這是能把島填滿的前提。
 */
import { PALETTE } from './palette.js';

/** Q 版比例：頭佔全高約四成。寫死在這裡，讓所有角色一致。 */
export const CHIBI = { head: 0.17, body: 0.14, limb: 0.045, total: 0.42 };

/** 膚色與髮色，給人形用。動物走 SPECIES 自己的毛色。 */
const SKIN = [0xf3cfae, 0xe6b48f, 0xcf9670, 0xf0c4a0];
const HAIR = [0x2e2522, 0x4a3426, 0x1f1d22, 0x6b4a33];
/** 上班族的衣服色：低彩度，避免整座島變成遊樂園。 */
const SHIRT = [0x6f7fb5, 0x58a6a6, 0xe8c547, 0xf2a1a1, 0x8fb37a, 0xb58fd0, 0xd98f6a];

/**
 * 物種定義。
 *
 * head 回傳頭部以上的額外部件（耳朵、吻部）；身體與四肢由 buildCharacter 統一產生。
 * 座標都以角色腳底為原點、單位是世界單位，跟 props.js 的慣例一致。
 */
export const SPECIES = {
  human: {
    fur: null,                      // 用膚色
    hair: true,
    head: (c) => [
      { kind: 'sphere', pos: [0, 0.30, 0.055], scale: [0.03, 0.03, 0.03], color: 0x2a2320, channel: 'head' },
    ],
  },
  rabbit: {
    fur: PALETTE.furRabbit, inner: PALETTE.furRabbitIn,
    head: (c) => [
      // 長耳朵分左右，各自有 channel，這樣才能一前一後地抖
      // 耳朵拉開到 ±0.052 並往外傾 12°：原本 ±0.035 兩隻幾乎疊在一起，
      // 遠看只剩一根尖角，認不出是兔子
      { kind: 'cone', pos: [-0.052, 0.415, 0], scale: [0.027, 0.16, 0.027], color: c.fur, channel: 'earL', tilt: [0, 0, 0.21] },
      { kind: 'cone', pos: [0.052, 0.415, 0.004], scale: [0.027, 0.16, 0.027], color: c.fur, channel: 'earR', tilt: [0, 0, -0.21] },
      // 吻部：動物跟人的辨識差異幾乎全靠這一塊，要夠大才看得出來
      { kind: 'sphere', pos: [0, 0.298, 0.068], scale: [0.03, 0.024, 0.026], color: c.inner, channel: 'head' },
    ],
  },
  bear: {
    fur: PALETTE.furBear, inner: PALETTE.furBearDark,
    head: (c) => [
      { kind: 'sphere', pos: [-0.05, 0.37, -0.01], scale: [0.028, 0.028, 0.02], color: c.inner, channel: 'head' },
      { kind: 'sphere', pos: [0.05, 0.37, -0.01], scale: [0.028, 0.028, 0.02], color: c.inner, channel: 'head' },
      { kind: 'sphere', pos: [0, 0.295, 0.072], scale: [0.034, 0.028, 0.03], color: c.inner, channel: 'head' },
    ],
  },
  cat: {
    fur: PALETTE.furCat, inner: PALETTE.furRabbitIn,
    head: (c) => [
      { kind: 'cone', pos: [-0.045, 0.375, 0], scale: [0.024, 0.055, 0.024], color: c.fur, channel: 'head' },
      { kind: 'cone', pos: [0.045, 0.375, 0], scale: [0.024, 0.055, 0.024], color: c.fur, channel: 'head' },
      { kind: 'sphere', pos: [0, 0.296, 0.07], scale: [0.028, 0.022, 0.024], color: c.inner, channel: 'head' },
    ],
  },
  fox: {
    fur: PALETTE.furFox, inner: 0xfaf0e4,
    head: (c) => [
      { kind: 'cone', pos: [-0.046, 0.378, 0], scale: [0.025, 0.06, 0.025], color: c.fur, channel: 'head' },
      { kind: 'cone', pos: [0.046, 0.378, 0], scale: [0.025, 0.06, 0.025], color: c.fur, channel: 'head' },
      { kind: 'cone', pos: [0, 0.288, 0.075], scale: [0.022, 0.05, 0.022], color: c.inner, channel: 'head', tilt: [Math.PI / 2, 0, 0] },
    ],
  },
};

/**
 * 手持物。
 *
 * 掛在 'held' 通道上，所以它跟著手走——手舉到嘴邊，杯子就到嘴邊。
 * 這是「喝茶看起來像喝茶」的關鍵：舊版杯子被 merge 在桌上，永遠舉不起來。
 */
export const HELD = {
  teacup: { kind: 'cyl', scale: [0.026, 0.028, 0.026], color: PALETTE.teaCup },
  coffee: { kind: 'cyl', scale: [0.024, 0.034, 0.024], color: PALETTE.clothWarm },
  book: { kind: 'rbox', scale: [0.055, 0.07, 0.016], color: PALETTE.flowerB },
  laptop: { kind: 'rbox', scale: [0.07, 0.05, 0.012], color: PALETTE.stone },
  rod: { kind: 'cyl', scale: [0.006, 0.17, 0.006], color: PALETTE.woodDark },
  brolly: { kind: 'cone', scale: [0.09, 0.07, 0.09], color: PALETTE.flowerA },
  watering: { kind: 'rbox', scale: [0.05, 0.045, 0.035], color: PALETTE.towerRed },
  none: null,
};

/**
 * 動作。
 *
 * 每個動作是一個純函式：吃時間 t（秒）與相位，回傳各通道的位移／旋轉。
 * 全部用等速或緩入緩出的連續函式，不用三元運算切換狀態——舊版
 * `cos(p) >= 0 ? 0 : Math.PI` 那種寫法會讓角色在中點瞬間轉身，是動作僵硬的主因。
 *
 * 回傳值為增量（delta），由 poseCharacter 疊加到部件的基準姿勢上。
 */
export const ACTIVITIES = {
  /** 喝東西：手把杯子送到嘴邊，停一下，放下。頭微低配合。 */
  sip: (t) => {
    const c = cycle(t, 4.2);                 // 一個完整週期 4.2 秒
    const lift = ease(bump(c, 0.25, 0.75));  // 0→1→0，兩端平滑
    return {
      armR: { rot: [-1.35 * lift, 0, -0.22 * lift] },
      head: { rot: [0.16 * lift, 0, 0], pos: [0, -0.004 * lift, 0] },
      body: { pos: [0, breathe(t, 0.6) * 0.004, 0] },
    };
  },
  /** 看書／看筆電：雙手捧著，頭規律地左右掃視。 */
  read: (t) => ({
    armL: { rot: [-1.15, 0, 0.1] },
    armR: { rot: [-1.15, 0, -0.1] },
    head: { rot: [0.22, Math.sin(t * 0.55) * 0.16, 0] },
    body: { pos: [0, breathe(t, 0.5) * 0.003, 0] },
  }),
  /** 打字：兩手交替小幅上下，頭幾乎不動——久坐的樣子。 */
  type: (t) => ({
    armL: { rot: [-1.3 + Math.sin(t * 7) * 0.07, 0, 0.12] },
    armR: { rot: [-1.3 + Math.sin(t * 7 + 1.7) * 0.07, 0, -0.12] },
    head: { rot: [0.3, Math.sin(t * 0.3) * 0.05, 0] },
  }),
  /** 午睡：只有呼吸，幅度比站著大一點。 */
  nap: (t) => ({
    body: { pos: [0, breathe(t, 0.45) * 0.009, 0], rot: [0, 0, 0.06] },
    head: { rot: [0.1, 0, 0.14] },
  }),
  /** 釣魚：竿子極緩慢地晃，偶爾抖一下（像有魚在試餌）。 */
  fish: (t) => {
    const nibble = Math.max(0, Math.sin(t * 0.37)) ** 9;   // 大部分時間是 0，偶爾一個尖峰
    return {
      armR: { rot: [-0.95 + nibble * 0.3, 0, -0.1] },
      held: { rot: [Math.sin(t * 0.5) * 0.06 + nibble * 0.4, 0, 0] },
      head: { rot: [0.12, Math.sin(t * 0.28) * 0.1, 0] },
      body: { pos: [0, breathe(t, 0.4) * 0.003, 0] },
    };
  },
  /** 澆花：身體微前傾，壺口規律傾倒。 */
  tend: (t) => {
    const pour = ease(bump(cycle(t, 5), 0.3, 0.8));
    return {
      armR: { rot: [-0.7 - 0.5 * pour, 0, -0.15] },
      held: { rot: [0, 0, -0.9 * pour] },
      body: { rot: [0.12 + 0.08 * pour, 0, 0] },
      head: { rot: [0.3, 0, 0] },
    };
  },
  /** 揮手：單手舉高左右擺，另一手自然垂下。 */
  wave: (t) => ({
    armR: { rot: [-2.3, 0, Math.sin(t * 4.5) * 0.45 - 0.2] },
    armL: { rot: [0.08, 0, 0.08] },
    head: { rot: [-0.06, Math.sin(t * 2.2) * 0.1, 0] },
    body: { pos: [0, breathe(t, 0.9) * 0.004, 0] },
  }),
  /** 聊天：身體小幅轉向對方，手比劃。 */
  chat: (t) => ({
    armR: { rot: [-0.5 + Math.sin(t * 2.3) * 0.3, 0, -0.3] },
    head: { rot: [0, Math.sin(t * 1.1) * 0.2, Math.sin(t * 1.7) * 0.06] },
    body: { rot: [0, Math.sin(t * 0.9) * 0.08, 0] },
  }),
  /** 走路：手腳反相擺動＋身體上下起伏。給沿路徑移動的角色用。 */
  walk: (t, speed = 1) => {
    const p = t * 7 * speed;
    return {
      armL: { rot: [Math.sin(p) * 0.55, 0, 0.06] },
      armR: { rot: [-Math.sin(p) * 0.55, 0, -0.06] },
      legL: { rot: [-Math.sin(p) * 0.6, 0, 0] },
      legR: { rot: [Math.sin(p) * 0.6, 0, 0] },
      // 每一步踩下去時重心落一次，所以頻率是手腳的兩倍
      body: { pos: [0, Math.abs(Math.sin(p)) * 0.012, 0], rot: [0, 0, Math.sin(p) * 0.035] },
      head: { rot: [0, 0, -Math.sin(p) * 0.04] },
    };
  },
  /** 站著發呆：只有呼吸與偶爾的重心轉移，用來當所有動作的保底。 */
  idle: (t) => ({
    body: { pos: [0, breathe(t, 0.55) * 0.004, 0], rot: [0, Math.sin(t * 0.21) * 0.07, 0] },
    head: { rot: [0, Math.sin(t * 0.17) * 0.12, 0] },
  }),
};

// ── 動畫小工具 ────────────────────────────────────────────
/** 0→1 的循環相位。 */
const cycle = (t, period) => (t % period) / period;
/** 在 [a,b] 區間內是 1、區間外是 0，邊緣有過渡——用來做「舉起、停住、放下」。 */
function bump(c, a, b) {
  const edge = 0.12;
  if (c < a - edge || c > b + edge) return 0;
  if (c < a) return (c - a + edge) / edge;
  if (c > b) return (b + edge - c) / edge;
  return 1;
}
/** 三次緩入緩出，去掉線性變化的機械感。 */
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** 呼吸：慢速正弦，所有靜止動作都疊這個，角色才不會像雕像。 */
const breathe = (t, rate) => Math.sin(t * rate * Math.PI * 2);

/**
 * 把一個顏色調暗（或調亮）。
 *
 * 用在褲子、耳朵內側這類「要跟主色分得出來、但仍是同一家族」的地方。
 * 直接換一個無關的顏色會讓角色看起來像拼湊的，降明度則維持整體調性。
 */
function shade(hex, k) {
  const r = Math.round(((hex >> 16) & 255) * k);
  const g = Math.round(((hex >> 8) & 255) * k);
  const b = Math.round((hex & 255) * k);
  return (r << 16) | (g << 8) | b;
}

/**
 * 組出一個角色的部件清單。
 *
 * 回傳的每個部件帶 channel，動畫時依 channel 疊加變換；沒有 channel 的部件
 * 固定不動（例如衣服的釦子）。pos 是相對腳底原點的基準位置。
 */
export function buildCharacter({ species = 'human', seed = 0, held = 'none', outfit = null } = {}) {
  const spec = SPECIES[species] ?? SPECIES.human;
  const pick = (arr, k) => arr[(Math.abs(Math.round(seed * 9973)) + k) % arr.length];
  const skin = spec.fur ?? pick(SKIN, 0);
  const cloth = outfit ?? pick(SHIRT, 3);
  const c = { fur: spec.fur ?? skin, inner: spec.inner ?? 0xffffff };

  // 褲子比上衣暗一階。低多邊形在遠處只剩剪影，上下同色會糊成一根柱子，
  // 分出明度差之後，就算只有幾十個像素也讀得出「上半身／下半身」。
  const trousers = shade(cloth, 0.62);

  const parts = [
    // 腿：兩條，各自有 channel 才能交替邁步
    { kind: 'cyl', pos: [-0.034, 0.055, 0], scale: [0.027, 0.11, 0.027], color: trousers, channel: 'legL', pivot: [0, 0.11, 0] },
    { kind: 'cyl', pos: [0.034, 0.055, 0], scale: [0.027, 0.11, 0.027], color: trousers, channel: 'legR', pivot: [0, 0.11, 0] },
    // 身體：圓角方塊，比球體更像穿著衣服。刻意比頭窄，Q 版的可愛來自這個對比
    { kind: 'rbox', pos: [0, 0.175, 0], scale: [0.1, 0.14, 0.075], color: cloth, channel: 'body' },
    // 手臂：往外挪到身體輪廓之外。原本 ±0.072 只比身體半寬多一點點，
    // 手整條都被身體蓋住，動作做得再對也看不見。
    { kind: 'cyl', pos: [-0.088, 0.193, 0], scale: [0.024, 0.1, 0.024], color: cloth, channel: 'armL', pivot: [0, 0.05, 0] },
    { kind: 'cyl', pos: [0.088, 0.193, 0], scale: [0.024, 0.1, 0.024], color: cloth, channel: 'armR', pivot: [0, 0.05, 0] },
    // 手掌：跟著手臂，手持物掛在右手。用膚色跟袖子分開，手的位置才看得出來
    { kind: 'sphere', pos: [-0.088, 0.138, 0], scale: [0.029, 0.029, 0.029], color: skin, channel: 'armL', pivot: [0, 0.105, 0] },
    { kind: 'sphere', pos: [0.088, 0.138, 0], scale: [0.029, 0.029, 0.029], color: skin, channel: 'armR', pivot: [0, 0.105, 0] },
    // 頭：Q 版比例的重點，直徑明顯大於身體寬度
    { kind: 'sphere', pos: [0, 0.318, 0], scale: [0.084, 0.08, 0.08], color: skin, channel: 'head' },
    // 眼睛：兩顆小點，位置稍微偏前，低多邊形下這是唯一的表情來源。
    // 放大到遠處仍看得見——眼睛消失的角色會立刻變成一顆球。
    { kind: 'sphere', pos: [-0.032, 0.325, 0.07], scale: [0.013, 0.016, 0.009], color: 0x2a2320, channel: 'head' },
    { kind: 'sphere', pos: [0.032, 0.325, 0.07], scale: [0.013, 0.016, 0.009], color: 0x2a2320, channel: 'head' },
  ];

  if (spec.hair) {
    parts.push({ kind: 'sphere', pos: [0, 0.345, -0.006], scale: [0.086, 0.062, 0.082], color: pick(HAIR, 1), channel: 'head' });
  }
  parts.push(...spec.head(c));

  const item = HELD[held];
  if (item) {
    // follow: 'armR' 是重點。手持物有自己的 channel（讓釣竿能額外抖動），
    // 但它的基礎運動必須跟著右手——pivot 設在肩膀，所以手舉起來時杯子
    // 是繞著肩膀一起畫弧到嘴邊，而不是留在腰際原地不動。
    parts.push({
      kind: item.kind, pos: [0.072, 0.128, 0.03], scale: item.scale, color: item.color,
      channel: 'held', follow: 'armR', pivot: [0, 0.115, -0.03],
    });
  }
  return { parts, species, held };
}

/**
 * 依目前時間，算出某個角色每個部件的最終變換。
 *
 * 呼叫端負責把結果寫進 InstancedMesh 的矩陣。這裡只做純計算，不碰 three 物件，
 * 方便單獨測試，也避免每幀配置新物件。
 */
export function poseCharacter(character, activity, t, phase = 0, speed = 1) {
  const fn = ACTIVITIES[activity] ?? ACTIVITIES.idle;
  const d = fn(t + phase, speed);
  const out = [];
  for (const p of character.parts) {
    const ch = d[p.channel] ?? null;
    // 跟隨另一個通道的部件（手持物跟右手）：兩者的旋轉相加，
    // 所以釣竿既跟著手臂移動，又保有自己的抖動。
    const lead = p.follow ? d[p.follow] ?? null : null;
    // body 的位移會帶動全身，所以除了 body 自己以外，其他部件也要跟著走
    const carry = d.body?.pos ?? null;
    const rot = p.tilt ?? [0, 0, 0];
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
        rot[0] + (ch?.rot?.[0] ?? 0) + (lead?.rot?.[0] ?? 0),
        rot[1] + (ch?.rot?.[1] ?? 0) + (lead?.rot?.[1] ?? 0),
        rot[2] + (ch?.rot?.[2] ?? 0) + (lead?.rot?.[2] ?? 0),
      ],
      pivot: p.pivot ?? null,
    });
  }
  return out;
}

/** 這個系統會用到的幾何種類。sceneManager 依這份清單各開一個 InstancedMesh。 */
export const CHARACTER_KINDS = ['rbox', 'cyl', 'cone', 'sphere'];

/**
 * 選角表：把 island_map.json 既有的 animal_* 型別對應到新的角色系統。
 *
 * 刻意不改資料檔。舊版把「角色」與「家具」merge 成同一塊幾何（兔子和茶几是
 * 同一個 geometry），所以這裡一筆拆成兩個產出：character 會動，furniture 不會。
 *
 * 沒列在這裡的型別會繼續走舊的道具路徑，所以這是可以一次搬一隻的漸進遷移，
 * 不是全有全無的改寫。animal_bird 就還留在舊路徑上——牠在天上繞圈，不需要骨架。
 */
export const CAST = {
  animal_rabbit_tea: { species: 'rabbit', activity: 'sip', held: 'teacup', furniture: 'tea_table' },
  animal_rabbit_brolly: { species: 'rabbit', activity: 'walk', held: 'brolly' },
  animal_bear_mow: { species: 'bear', activity: 'walk', held: 'none' },
  animal_bear_rain: { species: 'bear', activity: 'tend', held: 'watering' },
  animal_cat_nap: { species: 'cat', activity: 'nap', held: 'none', furniture: 'nap_mat' },
  animal_cat_shelter: { species: 'cat', activity: 'idle', held: 'none' },
  animal_fox_fish: { species: 'fox', activity: 'fish', held: 'rod', furniture: 'fish_stool' },
  animal_fox_brolly: { species: 'fox', activity: 'fish', held: 'brolly', furniture: 'fish_stool' },
};

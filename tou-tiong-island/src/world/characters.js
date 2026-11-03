/**
 * 動物居民：骨架、部件與動作。
 *
 * 一個角色不是一塊 merge 好的幾何，而是一組**有名字、能各自動**的部件。
 * 這是「兔子舉杯喝茶、桌子不動」與「整隻連桌子一起上下晃」的差別。
 *
 * 三種骨架（見 species.js）：
 *   quad      四足。身體水平、頭在前、四條腿走對角步
 *   bird      直立鳥類。兩腿撐住梨形身體，翅膀代替前肢
 *   pinniped  鰭足。沒有腿，靠前鰭推動
 *
 * 身體是自然的動物，但做的是人的事——這是美術文件的路線：
 * 兔子坐著舉杯、棕熊繫圍裙用工具、浣熊洗杯擦拭。所以四足骨架要能「坐起來」，
 * 坐姿時前肢離地才拿得住東西。
 *
 * 繪製成本：部件依**幾何種類**分批（不是依物種），全島所有角色的頭共用一個
 * InstancedMesh。種類固定 4 種，所以 60 隻跟 6 隻的 draw call 一樣多——
 * 這是文件要求「每島 10 隻、六島 60 席」能成立的前提。
 */
import { SPECIES, BASE_HEIGHT } from './species.js';

/** 這個系統用到的幾何種類。sceneManager 依這份清單各開一個 InstancedMesh。 */
export const CHARACTER_KINDS = ['rbox', 'cyl', 'cone', 'sphere'];

const P = (kind, pos, scale, color, channel, extra = {}) =>
  ({ kind, pos, scale, color, channel, ...extra });

/* ══════════════════════════════════════════════════════════
   四足
   ══════════════════════════════════════════════════════════ */
function buildQuad(sp, h) {
  const parts = [];
  const L = h * 1.45;                       // 體長約身高的 1.45 倍
  const legH = h * 0.32;
  const bodyY = legH + h * 0.20;
  const headY = bodyY + h * 0.18;
  const headZ = L * 0.34;
  const r = h * 0.26;                        // 頭半徑

  // 四條腿。對角線同相位才是真正的步態，所以左前與右後共用一個通道名的邏輯
  // 放在動作那邊；這裡只給四個獨立通道。
  const legX = h * 0.17, legZF = L * 0.26, legZB = -L * 0.26;
  const legR = h * 0.062;
  for (const [cx, cz, ch] of [
    [-legX, legZF, 'legFL'], [legX, legZF, 'legFR'],
    [-legX, legZB, 'legBL'], [legX, legZB, 'legBR'],
  ]) {
    // pivot 在腿的頂端（髖／肩），腿才會繞著關節擺，而不是繞自己中心翻轉
    parts.push(P('cyl', [cx, legH / 2, cz], [legR, legH, legR], sp.fur, ch, { pivot: [0, legH / 2, 0] }));
  }

  // 身體。圓角方塊比球體更像有骨架的動物，而且側面平一點好分出腹部
  parts.push(P('rbox', [0, bodyY, 0], [h * 0.42, h * 0.38, L * 0.62], sp.fur, 'body'));
  parts.push(P('rbox', [0, bodyY - h * 0.13, 0], [h * 0.34, h * 0.16, L * 0.5], sp.belly, 'body'));

  // 龜殼／刺蝟外殼：一整片大隆起，不逐片建
  if (sp.shell) parts.push(P('sphere', [0, bodyY + h * 0.12, 0], [h * 0.46, h * 0.3, L * 0.38], sp.shell, 'body'));
  if (sp.spines) parts.push(P('sphere', [0, bodyY + h * 0.1, -L * 0.04], [h * 0.44, h * 0.32, L * 0.34], sp.spines, 'body'));
  // 綿羊的毛：幾塊大團塊疊出蓬鬆，不做毛絲
  if (sp.face) {
    for (const [dx, dz] of [[-0.09, 0.1], [0.09, 0.1], [0, -0.12], [-0.08, -0.02], [0.08, -0.02]]) {
      parts.push(P('sphere', [dx * h, bodyY + h * 0.14, dz * L], [h * 0.2, h * 0.18, h * 0.2], sp.fur, 'body'));
    }
  }

  // 頭
  parts.push(P('sphere', [0, headY, headZ], [r, r * 0.92, r * 0.95], sp.face ?? sp.fur, 'head'));
  // 口鼻：文件說動物與人的辨識差異幾乎全靠這一塊，muzzle 越大越突出
  if (sp.muzzle > 0.05) {
    const m = r * (0.42 + sp.muzzle * 0.5);
    parts.push(P('sphere', [0, headY - r * 0.22, headZ + r * 0.72], [m * 0.62, m * 0.5, m], sp.inner, 'head'));
    parts.push(P('sphere', [0, headY - r * 0.18, headZ + r * 0.72 + m * 0.6], [r * 0.12, r * 0.1, r * 0.1], '#2a2320', 'head'));
  }
  // 浣熊的黑眼罩、小熊貓的白頰：一塊橫過眼睛的面
  if (sp.mask) parts.push(P('rbox', [0, headY + r * 0.1, headZ + r * 0.55], [r * 1.5, r * 0.4, r * 0.4], sp.mask, 'head'));
  if (sp.cheek) {
    for (const s of [-1, 1]) parts.push(P('sphere', [s * r * 0.55, headY - r * 0.05, headZ + r * 0.5], [r * 0.3, r * 0.28, r * 0.25], sp.cheek, 'head'));
  }
  // 眼睛。低多邊形下這是唯一的表情來源，要夠大，遠看才不會變成一顆球
  for (const s of [-1, 1]) {
    parts.push(P('sphere', [s * r * 0.44, headY + r * 0.12, headZ + r * 0.66], [r * 0.16, r * 0.19, r * 0.1], '#2a2320', 'head'));
  }

  addEars(parts, sp, { r, headY, headZ, h });
  addTail(parts, sp, { h, L, bodyY });
  if (sp.horn) {
    for (const s of [-1, 1]) parts.push(P('cone', [s * r * 0.4, headY + r * 0.85, headZ - r * 0.1], [r * 0.16, r * 0.6, r * 0.16], sp.horn, 'head', { tilt: [-0.7, 0, s * 0.25] }));
  }
  if (sp.antler) {
    for (const s of [-1, 1]) {
      parts.push(P('cyl', [s * r * 0.42, headY + r * 1.0, headZ - r * 0.1], [r * 0.09, r * 0.8, r * 0.09], sp.antler, 'head', { tilt: [-0.3, 0, s * 0.35] }));
      parts.push(P('cyl', [s * r * 0.7, headY + r * 1.5, headZ - r * 0.1], [r * 0.07, r * 0.5, r * 0.07], sp.antler, 'head', { tilt: [-0.2, 0, s * 0.8] }));
    }
  }
  return parts;
}

/* ══════════════════════════════════════════════════════════
   直立鳥類
   ══════════════════════════════════════════════════════════ */
function buildBird(sp, h) {
  const parts = [];
  const legH = h * (sp.legLong ? 0.42 * sp.legLong : 0.22);
  const bodyY = legH + h * 0.30;
  const r = h * 0.2;

  const legR = h * (sp.legLong ? 0.028 : 0.05);
  for (const [s, ch] of [[-1, 'legL'], [1, 'legR']]) {
    parts.push(P('cyl', [s * h * 0.11, legH / 2, 0], [legR, legH, legR], sp.inner, ch, { pivot: [0, legH / 2, 0] }));
    // 扁腳：企鵝與鴨子的辨識點之一
    parts.push(P('rbox', [s * h * 0.11, legR * 0.6, h * 0.05], [h * 0.11, h * 0.035, h * 0.16], sp.inner, ch, { pivot: [0, legH - legR * 0.6, 0] }));
  }

  // 梨形身體：下寬上窄
  parts.push(P('sphere', [0, bodyY, 0], [h * 0.26, h * 0.34, h * 0.24], sp.fur, 'body'));
  parts.push(P('sphere', [0, bodyY - h * 0.04, h * 0.1], [h * 0.2, h * 0.27, h * 0.14], sp.belly, 'body'));

  // 頸：紅鶴分三段，其餘直接接頭
  const neckH = sp.legLong ? h * 0.5 : h * 0.08;
  if (sp.legLong) {
    for (let i = 0; i < 3; i++) {
      parts.push(P('cyl', [0, bodyY + h * 0.26 + neckH * (i / 3), h * 0.02 * i], [h * 0.035, neckH / 3, h * 0.035], sp.fur, 'head', { pivot: [0, -neckH * (i / 3), 0] }));
    }
  }
  const headY = bodyY + h * 0.3 + neckH;
  parts.push(P('sphere', [0, headY, 0], [r, r * 0.95, r * 0.95], sp.fur, 'head'));
  // 貓頭鷹的寬面盤：一塊比頭稍大的扁圓，是牠最好認的特徵
  if (sp.ear[0] === 'tuft') parts.push(P('sphere', [0, headY, r * 0.5], [r * 1.05, r * 1.0, r * 0.3], sp.belly, 'head'));
  // 喙
  const beak = r * (0.4 + sp.muzzle * 0.9);
  parts.push(P('cone', [0, headY - r * 0.1, r * 0.8], [r * 0.28, beak, r * 0.22], sp.inner, 'head', { tilt: [Math.PI / 2, 0, 0] }));
  for (const s of [-1, 1]) parts.push(P('sphere', [s * r * 0.42, headY + r * 0.15, r * 0.66], [r * 0.17, r * 0.2, r * 0.1], '#2a2320', 'head'));

  // 翅膀：兩片側面，pivot 在肩
  for (const [s, ch] of [[-1, 'wingL'], [1, 'wingR']]) {
    parts.push(P('rbox', [s * h * 0.24, bodyY + h * 0.02, 0], [h * 0.06, h * 0.3, h * 0.16], sp.fur, ch, { pivot: [0, h * 0.14, 0] }));
  }
  addEars(parts, sp, { r, headY, headZ: 0, h });
  addTail(parts, sp, { h, L: h * 0.5, bodyY });
  return parts;
}

/* ══════════════════════════════════════════════════════════
   鰭足（海豹）
   ══════════════════════════════════════════════════════════ */
function buildPinniped(sp, h) {
  const parts = [];
  const L = h * 2.3;                        // 長水滴形：比四足更長更扁
  const bodyY = h * 0.26;
  const r = h * 0.22;

  parts.push(P('sphere', [0, bodyY, -L * 0.08], [h * 0.3, h * 0.26, L * 0.4], sp.fur, 'body'));
  parts.push(P('sphere', [0, bodyY - h * 0.06, 0], [h * 0.24, h * 0.14, L * 0.3], sp.belly, 'body'));
  // 頭直接接在身體前端，沒有脖子——文件說「全身為幾個連續多面體」
  parts.push(P('sphere', [0, bodyY + h * 0.1, L * 0.3], [r, r * 0.92, r], sp.fur, 'head'));
  parts.push(P('sphere', [0, bodyY + h * 0.04, L * 0.3 + r * 0.8], [r * 0.4, r * 0.32, r * 0.5], sp.belly, 'head'));
  parts.push(P('sphere', [0, bodyY + h * 0.06, L * 0.3 + r * 1.1], [r * 0.14, r * 0.12, r * 0.1], sp.inner, 'head'));
  for (const s of [-1, 1]) parts.push(P('sphere', [s * r * 0.4, bodyY + h * 0.18, L * 0.3 + r * 0.6], [r * 0.15, r * 0.18, r * 0.09], '#2a2320', 'head'));

  // 前鰭：貼著身體兩側，pivot 在根部
  for (const [s, ch] of [[-1, 'flipL'], [1, 'flipR']]) {
    parts.push(P('rbox', [s * h * 0.22, bodyY - h * 0.08, L * 0.1], [h * 0.14, h * 0.05, L * 0.16], sp.fur, ch, { pivot: [-s * h * 0.1, 0, 0], tilt: [0, s * 0.3, 0] }));
  }
  // 分叉後鰭
  for (const s of [-1, 1]) {
    parts.push(P('rbox', [s * h * 0.09, bodyY - h * 0.04, -L * 0.42], [h * 0.1, h * 0.05, L * 0.18], sp.fur, 'tail', { pivot: [0, 0, L * 0.2], tilt: [0, s * 0.45, 0] }));
  }
  return parts;
}

/* ── 共用的耳朵與尾巴 ────────────────────────────────────── */
function addEars(parts, sp, { r, headY, headZ, h }) {
  const [shape, len, mode] = sp.ear;
  if (shape === 'none' || !len) return;
  for (const [s, ch] of [[-1, 'earL'], [1, 'earR']]) {
    const x = s * r * 0.55, y = headY + r * 0.75, z = headZ - r * 0.1;
    if (shape === 'leaf') {
      // 扁長片。垂耳（狗）往下轉、側耳（綿羊）往外轉
      const tilt = mode === 'drop' ? [0.3, 0, s * 1.3] : mode === 'side' ? [0, 0, s * 1.2] : [0, 0, s * 0.18];
      parts.push(P('rbox', [x, y, z], [r * 0.22, r * len * 0.9, r * 0.42], sp.fur, ch, { pivot: [0, -r * len * 0.45, 0], tilt }));
      parts.push(P('rbox', [x, y, z + r * 0.12], [r * 0.12, r * len * 0.7, r * 0.26], sp.inner, ch, { pivot: [0, -r * len * 0.45, 0], tilt }));
    } else if (shape === 'cone' || shape === 'tuft') {
      parts.push(P('cone', [x, y, z], [r * 0.3, r * len * 0.9, r * 0.3], sp.fur, ch, { pivot: [0, -r * len * 0.45, 0], tilt: [0, 0, s * 0.2] }));
    } else {
      parts.push(P('sphere', [x, y, z], [r * 0.32 * (len + 0.5), r * 0.32 * (len + 0.5), r * 0.16], sp.fur, ch));
    }
  }
}

function addTail(parts, sp, { h, L, bodyY }) {
  const [shape, len, mode] = sp.tail;
  if (shape === 'none' || !len) return;
  const z = -L * 0.34, y = bodyY + h * (mode === 'up' ? 0.12 : 0.02);
  const tilt = mode === 'up' ? [-0.9, 0, 0] : [0.25, 0, 0];
  if (shape === 'puff') {
    parts.push(P('sphere', [0, y, z], [h * 0.12 * (len + 0.6), h * 0.12 * (len + 0.6), h * 0.12 * (len + 0.6)], sp.belly, 'tail'));
  } else if (shape === 'brush') {
    // 蓬尾分兩節，根部細、尾端粗，而且各自能擺——一整根圓柱會像棍子
    // 兩節要重疊，不能首尾相接——留縫會看成「身後飄著一根獨立的東西」。
    // 根部細、中段最粗、尾端收尖，這是蓬尾的輪廓。
    parts.push(P('sphere', [0, y, z - h * len * 0.06], [h * 0.085, h * 0.09, h * len * 0.2], sp.fur, 'tail', { pivot: [0, 0, -z * 0.3], tilt }));
    parts.push(P('sphere', [0, y + h * 0.02, z - h * len * 0.19], [h * 0.105, h * 0.105, h * len * 0.19], sp.fur, 'tail', { pivot: [0, 0, h * len * 0.19], tilt }));
    parts.push(P('sphere', [0, y + h * 0.03, z - h * len * 0.3], [h * 0.075, h * 0.075, h * len * 0.13], sp.tailTip ?? sp.fur, 'tail', { pivot: [0, 0, h * len * 0.3], tilt }));
  } else if (shape === 'ring') {
    // 環紋：三段分色，浣熊與小熊貓的辨識點
    for (let i = 0; i < 3; i++) {
      parts.push(P('cyl', [0, y + h * 0.03 * i, z - h * len * 0.16 * i], [h * 0.09, h * len * 0.17, h * 0.09],
        i % 2 ? sp.inner : sp.fur, 'tail', { pivot: [0, 0, h * len * 0.16 * i], tilt: [Math.PI / 2 - 0.3, 0, 0] }));
    }
  } else {
    parts.push(P('cone', [0, y, z], [h * 0.09, h * len * 0.4, h * 0.09], sp.fur, 'tail', { pivot: [0, 0, 0], tilt }));
  }
}

/* ══════════════════════════════════════════════════════════
   手持物
   ══════════════════════════════════════════════════════════ */
export const HELD = {
  cup: { kind: 'cyl', scale: [0.016, 0.018, 0.016], color: '#e8e2d4' },
  book: { kind: 'rbox', scale: [0.034, 0.044, 0.01], color: '#c9736a' },
  tray: { kind: 'rbox', scale: [0.05, 0.008, 0.038], color: '#b08a5c' },
  box: { kind: 'rbox', scale: [0.042, 0.036, 0.036], color: '#c9a27a' },
  can: { kind: 'rbox', scale: [0.03, 0.028, 0.022], color: '#9fb4a0' },
  basket: { kind: 'cyl', scale: [0.028, 0.026, 0.028], color: '#b99a6e' },
  tool: { kind: 'cyl', scale: [0.006, 0.07, 0.006], color: '#7b6246' },
  mail: { kind: 'rbox', scale: [0.036, 0.04, 0.018], color: '#d9cdb4' },
  none: null,
};

/* ══════════════════════════════════════════════════════════
   組裝
   ══════════════════════════════════════════════════════════ */
export function buildCharacter({ species = 'rabbit', seed = 0, held = 'none', heldColor = null } = {}) {
  const sp = SPECIES[species] ?? SPECIES.rabbit;
  const h = BASE_HEIGHT * sp.size;
  const parts = sp.rig === 'bird' ? buildBird(sp, h)
    : sp.rig === 'pinniped' ? buildPinniped(sp, h)
      : buildQuad(sp, h);

  const item = HELD[held];
  if (item) {
    // 掛在右前肢上，pivot 設在肩——手抬起來時東西跟著畫弧到嘴邊，
    // 而不是留在原地。四足的「手」是前腿，所以坐姿時才拿得住。
    const ch = sp.rig === 'bird' ? 'wingR' : sp.rig === 'pinniped' ? 'flipR' : 'legFR';
    parts.push({
      kind: item.kind, pos: [h * 0.2, h * 0.42, h * 0.3], scale: item.scale,
      // heldColor 讓旅人帶的東西染上來源島的顏色——不用文字就看得出
      // 「這個人從哪座島來」，跟 puma 用 carry 物件表示協作內容是同一招。
      color: heldColor ?? item.color, channel: 'held', follow: ch, pivot: [0, h * 0.2, -h * 0.2],
    });
  }
  return { parts, species, rig: sp.rig, height: h, held };
}

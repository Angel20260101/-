/**
 * 故事場景插畫。
 *
 * 為什麼要有：一篇故事三分鐘、十幾個節點，如果整段都是白底黑字，
 * 使用者會在第三段之前就失去往下點的動機。每個節點上方放一張會呼吸的
 * 場景圖，讀者先「看到」自己在哪裡，文字才有地方落腳。
 *
 * 怎麼做到又輕又快：全部是程式生成的向量圖，沒有任何圖檔要下載，
 * 換場只是換一段 SVG 字串；動態只用 CSS，不碰 WebGL，也不影響地圖的效能預算。
 */
import { PALETTE as P } from '../world/palette.js';

const W = 320;
const H = 148;

/** 由場景文字推出該用哪一張圖；寫在資料裡會散落 150 幾個節點，統一在這裡對照。 */
const MATCHERS = [
  [/書桌|筆電/, 'desk_home'],
  [/租屋處|套房/, 'room_night'],
  [/浴室/, 'washroom'],
  [/床|房間/, 'bed'],
  [/客服中心/, 'callcenter'],
  [/捷運|高速公路|休息站|停車場|回程/, 'commute'],
  [/一號線|二號線|分揀|廠房|現場/, 'warehouse'],
  [/交接台/, 'dawn'],
  [/會議室/, 'meeting'],
  [/走廊|茶水間/, 'corridor'],
  [/座位|辦公/, 'desk_office'],
  [/群組|電話中|訊息/, 'phone'],
  [/圓桌|年夜飯/, 'dinner'],
  [/廚房/, 'kitchen'],
  [/陽台/, 'balcony'],
  [/門口/, 'doorway'],
  [/客廳|^家|　家|家$|家\s/, 'livingroom'],
  [/公司|廠區/, 'desk_office'],
];

/** 夜晚的場景整體壓暗、加藍；白天維持暖調。 */
function toneFor(scene = {}) {
  const t = String(scene.time ?? '');
  const hour = Number((t.match(/(\d{1,2}):\d{2}/) ?? [])[1] ?? NaN);
  const nightWord = /凌晨|深夜|半夜|晚上|夜/.test(t);
  const night = nightWord || (Number.isFinite(hour) && (hour >= 19 || hour < 6));
  const dawn = /天亮|06:|07:|清晨/.test(t);
  if (dawn) return { sky: ['#f6d9b4', '#fdf1dc'], ink: '#6d7f74', dim: 0.06 };
  if (night) return { sky: ['#4a6072', '#8fa0a6'], ink: '#2f4049', dim: 0.3 };
  return { sky: [P.skyTop, P.skyBottom], ink: P.ink, dim: 0 };
}

export function artKeyFor(scene = {}) {
  const hay = `${scene.location ?? ''} ${scene.mood ?? ''}`;
  for (const [re, key] of MATCHERS) if (re.test(hay)) return key;
  return 'generic';
}

/* 小積木 ------------------------------------------------------------------ */
const rect = (x, y, w, h, f, r = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${f}"/>`;
const circ = (cx, cy, r, f) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${f}"/>`;
const poly = (pts, f) => `<polygon points="${pts}" fill="${f}"/>`;
const line = (x1, y1, x2, y2, s, w = 2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${s}" stroke-width="${w}" stroke-linecap="round"/>`;

/** 窗：夜裡是一塊亮起來的方塊，白天是外面的天色。 */
const window_ = (x, y, w, h, night) => `
  ${rect(x, y, w, h, night ? '#2f4049' : '#cfe6ea', 4)}
  ${rect(x + 3, y + 3, w - 6, h - 6, night ? '#3c5160' : '#e6f2f0', 3)}
  ${line(x + w / 2, y + 3, x + w / 2, y + h - 3, night ? '#2f4049' : '#bcd6d6', 2)}`;

const steam = (x, y) => `
  <g class="art-steam" opacity=".55">
    <path d="M${x} ${y} q5 -8 0 -15 q-5 -8 0 -14" stroke="${P.paper2 ?? '#fffdf7'}" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M${x + 8} ${y - 2} q5 -7 0 -13" stroke="#fffdf7" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".7"/>
  </g>`;

/* 各場景 ------------------------------------------------------------------ */
const SCENES = {
  room_night: (t, night) => `
    ${rect(0, 0, W, H, night ? '#7c6557' : '#d8c6ae')}
    ${rect(0, 0, W, 34, night ? '#6d5a4e' : '#c9b79e')}
    ${window_(28, 20, 78, 56, night)}
    ${rect(0, 104, W, 44, '#96785c')}
    ${rect(170, 62, 120, 42, '#c08e6e', 4)}
    ${rect(176, 56, 44, 10, '#d9a98a', 3)}
    ${circ(236, 72, 13, '#f3e3c4')}${circ(236, 72, 9, '#e8c89a')}
    ${steam(236, 56)}
    ${rect(258, 58, 20, 32, '#39474f', 4)}
    ${rect(261, 62, 14, 22, '#ffe9a8', 2)}
    <g class="art-glow">${circ(268, 74, 26, '#ffe3a0')}</g>`,

  desk_home: (t, night) => `
    ${rect(0, 0, W, H, night ? '#74604f' : '#d4c3a8')}
    ${window_(20, 16, 70, 50, night)}
    ${rect(0, 100, W, 48, '#96785c')}
    ${rect(120, 44, 150, 56, '#a8846a', 4)}
    ${poly('138,96 252,96 262,44 148,44', '#cfd9dc')}
    ${rect(152, 50, 102, 40, '#e8f0ef', 2)}
    ${rect(160, 56, 70, 4, '#b4c6c4', 2)}${rect(160, 66, 54, 4, '#b4c6c4', 2)}${rect(160, 76, 62, 4, '#b4c6c4', 2)}
    <g class="art-glow">${circ(203, 70, 30, '#cfe6e4')}</g>
    ${circ(292, 92, 9, '#f3e3c4')}`,

  bed: (t, night) => `
    ${rect(0, 0, W, H, night ? '#3f5365' : '#b9cfd6')}
    ${rect(0, 86, W, 62, '#6f8494')}
    ${rect(24, 70, 272, 40, '#aebfc4', 10)}
    ${rect(40, 58, 70, 26, '#e8eeec', 8)}
    ${circ(150, 74, 15, '#e8c9a8')}
    ${rect(96, 86, 190, 30, '#8fa6ae', 8)}
    ${window_(214, 14, 72, 48, night)}
    <g class="art-twinkle">${circ(250, 30, 2.5, '#fff6d8')}${circ(266, 44, 2, '#fff6d8')}</g>`,

  washroom: (t, night) => `
    ${rect(0, 0, W, H, '#cdd9dc')}
    ${rect(0, 96, W, 52, '#b4c3c6')}
    ${rect(92, 18, 136, 70, '#e8f1f2', 6)}
    ${rect(98, 24, 124, 58, '#d4e5e6', 4)}
    ${circ(160, 54, 18, '#e8c9a8')}
    ${rect(104, 96, 112, 14, '#f2f5f4', 6)}
    ${line(160, 88, 160, 100, '#9fb0b2', 4)}
    <g class="art-drip">${circ(160, 104, 3, '#a9cfd6')}</g>`,

  callcenter: () => `
    ${rect(0, 0, W, H, '#d6dee0')}
    ${rect(0, 98, W, 50, '#b9c4c2')}
    ${rect(16, 34, 92, 64, '#9fb0b2', 3)}
    ${rect(126, 26, 100, 72, '#8fa3a6', 3)}
    ${rect(132, 32, 88, 52, '#2f4049', 2)}
    ${rect(140, 40, 54, 4, '#8fc0bd', 2)}${rect(140, 50, 40, 4, '#e3a08a', 2)}${rect(140, 60, 64, 4, '#6d8a90', 2)}
    ${rect(244, 34, 60, 64, '#9fb0b2', 3)}
    ${circ(170, 112, 16, '#e8c9a8')}
    <path d="M152 110 q0 -22 18 -22 q18 0 18 22" stroke="#4e6b74" stroke-width="7" fill="none"/>
    ${circ(152, 112, 7, '#4e6b74')}${circ(188, 112, 7, '#4e6b74')}
    <g class="art-pulse">${circ(276, 48, 7, '#e07a5f')}</g>`,

  warehouse: () => `
    ${rect(0, 0, W, H, '#5b6b70')}
    ${rect(0, 0, W, 26, '#4a585c')}
    ${rect(0, 104, W, 44, '#7d8a8c')}
    ${rect(0, 74, W, 32, '#9aa7a6', 2)}
    ${rect(0, 70, W, 7, '#7f8d8c')}
    ${rect(36, 44, 40, 28, '#d2a470', 2)}${rect(104, 44, 40, 28, '#c08f5e', 2)}
    ${rect(176, 40, 44, 32, '#d2a470', 2)}
    ${rect(182, 46, 32, 7, '#e8d6b4', 1)}
    ${rect(252, 20, 16, 54, '#4a585c', 2)}
    <g class="art-blink">${circ(260, 18, 11, '#f3c14f')}</g>
    ${circ(260, 18, 5, '#fff2c4')}`,

  dawn: () => `
    <defs><linearGradient id="dw" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8fa6b4"/><stop offset="1" stop-color="#f6d9b4"/></linearGradient></defs>
    ${rect(0, 0, W, 96, 'url(#dw)')}
    ${circ(246, 84, 22, '#ffe2ae')}
    ${rect(0, 94, W, 54, '#7d8a8c')}
    ${rect(0, 88, W, 8, '#5b6b70')}
    ${rect(28, 56, 60, 34, '#4a585c', 2)}
    ${rect(170, 96, 118, 36, '#c69a6a', 4)}
    ${rect(184, 90, 42, 10, '#e8d6b4', 2)}
    ${rect(196, 104, 70, 18, '#f2ead6', 2)}
    ${line(206, 112, 254, 112, '#9fb0b2', 2)}`,

  meeting: () => `
    ${rect(0, 0, W, H, '#dde3e0')}
    ${rect(0, 104, W, 44, '#c3cdc8')}
    ${rect(40, 12, 180, 76, '#f6f3e8', 3)}
    ${rect(46, 18, 168, 64, '#e2ece7', 2)}
    ${rect(58, 30, 76, 6, '#8fb3a3', 2)}
    ${poly('62,70 86,46 108,62 134,34 134,70', '#638c78')}
    ${rect(0, 96, W, 14, '#a9b5ae', 3)}
    ${circ(58, 120, 13, '#e8c9a8')}${circ(152, 122, 13, '#e3b48f')}${circ(252, 120, 13, '#e8c9a8')}
    ${rect(236, 24, 52, 60, '#b9c4c2', 3)}`,

  corridor: () => `
    ${rect(0, 0, W, H, '#e3e7e0')}
    ${poly('0,0 320,0 320,148 0,148', '#e8ebe4')}
    ${poly('80,22 240,22 268,126 52,126', '#d2d9d0')}
    ${rect(110, 44, 46, 82, '#b9c4c2', 3)}
    ${rect(176, 48, 40, 74, '#c6cfc8', 3)}
    ${circ(150, 16, 10, '#ffe9a8')}
    <g class="art-glow">${circ(150, 16, 24, '#ffeec4')}</g>
    ${circ(236, 92, 14, '#e8c9a8')}
    ${rect(222, 106, 28, 36, '#8fb3a3', 6)}`,

  desk_office: () => `
    ${rect(0, 0, W, H, '#dfe4df')}
    ${rect(0, 100, W, 48, '#c3cdc8')}
    ${rect(0, 92, W, 12, '#a9b5ae')}
    ${rect(36, 34, 108, 62, '#93a3a0', 3)}
    ${rect(42, 40, 96, 48, '#2f4049', 2)}
    ${rect(52, 48, 52, 4, '#8fc0bd', 2)}${rect(52, 58, 36, 4, '#d8b77b', 2)}${rect(52, 68, 62, 4, '#6d8a90', 2)}
    ${rect(176, 72, 70, 24, '#d2a470', 3)}
    ${circ(268, 78, 11, '#f0b9c4')}
    ${circ(200, 110, 15, '#e8c9a8')}`,

  phone: () => `
    ${rect(0, 0, W, H, '#cfe0e2')}
    ${rect(116, 14, 88, 122, '#39474f', 12)}
    ${rect(122, 24, 76, 102, '#eef4f1', 8)}
    ${rect(130, 36, 52, 16, '#dbe8df', 5)}
    ${rect(138, 60, 52, 16, '#cfe4d4', 5)}
    ${rect(130, 84, 44, 16, '#dbe8df', 5)}
    <g class="art-pulse">${circ(196, 26, 8, '#e07a5f')}</g>
    ${circ(50, 104, 16, '#e8c9a8')}
    ${circ(268, 104, 16, '#e3b48f')}`,

  dinner: () => `
    ${rect(0, 0, W, H, '#f0e3cd')}
    ${rect(0, 104, W, 44, '#d9c6a6')}
    <ellipse cx="160" cy="104" rx="140" ry="36" fill="#e8d2ad"/>
    <ellipse cx="160" cy="98" rx="130" ry="30" fill="#f6ead2"/>
    ${circ(110, 96, 15, '#fdf8ee')}${circ(160, 102, 17, '#f0b9c4')}${circ(212, 96, 15, '#fdf8ee')}
    ${circ(72, 90, 11, '#c3d98f')}${circ(250, 90, 11, '#e3a08a')}
    ${circ(44, 60, 15, '#e8c9a8')}${circ(104, 48, 15, '#e3b48f')}${circ(216, 48, 15, '#e8c9a8')}${circ(276, 60, 15, '#d8a98a')}
    <g class="art-glow">${circ(160, 24, 26, '#ffeec4')}</g>
    ${circ(160, 24, 11, '#ffe9a8')}`,

  kitchen: () => `
    ${rect(0, 0, W, H, '#e8e2d2')}
    ${rect(0, 96, W, 52, '#cbbda2')}
    ${rect(0, 86, W, 14, '#b4a punc', 0)}`.replace('#b4a punc', '#b4a689'),

  balcony: (t, night) => `
    ${rect(0, 0, W, H, night ? '#43596b' : '#bdd8de')}
    ${rect(0, 112, W, 36, '#8a7158')}
    ${line(0, 90, W, 90, '#6d7f74', 5)}
    ${[20, 56, 92, 128, 164, 200, 236, 272, 304].map((x) => line(x, 90, x, 118, '#6d7f74', 4)).join('')}
    ${circ(220, 44, 13, night ? '#fff2c4' : '#ffe9a8')}
    <g class="art-twinkle">${circ(60, 36, 2.5, '#fff6d8')}${circ(104, 24, 2, '#fff6d8')}${circ(152, 44, 2.2, '#fff6d8')}</g>
    ${circ(96, 76, 15, '#e8c9a8')}`,

  doorway: () => `
    ${rect(0, 0, W, H, '#dfe6de')}
    ${rect(0, 110, W, 38, '#b8bdb2')}
    ${rect(18, 18, 104, 92, '#e2d6bc', 4)}
    ${rect(26, 26, 88, 84, '#cbbda2', 3)}
    ${circ(104, 70, 5, '#d8b77b')}
    ${rect(170, 56, 128, 54, '#8fb3a3', 10)}
    ${rect(182, 62, 44, 24, '#cfe4e2', 4)}${rect(238, 62, 46, 24, '#cfe4e2', 4)}
    ${circ(198, 112, 12, '#4a585c')}${circ(268, 112, 12, '#4a585c')}
    ${circ(142, 84, 14, '#e8c9a8')}`,

  livingroom: (t, night) => `
    ${rect(0, 0, W, H, night ? '#4c5f6b' : '#e4e0d2')}
    ${rect(0, 104, W, 44, '#9c8468')}
    ${rect(24, 62, 128, 46, '#8fa6a0', 8)}
    ${rect(32, 52, 46, 16, '#a9bdb4', 6)}
    ${rect(96, 52, 46, 16, '#a9bdb4', 6)}
    ${line(232, 42, 232, 104, '#6d7f74', 4)}
    ${poly('208,42 256,42 248,16 216,16', '#e8d6b4')}
    <g class="art-glow">${circ(232, 34, 34, '#ffeec4')}</g>
    ${rect(170, 86, 46, 22, '#39474f', 3)}
    ${circ(100, 92, 13, '#e8c9a8')}`,

  commute: () => `
    <defs><linearGradient id="cm" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9fc0cc"/><stop offset="1" stop-color="#f3e2c6"/></linearGradient></defs>
    ${rect(0, 0, W, 94, 'url(#cm)')}
    ${rect(0, 92, W, 56, '#8e9a98')}
    ${rect(0, 108, W, 6, '#f2ead6')}
    <g class="art-slide">${rect(24, 46, 26, 46, '#7d8a90', 2)}${rect(72, 34, 22, 58, '#6d7f84', 2)}${rect(118, 54, 28, 38, '#8a969a', 2)}
      ${rect(186, 38, 24, 54, '#7d8a90', 2)}${rect(232, 56, 30, 36, '#8a969a', 2)}${rect(284, 44, 22, 48, '#6d7f84', 2)}</g>
    ${rect(96, 118, 128, 22, '#c3cdc8', 8)}`,

  generic: () => `
    <defs><linearGradient id="gn" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.skyTop}"/><stop offset="1" stop-color="${P.skyBottom}"/></linearGradient></defs>
    ${rect(0, 0, W, H, 'url(#gn)')}
    <ellipse cx="160" cy="132" rx="118" ry="26" fill="${P.water}"/>
    ${poly('96,118 224,118 206,84 114,84', P.sandTop)}
    ${poly('114,84 206,84 196,70 124,70', P.grassTop)}
    ${circ(248, 34, 17, '#ffe9a8')}
    <g class="art-glow">${circ(248, 34, 32, '#ffeec4')}</g>`,
};

SCENES.kitchen = (t, night) => `
  ${rect(0, 0, W, H, '#e8e2d2')}
  ${rect(0, 96, W, 52, '#cbbda2')}
  ${rect(0, 86, W, 12, '#b4a689')}
  ${rect(18, 26, 74, 58, '#d9cbb0', 4)}
  ${rect(26, 34, 58, 42, '#eee4cf', 3)}
  ${rect(112, 52, 56, 34, '#9fb0b2', 3)}
  ${circ(140, 46, 13, '#fdf8ee')}
  ${steam(140, 34)}
  ${rect(198, 60, 96, 26, '#c69a6a', 3)}
  ${circ(222, 52, 10, '#f0b9c4')}${circ(248, 52, 10, '#c3d98f')}
  ${circ(276, 112, 15, '#e8c9a8')}
  ${window_(206, 14, 74, 36, night)}`;

/**
 * 產生一張場景圖。回傳 SVG 字串，直接塞進故事畫面上方。
 * @param {object} scene node.scene（location / time / mood）
 */
export function sceneArt(scene = {}) {
  const key = artKeyFor(scene);
  const tone = toneFor(scene);
  const night = tone.dim > 0.2;
  const draw = SCENES[key] ?? SCENES.generic;
  const dim = tone.dim > 0
    ? `<rect width="${W}" height="${H}" fill="#2f4049" opacity="${tone.dim}"/>` : '';
  return `<svg class="art__svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"
            role="img" aria-label="${(scene.location ?? '場景')}">
      ${draw(tone, night)}
      ${dim}
    </svg>`;
}

export const SCENE_KEYS = Object.keys(SCENES);

/**
 * 《透中島》色票。
 *
 * 取自 V8 原型的奶油暖調：紙白底、淡藍轉蜜桃的天空、暖砂島、鼠尾草綠、金色重點。
 * 刻意避開偏藍偏冷的粉彩——療癒感來自暖色與低彩度，不是高明度。
 * 3D 與介面共用同一組顏色，所以兩邊永遠不會對不起來。
 */
export const PALETTE = {
  // 介面基底（與 main.css 的 CSS 變數同步）
  paper:      '#fcf8ef',
  ink:        '#395a51',
  muted:      '#83958b',
  gold:       '#d8b77b',
  accent:     '#638c78',
  line:       '#e3e5d9',

  // 天空與海
  skyTop:     '#b7deea',
  skyBottom:  '#fff0d3',
  water:      '#b4dade',
  waterDeep:  '#9ec9ce',
  foam:       '#d8ece6',
  haze:       '#ecead9',

  // 地表
  sandTop:    '#f0ddb8',
  sandSide:   '#e0b98a',
  grassTop:   '#93c08a',
  grassSide:  '#e0b98a',
  grassLight: '#b1d196',
  grassDark:  '#6e9781',
  rockTop:    '#bcc2b6',
  rockSide:   '#a0a899',

  // 植被
  trunk:      '#c89a62',
  trunkDark:  '#a87b48',
  leafPine:   '#6e9781',
  leafRound:  '#93c08a',
  leafLime:   '#c3d98f',
  leafTeal:   '#9bc9b6',
  leafPink:   '#f0b9c4',
  leafPinkHi: '#f8d6dc',
  leafCoral:  '#f0a894',
  palmLeaf:   '#eeb2c5',
  palmTrunk:  '#e2cfa8',

  // 木作與石材
  wood:       '#d2a470',
  woodDark:   '#b07f4c',
  rope:       '#eddcb8',
  stone:      '#c2c7bd',

  // 燈塔
  towerRed:   '#e08a6a',
  towerWhite: '#fdf8ee',
  towerGlass: '#ffe9a8',
  towerRoof:  '#d2745a',

  // 小物
  lampPost:   '#95918a',
  lampGlow:   '#ffe9a8',
  flowerA:    '#f0b9c4',
  flowerB:    '#f3d08c',
  hutWall:    '#fbf2de',
  hutRoof:    '#d98f6e',

  // 動物
  furBear:    '#c39a72',
  furBearDark:'#a87d58',
  furRabbit:  '#fbf1e2',
  furRabbitIn:'#f3c3cb',
  furCat:     '#eec89a',
  furFox:     '#e79b6d',
  furBird:    '#9bc9d6',
  cloth:      '#8fb3a3',
  clothWarm:  '#e3a08a',
  teaCup:     '#fdf8ee',
  // 島民的臉。可愛感有一半來自這三樣：深色的眼睛、腮紅、淺色的口鼻
  eyeDark:    '#2e3a36',
  eyeWhite:   '#ffffff',
  cheek:      '#f0a9a2',
  snout:      '#fbf1e2',

  // 地面細節（拉近才看得到的那一層）
  mushroomCap:'#e0a088',
  pebbleWarm: '#cfc6b2',
  pebbleWarmD:'#b5a98f',
  cloverDark: '#6b9478',
  bushLeaf:   '#86b283',
  shellIvory: '#fdf0e2',
  shellPink:  '#f1cfc8',
  // 氣候區用
  cactus:     '#7fa578',
  cactusDark: '#688a63',
  aridLeaf:   '#b6a877',
  coralA:     '#f0a894',
  coralB:     '#f3c6a8',
  coralC:     '#e8908f',
};

/** 低多邊形在靜態光下的層次：側面一律比頂面暗一階。 */
export const SURFACE_COLORS = {
  sand:        { top: PALETTE.sandTop,   side: PALETTE.sandSide },
  grass:       { top: PALETTE.grassTop,  side: PALETTE.sandSide },
  grass_light: { top: PALETTE.grassLight,side: PALETTE.sandSide },
  grass_dark:  { top: PALETTE.grassDark, side: PALETTE.sandSide },
  rock:        { top: PALETTE.rockTop,   side: PALETTE.rockSide },
};

/**
 * 三種天氣的全島氛圍。
 *
 * 這是「上帝視角」的核心：玩家每天的一次選擇，決定島民過的是什麼天氣。
 * 每個欄位都只改既有物件的顏色或強度，不新增 draw call。
 */
export const WEATHER = {
  sunny: {
    id: 'sunny', label: '晴', icon: '☀',
    skyTop: '#86cfe4', skyBottom: '#ffeec0',
    water: '#7fcfd6', foam: '#bfe9e0',
    hemiSky: '#fff6dc', hemiGround: '#f0d49e', hemiIntensity: 1.15,
    dirIntensity: 1.45, dirColor: '#fff2cc',
    fog: '#f3e8cf', fogScale: 3.2,
    veil: 'rgba(255, 226, 150, 0.10)',
    clouds: 2, cloudColour: '#ffffff', cloudY: [6.8, 9.6], rain: 0,
    islandLine: '今天島上出太陽。',
  },
  cloudy: {
    id: 'cloudy', label: '陰', icon: '☁',
    skyTop: '#b3bfc2', skyBottom: '#dcdcd2',
    water: '#93aeb0', foam: '#c0ccc6',
    hemiSky: '#e4e8e4', hemiGround: '#b4b8ac', hemiIntensity: 0.98,
    dirIntensity: 0.52, dirColor: '#e9ece7',
    fog: '#cfd4cc', fogScale: 2.1,
    veil: 'rgba(120, 132, 130, 0.17)',
    clouds: 8, cloudColour: '#f2f6f7', cloudY: [5.2, 7.8], rain: 0,
    islandLine: '今天島上多雲。',
  },
  rainy: {
    id: 'rainy', label: '雨', icon: '☂',
    skyTop: '#8c9ca8', skyBottom: '#c3c6bc',
    water: '#6f8b94', foam: '#9db4b2',
    hemiSky: '#ccd6d8', hemiGround: '#8c9490', hemiIntensity: 0.88,
    dirIntensity: 0.34, dirColor: '#dde4e4',
    fog: '#b8c0bb', fogScale: 1.8,
    veil: 'rgba(66, 86, 96, 0.26)',
    clouds: 10, cloudColour: '#dde6e8', cloudY: [4.6, 7.0], rain: 80,
    islandLine: '今天島上下雨。',
  },
};

export const WEATHER_ORDER = ['sunny', 'cloudy', 'rainy'];

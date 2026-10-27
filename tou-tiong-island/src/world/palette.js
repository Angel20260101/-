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
    skyTop: '#b7deea', skyBottom: '#fff0d3',
    water: '#b4dade', foam: '#d8ece6',
    hemiIntensity: 1.10, dirIntensity: 1.30, dirColor: '#fff6e2',
    fog: '#ecead9', fogScale: 3.0,
    clouds: 3, cloudOpacity: 0.95, rain: 0,
    islandLine: '今天島上出太陽。',
  },
  cloudy: {
    id: 'cloudy', label: '陰', icon: '☁',
    skyTop: '#cdd9dc', skyBottom: '#f4eee1',
    water: '#a6c3c8', foam: '#cadcd8',
    hemiIntensity: 1.00, dirIntensity: 0.90, dirColor: '#f2f0e6',
    fog: '#e3e3d8', fogScale: 2.4,
    clouds: 7, cloudOpacity: 1.0, rain: 0,
    islandLine: '今天島上多雲。',
  },
  rainy: {
    id: 'rainy', label: '雨', icon: '☂',
    skyTop: '#aebfc6', skyBottom: '#e7e4d8',
    water: '#8fadb4', foam: '#b8cdc9',
    hemiIntensity: 0.92, dirIntensity: 0.70, dirColor: '#e8ecea',
    fog: '#d8dcd3', fogScale: 2.0,
    clouds: 9, cloudOpacity: 1.0, rain: 70,
    islandLine: '今天島上下雨。',
  },
};

export const WEATHER_ORDER = ['sunny', 'cloudy', 'rainy'];

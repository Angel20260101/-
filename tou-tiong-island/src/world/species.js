/**
 * 二十種動物居民。
 *
 * 資料來源：《透中島六島場景與動物居民設計》（2026-11-03）。
 * 每一種的比例、耳形、尾形與口鼻都照文件的「主要辨識特徵」編碼——那份文件
 * 特別強調「物種的頭、身、耳、尾與四肢必須具有真正差異」，所以這裡刻意
 * 不共用同一組數值再換顏色，而是每種都有自己的輪廓參數。
 *
 * 身體是自然的動物（四足有尾、不穿整套衣服），但做的是人的事——兔子舉杯、
 * 棕熊繫圍裙用工具、水獺戴耳機。文件裡的「生活情境提案」全部是這個路線。
 *
 * 三種骨架，不是全部四足：
 *   quad      四足。15 種。身體水平、頭在前、四條腿分對角擺動
 *   bird      直立鳥類。4 種（企鵝、鴨子、貓頭鷹、紅鶴）。兩腿、翅膀代替前肢
 *   pinniped  鰭足。1 種（海豹）。沒有腿，靠前鰭推動；文件註明牠不進階梯與細步道
 */

/** 體型倍率的基準：兔子約 0.22 世界單位高。地形一格六角是半徑 1。 */
export const BASE_HEIGHT = 0.22;

/**
 * 物種表。
 *
 * rig      骨架
 * size     體型倍率（相對兔子）
 * fur/belly/inner  主色／腹部／耳內與口鼻
 * ear      [形狀, 長度倍率]  cone = 尖耳、leaf = 扁長片、round = 圓耳、tuft = 小角
 * tail     [形狀, 長度倍率]  puff = 短圓球、brush = 蓬尾、ring = 環紋、wedge = 小楔形、none
 * muzzle   口鼻突出程度（0 = 幾乎沒有，1 = 明顯長吻）
 * note     文件裡那一條最關鍵的辨識提醒，寫進來免得日後調壞
 */
export const SPECIES = {
  /*
   * 主角。放進同一張物種表，是為了讓 buildCharacter／cast 不必為他開特例——
   * 他就是第 21 個「物種」，只是骨架是 biped 而且全島只有一個。
   * size 比動物大一截：人站在兔子旁邊本來就高，而且主角要在畫面上找得到。
   */
  human: {
    rig: 'biped', size: 1.9,
    fur: '#6f8f86',      // 上衣
    belly: '#4a5d6b',    // 褲子與領口
    inner: '#e8c9a8',    // 膚色
    hair: '#3b2f2a',
    hat: 'bucket',        // 預設漁夫帽。寬邊，從上往下看頭頂不會露
    ear: ['none'], tail: 'none', muzzle: 0,
    note: '主角。島上唯一的人。',
  },

  rabbit: {
    rig: 'quad', size: 1.00, fur: '#e8dcc8', belly: '#f6efe2', inner: '#e3b7b0',
    ear: ['leaf', 2.4], tail: ['puff', 0.5], muzzle: 0.35,
    note: '長耳、梨形身體、大後腳與短圓尾。走路是後腳交替小跳，不能整隻直線滑動。',
  },
  bear: {
    rig: 'quad', size: 1.75, fur: '#8c6a4a', belly: '#a98462', inner: '#5f4334',
    ear: ['round', 0.7], tail: ['puff', 0.3], muzzle: 0.75,
    note: '厚實橢球身體、寬短口鼻、圓耳、粗短四肢與小尾。口鼻要另做突出方圓塊。',
  },
  otter: {
    rig: 'quad', size: 0.95, fur: '#7a5c45', belly: '#c9ab8d', inner: '#d8c3aa',
    ear: ['round', 0.4], tail: ['brush', 1.9], muzzle: 0.6,
    note: '細長身體、淺色口鼻、小圓耳、短腿、粗長收尖尾。身體與尾要分件，不然會看成短尾熊。',
  },
  tortoise: {
    rig: 'quad', size: 0.9, fur: '#7d8c62', belly: '#9aa877', inner: '#b8a071',
    ear: ['none', 0], tail: ['wedge', 0.4], muzzle: 0.5, shell: '#8a7348',
    note: '低矮身體、大型隆起龜殼、短頸四短腿。殼用少量大片六角感切面。',
  },
  capybara: {
    rig: 'quad', size: 1.45, fur: '#a07d55', belly: '#b59068', inner: '#7b5c3e',
    ear: ['round', 0.35], tail: ['none', 0], muzzle: 0.9,
    note: '桶形身體、寬鈍長方口鼻、頭頂小耳小眼、短腿、無明顯外尾。頭比水獺更方厚。',
  },
  squirrel: {
    rig: 'quad', size: 0.62, fur: '#a8672f', belly: '#e0cdb4', inner: '#c98a4e',
    ear: ['cone', 0.9], tail: ['brush', 2.6], muzzle: 0.3,
    note: '小橢球身體、尖圓耳、巨大上捲尾。尾用兩三節弧形多面體。',
  },
  fox: {
    rig: 'quad', size: 1.05, fur: '#c4703a', belly: '#f0e4d2', inner: '#f6efe2',
    ear: ['cone', 1.5], tail: ['brush', 2.2], muzzle: 1.0, tailTip: '#f6efe2',
    note: '尖耳、窄長口鼻、修長身體、大蓬尾；尾端奶白。耳與吻的輪廓都要比貓更長。',
  },
  deer: {
    rig: 'quad', size: 1.6, fur: '#b08359', belly: '#ddc9ab', inner: '#8a6440',
    ear: ['leaf', 1.3], tail: ['puff', 0.4], muzzle: 0.7, antler: '#8f7a5c',
    note: '長頸、細腿、大耳、短尾與簡化分叉鹿角。鹿角用兩層短枝，不能穿過棚架。',
  },
  raccoon: {
    rig: 'quad', size: 0.95, fur: '#8e8a84', belly: '#b7b2a8', inner: '#3a3733',
    ear: ['round', 0.6], tail: ['ring', 1.7], muzzle: 0.65, mask: '#3a3733',
    note: '灰褐身體、黑眼罩、短圓耳與環紋尾。環紋用三四段分色圓柱。',
  },
  redpanda: {
    rig: 'quad', size: 0.9, fur: '#b4603a', belly: '#4a3328', inner: '#f2e8da',
    ear: ['cone', 0.8], tail: ['ring', 2.0], muzzle: 0.5, cheek: '#f2e8da',
    note: '紅棕身體、白色面頰、尖圓耳、深色四肢與粗長環紋尾。頭臉比浣熊更圓，尾色偏橘。',
  },
  hedgehog: {
    rig: 'quad', size: 0.58, fur: '#c0a685', belly: '#dcc9ad', inner: '#8f7a60',
    ear: ['round', 0.35], tail: ['none', 0], muzzle: 0.8, spines: '#6b5a46',
    note: '水滴形小身體、尖短鼻、小耳短腿。背刺用一體式鋸齒外殼，不逐根建。',
  },
  cat: {
    rig: 'quad', size: 0.85, fur: '#9b9389', belly: '#cfc7bb', inner: '#e3b7b0',
    ear: ['cone', 1.1], tail: ['brush', 2.1], muzzle: 0.35,
    note: '三角耳、短吻、柔長身體、細腿與長彎尾。不使用細線毛髮。',
  },
  dog: {
    rig: 'quad', size: 1.05, fur: '#c69a63', belly: '#e6d6ba', inner: '#8a6440',
    ear: ['leaf', 1.0, 'drop'], tail: ['brush', 1.4, 'up'], muzzle: 0.8,
    note: '圓短口鼻、垂耳、結實身體與翹尾。耳型要跟貓明顯不同。',
  },
  goat: {
    rig: 'quad', size: 1.1, fur: '#ddd3c2', belly: '#efe8da', inner: '#a8977d',
    ear: ['cone', 1.1], tail: ['wedge', 0.5, 'up'], muzzle: 0.7, horn: '#8f7a5c',
    note: '稜形口鼻、後彎短角、尖耳、小山鬍與蹄足。軀幹偏窄，尾短而上翹。',
  },
  sheep: {
    rig: 'quad', size: 1.15, fur: '#f0ece2', belly: '#f6f3ec', inner: '#4a4440',
    ear: ['leaf', 0.8, 'side'], tail: ['puff', 0.4], muzzle: 0.5, face: '#4a4440',
    note: '圓厚軀幹、深色小臉、側耳、短腿與小尾。羊毛用五至七塊大多面團塊。',
  },

  penguin: {
    rig: 'bird', size: 1.0, fur: '#2f3740', belly: '#f2efe8', inner: '#e8a23c',
    ear: ['none', 0], tail: ['wedge', 0.4], muzzle: 0.4,
    note: '直立梨形身體、黑背白腹、小喙、短翼與寬腳。保留搖擺步態。',
  },
  duck: {
    rig: 'bird', size: 0.72, fur: '#d8cdb6', belly: '#efe8d8', inner: '#e0a33e',
    ear: ['none', 0], tail: ['wedge', 0.6, 'up'], muzzle: 0.9,
    note: '圓身體、扁喙、短頸、扁腳與短翹尾。輪廓低矮，翅膀是兩片側面。',
  },
  owl: {
    rig: 'bird', size: 0.85, fur: '#9c8b74', belly: '#ddd0bb', inner: '#e0b05a',
    ear: ['tuft', 0.5], tail: ['wedge', 0.5], muzzle: 0.25,
    note: '大圓頭、寬面盤、短鉤喙、圓厚身體與短翼。耳羽用兩小角，不能像兔耳；轉頭幅度要克制。',
  },
  flamingo: {
    rig: 'bird', size: 1.5, fur: '#e8a8ae', belly: '#f2c4c6', inner: '#3a3733',
    ear: ['none', 0], tail: ['wedge', 0.4], muzzle: 1.0, legLong: 2.6,
    note: '小頭、長彎頸、長喙、細長雙腿與短尾。頸分三段，腿用低邊數細柱但要保持手機可見厚度。',
  },

  seal: {
    rig: 'pinniped', size: 1.3, fur: '#8e9298', belly: '#c2c6c9', inner: '#3a3733',
    ear: ['none', 0], tail: ['fin', 1.0], muzzle: 0.6,
    note: '長水滴形軀幹、圓頭、小前鰭與分叉後鰭，沒有外耳。不進入階梯或一般細步道。',
  },
};

/** 文件裡的中文名 → 程式用的 id。資料檔是中文寫的，這裡做一次對照就好。 */
export const SPECIES_BY_ZH = {
  兔子: 'rabbit', 棕熊: 'bear', 水獺: 'otter', 陸龜: 'tortoise', 水豚: 'capybara',
  松鼠: 'squirrel', 狐狸: 'fox', 梅花鹿: 'deer', 浣熊: 'raccoon', 小熊貓: 'redpanda',
  刺蝟: 'hedgehog', 貓: 'cat', 狗: 'dog', 山羊: 'goat', 綿羊: 'sheep',
  企鵝: 'penguin', 鴨子: 'duck', 貓頭鷹: 'owl', 紅鶴: 'flamingo', 海豹: 'seal',
};

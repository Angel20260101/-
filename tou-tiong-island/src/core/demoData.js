/**
 * 示範資料。
 *
 * 空的「我的紀錄」沒辦法拿去 demo——日曆全白、溫度計沒有顏色、收藏櫃是空的，
 * 看不出這些畫面長大之後是什麼樣子。
 *
 * 但示範資料**絕對不能自動載入**。一個真的使用者第一次進來，就看到一整個月
 * 不是他打的卡、不是他填的溫度計，那是在他自己的紀錄裡塞假東西。
 * 所以：
 *   - 只有明確按下「載入示範資料」或帶 ?demo=1 才會進來。
 *   - 進來之後存檔上會蓋一個 demo 旗標，介面一直標示「這不是你的紀錄」。
 *   - 隨時可以一鍵清掉，清掉就回到全新的島。
 *
 * 資料本身也刻意符合這個產品的主張：
 *   - 打卡**有缺口**。連續紀錄不是這裡的美德，示範資料就不該演一個全勤的人。
 *   - 溫度計四個級距都出現過，而且是上上下下的，不是一路變好。
 *   - 島嶼解鎖到一半，航線沒走完——那才是正常在玩的樣子。
 */
import { emptySave, dateKey, isoWeekKey, SAVE_VERSION } from './storage.js';

/** 固定種子的亂數：每次產生的示範資料都一樣，截圖與錄影才對得起來。 */
function seeded(seed) {
  let h = seed;
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const daysAgo = (n, from = new Date()) => {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return d;
};

/**
 * 產生一份「玩了兩個月左右」的存檔。
 * @param {object} content 內容包（要拿練習卡與紀念物的真實 id）
 */
export function buildDemoSave(content) {
  const rand = seeded(20261027);
  const save = emptySave();
  save.save_version = SAVE_VERSION;
  save.player_id = 'demo_island';
  save.demo = true;
  save.created_at = daysAgo(58).getTime();
  save.settings.trust_seen = true;

  // ── 天氣打卡：42 天裡來了 2/3，而且有一段連著好幾天沒來 ──
  // 缺口是刻意的。這個產品說「沒來的日子不代表什麼」，示範資料就不能演全勤。
  const SKIP = new Set([3, 4, 9, 16, 17, 18, 19, 25, 27, 33, 34, 40]);
  const MOOD = ['sunny', 'sunny', 'cloudy', 'rainy', 'cloudy', 'sunny', 'rainy'];
  for (let i = 41; i >= 0; i--) {
    if (SKIP.has(i)) continue;
    const d = daysAgo(i);
    // 近兩週晴天多一點：看得出「最近比較撐得住」，但不是一路向好
    const bias = i < 14 && rand() < 0.45 ? 0 : Math.floor(rand() * MOOD.length);
    save.daily[dateKey(d)] = {
      mood_id: MOOD[bias],
      energy: null,
      note: null,
      at: d.getTime(),
    };
  }

  // ── 心情溫度計：六週，四個級距都出現過，上上下下 ──
  const WEEKS = [
    { ago: 35, answers: { b1: 3, b2: 3, b3: 2, b4: 3, b5: 2 }, safety: 0 },  // 13 中度
    { ago: 28, answers: { b1: 4, b2: 3, b3: 3, b4: 4, b5: 3 }, safety: 1 },  // 17 重度
    { ago: 21, answers: { b1: 2, b2: 2, b3: 2, b4: 2, b5: 1 }, safety: 0 },  //  9 輕度
    { ago: 14, answers: { b1: 3, b2: 2, b3: 2, b4: 3, b5: 2 }, safety: 0 },  // 12 中度
    { ago: 7, answers: { b1: 1, b2: 2, b3: 1, b4: 1, b5: 1 }, safety: 0 },   //  6 輕度
    { ago: 0, answers: { b1: 1, b2: 1, b3: 1, b4: 0, b5: 1 }, safety: 0 },   //  4 良好
  ];
  const bands = content.dailyWeekly.weekly.instrument.bands;
  const keepsakes = content.dailyWeekly.weekly.reward.keepsakes;
  WEEKS.forEach((w, i) => {
    const score = Object.values(w.answers).reduce((a, b) => a + b, 0);
    const band = bands.find((b) => score >= b.min && score <= b.max);
    const keepsake = keepsakes[i % keepsakes.length];
    save.weekly.push({
      week: isoWeekKey(daysAgo(w.ago)),
      answers: w.answers,
      score,
      band_id: band.band_id,
      safety_flagged: w.safety >= content.dailyWeekly.weekly.safety_item.trigger_threshold,
      keepsake_id: keepsake.keepsake_id,
      at: daysAgo(w.ago).getTime(),
    });
    if (!save.keepsakes.includes(keepsake.keepsake_id)) save.keepsakes.push(keepsake.keepsake_id);
  });

  // ── 島嶼：三座解鎖、一座走完三條航線，其他留白 ──
  // 全部解鎖反而看不出「還有東西可以探索」，留白才是正在玩的樣子。
  const ISLANDS = [
    { id: 'island_boundary', name: '我的界線島', routes: ['r_01_boundary', 'r_01_dialogue', 'r_01_carry'],
      plays: 4, endings: { e_01_line: 2, e_01_deal: 1, e_01_carry: 1 }, ago: 50 },
    { id: 'island_voice', name: '', routes: ['r_02_protect', 'r_02_support'],
      plays: 2, endings: { e_02_shield: 1, e_02_echo: 1 }, ago: 31 },
    { id: 'island_night', name: '夜哨島', routes: ['r_03_safety'],
      plays: 1, endings: { e_03_railing: 1 }, ago: 12 },
  ];
  for (const i of ISLANDS) {
    save.islands[i.id] = {
      unlocked: true,
      name: i.name,
      routes: i.routes,
      plays: i.plays,
      endings: i.endings,
      first_completed_at: daysAgo(i.ago).getTime(),
      last_played_at: daysAgo(Math.max(0, i.ago - 9)).getTime(),
    };
  }

  // 練習卡：照走過的航線去查，不寫死對照表——寫死就會跟著內容改而對不上
  for (const i of ISLANDS) {
    for (const r of i.routes) {
      const card = content.practiceCards.cards.find((c) => c.route_id === r)?.card_id;
      if (card && !save.cards.includes(card)) save.cards.push(card);
    }
  }

  // ── 時光郵局：一封到期可以開、一封還封著、一封開過了 ──
  const now = Date.now();
  save.letters = [
    {
      letter_id: 'ltr_demo_1',
      text: '如果你看到這封信的時候還在那間公司，不是你沒用。是那件事真的很難。',
      written_at: daysAgo(30).getTime(),
      open_at: daysAgo(2).getTime(),
      by_ai: false,
      opened: false,
    },
    {
      letter_id: 'ltr_demo_2',
      text: '記得你今天跟她說「我八點之後不回訊息」的時候，手是抖的。下次會比較不抖。',
      written_at: daysAgo(45).getTime(),
      open_at: daysAgo(20).getTime(),
      by_ai: false,
      opened: true,
    },
    {
      letter_id: 'ltr_demo_3',
      text: '三個月後的你，希望還記得今天為什麼決定休那兩天假。',
      written_at: daysAgo(6).getTime(),
      open_at: now + 84 * 86400000,
      by_ai: false,
      opened: false,
    },
  ];

  // ── 碼頭許願：三艘小船，主題各不同 ──
  save.wishes = [
    { wish_id: 'wsh_demo_1', text: '', theme: '下班後不傳訊息', created_at: daysAgo(38).getTime(), submitted: true },
    { wish_id: 'wsh_demo_2', text: '', theme: '工作量與人力', created_at: daysAgo(19).getTime(), submitted: true },
    { wish_id: 'wsh_demo_3', text: '', theme: '休息空間', created_at: daysAgo(5).getTime(), submitted: true },
  ];

  save.updated_at = now;
  return save;
}

export const isDemo = (save) => Boolean(save?.demo);

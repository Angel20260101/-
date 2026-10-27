/**
 * 內容載入。
 *
 * 首屏只載入小檔（島嶼佈局、練習卡、任務文案、故事索引）；
 * 六篇故事各自是一個獨立 chunk，點進去才抓，所以手機第一次開啟不用下載全部劇本。
 */
import islandMap from '../../content/island_map.json';
import practiceCards from '../../content/practice_cards.json';
import dailyWeekly from '../../content/daily_weekly.json';
import aiFeedback from '../../content/ai_feedback.json';
import storyIndex from '../../content/story_index.json';
import wishBoard from '../../content/wish_board.json';

const storyLoaders = import.meta.glob('../../content/stories/*.json');

const cache = new Map();

export async function loadStory(storyId) {
  if (cache.has(storyId)) return cache.get(storyId);
  const entry = storyIndex.find((s) => s.story_id === storyId);
  if (!entry) throw new Error(`找不到故事 ${storyId}`);
  const key = Object.keys(storyLoaders).find((k) => k.endsWith(`/${entry.file}`));
  if (!key) throw new Error(`找不到故事檔案 ${entry.file}`);
  const mod = await storyLoaders[key]();
  const story = mod.default ?? mod;
  cache.set(storyId, story);
  return story;
}

export const content = {
  islandMap,
  practiceCards,
  dailyWeekly,
  aiFeedback,
  storyIndex,
  wishBoard,
  cardById(id) { return practiceCards.cards.find((c) => c.card_id === id) ?? null; },
  islandById(id) { return islandMap.islands.find((i) => i.island_id === id) ?? null; },
  islandForStory(storyId) { return islandMap.islands.find((i) => i.story_id === storyId) ?? null; },
  loadStory,
};

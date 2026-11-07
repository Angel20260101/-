/**
 * 島內場景的載入表。
 *
 * 一座島的場景資料與專屬道具都只有「走進去」才下載——規格要求
 * 「進入單島才載入其完整道具與 10 隻居民」，而且首屏本來就不該為了
 * 六座島的細節多背好幾百 KB。
 *
 * 要加第二座島：在 SCENES 多一筆，其他都不用動。
 */
const SCENES = {
  island_boundary: async () => {
    const [{ IslandScene }, data, oasis, base] = await Promise.all([
      import('../world/islandScene.js'),
      import('../../content/islands/01_sand_oasis.json'),
      import('../world/islandProps/sandOasis.js'),
      import('../world/props.js'),
    ]);
    return {
      IslandScene,
      data: data.default ?? data,
      // 島上的居民暫時借用群島的動物模型，所以兩包合起來給場景
      props: { ...base.PROP_FACTORIES, ...oasis.PROPS },
    };
  },
};

export const hasIslandScene = (islandId) => Boolean(SCENES[islandId]);
export const loadIslandScene = (islandId) => SCENES[islandId]();
export const islandSceneIds = () => Object.keys(SCENES);

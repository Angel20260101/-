/**
 * 效能預算。
 *
 * 2026-10 改版：目標從「中低階手機優先」改為「畫質優先」。
 *
 * 舊版為了中低階手機，全面禁用陰影、貼圖與 PBR 材質，畫面因此偏平。
 * 新版把這些放回來，代價是中低階手機可能掉到 30fps 以下。分級仍然保留，
 * 但現在它會影響畫質本身，不再只影響像素比與抗鋸齒。
 *
 * 關於陰影的成本，有一點值得寫清楚，免得日後又被當成「即時陰影」砍掉：
 * 這座島是靜態的，所以 shadowMap.autoUpdate 設為 false，陰影只在世界重建
 * 或光源改變時重算一次，不是每幀。穩定狀態下的每幀 draw call 跟沒有陰影時一樣。
 */
export const BUDGET = {
  /** 穩定狀態每幀的 draw call（不含只算一次的陰影 pass）。 */
  maxDrawCalls: 60,
  /** 陰影 pass 只在 invalidate 時跑一次，這是那一次的上限。 */
  maxShadowPassDrawCalls: 60,
  maxTextureSize: 0,          // 仍然不用貼圖，顏色繼續走頂點色
  shadows: true,              // 靜態烘焙一次，不是每幀
  postProcessing: false,      // tone mapping 不算後製：同一個 shader 內的色彩轉換，不另開 pass
  particles: false,
  dynamicLights: 0,           // 三盞光都是靜態的，只有投影的那盞會算陰影
  staticLights: 3,
};

export function detectTier() {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = navigator.deviceMemory ?? 4;
  if (!mobile) return 'desktop';
  if (cores <= 4 || mem <= 3) return 'mobile-low';
  return 'mobile';
}

/**
 * 分級現在也決定畫質。
 *
 * shadowMapSize 是唯一隨分級縮放的陰影成本——陰影 pass 本身只跑一次，
 * 真正吃記憶體的是貼圖尺寸。mobile-low 仍然拿得到陰影，只是比較柔。
 */
export function profileFor(tier) {
  switch (tier) {
    case 'mobile-low':
      return { pixelRatio: 1.25, antialias: false, maxFps: 30, shadowMapSize: 1024, pbr: true };
    case 'mobile':
      return { pixelRatio: 1.75, antialias: true, maxFps: 60, shadowMapSize: 1536, pbr: true };
    default:
      return { pixelRatio: 2.0, antialias: true, maxFps: 60, shadowMapSize: 2048, pbr: true };
  }
}

export const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

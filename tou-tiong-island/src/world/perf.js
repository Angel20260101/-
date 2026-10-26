/**
 * 效能預算。
 *
 * 中低階手機是主要目標，所以這裡的預設值偏保守：
 * 不用即時陰影、不用動態光源、不用粒子與後製，像素比與貼圖尺寸都設上限。
 * 分級只影響像素比與抗鋸齒，不影響任何遊戲內容。
 */
export const BUDGET = {
  maxDrawCalls: 60,
  maxTextureSize: 0,          // 全場景不使用貼圖，只有頂點色
  shadows: false,
  postProcessing: false,
  particles: false,
  dynamicLights: 0,           // 只有 Hemisphere + Directional 兩盞靜態光，皆不投影
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

export function profileFor(tier) {
  switch (tier) {
    case 'mobile-low':
      return { pixelRatio: 1.0, antialias: false, maxFps: 30 };
    case 'mobile':
      return { pixelRatio: 1.5, antialias: false, maxFps: 60 };
    default:
      return { pixelRatio: 2.0, antialias: true, maxFps: 60 };
  }
}

export const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

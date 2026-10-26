/**
 * 航線判定。
 *
 * 規則由故事 JSON 的 routes[] 決定，依 priority 由小到大評估，第一個命中的航線
 * 即為結果。最後一條航線必須是 { always: true }，所以任何遊玩組合都會落在
 * 恰好一條航線上——AI 不參與這個判定，同樣的選擇永遠得到同樣的航線。
 */
import { evalExpr } from './expr.js';

export function sortedRoutes(story) {
  return [...story.routes].sort((a, b) => a.priority - b.priority);
}

export function resolveRoute(story, ctx) {
  for (const route of sortedRoutes(story)) {
    if (evalExpr(route.rule, ctx)) return route;
  }
  // schema 已強制最後一條必須是 always，走到這裡代表資料有問題。
  throw new Error(`[${story.story_id}] 沒有任何航線命中，保底航線遺失`);
}

/**
 * 條件運算式求值器。
 *
 * 劇情分流、條件式對白、航線判定全部共用這一支，因此「同樣的狀態一定得到
 * 同樣的結果」這件事只需要在這裡保證一次。純函式、無副作用、不依賴瀏覽器，
 * 前端、驗證器與後端 Node 服務都直接 import 這個檔案。
 *
 * 支援的形式（每個 expr 物件只用其中一種）：
 *   { always: true }
 *   { all: [expr, ...] }            全部成立
 *   { any: [expr, ...] }            任一成立
 *   { not: expr }
 *   { var: 'boundary', op: '>=', value: 2 }
 *   { tag: 'speak', op: '>=', count: 2 }     // op 省略時視為 '>='
 *   { chose: ['c_xxx', ...] }       曾選過其中任一選項
 *   { ending: ['e_01_line', ...] }  目前結局屬於其中之一
 */

const COMPARATORS = {
  '>=': (a, b) => a >= b,
  '>': (a, b) => a > b,
  '<=': (a, b) => a <= b,
  '<': (a, b) => a < b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

export class ExprError extends Error {}

export function evalExpr(expr, ctx) {
  if (expr == null || typeof expr !== 'object') {
    throw new ExprError(`運算式必須是物件，收到：${JSON.stringify(expr)}`);
  }

  if ('always' in expr) return Boolean(expr.always);

  if ('all' in expr) return expr.all.every((e) => evalExpr(e, ctx));
  if ('any' in expr) return expr.any.some((e) => evalExpr(e, ctx));
  if ('not' in expr) return !evalExpr(expr.not, ctx);

  if ('var' in expr) {
    const cmp = COMPARATORS[expr.op];
    if (!cmp) throw new ExprError(`未知的比較運算子：${expr.op}`);
    return cmp(ctx.vars?.[expr.var] ?? 0, expr.value);
  }

  if ('tag' in expr) {
    const cmp = COMPARATORS[expr.op ?? '>='];
    if (!cmp) throw new ExprError(`未知的比較運算子：${expr.op}`);
    const want = expr.count ?? 1;
    return cmp(ctx.tags?.[expr.tag] ?? 0, want);
  }

  if ('chose' in expr) {
    const chosen = ctx.chosen ?? [];
    return expr.chose.some((id) => chosen.includes(id));
  }

  if ('ending' in expr) {
    return expr.ending.includes(ctx.ending_id);
  }

  throw new ExprError(`無法辨識的運算式：${JSON.stringify(expr)}`);
}

/** 把運算式翻成中文，供文件產生器與除錯面板使用。 */
export function describeExpr(expr, labels = {}) {
  if (expr == null || typeof expr !== 'object') return '（無效條件）';
  if ('always' in expr) return '永遠成立（保底）';
  if ('all' in expr) return expr.all.map((e) => describeExpr(e, labels)).join(' 且 ');
  if ('any' in expr) return expr.any.map((e) => describeExpr(e, labels)).join(' 或 ');
  if ('not' in expr) return `非（${describeExpr(expr.not, labels)}）`;
  if ('var' in expr) return `${labels[expr.var] ?? expr.var} ${expr.op} ${expr.value}`;
  if ('tag' in expr) return `標記「${expr.tag}」次數 ${expr.op ?? '>='} ${expr.count ?? 1}`;
  if ('chose' in expr) return `曾選過 ${expr.chose.join(' / ')}`;
  if ('ending' in expr) return `結局為 ${expr.ending.join(' / ')}`;
  return '（未知條件）';
}

export function applyEffects(ctx, effects) {
  if (!effects) return ctx;
  for (const eff of effects) {
    const current = ctx.vars[eff.var] ?? 0;
    switch (eff.op) {
      case 'add': ctx.vars[eff.var] = current + eff.value; break;
      case 'set': ctx.vars[eff.var] = eff.value; break;
      case 'max': ctx.vars[eff.var] = Math.max(current, eff.value); break;
      case 'min': ctx.vars[eff.var] = Math.min(current, eff.value); break;
      default: throw new ExprError(`未知的 state_effect 運算：${eff.op}`);
    }
  }
  return ctx;
}

export function addTags(ctx, tags) {
  if (!tags) return ctx;
  for (const t of tags) ctx.tags[t] = (ctx.tags[t] ?? 0) + 1;
  return ctx;
}

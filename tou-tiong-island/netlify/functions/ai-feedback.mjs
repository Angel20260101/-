/**
 * AI 個人化回饋服務（Netlify Function）。
 *
 * 流程：
 *   1. 驗證請求符合 schema/ai_feedback_request.schema.json
 *   2. 隱私剝除：沒有同意就移除 player_note；任何未定義的欄位一律丟掉
 *   3. 安全前置過濾：命中風險關鍵字 → 直接回傳固定的 safety 回應，不呼叫模型
 *   4. 呼叫模型（需要 ANTHROPIC_API_KEY；沒有設定就直接走固定文案）
 *   5. 安全後置過濾：格式、診斷詞、評價詞、聯絡方式、推測語氣
 *   6. 任何一關沒過 → content/ai_feedback.json 的 by_route 固定文案
 *
 * 環境變數
 *   ANTHROPIC_API_KEY   必要，沒有就全部走備援（服務仍然正常回應）
 *   TTI_AI_MODEL        可選，預設讀 content/ai_feedback.json 的 model.preferred
 *   TTI_AI_DISABLED     設為 "1" 可強制全部走備援（維運開關）
 */
import aiContent from '../../content/ai_feedback.json' with { type: 'json' };
import dailyWeekly from '../../content/daily_weekly.json' with { type: 'json' };

const SAFETY = dailyWeekly.safety;
const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const TIMEOUT_MS = 11000;

/** 允許進入模型的欄位白名單；其他一律丟棄。 */
const ALLOWED = new Set([
  'version', 'locale', 'request_id', 'story', 'ending', 'route',
  'choices', 'clues', 'practice_card', 'player_note', 'consent',
]);

const DIAGNOSIS_WORDS = ['憂鬱症', '焦慮症', '躁鬱', '思覺失調', '創傷後', 'PTSD', '確診', '病情', '療程', '就醫', '精神科', '診斷', '治療你'];
const JUDGEMENT_WORDS = ['你應該', '你最好', '正確的做法', '比較健康的是', '錯誤的是', '你不該', '建議你改'];
const HEDGE_WORDS = ['可能', '也許', '會不會', '有一種版本', '或許', '說不定'];
const CONTACT_RE = /(https?:\/\/|www\.|\b\d{3,4}-?\d{3,4}\b|\b1(925|995|980)\b)/;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

export function safetyResponse(reason) {
  return {
    version: '1.0.0',
    type: 'safety',
    safety: {
      message: `${SAFETY.intro}${SAFETY.body}`,
      resources: SAFETY.resources,
    },
    meta: { source: 'fallback', fallback_reason: reason },
  };
}

export function fallbackResponse(routeId, reason) {
  const body = aiContent.fallback.by_route[routeId] ?? aiContent.fallback.generic;
  return {
    version: '1.0.0',
    type: 'feedback',
    ...structuredClone(body),
    meta: { source: 'fallback', fallback_reason: reason },
  };
}

/** 最小必要驗證。完整 schema 在 schema/ai_feedback_request.schema.json，CI 會跑。
 *  這幾個純函式都具名匯出，tools/route-cases.mjs 會直接測它們。 */
export function validateRequest(req) {
  if (!req || req.version !== '1.0.0') return '缺少或不支援的 version';
  if (req.locale !== 'zh-TW') return '不支援的 locale';
  for (const key of ['story', 'ending', 'route', 'choices', 'practice_card', 'consent']) {
    if (!req[key]) return `缺少必填欄位 ${key}`;
  }
  if (!Array.isArray(req.choices) || !req.choices.length || req.choices.length > 6) return 'choices 長度不合法';
  if (req.consent.ai_feedback !== true) return '玩家未同意產生 AI 回饋';
  if (typeof req.route.route_id !== 'string') return 'route.route_id 不合法';
  if (req.player_note && String(req.player_note).length > 500) return 'player_note 過長';
  return null;
}

/** 隱私剝除：白名單欄位 ＋ 未同意就拿掉自填內容。 */
export function sanitize(req) {
  const clean = {};
  for (const [k, v] of Object.entries(req)) if (ALLOWED.has(k)) clean[k] = v;
  if (!clean.consent?.use_player_note) delete clean.player_note;
  return clean;
}

export function passesPostFilter(data) {
  if (!data || data.version !== '1.0.0' || data.type !== 'feedback') return '格式不符';
  if (!Array.isArray(data.possible_inner_voice) || data.possible_inner_voice.length < 1 || data.possible_inner_voice.length > 3) return '心聲數量不合法';
  if (typeof data.another_view !== 'string' || data.another_view.length < 10 || data.another_view.length > 240) return 'another_view 長度不合法';
  if (!data.small_practice?.title || !Array.isArray(data.small_practice.steps) || !data.small_practice.steps.length) return '練習格式不符';

  const all = [
    ...data.possible_inner_voice,
    data.another_view,
    data.small_practice.title,
    ...data.small_practice.steps,
    data.closing ?? '',
  ].join('\n');

  if (DIAGNOSIS_WORDS.some((w) => all.includes(w))) return '出現診斷詞彙';
  if (JUDGEMENT_WORDS.some((w) => all.includes(w))) return '出現評價詞彙';
  if (CONTACT_RE.test(all)) return '出現聯絡方式或網址';
  if (!data.possible_inner_voice.every((v) => HEDGE_WORDS.some((h) => v.includes(h)))) return '心聲缺少推測語氣';
  return null;
}

async function callModel(cleanRequest, apiKey) {
  const model = process.env.TTI_AI_MODEL || aiContent.model.preferred;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: aiContent.model.max_output_tokens,
        temperature: aiContent.model.temperature,
        system: aiContent.system_prompt,
        messages: [{
          role: 'user',
          content: aiContent.user_prompt_template.replace('{{REQUEST_JSON}}', JSON.stringify(cleanRequest, null, 2)),
        }],
      }),
    });
    if (!res.ok) throw new Error(`模型回應 HTTP ${res.status}`);
    const payload = await res.json();
    const text = (payload.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    return { data: JSON.parse(stripped), model };
  } finally {
    clearTimeout(timer);
  }
}

export default async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const invalid = validateRequest(body);
  if (invalid) return json({ error: 'invalid_request', detail: invalid }, 400);

  const routeId = body.route.route_id;
  const clean = sanitize(body);

  // 安全前置過濾：命中就不呼叫模型，也不留下這段文字
  const note = String(clean.player_note ?? '').replace(/\s/g, '');
  if (SAFETY.trigger_keywords.some((k) => note.includes(k))) {
    return json(safetyResponse('safety_keyword_prefilter'));
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || process.env.TTI_AI_DISABLED === '1') {
    return json(fallbackResponse(routeId, apiKey ? 'disabled_by_env' : 'missing_api_key'));
  }

  try {
    const { data, model } = await callModel(clean, apiKey);
    if (data?.type === 'safety') return json(safetyResponse('model_flagged_safety'));
    const rejected = passesPostFilter(data);
    if (rejected) return json(fallbackResponse(routeId, `post_filter:${rejected}`));
    return json({
      ...data,
      meta: { source: 'ai', model, generated_at: new Date().toISOString(), request_id: body.request_id },
    });
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'timeout' : String(err.message ?? err).slice(0, 80);
    return json(fallbackResponse(routeId, reason));
  }
};

export const config = { path: '/.netlify/functions/ai-feedback' };

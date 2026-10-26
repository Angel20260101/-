/**
 * AI 個人化回饋的前端客戶端。
 *
 * 規則：
 *   - 只送 schema/ai_feedback_request.schema.json 定義的欄位。
 *   - 每日心情、每週溫度計分數、島嶼名稱、裝置資訊一律不送。
 *   - 玩家沒有明確同意就不呼叫（consent）。
 *   - 逾時、失敗、格式不符、超量，一律改用 content/ai_feedback.json 的固定文案，
 *     畫面長得一樣，只是標示「這次用的是預先寫好的版本」。
 */
import { scanForRisk, safetyPayload } from './safety.js';

const ENDPOINT = '/.netlify/functions/ai-feedback';
const TIMEOUT_MS = 12000;

export function buildRequest({ story, ending, route, recap, card, playerNote, useNote }) {
  const req = {
    version: '1.0.0',
    locale: 'zh-TW',
    story: { story_id: story.story_id, title: story.title, theme: story.theme },
    ending: { ending_id: ending.ending_id, title: ending.title, summary: ending.recap?.summary, tags: ending.tags ?? [] },
    route: { route_id: route.route_id, name: route.name, meaning: route.meaning },
    choices: recap.choices.map((c) => ({
      node_title: c.node_title,
      choice_text: c.choice_text,
      consequence: c.consequence,
    })),
    clues: recap.clues.map((c) => ({ title: c.title, text: c.text })),
    practice_card: { card_id: card.card_id, title: card.title },
    consent: { ai_feedback: true, use_player_note: Boolean(useNote && playerNote) },
  };
  if (useNote && playerNote) req.player_note = String(playerNote).slice(0, 500);
  return req;
}

/** 回應驗證：不符合格式就當作沒有回應。 */
function isValidFeedback(data) {
  if (!data || data.version !== '1.0.0') return false;
  if (data.type === 'safety') return Boolean(data.safety?.resources?.length);
  if (data.type !== 'feedback') return false;
  if (!Array.isArray(data.possible_inner_voice) || !data.possible_inner_voice.length) return false;
  if (typeof data.another_view !== 'string' || data.another_view.length < 10) return false;
  if (!data.small_practice?.title || !Array.isArray(data.small_practice.steps)) return false;
  return true;
}

export function fallbackFor(routeId, aiContent) {
  const body = aiContent.fallback.by_route[routeId] ?? aiContent.fallback.generic;
  return {
    version: '1.0.0',
    type: 'feedback',
    ...structuredClone(body),
    meta: { source: 'fallback', fallback_reason: 'client_fallback' },
    ui_label: aiContent.fallback.ui_label,
  };
}

export async function requestFeedback(request, { aiContent, safetyConfig }) {
  // 本機先擋一次風險訊號：不用等伺服器，也不用把這段文字送出去
  const risk = scanForRisk(request.player_note, safetyConfig);
  if (risk.flagged) {
    return {
      version: '1.0.0',
      type: 'safety',
      safety: safetyPayload(safetyConfig),
      meta: { source: 'fallback', fallback_reason: 'safety_keyword_prefilter' },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.type === 'safety') return data;
    if (!isValidFeedback(data)) throw new Error('回應格式不符');
    return data;
  } catch (err) {
    const fb = fallbackFor(request.route.route_id, aiContent);
    fb.meta.fallback_reason = err.name === 'AbortError' ? 'timeout' : err.message;
    return fb;
  } finally {
    clearTimeout(timer);
  }
}

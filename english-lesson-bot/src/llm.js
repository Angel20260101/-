// One small adapter per provider. They all take a prompt and return text, so
// switching provider is an environment change, never a code change.

import { fetchWithRetry } from './http.js';

const DEFAULT_MODELS = {
  gemini: 'gemini-3.8-flash',
  groq: 'llama-3.3-70b-versatile',
  openai: 'gpt-4o-mini',
};

// Enough to walk past a retired model and its replacement, not enough to burn
// a quota — or real money — when the key itself is the problem.
const MAX_MODEL_ATTEMPTS = 4;

// Speech, image, video and embedding models are listed alongside the chat
// models, and asking one of them for a lesson just burns an attempt.
const WRONG_JOB = /tts|embedding|image|imagen|veo|audio|live|guard|aqa|whisper|dall-e|sora|moderation|transcribe|realtime/i;

function requireOk(res, body, provider) {
  if (!res.ok) {
    const detail = typeof body === 'string' ? body.slice(0, 600) : JSON.stringify(body).slice(0, 600);
    throw new Error(`${provider} request failed: ${res.status} ${res.statusText} — ${detail}`);
  }
}

/**
 * Google retires a model by rejecting it while still listing it, and the
 * rejection names the replacement: "Please update your code to use
 * models/gemini-3.8-flash". That name is the most reliable thing we have, so
 * read it straight out of the error.
 */
function suggestedModelFrom(body) {
  const message = body?.error?.message ?? '';
  const match = message.match(/models\/([A-Za-z0-9._-]+)/g);
  if (!match) return null;
  // The first name is the model we just asked for; a later one is the suggestion.
  const names = match.map((m) => m.replace('models/', ''));
  return names.length > 1 ? names[names.length - 1] : null;
}

async function listGeminiModels(apiKey, timeoutMs, fetchImpl) {
  const res = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    { signal: AbortSignal.timeout(timeoutMs) },
  );
  const body = await res.json();
  if (!res.ok) return [];

  const usable = (body.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((name) => !WRONG_JOB.test(name));

  // Flash first: cheapest, and the family the free tier actually serves.
  const rank = (name) => (/flash/i.test(name) ? (/lite/i.test(name) ? 1 : 0) : 2);
  return usable.sort((a, b) => rank(a) - rank(b));
}

async function callGemini({ prompt, apiKey, model, timeoutMs, fetchImpl, sleep }) {
  const tried = new Set();

  const attempt = async (modelName) => {
    tried.add(modelName);
    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
        }),
      },
      { fetchImpl, timeoutMs, sleep, label: `Gemini ${modelName}` },
    );
    return { res, body: await res.json() };
  };

  let { res, body } = await attempt(model);

  if (!res.ok && (res.status === 404 || res.status === 400 || res.status === 503)) {
    // A retired, misspelled or still-overloaded model: collect every other
    // name worth trying, starting with the one Google names in the rejection.
    const queue = [];
    const enqueue = (name) => {
      if (name && !tried.has(name) && !queue.includes(name)) queue.push(name);
    };

    enqueue(suggestedModelFrom(body));
    for (const name of await listGeminiModels(apiKey, timeoutMs, fetchImpl)) enqueue(name);

    while (queue.length && tried.size < MAX_MODEL_ATTEMPTS) {
      const next = queue.shift();
      console.warn(`[warn] Gemini model "${[...tried].pop()}" was rejected; trying "${next}".`);
      ({ res, body } = await attempt(next));
      if (res.ok) break;
      enqueue(suggestedModelFrom(body));
    }
  }

  requireOk(res, body, 'Gemini');

  const parts = body.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? '').join('').trim();
  if (!text) throw new Error(`Gemini returned no text (finishReason: ${body.candidates?.[0]?.finishReason ?? 'unknown'}).`);
  return text;
}

async function listChatModels({ baseUrl, apiKey, timeoutMs, fetchImpl }) {
  const res = await fetchImpl(`${baseUrl}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return [];
  const body = await res.json();

  const names = (body.data || [])
    .map((m) => m.id)
    .filter((id) => typeof id === 'string' && !WRONG_JOB.test(id));

  // Cheapest first: a weekly lesson does not need a frontier model.
  const rank = (id) => (/mini|lite|flash|small|8b/i.test(id) ? 0 : 1);
  return names.sort((a, b) => rank(a) - rank(b));
}

async function callOpenAICompatible({ prompt, apiKey, model, timeoutMs, baseUrl, provider, fetchImpl, sleep }) {
  const tried = new Set();

  const attempt = async (modelName) => {
    tried.add(modelName);
    const res = await fetchWithRetry(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    }, { fetchImpl, timeoutMs, sleep, label: `${provider} ${modelName}` });
    return { res, body: await res.json() };
  };

  let { res, body } = await attempt(model);

  // A retired or renamed model reads as 404, or as a 400 naming the parameter.
  if (!res.ok && (res.status === 404 || res.status === 400)) {
    const candidates = await listChatModels({ baseUrl, apiKey, timeoutMs, fetchImpl });
    for (const next of candidates) {
      if (tried.has(next) || tried.size >= MAX_MODEL_ATTEMPTS) break;
      console.warn(`[warn] ${provider} model "${model}" was rejected; trying "${next}".`);
      ({ res, body } = await attempt(next));
      if (res.ok) break;
    }
  }

  requireOk(res, body, provider);
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`${provider} returned no text.`);
  return text;
}

export async function complete(prompt, llmConfig, { fetchImpl = fetch, sleep } = {}) {
  const { provider, apiKey, timeoutMs } = llmConfig;
  const model = llmConfig.model || DEFAULT_MODELS[provider];
  if (!model) throw new Error(`Unknown LLM_PROVIDER "${provider}". Use gemini, groq or openai.`);

  switch (provider) {
    case 'gemini':
      return callGemini({ prompt, apiKey, model, timeoutMs, fetchImpl, sleep });
    case 'groq':
      return callOpenAICompatible({
        prompt, apiKey, model, timeoutMs, fetchImpl, sleep,
        baseUrl: 'https://api.groq.com/openai/v1',
        provider: 'Groq',
      });
    case 'openai':
      return callOpenAICompatible({
        prompt, apiKey, model, timeoutMs, fetchImpl, sleep,
        baseUrl: 'https://api.openai.com/v1',
        provider: 'OpenAI',
      });
    default:
      throw new Error(`Unknown LLM_PROVIDER "${provider}". Use gemini, groq or openai.`);
  }
}

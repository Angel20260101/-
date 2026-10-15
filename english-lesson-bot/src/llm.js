// One small adapter per provider. They all take a prompt and return text, so
// switching provider is an environment change, never a code change.

const DEFAULT_MODELS = {
  gemini: 'gemini-2.5-flash',
  groq: 'llama-3.3-70b-versatile',
  openai: 'gpt-4o',
};

function requireOk(res, body, provider) {
  if (!res.ok) {
    const detail = typeof body === 'string' ? body.slice(0, 600) : JSON.stringify(body).slice(0, 600);
    throw new Error(`${provider} request failed: ${res.status} ${res.statusText} — ${detail}`);
  }
}

/**
 * Gemini model names move around between releases, so when the configured
 * model is rejected we ask the API which models this key can actually use and
 * retry once with the first Flash model that supports generateContent.
 */
async function resolveGeminiModel(apiKey, timeoutMs, fetchImpl) {
  const res = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    { signal: AbortSignal.timeout(timeoutMs) },
  );
  const body = await res.json();
  requireOk(res, body, 'Gemini (listModels)');
  const usable = (body.models || []).filter((m) =>
    (m.supportedGenerationMethods || []).includes('generateContent'),
  );
  const flash = usable.find((m) => /flash/i.test(m.name) && !/lite/i.test(m.name)) ?? usable[0];
  if (!flash) throw new Error('No Gemini model available to this API key supports generateContent.');
  return flash.name.replace(/^models\//, '');
}

async function callGemini({ prompt, apiKey, model, timeoutMs, fetchImpl }) {
  const request = async (modelName) => {
    const res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    return { res, body: await res.json() };
  };

  let { res, body } = await request(model);
  if (res.status === 404 || res.status === 400) {
    const resolved = await resolveGeminiModel(apiKey, timeoutMs, fetchImpl);
    if (resolved !== model) {
      console.warn(`[warn] Gemini model "${model}" unavailable; retrying with "${resolved}".`);
      ({ res, body } = await request(resolved));
    }
  }
  requireOk(res, body, 'Gemini');

  const parts = body.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? '').join('').trim();
  if (!text) throw new Error(`Gemini returned no text (finishReason: ${body.candidates?.[0]?.finishReason ?? 'unknown'}).`);
  return text;
}

async function callOpenAICompatible({ prompt, apiKey, model, timeoutMs, baseUrl, provider, fetchImpl }) {
  const res = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json();
  requireOk(res, body, provider);
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`${provider} returned no text.`);
  return text;
}

export async function complete(prompt, llmConfig, { fetchImpl = fetch } = {}) {
  const { provider, apiKey, timeoutMs } = llmConfig;
  const model = llmConfig.model || DEFAULT_MODELS[provider];
  if (!model) throw new Error(`Unknown LLM_PROVIDER "${provider}". Use gemini, groq or openai.`);

  switch (provider) {
    case 'gemini':
      return callGemini({ prompt, apiKey, model, timeoutMs, fetchImpl });
    case 'groq':
      return callOpenAICompatible({
        prompt, apiKey, model, timeoutMs, fetchImpl,
        baseUrl: 'https://api.groq.com/openai/v1',
        provider: 'Groq',
      });
    case 'openai':
      return callOpenAICompatible({
        prompt, apiKey, model, timeoutMs, fetchImpl,
        baseUrl: 'https://api.openai.com/v1',
        provider: 'OpenAI',
      });
    default:
      throw new Error(`Unknown LLM_PROVIDER "${provider}". Use gemini, groq or openai.`);
  }
}

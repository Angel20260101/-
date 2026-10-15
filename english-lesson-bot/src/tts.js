import { fetchWithRetry } from './http.js';

/**
 * Which voices this key may actually speak with. A free plan is refused the
 * Voice Library, so the configured voice can be valid and still unusable —
 * the account's own list is the only reliable source.
 */
async function listUsableVoices(apiKey, timeoutMs, fetchImpl) {
  try {
    const res = await fetchImpl('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    const body = await res.json();
    return (body.voices || [])
      .filter((v) => v.voice_id)
      .map((v) => ({ id: v.voice_id, name: v.name ?? v.voice_id, category: v.category ?? '' }));
  } catch {
    return [];
  }
}

/**
 * ElevenLabs narration. Returns null instead of throwing when synthesis fails,
 * so a quota error or outage downgrades the email to text-only rather than
 * losing the whole week's lesson.
 */
export async function synthesize(script, ttsConfig, { fetchImpl = fetch, sleep } = {}) {
  if (!ttsConfig.enabled) return null;

  const text = (script || '').trim();
  if (!text) {
    console.warn('[warn] No audio script to narrate — skipping audio.');
    return null;
  }

  let payloadText = text;
  if (payloadText.length > ttsConfig.maxChars) {
    // Cut at a sentence boundary so the narration does not stop mid-word.
    const head = payloadText.slice(0, ttsConfig.maxChars);
    const lastStop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
    payloadText = lastStop > ttsConfig.maxChars * 0.5 ? head.slice(0, lastStop + 1) : head;
    console.warn(`[warn] Script trimmed to ${payloadText.length} chars (TTS_MAX_CHARS=${ttsConfig.maxChars}).`);
  }

  const speak = async (voiceId) => fetchWithRetry(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': ttsConfig.apiKey,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: payloadText,
        model_id: ttsConfig.modelId,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    },
    { fetchImpl, sleep, timeoutMs: ttsConfig.timeoutMs, label: 'ElevenLabs' },
  );

  try {
    let res = await speak(ttsConfig.voiceId);

    // 402 means the plan cannot use that voice, 404 that the key cannot see
    // it. Either way another voice on this account may work.
    if (!res.ok && [401, 402, 403, 404].includes(res.status)) {
      const detail = await res.text().catch(() => '');
      console.warn(`[warn] Voice "${ttsConfig.voiceId}" unavailable: ${res.status} — ${detail.slice(0, 200)}`);

      const voices = await listUsableVoices(ttsConfig.apiKey, ttsConfig.timeoutMs, fetchImpl);
      const alternative = voices.find((v) => v.id !== ttsConfig.voiceId);
      if (!alternative) {
        console.warn('[warn] No other voice is available to this key — sending a text-only lesson.');
        return null;
      }
      console.warn(`[warn] Falling back to "${alternative.name}" (${alternative.id}).`);
      res = await speak(alternative.id);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn(`[warn] ElevenLabs failed: ${res.status} ${res.statusText} — ${detail.slice(0, 400)}`);
      console.warn('[warn] Sending a text-only lesson instead.');
      return null;
    }

    const audio = Buffer.from(await res.arrayBuffer());
    if (!audio.length) {
      console.warn('[warn] ElevenLabs returned an empty body — skipping audio.');
      return null;
    }
    console.log(`[tts] Narrated ${payloadText.length} chars into ${(audio.length / 1024).toFixed(0)} KB of mp3.`);
    return { audio, charsUsed: payloadText.length };
  } catch (error) {
    console.warn(`[warn] ElevenLabs error: ${error.message}`);
    console.warn('[warn] Sending a text-only lesson instead.');
    return null;
  }
}

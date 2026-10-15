import { fetchWithRetry } from './http.js';

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

  try {
    const res = await fetchWithRetry(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(ttsConfig.voiceId)}?output_format=mp3_44100_128`,
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

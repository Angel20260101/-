import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFeed, pickEpisode } from '../src/rss.js';
import { normalizeLesson, buildPrompt } from '../src/lesson.js';
import { renderHtml, renderText } from '../src/render.js';
import { synthesize } from '../src/tts.js';
import { loadConfig } from '../src/config.js';

const xml = readFileSync(new URL('./fixtures/feed.xml', import.meta.url), 'utf8');
const NOW = new Date('2026-10-11T00:00:00Z');

const rawLesson = {
  topic: 'Procrastination',
  summary_en: 'Neil and Beth talk about why people delay tasks.',
  summary_native: '尼爾和貝絲討論人們為何拖延。',
  vocabulary: [
    { word: 'dawdle', part_of_speech: 'verb', meaning_en: 'to move slowly', meaning_native: '拖拖拉拉', example: 'Stop dawdling <and> finish it.' },
    { word: '', meaning_native: 'dropped because it has no word' },
  ],
  phrases: [{ phrase: 'put off', meaning_native: '延後', example: 'I put off the report.' }],
  questions: [{ question: 'What is procrastination?', answer: 'Delaying a task you should do now.' }],
  audio_script: 'Hello and welcome. Today we looked at procrastination.',
};

test('parseFeed reads titles, guids, dates and strips HTML from notes', () => {
  const { podcastTitle, episodes } = parseFeed(xml);
  assert.equal(podcastTitle, '6 Minute English');
  assert.equal(episodes.length, 2);

  const [newest] = episodes;
  assert.equal(newest.id, 'ep-002');
  assert.equal(newest.title, 'Why do we procrastinate?');
  assert.equal(newest.durationText, '06:12');
  assert.equal(newest.audioUrl, 'https://example.com/ep-002.mp3');
  assert.equal(newest.publishedAt.toISOString(), '2026-10-09T06:00:00.000Z');
  assert.match(newest.summary, /procrastination & why we put things off/);
  assert.doesNotMatch(newest.summary, /<[a-z]/i);
});

test('pickEpisode takes the newest unsent episode', () => {
  const { episode, reason } = pickEpisode(parseFeed(xml).episodes, { now: NOW });
  assert.equal(reason, 'ok');
  assert.equal(episode.id, 'ep-002');
});

test('pickEpisode refuses an episode already sent', () => {
  const result = pickEpisode(parseFeed(xml).episodes, { lastSentId: 'ep-002', now: NOW });
  assert.equal(result.episode, null);
  assert.equal(result.reason, 'already-sent');
});

test('pickEpisode refuses a stale feed', () => {
  const result = pickEpisode(parseFeed(xml).episodes, { maxAgeDays: 1, now: NOW });
  assert.equal(result.episode, null);
  assert.equal(result.reason, 'too-old');
  assert.equal(result.ageDays, 2);
});

test('pickEpisode handles an empty feed', () => {
  assert.equal(pickEpisode([], { now: NOW }).reason, 'feed-empty');
});

test('normalizeLesson drops incomplete rows and keeps the rest', () => {
  const lesson = normalizeLesson(rawLesson, { title: 'fallback' });
  assert.equal(lesson.vocabulary.length, 1);
  assert.equal(lesson.vocabulary[0].word, 'dawdle');
  assert.equal(lesson.phrases.length, 1);
  assert.equal(lesson.questions.length, 1);
});

test('normalizeLesson falls back to the episode title and rejects empty lessons', () => {
  assert.equal(normalizeLesson({ summary_en: 'x' }, { title: 'Ep title' }).topic, 'Ep title');
  assert.throws(() => normalizeLesson({}, { title: 'Ep title' }), /neither a summary nor vocabulary/);
});

test('buildPrompt carries the episode notes and the configured counts', () => {
  const prompt = buildPrompt(
    { title: 'Why do we procrastinate?', summary: 'notes about delay' },
    { level: 'B1-B2', nativeLanguage: '繁體中文', vocabCount: 8, phraseCount: 5, questionCount: 3 },
  );
  assert.match(prompt, /notes about delay/);
  assert.match(prompt, /exactly 8 items/);
  assert.match(prompt, /B1-B2/);
  assert.match(prompt, /繁體中文/);
});

test('renderHtml escapes user content and mentions the attachment when audio exists', () => {
  const [episode] = parseFeed(xml).episodes;
  const lesson = normalizeLesson(rawLesson, episode);

  const withAudio = renderHtml({ episode, lesson, podcastTitle: '6 Minute English', hasAudio: true });
  assert.match(withAudio, /lesson\.mp3/);
  assert.match(withAudio, /Stop dawdling &lt;and&gt; finish it\./);
  assert.doesNotMatch(withAudio, /dawdling <and>/);
  // The transcript rides along with the audio so it can be read while listening.
  assert.match(withAudio, /Hello and welcome/);

  const noAudio = renderHtml({ episode, lesson, podcastTitle: '6 Minute English', hasAudio: false });
  assert.match(noAudio, /語音合成未成功/);
  assert.match(noAudio, /Hello and welcome/);
  assert.doesNotMatch(noAudio, /lesson\.mp3/);
});

test('renderText includes every section', () => {
  const [episode] = parseFeed(xml).episodes;
  const text = renderText({ episode, lesson: normalizeLesson(rawLesson, episode), podcastTitle: '6 Minute English' });
  for (const needle of ['【摘要】', '【單字表】', 'dawdle', '【常用片語】', 'put off', '【理解測驗】', 'Q1.']) {
    assert.ok(text.includes(needle), `expected text to include ${needle}`);
  }
});

test('synthesize returns null on an API error instead of throwing', async () => {
  const ttsConfig = { enabled: true, apiKey: 'k', voiceId: 'v', modelId: 'm', maxChars: 2500, timeoutMs: 1000 };
  const failing = async () => ({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'quota exceeded' });
  assert.equal(await synthesize('hello', ttsConfig, { fetchImpl: failing }), null);

  const throwing = async () => { throw new Error('network down'); };
  assert.equal(await synthesize('hello', ttsConfig, { fetchImpl: throwing }), null);
});

test('synthesize trims an over-long script at a sentence boundary', async () => {
  let sent = '';
  const capture = async (_url, init) => {
    sent = JSON.parse(init.body).text;
    return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  const script = `${'A sentence here. '.repeat(20)}FINAL WORDS`;
  const result = await synthesize(script, {
    enabled: true, apiKey: 'k', voiceId: 'v', modelId: 'm', maxChars: 100, timeoutMs: 1000,
  }, { fetchImpl: capture });

  assert.ok(result.audio.length === 3);
  assert.ok(sent.length <= 100);
  assert.ok(sent.endsWith('.'));
  assert.doesNotMatch(sent, /FINAL WORDS/);
});

test('synthesize is a no-op when disabled or given an empty script', async () => {
  const boom = async () => { throw new Error('must not be called'); };
  assert.equal(await synthesize('hi', { enabled: false }, { fetchImpl: boom }), null);
  assert.equal(await synthesize('   ', { enabled: true, apiKey: 'k', maxChars: 10 }, { fetchImpl: boom }), null);
});

test('loadConfig applies defaults and strips spaces from the app password', () => {
  const config = loadConfig({ GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop', GMAIL_USER: 'a@b.c' });
  assert.equal(config.mail.appPassword, 'abcdefghijklmnop');
  assert.equal(config.mail.to, 'a@b.c');
  assert.equal(config.llm.provider, 'openai');
  assert.equal(config.lesson.vocabCount, 8);
  assert.equal(config.tts.voiceId, '');
  assert.equal(config.tts.voiceGender, 'female');
});

test('loadConfig honours overrides', () => {
  const config = loadConfig({ LLM_PROVIDER: 'GROQ', VOCAB_COUNT: '12', TTS_ENABLED: 'false', MAIL_TO: 'x@y.z' });
  assert.equal(config.llm.provider, 'groq');
  assert.equal(config.lesson.vocabCount, 12);
  assert.equal(config.tts.enabled, false);
  assert.equal(config.mail.to, 'x@y.z');
});

test('generateLesson strips code fences and survives a retired Gemini model', async () => {
  // The exact failure seen in production: Google rejects the configured model,
  // still lists it in listModels, and names the replacement in the error text.
  const retired = 'gemini-2.5-flash';
  const replacement = 'gemini-3.8-flash';
  const lessonJson = JSON.stringify({
    topic: 'Procrastination',
    summary_en: 'Why we delay.',
    vocabulary: [{ word: 'dawdle', meaning_native: '拖拉' }],
    audio_script: 'Hello.',
  });

  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/models?key=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            // The retired model is still listed — picking from this list alone
            // would loop straight back onto it.
            { name: `models/${retired}`, supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-9-pro', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
      };
    }
    if (url.includes(`${retired}:generateContent`)) {
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({
          error: {
            code: 404,
            message: `This model models/${retired} is no longer available to new users. Please update your code to use models/${replacement} for the latest features and improvements.`,
            status: 'NOT_FOUND',
          },
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: `\`\`\`json\n${lessonJson}\n\`\`\`` }] } }] }),
    };
  };

  const { generateLesson } = await import('../src/lesson.js');
  const lesson = await generateLesson(
    { title: 'Why do we procrastinate?', summary: 'notes' },
    {
      lesson: { level: 'B1-B2', nativeLanguage: '繁體中文', vocabCount: 8, phraseCount: 5, questionCount: 3 },
      llm: { provider: 'gemini', apiKey: 'k', model: retired, timeoutMs: 5000 },
    },
    { fetchImpl },
  );

  assert.equal(lesson.topic, 'Procrastination');
  assert.equal(lesson.vocabulary[0].word, 'dawdle');
  // The model named in the error is tried before anything from listModels.
  assert.ok(calls.some((u) => u.includes(`${replacement}:generateContent`)));
  assert.equal(calls.filter((u) => u.includes(`${retired}:generateContent`)).length, 1);
});

test('callGemini gives up instead of retrying forever on a bad key', async () => {
  let generateCalls = 0;
  const fetchImpl = async (url) => {
    if (url.includes('/models?key=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => ({
            name: `models/gemini-${n}-flash`,
            supportedGenerationMethods: ['generateContent'],
          })),
        }),
      };
    }
    generateCalls += 1;
    return { ok: false, status: 400, statusText: 'Bad Request', json: async () => ({ error: { message: 'API key not valid' } }) };
  };

  const { complete } = await import('../src/llm.js');
  await assert.rejects(
    complete('p', { provider: 'gemini', apiKey: 'bad', model: 'gemini-x-flash', timeoutMs: 5000 }, { fetchImpl }),
    /Gemini request failed: 400/,
  );
  assert.ok(generateCalls <= 4, `expected at most 4 generate calls, got ${generateCalls}`);
});

test('complete rejects an unknown provider', async () => {
  const { complete } = await import('../src/llm.js');
  await assert.rejects(
    complete('p', { provider: 'llamafile', apiKey: 'k', timeoutMs: 1000 }),
    /Unknown LLM_PROVIDER/,
  );
});

// --- transient failure handling -------------------------------------------

const noSleep = async () => {};

test('fetchWithRetry retries a 503 and returns the first success', async () => {
  const { fetchWithRetry } = await import('../src/http.js');
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls < 3
      ? { ok: false, status: 503, statusText: 'Service Unavailable' }
      : { ok: true, status: 200 };
  };

  const res = await fetchWithRetry('https://x', {}, { fetchImpl, sleep: noSleep });
  assert.equal(res.ok, true);
  assert.equal(calls, 3);
});

test('fetchWithRetry does not retry a client error', async () => {
  const { fetchWithRetry } = await import('../src/http.js');
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: false, status: 401, statusText: 'Unauthorized' };
  };

  const res = await fetchWithRetry('https://x', {}, { fetchImpl, sleep: noSleep });
  assert.equal(res.status, 401);
  assert.equal(calls, 1);
});

test('fetchWithRetry gives up and returns the last failure', async () => {
  const { fetchWithRetry } = await import('../src/http.js');
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: false, status: 503, statusText: 'Service Unavailable' };
  };

  const res = await fetchWithRetry('https://x', {}, { fetchImpl, sleep: noSleep, attempts: 3 });
  assert.equal(res.status, 503);
  assert.equal(calls, 3);
});

test('fetchWithRetry retries a dropped connection and rethrows if it never recovers', async () => {
  const { fetchWithRetry } = await import('../src/http.js');
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls < 2) throw new Error('socket hang up');
    return { ok: true, status: 200 };
  };
  assert.equal((await fetchWithRetry('https://x', {}, { fetchImpl: flaky, sleep: noSleep })).ok, true);

  const alwaysDown = async () => { throw new Error('network down'); };
  await assert.rejects(
    fetchWithRetry('https://x', {}, { fetchImpl: alwaysDown, sleep: noSleep, attempts: 2 }),
    /network down/,
  );
});

test('fetchWithRetry waits for Retry-After when the server sets it', async () => {
  const { fetchWithRetry } = await import('../src/http.js');
  const waits = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1
      ? { ok: false, status: 429, statusText: 'Too Many Requests', headers: { get: (h) => (h === 'retry-after' ? '7' : null) } }
      : { ok: true, status: 200 };
  };

  await fetchWithRetry('https://x', {}, { fetchImpl, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(waits, [7000]);
});

test('fetchWithRetry gives each attempt its own timeout signal', async () => {
  const { fetchWithRetry } = await import('../src/http.js');
  const signals = [];
  let calls = 0;
  const fetchImpl = async (_url, init) => {
    signals.push(init.signal);
    calls += 1;
    return calls < 2 ? { ok: false, status: 502, statusText: 'Bad Gateway' } : { ok: true, status: 200 };
  };

  await fetchWithRetry('https://x', { method: 'POST' }, { fetchImpl, sleep: noSleep, timeoutMs: 5000 });
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
  assert.ok(signals.every((s) => s instanceof AbortSignal));
});

test('a Gemini overload recovers on retry instead of failing the run', async () => {
  // The production failure: 503 "This model is currently experiencing high demand".
  const lessonJson = JSON.stringify({ topic: 'T', summary_en: 'S', vocabulary: [{ word: 'w', meaning_native: 'm' }] });
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 3) {
      return { ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({ error: { message: 'high demand' } }) };
    }
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: lessonJson }] } }] }) };
  };

  const { complete } = await import('../src/llm.js');
  const text = await complete('p', { provider: 'gemini', apiKey: 'k', model: 'gemini-3.8-flash', timeoutMs: 5000 }, { fetchImpl, sleep: noSleep });
  assert.match(text, /"topic":"T"/);
  assert.equal(calls, 3);
});

test('a model that stays overloaded falls through to another model', async () => {
  const lessonJson = JSON.stringify({ topic: 'T', summary_en: 'S', vocabulary: [{ word: 'w', meaning_native: 'm' }] });
  const busy = 'gemini-3.8-flash';
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/models?key=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: `models/${busy}`, supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-3.8-flash-lite', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
      };
    }
    if (url.includes(`${busy}:generateContent`)) {
      return { ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({ error: { message: 'high demand' } }) };
    }
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: lessonJson }] } }] }) };
  };

  const { complete } = await import('../src/llm.js');
  const text = await complete('p', { provider: 'gemini', apiKey: 'k', model: busy, timeoutMs: 5000 }, { fetchImpl, sleep: noSleep });
  assert.match(text, /"topic":"T"/);
  assert.ok(calls.some((u) => u.includes('gemini-3.8-flash-lite:generateContent')));
});

test('the model fallback skips speech, image and embedding models', async () => {
  // Seen in production: the walk tried gemini-2.5-flash-preview-tts, a
  // text-to-speech model, and wasted an attempt on a guaranteed failure.
  const lessonJson = JSON.stringify({ topic: 'T', summary_en: 'S', vocabulary: [{ word: 'w', meaning_native: 'm' }] });
  const tried = [];
  const fetchImpl = async (url) => {
    if (url.includes('/models?key=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            'gemini-2.5-flash-preview-tts',
            'gemini-embedding-001',
            'imagen-4.0-generate-001',
            'gemini-live-2.5-flash',
            'gemini-flash-latest',
          ].map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })),
        }),
      };
    }
    const model = url.match(/models\/([^:]+):generateContent/)[1];
    tried.push(model);
    if (model === 'gemini-dead') {
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: { message: 'gone' } }) };
    }
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: lessonJson }] } }] }) };
  };

  const { complete } = await import('../src/llm.js');
  await complete('p', { provider: 'gemini', apiKey: 'k', model: 'gemini-dead', timeoutMs: 5000 }, { fetchImpl, sleep: async () => {} });

  assert.deepEqual(tried, ['gemini-dead', 'gemini-flash-latest']);
  for (const junk of ['tts', 'embedding', 'imagen', 'live']) {
    assert.ok(!tried.some((m) => m.includes(junk)), `should not have tried a ${junk} model`);
  }
});

test('OpenAI walks past a retired model and skips non-chat ones', async () => {
  const tried = [];
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/models')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 'whisper-1' },
            { id: 'text-embedding-3-small' },
            { id: 'dall-e-3' },
            { id: 'gpt-9' },
            { id: 'gpt-9-mini' },
          ],
        }),
      };
    }
    const model = JSON.parse(init.body).model;
    tried.push(model);
    if (model === 'gpt-4o-mini') {
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: { message: 'The model `gpt-4o-mini` does not exist' } }) };
    }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"topic":"T"}' } }] }) };
  };

  const { complete } = await import('../src/llm.js');
  const text = await complete('p', { provider: 'openai', apiKey: 'k', timeoutMs: 5000 }, { fetchImpl, sleep: async () => {} });

  assert.equal(text, '{"topic":"T"}');
  // Default first, then the cheapest usable chat model — never whisper/embedding/dall-e.
  assert.deepEqual(tried, ['gpt-4o-mini', 'gpt-9-mini']);
});

test('OpenAI retries a 503 the same way Gemini does', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls < 3
      ? { ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({}) }
      : { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":1}' } }] }) };
  };

  const { complete } = await import('../src/llm.js');
  assert.equal(
    await complete('p', { provider: 'openai', apiKey: 'k', timeoutMs: 5000 }, { fetchImpl, sleep: async () => {} }),
    '{"ok":1}',
  );
  assert.equal(calls, 3);
});

test('a voice the plan cannot use falls back to one the account owns', async () => {
  // Production: ElevenLabs returned 402 "Free users cannot use library voices
  // via the API" for the hard-coded default voice.
  const blocked = '21m00Tcm4TlvDq8ikWAM';
  const spokenWith = [];
  const fetchImpl = async (url) => {
    if (url.endsWith('/v1/voices')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          voices: [
            { voice_id: blocked, name: 'Rachel', category: 'premade' },
            { voice_id: 'own-voice-1', name: 'My Voice', category: 'cloned' },
          ],
        }),
      };
    }
    const voiceId = url.match(/text-to-speech\/([^?]+)/)[1];
    spokenWith.push(voiceId);
    if (voiceId === blocked) {
      return {
        ok: false,
        status: 402,
        statusText: 'Payment Required',
        text: async () => '{"detail":{"code":"paid_plan_required"}}',
      };
    }
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(2048).buffer };
  };

  const result = await synthesize('Hello there.', {
    enabled: true, apiKey: 'k', voiceId: blocked, modelId: 'm', maxChars: 2500, timeoutMs: 1000,
  }, { fetchImpl, sleep: async () => {} });

  assert.ok(result, 'expected audio from the fallback voice');
  assert.deepEqual(spokenWith, [blocked, 'own-voice-1']);
});

test('no usable voice still sends the lesson as text', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/v1/voices')) return { ok: true, status: 200, json: async () => ({ voices: [] }) };
    return { ok: false, status: 402, statusText: 'Payment Required', text: async () => 'paid_plan_required' };
  };

  const result = await synthesize('Hello there.', {
    enabled: true, apiKey: 'k', voiceId: 'blocked', modelId: 'm', maxChars: 2500, timeoutMs: 1000,
  }, { fetchImpl, sleep: async () => {} });

  assert.equal(result, null);
});

test('with no voice configured it picks a female voice from the account', async () => {
  const spokenWith = [];
  const fetchImpl = async (url) => {
    if (url.endsWith('/v1/voices')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          voices: [
            { voice_id: 'roger', name: 'Roger', labels: { gender: 'male' } },
            { voice_id: 'alice', name: 'Alice', labels: { gender: 'female' } },
          ],
        }),
      };
    }
    spokenWith.push(url.match(/text-to-speech\/([^?]+)/)[1]);
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(1024).buffer };
  };

  const result = await synthesize('Hello.', {
    enabled: true, apiKey: 'k', voiceId: '', voiceGender: 'female', modelId: 'm', maxChars: 2500, timeoutMs: 1000,
  }, { fetchImpl, sleep: async () => {} });

  assert.ok(result);
  // Straight to a female voice: no wasted call on an id the plan would refuse.
  assert.deepEqual(spokenWith, ['alice']);
});

test('voice preference honours the configured gender and tolerates unlabelled voices', async () => {
  const spokenWith = [];
  const voices = [
    { voice_id: 'unlabelled', name: 'Mystery' },
    { voice_id: 'roger', name: 'Roger', labels: { gender: 'male' } },
  ];
  const fetchImpl = async (url) => {
    if (url.endsWith('/v1/voices')) return { ok: true, status: 200, json: async () => ({ voices }) };
    spokenWith.push(url.match(/text-to-speech\/([^?]+)/)[1]);
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(1024).buffer };
  };

  await synthesize('Hello.', {
    enabled: true, apiKey: 'k', voiceId: '', voiceGender: 'male', modelId: 'm', maxChars: 2500, timeoutMs: 1000,
  }, { fetchImpl, sleep: async () => {} });
  assert.deepEqual(spokenWith, ['roger']);

  // No female voice on the account: an unlabelled one beats sending no audio.
  spokenWith.length = 0;
  await synthesize('Hello.', {
    enabled: true, apiKey: 'k', voiceId: '', voiceGender: 'female', modelId: 'm', maxChars: 2500, timeoutMs: 1000,
  }, { fetchImpl, sleep: async () => {} });
  assert.deepEqual(spokenWith, ['unlabelled']);
});

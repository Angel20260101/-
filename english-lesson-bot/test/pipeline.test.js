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

  const noAudio = renderHtml({ episode, lesson, podcastTitle: '6 Minute English', hasAudio: false });
  assert.match(noAudio, /語音合成未成功/);
  assert.match(noAudio, /Hello and welcome/);
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
  assert.equal(config.llm.provider, 'gemini');
  assert.equal(config.lesson.vocabCount, 8);
  assert.equal(config.tts.voiceId, '21m00Tcm4TlvDq8ikWAM');
});

test('loadConfig honours overrides', () => {
  const config = loadConfig({ LLM_PROVIDER: 'GROQ', VOCAB_COUNT: '12', TTS_ENABLED: 'false', MAIL_TO: 'x@y.z' });
  assert.equal(config.llm.provider, 'groq');
  assert.equal(config.lesson.vocabCount, 12);
  assert.equal(config.tts.enabled, false);
  assert.equal(config.mail.to, 'x@y.z');
});

test('generateLesson strips code fences and survives a Gemini model fallback', async () => {
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
            { name: 'models/gemini-9-pro', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-9-flash', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
      };
    }
    if (url.includes('gemini-does-not-exist')) {
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'nope' }) };
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
      llm: { provider: 'gemini', apiKey: 'k', model: 'gemini-does-not-exist', timeoutMs: 5000 },
    },
    { fetchImpl },
  );

  assert.equal(lesson.topic, 'Procrastination');
  assert.equal(lesson.vocabulary[0].word, 'dawdle');
  // 404 on the configured model -> list models -> retry on the Flash model.
  assert.ok(calls.some((u) => u.includes('/models?key=')));
  assert.ok(calls.some((u) => u.includes('gemini-9-flash:generateContent')));
});

test('complete rejects an unknown provider', async () => {
  const { complete } = await import('../src/llm.js');
  await assert.rejects(
    complete('p', { provider: 'llamafile', apiKey: 'k', timeoutMs: 1000 }),
    /Unknown LLM_PROVIDER/,
  );
});

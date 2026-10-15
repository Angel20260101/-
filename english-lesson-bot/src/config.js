// All tunables live here. Everything is read from the environment so the same
// code runs locally (.env via `--env-file`) and on GitHub Actions (Secrets).

function int(env, name, fallback) {
  const raw = env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${raw}"`);
  return n;
}

function bool(env, name, fallback = false) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(raw.toLowerCase());
}

export function loadConfig(env = process.env) {
  const provider = (env.LLM_PROVIDER || 'openai').toLowerCase();

  const config = {
    dryRun: bool(env, 'DRY_RUN'),

    feedUrl: env.PODCAST_RSS_URL || 'https://podcasts.files.bbci.co.uk/p02pc9zn.rss',
    // How far back an episode may be published and still count as "new".
    maxEpisodeAgeDays: int(env, 'MAX_EPISODE_AGE_DAYS', 14),
    stateFile: env.STATE_FILE || 'state/last-episode.json',
    // Send even if this episode was already sent last week.
    ignoreState: bool(env, 'IGNORE_STATE'),

    lesson: {
      level: env.LESSON_LEVEL || 'B1-B2',
      // Language used for explanations and translations.
      nativeLanguage: env.NATIVE_LANGUAGE || '繁體中文',
      vocabCount: int(env, 'VOCAB_COUNT', 8),
      phraseCount: int(env, 'PHRASE_COUNT', 5),
      questionCount: int(env, 'QUESTION_COUNT', 3),
    },

    llm: {
      provider,
      apiKey: env.LLM_API_KEY || env.OPENAI_API_KEY || env.GEMINI_API_KEY || env.GROQ_API_KEY || '',
      model: env.LLM_MODEL || '',
      timeoutMs: int(env, 'LLM_TIMEOUT_MS', 120000),
    },

    tts: {
      enabled: bool(env, 'TTS_ENABLED', true),
      apiKey: env.ELEVENLABS_API_KEY || '',
      voiceId: env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM', // "Rachel"
      modelId: env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
      // Hard cap so a long script cannot silently drain a free-tier quota.
      maxChars: int(env, 'TTS_MAX_CHARS', 2500),
      timeoutMs: int(env, 'TTS_TIMEOUT_MS', 180000),
    },

    mail: {
      user: env.GMAIL_USER || '',
      appPassword: (env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''),
      to: env.MAIL_TO || env.GMAIL_USER || '',
      fromName: env.MAIL_FROM_NAME || 'English Lesson Bot',
      subjectPrefix: env.MAIL_SUBJECT_PREFIX || '🎧 本週英語課',
    },
  };

  return config;
}

export function assertRunnable(config) {
  const missing = [];
  if (!config.llm.apiKey) missing.push(`${config.llm.provider.toUpperCase()}_API_KEY (or LLM_API_KEY)`);
  if (!config.dryRun) {
    if (!config.mail.user) missing.push('GMAIL_USER');
    if (!config.mail.appPassword) missing.push('GMAIL_APP_PASSWORD');
    if (!config.mail.to) missing.push('MAIL_TO');
  }
  if (config.tts.enabled && !config.tts.apiKey) {
    // Not fatal: the run continues and sends a text-only lesson.
    console.warn('[warn] TTS_ENABLED but ELEVENLABS_API_KEY is empty — audio will be skipped.');
    config.tts.enabled = false;
  }
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

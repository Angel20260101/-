import { complete } from './llm.js';

export function buildPrompt(episode, lessonConfig) {
  const { level, nativeLanguage, vocabCount, phraseCount, questionCount } = lessonConfig;
  const source = episode.summary || episode.title;

  return `You are an experienced ESL teacher preparing a short self-study lesson from a podcast episode.

EPISODE TITLE: ${episode.title}
EPISODE NOTES / DESCRIPTION:
"""
${source.slice(0, 6000)}
"""

Build a lesson for a learner at CEFR level ${level} whose first language is ${nativeLanguage}.
Base the lesson only on the episode material above. If the notes are thin, teach the
language of the topic itself rather than inventing facts about what was said.

Respond with a single JSON object, no markdown fences, with exactly these keys:

{
  "topic": "short English phrase naming the topic",
  "summary_en": "4-6 sentence summary of the episode in English at ${level} level",
  "summary_native": "the same summary written in ${nativeLanguage}",
  "vocabulary": [            // exactly ${vocabCount} items, useful and not trivially easy
    {
      "word": "the word or short phrase",
      "part_of_speech": "noun | verb | adjective | adverb | phrase",
      "meaning_en": "simple English definition",
      "meaning_native": "meaning in ${nativeLanguage}",
      "example": "a natural example sentence using it in this episode's context"
    }
  ],
  "phrases": [               // exactly ${phraseCount} collocations or idioms
    {
      "phrase": "the expression",
      "meaning_native": "what it means in ${nativeLanguage}",
      "example": "an example sentence"
    }
  ],
  "questions": [             // exactly ${questionCount} comprehension questions
    {
      "question": "a comprehension question in English",
      "answer": "the answer in English, one or two sentences"
    }
  ],
  "audio_script": "A 200-300 word English narration a teacher would read aloud: greet the learner, say what the episode was about, walk through the most important vocabulary with its meaning used in a sentence, and close with one study tip. Plain prose only — no headings, no bullet points, no stage directions, no speaker labels."
}`;
}

function extractJson(raw) {
  let text = raw.trim();

  // Models sometimes wrap JSON in ```json fences despite being told not to.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  try {
    return JSON.parse(text);
  } catch {
    // Fall back to the outermost {...} span.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error(`LLM response was not JSON: ${raw.slice(0, 300)}`);
    }
    return JSON.parse(text.slice(start, end + 1));
  }
}

export function normalizeLesson(parsed, episode) {
  const arr = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);
  const str = (value, fallback = '') =>
    typeof value === 'string' && value.trim() ? value.trim() : fallback;

  const lesson = {
    topic: str(parsed.topic, episode.title),
    summaryEn: str(parsed.summary_en),
    summaryNative: str(parsed.summary_native),
    vocabulary: arr(parsed.vocabulary).map((v) => ({
      word: str(v.word),
      partOfSpeech: str(v.part_of_speech),
      meaningEn: str(v.meaning_en),
      meaningNative: str(v.meaning_native),
      example: str(v.example),
    })).filter((v) => v.word),
    phrases: arr(parsed.phrases).map((p) => ({
      phrase: str(p.phrase),
      meaningNative: str(p.meaning_native),
      example: str(p.example),
    })).filter((p) => p.phrase),
    questions: arr(parsed.questions).map((q) => ({
      question: str(q.question),
      answer: str(q.answer),
    })).filter((q) => q.question),
    audioScript: str(parsed.audio_script),
  };

  if (!lesson.summaryEn && !lesson.vocabulary.length) {
    throw new Error('LLM returned a lesson with neither a summary nor vocabulary.');
  }
  return lesson;
}

export async function generateLesson(episode, config, deps = {}) {
  const raw = await complete(buildPrompt(episode, config.lesson), config.llm, deps);
  return normalizeLesson(extractJson(raw), episode);
}

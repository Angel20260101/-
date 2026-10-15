import { writeFile, mkdir } from 'node:fs/promises';
import { loadConfig, assertRunnable } from './config.js';
import { fetchFeed, pickEpisode } from './rss.js';
import { generateLesson } from './lesson.js';
import { synthesize } from './tts.js';
import { renderHtml, renderText } from './render.js';
import { sendLesson } from './email.js';
import { readState, writeState } from './state.js';

async function main() {
  const config = loadConfig();
  assertRunnable(config);

  console.log(`[1/5] Fetching ${config.feedUrl}`);
  const { podcastTitle, episodes } = await fetchFeed(config.feedUrl);
  console.log(`      "${podcastTitle}" — ${episodes.length} episodes in feed.`);

  const state = config.ignoreState ? {} : await readState(config.stateFile);
  const { episode, reason, episodeTitle, ageDays } = pickEpisode(episodes, {
    lastSentId: state.lastEpisodeId,
    maxAgeDays: config.maxEpisodeAgeDays,
  });

  if (!episode) {
    const notes = {
      'feed-empty': 'the feed contained no episodes',
      'already-sent': `the newest episode ("${episodeTitle}") was already sent`,
      'too-old': `the newest episode ("${episodeTitle}") is ${ageDays} days old, past MAX_EPISODE_AGE_DAYS=${config.maxEpisodeAgeDays}`,
    };
    console.log(`      Nothing to send: ${notes[reason] ?? reason}.`);
    console.log('      Exiting cleanly without sending mail.');
    return;
  }
  console.log(`      Chose: "${episode.title}"`);

  console.log(`[2/5] Generating the lesson with ${config.llm.provider}`);
  const lesson = await generateLesson(episode, config);
  console.log(`      ${lesson.vocabulary.length} words, ${lesson.phrases.length} phrases, ${lesson.questions.length} questions.`);

  console.log('[3/5] Narrating with ElevenLabs');
  const narration = await synthesize(lesson.audioScript, config.tts);

  console.log('[4/5] Rendering the email');
  const html = renderHtml({ episode, lesson, podcastTitle, hasAudio: Boolean(narration) });
  const text = renderText({ episode, lesson, podcastTitle });
  const subject = `${config.mail.subjectPrefix}｜${lesson.topic}`;

  if (config.dryRun) {
    await mkdir('out', { recursive: true });
    await writeFile('out/lesson.html', html, 'utf8');
    await writeFile('out/lesson.txt', text, 'utf8');
    if (narration) await writeFile('out/lesson.mp3', narration.audio);
    console.log('[5/5] DRY_RUN — wrote out/lesson.html, out/lesson.txt' + (narration ? ', out/lesson.mp3' : ''));
    console.log(`      Subject would be: ${subject}`);
    return;
  }

  console.log(`[5/5] Sending to ${config.mail.to}`);
  const info = await sendLesson({
    mailConfig: config.mail,
    subject,
    html,
    text,
    audio: narration?.audio,
  });
  console.log(`      Sent (${info.messageId}).`);

  await writeState(config.stateFile, {
    lastEpisodeId: episode.id,
    lastEpisodeTitle: episode.title,
    sentAt: new Date().toISOString(),
  });
  console.log(`      State written to ${config.stateFile}.`);
}

main().catch((error) => {
  console.error(`\n[fatal] ${error.message}`);
  if (process.env.DEBUG) console.error(error.stack);
  process.exitCode = 1;
});

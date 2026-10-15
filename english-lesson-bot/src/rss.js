import { XMLParser } from 'fast-xml-parser';
import { fetchWithRetry } from './http.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function text(value) {
  const v = first(value);
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return String(v['#text'] ?? '');
  return String(v);
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseFeed(xml) {
  const doc = parser.parse(xml);
  const channel = doc?.rss?.channel ?? doc?.feed;
  if (!channel) throw new Error('Could not find an RSS <channel> or Atom <feed> in the response.');

  const rawItems = channel.item ?? channel.entry ?? [];
  const items = (Array.isArray(rawItems) ? rawItems : [rawItems]).filter(Boolean);

  const episodes = items.map((item) => {
    const enclosure = first(item.enclosure);
    const summaryHtml =
      text(item['content:encoded']) ||
      text(item.description) ||
      text(item['itunes:summary']) ||
      text(item.summary) ||
      text(item.content);

    const published =
      text(item.pubDate) || text(item.published) || text(item.updated) || '';

    return {
      id: text(item.guid) || text(item.id) || text(item.link) || text(item.title),
      title: stripHtml(text(item.title)),
      link: text(item.link) || first(item.link)?.['@_href'] || '',
      publishedAt: published ? new Date(published) : null,
      durationText: text(item['itunes:duration']) || '',
      audioUrl: enclosure?.['@_url'] || '',
      summary: stripHtml(summaryHtml),
    };
  });

  return {
    podcastTitle: stripHtml(text(channel.title)),
    episodes,
  };
}

export async function fetchFeed(url, { timeoutMs = 30000, fetchImpl = fetch, sleep } = {}) {
  const res = await fetchWithRetry(
    url,
    { headers: { 'user-agent': 'english-lesson-bot/1.0 (+github-actions)' } },
    { fetchImpl, sleep, timeoutMs, label: 'RSS feed' },
  );
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status} ${res.statusText} for ${url}`);
  return parseFeed(await res.text());
}

/**
 * Pick the episode to turn into a lesson: the newest one that is recent enough
 * and that we have not already sent.
 */
export function pickEpisode(episodes, { lastSentId = null, maxAgeDays = 14, now = new Date() } = {}) {
  const sorted = [...episodes].sort((a, b) => {
    const at = a.publishedAt?.getTime() ?? 0;
    const bt = b.publishedAt?.getTime() ?? 0;
    return bt - at;
  });

  const newest = sorted[0];
  if (!newest) return { episode: null, reason: 'feed-empty' };

  if (lastSentId && newest.id === lastSentId) {
    return { episode: null, reason: 'already-sent', episodeTitle: newest.title };
  }

  if (newest.publishedAt && maxAgeDays > 0) {
    const ageDays = (now.getTime() - newest.publishedAt.getTime()) / 86400000;
    if (ageDays > maxAgeDays) {
      return { episode: null, reason: 'too-old', ageDays: Math.round(ageDays), episodeTitle: newest.title };
    }
  }

  return { episode: newest, reason: 'ok' };
}

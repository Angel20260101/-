// Transient failures — an overloaded model, a rate limit, a dropped
// connection — are the normal weather of a weekly job that talks to three
// third-party APIs. Retrying them in-process is the difference between a
// lesson arriving and a week being skipped.

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryAfterMs(res) {
  const header = res.headers?.get?.('retry-after');
  if (!header) return null;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 60000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.min(Math.max(date - Date.now(), 0), 60000) : null;
}

/**
 * Returns the first response that is either successful or a failure worth
 * reporting. A retryable response is discarded without reading its body, so
 * the body of whatever is returned is still unread.
 */
export async function fetchWithRetry(url, init = {}, options = {}) {
  const {
    fetchImpl = fetch,
    attempts = 4,
    baseDelayMs = 2000,
    timeoutMs = 120000,
    label = 'request',
    sleep = defaultSleep,
  } = options;

  let lastResponse = null;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      const backoff = baseDelayMs * 2 ** (attempt - 2);
      const wait = (lastResponse && retryAfterMs(lastResponse)) ?? backoff;
      console.warn(`[retry] ${label}: attempt ${attempt} of ${attempts} in ${Math.round(wait / 1000)}s.`);
      await sleep(wait);
    }

    try {
      // A fresh timeout per attempt: one signal cannot cover them all.
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok || !RETRYABLE_STATUS.has(res.status)) return res;
      lastResponse = res;
      lastError = null;
    } catch (error) {
      // A timeout or socket error: worth one more try, unlike a bad request.
      lastError = error;
      lastResponse = null;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError ?? new Error(`${label} failed after ${attempts} attempts.`);
}

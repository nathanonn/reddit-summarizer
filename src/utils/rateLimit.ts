import { AxiosResponseHeaders, RawAxiosResponseHeaders } from 'axios';

let rateLimitRemaining: number | null = null;
let rateLimitResetSeconds: number | null = null;
let rateLimitResetAt: number | null = null; // absolute timestamp

/**
 * Update rate limit state from Reddit API response headers.
 */
export function updateRateLimit(headers: AxiosResponseHeaders | RawAxiosResponseHeaders): void {
  const remaining = headers['x-ratelimit-remaining'];
  const reset = headers['x-ratelimit-reset'];

  if (remaining !== undefined) {
    rateLimitRemaining = parseFloat(String(remaining));
  }
  if (reset !== undefined) {
    rateLimitResetSeconds = parseFloat(String(reset));
    rateLimitResetAt = Date.now() + rateLimitResetSeconds * 1000;
  }

  console.log(`[Rate Limit] Remaining: ${rateLimitRemaining}, Reset in: ${rateLimitResetSeconds}s`);
}

/**
 * Check rate limit and wait if necessary.
 * If remaining < 5, sleep until reset time.
 * If remaining = 0, throw an error (routes map to 429).
 */
export async function checkRateLimit(): Promise<void> {
  if (rateLimitRemaining === null) {
    return; // No rate limit info yet
  }

  if (rateLimitRemaining <= 0) {
    const retryAfter = rateLimitResetAt
      ? Math.ceil((rateLimitResetAt - Date.now()) / 1000)
      : 60;
    const error: any = new Error(`Reddit rate limit exhausted. Retry after ${retryAfter} seconds.`);
    error.retryAfter = Math.max(retryAfter, 1);
    throw error;
  }

  if (rateLimitRemaining < 5 && rateLimitResetAt) {
    const waitMs = rateLimitResetAt - Date.now();
    if (waitMs > 0) {
      console.log(`[Rate Limit] Low remaining (${rateLimitRemaining}), waiting ${Math.ceil(waitMs / 1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
      console.log(`[Rate Limit] Wait complete, resuming.`);
    }
  }
}

/**
 * Reset rate limit state (for testing).
 */
export function resetRateLimitState(): void {
  rateLimitRemaining = null;
  rateLimitResetSeconds = null;
  rateLimitResetAt = null;
}

import { Router } from 'express';
import { loadConfig } from '../config';
import { AppConfig, OutputMode } from '../types';
import { ensureAccessToken, fetchPosts, fetchComments, filterPosts, fetchIdentity, RedditApiError } from '../services/reddit';
import { savePosts, readLog, listLogs } from '../services/storage';
import { getRateLimitSnapshot } from '../utils/rateLimit';

const router = Router();

const SUBREDDIT_REGEX = /^[a-zA-Z0-9_]{1,21}$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_OUTPUT_MODES: OutputMode[] = ['log', 'response', 'both'];

// Lazy-load config to avoid circular imports with index.ts
let _config: AppConfig | null = null;
function getConfig(): AppConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

// Health endpoint — end-to-end Reddit connectivity check
router.get('/health', async (_req, res) => {
  const checks: Record<string, any> = {
    refreshToken: 'pending',
    identity: { ok: false },
  };

  if (!process.env.REDDIT_REFRESH_TOKEN) {
    checks.refreshToken = 'missing';
    res.status(503).json({
      ok: false,
      checks,
      error: 'Reddit refresh token not configured. Complete OAuth setup first.',
    });
    return;
  }

  try {
    await ensureAccessToken();
    checks.refreshToken = 'ok';
  } catch (err) {
    checks.refreshToken = 'error';
    const message = err instanceof RedditApiError ? err.message : 'Failed to refresh access token';
    res.status(503).json({ ok: false, checks, error: message });
    return;
  }

  try {
    const identity = await fetchIdentity();
    checks.identity = { ok: true, username: identity.username };
  } catch (err) {
    const message = err instanceof RedditApiError ? err.message : 'Reddit identity check failed';
    checks.identity = { ok: false, error: message };
    res.status(503).json({ ok: false, checks, error: message });
    return;
  }

  res.status(200).json({
    ok: true,
    checks,
    rateLimit: getRateLimitSnapshot(),
  });
});

// POST /collect — Collect posts for one subreddit
router.post('/collect', async (req, res) => {
  const { subreddit, hours, output } = req.body;

  // Validate subreddit
  if (!subreddit || typeof subreddit !== 'string') {
    res.status(400).json({ error: 'Missing required field: subreddit' });
    return;
  }
  if (!SUBREDDIT_REGEX.test(subreddit)) {
    res.status(400).json({ error: `Invalid subreddit name: "${subreddit}". Must match /^[a-zA-Z0-9_]{1,21}$/.` });
    return;
  }

  // Validate hours
  let hoursBack = 24;
  if (hours !== undefined) {
    if (typeof hours !== 'number' || !Number.isFinite(hours)) {
      res.status(400).json({ error: 'Invalid hours parameter: must be a number between 1 and 168.' });
      return;
    }
    if (hours < 1 || hours > 168) {
      res.status(400).json({ error: `Invalid hours parameter: ${hours}. Must be between 1 and 168.` });
      return;
    }
    hoursBack = hours;
  }

  // Validate output mode
  const outputMode: OutputMode = output ?? 'log';
  if (!VALID_OUTPUT_MODES.includes(outputMode)) {
    res.status(400).json({ error: `Invalid output parameter: "${output}". Must be one of: log, response, both.` });
    return;
  }

  try {
    await ensureAccessToken();
  } catch (err) {
    if (err instanceof RedditApiError && err.statusCode === 401) {
      res.status(401).json({ error: err.message });
      return;
    }
    throw err;
  }

  try {
    const config = getConfig();

    // Find subreddit config for thresholds
    const subConfig = config.subreddits.find(
      s => s.name.toLowerCase() === subreddit.toLowerCase()
    );
    const minScore = subConfig?.minScore ?? config.defaults.minScore;
    const minComments = subConfig?.minComments ?? config.defaults.minComments;
    const commentsPerPost = config.defaults.commentsPerPost;

    // Fetch posts
    const allPosts = await fetchPosts(subreddit, hoursBack);

    // Filter posts
    const filtered = filterPosts(allPosts, minScore, minComments);

    // Fetch comments for filtered posts
    for (const post of filtered) {
      post.comments = await fetchComments(post.id, commentsPerPost);
    }

    // Save to disk (unless output is 'response' only)
    let filePath: string | undefined;
    if (outputMode !== 'response') {
      filePath = savePosts(subreddit, filtered);
    }

    const now = new Date();
    const from = new Date(now.getTime() - hoursBack * 3600 * 1000);

    const result: Record<string, any> = {
      subreddit,
      postsCollected: allPosts.length,
      postsFiltered: filtered.length,
      timeRange: {
        from: from.toISOString(),
        to: now.toISOString(),
      },
    };

    if (filePath) {
      result.filePath = filePath;
    }

    if (outputMode !== 'log') {
      result.posts = filtered;
    }

    res.json(result);
  } catch (err) {
    if (err instanceof RedditApiError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    if ((err as any)?.retryAfter) {
      res.set('Retry-After', String((err as any).retryAfter));
      res.status(429).json({ error: (err as Error).message });
      return;
    }
    console.error('[/api/collect] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /collect-all — Collect posts for all configured subreddits
router.post('/collect-all', async (req, res) => {
  const { hours, output } = req.body || {};

  // Validate hours
  let hoursBack = 24;
  if (hours !== undefined) {
    if (typeof hours !== 'number' || !Number.isFinite(hours)) {
      res.status(400).json({ error: 'Invalid hours parameter: must be a number between 1 and 168.' });
      return;
    }
    if (hours < 1 || hours > 168) {
      res.status(400).json({ error: `Invalid hours parameter: ${hours}. Must be between 1 and 168.` });
      return;
    }
    hoursBack = hours;
  }

  // Validate output mode
  const outputMode: OutputMode = output ?? 'log';
  if (!VALID_OUTPUT_MODES.includes(outputMode)) {
    res.status(400).json({ error: `Invalid output parameter: "${output}". Must be one of: log, response, both.` });
    return;
  }

  try {
    await ensureAccessToken();
  } catch (err) {
    if (err instanceof RedditApiError && err.statusCode === 401) {
      res.status(401).json({ error: err.message });
      return;
    }
    throw err;
  }

  const config = getConfig();
  const results: any[] = [];
  let anySuccess = false;

  for (const subConfig of config.subreddits) {
    try {
      const minScore = subConfig.minScore ?? config.defaults.minScore;
      const minComments = subConfig.minComments ?? config.defaults.minComments;
      const commentsPerPost = config.defaults.commentsPerPost;

      const allPosts = await fetchPosts(subConfig.name, hoursBack);
      const filtered = filterPosts(allPosts, minScore, minComments);

      for (const post of filtered) {
        post.comments = await fetchComments(post.id, commentsPerPost);
      }

      let filePath: string | undefined;
      if (outputMode !== 'response') {
        filePath = savePosts(subConfig.name, filtered);
      }

      const now = new Date();
      const from = new Date(now.getTime() - hoursBack * 3600 * 1000);

      const entry: Record<string, any> = {
        subreddit: subConfig.name,
        status: 'ok',
        postsCollected: allPosts.length,
        postsFiltered: filtered.length,
        timeRange: {
          from: from.toISOString(),
          to: now.toISOString(),
        },
      };

      if (filePath) {
        entry.filePath = filePath;
      }

      if (outputMode !== 'log') {
        entry.posts = filtered;
      }

      results.push(entry);
      anySuccess = true;
    } catch (err) {
      const message = err instanceof RedditApiError
        ? `${err.message} (${err.statusCode})`
        : (err as Error).message;

      results.push({
        subreddit: subConfig.name,
        status: 'error',
        error: message,
      });
    }
  }

  res.status(anySuccess ? 200 : 502).json(results);
});

// GET /logs — List available log files
router.get('/logs', (req, res) => {
  const subreddit = req.query.subreddit as string | undefined;

  if (subreddit && !SUBREDDIT_REGEX.test(subreddit)) {
    res.status(400).json({ error: `Invalid subreddit name: "${subreddit}".` });
    return;
  }

  try {
    const logs = listLogs(subreddit);
    res.json(logs);
  } catch (err) {
    console.error('[/api/logs] Error:', err);
    res.status(500).json({ error: 'Failed to list logs' });
  }
});

// GET /logs/:subreddit/:date — Read a specific log file
router.get('/logs/:subreddit/:date', (req, res) => {
  const { subreddit, date } = req.params;

  // Validate subreddit
  if (!SUBREDDIT_REGEX.test(subreddit)) {
    res.status(400).json({ error: `Invalid subreddit name: "${subreddit}".` });
    return;
  }

  // Validate date
  if (!DATE_REGEX.test(date)) {
    res.status(400).json({ error: `Invalid date format: "${date}". Expected YYYY-MM-DD.` });
    return;
  }

  try {
    const posts = readLog(subreddit, date);
    res.json(posts);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      res.status(404).json({ error: `Log not found: ${subreddit}/${date}.json` });
      return;
    }
    console.error('[/api/logs] Error:', err);
    res.status(500).json({ error: 'Failed to read log file' });
  }
});

export default router;

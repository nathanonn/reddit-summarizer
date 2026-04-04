import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, SubredditConfig } from './types';

const SUBREDDIT_NAME_REGEX = /^[a-zA-Z0-9_]{1,21}$/;
const CONFIG_PATH = path.join(process.cwd(), 'config.json');

const BUILT_IN_DEFAULTS = {
  minScore: 10,
  minComments: 5,
  hoursBack: 24,
  commentsPerPost: 10,
};

/**
 * Parse and validate subreddit entries from either config.json or env var.
 */
function validateSubreddits(subreddits: any[], source: string): void {
  if (!Array.isArray(subreddits) || subreddits.length === 0) {
    console.error(`Config error (${source}): "subreddits" must be a non-empty array (1-10 entries).`);
    process.exit(1);
  }

  if (subreddits.length > 10) {
    console.error(`Config error (${source}): "subreddits" has ${subreddits.length} entries but maximum allowed is 10.`);
    process.exit(1);
  }

  for (const sub of subreddits) {
    if (typeof sub.name !== 'string' || !SUBREDDIT_NAME_REGEX.test(sub.name)) {
      console.error(
        `Config error (${source}): Invalid subreddit name "${sub.name}". ` +
        'Names must match /^[a-zA-Z0-9_]{1,21}$/.'
      );
      process.exit(1);
    }

    if (sub.minScore !== undefined) {
      if (!Number.isInteger(sub.minScore) || sub.minScore < 0) {
        console.error(
          `Config error (${source}): Subreddit "${sub.name}" has invalid minScore "${sub.minScore}". ` +
          'Must be a non-negative integer.'
        );
        process.exit(1);
      }
    }

    if (sub.minComments !== undefined) {
      if (!Number.isInteger(sub.minComments) || sub.minComments < 0) {
        console.error(
          `Config error (${source}): Subreddit "${sub.name}" has invalid minComments "${sub.minComments}". ` +
          'Must be a non-negative integer.'
        );
        process.exit(1);
      }
    }
  }

  // Check for duplicate subreddit names (case-insensitive)
  const seen = new Set<string>();
  for (const sub of subreddits) {
    const lowerName = sub.name.toLowerCase();
    if (seen.has(lowerName)) {
      console.error(`Config error (${source}): Duplicate subreddit name "${sub.name}".`);
      process.exit(1);
    }
    seen.add(lowerName);
  }
}

/**
 * Parse a non-negative integer from an env var. Returns undefined if not set.
 */
function parseEnvInt(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined || value === '') return undefined;
  const parsed = parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    console.error(`Config error: Environment variable "${name}" must be a non-negative integer, got "${value}".`);
    process.exit(1);
  }
  return parsed;
}

export function loadConfig(): AppConfig {
  // 1. Try to read config.json (optional if env vars provide subreddits)
  let fileConfig: any = null;
  try {
    const fileContent = fs.readFileSync(CONFIG_PATH, 'utf-8');
    fileConfig = JSON.parse(fileContent);
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      if (err instanceof SyntaxError) {
        console.error(`Config error: config.json contains invalid JSON - ${err.message}`);
      } else {
        console.error(`Config error: Unable to read config.json - ${err.message}`);
      }
      process.exit(1);
    }
    // ENOENT is fine — config.json is optional when env vars provide subreddits
  }

  // 2. Parse subreddits from env var (overrides config.json if set)
  let envSubreddits: any[] | null = null;
  if (process.env.REDDIT_SUBREDDITS) {
    try {
      envSubreddits = JSON.parse(process.env.REDDIT_SUBREDDITS);
    } catch {
      console.error(
        'Config error: REDDIT_SUBREDDITS must be a valid JSON array. ' +
        'Example: \'[{"name":"typescript","minScore":10}]\''
      );
      process.exit(1);
    }
  }

  // 3. Determine subreddits source
  const subreddits = envSubreddits ?? fileConfig?.subreddits;
  if (!subreddits) {
    console.error(
      'Config error: No subreddits configured. ' +
      'Provide them via REDDIT_SUBREDDITS env var or config.json.'
    );
    process.exit(1);
  }

  const source = envSubreddits ? 'REDDIT_SUBREDDITS' : 'config.json';
  validateSubreddits(subreddits, source);

  // 4. Resolve defaults: env vars > config.json > built-in defaults
  const fileDefaults = fileConfig?.defaults ?? {};
  const defaults = {
    minScore: parseEnvInt('REDDIT_DEFAULT_MIN_SCORE') ?? fileDefaults.minScore ?? BUILT_IN_DEFAULTS.minScore,
    minComments: parseEnvInt('REDDIT_DEFAULT_MIN_COMMENTS') ?? fileDefaults.minComments ?? BUILT_IN_DEFAULTS.minComments,
    hoursBack: parseEnvInt('REDDIT_DEFAULT_HOURS_BACK') ?? fileDefaults.hoursBack ?? BUILT_IN_DEFAULTS.hoursBack,
    commentsPerPost: parseEnvInt('REDDIT_DEFAULT_COMMENTS_PER_POST') ?? fileDefaults.commentsPerPost ?? BUILT_IN_DEFAULTS.commentsPerPost,
  };

  // 5. Resolve per-subreddit configs with defaults applied
  const resolvedSubreddits: SubredditConfig[] = subreddits.map((sub: any) => ({
    name: sub.name,
    minScore: sub.minScore ?? defaults.minScore,
    minComments: sub.minComments ?? defaults.minComments,
  }));

  // 6. Validate required environment variables
  const requiredEnvVars = [
    'REDDIT_CLIENT_ID',
    'REDDIT_CLIENT_SECRET',
    'REDDIT_REDIRECT_URI',
    'REDDIT_USERNAME',
  ] as const;

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(`Config error: Required environment variable "${envVar}" is not set.`);
      process.exit(1);
    }
  }

  // 7. Return AppConfig
  return {
    subreddits: resolvedSubreddits,
    defaults,
  };
}

import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, SubredditConfig } from './types';

const SUBREDDIT_NAME_REGEX = /^[a-zA-Z0-9_]{1,21}$/;
const CONFIG_PATH = path.join(process.cwd(), 'config.json');

export function loadConfig(): AppConfig {
  // 1. Read and parse config.json
  let rawConfig: any;
  try {
    const fileContent = fs.readFileSync(CONFIG_PATH, 'utf-8');
    rawConfig = JSON.parse(fileContent);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      console.error(`Config error: config.json not found at ${CONFIG_PATH}`);
    } else if (err instanceof SyntaxError) {
      console.error(`Config error: config.json contains invalid JSON - ${err.message}`);
    } else {
      console.error(`Config error: Unable to read config.json - ${err.message}`);
    }
    process.exit(1);
  }

  // 2. Validate subreddits array
  const subreddits: any[] = rawConfig.subreddits;

  if (!Array.isArray(subreddits) || subreddits.length === 0) {
    console.error('Config error: "subreddits" must be a non-empty array (1-10 entries).');
    process.exit(1);
  }

  if (subreddits.length > 10) {
    console.error(`Config error: "subreddits" has ${subreddits.length} entries but maximum allowed is 10.`);
    process.exit(1);
  }

  // Validate each subreddit entry
  for (const sub of subreddits) {
    if (typeof sub.name !== 'string' || !SUBREDDIT_NAME_REGEX.test(sub.name)) {
      console.error(
        `Config error: Invalid subreddit name "${sub.name}". ` +
        'Names must match /^[a-zA-Z0-9_]{1,21}$/.'
      );
      process.exit(1);
    }

    if (sub.minScore !== undefined) {
      if (!Number.isInteger(sub.minScore) || sub.minScore < 0) {
        console.error(
          `Config error: Subreddit "${sub.name}" has invalid minScore "${sub.minScore}". ` +
          'Must be a non-negative integer.'
        );
        process.exit(1);
      }
    }

    if (sub.minComments !== undefined) {
      if (!Number.isInteger(sub.minComments) || sub.minComments < 0) {
        console.error(
          `Config error: Subreddit "${sub.name}" has invalid minComments "${sub.minComments}". ` +
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
      console.error(`Config error: Duplicate subreddit name "${sub.name}".`);
      process.exit(1);
    }
    seen.add(lowerName);
  }

  // 3. Apply defaults
  const defaults = rawConfig.defaults;
  const resolvedSubreddits: SubredditConfig[] = subreddits.map((sub) => ({
    name: sub.name,
    minScore: sub.minScore ?? defaults.minScore,
    minComments: sub.minComments ?? defaults.minComments,
  }));

  // 4. Validate required environment variables
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

  // 5. Optional env vars (REDDIT_REFRESH_TOKEN - no error; PORT defaults to 3000)
  // These are available via process.env when needed; PORT default is handled here for reference.
  const _port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // 6. Return AppConfig
  const config: AppConfig = {
    subreddits: resolvedSubreddits,
    defaults: {
      minScore: defaults.minScore,
      minComments: defaults.minComments,
      hoursBack: defaults.hoursBack,
      commentsPerPost: defaults.commentsPerPost,
    },
  };

  return config;
}

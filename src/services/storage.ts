import fs from 'fs';
import path from 'path';
import { Post, LogEntry } from '../types';

const LOGS_DIR = path.join(process.cwd(), 'logs');

/**
 * Save posts to disk. Merges with existing file if present.
 * File path: logs/{subreddit}/{YYYY-MM-DD}.json (UTC date)
 */
export function savePosts(subreddit: string, posts: Post[]): string {
  const today = new Date().toISOString().split('T')[0]; // UTC date
  const dir = path.join(LOGS_DIR, subreddit);
  const filePath = path.join(dir, `${today}.json`);

  // Create directories recursively
  fs.mkdirSync(dir, { recursive: true });

  let existingPosts: Post[] = [];
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      existingPosts = JSON.parse(content);
    } catch {
      // If file is corrupted, start fresh
      existingPosts = [];
    }
  }

  // Merge: deduplicate by post ID, keep version with higher score
  const postMap = new Map<string, Post>();
  for (const post of existingPosts) {
    postMap.set(post.id, post);
  }
  for (const post of posts) {
    const existing = postMap.get(post.id);
    if (!existing || post.score > existing.score) {
      postMap.set(post.id, post);
    }
  }

  const mergedPosts = Array.from(postMap.values());
  fs.writeFileSync(filePath, JSON.stringify(mergedPosts, null, 2), 'utf-8');

  // Return relative path
  return path.relative(process.cwd(), filePath);
}

/**
 * Read a specific log file.
 */
export function readLog(subreddit: string, date: string): Post[] {
  const filePath = path.join(LOGS_DIR, subreddit, `${date}.json`);

  if (!fs.existsSync(filePath)) {
    const error: any = new Error(`Log file not found: ${subreddit}/${date}.json`);
    error.code = 'ENOENT';
    throw error;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * List available log files with metadata.
 */
export function listLogs(subreddit?: string): LogEntry[] {
  const entries: LogEntry[] = [];

  if (!fs.existsSync(LOGS_DIR)) {
    return entries;
  }

  const subreddits = subreddit
    ? [subreddit]
    : fs.readdirSync(LOGS_DIR).filter(name => {
        const fullPath = path.join(LOGS_DIR, name);
        return fs.statSync(fullPath).isDirectory();
      });

  for (const sub of subreddits) {
    const subDir = path.join(LOGS_DIR, sub);
    if (!fs.existsSync(subDir)) continue;

    const files = fs.readdirSync(subDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const filePath = path.join(subDir, file);
      const date = file.replace('.json', '');

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const posts: Post[] = JSON.parse(content);
        entries.push({
          subreddit: sub,
          date,
          filePath: path.relative(process.cwd(), filePath),
          postCount: posts.length,
        });
      } catch {
        // Skip corrupted files
      }
    }
  }

  return entries;
}

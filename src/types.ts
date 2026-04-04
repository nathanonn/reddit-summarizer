export interface Comment {
  id: string;
  author: string;
  body: string;
  score: number;
  createdUtc: string;
}

export interface Post {
  id: string;
  title: string;
  author: string;
  score: number;
  numComments: number;
  url: string;
  selfText: string;
  createdUtc: string;
  flair: string | null;
  comments: Comment[];
}

export interface SubredditConfig {
  name: string;
  minScore?: number;
  minComments?: number;
}

export interface AppConfig {
  subreddits: SubredditConfig[];
  defaults: {
    minScore: number;
    minComments: number;
    hoursBack: number;
    commentsPerPost: number;
  };
}

export type OutputMode = 'log' | 'response' | 'both';

export interface CollectResult {
  subreddit: string;
  postsCollected: number;
  postsFiltered: number;
  timeRange: {
    from: string;
    to: string;
  };
  filePath?: string;
  posts?: Post[];
}

export interface LogEntry {
  subreddit: string;
  date: string;
  filePath: string;
  postCount: number;
}

export interface TokenData {
  accessToken: string;
  expiresAt: number;
}

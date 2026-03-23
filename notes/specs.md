# Reddit Summarizer — Specs

## Overview

An Express server (TypeScript) that fetches posts and top comments from configured subreddits via the Reddit OAuth API, filters them by engagement thresholds, and saves structured JSON summaries to disk. A minimal frontend handles the one-time Reddit OAuth flow.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Express Server                    │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐│
│  │  OAuth    │  │  API     │  │  Reddit Service    ││
│  │  Routes   │  │  Routes  │  │  (fetch + filter)  ││
│  └────┬─────┘  └────┬─────┘  └────────┬───────────┘│
│       │              │                 │             │
│       │              │          ┌──────┴──────┐      │
│       │              │          │ File Writer │      │
│       │              │          └──────┬──────┘      │
│       │              │                 │             │
└───────┼──────────────┼─────────────────┼─────────────┘
        │              │                 │
        ▼              ▼                 ▼
  Reddit OAuth    Client Request    logs/ directory
  (authorize +    (trigger collect)  (JSON files)
   token exchange)
```

---

## 1. Reddit OAuth Flow

### 1.1 Authorization

**Route**: `GET /auth/reddit`

Redirects the user to Reddit's authorization page with:

| Param           | Value                                      |
| --------------- | ------------------------------------------ |
| `client_id`     | From env `REDDIT_CLIENT_ID`                |
| `response_type` | `code`                                     |
| `state`         | Random string, stored in an in-memory Map (see 1.5) |
| `redirect_uri`  | From env `REDDIT_REDIRECT_URI`             |
| `duration`      | `permanent`                                |
| `scope`         | `read`                                     |

### 1.2 Callback

**Route**: `GET /auth/reddit/callback`

1. Verify `state` matches what was generated (lookup + delete from the state Map).
2. Exchange `code` for tokens via POST to `https://www.reddit.com/api/v1/access_token`:
   - `grant_type=authorization_code`
   - `code=<code>`
   - `redirect_uri=<same URI>`
   - Auth: HTTP Basic with `client_id:client_secret`
3. Render a success page that **displays the refresh token** prominently so the user can copy it and manually add it to their `.env` file. The server does **not** write to `.env` programmatically.

### 1.3 Token Refresh

Internal utility function (not a route). Called before any Reddit API request if the access token is expired or missing.

- POST to `https://www.reddit.com/api/v1/access_token`
- `grant_type=refresh_token`, `refresh_token=<saved token>`
- Auth: HTTP Basic with `client_id:client_secret`
- Cache the new `access_token` and `expires_in` in memory.

### 1.4 OAuth Frontend

A single HTML page served at `GET /`:

```
┌────────────────────────────────────────┐
│        Reddit Summarizer Setup         │
│                                        │
│  Status: [ Not Connected / Connected ] │
│                                        │
│  [ Connect to Reddit ]  (button)       │
│                                        │
│  (after success, on callback page)     │
│  "Your refresh token:"                 │
│  ┌──────────────────────────────────┐  │
│  │ eyJhbGciOi...  [Copy]           │  │
│  └──────────────────────────────────┘  │
│  "Add this to your .env file as        │
│   REDDIT_REFRESH_TOKEN and restart     │
│   the server."                         │
└────────────────────────────────────────┘
```

- Shows connection status based on whether `REDDIT_REFRESH_TOKEN` exists in env.
- The "Connect to Reddit" button links to `GET /auth/reddit`.
- The callback success page displays the refresh token with a copy button and instructions to manually add it to `.env`.

### 1.5 OAuth State Management

The `state` parameter for CSRF protection is managed via an in-memory `Map<string, number>` (state value → creation timestamp).

- On authorization: generate a random state string, store it in the Map with the current timestamp.
- On callback: look up the state in the Map. If found and less than 10 minutes old, accept it and delete the entry. Otherwise, reject with `403`.
- Periodically prune entries older than 10 minutes to prevent memory leaks (e.g., on every new authorization request).

---

## 2. Data Collection API

### 2.1 Collect Endpoint

**Route**: `POST /api/collect`

**Request body** (JSON):

| Param       | Type   | Default     | Description                                |
| ----------- | ------ | ----------- | ------------------------------------------ |
| `subreddit` | string | (required)  | Subreddit name (without `r/`). Must match `^[a-zA-Z0-9_]{1,21}$`. |
| `hours`     | number | `24`        | How far back to look for posts (min: 1, max: 168) |

**Response**: JSON object with a summary of what was collected.

```json
{
  "subreddit": "typescript",
  "postsCollected": 12,
  "postsFiltered": 5,
  "timeRange": { "from": "2024-06-01T00:00:00Z", "to": "2024-06-02T00:00:00Z" },
  "filePath": "logs/typescript/2024-06-02.json"
}
```

### 2.2 Collect All Endpoint

**Route**: `POST /api/collect-all`

**Request body** (JSON, optional):

| Param   | Type   | Default | Description                                |
| ------- | ------ | ------- | ------------------------------------------ |
| `hours` | number | `24`    | How far back to look for posts (min: 1, max: 168) |

Runs collection **sequentially** for every subreddit listed in the config file (max 10 subreddits — enforced by config validation). Returns an array of results, one per subreddit. Each entry includes a `status` field:

```json
[
  {
    "subreddit": "typescript",
    "status": "ok",
    "postsCollected": 12,
    "postsFiltered": 5,
    "timeRange": { "from": "...", "to": "..." },
    "filePath": "logs/typescript/2024-06-02.json"
  },
  {
    "subreddit": "nonexistent_sub",
    "status": "error",
    "error": "Subreddit not found (404)"
  }
]
```

**Partial failure behavior**: If one subreddit fails, skip it and continue with the rest. The overall HTTP response is `200` as long as at least one subreddit succeeded. If all fail, return `502`.

### 2.3 List Logs Endpoint

**Route**: `GET /api/logs`

**Query params**:

| Param       | Type   | Default | Description                        |
| ----------- | ------ | ------- | ---------------------------------- |
| `subreddit` | string | (all)   | Filter logs by subreddit           |

**Response**: List of available log files with metadata.

```json
[
  { "subreddit": "typescript", "date": "2024-06-02", "filePath": "logs/typescript/2024-06-02.json", "postCount": 5 }
]
```

### 2.4 Read Log Endpoint

**Route**: `GET /api/logs/:subreddit/:date`

Validate `:subreddit` matches `^[a-zA-Z0-9_]{1,21}$` and `:date` matches `^\d{4}-\d{2}-\d{2}$` before constructing the file path. Returns `400` on invalid input.

Returns the contents of a specific log file, or `404` if the file does not exist.

---

## 3. Reddit Data Fetching

### 3.1 Fetching Posts

- Use `GET https://oauth.reddit.com/r/{subreddit}/new` (sorted by new) with `limit=100` (Reddit's max per page).
- Paginate with `after` param until posts fall outside the requested time range.
- **Pagination cap**: Stop after **10 pages** (1000 posts max) regardless of time range, to prevent runaway fetching. Log a warning if the cap is hit before reaching the time boundary.
- Reddit API rate limit: respect `X-Ratelimit-Remaining` and `X-Ratelimit-Reset` headers. If remaining requests are low, wait before continuing.
- Set a proper `User-Agent` header as required by Reddit API rules: `reddit-summarizer/1.0 by <username>` where `<username>` comes from the `REDDIT_USERNAME` env var.

### 3.2 Fetching Comments

For each post that passes the filter threshold:

- Use `GET https://oauth.reddit.com/comments/{post_id}` with `sort=top&limit=10`.
- Extract only top-level comments (depth 0).
- Cap at 10 comments per post.

### 3.3 Rate Limiting

- Track Reddit's rate limit headers on every response.
- If `X-Ratelimit-Remaining` drops below 5, pause until `X-Ratelimit-Reset` seconds have passed.
- Log rate limit status to console.

---

## 4. Filtering

Posts are filtered using engagement thresholds from the config file.

**Default thresholds** (overridable per subreddit in config):

| Metric        | Default | Description                     |
| ------------- | ------- | ------------------------------- |
| `minScore`    | `10`    | Minimum post upvote score       |
| `minComments` | `5`     | Minimum number of comments      |

A post must meet **at least one** threshold to be included (OR logic — a highly upvoted post with few comments is still interesting).

---

## 5. Data Storage

### 5.1 Directory Structure

```
logs/
  ├── typescript/
  │   ├── 2024-06-01.json
  │   └── 2024-06-02.json
  └── react/
      ├── 2024-06-01.json
      └── 2024-06-02.json
```

### 5.2 JSON File Schema

Each file contains an array of post objects:

```json
[
  {
    "id": "abc123",
    "title": "New TypeScript 5.5 features",
    "author": "u/someone",
    "score": 342,
    "numComments": 87,
    "url": "https://reddit.com/r/typescript/comments/abc123/...",
    "selfText": "Post body text if any...",
    "createdUtc": "2024-06-02T14:30:00Z",
    "flair": "Discussion",
    "comments": [
      {
        "id": "xyz789",
        "author": "u/commenter",
        "body": "This is really useful because...",
        "score": 56,
        "createdUtc": "2024-06-02T15:00:00Z"
      }
    ]
  }
]
```

### 5.3 File Naming

The `{date}` in the filename is the **collection date** (UTC) — i.e., the date when `/api/collect` was called, not the post creation date. This means one API call always writes to exactly one file.

### 5.4 File Write Behavior

- If a file for the same subreddit and date already exists, **merge** new posts into it (deduplicate by post ID, keep the version with the higher score).
- Create directories as needed.

---

## 6. Configuration

### 6.1 Config File

**Path**: `config.json` (project root)

```json
{
  "subreddits": [
    {
      "name": "typescript",
      "minScore": 10,
      "minComments": 5
    },
    {
      "name": "react",
      "minScore": 20,
      "minComments": 10
    }
  ],
  "defaults": {
    "minScore": 10,
    "minComments": 5,
    "hoursBack": 24,
    "commentsPerPost": 10
  }
}
```

**Validation rules** (enforced at startup):

- `subreddits` array must have 1–10 entries.
- Each subreddit `name` must match `^[a-zA-Z0-9_]{1,21}$` (Reddit's naming rules).
- `minScore` and `minComments` must be non-negative integers if provided.
- No duplicate subreddit names.

### 6.2 Environment Variables

**File**: `.env`

| Variable                | Required | Description                          |
| ----------------------- | -------- | ------------------------------------ |
| `REDDIT_CLIENT_ID`      | Yes      | Reddit app client ID                 |
| `REDDIT_CLIENT_SECRET`  | Yes      | Reddit app client secret             |
| `REDDIT_REDIRECT_URI`   | Yes      | OAuth redirect URI (e.g., `http://localhost:3000/auth/reddit/callback`) |
| `REDDIT_USERNAME`       | Yes      | Reddit username, used in User-Agent header |
| `REDDIT_REFRESH_TOKEN`  | No       | Manually copied from OAuth success page after first auth flow |
| `PORT`                  | No       | Server port (default: `3000`)        |

---

## 7. Project Structure

```
reddit-summarizer/
  ├── src/
  │   ├── index.ts              # Express app entry point
  │   ├── config.ts             # Load and validate config.json
  │   ├── routes/
  │   │   ├── auth.ts           # OAuth routes (/auth/reddit, /auth/reddit/callback)
  │   │   └── api.ts            # Data collection routes (/api/collect, /api/logs, etc.)
  │   ├── services/
  │   │   ├── reddit.ts         # Reddit API client (auth, fetch posts, fetch comments)
  │   │   └── storage.ts        # JSON file read/write/merge logic
  │   ├── utils/
  │   │   └── rateLimit.ts      # Rate limit tracking utility
  │   └── types.ts              # TypeScript interfaces (Post, Comment, Config, etc.)
  ├── public/
  │   └── index.html            # OAuth setup page
  ├── logs/                     # Generated data (gitignored)
  ├── config.json               # Subreddit configuration
  ├── .env                      # Secrets (gitignored)
  ├── .env.example              # Template for required env vars
  ├── .gitignore
  ├── tsconfig.json
  └── package.json
```

---

## 8. API Summary

| Method | Route                         | Description                        |
| ------ | ----------------------------- | ---------------------------------- |
| GET    | `/`                           | OAuth setup page                   |
| GET    | `/auth/reddit`                | Start Reddit OAuth flow            |
| GET    | `/auth/reddit/callback`       | OAuth callback, displays refresh token |
| POST   | `/api/collect`                | Collect posts for one subreddit    |
| POST   | `/api/collect-all`            | Collect posts for all configured   |
| GET    | `/api/logs`                   | List available log files           |
| GET    | `/api/logs/:subreddit/:date`  | Read a specific log file           |

---

## 9. Error Handling

- **Invalid input**: Return `400` if `subreddit` fails validation (`^[a-zA-Z0-9_]{1,21}$`), or if `hours` is out of range. This also prevents path traversal attacks since the subreddit name is used in file paths.
- **Missing refresh token**: Return `401` with message to complete OAuth setup.
- **Invalid subreddit**: Return `404` if Reddit returns a 404 for the subreddit.
- **Private/banned subreddit**: Return `403` if Reddit returns a 403 (private or quarantined subreddit).
- **Rate limited**: Return `429` with `Retry-After` header if Reddit rate limit is exhausted.
- **Reddit server errors (5xx)**: Retry once after a 2-second delay. If the retry also fails, return `502` with "Reddit API unavailable".
- **Config errors**: Fail fast on startup if `config.json` is missing or malformed.
- **File system errors**: Return `500` with descriptive error message.

---

## 10. Dependencies

| Package       | Purpose                            |
| ------------- | ---------------------------------- |
| `express`     | HTTP server                        |
| `dotenv`      | Load `.env` variables              |
| `axios`       | HTTP client for Reddit API         |
| `typescript`  | Language                           |
| `tsx`         | Dev runner (no build step needed)  |
| `@types/express` | Type definitions               |

---

## Non-Goals (Out of Scope)

- No database — JSON files only.
- No LLM summarization — extractive/heuristic filtering by score.
- No built-in scheduler — collection is triggered manually via API.
- No dashboard UI — frontend is OAuth-only.
- No authentication on the Express server itself (assumed to run locally).

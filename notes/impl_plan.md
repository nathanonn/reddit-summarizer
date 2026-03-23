# Reddit Summarizer — Implementation Plan

## Overview

Build an Express/TypeScript server that authenticates via Reddit OAuth, fetches and filters posts by engagement thresholds, and saves structured JSON summaries to disk. No source code exists yet — this is a greenfield implementation.

## Files to Create

| File | Description |
| ---- | ----------- |
| `package.json` | Dependencies and scripts |
| `tsconfig.json` | TypeScript configuration |
| `.env.example` | Template for required env vars |
| `.gitignore` | Ignore logs/, node_modules/, .env |
| `config.json` | Default subreddit configuration |
| `src/types.ts` | TypeScript interfaces (Post, Comment, Config, etc.) |
| `src/config.ts` | Load and validate config.json + env vars |
| `src/index.ts` | Express app entry point |
| `src/routes/auth.ts` | OAuth routes (`/auth/reddit`, `/auth/reddit/callback`) |
| `src/routes/api.ts` | Data collection routes (`/api/collect`, `/api/collect-all`, `/api/logs`) |
| `src/services/reddit.ts` | Reddit API client (auth, fetch posts, fetch comments) |
| `src/services/storage.ts` | JSON file read/write/merge logic |
| `src/utils/rateLimit.ts` | Rate limit tracking utility |
| `public/index.html` | OAuth setup page |

---

## Implementation Tasks

### Task 1: Project Scaffolding & TypeScript Types

**Mapped Test Cases:** (none directly — foundational for all)

**Files:**

- `package.json` — dependencies (express, axios, dotenv) and devDependencies (typescript, tsx, @types/express, @types/node), scripts (`dev: tsx src/index.ts`)
- `tsconfig.json` — strict mode, ESM or CommonJS targeting Node, outDir, rootDir
- `.env.example` — template listing all env vars with placeholder values
- `.gitignore` — node_modules/, logs/, .env, dist/
- `config.json` — working default with 2 subreddits (typescript, react)
- `src/types.ts` — interfaces: `Post`, `Comment`, `SubredditConfig`, `AppConfig`, `CollectResult`, `LogEntry`, `TokenData`

**Implementation Notes:**

- Keep `tsx` as the dev runner so there's no build step
- Types should match the JSON schemas defined in specs section 5.2

**Acceptance Criteria:**

- [ ] `npm install` succeeds
- [ ] `npx tsx src/index.ts` can be invoked (once index.ts exists)
- [ ] All interfaces accurately represent the spec data shapes

---

### Task 2: Configuration Loading & Validation

**Mapped Test Cases:** TC-001, TC-002, TC-003

**Files:**

- `src/config.ts` — `loadConfig()` function that reads and validates config.json + env vars

**Implementation Notes:**

- Read `config.json` from project root; throw with clear message if missing or unparseable
- Validate `subreddits` array: 1–10 entries, each name matches `^[a-zA-Z0-9_]{1,21}$`, no duplicates, non-negative integer thresholds
- Apply defaults from `config.defaults` to subreddits missing per-sub overrides
- Validate required env vars: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_REDIRECT_URI`, `REDDIT_USERNAME` — throw if any missing
- Optional env vars: `REDDIT_REFRESH_TOKEN` (no error if absent), `PORT` (default 3000)
- All validation errors should produce descriptive messages and cause the process to exit

**Acceptance Criteria:**

- [ ] TC-001 passes — valid config loads, defaults applied
- [ ] TC-002 passes — all 6 invalid config scenarios produce clear errors and exit
- [ ] TC-003 passes — missing required env vars cause startup error; optional vars use defaults

---

### Task 3: Express Server Entry Point & Frontend

**Mapped Test Cases:** TC-031

**Files:**

- `src/index.ts` — create Express app, load dotenv, load config, serve static files from `public/`, mount route modules, start listening
- `public/index.html` — OAuth setup page with status indicator and "Connect to Reddit" button

**Implementation Notes:**

- Call `dotenv.config()` before loading config
- Serve `public/` as static directory
- `GET /` serves `index.html`
- The HTML page should show "Not Connected" if `REDDIT_REFRESH_TOKEN` is absent, "Connected" if present — this requires a small API endpoint (e.g., `GET /api/status`) or inline template rendering
- Simple approach: use a tiny server-rendered endpoint or inject status into a script tag. Alternatively, serve static HTML and have it call a status endpoint via fetch. Either approach works — keep it minimal.
- "Connect to Reddit" button links to `/auth/reddit`
- Mount auth routes at `/auth` and api routes at `/api`

**Acceptance Criteria:**

- [ ] TC-031 passes — page shows correct status based on token presence; button links to `/auth/reddit`

---

### Task 4: OAuth Flow (Authorization, Callback, State Management)

**Mapped Test Cases:** TC-004, TC-005, TC-006, TC-007

**Files:**

- `src/routes/auth.ts` — `GET /auth/reddit` (redirect) and `GET /auth/reddit/callback` (token exchange)

**Implementation Notes:**

- **State Map**: Module-level `Map<string, number>` (state → timestamp). Export for testing if needed.
- **`GET /auth/reddit`**:
  - Prune stale entries (> 10 min old) from the Map
  - Generate random state string (e.g., `crypto.randomBytes(16).toString('hex')`)
  - Store state → `Date.now()` in Map
  - Redirect (302) to `https://www.reddit.com/api/v1/authorize` with query params: `client_id`, `response_type=code`, `state`, `redirect_uri`, `duration=permanent`, `scope=read`
- **`GET /auth/reddit/callback`**:
  - Look up `state` in Map. If not found or older than 10 minutes → 403
  - Delete the state entry from Map
  - POST to `https://www.reddit.com/api/v1/access_token` with form body: `grant_type=authorization_code`, `code`, `redirect_uri`; HTTP Basic auth with `client_id:client_secret`
  - Render HTML success page displaying the refresh token with a copy button and instructions to add it to `.env`

**Acceptance Criteria:**

- [ ] TC-004 passes — redirect contains all required params; state stored in Map
- [ ] TC-005 passes — token exchange works; refresh token displayed; state deleted
- [ ] TC-006 passes — invalid/expired/missing state returns 403
- [ ] TC-007 passes — stale entries pruned on new authorization request

---

### Task 5: Token Refresh Utility

**Mapped Test Cases:** TC-008, TC-026, TC-032

**Files:**

- `src/services/reddit.ts` — `ensureAccessToken()` function and token caching

**Implementation Notes:**

- Module-level cached token: `{ accessToken: string, expiresAt: number } | null`
- `ensureAccessToken()`:
  - If `REDDIT_REFRESH_TOKEN` is not set, throw an error that routes can catch and map to 401
  - If cached token exists and not expired (with small buffer, e.g., 60s), return it
  - Otherwise POST to `https://www.reddit.com/api/v1/access_token` with `grant_type=refresh_token`, `refresh_token`, HTTP Basic auth
  - Cache the new token with computed expiry
- All Reddit API requests must use `User-Agent: reddit-summarizer/1.0 by {REDDIT_USERNAME}`
- Create an axios instance with the User-Agent header pre-configured

**Acceptance Criteria:**

- [ ] TC-008 passes — token refreshed when expired; cached when valid
- [ ] TC-026 passes — missing refresh token results in 401
- [ ] TC-032 passes — User-Agent header set on all Reddit requests

---

### Task 6: Rate Limit Tracking

**Mapped Test Cases:** TC-025, TC-029

**Files:**

- `src/utils/rateLimit.ts` — track and enforce Reddit rate limits

**Implementation Notes:**

- Export a function to update rate limit state from response headers: `X-Ratelimit-Remaining`, `X-Ratelimit-Reset`
- Export a function to check/wait: if remaining < 5, sleep until reset time
- Log rate limit status to console
- If rate limit is fully exhausted (remaining = 0), throw an error that routes can map to 429 with `Retry-After` header

**Acceptance Criteria:**

- [ ] TC-025 passes — pauses when remaining < 5; resumes after reset
- [ ] TC-029 passes — 429 returned with Retry-After when rate limit exhausted

---

### Task 7: Reddit Post & Comment Fetching

**Mapped Test Cases:** TC-022, TC-023, TC-024

**Files:**

- `src/services/reddit.ts` — `fetchPosts()` and `fetchComments()` functions

**Implementation Notes:**

- **`fetchPosts(subreddit, hoursBack)`**:
  - GET `https://oauth.reddit.com/r/{subreddit}/new` with `limit=100`
  - Calculate cutoff time: `Date.now() - hoursBack * 3600 * 1000`
  - Paginate using `after` param from response's `data.after`
  - Stop when: posts fall outside time range, OR no `after` value, OR **10 pages reached** (log warning on cap)
  - Update rate limit tracker after each response
  - Handle Reddit error responses (see Task 9)
- **`fetchComments(postId, limit)`**:
  - GET `https://oauth.reddit.com/comments/{postId}` with `sort=top&limit={limit}`
  - Extract only top-level comments (items with no parent or depth 0)
  - Cap at `limit` comments (default from config's `commentsPerPost`)
- Map Reddit's raw API response to our `Post` and `Comment` interfaces

**Acceptance Criteria:**

- [ ] TC-022 passes — correct pagination with `after` parameter
- [ ] TC-023 passes — stops at 10 pages; warning logged
- [ ] TC-024 passes — top-level comments fetched with correct params; max 10 per post

---

### Task 8: Post Filtering

**Mapped Test Cases:** TC-018, TC-019

**Files:**

- `src/services/reddit.ts` — `filterPosts()` function (or a standalone utility in the same file)

**Implementation Notes:**

- Takes an array of posts and thresholds (`minScore`, `minComments`)
- OR logic: include post if `score >= minScore` OR `numComments >= minComments`
- Thresholds come from the subreddit's config (per-sub override or defaults)
- Pure function, easy to unit test

**Acceptance Criteria:**

- [ ] TC-018 passes — OR logic correct at boundaries (both pass, one passes, neither passes, exact threshold)
- [ ] TC-019 passes — per-subreddit overrides take precedence over defaults

---

### Task 9: Error Handling for Reddit API

**Mapped Test Cases:** TC-027, TC-028, TC-030

**Files:**

- `src/services/reddit.ts` — error handling within fetch functions

**Implementation Notes:**

- Wrap Reddit API calls with error handling:
  - **404** → throw typed error mapped to "Subreddit not found"
  - **403** → throw typed error for private/banned subreddit
  - **429** → handled by rate limit utility (Task 6)
  - **5xx** → retry once after 2-second delay. If retry also fails, throw "Reddit API unavailable"
- Define a custom error class (e.g., `RedditApiError`) with `statusCode` and `message` fields so routes can map them to HTTP responses

**Acceptance Criteria:**

- [ ] TC-027 passes — Reddit 404 mapped to server 404
- [ ] TC-028 passes — Reddit 403 mapped to server 403
- [ ] TC-030 passes — one retry on 5xx; 502 if retry fails; success if retry works

---

### Task 10: Storage Layer

**Mapped Test Cases:** TC-020, TC-021, TC-033

**Files:**

- `src/services/storage.ts` — `savePosts()`, `readLog()`, `listLogs()` functions

**Implementation Notes:**

- **`savePosts(subreddit, posts)`**:
  - Compute filename: `logs/{subreddit}/{YYYY-MM-DD}.json` using current UTC date
  - Create directories recursively (`fs.mkdirSync` with `{ recursive: true }`)
  - If file exists, read it, merge: deduplicate by post ID, keep version with higher score
  - Write the merged array back as formatted JSON
- **`readLog(subreddit, date)`**:
  - Construct path: `logs/{subreddit}/{date}.json`
  - Read and parse; return the array. Throw if file not found.
- **`listLogs(subreddit?)`**:
  - Scan `logs/` directory for subreddit subdirectories and `.json` files
  - If `subreddit` param given, filter to that subdirectory
  - For each file: read and parse to get `postCount` (array length)
  - Return array of `{ subreddit, date, filePath, postCount }`

**Acceptance Criteria:**

- [ ] TC-020 passes — directories created automatically; file named with today's UTC date
- [ ] TC-021 passes — second collection merges; deduplication by ID; higher score wins
- [ ] TC-033 passes — filename uses collection date, not post creation date

---

### Task 11: API Routes

**Mapped Test Cases:** TC-009, TC-010, TC-011, TC-012, TC-013, TC-014, TC-015, TC-016, TC-017

**Files:**

- `src/routes/api.ts` — all `/api/*` route handlers

**Implementation Notes:**

- **`POST /api/collect`**:
  - Validate request body: `subreddit` required, must match `^[a-zA-Z0-9_]{1,21}$`; `hours` optional (default 24, range [1, 168])
  - Check for access token (call `ensureAccessToken()`); catch missing-token error → 401
  - Fetch posts, filter, fetch comments for filtered posts, save to disk
  - Return `{ subreddit, postsCollected, postsFiltered, timeRange, filePath }`
  - Map Reddit API errors to appropriate HTTP status codes
- **`POST /api/collect-all`**:
  - Validate optional `hours` param (same rules)
  - Iterate configured subreddits **sequentially**
  - For each: try collect, produce `{ subreddit, status: "ok", ... }` or `{ subreddit, status: "error", error: "..." }`
  - If at least one succeeded → 200. If all failed → 502.
- **`GET /api/logs`**:
  - Optional query param `subreddit`
  - Call `listLogs()` and return array
- **`GET /api/logs/:subreddit/:date`**:
  - Validate `:subreddit` with regex and `:date` with `^\d{4}-\d{2}-\d{2}$` → 400 on failure
  - Call `readLog()`, return contents or 404

**Acceptance Criteria:**

- [ ] TC-009 passes — happy path collect works end to end
- [ ] TC-010 passes — all subreddit validation cases return 400
- [ ] TC-011 passes — hours validation (boundaries, defaults, invalid types)
- [ ] TC-012 passes — partial failure returns 200 with mixed results
- [ ] TC-013 passes — all failures returns 502
- [ ] TC-014 passes — list all logs with metadata
- [ ] TC-015 passes — filter logs by subreddit
- [ ] TC-016 passes — read specific log file
- [ ] TC-017 passes — input validation blocks path traversal; missing file returns 404

---

## Dependencies Between Tasks

```
Task 1 (Scaffolding)
  └─► Task 2 (Config)
       └─► Task 3 (Server + Frontend)
            ├─► Task 4 (OAuth Routes)
            └─► Task 5 (Token Refresh)
                 ├─► Task 6 (Rate Limiting)
                 │    └─► Task 7 (Post/Comment Fetching)
                 │         ├─► Task 8 (Filtering)
                 │         └─► Task 9 (Error Handling)
                 │              └─► Task 11 (API Routes)
                 └─► Task 10 (Storage)
                      └─► Task 11 (API Routes)
```

**Implementation order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8, 9, 10 (parallel) → 11

---

## Complexity Estimate

**Complex** — 11 tasks across 14 files, covering OAuth, API integration with pagination, rate limiting, file-based storage with merge logic, and comprehensive input validation/error handling.

---

## TC Coverage Matrix

| Task | Test Cases Covered |
| ---- | ------------------ |
| 1 | (foundational) |
| 2 | TC-001, TC-002, TC-003 |
| 3 | TC-031 |
| 4 | TC-004, TC-005, TC-006, TC-007 |
| 5 | TC-008, TC-026, TC-032 |
| 6 | TC-025, TC-029 |
| 7 | TC-022, TC-023, TC-024 |
| 8 | TC-018, TC-019 |
| 9 | TC-027, TC-028, TC-030 |
| 10 | TC-020, TC-021, TC-033 |
| 11 | TC-009, TC-010, TC-011, TC-012, TC-013, TC-014, TC-015, TC-016, TC-017 |

All 33 test cases are covered.

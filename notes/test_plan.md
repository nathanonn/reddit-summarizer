# Reddit Summarizer — Test Plan

## Overview & Objectives

Verify that the Reddit Summarizer implementation matches the specs in `notes/specs.md`. This plan covers the Express server's OAuth flow, data collection API, Reddit API integration, filtering logic, file storage, configuration validation, and error handling.

## Prerequisites

- Node.js installed, dependencies available (`express`, `axios`, `dotenv`, `tsx`)
- A valid `config.json` in project root
- A `.env` file with required variables (or mocks for unit tests)
- `logs/` directory writable
- For integration tests: valid Reddit OAuth credentials (or mocked Reddit API responses)

---

## Test Cases

---

### TC-001: Config — Valid config.json loads successfully

**Description:** Verify that a well-formed `config.json` is parsed and validated at startup without errors.

**Preconditions:**

- `config.json` exists with 1–10 subreddits, valid names, valid thresholds

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Start the server with a valid `config.json` | Server starts without errors |
| 2 | Inspect loaded config in memory | Subreddit list matches file; defaults are applied where per-sub overrides are absent |

**Test Data:**

```json
{
  "subreddits": [
    { "name": "typescript", "minScore": 10, "minComments": 5 },
    { "name": "react" }
  ],
  "defaults": { "minScore": 10, "minComments": 5, "hoursBack": 24, "commentsPerPost": 10 }
}
```

**Expected Outcome:** Config loaded; `react` inherits default thresholds.

**Priority:** Critical

---

### TC-002: Config — Invalid config.json fails fast

**Description:** Server refuses to start when config is malformed.

**Preconditions:**

- Various invalid `config.json` files prepared

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Start server with empty `subreddits` array (`[]`) | Startup error: must have 1–10 entries |
| 2 | Start server with 11 subreddits | Startup error: exceeds max 10 |
| 3 | Start server with invalid subreddit name (`"a b c"`) | Startup error: name fails regex `^[a-zA-Z0-9_]{1,21}$` |
| 4 | Start server with duplicate subreddit names | Startup error: duplicates not allowed |
| 5 | Start server with negative `minScore` | Startup error: must be non-negative integer |
| 6 | Start server with missing `config.json` | Startup error: file not found |

**Expected Outcome:** Each case produces a clear error message and the process exits.

**Priority:** Critical

---

### TC-003: Config — Environment variable validation

**Description:** Server requires all mandatory env vars at startup.

**Preconditions:**

- `.env` file with selective omissions

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Remove `REDDIT_CLIENT_ID` from env | Startup error indicating missing variable |
| 2 | Remove `REDDIT_CLIENT_SECRET` from env | Startup error indicating missing variable |
| 3 | Remove `REDDIT_REDIRECT_URI` from env | Startup error indicating missing variable |
| 4 | Remove `REDDIT_USERNAME` from env | Startup error indicating missing variable |
| 5 | Remove `REDDIT_REFRESH_TOKEN` (optional) | Server starts normally |
| 6 | Omit `PORT` (optional) | Server starts on default port 3000 |

**Expected Outcome:** Required vars enforced; optional vars use defaults.

**Priority:** Critical

---

### TC-004: OAuth — Authorization redirect

**Description:** `GET /auth/reddit` redirects to Reddit with correct params.

**Preconditions:**

- Server running with valid env vars

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Send `GET /auth/reddit` | 302 redirect to `https://www.reddit.com/api/v1/authorize` |
| 2 | Parse redirect URL query params | Contains `client_id`, `response_type=code`, `state` (random string), `redirect_uri`, `duration=permanent`, `scope=read` |
| 3 | Verify `state` is stored in the in-memory Map | Map contains the generated state value with a timestamp |

**Expected Outcome:** User is redirected to Reddit's authorization page with all required parameters.

**Priority:** Critical

---

### TC-005: OAuth — Successful callback

**Description:** `GET /auth/reddit/callback` exchanges code for tokens and renders the refresh token.

**Preconditions:**

- A valid `state` value exists in the in-memory Map (generated within the last 10 minutes)
- Reddit token endpoint returns a valid response (mocked)

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Send `GET /auth/reddit/callback?state=<valid>&code=<code>` | Server POSTs to `https://www.reddit.com/api/v1/access_token` with correct body and Basic auth |
| 2 | Verify token exchange request format | `grant_type=authorization_code`, `code=<code>`, `redirect_uri=<same URI>`, HTTP Basic with `client_id:client_secret` |
| 3 | Inspect response HTML | Success page displays refresh token prominently with copy button and `.env` instructions |
| 4 | Check state Map | The used state value has been deleted |

**Test Data:**

- Mock Reddit response: `{ "access_token": "at_xxx", "refresh_token": "rt_xxx", "expires_in": 86400 }`

**Expected Outcome:** Refresh token displayed to user; state cleaned up.

**Priority:** Critical

---

### TC-006: OAuth — Invalid or expired state

**Description:** Callback rejects requests with bad or expired `state`.

**Preconditions:**

- Server running

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Send callback with `state` not in the Map | 403 response |
| 2 | Insert a state with a timestamp > 10 minutes ago, then send callback | 403 response |
| 3 | Send callback with missing `state` param | 403 response |

**Expected Outcome:** All three cases return 403.

**Priority:** High

---

### TC-007: OAuth — State pruning

**Description:** Stale state entries are pruned to prevent memory leaks.

**Preconditions:**

- Multiple stale state entries in the Map (timestamps > 10 minutes old)

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Insert 5 state entries with old timestamps | Map has 5 entries |
| 2 | Trigger a new authorization request (`GET /auth/reddit`) | Stale entries are pruned; Map contains only the new state |

**Expected Outcome:** Old entries removed on new authorization request.

**Priority:** Medium

---

### TC-008: OAuth — Token refresh utility

**Description:** The internal token refresh function obtains a new access token using the refresh token.

**Preconditions:**

- `REDDIT_REFRESH_TOKEN` set in env
- Reddit token endpoint mocked

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Call the token refresh function | POSTs to Reddit with `grant_type=refresh_token`, `refresh_token=<token>`, HTTP Basic auth |
| 2 | Verify new access token is cached in memory | `access_token` and expiry time stored |
| 3 | Call refresh again before expiry | Uses cached token, does not hit Reddit API |
| 4 | Simulate expiry, call refresh again | Makes a new POST to Reddit |

**Expected Outcome:** Token refreshed when expired; cached when valid.

**Priority:** Critical

---

### TC-009: Collect — Happy path single subreddit

**Description:** `POST /api/collect` fetches, filters, and saves posts for one subreddit.

**Preconditions:**

- Valid access token available (or refresh token set)
- Reddit API mocked to return posts and comments
- `config.json` has the target subreddit configured

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Send `POST /api/collect` with `{ "subreddit": "typescript", "hours": 24 }` | 200 response |
| 2 | Verify response body | Contains `subreddit`, `postsCollected`, `postsFiltered`, `timeRange`, `filePath` |
| 3 | Check the file at `filePath` | JSON file exists with an array of filtered posts |
| 4 | Verify posts in file pass engagement filter | Each post has score >= minScore OR numComments >= minComments |

**Test Data:**

- Mock 15 posts: 5 with high score + high comments, 5 with high score + low comments, 5 with low score + low comments
- Expected: 10 posts pass filter (OR logic), 5 filtered out

**Expected Outcome:** Response shows `postsCollected: 15`, `postsFiltered: 10`; file contains 10 posts.

**Priority:** Critical

---

### TC-010: Collect — Subreddit validation

**Description:** `POST /api/collect` rejects invalid subreddit names.

**Preconditions:**

- Server running

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Send collect with `subreddit: ""` | 400 error |
| 2 | Send collect with `subreddit: "a b c"` (spaces) | 400 error |
| 3 | Send collect with `subreddit: "../etc/passwd"` (path traversal) | 400 error |
| 4 | Send collect with `subreddit: "a_very_long_subreddit_name_here"` (>21 chars) | 400 error |
| 5 | Send collect with `subreddit: "valid_sub123"` | Passes validation (may still 404 from Reddit) |
| 6 | Send collect with missing `subreddit` field | 400 error |

**Expected Outcome:** Input validated against `^[a-zA-Z0-9_]{1,21}$`; path traversal blocked.

**Priority:** Critical

---

### TC-011: Collect — Hours parameter validation

**Description:** `POST /api/collect` validates the `hours` parameter.

**Preconditions:**

- Server running

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Send collect with `hours: 0` | 400 error (min is 1) |
| 2 | Send collect with `hours: 169` | 400 error (max is 168) |
| 3 | Send collect with `hours: -1` | 400 error |
| 4 | Send collect with `hours: "abc"` (non-number) | 400 error |
| 5 | Send collect without `hours` | Defaults to 24 |
| 6 | Send collect with `hours: 1` | Accepted |
| 7 | Send collect with `hours: 168` | Accepted |

**Expected Outcome:** Hours validated to range [1, 168]; defaults to 24.

**Priority:** High

---

### TC-012: Collect All — Sequential collection with partial failure

**Description:** `POST /api/collect-all` processes all configured subreddits sequentially.

**Preconditions:**

- `config.json` has 3 subreddits: `typescript`, `nonexistent_sub`, `react`
- Reddit API mocked: `typescript` and `react` succeed, `nonexistent_sub` returns 404

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Send `POST /api/collect-all` with `{ "hours": 24 }` | 200 response |
| 2 | Verify response is an array of 3 entries | Each entry has `subreddit` and `status` fields |
| 3 | Check `typescript` entry | `status: "ok"`, includes `postsCollected`, `postsFiltered`, `timeRange`, `filePath` |
| 4 | Check `nonexistent_sub` entry | `status: "error"`, includes `error: "Subreddit not found (404)"` |
| 5 | Check `react` entry | `status: "ok"` (was not skipped because of prior failure) |

**Expected Outcome:** Partial failure does not halt collection; response is 200 since at least one succeeded.

**Priority:** Critical

---

### TC-013: Collect All — All subreddits fail

**Description:** `POST /api/collect-all` returns 502 if every subreddit fails.

**Preconditions:**

- `config.json` has 2 subreddits, both mocked to fail

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Send `POST /api/collect-all` | 502 response |
| 2 | Verify response body | Array of results, each with `status: "error"` |

**Expected Outcome:** HTTP 502 when all subreddits fail.

**Priority:** High

---

### TC-014: List Logs — All logs

**Description:** `GET /api/logs` returns metadata for all log files.

**Preconditions:**

- `logs/` directory has files for 2 subreddits across 2 dates (4 files total)

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Send `GET /api/logs` | 200 response |
| 2 | Verify response body | Array of 4 entries, each with `subreddit`, `date`, `filePath`, `postCount` |

**Expected Outcome:** All log files listed with correct metadata.

**Priority:** High

---

### TC-015: List Logs — Filter by subreddit

**Description:** `GET /api/logs?subreddit=typescript` returns only matching logs.

**Preconditions:**

- `logs/` has files for `typescript` and `react`

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Send `GET /api/logs?subreddit=typescript` | 200 response |
| 2 | Verify response body | Only entries with `subreddit: "typescript"` returned |

**Expected Outcome:** Filtered correctly by subreddit.

**Priority:** Medium

---

### TC-016: Read Log — Happy path

**Description:** `GET /api/logs/:subreddit/:date` returns log file contents.

**Preconditions:**

- `logs/typescript/2024-06-02.json` exists with valid content

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Send `GET /api/logs/typescript/2024-06-02` | 200 response with JSON array of posts |
| 2 | Verify post schema | Each post has `id`, `title`, `author`, `score`, `numComments`, `url`, `selfText`, `createdUtc`, `flair`, `comments` |
| 3 | Verify comment schema | Each comment has `id`, `author`, `body`, `score`, `createdUtc` |

**Expected Outcome:** Full log file content returned with correct schema.

**Priority:** High

---

### TC-017: Read Log — Input validation

**Description:** `GET /api/logs/:subreddit/:date` validates path params.

**Preconditions:**

- Server running

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Send `GET /api/logs/../etc/2024-06-02` | 400 error (invalid subreddit) |
| 2 | Send `GET /api/logs/typescript/not-a-date` | 400 error (date fails `^\d{4}-\d{2}-\d{2}$`) |
| 3 | Send `GET /api/logs/typescript/2024-06-02` (file doesn't exist) | 404 error |

**Expected Outcome:** Path traversal blocked; invalid dates rejected; missing files return 404.

**Priority:** Critical

---

### TC-018: Filtering — OR logic thresholds

**Description:** Posts passing at least one threshold are included.

**Preconditions:**

- Config thresholds: `minScore: 10`, `minComments: 5`

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Post with score=50, numComments=20 | Included (both pass) |
| 2 | Post with score=50, numComments=1 | Included (score passes) |
| 3 | Post with score=2, numComments=20 | Included (comments pass) |
| 4 | Post with score=2, numComments=1 | Excluded (neither passes) |
| 5 | Post with score=10, numComments=5 | Included (both at threshold) |
| 6 | Post with score=9, numComments=4 | Excluded (both just below) |

**Expected Outcome:** OR logic applied correctly at boundaries.

**Priority:** Critical

---

### TC-019: Filtering — Per-subreddit threshold overrides

**Description:** Subreddit-specific thresholds override defaults.

**Preconditions:**

- Config: `react` has `minScore: 20, minComments: 10`; defaults are `minScore: 10, minComments: 5`

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Collect `react` with post score=15, numComments=8 | Post excluded (neither meets `react` thresholds) |
| 2 | Collect `typescript` (uses defaults) with same post | Post included (score=15 >= 10) |

**Expected Outcome:** Per-subreddit overrides take precedence.

**Priority:** High

---

### TC-020: Storage — File creation and directory creation

**Description:** Collection creates necessary directories and writes JSON files.

**Preconditions:**

- `logs/` directory is empty (no subreddit subdirectories)

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Collect posts for subreddit `typescript` | `logs/typescript/` directory created |
| 2 | Verify file naming | File is `logs/typescript/{today's UTC date}.json` |
| 3 | Verify file content | Valid JSON array of post objects |

**Expected Outcome:** Directories and files created automatically.

**Priority:** High

---

### TC-021: Storage — Merge behavior (deduplication)

**Description:** Collecting the same subreddit twice merges posts, deduplicating by ID.

**Preconditions:**

- First collection saved 5 posts (IDs: a, b, c, d, e)

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Run a second collection that returns posts with IDs: c, d, e, f, g (c has higher score) | File is updated |
| 2 | Read the merged file | Contains 7 unique posts (a, b, c, d, e, f, g) |
| 3 | Verify post `c` | Uses the version with the higher score |
| 4 | Verify posts `d` and `e` | If second collection has lower scores, original versions kept |

**Expected Outcome:** Posts merged by ID; higher-score version wins.

**Priority:** Critical

---

### TC-022: Reddit API — Pagination

**Description:** Post fetching paginates correctly using `after` param.

**Preconditions:**

- Reddit API mocked to return 100 posts per page across 3 pages

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Collect with `hours: 72` | First request uses `limit=100`, no `after` param |
| 2 | Verify second request | Uses `after=<last post fullname from page 1>` |
| 3 | Verify pagination stops | Stops when posts fall outside the requested time range |

**Expected Outcome:** Correct pagination with `after` parameter.

**Priority:** High

---

### TC-023: Reddit API — Pagination cap at 10 pages

**Description:** Pagination stops after 10 pages even if time range is not exhausted.

**Preconditions:**

- Reddit API mocked to always return 100 posts within time range

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Collect with very large `hours` value | Makes exactly 10 API calls |
| 2 | Verify warning logged | Console log indicates pagination cap was hit |
| 3 | Verify collected data | Contains up to 1000 posts |

**Expected Outcome:** Max 10 pages fetched; warning logged.

**Priority:** High

---

### TC-024: Reddit API — Comments fetching

**Description:** Top-level comments are fetched for each filtered post.

**Preconditions:**

- Reddit comments endpoint mocked

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Collect posts (3 pass filter) | Comments endpoint called 3 times |
| 2 | Verify request params | `sort=top`, `limit=10` |
| 3 | Verify stored comments | Only top-level (depth 0) comments included, max 10 per post |

**Expected Outcome:** Correct comments fetched and stored.

**Priority:** High

---

### TC-025: Reddit API — Rate limit handling

**Description:** Server pauses when Reddit rate limit is nearly exhausted.

**Preconditions:**

- Reddit API mocked: `X-Ratelimit-Remaining: 3`, `X-Ratelimit-Reset: 5`

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Make API call that returns low remaining count | Rate limit status logged |
| 2 | Verify pause behavior | Server waits ~5 seconds before next Reddit API call |
| 3 | After reset, make next API call | Proceeds normally |

**Expected Outcome:** Pauses when remaining < 5; resumes after reset window.

**Priority:** High

---

### TC-026: Error — Missing refresh token returns 401

**Description:** API endpoints return 401 when no refresh token is configured.

**Preconditions:**

- `REDDIT_REFRESH_TOKEN` not set in env

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Send `POST /api/collect` | 401 with message to complete OAuth setup |
| 2 | Send `POST /api/collect-all` | 401 with same message |

**Expected Outcome:** Clear 401 message directing user to complete OAuth.

**Priority:** High

---

### TC-027: Error — Reddit 404 (invalid subreddit)

**Description:** Collecting from a nonexistent subreddit returns 404.

**Preconditions:**

- Reddit API mocked to return 404

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Send `POST /api/collect` with `{ "subreddit": "nonexistent_sub_xyz" }` | 404 response with "Subreddit not found" message |

**Expected Outcome:** Reddit 404 mapped to server 404.

**Priority:** High

---

### TC-028: Error — Reddit 403 (private/banned subreddit)

**Description:** Collecting from a private or quarantined subreddit returns 403.

**Preconditions:**

- Reddit API mocked to return 403

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Send `POST /api/collect` targeting a private subreddit | 403 response |

**Expected Outcome:** Reddit 403 mapped to server 403.

**Priority:** Medium

---

### TC-029: Error — Reddit 429 (rate limited)

**Description:** Server returns 429 with `Retry-After` when Reddit rate limit is exhausted.

**Preconditions:**

- Reddit API mocked to return 429

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Send `POST /api/collect` when rate limit is exhausted | 429 response with `Retry-After` header |

**Expected Outcome:** Rate limit status communicated to client.

**Priority:** Medium

---

### TC-030: Error — Reddit 5xx with retry

**Description:** Server retries once on Reddit server errors, then returns 502.

**Preconditions:**

- Reddit API mocked: first call returns 500, second call also returns 500

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Send `POST /api/collect` | Server calls Reddit API |
| 2 | First call returns 500 | Server waits ~2 seconds and retries |
| 3 | Retry also returns 500 | Server returns 502 with "Reddit API unavailable" |

**Test Data (Alternate — successful retry):**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | First call returns 500 | Server retries after ~2 seconds |
| 2 | Retry returns 200 | Collection proceeds normally |

**Expected Outcome:** One retry with 2s delay; 502 if retry also fails.

**Priority:** High

---

### TC-031: Frontend — OAuth setup page

**Description:** `GET /` serves the OAuth setup page with correct status.

**Preconditions:**

- Server running

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | With `REDDIT_REFRESH_TOKEN` unset, send `GET /` | HTML page with status "Not Connected" and "Connect to Reddit" button |
| 2 | With `REDDIT_REFRESH_TOKEN` set, send `GET /` | HTML page with status "Connected" |
| 3 | Verify button link | "Connect to Reddit" links to `/auth/reddit` |

**Expected Outcome:** Status reflects token presence; button navigates to OAuth.

**Priority:** Medium

---

### TC-032: Reddit API — User-Agent header

**Description:** All Reddit API requests include the required User-Agent.

**Preconditions:**

- `REDDIT_USERNAME=testuser` in env

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Trigger any Reddit API call | Request includes `User-Agent: reddit-summarizer/1.0 by testuser` |

**Expected Outcome:** Correct User-Agent on all Reddit requests.

**Priority:** Medium

---

### TC-033: Storage — File naming uses collection date (UTC)

**Description:** The JSON filename is based on when `/api/collect` was called, not post dates.

**Preconditions:**

- Server running; current UTC date is known

**Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Call `POST /api/collect` that returns posts created yesterday | File named with today's UTC date, not yesterday's |
| 2 | Verify `filePath` in response | Matches `logs/{subreddit}/{today}.json` |

**Expected Outcome:** Filename always uses collection date.

**Priority:** Medium

---

---

## Status Tracker

| TC     | Test Case                              | Priority | Status | Remarks |
| ------ | -------------------------------------- | -------- | ------ | ------- |
| TC-001 | Config — Valid config loads             | Critical | [ ]    |         |
| TC-002 | Config — Invalid config fails fast     | Critical | [ ]    |         |
| TC-003 | Config — Env var validation            | Critical | [ ]    |         |
| TC-004 | OAuth — Authorization redirect         | Critical | [ ]    |         |
| TC-005 | OAuth — Successful callback            | Critical | [ ]    |         |
| TC-006 | OAuth — Invalid/expired state          | High     | [ ]    |         |
| TC-007 | OAuth — State pruning                  | Medium   | [ ]    |         |
| TC-008 | OAuth — Token refresh utility          | Critical | [ ]    |         |
| TC-009 | Collect — Happy path single subreddit  | Critical | [ ]    |         |
| TC-010 | Collect — Subreddit validation         | Critical | [ ]    |         |
| TC-011 | Collect — Hours param validation       | High     | [ ]    |         |
| TC-012 | Collect All — Partial failure          | Critical | [ ]    |         |
| TC-013 | Collect All — All subreddits fail      | High     | [ ]    |         |
| TC-014 | List Logs — All logs                   | High     | [ ]    |         |
| TC-015 | List Logs — Filter by subreddit        | Medium   | [ ]    |         |
| TC-016 | Read Log — Happy path                  | High     | [ ]    |         |
| TC-017 | Read Log — Input validation            | Critical | [ ]    |         |
| TC-018 | Filtering — OR logic thresholds        | Critical | [ ]    |         |
| TC-019 | Filtering — Per-subreddit overrides    | High     | [ ]    |         |
| TC-020 | Storage — Directory/file creation      | High     | [ ]    |         |
| TC-021 | Storage — Merge/deduplication          | Critical | [ ]    |         |
| TC-022 | Reddit API — Pagination                | High     | [ ]    |         |
| TC-023 | Reddit API — Pagination cap            | High     | [ ]    |         |
| TC-024 | Reddit API — Comments fetching         | High     | [ ]    |         |
| TC-025 | Reddit API — Rate limit handling       | High     | [ ]    |         |
| TC-026 | Error — Missing refresh token (401)    | High     | [ ]    |         |
| TC-027 | Error — Reddit 404                     | High     | [ ]    |         |
| TC-028 | Error — Reddit 403                     | Medium   | [ ]    |         |
| TC-029 | Error — Reddit 429                     | Medium   | [ ]    |         |
| TC-030 | Error — Reddit 5xx with retry          | High     | [ ]    |         |
| TC-031 | Frontend — OAuth setup page            | Medium   | [ ]    |         |
| TC-032 | Reddit API — User-Agent header         | Medium   | [ ]    |         |
| TC-033 | Storage — Collection date naming       | Medium   | [ ]    |         |

---

## Known Issues

| Issue | Description | TC Affected | Steps to Reproduce | Severity |
| ----- | ----------- | ----------- | ------------------ | -------- |
|       |             |             |                    |          |

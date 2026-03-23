# Test Results

**Test Plan:** notes/test_plan.md
**Started:** 2026-03-23T00:00:00Z

## Execution Log

## TC-001 — Config — Valid config.json loads successfully

**Result:** PASS
**Tested At:** 2026-03-23T06:33:01Z
**Fix Attempts:** 0

**What happened:**
Config loaded successfully with test data containing two subreddits (typescript with explicit thresholds, react without). All 12 assertions passed: config loads without errors, subreddits array has correct length, typescript retains its explicit minScore (10) and minComments (5), react correctly inherits default thresholds (minScore: 10, minComments: 5), and the defaults object contains correct values for all four fields (minScore, minComments, hoursBack, commentsPerPost). Server also starts successfully without crashing.

**Notes:**
- The `react` subreddit, which had no per-sub overrides in config, correctly inherited `minScore: 10` and `minComments: 5` from the defaults via nullish coalescing (`??`) in `loadConfig()`.
- Server started on port 5566 (from PORT env or .env file) and ran without errors.
- Original config.json was backed up before test and restored after.

---

## TC-002 — Config — Invalid config.json fails fast

**Result:** PASS
**Tested At:** 2026-03-23T06:45:00Z
**Fix Attempts:** 0

**What happened:**
Tested all 6 invalid config scenarios by writing invalid config.json files and calling loadConfig() in a child process. Each scenario correctly caused process.exit(1) with a descriptive error message:
1. Empty subreddits array `[]` - error: "must be a non-empty array (1-10 entries)"
2. 11 subreddits - error: "has 11 entries but maximum allowed is 10"
3. Invalid subreddit name `"a b c"` - error: "Invalid subreddit name... must match /^[a-zA-Z0-9_]{1,21}$/"
4. Duplicate subreddit names (TestSub/testsub, case-insensitive) - error: "Duplicate subreddit name"
5. Negative minScore (-5) - error: "invalid minScore... Must be a non-negative integer"
6. Missing config.json file - error: "config.json not found"

**Notes:**
- All 6 scenarios passed on the first attempt with no code fixes needed.
- The validation in `src/config.ts` correctly handles all invalid input cases.
- Original config.json was backed up before testing and restored after all scenarios completed.

---

## TC-018 — Filtering — OR logic thresholds

**Result:** PASS
**Tested At:** 2026-03-23T06:50:00Z
**Fix Attempts:** 0

**What happened:**
Tested all 6 filter scenarios with minScore=10, minComments=5 using the `filterPosts()` function from `src/services/reddit.ts`:
1. Post with score=50, numComments=20 — correctly included (both pass thresholds)
2. Post with score=50, numComments=1 — correctly included (score passes)
3. Post with score=2, numComments=20 — correctly included (comments pass)
4. Post with score=2, numComments=1 — correctly excluded (neither passes)
5. Post with score=10, numComments=5 — correctly included (both at exact threshold, >= is used)
6. Post with score=9, numComments=4 — correctly excluded (both just below threshold)

**Notes:**
- The `filterPosts()` function uses OR logic (`post.score >= minScore || post.numComments >= minComments`) as expected.
- Boundary conditions are correct: exact threshold values (10, 5) are included via `>=`.
- No code fixes were needed; the implementation matched the specification.

---

## TC-004 — OAuth — Authorization redirect

**Result:** PASS
**Tested At:** 2026-03-23T07:01:05Z
**Fix Attempts:** 0

**What happened:**
Sent GET /auth/reddit with redirect following disabled. Received a 302 response with a Location header pointing to Reddit's authorization endpoint. All 12 assertions passed on the first run with no code fixes needed.

**Notes:**
- Verified 302 status code returned
- Verified Location header present and base URL is `https://www.reddit.com/api/v1/authorize`
- Verified query parameters: `client_id=test_client_id`, `response_type=code`, `state` (32-char hex string), `redirect_uri=http://localhost:4444/auth/reddit/callback`, `duration=permanent`, `scope=read`
- Verified `stateMap` contains exactly 1 entry matching the state parameter from the redirect URL
- Verified the stateMap entry has a recent timestamp (within last 5 seconds)
- The auth router in `src/routes/auth.ts` correctly exports `stateMap` for testability

---

## TC-008 — OAuth — Token refresh utility

**Result:** PASS
**Tested At:** 2026-03-23T07:15:00Z
**Fix Attempts:** 0

**What happened:**
All 4 steps tested with 13 total assertions, all passing:
1. Called `ensureAccessToken()` after clearing cache. Verified it made exactly 1 POST to `https://www.reddit.com/api/v1/access_token` with `grant_type=refresh_token`, `refresh_token=test_refresh_token`, HTTP Basic auth (`test_client_id:test_secret`), and `Content-Type: application/x-www-form-urlencoded`.
2. Verified the returned token matches the mock response (`test_access_token`) and is cached in memory.
3. Called `ensureAccessToken()` again immediately (before expiry). Confirmed zero new POST calls were made and the same cached token was returned.
4. Simulated token expiry by overriding `Date.now` to return a time 2 hours in the future. Called `ensureAccessToken()` again. Confirmed exactly 1 new POST call was made and the new token (`new_access_token_after_expiry`) was returned.

**Notes:**
- Mocking was done by monkey-patching `axios.post` directly, since `ensureAccessToken()` uses the global `axios.post` (not the `redditAxios` instance) for token refresh.
- Cache reset between test runs used the exported `clearCachedToken()` function.
- Expiry simulation used `Date.now` override since the module-level `cachedToken` variable is not directly accessible; the token check uses `Date.now() < cachedToken.expiresAt - 60 * 1000` (60-second buffer).
- No code fixes were needed; the implementation matched the specification.

---

## TC-005 — OAuth — Successful callback

**Result:** PASS
**Tested At:** 2026-03-23T07:20:00Z
**Fix Attempts:** 0

**What happened:**
All 18 assertions passed across 5 steps. Monkey-patched `axios.post` to intercept the Reddit token exchange call and return a mock response with `access_token: "at_xxx"`, `refresh_token: "rt_xxx"`, `expires_in: 86400`.

1. Called `GET /auth/reddit` with redirects disabled to generate a valid state. Extracted the 32-char hex state from the Location header and confirmed it was stored in `stateMap`.
2. Called `GET /auth/reddit/callback?state={state}&code=test_auth_code`. Received 200 response.
3. Verified the intercepted token exchange request: POST to `https://www.reddit.com/api/v1/access_token` with URL-encoded body containing `grant_type=authorization_code`, `code=test_auth_code`, `redirect_uri=http://localhost:4445/auth/reddit/callback`. HTTP Basic auth used `test_client_id` as username and `test_secret` as password.
4. Verified response HTML contains: refresh token `rt_xxx` displayed in a token box, a "Copy Token" button, `.env` file instructions, and `REDDIT_REFRESH_TOKEN` env var name.
5. Verified state was deleted from `stateMap` after use. Replaying the same state returned 403 as expected.

**Notes:**
- No code fixes were needed; `src/routes/auth.ts` implementation matched the specification exactly.
- The callback handler correctly deletes the state before processing (one-time use), uses `axios` auth config for HTTP Basic (which axios encodes to base64 `Authorization: Basic` header), and renders a user-friendly HTML page with the refresh token.

---

## TC-010 — Collect — Subreddit validation

**Result:** PASS
**Tested At:** 2026-03-23T07:30:00Z
**Fix Attempts:** 0

**What happened:**
Tested all 6 subreddit validation scenarios by sending POST requests to `/api/collect` on a live Express server (port 4446). No REDDIT_REFRESH_TOKEN was set so that valid subreddits would hit the 401 token error rather than attempting actual Reddit API calls.

1. Empty subreddit `""` — returned 400 (PASS)
2. Subreddit with spaces `"a b c"` — returned 400 (PASS)
3. Path traversal `"../etc/passwd"` — returned 400 (PASS)
4. Too long (>21 chars) `"a_very_long_subreddit_name_here"` — returned 400 (PASS)
5. Valid subreddit `"valid_sub123"` — returned 401 (NOT 400, passed validation successfully) (PASS)
6. Missing subreddit field `{}` — returned 400 (PASS)

**Notes:**
- The validation regex `/^[a-zA-Z0-9_]{1,21}$/` in `src/routes/api.ts` correctly blocks all invalid inputs: empty strings fail the `!subreddit` check, and spaces, path traversal characters, and length >21 all fail the regex test.
- The valid subreddit `valid_sub123` passes both the truthiness check and regex, then proceeds to `ensureAccessToken()` which returns 401 because no refresh token is configured — confirming the input was accepted by validation.
- No code fixes were needed; the implementation matched the specification.

---

## TC-009 — Collect — Happy path single subreddit

**Result:** PASS
**Tested At:** 2026-03-23T07:01:10Z
**Fix Attempts:** 0

**What happened:**
All 31 assertions passed on the first run with no code fixes needed. Mocked three Reddit API layers: token refresh (axios.post to /api/v1/access_token), post fetching (redditAxios.get to /r/typescript/new), and comment fetching (redditAxios.get to /comments/{postId}). Created 15 mock posts in Reddit's raw API format (data.children[].data):
- Posts 1-5: high score (60-100) + high comments (25-45) — all passed filter
- Posts 6-10: high score (55-75) + low comments (1-2) — all passed filter (score >= 10)
- Posts 11-15: low score (2-3) + low comments (1-2) — all correctly filtered out

Sent POST /api/collect with { subreddit: "typescript", hours: 24 }. Verified:
1. Response status 200 with body containing subreddit, postsCollected (15), postsFiltered (10), timeRange, filePath
2. File at filePath exists and contains a JSON array of exactly 10 posts
3. All 10 saved posts satisfy score >= 10 OR numComments >= 5 (OR logic filter)
4. All 10 expected post IDs present, all 5 low-scoring post IDs absent
5. Each filtered post has exactly 3 comments attached
6. Token refresh called once, post fetch called once, comment fetch called 10 times (once per filtered post)

**Notes:**
- Config.json was temporarily modified to include only the `typescript` subreddit with minScore:10, minComments:5. Original config was backed up and restored after test.
- The api.ts module uses lazy config loading (getConfig()), so the modified config.json was picked up correctly on the first /api/collect call.
- The test log file (logs/typescript/2026-03-23.json) was cleaned up after verification.
- No code fixes were needed; the full collect flow (token refresh, fetch, filter, comment fetch, save) works correctly end-to-end.

---

## TC-017 — Read Log — Input validation

**Result:** PASS
**Tested At:** 2026-03-23T07:45:00Z
**Fix Attempts:** 0

**What happened:**
All 3 input validation scenarios for the `GET /api/logs/:subreddit/:date` endpoint passed on the first run with no code fixes needed:

1. Path traversal `GET /api/logs/%2e%2e%2fetc/2024-06-02` (subreddit = `../etc`) — returned 400 (PASS). The `SUBREDDIT_REGEX` (`/^[a-zA-Z0-9_]{1,21}$/`) correctly rejects `.` and `/` characters. Note: Express normalizes raw `..` in URLs before routing, so percent-encoding was used to deliver the literal `../etc` string to the `:subreddit` route parameter.
2. Invalid date `GET /api/logs/typescript/not-a-date` — returned 400 (PASS). The `DATE_REGEX` (`/^\d{4}-\d{2}-\d{2}$/`) correctly rejects non-date strings.
3. Non-existent log file `GET /api/logs/typescript/2024-06-02` — returned 404 (PASS). The `readLog()` function throws an error with `code: 'ENOENT'` which the route handler catches and maps to 404.

**Notes:**
- The validation in `src/routes/api.ts` (lines 213-239) handles all three scenarios correctly: subreddit regex blocks path traversal, date regex blocks malformed dates, and ENOENT errors from `readLog()` are caught and returned as 404.
- No code fixes were needed; the implementation matched the specification.

---

## TC-012 — Collect All — Sequential collection with partial failure

**Result:** PASS
**Tested At:** 2026-03-23T08:00:00Z
**Fix Attempts:** 0

**What happened:**
All 30 assertions passed on the first run with no code fixes needed. Configured 3 subreddits (typescript, nonexistent_sub, react) and mocked the Reddit API: typescript and react returned valid posts, nonexistent_sub returned 404. Sent POST /api/collect-all with { hours: 24 }.

1. Response status was 200 (at least one subreddit succeeded).
2. Response body was an array of exactly 3 entries, each with `subreddit` and `status` fields.
3. typescript entry: `status: "ok"`, `postsCollected: 5`, `postsFiltered: 3` (OR filter with minScore:10/minComments:5), valid `timeRange` and `filePath`.
4. nonexistent_sub entry: `status: "error"`, `error: "Subreddit not found (404)"` — the RedditApiError(404) was caught and formatted as `${message} (${statusCode})`.
5. react entry: `status: "ok"` — confirmed the partial failure of nonexistent_sub did NOT halt sequential collection. React was processed successfully after the error.
6. Results were ordered matching the config.json subreddit order: typescript, nonexistent_sub, react.

**Notes:**
- The collect-all endpoint iterates over `config.subreddits` sequentially, wrapping each in try/catch. A failure in one subreddit pushes an error entry but does not break the loop.
- The final HTTP status is determined by `anySuccess ? 200 : 502`, so partial failure still returns 200.
- Mocking was done by monkey-patching `axios.post` (token refresh) and `redditAxios.get` (post/comment fetching), routing based on URL path content.
- Config.json was backed up before test and restored after. Test log files in `logs/` were cleaned up.

---

## TC-020 — Storage — File creation and directory creation

**Result:** PASS
**Tested At:** 2026-03-23T08:15:00Z
**Fix Attempts:** 0

**What happened:**
All 29 assertions passed on the first run with no code fixes needed. Called `savePosts('test_typescript', mockPosts)` with 3 mock Post objects containing all required fields (id, title, author, score, numComments, url, selfText, createdUtc, flair, comments).

1. **Directory creation:** `logs/test_typescript/` directory was created automatically by `fs.mkdirSync(dir, { recursive: true })`.
2. **File naming:** File was created as `logs/test_typescript/2026-03-23.json` matching today's UTC date. The returned relative path (`logs/test_typescript/2026-03-23.json`) matched the expected value. Only 1 file existed in the directory.
3. **File content:** File contained valid JSON. Parsed content was an array of exactly 3 Post objects. Each post's fields (id, title, author, score, numComments, url, comments.length) matched the original mock data exactly.

**Notes:**
- This was a unit test calling `savePosts()` directly without starting the Express server.
- Used a test-specific subreddit name (`test_typescript`) to avoid conflicts with other test data.
- The `logs/test_typescript/` directory was cleaned up before and after the test.
- No code fixes were needed; the storage implementation in `src/services/storage.ts` works correctly for directory creation, file naming, and content serialization.

---

## TC-021 — Storage — Merge behavior (deduplication)

**Result:** PASS
**Tested At:** 2026-03-23T08:30:00Z
**Fix Attempts:** 0

**What happened:**
All 19 assertions passed on the first run with no code fixes needed. Called `savePosts('test_merge', batch1)` with 5 posts (a:10, b:20, c:30, d:40, e:50), then called `savePosts('test_merge', batch2)` with 5 overlapping posts (c:100, d:15, e:25, f:60, g:70). Both calls wrote to the same file (`logs/test_merge/2026-03-23.json`).

1. **Merge count:** Merged file contained exactly 7 unique posts (a, b, c, d, e, f, g) — no duplicates.
2. **Higher score wins (post c):** Post "c" was updated from score 30 to score 100, since the second batch had a higher score.
3. **Original kept when higher (posts d, e):** Post "d" kept score 40 (original > batch2's 15). Post "e" kept score 50 (original > batch2's 25).
4. **Unchanged posts (a, b):** Posts "a" (score 10) and "b" (score 20) were only in batch1 and remained untouched.
5. **New posts (f, g):** Posts "f" (score 60) and "g" (score 70) were only in batch2 and were added correctly.

**Notes:**
- The merge logic in `savePosts()` (lines 31-40 of `src/services/storage.ts`) works correctly: it builds a Map from existing posts, then iterates over new posts, replacing only when `post.score > existing.score`.
- This was a unit test calling `savePosts()` directly without starting the Express server.
- The `logs/test_merge/` directory was cleaned up before and after the test.
- No code fixes were needed; the deduplication implementation matched the specification exactly.

---

## TC-006 — OAuth — Invalid or expired state

**Result:** PASS
**Tested At:** 2026-03-23T08:45:00Z
**Fix Attempts:** 0

**What happened:**
All 9 assertions passed across 3 scenarios, testing the OAuth callback's state validation logic in `src/routes/auth.ts`:

1. **Nonexistent state** (`GET /auth/reddit/callback?state=nonexistent_state&code=test`) — returned 403 with `{"error":"Invalid state parameter"}`. The stateMap was empty so lookup returned undefined.
2. **Expired state** (inserted `expired_state` with timestamp 11 minutes in the past, then called callback) — returned 403 with `{"error":"State parameter expired"}`. Verified that the expired entry was also cleaned from stateMap after rejection.
3. **Missing state param** (`GET /auth/reddit/callback?code=test`) — returned 403 with `{"error":"Missing state parameter"}`. The guard `!state || typeof state !== 'string'` correctly catches missing query params.

**Notes:**
- Built a minimal Express app mounting only the auth router to avoid the side-effect `app.listen()` in `src/index.ts`.
- Imported `stateMap` directly from `src/routes/auth.ts` (exported for testing) and manipulated it to set up each scenario.
- For expired state, used `Date.now() - 11 * 60 * 1000` (11 minutes ago) which exceeds the `STATE_MAX_AGE_MS` of 10 minutes.
- No code fixes were needed; the implementation matched the specification exactly.

---

## TC-019 — Filtering — Per-subreddit threshold overrides

**Result:** PASS
**Tested At:** 2026-03-23T09:00:00Z
**Fix Attempts:** 0

**What happened:**
All 11 assertions passed on the first run with no code fixes needed. Tested that `filterPosts()` produces different results for the same post (score=15, numComments=8) when called with different per-subreddit threshold values:

1. **react subreddit (minScore=20, minComments=10):** Post excluded. Score 15 < 20 and numComments 8 < 10 — neither threshold met under OR logic, so the post was correctly filtered out. `filterPosts(posts, 20, 10)` returned an empty array.
2. **typescript subreddit using defaults (minScore=10, minComments=5):** Post included. Score 15 >= 10 (score threshold met), so OR logic passes. `filterPosts(posts, 10, 5)` returned the post.
3. **Verification of OR logic conditions:** Confirmed score=15 >= 10, numComments=8 >= 5 (both pass for typescript), and score=15 < 20, numComments=8 < 10 (both fail for react).
4. **Edge case — exact score boundary (minScore=15, minComments=20):** Post included (score=15 >= 15 via `>=`).
5. **Edge case — exact comments boundary (minScore=100, minComments=8):** Post included (numComments=8 >= 8 via `>=`).
6. **Edge case — both thresholds just above (minScore=16, minComments=9):** Post excluded (15 < 16 and 8 < 9).

**Notes:**
- The `filterPosts()` function accepts `minScore` and `minComments` as direct parameters. Per-subreddit overrides are resolved in `loadConfig()` via nullish coalescing (`sub.minScore ?? defaults.minScore`), so calling `filterPosts` with different threshold values correctly simulates per-subreddit behavior.
- This test confirms that per-subreddit overrides take precedence over defaults: a post that passes default thresholds can be excluded when a subreddit specifies stricter thresholds.
- No code fixes were needed; the implementation matched the specification.

---

## TC-011 — Collect — Hours parameter validation

**Result:** PASS
**Tested At:** 2026-03-23T09:30:00Z
**Fix Attempts:** 0

**What happened:**
All 10 assertions passed across 7 scenarios. Tested the `POST /api/collect` endpoint's `hours` parameter validation by starting a minimal Express server on port 4451 with no `REDDIT_REFRESH_TOKEN` set. Invalid hours values correctly return 400, while valid/missing hours values pass validation (returning 401 from the missing token check rather than 400 from validation).

1. **hours=0** — returned 400 (PASS). Below minimum of 1.
2. **hours=169** — returned 400 (PASS). Above maximum of 168.
3. **hours=-1** — returned 400 (PASS). Negative value, below minimum of 1.
4. **hours="abc"** — returned 400 (PASS). Non-number type rejected by `typeof hours !== 'number'` check.
5. **No hours field** — returned 401 (NOT 400, PASS). Defaults to 24; the `hours !== undefined` guard skips validation, and the request proceeds to `ensureAccessToken()` which fails with 401.
6. **hours=1** — returned 401 (NOT 400, PASS). Boundary minimum accepted; passes `hours >= 1` check.
7. **hours=168** — returned 401 (NOT 400, PASS). Boundary maximum accepted; passes `hours <= 168` check.

**Notes:**
- The validation logic in `src/routes/api.ts` (lines 40-52) correctly handles all cases: type check (`typeof hours !== 'number' || !Number.isFinite(hours)`), then range check (`hours < 1 || hours > 168`), with a default of 24 when `hours` is undefined.
- Built a minimal Express app mounting only the API router to avoid side effects from `src/index.ts`.
- No code fixes were needed; the implementation matched the specification.

---

## TC-026 — Error — Missing refresh token returns 401

**Result:** PASS
**Tested At:** 2026-03-23T10:00:00Z
**Fix Attempts:** 0

**What happened:**
All 9 assertions passed on the first run with no code fixes needed. Started a minimal Express server on port 4452 with REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_REDIRECT_URI, and REDDIT_USERNAME set, but REDDIT_REFRESH_TOKEN deliberately unset. Tested both collection endpoints:

1. **POST /api/collect** with `{ "subreddit": "typescript" }` — returned 401 (PASS). Response body: `{ "error": "Reddit refresh token not configured. Complete OAuth setup first." }`. The error field is a string containing both "refresh token" and "Complete...setup" directing the user to complete OAuth.
2. **POST /api/collect-all** with `{ "hours": 24 }` — returned 401 (PASS). Response body identical to step 1. Same error message returned.
3. **Message consistency** — both endpoints returned the exact same error message (PASS).

**Notes:**
- The error originates from `ensureAccessToken()` in `src/services/reddit.ts` (line 37), which checks `process.env.REDDIT_REFRESH_TOKEN` and throws `new RedditApiError(401, 'Reddit refresh token not configured. Complete OAuth setup first.')`.
- Both `/api/collect` (lines 54-62) and `/api/collect-all` (lines 135-143) in `src/routes/api.ts` call `ensureAccessToken()` before any Reddit API interaction and catch `RedditApiError` with statusCode 401, returning it as a 401 JSON response.
- Built a minimal Express app mounting only the API router to avoid side effects from `src/index.ts`.
- No code fixes were needed; the implementation matched the specification.

---

## TC-013 — Collect All — All subreddits fail

**Result:** PASS
**Tested At:** 2026-03-23T10:15:00Z
**Fix Attempts:** 0

**What happened:**
All 12 assertions passed on the first run with no code fixes needed. Configured 2 subreddits (bad_sub_one, bad_sub_two) in config.json, both mocked to return 404 from the Reddit API. Token refresh was mocked to succeed. Sent POST /api/collect-all with { hours: 24 }.

1. **HTTP 502 returned** (PASS). Since `anySuccess` remained `false` (no subreddit succeeded), the endpoint returned `res.status(anySuccess ? 200 : 502)` which resolved to 502.
2. **Response body is an array of 2 entries** (PASS). Each entry corresponds to one configured subreddit.
3. **Entry 1 (bad_sub_one):** `status: "error"`, `error: "Subreddit not found (404)"` (PASS). The `fetchPosts()` call threw `RedditApiError(404, 'Subreddit not found')`, caught by the try/catch in the collect-all loop and formatted as `${message} (${statusCode})`.
4. **Entry 2 (bad_sub_two):** `status: "error"`, `error: "Subreddit not found (404)"` (PASS). Same behavior as entry 1 -- the loop continued despite entry 1's failure.
5. **No entry has status "ok"** (PASS). Both entries failed, confirming total failure scenario.
6. **Both error messages reference "not found" or 404** (PASS).

**Notes:**
- Mocking was done by monkey-patching `axios.post` (token refresh -> success) and `redditAxios.get` (post fetching -> 404 for all URLs containing `/r/`).
- The collect-all endpoint in `src/routes/api.ts` (lines 118-192) correctly handles total failure: the `anySuccess` flag stays `false`, and the final HTTP status is 502.
- The sequential loop processes all subreddits even when each one fails, collecting error entries for each.
- Config.json was backed up before test and restored after. Test file cleaned up.
- No code fixes were needed; the implementation matched the specification.

---

## TC-027 — Error — Reddit 404 (invalid subreddit)

**Result:** PASS
**Tested At:** 2026-03-23T10:30:00Z
**Fix Attempts:** 0

**What happened:**
All 4 assertions passed on the first run with no code fixes needed. Started a mock HTTP server on port 4455 that handled both token refresh (POST /api/v1/access_token -> 200 with mock token) and subreddit posts (GET /r/:subreddit/new -> 404). Used axios request interceptors to redirect Reddit API URLs to the mock server. Built a minimal Express app on port 4454 mounting only the API router.

Sent POST /api/collect with `{ "subreddit": "nonexistent_sub_xyz" }`:

1. **Token refresh succeeded** (PASS). The mock server returned a valid access token. `ensureAccessToken()` completed without error.
2. **fetchPosts() received 404** (PASS). The mock server returned 404 for `GET /r/nonexistent_sub_xyz/new`. The catch block in `fetchPosts()` detected `err.response.status === 404` and threw `new RedditApiError(404, 'Subreddit not found')`.
3. **HTTP 404 returned** (PASS). The `/api/collect` route handler caught the `RedditApiError` (line 103 of api.ts) and called `res.status(err.statusCode).json({ error: err.message })`, returning status 404.
4. **Error message correct** (PASS). Response body was `{ "error": "Subreddit not found" }`, containing the expected message.

**Notes:**
- Mocking was done by installing axios request interceptors that rewrote `https://www.reddit.com` and `https://oauth.reddit.com` URLs to `http://localhost:4455`. Both the global axios instance (used by `ensureAccessToken()` for token refresh) and the `redditAxios` instance (used by `fetchPosts()` for API calls) were intercepted.
- The subreddit name `nonexistent_sub_xyz` passes the `SUBREDDIT_REGEX` validation (`/^[a-zA-Z0-9_]{1,21}$/`) so the request reaches the Reddit API call stage.
- The error mapping chain is: Reddit 404 -> `RedditApiError(404, 'Subreddit not found')` in `fetchPosts()` (reddit.ts:109) -> `res.status(404).json({error: 'Subreddit not found'})` in the catch block (api.ts:103-104).
- No code fixes were needed; the implementation matched the specification.

---

## TC-030 — Error — Reddit 5xx with retry

**Result:** PASS
**Tested At:** 2026-03-23T11:00:00Z
**Fix Attempts:** 0

**What happened:**
All 9 assertions passed across 2 scenarios on the first run with no code fixes needed. Monkey-patched `axios.post` (token refresh -> success) and `redditAxios.get` (posts endpoint -> controlled 500/200 responses) to test the retry logic in `fetchPosts()` (lines 114-131 of `src/services/reddit.ts`).

**Scenario A — Both calls fail (500 then 500):**
1. First call to `GET /r/typescript/new` returned 500. The catch block detected `status >= 500` and waited ~2 seconds before retrying.
2. Retry also returned 500. The inner catch block threw `new RedditApiError(502, 'Reddit API unavailable')`.
3. The `/api/collect` route handler caught the `RedditApiError` and returned HTTP 502 with `{"error":"Reddit API unavailable"}`.
4. The posts endpoint was called exactly 2 times (1 initial + 1 retry), verified via call counter.

**Scenario B — First call fails (500), retry succeeds (200):**
1. First call to `GET /r/typescript/new` returned 500. Same retry logic triggered with ~2s delay.
2. Retry returned 200 with valid post data (1 post with score=100, numComments=50).
3. The response was processed normally: `POST /api/collect` returned HTTP 200 with `subreddit: "typescript"`, `postsCollected` and `postsFiltered` as numbers.
4. The posts endpoint was called exactly 2 times (1 initial + 1 retry), verified via call counter.

**Notes:**
- Total test execution time was ~4.1 seconds due to the 2-second retry delays in both scenarios.
- The retry logic is implemented inline in `fetchPosts()`: when `err.response.status >= 500`, it waits 2 seconds via `setTimeout`, then retries the same request. If the retry also fails, it throws `RedditApiError(502, 'Reddit API unavailable')`.
- The same retry pattern exists in `fetchComments()` (lines 209-225) but was not exercised in this test since Scenario B's comments endpoint was mocked to succeed immediately.
- Mocking was done by replacing `redditAxios.get` with a function that uses a call counter to distinguish first call (throw 500) vs retry (throw 500 or return 200).
- No code fixes were needed; the retry implementation matched the specification exactly.

---

## TC-022 — Reddit API — Pagination

**Result:** PASS
**Tested At:** 2026-03-23T11:15:00Z
**Fix Attempts:** 0

**What happened:**
All 16 assertions passed on the first run with no code fixes needed. Tested the `fetchPosts()` function's pagination logic by mocking `redditAxios.get` to return 3 pages of Reddit API responses and `axios.post` to handle token refresh. Used `hoursBack: 72` to define the time window.

**Mock data setup:**
- Page 1: 100 posts (1-24 hours ago), all within 72h range, `after = "t3_page1_last"`
- Page 2: 100 posts (25-48 hours ago), all within 72h range, `after = "t3_page2_last"`
- Page 3: 50 posts — 30 within range (49-70h ago) + 20 outside range (73-100h ago), `after = null`

**Verification results:**
1. **First request params** — `limit=100`, no `after` param (PASS)
2. **Second request params** — `limit=100`, `after=t3_page1_last` (PASS)
3. **Third request params** — `limit=100`, `after=t3_page2_last` (PASS)
4. **Pagination stops** — Exactly 3 API calls made. Stopped on page 3 when `reachedCutoff` was set to `true` upon encountering the first post outside the 72-hour range (73h ago) (PASS)
5. **Total posts collected** — 230 posts (100 + 100 + 30 in-range). The 20 out-of-range posts from page 3 were correctly excluded (PASS)
6. **All collected posts within range** — Every post's `createdUtc` is >= the cutoff timestamp (PASS)
7. **Page-level verification** — All 100 page 1 posts, all 100 page 2 posts, and all 30 in-range page 3 posts present; none of the 20 out-of-range page 3 posts included (PASS)

**Notes:**
- The pagination logic in `fetchPosts()` (lines 91-180 of `src/services/reddit.ts`) correctly iterates pages using the `after` cursor from each response, stops when `reachedCutoff` is true (a post's `created_utc * 1000 < cutoff`), and also stops when `after` is null.
- The `after` value from each page's `response.data.data.after` is correctly passed as a query parameter in the next request.
- The rate limit utility (`updateRateLimit` / `checkRateLimit`) was exercised on each page response via mock headers with high remaining counts.
- Mocking was done by monkey-patching `redditAxios.get` with a function that routes based on the `after` query parameter: no `after` returns page 1, `t3_page1_last` returns page 2, `t3_page2_last` returns page 3.
- No code fixes were needed; the pagination implementation matched the specification exactly.

---

## TC-024 — Reddit API — Comments fetching

**Result:** PASS
**Tested At:** 2026-03-23T11:30:00Z
**Fix Attempts:** 0

**What happened:**
All 29 assertions passed on the first run with no code fixes needed. Tested the `fetchComments()` function directly by mocking `redditAxios.get` (comments endpoint) and `axios.post` (token refresh). Called `fetchComments()` for 3 different post IDs (`abc123`, `def456`, `ghi789`) with the default limit of 10.

**Mock data:** Each mock response contained 13 comments in Reddit's standard format (array of 2 listings): 8 top-level comments (depth 0) and 5 nested replies (depth 1-5), interleaved to test filtering robustness.

**Verification results:**
1. **Comments endpoint called 3 times** (PASS). One GET request per post ID to `https://oauth.reddit.com/comments/{postId}`.
2. **Request params correct** (PASS, 9 assertions). All 3 calls used `sort=top` and `limit=10` as query parameters. URLs correctly included `/comments/{postId}`.
3. **Only top-level comments returned** (PASS, 9 assertions). Each post returned exactly 8 comments (all depth-0). No nested replies (depth 1+) appeared in the results. All returned comment IDs contained `_tl` (top-level marker), none contained `nested`.
4. **Max per post cap** (PASS, 3 assertions). All 3 posts returned <= 10 comments.
5. **Explicit limit=3 test** (PASS, 2 assertions). Called `fetchComments('limit_test', 3)` and received exactly 3 comments. The request param `limit` was `3`.
6. **Comment structure** (PASS, 5 assertions). Verified: `id` is string, `author` is prefixed with `u/`, `body` is string, `score` is number, `createdUtc` is ISO string.

**Notes:**
- The `fetchComments()` function (lines 189-263 of `src/services/reddit.ts`) correctly filters by `data.depth !== 0` (line 246), skips non-`t1` kinds (line 242-244), and caps results at the `limit` parameter (line 258).
- Token refresh was mocked via `axios.post` monkey-patching (same pattern as TC-008/TC-009). The `clearCachedToken()` helper ensured a fresh token fetch.
- Rate limit headers were included in mock responses to avoid errors from `updateRateLimit()` / `checkRateLimit()`.
- No code fixes were needed; the comments fetching implementation matched the specification exactly.

---

## TC-025 — Reddit API — Rate limit handling

**Result:** PASS
**Tested At:** 2026-03-23T12:00:00Z
**Fix Attempts:** 0

**What happened:**
Tested the rate limit utility (`src/utils/rateLimit.ts`) directly by importing `updateRateLimit`, `checkRateLimit`, and `resetRateLimitState`. All 12 assertions passed across 6 scenarios.

**Detailed checks:**
1. **updateRateLimit() logging** (PASS, 2 assertions). Called with mock headers `X-Ratelimit-Remaining: 3`, `X-Ratelimit-Reset: 5`. Console output contained `[Rate Limit] Remaining: 3, Reset in: 5s`.
2. **checkRateLimit() pause behavior** (PASS, 4 assertions). With remaining=3 (<5), `checkRateLimit()` logged "Low remaining (3), waiting 5s..." and paused for 5002ms (within 4-7s tolerance). After resuming, logged "Wait complete, resuming."
3. **Function resolves after wait** (PASS, 1 assertion). Execution continued normally after the ~5s pause.
4. **No duplicate wait after reset window passes** (PASS, 1 assertion). Second call to `checkRateLimit()` completed in 0ms because `rateLimitResetAt` was now in the past (`waitMs <= 0`).
5. **remaining=0 throws error** (PASS, 2 assertions). With remaining=0, `checkRateLimit()` threw `Error("Reddit rate limit exhausted. Retry after 10 seconds.")` with `retryAfter` property.
6. **remaining>=5 skips wait** (PASS, 2 assertions). With remaining=50, `checkRateLimit()` completed in 0ms with no "Low remaining" log.

**Notes:**
- The rate limit utility uses module-level state variables (`rateLimitRemaining`, `rateLimitResetSeconds`, `rateLimitResetAt`) updated by `updateRateLimit()` from response headers.
- `checkRateLimit()` has three branches: throw if remaining<=0, sleep if remaining<5 and reset time is in the future, otherwise pass through.
- `resetRateLimitState()` helper (line 57) was used between scenarios to reset module state.
- The test took ~5 seconds total due to the intentional rate limit pause.
- No code fixes were needed; the rate limit implementation matched the specification exactly.

---

## TC-014 — List Logs — All logs

**Result:** PASS
**Tested At:** 2026-03-23T12:30:00Z
**Fix Attempts:** 0

**What happened:**
All 43 assertions passed on the first run with no code fixes needed. Created 4 test log files across 2 subreddits and 2 dates, then sent GET /api/logs and verified the response.

**Setup:**
- `logs/test_sub_a/2024-06-01.json` with 3 minimal post objects
- `logs/test_sub_a/2024-06-02.json` with 5 minimal post objects
- `logs/test_sub_b/2024-06-01.json` with 2 minimal post objects
- `logs/test_sub_b/2024-06-02.json` with 4 minimal post objects

**Verification results:**
1. **GET /api/logs returns 200** (PASS). Response status was 200 and body was a JSON array.
2. **4 test entries found** (PASS). Filtered response by test subreddit names; found exactly 4 entries.
3. **test_sub_a/2024-06-01** (PASS, 5 assertions). Entry exists with correct subreddit, date, non-empty filePath containing subreddit and date, and postCount=3.
4. **test_sub_a/2024-06-02** (PASS, 5 assertions). Entry exists with correct subreddit, date, filePath, and postCount=5.
5. **test_sub_b/2024-06-01** (PASS, 5 assertions). Entry exists with correct subreddit, date, filePath, and postCount=2.
6. **test_sub_b/2024-06-02** (PASS, 5 assertions). Entry exists with correct subreddit, date, filePath, and postCount=4.
7. **Field type verification** (PASS, 16 assertions). All 4 entries have string `subreddit`, string `date`, string `filePath`, and numeric `postCount`.

**Notes:**
- Built a minimal Express app mounting only the API router on port 4457 to avoid side effects from `src/index.ts`.
- The `listLogs()` function in `src/services/storage.ts` (lines 68-107) correctly reads all subreddit directories under `logs/`, iterates their `.json` files, parses each to count posts, and returns `LogEntry` objects with `subreddit`, `date`, `filePath`, and `postCount`.
- The `GET /api/logs` endpoint in `src/routes/api.ts` (lines 195-210) correctly calls `listLogs()` with no filter and returns the result as JSON.
- Test log directories (`logs/test_sub_a/`, `logs/test_sub_b/`) were cleaned up before and after the test.
- No code fixes were needed; the implementation matched the specification exactly.

---

## TC-016 — Read Log — Happy path

**Result:** PASS
**Tested At:** 2026-03-23T13:00:00Z
**Fix Attempts:** 0

**What happened:**
All 61 assertions passed on the first run with no code fixes needed. Created `logs/test_readlog/2024-06-02.json` with 2 well-formed posts (including comments), started the server on port 4458, and sent `GET /api/logs/test_readlog/2024-06-02`.

1. **Step 1 — HTTP response:** Received 200 status with a JSON array of exactly 2 posts.
2. **Step 2 — Post schema:** Both posts contained all 10 required fields: `id`, `title`, `author`, `score`, `numComments`, `url`, `selfText`, `createdUtc`, `flair`, `comments`. Specific values verified for both posts (e.g., Post[0].score=42, Post[1].score=105). Null flair on Post[1] handled correctly (returned as `null`, not undefined or empty string).
3. **Step 3 — Comment schema:** All 3 comments across both posts contained all 5 required fields: `id`, `author`, `body`, `score`, `createdUtc`. Specific values verified (e.g., comment_c1 author="commenter_a", score=15; comment_c3 score=22).

**Notes:**
- The `readLog()` function in `src/services/storage.ts` (lines 52-63) correctly reads the JSON file at `logs/{subreddit}/{date}.json` and returns the parsed array.
- The `GET /api/logs/:subreddit/:date` endpoint in `src/routes/api.ts` (lines 213-239) correctly validates params, calls `readLog()`, and returns the posts as JSON.
- Used `test_readlog` as the subreddit name to avoid conflicts with other test data.
- Test log directory (`logs/test_readlog/`) was cleaned up after the test.
- No code fixes were needed; the implementation matched the specification exactly.

---

## TC-023 — Reddit API — Pagination cap at 10 pages

**Result:** PASS
**Tested At:** 2026-03-23T13:15:00Z
**Fix Attempts:** 0

**What happened:**
All 9 assertions passed on the first run with no code fixes needed. Tested `fetchPosts()` pagination cap by mocking `redditAxios.get` to always return 100 posts within the time range with a valid `after` token (so pagination never stops naturally), and `axios.post` for token refresh. Called `fetchPosts('testpagination', 10000)` with a very large `hoursBack` value to ensure the time-based cutoff never triggers.

1. **Exactly 10 API calls** (PASS). The mock tracked call count; `fetchPosts()` made exactly 10 GET requests to the Reddit API. The `for (let page = 0; page < maxPages; page++)` loop (line 91) with `maxPages = 10` (line 89) correctly bounded the iteration.
2. **Warning logged** (PASS, 3 assertions). `console.warn` was captured and contained: `"[fetchPosts] Reached page cap (10) for r/testpagination. Some posts may be missing."` The warning correctly includes the cap number (10) and the subreddit name (testpagination). This is triggered at line 177-179 when `page === maxPages - 1`.
3. **1000 posts collected** (PASS). Exactly 1000 posts returned (100 per page x 10 pages). Page 1 contributed 100 posts (IDs starting with `post_p1_`), page 10 contributed 100 posts (IDs starting with `post_p10_`). Zero posts from a hypothetical page 11 were present.
4. **All posts valid** (PASS). Every post had correct `id`, `title`, `author`, `score`, `numComments`, `url`, and `createdUtc` fields.

**Notes:**
- The pagination cap logic in `fetchPosts()` (lines 84-183 of `src/services/reddit.ts`) works correctly. Three stopping conditions exist: (1) time-based cutoff (`reachedCutoff`), (2) no more pages (`after === null`), (3) page cap (`page < maxPages`). This test specifically exercised condition (3) by ensuring conditions (1) and (2) never triggered.
- The warning at line 177-179 fires on the last iteration (`page === maxPages - 1`), which is correct since the loop body completes (collecting page 10's posts) before the loop condition prevents page 11.
- Mocking was done by monkey-patching `axios.post` (token refresh -> success) and `redditAxios.get` (always return 100 recent posts with `after` token). Rate limit headers were included with high remaining counts.
- `console.warn` was captured via monkey-patching; `console.log` was also captured to suppress rate limit utility noise.
- No code fixes were needed; the pagination cap implementation matched the specification exactly.

---

## TC-015 — List Logs — Filter by subreddit

**Result:** PASS
**Tested At:** 2026-03-23T13:30:00Z
**Fix Attempts:** 0

**What happened:**
All 17 assertions passed on the first run with no code fixes needed. Created test log files for 2 subreddits (`test_ts` with 2 posts, `test_react` with 3 posts), started a minimal Express server on port 4459, and tested the `GET /api/logs?subreddit=<name>` endpoint.

**Setup:**
- `logs/test_ts/2024-06-01.json` with 2 minimal post objects
- `logs/test_react/2024-06-01.json` with 3 minimal post objects

**Verification results:**
1. **GET /api/logs?subreddit=test_ts returns 200** (PASS). Response status was 200 and body was a JSON array.
2. **Only test_ts entries returned** (PASS, 4 assertions). Array contained 1 entry, all with `subreddit === "test_ts"`. Entry had correct `date: "2024-06-01"`, `postCount: 2`, and `filePath` containing both "test_ts" and "2024-06-01".
3. **No test_react entries in response** (PASS, 2 assertions). `res1.body.some(e => e.subreddit === "test_react")` returned `false`. Exactly 1 entry total confirmed.
4. **Reverse filter verification** (PASS, 6 assertions). `GET /api/logs?subreddit=test_react` returned 200 with array containing only `test_react` entries (`postCount: 3`). No `test_ts` entries present.

**Notes:**
- The `listLogs()` function in `src/services/storage.ts` (lines 68-107) correctly filters by subreddit when the parameter is provided: it sets `subreddits = [subreddit]` instead of reading all directories, so only the requested subreddit's logs are scanned and returned.
- The `GET /api/logs` endpoint in `src/routes/api.ts` (lines 195-210) correctly passes `req.query.subreddit` to `listLogs()` and validates it against `SUBREDDIT_REGEX` before calling.
- Built a minimal Express app mounting only the API router on port 4459 to avoid side effects from `src/index.ts`.
- Test log directories (`logs/test_ts/`, `logs/test_react/`) were cleaned up after the test.
- No code fixes were needed; the implementation matched the specification exactly.

---

## TC-028 — Error — Reddit 403 (private/banned subreddit)

**Result:** PASS
**Tested At:** 2026-03-23T14:00:00Z
**Fix Attempts:** 0

**What happened:**
All 4 assertions passed on the first run with no code fixes needed. Started a mock HTTP server on port 4461 that handled both token refresh (POST /api/v1/access_token -> 200 with mock token) and subreddit posts (GET /r/:subreddit/new -> 403). Used axios request interceptors to redirect Reddit API URLs to the mock server. Built a minimal Express app on port 4460 mounting only the API router.

Sent POST /api/collect with `{ "subreddit": "private_sub" }`:

1. **HTTP status is 403** (PASS). The server returned HTTP 403, confirming that Reddit's 403 is correctly mapped through to the client.
2. **Response has error field** (PASS). Response body was `{ "error": "Subreddit is private or banned" }`, a valid JSON object with a string `error` field.
3. **Error message is correct** (PASS). The error message was exactly `"Subreddit is private or banned"`, matching the string thrown by `RedditApiError(403, 'Subreddit is private or banned')` in `fetchPosts()`.
4. **Error message mentions private or banned** (PASS). The message contains the word "private", providing a meaningful description of why the 403 occurred.

**Notes:**
- Mocking was done by installing axios request interceptors that rewrote `https://www.reddit.com` and `https://oauth.reddit.com` URLs to `http://localhost:4461`. Both the global axios instance (used by `ensureAccessToken()` for token refresh) and the `redditAxios` instance (used by `fetchPosts()` for API calls) were intercepted.
- The subreddit name `private_sub` passes the `SUBREDDIT_REGEX` validation (`/^[a-zA-Z0-9_]{1,21}$/`) so the request reaches the Reddit API call stage.
- The error mapping chain is: Reddit 403 -> `RedditApiError(403, 'Subreddit is private or banned')` in `fetchPosts()` (reddit.ts:111-112) -> `res.status(403).json({error: 'Subreddit is private or banned'})` in the catch block (api.ts:103-104).
- No code fixes were needed; the implementation matched the specification.

---

## TC-029 — Error — Reddit 429 (rate limited)

**Result:** PASS
**Tested At:** 2026-03-23T14:15:00Z
**Fix Attempts:** 0

**What happened:**
All 7 assertions passed on the first run with no code fixes needed. Started a minimal Express server on port 4462 with all required env vars set (including REDDIT_REFRESH_TOKEN). Monkey-patched `axios.post` (token refresh -> success) and `redditAxios.get` (posts endpoint -> returns valid post data but with rate-limit-exhausted headers: `x-ratelimit-remaining: 0`, `x-ratelimit-reset: 30`).

Sent POST /api/collect with `{ "subreddit": "typescript" }`:

1. **Token refresh succeeded** (implicit). `ensureAccessToken()` used the mocked `axios.post` to get a valid token.
2. **fetchPosts() called Reddit API** (implicit). The mock returned one valid post with headers indicating rate limit exhaustion (`x-ratelimit-remaining: 0`, `x-ratelimit-reset: 30`).
3. **updateRateLimit() processed headers** (implicit). Parsed `remaining=0` and `resetSeconds=30`, computed `rateLimitResetAt = Date.now() + 30000`.
4. **checkRateLimit() threw error** (implicit). Since `rateLimitRemaining <= 0`, it threw `Error("Reddit rate limit exhausted. Retry after 30 seconds.")` with `error.retryAfter = 30`.
5. **HTTP status is 429** (PASS). The `/api/collect` catch block (api.ts lines 107-111) detected `err.retryAfter`, set `Retry-After` header, and returned 429.
6. **Retry-After header present** (PASS). Value was `"30"` (string), matching the mock's `x-ratelimit-reset` value.
7. **Retry-After is a positive number** (PASS). Parsed as integer 30 > 0.
8. **Retry-After is reasonable** (PASS). Value 30 <= 60.
9. **Error body has error field** (PASS). Response was `{"error": "Reddit rate limit exhausted. Retry after 30 seconds."}`.
10. **Error mentions rate limit** (PASS). Message contains "rate limit".
11. **Error mentions retry** (PASS). Message contains "retry".

**Notes:**
- The rate limit error path is: Reddit response headers (`x-ratelimit-remaining: 0`) -> `updateRateLimit()` (rateLimit.ts:10-23) stores `rateLimitRemaining=0` -> `checkRateLimit()` (rateLimit.ts:30-52) throws error with `retryAfter` property -> `/api/collect` catch block (api.ts:107-111) checks `err.retryAfter`, calls `res.set('Retry-After', String(err.retryAfter))` and `res.status(429).json({error: err.message})`.
- This is distinct from Reddit directly returning HTTP 429. The code path tested here is the proactive rate limit check via the rate limit utility, which fires *after* a successful API response that reports remaining=0 in its headers.
- The `retryAfter` value is computed as `Math.ceil((rateLimitResetAt - Date.now()) / 1000)` with a minimum of 1 second (line 40 of rateLimit.ts).
- Mocking was done by monkey-patching `axios.post` and `redditAxios.get`. `resetRateLimitState()` and `clearCachedToken()` were called before and after the test.
- No code fixes were needed; the implementation matched the specification.

---

## TC-007 — OAuth — State pruning

**Result:** PASS
**Tested At:** 2026-03-23T14:30:00Z
**Fix Attempts:** 0

**What happened:**
Tested that stale OAuth state entries (>10 minutes old) are pruned when a new authorization request is made. Created a minimal Express server on port 4463 with the auth router. Directly imported `stateMap` from `src/routes/auth.ts` and inserted 5 stale entries with timestamps 11+ minutes in the past.

All 5 assertions passed:
1. **stateMap has 5 entries after insertion** (PASS). Verified `stateMap.size === 5` after inserting 5 entries with old timestamps.
2. **GET /auth/reddit returns 302** (PASS). The endpoint redirected to Reddit's authorization URL as expected.
3. **stateMap has exactly 1 entry after pruning** (PASS). After the request, `stateMap.size === 1` — all 5 stale entries were removed, and 1 new state was added.
4. **No stale keys remain** (PASS). The remaining key is not any of the 5 inserted stale keys (`stale_state_1` through `stale_state_5`).
5. **New entry has recent timestamp** (PASS). The single remaining entry's timestamp was within 5ms of `Date.now()`.

**Notes:**
- The pruning logic lives in `pruneStaleStates()` (auth.ts:16-23), which iterates the stateMap and deletes entries where `Date.now() - timestamp > STATE_MAX_AGE_MS` (10 minutes). It is called at the top of the `GET /reddit` handler (auth.ts:27) before generating a new state.
- Used `redirect: 'manual'` in the fetch call to prevent following the 302 redirect to Reddit.
- No code fixes were needed; the implementation matched the specification.

---

## TC-031 — Frontend — OAuth setup page

**Result:** PASS
**Tested At:** 2026-03-23T14:45:00Z
**Fix Attempts:** 0

**What happened:**
Tested that the OAuth setup page correctly reflects Reddit connection status. The frontend is a static HTML page (`public/index.html`) that calls `GET /api/status` via `fetch()`. The `/api/status` endpoint returns `{ connected: !!process.env.REDDIT_REFRESH_TOKEN }`. The JavaScript updates the status text to "Connected" or "Not Connected" based on the response.

All 18 assertions passed across 4 scenarios:

**Scenario 1 — No refresh token (port 4464):**
1. **GET /api/status returns HTTP 200** (PASS)
2. **Response is { connected: false }** (PASS)
3. **GET / returns HTTP 200** (PASS) — static HTML served correctly
4. **HTML contains title "Reddit Summarizer Setup"** (PASS)
5. **HTML contains "Connect to Reddit" text** (PASS)
6. **HTML contains href="/auth/reddit"** (PASS) — button links to OAuth flow
7. **HTML contains id="status" element** (PASS) — target for JS status update
8. **HTML contains fetch('/api/status')** (PASS) — JS calls the status API
9. **HTML JS sets "Not Connected" when disconnected** (PASS)
10. **HTML JS sets "Connected" when connected** (PASS)

**Scenario 2 — With refresh token (port 4465):**
11. **GET /api/status returns HTTP 200** (PASS)
12. **Response is { connected: true }** (PASS)
13. **connected field is a boolean** (PASS)
14. **Response contains only the connected field** (PASS)

**Scenario 3 — Real server, no token (port 4466):**
15. **Real /api/status returns HTTP 200** (PASS)
16. **Real /api/status returns connected: false** (PASS) — using actual api router from src/routes/api.ts

**Scenario 4 — Real server, with token (port 4467):**
17. **Real /api/status returns HTTP 200** (PASS)
18. **Real /api/status returns connected: true** (PASS) — process.env.REDDIT_REFRESH_TOKEN set

**Notes:**
- The HTML is static (not server-rendered); status is determined client-side via `fetch('/api/status')` in an IIFE.
- The `/api/status` endpoint (src/routes/api.ts:22-24) uses `!!process.env.REDDIT_REFRESH_TOKEN` to determine connection status.
- The "Connect to Reddit" link (`<a href="/auth/reddit" class="btn">`) is always present in the HTML regardless of connection status.
- No code fixes were needed; the implementation matched the specification.

---

## TC-032 — Reddit API — User-Agent header

**Result:** PASS
**Tested At:** 2026-03-23T15:00:00Z
**Fix Attempts:** 0

**What happened:**
All 8 assertions passed on the first run with no code fixes needed. Verified that the `redditAxios` instance and the `ensureAccessToken()` token refresh call both include the correct `User-Agent` header in the format `reddit-summarizer/1.0 by {REDDIT_USERNAME}`.

**Step 1 — redditAxios default headers (4 assertions):**
1. **User-Agent is a string** (PASS). `redditAxios.defaults.headers['User-Agent']` is of type `string`.
2. **User-Agent matches expected format** (PASS). Value is exactly `"reddit-summarizer/1.0 by testuser"`.
3. **User-Agent starts with correct prefix** (PASS). Starts with `"reddit-summarizer/1.0 by "`.
4. **User-Agent includes REDDIT_USERNAME** (PASS). Contains `"testuser"`.

**Step 2 — Format pattern (1 assertion):**
5. **User-Agent matches regex `/^reddit-summarizer\/1\.0 by \w+$/`** (PASS).

**Step 3 — Outgoing request interception (1 assertion):**
6. **Outgoing request carries correct User-Agent** (PASS). Installed an axios request interceptor on `redditAxios`, triggered a GET request, and captured the `User-Agent` header. Value matched `"reddit-summarizer/1.0 by testuser"`. The request was aborted via `AbortController` to prevent hitting the real API.

**Step 4 — Token refresh User-Agent (2 assertions):**
7. **Token refresh request includes User-Agent** (PASS). Installed an interceptor on the global `axios` instance (obtained via `require('axios').default` to match the same singleton used by `reddit.ts`). Called `ensureAccessToken()` after clearing the cached token. Intercepted the POST to `https://www.reddit.com/api/v1/access_token` and captured the `User-Agent` header.
8. **Token refresh User-Agent matches expected** (PASS). Value was `"reddit-summarizer/1.0 by testuser"`, matching the same format used by `redditAxios`.

**Notes:**
- The `User-Agent` header is set in two places in `src/services/reddit.ts`: (1) `createRedditAxios()` (line 12) sets it as a default header on the `redditAxios` instance, and (2) `ensureAccessToken()` (line 59) passes it explicitly in the config for the token refresh POST request. Both use the same template: `` `reddit-summarizer/1.0 by ${process.env.REDDIT_USERNAME}` ``.
- `axios.create()` stores custom headers at `defaults.headers['User-Agent']` (top level), not under `defaults.headers.common`. This is an axios implementation detail.
- Dynamic `import('axios').default` returns a different object reference than `require('axios').default` due to ESM/CJS interop in tsx. The test used `require()` to obtain the same singleton instance that `reddit.ts` imports, ensuring the interceptor is registered on the correct instance.
- No code fixes were needed; the implementation matched the specification.

---

## TC-033 — Storage — File naming uses collection date (UTC)

**Result:** PASS
**Tested At:** 2026-03-23T15:15:00Z
**Fix Attempts:** 0

**What happened:**
All 12 assertions passed on the first run with no code fixes needed. Called `savePosts("test_datecheck", posts)` with 2 mock posts whose `createdUtc` was set to yesterday (2026-03-22). Verified that the file was named with today's UTC date (2026-03-23), not yesterday's.

**Verification results:**
1. **Precondition: today != yesterday** (PASS). Today's UTC date (2026-03-23) differs from yesterday (2026-03-22).
2. **filePath matches expected** (PASS). Returned `"logs/test_datecheck/2026-03-23.json"`, exactly matching `logs/{subreddit}/{today}.json`.
3. **File exists on disk** (PASS). The file was created at the expected absolute path.
4. **filePath contains today's date** (PASS). The string `2026-03-23` is present in the returned path.
5. **filePath does NOT contain yesterday's date** (PASS). The string `2026-03-22` is absent from the returned path.
6. **File contains a JSON array** (PASS). Parsed content is an array.
7. **File contains 2 posts** (PASS). Array length is 2.
8. **First post ID matches** (PASS). `parsed[0].id === "tc033_post1"`.
9. **Second post ID matches** (PASS). `parsed[1].id === "tc033_post2"`.
10. **Post createdUtc unchanged** (PASS). The stored post's `createdUtc` is still yesterday's ISO timestamp, confirming the function does not alter post data.
11. **filePath matches YYYY-MM-DD pattern** (PASS). Regex `logs/test_datecheck/\d{4}-\d{2}-\d{2}\.json` matched.
12. **Cleanup successful** (PASS). `logs/test_datecheck/` directory removed after test.

**Notes:**
- The `savePosts()` function (src/services/storage.ts:11-47) computes `const today = new Date().toISOString().split('T')[0]` at line 12, which always produces the current UTC date regardless of post creation times. This is the correct behavior: the filename reflects *when the data was collected*, not when the posts were created.
- The file path format is `logs/{subreddit}/{YYYY-MM-DD}.json` where the date is the collection date.
- No code fixes were needed; the implementation matched the specification.

---

# Final Summary

**Completed:** 2026-03-23T15:30:00Z
**Total Test Cases:** 33
**Passed:** 32
**Skipped:** 1 (TC-003 — user testing manually)
**Known Issues:** 0
**Total Fix Attempts:** 0

## Results

| TC     | Name                                        | Priority | Result  | Fix Attempts |
| ------ | ------------------------------------------- | -------- | ------- | ------------ |
| TC-001 | Config — Valid config loads                  | Critical | PASS    | 0            |
| TC-002 | Config — Invalid config fails fast           | Critical | PASS    | 0            |
| TC-003 | Config — Env var validation                  | Critical | SKIPPED | 0            |
| TC-004 | OAuth — Authorization redirect               | Critical | PASS    | 0            |
| TC-005 | OAuth — Successful callback                  | Critical | PASS    | 0            |
| TC-006 | OAuth — Invalid/expired state                | High     | PASS    | 0            |
| TC-007 | OAuth — State pruning                        | Medium   | PASS    | 0            |
| TC-008 | OAuth — Token refresh utility                | Critical | PASS    | 0            |
| TC-009 | Collect — Happy path single subreddit        | Critical | PASS    | 0            |
| TC-010 | Collect — Subreddit validation               | Critical | PASS    | 0            |
| TC-011 | Collect — Hours param validation             | High     | PASS    | 0            |
| TC-012 | Collect All — Partial failure                | Critical | PASS    | 0            |
| TC-013 | Collect All — All subreddits fail            | High     | PASS    | 0            |
| TC-014 | List Logs — All logs                         | High     | PASS    | 0            |
| TC-015 | List Logs — Filter by subreddit              | Medium   | PASS    | 0            |
| TC-016 | Read Log — Happy path                        | High     | PASS    | 0            |
| TC-017 | Read Log — Input validation                  | Critical | PASS    | 0            |
| TC-018 | Filtering — OR logic thresholds              | Critical | PASS    | 0            |
| TC-019 | Filtering — Per-subreddit overrides          | High     | PASS    | 0            |
| TC-020 | Storage — Directory/file creation            | High     | PASS    | 0            |
| TC-021 | Storage — Merge/deduplication                | Critical | PASS    | 0            |
| TC-022 | Reddit API — Pagination                      | High     | PASS    | 0            |
| TC-023 | Reddit API — Pagination cap                  | High     | PASS    | 0            |
| TC-024 | Reddit API — Comments fetching               | High     | PASS    | 0            |
| TC-025 | Reddit API — Rate limit handling             | High     | PASS    | 0            |
| TC-026 | Error — Missing refresh token (401)          | High     | PASS    | 0            |
| TC-027 | Error — Reddit 404                           | High     | PASS    | 0            |
| TC-028 | Error — Reddit 403                           | Medium   | PASS    | 0            |
| TC-029 | Error — Reddit 429                           | Medium   | PASS    | 0            |
| TC-030 | Error — Reddit 5xx with retry                | High     | PASS    | 0            |
| TC-031 | Frontend — OAuth setup page                  | Medium   | PASS    | 0            |
| TC-032 | Reddit API — User-Agent header               | Medium   | PASS    | 0            |
| TC-033 | Storage — Collection date naming             | Medium   | PASS    | 0            |

## Known Issues Detail

None. All automated test cases passed on the first attempt with zero code fixes required.

## Recommendations

1. **TC-003 (Env var validation):** User opted to test manually — ensure all 6 scenarios are verified before shipping.
2. **Integration testing with real Reddit API:** All tests used mocked Reddit responses. Consider a manual smoke test against the real Reddit API with valid OAuth credentials to verify end-to-end connectivity.
3. **Edge cases:** The pagination cap (TC-023) and rate limit handling (TC-025/TC-029) were tested with mocks. Monitor behavior in production with real Reddit rate limits.

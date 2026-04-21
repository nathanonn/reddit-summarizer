# Reddit Summarizer

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-4.21-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An Express/TypeScript server that automatically collects and filters Reddit posts from your favorite subreddits based on engagement thresholds (upvotes and comment counts). Stay on top of high-signal content without manually scrolling through feeds.

## Features

- **Engagement-based filtering** — Only keeps posts that meet your upvote score or comment count thresholds (OR logic)
- **Multi-subreddit support** — Monitor up to 10 subreddits with per-subreddit threshold overrides
- **Top comment extraction** — Fetches the top N comments for each qualifying post
- **Structured JSON logs** — Saves results organized by subreddit and date (`logs/{subreddit}/{YYYY-MM-DD}.json`)
- **Reddit OAuth 2.0** — Built-in OAuth flow with CSRF protection for secure authentication
- **Rate limit awareness** — Tracks Reddit API rate limits and pauses automatically when approaching limits
- **Deduplication** — Merges new data with existing logs, keeping the highest scores

## Prerequisites

- **Node.js** >= 18
- **npm**
- A **Reddit account** and a [registered Reddit app](https://www.reddit.com/prefs/apps) (select "web app" type)

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/nathanonn/reddit-summarizer.git
cd reddit-summarizer
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example file and fill in your Reddit app credentials:

```bash
cp .env.example .env
```

```env
REDDIT_CLIENT_ID=your_client_id_here
REDDIT_CLIENT_SECRET=your_client_secret_here
REDDIT_REDIRECT_URI=http://localhost:5566/auth/reddit/callback
REDDIT_USERNAME=your_reddit_username
REDDIT_REFRESH_TOKEN=
PORT=5566
```

| Variable                       | Required | Description                                               |
| ------------------------------ | -------- | --------------------------------------------------------- |
| `REDDIT_CLIENT_ID`             | Yes      | From your Reddit app's settings page                      |
| `REDDIT_CLIENT_SECRET`         | Yes      | From your Reddit app's settings page                      |
| `REDDIT_REDIRECT_URI`          | Yes      | Must match the redirect URI registered in your Reddit app |
| `REDDIT_USERNAME`              | Yes      | Your Reddit username (used in the User-Agent header)      |
| `REDDIT_REFRESH_TOKEN`         | No\*     | Obtained after completing the OAuth flow (see below)      |
| `PORT`                         | No       | Server port (defaults to `5566`)                          |
| `REDDIT_SUBREDDITS`            | No       | JSON array of subreddit configs (overrides config.json)   |
| `REDDIT_DEFAULT_MIN_SCORE`     | No       | Override default minimum upvote score                     |
| `REDDIT_DEFAULT_MIN_COMMENTS`  | No       | Override default minimum comment count                    |
| `REDDIT_DEFAULT_HOURS_BACK`    | No       | Override default hours to look back (1-168)               |
| `REDDIT_DEFAULT_COMMENTS_PER_POST` | No   | Override default number of top comments per post          |

> \* The refresh token is required for data collection but is obtained through the app itself.

### 4. Configure subreddits

Edit `config.json` to specify which subreddits to monitor and their filtering thresholds:

```json
{
    "subreddits": [
        {
            "name": "typescript",
            "minScore": 10,
            "minComments": 5
        },
        {
            "name": "node",
            "minScore": 20
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

| Field                      | Description                                                  |
| -------------------------- | ------------------------------------------------------------ |
| `subreddits[].name`        | Subreddit name (1-21 alphanumeric characters or underscores) |
| `subreddits[].minScore`    | Minimum upvote score (overrides default)                     |
| `subreddits[].minComments` | Minimum comment count (overrides default)                    |
| `defaults.minScore`        | Default minimum upvote score                                 |
| `defaults.minComments`     | Default minimum comment count                                |
| `defaults.hoursBack`       | How far back to fetch posts in hours (1-168)                 |
| `defaults.commentsPerPost` | Number of top comments to fetch per post                     |

A post passes the filter if it meets **either** the score threshold **or** the comment count threshold.

#### Environment variable overrides

All configuration values can be overridden via environment variables. The priority order is:

1. **Environment variables** (highest)
2. **config.json**
3. **Built-in defaults**

If `REDDIT_SUBREDDITS` is set, `config.json` is entirely optional. Set it to a JSON array:

```bash
REDDIT_SUBREDDITS='[{"name":"typescript","minScore":10,"minComments":5},{"name":"node","minScore":20}]'
```

Override default thresholds individually:

```bash
REDDIT_DEFAULT_MIN_SCORE=20
REDDIT_DEFAULT_MIN_COMMENTS=10
REDDIT_DEFAULT_HOURS_BACK=48
REDDIT_DEFAULT_COMMENTS_PER_POST=5
```

### 5. Start the server

```bash
npm run dev
```

### 6. Complete the OAuth flow

1. Open `http://localhost:5566` in your browser
2. Click **"Connect to Reddit"**
3. Authorize the app on Reddit
4. Copy the refresh token from the success page
5. Add it to your `.env` file as `REDDIT_REFRESH_TOKEN=<your_token>`
6. Restart the server

## API Endpoints

### Authentication

| Method | Endpoint                | Description                        |
| ------ | ----------------------- | ---------------------------------- |
| `GET`  | `/auth/reddit`          | Starts the Reddit OAuth flow       |
| `GET`  | `/auth/reddit/callback` | OAuth callback handler (automatic) |

### Data Collection

#### `POST /api/collect`

Collect and filter posts from a single subreddit.

**Request body:**

```json
{
    "subreddit": "typescript",
    "hours": 24,
    "output": "both"
}
```

| Field       | Type   | Required | Description                                                         |
| ----------- | ------ | -------- | ------------------------------------------------------------------- |
| `subreddit` | string | Yes      | Subreddit to collect from                                           |
| `hours`     | number | No       | Hours to look back (1-168, default: 24)                             |
| `output`    | string | No       | `"log"` (default), `"response"`, or `"both"` — controls output mode |

**Output modes:**

| Mode       | Saves to disk | Returns posts in response |
| ---------- | ------------- | ------------------------- |
| `log`      | Yes           | No                        |
| `response` | No            | Yes                       |
| `both`     | Yes           | Yes                       |

**Response (`output: "log"`):**

```json
{
    "subreddit": "typescript",
    "postsCollected": 150,
    "postsFiltered": 12,
    "timeRange": {
        "from": "2026-03-22T12:00:00.000Z",
        "to": "2026-03-23T12:00:00.000Z"
    },
    "filePath": "logs/typescript/2026-03-23.json"
}
```

**Response (`output: "both"`):**

```json
{
    "subreddit": "typescript",
    "postsCollected": 150,
    "postsFiltered": 12,
    "timeRange": {
        "from": "2026-03-22T12:00:00.000Z",
        "to": "2026-03-23T12:00:00.000Z"
    },
    "filePath": "logs/typescript/2026-03-23.json",
    "posts": [
        {
            "id": "abc123",
            "title": "Post title",
            "score": 42,
            "comments": []
        }
    ]
}
```

#### `POST /api/collect-all`

Collect and filter posts from **all** configured subreddits.

**Request body:**

```json
{
    "hours": 48,
    "output": "log"
}
```

| Field    | Type   | Required | Description                                                         |
| -------- | ------ | -------- | ------------------------------------------------------------------- |
| `hours`  | number | No       | Hours to look back (1-168, default: 24)                             |
| `output` | string | No       | `"log"` (default), `"response"`, or `"both"` — controls output mode |

**Response:** Array of per-subreddit results (same shape as `/api/collect`, plus a `status` field of `"ok"` or `"error"`). When `output` is `"response"` or `"both"`, each entry includes a `posts` array.

### Logs

#### `GET /api/logs`

List all available log files. Optionally filter by subreddit:

```
GET /api/logs?subreddit=typescript
```

#### `GET /api/logs/:subreddit/:date`

Read a specific log file:

```
GET /api/logs/typescript/2026-03-23
```

Returns an array of posts with their comments.

### Health

#### `GET /api/health`

End-to-end connectivity check: refreshes the access token and calls Reddit's `/api/v1/me`. Use this before scraping to verify credentials and API reachability.

Returns `200` on success, `503` on failure.

```json
{
    "ok": true,
    "checks": {
        "refreshToken": "ok",
        "identity": { "ok": true, "username": "u/yourname" }
    },
    "rateLimit": {
        "remaining": 996,
        "resetSeconds": 540,
        "resetAt": "2026-04-21T12:34:56.000Z"
    }
}
```

## Project Structure

```
reddit-summarizer/
├── src/
│   ├── index.ts              # Express app entry point
│   ├── config.ts             # Config & env validation
│   ├── types.ts              # TypeScript interfaces
│   ├── routes/
│   │   ├── auth.ts           # OAuth routes
│   │   └── api.ts            # Collection & log API routes
│   ├── services/
│   │   ├── reddit.ts         # Reddit API client
│   │   └── storage.ts        # JSON file I/O & merge logic
│   └── utils/
│       └── rateLimit.ts      # Rate limit tracking
├── public/
│   └── index.html            # OAuth setup page
├── logs/                     # Collected data (gitignored)
├── config.json               # Subreddit configuration
├── .env.example              # Environment variable template
├── tsconfig.json             # TypeScript config
└── package.json              # Dependencies & scripts
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

## License

This project is licensed under the [MIT License](LICENSE).

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

| Variable               | Required | Description                                               |
| ---------------------- | -------- | --------------------------------------------------------- |
| `REDDIT_CLIENT_ID`     | Yes      | From your Reddit app's settings page                      |
| `REDDIT_CLIENT_SECRET` | Yes      | From your Reddit app's settings page                      |
| `REDDIT_REDIRECT_URI`  | Yes      | Must match the redirect URI registered in your Reddit app |
| `REDDIT_USERNAME`      | Yes      | Your Reddit username (used in the User-Agent header)      |
| `REDDIT_REFRESH_TOKEN` | No\*     | Obtained after completing the OAuth flow (see below)      |
| `PORT`                 | No       | Server port (defaults to `5566`)                          |

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
    "hours": 24
}
```

| Field       | Type   | Required | Description                             |
| ----------- | ------ | -------- | --------------------------------------- |
| `subreddit` | string | Yes      | Subreddit to collect from               |
| `hours`     | number | No       | Hours to look back (1-168, default: 24) |

**Response:**

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

#### `POST /api/collect-all`

Collect and filter posts from **all** configured subreddits.

**Request body:**

```json
{
    "hours": 48
}
```

**Response:** Array of per-subreddit results (same shape as `/api/collect`, plus a `status` field of `"ok"` or `"error"`).

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

### Status

#### `GET /api/status`

Check whether a refresh token is configured:

```json
{
    "connected": true
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

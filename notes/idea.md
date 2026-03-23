I follow many subreddit threads, but finding relevant information is challenging—each day brings a lot of noise. I want to build an Express server that filters relevant information from subreddit threads and provides concise summaries. This way, I can stay updated without manually sifting through posts and comments. If I want to dive deeper into a topic, I can still click on the original thread.

The server will use the Reddit API to fetch posts and comments from specific subreddits within a time range (default: 24 hours), then save the data as JSON files in the project directory. JSON files will be organized in folders named after the subreddit and collection date. For example:

```
logs/
  ├── subreddit1/
  │   ├── 2024-06-01.json
  │   └── 2024-06-02.json
  └── subreddit2/
      ├── 2024-06-01.json
      └── 2024-06-02.json
```

Note: This project won't use a database—just simple JSON files to store data.

Reddit changed its API access rules. You now need OAuth 2.0 to access the Reddit API, and you can only make a limited number of requests per minute.

Here's how it works now:

```
The app
  ↓
Send user to Reddit authorization page
  ↓
User logs in + approves requested scopes
  ↓
Reddit redirects back to your redirect URI
  ↓
the backend receives: code + state
  ↓
the backend exchanges code for access_token
  ↓
the app calls Reddit API with Authorization: Bearer <token>
```

The authorization request includes several important parameters:

- `client_id`
- `response_type=code`
- `state`—anti-CSRF value; you must verify it on return
- `redirect_uri`—must match exactly what you registered
- `duration`—`permanent` (to get a refresh token)
- `scope`—Reddit permissions you want, such as read, identity, messages, mod actions, etc. Reddit's docs note a quirk: their scope list is **comma-separated**, a slight deviation from standard OAuth expectations.

After the user approves, Reddit redirects back to the app with a **one-time code**. The backend then POSTs that code to Reddit's token endpoint with:

- `grant_type=authorization_code`
- `code=<returned code>`
- `redirect_uri="same exact redirect URI"`, and sends the client credentials using **HTTP Basic Auth**. If successful, Reddit returns JSON with `access_token`, `token_type`, `expires_in`, `scope`, and optionally `refresh_token`. The code is **single-use**.

Once we have the token, we use it against Reddit's **OAuth API host**, not the regular site host. Reddit's docs explicitly say OAuth bearer-token requests should go to **`oauth.reddit.com`**, and you send the token as an `Authorization: bearer ...` header.

When the access token expires, we can refresh it by POSTing to the token endpoint with:

- `grant_type=refresh_token`
- `refresh_token="saved refresh token"`. This only works if you originally requested **permanent** access.

This means we'll need to implement a simple frontend to retrieve the refresh token and store it in a .env file for future use. This way, we can automate the data fetching process without going through the authorization flow every time.

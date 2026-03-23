import { Router } from 'express';
import crypto from 'crypto';
import axios from 'axios';

const router = Router();

// State map for CSRF protection: state string -> creation timestamp
const stateMap = new Map<string, number>();

// Export for testing if needed
export { stateMap };

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

// Prune stale state entries
function pruneStaleStates(): void {
  const now = Date.now();
  for (const [state, timestamp] of stateMap) {
    if (now - timestamp > STATE_MAX_AGE_MS) {
      stateMap.delete(state);
    }
  }
}

// GET /reddit - Start OAuth flow
router.get('/reddit', (_req, res) => {
  pruneStaleStates();

  const state = crypto.randomBytes(16).toString('hex');
  stateMap.set(state, Date.now());

  const params = new URLSearchParams({
    client_id: process.env.REDDIT_CLIENT_ID!,
    response_type: 'code',
    state,
    redirect_uri: process.env.REDDIT_REDIRECT_URI!,
    duration: 'permanent',
    scope: 'read',
  });

  res.redirect(302, `https://www.reddit.com/api/v1/authorize?${params.toString()}`);
});

// GET /reddit/callback - Handle OAuth callback
router.get('/reddit/callback', async (req, res) => {
  const { state, code } = req.query;

  // Validate state
  if (!state || typeof state !== 'string') {
    res.status(403).json({ error: 'Missing state parameter' });
    return;
  }

  const stateTimestamp = stateMap.get(state);
  if (stateTimestamp === undefined) {
    res.status(403).json({ error: 'Invalid state parameter' });
    return;
  }

  if (Date.now() - stateTimestamp > STATE_MAX_AGE_MS) {
    stateMap.delete(state);
    res.status(403).json({ error: 'State parameter expired' });
    return;
  }

  // Delete state entry (one-time use)
  stateMap.delete(state);

  try {
    // Exchange code for tokens
    const tokenResponse = await axios.post(
      'https://www.reddit.com/api/v1/access_token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: process.env.REDDIT_REDIRECT_URI!,
      }).toString(),
      {
        auth: {
          username: process.env.REDDIT_CLIENT_ID!,
          password: process.env.REDDIT_CLIENT_SECRET!,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { refresh_token } = tokenResponse.data;

    // Render success page with refresh token
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reddit Summarizer - Connected</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 50px auto; padding: 0 20px; background: #f5f5f5; }
    .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { color: #333; }
    .success { color: #28a745; font-weight: bold; }
    .token-box { background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 4px; padding: 12px; margin: 15px 0; word-break: break-all; font-family: monospace; font-size: 14px; position: relative; }
    .copy-btn { background: #007bff; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-top: 10px; }
    .copy-btn:hover { background: #0056b3; }
    .instructions { background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; padding: 12px; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Reddit Summarizer</h1>
    <p class="success">Successfully connected to Reddit!</p>
    <p>Your refresh token:</p>
    <div class="token-box" id="token">${refresh_token}</div>
    <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('token').textContent).then(() => this.textContent = 'Copied!')">Copy Token</button>
    <div class="instructions">
      <strong>Next steps:</strong><br>
      Add this to your <code>.env</code> file as:<br>
      <code>REDDIT_REFRESH_TOKEN=${refresh_token}</code><br>
      Then restart the server.
    </div>
  </div>
</body>
</html>`);
  } catch (error) {
    res.status(500).json({ error: 'Failed to exchange authorization code for tokens' });
  }
});

export default router;

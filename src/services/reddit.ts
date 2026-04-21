import axios, { AxiosInstance } from "axios";
import { TokenData, Post, Comment } from "../types";
import { updateRateLimit, checkRateLimit } from "../utils/rateLimit";

// Cached token
let cachedToken: TokenData | null = null;

// Create axios instance with User-Agent
function createRedditAxios(): AxiosInstance {
    return axios.create({
        headers: {
            "User-Agent": `reddit-summarizer/1.0 by ${process.env.REDDIT_USERNAME}`,
        },
    });
}

const redditAxios = createRedditAxios();

// Custom error class for Reddit API errors
export class RedditApiError extends Error {
    statusCode: number;

    constructor(statusCode: number, message: string) {
        super(message);
        this.name = "RedditApiError";
        this.statusCode = statusCode;
    }
}

/**
 * Ensures a valid access token is available.
 * Throws if REDDIT_REFRESH_TOKEN is not set.
 * Returns the cached token if still valid, otherwise refreshes.
 */
export async function ensureAccessToken(): Promise<string> {
    if (!process.env.REDDIT_REFRESH_TOKEN) {
        throw new RedditApiError(401, "Reddit refresh token not configured. Complete OAuth setup first.");
    }

    // Check if cached token is still valid (with 60s buffer)
    if (cachedToken && Date.now() < cachedToken.expiresAt - 60 * 1000) {
        return cachedToken.accessToken;
    }

    // Refresh the token
    let response;
    try {
        response = await axios.post(
            "https://www.reddit.com/api/v1/access_token",
            new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: process.env.REDDIT_REFRESH_TOKEN,
            }).toString(),
            {
                auth: {
                    username: process.env.REDDIT_CLIENT_ID!,
                    password: process.env.REDDIT_CLIENT_SECRET!,
                },
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": `reddit-summarizer/1.0 by ${process.env.REDDIT_USERNAME}`,
                },
            },
        );
    } catch (err: any) {
        if (err.response) {
            const status = err.response.status;
            if (status === 401 || status === 403) {
                throw new RedditApiError(401, "Reddit refresh token is invalid or revoked. Re-run OAuth setup.");
            }
            throw new RedditApiError(status, `Failed to refresh Reddit access token: ${status}`);
        }
        throw new RedditApiError(502, "Reddit token endpoint unreachable");
    }

    cachedToken = {
        accessToken: response.data.access_token,
        expiresAt: Date.now() + response.data.expires_in * 1000,
    };

    return cachedToken.accessToken;
}

// Export the axios instance for use by other functions in this file
export { redditAxios };

// Export a function to clear the cached token (useful for testing)
export function clearCachedToken(): void {
    cachedToken = null;
}

export interface RedditIdentity {
    username: string;
}

/**
 * Fetch the authenticated user's identity from Reddit.
 * Used as a lightweight end-to-end connectivity check.
 */
export async function fetchIdentity(): Promise<RedditIdentity> {
    const token = await ensureAccessToken();

    let response;
    try {
        response = await redditAxios.get("https://oauth.reddit.com/api/v1/me", {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
    } catch (err: any) {
        if (err.response) {
            console.error("Reddit /api/v1/me error:", err.response);
            const status = err.response.status;
            if (status === 401 || status === 403) {
                throw new RedditApiError(401, "Reddit access token rejected by /api/v1/me. Re-run OAuth setup.");
            }
            throw new RedditApiError(status, `Reddit API error: ${status}`);
        }
        throw new RedditApiError(502, "Reddit API unreachable");
    }

    updateRateLimit(response.headers);

    const name = response.data?.name;
    if (!name) {
        throw new RedditApiError(502, "Reddit /api/v1/me returned no username");
    }

    return { username: `u/${name}` };
}

/**
 * Fetch recent posts from a subreddit within the given time window.
 * Paginates up to 10 pages and stops when posts fall outside the time range.
 */
export async function fetchPosts(subreddit: string, hoursBack: number): Promise<Post[]> {
    const token = await ensureAccessToken();
    const cutoff = Date.now() - hoursBack * 3600 * 1000;
    const posts: Post[] = [];
    let after: string | null = null;
    const maxPages = 10;

    for (let page = 0; page < maxPages; page++) {
        let response;
        try {
            const params: Record<string, string> = { limit: "100" };
            if (after) {
                params.after = after;
            }

            response = await redditAxios.get(`https://oauth.reddit.com/r/${subreddit}/new`, {
                params,
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
        } catch (err: any) {
            if (err.response) {
                const status = err.response.status;
                if (status === 404) {
                    throw new RedditApiError(404, "Subreddit not found");
                }
                if (status === 403) {
                    throw new RedditApiError(403, "Subreddit is private or banned");
                }
                if (status >= 500) {
                    // Retry once after 2s for server errors
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                    try {
                        const params: Record<string, string> = { limit: "100" };
                        if (after) {
                            params.after = after;
                        }
                        response = await redditAxios.get(`https://oauth.reddit.com/r/${subreddit}/new`, {
                            params,
                            headers: {
                                Authorization: `Bearer ${token}`,
                            },
                        });
                    } catch (retryErr: any) {
                        throw new RedditApiError(502, "Reddit API unavailable");
                    }
                } else {
                    throw new RedditApiError(status, `Reddit API error: ${status}`);
                }
            } else {
                throw err;
            }
        }

        updateRateLimit(response!.headers);
        await checkRateLimit();

        const children = response!.data.data.children;
        let reachedCutoff = false;

        for (const child of children) {
            const data = child.data;
            const createdMs = data.created_utc * 1000;

            if (createdMs < cutoff) {
                reachedCutoff = true;
                break;
            }

            posts.push({
                id: data.id,
                title: data.title,
                author: `u/${data.author}`,
                score: data.score,
                numComments: data.num_comments,
                url: `https://reddit.com${data.permalink}`,
                selfText: data.selftext || "",
                createdUtc: new Date(data.created_utc * 1000).toISOString(),
                flair: data.link_flair_text || null,
                comments: [],
            });
        }

        if (reachedCutoff) {
            break;
        }

        after = response!.data.data.after;
        if (!after) {
            break;
        }

        if (page === maxPages - 1) {
            console.warn(`[fetchPosts] Reached page cap (${maxPages}) for r/${subreddit}. Some posts may be missing.`);
        }
    }

    return posts;
}

/**
 * Fetch top comments for a given post.
 * Returns only top-level comments, capped at `limit`.
 */
export async function fetchComments(postId: string, limit: number = 10): Promise<Comment[]> {
    const token = await ensureAccessToken();

    let response;
    try {
        response = await redditAxios.get(`https://oauth.reddit.com/comments/${postId}`, {
            params: {
                sort: "top",
                limit: String(limit),
            },
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
    } catch (err: any) {
        if (err.response) {
            const status = err.response.status;
            if (status === 404) {
                throw new RedditApiError(404, "Post not found");
            }
            if (status >= 500) {
                // Retry once after 2s for server errors
                await new Promise((resolve) => setTimeout(resolve, 2000));
                try {
                    response = await redditAxios.get(`https://oauth.reddit.com/comments/${postId}`, {
                        params: {
                            sort: "top",
                            limit: String(limit),
                        },
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    });
                } catch (retryErr: any) {
                    throw new RedditApiError(502, "Reddit API unavailable");
                }
            } else {
                throw new RedditApiError(status, `Reddit API error: ${status}`);
            }
        } else {
            throw err;
        }
    }

    updateRateLimit(response!.headers);
    await checkRateLimit();

    // The response is an array of listings; the second one contains comments
    const commentListing = response!.data[1];
    const children = commentListing?.data?.children || [];

    const comments: Comment[] = [];
    for (const child of children) {
        if (child.kind !== "t1") {
            continue;
        }
        const data = child.data;
        if (data.depth !== undefined && data.depth !== 0) {
            continue;
        }

        comments.push({
            id: data.id,
            author: `u/${data.author}`,
            body: data.body,
            score: data.score,
            createdUtc: new Date(data.created_utc * 1000).toISOString(),
        });

        if (comments.length >= limit) {
            break;
        }
    }

    return comments;
}

/**
 * Filter posts using OR logic: include if score >= minScore OR numComments >= minComments.
 */
export function filterPosts(posts: Post[], minScore: number, minComments: number): Post[] {
    return posts.filter((post) => post.score >= minScore || post.numComments >= minComments);
}

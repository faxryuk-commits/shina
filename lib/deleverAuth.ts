/**
 * OAuth 2.0 client_credentials helper for Delever API V2.
 * Caches the access token in module scope until it expires.
 *
 * Reference: https://delever.gitbook.io/delever/for-developers/dlya-integratorov-v2
 */

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Environment variable ${name} is required when USE_MOCKS=false. ` +
        `Set it in Vercel → Settings → Environment Variables.`
    );
  }
  return value;
}

interface OAuthTokenResponse {
  accessToken?: string;
  access_token?: string;
  expiresIn?: number;
  expires_in?: number;
  token_type?: string;
}

/**
 * Returns a valid Bearer access token, refreshing it if needed.
 * Subsequent calls within the token lifetime reuse the cache.
 */
export async function getDeleverAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.accessToken;
  }

  const baseUrl = readEnv("DELEVER_BASE_URL").replace(/\/$/, "");
  const clientId = readEnv("DELEVER_CLIENT_ID");
  const clientSecret = readEnv("DELEVER_CLIENT_SECRET");
  const oauthPath = process.env.DELEVER_OAUTH_PATH || "/security/oauth/token";

  const url = `${baseUrl}${oauthPath}`;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({ grant_type: "client_credentials" });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Delever OAuth failed: ${response.status} ${response.statusText} — ${text}`
    );
  }

  const json = (await response.json()) as OAuthTokenResponse;
  const accessToken = json.accessToken || json.access_token;
  const expiresIn = json.expiresIn || json.expires_in || 3600;

  if (!accessToken) {
    throw new Error(
      `Delever OAuth response missing accessToken: ${JSON.stringify(json)}`
    );
  }

  cached = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return accessToken;
}

/** Test helper: drop the cached token so the next call re-authenticates. */
export function resetDeleverAuthCache(): void {
  cached = null;
}

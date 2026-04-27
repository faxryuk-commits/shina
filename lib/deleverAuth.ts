/**
 * OAuth helper for Delever Custom Integration API V2.
 *
 * Spec is non-standard: credentials go in the form body (NOT a Basic auth
 * header), and `client_secret` is itself a base64(username:password) string.
 * Reference (POST /v1/custom-integration/security/oauth/token):
 *   https://delever.gitbook.io/delever/for-developers/dlya-integratorov-v2
 *
 * Caches the access token in module scope until it expires. The cache is
 * conservative: we refresh 30 seconds before the advertised TTL, and if the
 * server doesn't return `expiresIn` we assume 1 hour.
 */

import { logEvent } from "./eventLog";

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

const DEFAULT_OAUTH_PATH = "/v1/custom-integration/security/oauth/token";
const DEFAULT_GRANT_TYPE = "client_credentials";
const DEFAULT_TTL_SECONDS = 3600;

export async function getDeleverAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.accessToken;
  }

  const baseUrl = readEnv("DELEVER_BASE_URL").replace(/\/$/, "");
  const clientId = readEnv("DELEVER_CLIENT_ID");
  const clientSecret = readEnv("DELEVER_CLIENT_SECRET");
  const grantType = process.env.DELEVER_GRANT_TYPE || DEFAULT_GRANT_TYPE;
  const scope = process.env.DELEVER_SCOPE;
  const oauthPath = process.env.DELEVER_OAUTH_PATH || DEFAULT_OAUTH_PATH;

  const url = `${baseUrl}${oauthPath}`;

  const params = new URLSearchParams();
  params.set("client_id", clientId);
  params.set("client_secret", clientSecret);
  params.set("grant_type", grantType);
  if (scope) params.set("scope", scope);

  // What we'll show in the dashboard's "Request" pane. We MUST mask secrets.
  const requestPreview = {
    client_id_preview: previewToken(clientId),
    client_secret_preview: previewToken(clientSecret),
    grant_type: grantType,
    ...(scope ? { scope } : {}),
  };

  const start = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
    });
  } catch (err) {
    logEvent({
      kind: "oauth",
      label: oauthPath,
      method: "POST",
      ok: false,
      latencyMs: Date.now() - start,
      request: requestPreview,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const latencyMs = Date.now() - start;
  const rawText = await response.text().catch(() => "");
  let parsed: unknown;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = rawText;
  }

  if (!response.ok) {
    logEvent({
      kind: "oauth",
      label: oauthPath,
      method: "POST",
      status: response.status,
      ok: false,
      latencyMs,
      request: requestPreview,
      response: parsed,
      error: `${response.status} ${response.statusText}`,
    });
    throw new Error(
      `Delever OAuth failed: ${response.status} ${response.statusText} — ${rawText}`
    );
  }

  const json = (parsed || {}) as OAuthTokenResponse;
  const accessToken = json.accessToken || json.access_token;
  const expiresIn = json.expiresIn || json.expires_in || DEFAULT_TTL_SECONDS;

  if (!accessToken) {
    logEvent({
      kind: "oauth",
      label: oauthPath,
      method: "POST",
      status: response.status,
      ok: false,
      latencyMs,
      request: requestPreview,
      response: parsed,
      error: "missing accessToken",
    });
    throw new Error(
      `Delever OAuth response missing accessToken: ${JSON.stringify(json)}`
    );
  }

  cached = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  logEvent({
    kind: "oauth",
    label: oauthPath,
    method: "POST",
    status: response.status,
    ok: true,
    latencyMs,
    request: requestPreview,
    response: {
      token_type: json.token_type || "Bearer",
      expires_in: expiresIn,
      access_token_preview: previewToken(accessToken),
    },
  });

  return accessToken;
}

/** Test helper: drop the cached token so the next call re-authenticates. */
export function resetDeleverAuthCache(): void {
  cached = null;
}

function previewToken(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}

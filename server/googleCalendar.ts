import { google } from "googleapis";

// Google Calendar auth. Two paths, checked in this order:
//
//  1. OAuth refresh token via plain env vars (Railway-native, the production
//     path). Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and
//     GOOGLE_OAUTH_REFRESH_TOKEN (the refresh token belongs to the Google
//     account that owns the booking calendar, e.g. support@clvrquantai.com).
//     The googleapis OAuth2 client auto-mints + refreshes access tokens, so
//     this works anywhere — no Replit infrastructure required.
//
//  2. Replit Google Calendar connector (dev convenience fallback). Tokens are
//     served by the Replit connector proxy. Only works on Replit infra.
//
// When neither is configured (or the call fails) this throws; callers (booking
// finalize) treat that as fail-open and proceed without a Meet link.

function hasOAuthEnvCreds(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
  );
}

// Build a Calendar client from the OAuth refresh token in the environment.
// The OAuth2 client refreshes the short-lived access token on demand, so the
// returned client is safe to use immediately on every call.
function getEnvOAuthCalendarClient() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
  oauth2.setCredentials({
    refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
  });
  return google.calendar({ version: "v3", auth: oauth2 });
}

// ── Replit connector fallback ───────────────────────────────────────────────
let cachedSettings: any = null;

async function getConnectorAccessToken(): Promise<string> {
  // Reuse a still-valid token to avoid hammering the proxy.
  if (
    cachedSettings?.settings?.expires_at &&
    new Date(cachedSettings.settings.expires_at).getTime() > Date.now() + 60_000
  ) {
    const tok =
      cachedSettings.settings.access_token ||
      cachedSettings.settings.oauth?.credentials?.access_token;
    if (tok) return tok;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error("Replit connector context unavailable (not on Replit infra)");
  }

  const resp = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=google-calendar`,
    { headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken } },
  );
  if (!resp.ok) {
    throw new Error(`connector proxy ${resp.status}`);
  }
  const data: any = await resp.json();
  cachedSettings = data?.items?.[0] || null;

  const accessToken =
    cachedSettings?.settings?.access_token ||
    cachedSettings?.settings?.oauth?.credentials?.access_token;

  if (!accessToken) {
    throw new Error("Google Calendar not connected");
  }
  return accessToken;
}

// Fresh authed Calendar client. Prefers the env OAuth refresh token (Railway),
// falls back to the Replit connector. Do NOT cache the returned client.
export async function getUncachableGoogleCalendarClient() {
  if (hasOAuthEnvCreds()) {
    return getEnvOAuthCalendarClient();
  }
  const accessToken = await getConnectorAccessToken();
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth: oauth2 });
}

// True when EITHER auth path looks wired (used for light logging/UX).
export function googleCalendarConfigured(): boolean {
  return Boolean(
    hasOAuthEnvCreds() ||
      (process.env.REPLIT_CONNECTORS_HOSTNAME &&
        (process.env.REPL_IDENTITY || process.env.WEB_REPL_RENEWAL)),
  );
}

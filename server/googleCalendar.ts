import { google } from "googleapis";

// Replit Google Calendar connector access. The connection is authorized via the
// Replit integrations OAuth flow (Google account = the calendar that owns the
// events). Tokens are served by the Replit connector proxy and refreshed there,
// so we NEVER cache the client — we fetch a fresh access token per call.
//
// When the connector is not connected (or the proxy is unreachable) this throws;
// callers (booking finalize) treat that as fail-open and proceed without a Meet
// link.

let cachedSettings: any = null;

async function getAccessToken(): Promise<string> {
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

// Fresh authed Calendar client. Do NOT cache the returned client — tokens
// expire and are re-minted by getAccessToken on the next call.
export async function getUncachableGoogleCalendarClient() {
  const accessToken = await getAccessToken();
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth: oauth2 });
}

// True only when a connection appears to be wired (used for light logging/UX).
export function googleCalendarConfigured(): boolean {
  return Boolean(
    process.env.REPLIT_CONNECTORS_HOSTNAME &&
      (process.env.REPL_IDENTITY || process.env.WEB_REPL_RENEWAL),
  );
}

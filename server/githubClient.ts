// Replit GitHub connector — fetches the OAuth access token from the Replit
// connector service and exposes a small helper for reading recent commits.
//
// This is the production-safe replacement for the local `git log` CLI used by
// the weekly-update digest. In a published deployment there is no .git
// directory and no git binary, so the local CLI returns nothing — which is
// why the AI digest reports "0 commits scanned" in prod.
//
// WARNING: Never cache the token. OAuth tokens can rotate. Always call
// getGitHubAccessToken() fresh on each operation, mirroring resendClient.ts.

async function getGitHubAccessToken(): Promise<string> {
  // Dev/local override: a plain GITHUB_TOKEN env var, if set, takes precedence
  // so contributors can develop without the Replit connector being live.
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  if (!hostname) {
    throw new Error("[github] REPLIT_CONNECTORS_HOSTNAME not set and GITHUB_TOKEN not set");
  }

  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? "depl " + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error("[github] X-Replit-Token not available (no REPL_IDENTITY or WEB_REPL_RENEWAL)");
  }

  const r = await fetch(
    "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=github",
    { headers: { Accept: "application/json", "X-Replit-Token": xReplitToken } }
  );
  if (!r.ok) {
    // Surface a clear reason instead of letting a non-JSON body crash JSON.parse.
    const body = await r.text().catch(() => "");
    throw new Error(`[github] connector lookup HTTP ${r.status}: ${body.slice(0, 200)}`);
  }
  const data: any = await r.json().catch(() => ({}));
  const item = data?.items?.[0];
  // Settings shape: { access_token, oauth: { credentials: { access_token } } }
  // We accept either, since the connector schema lists both for backward compat.
  const token: string | undefined =
    item?.settings?.access_token || item?.settings?.oauth?.credentials?.access_token;
  if (!token) {
    throw new Error("[github] connector returned no access_token — connection not authorized?");
  }
  return token;
}

export interface GitHubCommit {
  sha: string;
  message: string; // full message; first line is the subject
}

// Fetches recent commits from the default branch of the given repo via the
// GitHub REST API. Repo format: "owner/name" (e.g. "Airwolf416/CLVRQuantAi").
export async function getRecentCommitsViaApi(
  repo: string,
  days: number = 7,
  perPage: number = 100
): Promise<GitHubCommit[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const url = `https://api.github.com/repos/${repo}/commits?since=${encodeURIComponent(since)}&per_page=${perPage}`;
  const token = await getGitHubAccessToken();
  const r = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "CLVRQuantAI-WeeklyDigest",
    },
  });
  if (!r.ok) {
    // Common cases worth distinguishing in logs: 401 = expired token,
    // 403 = rate-limited or insufficient scope, 404 = wrong repo, 5xx = upstream.
    const reset = r.headers.get("x-ratelimit-reset");
    const hint = r.status === 403 && reset ? ` (rate-limit reset at ${reset})` : "";
    const body = await r.text().catch(() => "");
    throw new Error(`[github] commits API ${r.status}${hint}: ${body.slice(0, 200)}`);
  }
  const arr: any[] = await r.json().catch(() => []);
  if (!Array.isArray(arr)) return [];
  return arr.map((c) => ({ sha: c.sha, message: c.commit?.message || "" }));
}

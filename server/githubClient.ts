// GitHub commit sourcing for the weekly-update digest.
//
// In a published deployment there is no .git directory and no git binary, so
// the old `git log` CLI returns nothing. We read commits straight from the
// GitHub REST API (via @octokit/rest) instead, which works identically in dev
// and in production (Railway).
//
// Auth: a dedicated GITHUB_COMMITS_TOKEN (a classic or fine-grained PAT with
// read access to the repo). It must be set in BOTH Replit and Railway. When it
// is missing — or the API call fails — we log a LOUD warning and return [].
// We never fail silently, and we never depend on the Replit connector (which
// is unavailable on Railway).

import { Octokit } from "@octokit/rest";

export interface GitHubCommit {
  sha: string;
  message: string; // full message; first line is the subject
}

// Exact prefix the task spec requires for the loud "fallback unavailable" log.
const WARN_PREFIX = "[weeklyUpdate] commit fallback unavailable:";

// Fetches commits from `branch` of `repo` ("owner/name") created at/after
// `since`. Returns [] (with a loud warning) when the token is missing or the
// GitHub API fails — callers treat [] as "no commits", never as success.
export async function getCommitsViaOctokit(
  repo: string,
  since: Date,
  branch: string = "main",
  perPage: number = 100,
): Promise<GitHubCommit[]> {
  const token = process.env.GITHUB_COMMITS_TOKEN;
  if (!token) {
    console.warn(`${WARN_PREFIX} GITHUB_COMMITS_TOKEN not set (add it in Replit + Railway secrets)`);
    return [];
  }

  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    console.warn(`${WARN_PREFIX} invalid repo "${repo}" (expected "owner/name")`);
    return [];
  }

  try {
    const octokit = new Octokit({ auth: token, userAgent: "CLVRQuantAI-WeeklyDigest" });
    const res = await octokit.repos.listCommits({
      owner,
      repo: name,
      sha: branch,
      since: since.toISOString(),
      per_page: perPage,
    });
    return (res.data || []).map((c: any) => ({ sha: c.sha, message: c.commit?.message || "" }));
  } catch (e: any) {
    const status = e?.status ? `HTTP ${e.status} ` : "";
    console.warn(`${WARN_PREFIX} ${status}${e?.message || e}`);
    return [];
  }
}

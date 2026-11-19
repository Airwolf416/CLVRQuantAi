// GitHub commit sourcing for the weekly-update digest.
//
// In a published deployment there is no .git directory and no git binary, so
// the old `git log` CLI returns nothing. We read commits straight from the
// GitHub REST API (via @octokit/rest) instead, which works identically in dev
// and in production (Railway).
//
// Auth: a dedicated GITHUB_COMMITS_TOKEN (a classic or fine-grained PAT with
// read access to the repo). It must be set in BOTH Replit and Railway. Missing
// credentials and API failures throw classified errors, never "no changes".
// Production callers pin the serving image revision, not a moving branch.

import { Octokit } from "@octokit/rest";
import { DigestError } from "./lib/weeklyDigestPolicy";

export interface GitHubCommit {
  sha: string;
  message: string; // full message; first line is the subject
}
export async function getReleaseCommitEvidence(repo: string, since: Date, ref: string, baseSha?: string) {
  const token = process.env.GITHUB_COMMITS_TOKEN;
  if (!token) throw new DigestError("github", "GITHUB_COMMITS_TOKEN_MISSING");
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new DigestError("github", "INVALID_REPOSITORY");
  const api = new Octokit({ auth: token, userAgent: "CLVRQuantAI-WeeklyDigest", request: { timeout: 15_000 } });
  try {
    // Pin first, including in previews. Do not read a branch that can move
    // between pages, or report unshipped main-branch commits as live features.
    const head = await api.repos.getCommit({ owner, repo: name, ref });
    const headSha = head.data.sha;
    const commits: GitHubCommit[] = [];
    if (baseSha) {
      for (let page = 1; page <= 10; page++) {
        const result = await api.repos.compareCommitsWithBasehead({
          owner, repo: name, basehead: `${baseSha}...${headSha}`, per_page: 100, page,
        });
        if (["behind", "diverged"].includes(result.data.status)) throw new DigestError("github", "RELEASE_HISTORY_NOT_FORWARD");
        commits.push(...result.data.commits.map(c => ({ sha: c.sha, message: c.commit.message })));
        if (commits.length >= result.data.total_commits) return { headSha, commits: commits.reverse() };
      }
    } else {
      for (let page = 1; page <= 10; page++) {
        const result = await api.repos.listCommits({
          owner, repo: name, sha: headSha, since: since.toISOString(), per_page: 100, page,
        });
        commits.push(...result.data.map(c => ({ sha: c.sha, message: c.commit.message })));
        if (result.data.length < 100) return { headSha, commits };
      }
    }
    throw new DigestError("github", "COMMIT_WINDOW_TOO_LARGE");
  } catch (error: any) {
    if (error instanceof DigestError) throw error;
    throw new DigestError("github", `GITHUB_HTTP_${Number(error?.status) || 0}`);
  }
}

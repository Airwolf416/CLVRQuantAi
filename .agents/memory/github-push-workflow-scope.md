---
name: Pushing workflow files to GitHub
description: Why pushes that touch .github/workflows fail, and the PAT-based path that works.
---

# Pushing `.github/workflows/*` to GitHub

**Rule:** A git push whose diff touches any `.github/workflows/*` file requires a
credential with the `workflow` scope. The Replit GitHub connector token
(`listConnections('github')[0].settings.access_token`) does NOT have `workflow`
scope, so such a push is rejected with:
`refusing to allow an OAuth App to create or update workflow ... without workflow scope`.
The REST Contents API is blocked for workflow files the same way. Non-workflow
files push fine with the connector token.

**Solution:** Use a user-supplied GitHub PAT with `repo` + `workflow` scopes,
stored as the `GITHUB_PAT` secret. Drive it through a temp `GIT_ASKPASS` script
(echo `x-access-token` for the username prompt, `$GITHUB_PAT` otherwise).

**Why:** Recurring blocker — task agents merge workflow-file changes into local
main, but they can only reach GitHub through a workflow-capable credential.

**How to apply:**
- Run the push via the **bash tool**, not the `code_execution` sandbox — the
  sandbox env is stale and often does NOT contain `GITHUB_PAT`, while the project
  shell does (after the secret is added + a workflow restart).
- The main-agent environment blocks git ref-updating operations (an explicit
  `git fetch` / ref write fails with a `.lock` / "destructive git operations are
  not allowed" error). The `git push` itself still succeeds; only the local
  `origin/main` tracking ref may stay stale afterward. Verify success from the
  push output (`old..new main -> main`) and/or the GitHub Actions API, not from
  the local `origin/main` pointer.
- Pushing to `main` triggers prod deploy (Railway via GitHub Actions Build and
  Deploy) + the Tests workflow.

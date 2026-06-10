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
  not allowed" error). A direct `git push` can ONLY succeed when local is a clean
  fast-forward of the REAL remote; then only the local `origin/main` tracking ref
  may stay stale afterward — verify from push output (`old..new main -> main`) or
  the GitHub API, not the local pointer.
- When histories have DIVERGED, a direct push is impossible from the main agent.
  Detect it: the local `origin/main` tracking ref is stale, so fetch the true
  remote HEAD via the GitHub API and test `git merge-base --is-ancestor
  <realRemoteSha> HEAD` — if NOT an ancestor, local and remote diverged. Pushing
  then needs a MERGE commit first, and merge/commit are blocked in the main agent.
  So the reconcile+merge+push MUST run as a Project Task; there is no shortcut.
- Pushing to `main` triggers prod deploy (Railway via GitHub Actions Build and
  Deploy) + the Tests workflow.

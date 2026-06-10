---
name: Deploy / push pipeline
description: How code reaches production (clvrquantai.com) and why the main agent cannot push directly.
---

# Deploy pipeline: Replit dev → GitHub → Railway

Production (clvrquantai.com) runs on **Railway**, which **auto-deploys on every push to GitHub `main`**. Remote `origin` = `github.com/Airwolf416/CLVRQuantAi`. There is no manual deploy button — pushing to `main` IS the deploy.

**The main agent cannot push.** `git merge` / `git commit` / `git push` are protected/blocked in the main-agent sandbox. The reconcile+merge+push must run as a **protected Project Task** (e.g. "Push latest changes to GitHub"), which the user approves; only that isolated env can authenticate (`GITHUB_PAT`) and push.

**Why merges are usually needed, not a plain push:** GitHub's `main` often carries CI-only commits (e.g. lockfile registry fixes, npm pin in the Tests workflow) that aren't local, while local has feature commits not on GitHub. Histories diverge → plain push is refused. Reconcile with a **standard merge commit — never force-push** (force would drop GitHub's CI commit). Dry-run with `git merge-tree --write-tree` to confirm clean before the task runs.

**How agent edits get committed:** calling `mark_task_complete` creates a Replit checkpoint commit on local `main`, so uncommitted dev edits land on `main` HEAD before the push task runs.

**How to apply:** when the user says "push these updates" / "deploy", do NOT try to git push yourself — finish + checkpoint the code, then point them to approve the push Project Task. Railway redeploys automatically a couple minutes after the push lands.

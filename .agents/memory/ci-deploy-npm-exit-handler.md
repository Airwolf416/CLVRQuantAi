---
name: CI deploy npm exit-handler failure
description: Why the GHCR "Build and Deploy" Docker build kept failing at npm install, and the confirmed fix.
---

# "Build and Deploy" Docker build failing at `npm install`

**Symptom:** GitHub Actions "Build and Deploy" workflow (`.github/workflows/deploy.yml`)
fails in the `build-and-push` job at the `Build and push` step; deploy job is skipped.
The real Docker build only runs in GitHub Actions — a full `docker build` OOMs in the
Replit dev env, so it cannot be reproduced locally.

**Confirmed root cause (from real GHA logs):** the npm bundled with `node:22-bookworm`
(10.9.x) dies at the end of `npm install` with `npm error Exit handler never called!`
— a known npm-internal exit-handler bug. It is NOT an OOM (no kill/heap message in the
actual failure, despite the Dockerfile comment mentioning OOM as the original concern).

**Fix:** pin a newer npm before installing deps — `RUN npm install -g npm@11.16.0` in the
build stage of `Dockerfile`. 11.16.0 is a real published version (was npm `latest` as of
Jun 2026).

**Why:** the bug is intermittent and internal to npm 10.9.x; upgrading npm is the
documented remedy. A local successful install would not disprove it (intermittent), so
trust the version pin over trying to reproduce.

**How to verify pre-merge (cannot observe the green run from an isolated env):**
- Confirm the failing step's error is the exit-handler message in the latest GHA run.
- Confirm `npm run build` succeeds locally (the build step runs after install).
- Confirm deploy secrets `RAILWAY_TOKEN` + `RAILWAY_SERVICE_ID` exist on the repo.
- `docker build --check .` for Dockerfile structural validity (cheap; full build OOMs).
- The actual green confirmation only happens after the fix merges to `origin/main` and
  the workflow runs there.

**If the npm pin proves insufficient:** lockfile is clean (lockfileVersion 3) so
`npm install` → `npm ci` is a safe next iteration; or pin a different npm version.

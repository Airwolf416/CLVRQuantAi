---
name: Replit lockfile mirror URLs break external CI
description: package-lock.json generated in Replit bakes package-firewall.replit.local "resolved" URLs that fail (ENOTFOUND) on GitHub Actions / Docker builds.
---

# Replit's private npm mirror URLs leak into package-lock.json and break external CI

**Symptom:** After fixing the npm exit-handler bug (npm pin), the GHA "Build and Deploy"
Docker `npm install` still fails — but now with a NETWORK error:
`npm error code ENOTFOUND ... request to http://package-firewall.replit.local/npm/<pkg>.tgz failed`.

**Root cause:** `package-firewall.replit.local` is Replit's *internal* npm mirror. When a
lockfile is (re)generated inside Replit, a subset of `"resolved"` URLs get pinned to that
host instead of `registry.npmjs.org`. That host only resolves inside Replit, so any build
OUTSIDE Replit (GitHub Actions, Docker, Railway) can't reach it. Only some packages are
affected (the ones installed while the mirror was active) — the rest correctly use the
public registry, so it looks fine locally and the large majority of the lockfile is clean.

**Fix (safe, mechanical):** rewrite the host on the `"resolved"` lines —
`sed -i 's#http://package-firewall.replit.local/npm/#https://registry.npmjs.org/#g' package-lock.json`.
The `integrity` (sha512) hashes are content hashes of identical tarballs, so they stay
valid; only the download host changes. Verify: 0 mirror URLs remain and the JSON still parses.

**Also:** any GHA workflow that runs `npm ci` directly on the runner (e.g. test.yml) hits
the SAME npm 10.9.x "Exit handler never called" bug as the Docker build — the Dockerfile's
npm pin does NOT apply there. Pin npm in those workflows too (`npm install -g npm@11.16.0`
before `npm ci`).

**Why it matters:** a Replit-generated lockfile is not portable to external CI by default.
Any time deps change here and CI breaks on ENOTFOUND, grep the lockfile for
`package-firewall.replit.local` first.

**Confirmed:** after both fixes, all three workflows (Build and Deploy, Tests, Push on main)
went green.

---
name: Railway prod access
description: Why the Railway production DB can't be reached from the Replit dev workspace, and how to run prod-wide operations instead.
---

# Reaching Railway production from the Replit workspace

The `PROD_DATABASE_URL` secret holds an **unresolved Railway reference** — its host is the
literal string `${{RAILWAY_PRIVATE_DOMAIN}}` (Railway's internal-only private network domain).
It only resolves inside Railway's own network, so connecting to it from the Replit dev
workspace fails with `getaddrinfo ENOTFOUND ${{RAILWAY_PRIVATE_DOMAIN}}`.

**Why:** prod is deployed on Railway (domain clvrquantai.com), not Replit Deployments. The
dev app's `pool`/Drizzle connects to the dev `DATABASE_URL`, NOT to Railway prod.

**How to apply:**
- Do NOT assume `executeSql({environment:"production"})` (Replit managed replica) or
  `PROD_DATABASE_URL` reaches Railway — neither does from here.
- Anything that must touch the live user base (mass emails, prod counts, prod data writes)
  has to run **inside the Railway deployment**. The app already exposes owner-only
  (project-owner session) admin endpoints for the email blasts, surfaced as buttons
  on the Account → ⚡ Owner tab. Trigger those on the live site after deploying.
- If a direct connection from the workspace is truly needed, the user must supply Railway's
  **public** proxy connection string (DATABASE_PUBLIC_URL / *.proxy.rlwy.net), not the
  private-domain one.

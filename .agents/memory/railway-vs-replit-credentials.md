---
name: Railway-native credentials vs Replit connectors
description: Which third-party auths work on Railway (prod) vs only on Replit, and how Google Calendar must authenticate in production.
---

# Railway (prod) vs Replit connector auth

Production runs on Railway (clvrquantai.com); the Replit env is dev only. Any
integration that authenticates through the **Replit connector proxy**
(`REPLIT_CONNECTORS_HOSTNAME` + `REPL_IDENTITY`/`WEB_REPL_RENEWAL`) will NOT work
on Railway because that infrastructure does not exist there. Such integrations
must have a plain env-var auth path.

Status by integration:
- **Stripe** — env var `STRIPE_SECRET_KEY`. Railway-native already.
- **Resend** — prefers env `RESEND_API_KEY` (+ optional `RESEND_FROM_EMAIL`),
  connector only as fallback. Railway-native already.
- **Google Calendar** (concierge booking Meet links) — was Replit-connector-only.
  Now prefers an **OAuth refresh-token** env path: `GOOGLE_OAUTH_CLIENT_ID`,
  `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` (refresh token minted
  with `https://www.googleapis.com/auth/calendar` scope + offline access for the
  calendar-owner account, e.g. support@). Connector remains a dev fallback.
  Target calendar = `SUPPORT_CALENDAR_ID` (default `primary`).

**Why:** the booking flow silently produced no calendar event / Meet link in
production because the calendar client could only auth via Replit infra. Calendar
creation is fail-open, so the failure was invisible (bookings still confirmed).

**How to apply:** when a feature "works in dev but not in prod" and touches a
third-party API, check whether it authenticates via a Replit connector — if so it
needs an env-var path before it can work on Railway. Service accounts can't make
Google Meet links on personal Gmail without Workspace domain-wide delegation;
prefer an OAuth refresh token for Meet links.

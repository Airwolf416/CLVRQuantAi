---
name: Macro feed failure semantics
description: Operational lessons from intermittent MACRO event disappearance.
---

Do not bypass calendar cache TTL merely because a scheduled event lacks an actual value. Such entries can remain unresolved indefinitely.

**Why:** This caused every dashboard refresh to launch another multi-day scrape; upstream rate limiting then looked like an empty calendar. On 2026-09-30, ForexFactory day pages also returned Cloudflare 403 while published weekly exports remained available.

**How to apply:** Coalesce refreshes, back off failures, explicitly label retained data stale, and distinguish a validated empty schedule from transport/parse failures. A calendar HTTP 429 can also originate from the app-wide limiter exhausted by unrelated dashboard polling; inspect response provenance before blaming the provider. API repeatability does not substitute for authenticated browser reload acceptance.

Account-status lookup errors must not be interpreted as signed-out sessions.

**Why:** Repeated dashboard reloads exhausted the shared request budget; treating a 429 from the session lookup as a null user sent valid sessions to welcome and obscured calendar testing.

**How to apply:** Keep credential-attempt protections intact, distinguish transient status failures from genuine unauthenticated responses, and provide retry without clearing credentials. Browser verification with a seeded bearer session should disclose that setup rather than claim coverage of ordinary cookie-session reloads.
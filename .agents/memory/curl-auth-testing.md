---
name: Curl-testing auth-gated routes
description: How to smoke-test session/tier-gated API routes from the dev shell
---

The session cookie is set with `SameSite=None; Secure`, so curl against plain
`http://localhost:5000` never stores it — cookie-jar signin appears to succeed
but every subsequent request is anonymous (401).

**How to apply:** sign in via `POST /api/auth/signin` and use the `token` field
from the JSON response as `Authorization: Bearer <token>` (there is a
first-class bearer fallback for cookieless contexts). To test tier gates
cheaply without triggering a real AI call, send a valid session with an
invalid body — passing the gate shows up as 400 instead of 401/403.

Also: the express-rate-limit stores are in-memory, so if a burst test trips a
limiter (e.g. auth 10/15min), a workflow restart resets the window.

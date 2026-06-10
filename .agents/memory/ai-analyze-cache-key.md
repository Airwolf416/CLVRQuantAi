---
name: /api/ai/analyze response cache key
description: The AI analysis endpoint caches on a truncated system+message hash only — new output-affecting inputs (e.g. history) are silently ignored on cache hits.
---

`/api/ai/analyze` caches responses keyed on a hash of `(system, userMessage)` plus a feature-flag suffix. The hash TRUNCATES system (~200 chars) and message (~600 chars) before hashing, and includes NOTHING else from the request body.

**Why:** When multi-turn `history` support was added (a validated `history` array injected into the Anthropic `messages` array), the cache key was left unchanged. So two callers asking the same short question within the ~5-min TTL share one cached answer computed without (or with another caller's) history — multi-turn context is silently dropped on cache hits. It is not a crash and not a private-data leak (history is never echoed back), but it dilutes follow-up fidelity.

**How to apply:** Whenever you add a new request input that changes `/api/ai/analyze` output (history, persona, tool set, model, etc.), fold a hash of it into the cache key — OR skip the cache when that input is non-empty (e.g. `history.length > 0`). Otherwise the new input is ignored on every truncated-key collision.

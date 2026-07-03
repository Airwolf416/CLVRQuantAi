---
name: Emission guards must run before persistence
description: Why a response-level repair guard still leaks bad data — guard must sit above every sink (DB persist, in-memory feed), plus read-time repair for legacy rows.
---

# Guard placement: before ALL sinks, not just before res.json

**Rule:** any repair/validation guard on outgoing signal cards must run BEFORE every
sink — DB persist, in-memory feed push, response — not just before `res.json`.
A guard placed only at the response boundary "works" in testing (the HTTP payload is
clean) while the DB row persisted a few lines earlier still carries the broken data,
and every surface that re-serves stored rows (feed endpoints, outcome resolver,
stats) keeps leaking the bug across deploys.

**Why:** this exact failure shipped: the geometry guard repaired `/api/quant`
responses, but `logSignal` + the calibration snapshot ran ~100 lines EARLIER in the
handler, so `ai_signal_log` stored wrong-side SL/TP; `/api/signals/feed` re-served
those rows raw and users kept seeing SHORT cards with long-shaped levels after the
"fix" was verified live in the response bundle.

**How to apply:**
- When adding/moving an emission guard, grep the handler for every persist/publish
  call (`logSignal`, `saveSignalRecord`, in-memory `unshift`, snapshot writers) and
  place the guard above ALL of them, after the last level mutation.
- Historical bad rows survive the fix — add a read-time repair on the serving
  endpoint (fail-open per row, and use a `silent` telemetry flag so polling doesn't
  spam rejection logs every few seconds).
- Watch derived-metric fallbacks downstream of the guard: a `!x.rr` fallback using
  absolute math can overwrite the guard's intentional null (unmirrorable leg) —
  skip fallbacks when the guard flagged a correction.

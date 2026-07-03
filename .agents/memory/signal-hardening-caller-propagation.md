---
name: applySignalHardening caller propagation
description: The shared hardening gate has multiple callers; any level-mutating logic must be echoed back by every caller or it's silently lost.
---

`applySignalHardening` (server/lib/signalHardening.ts) is the shared post-LLM/scanner risk gate. It RETURNS `hard.signal.{entry,stopLoss,tp1,tp2,conviction,...}` — it does NOT mutate the caller's object. It has three live callers, each of which must copy those returned levels back onto its own plan/signal:

- `/api/quant` auto-scanner (server/routes.ts) — writes entry/sl/tp1/tp2/conviction back onto `signal.*`.
- `/api/ai/analyze` + `/api/kronos` ai_signal path (server/routes.ts) — writes them onto `parsed.*`.
- signalGen v2 (server/lib/promptV2Runner.ts) — writes onto `plan.targets[]` and `plan.tp1/tp2` aliases.

**Rule:** whenever you add a NEW level mutation inside the gate (e.g. the Gate 0 directional-geometry repair that mirrors wrong-side TPs across entry), EVERY caller must propagate the new fields.

**Why:** promptV2Runner originally echoed back only stopLoss + confidence, so once Gate 0 could rewrite targets, the repaired TPs were silently dropped on the Trade Ideas path — the stop looked fixed but the card still showed an inverted target. Easy to miss because the other fields look correct.

**How to apply:** after changing what the gate can mutate, grep `applySignalHardening(` callers and confirm each writes back the full field set (entry, stopLoss, tp1, tp2, conviction).

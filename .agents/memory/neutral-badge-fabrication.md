---
name: NEUTRAL badge fabrication
description: Why users saw "SHORT cards with long levels" after every server geometry guard was verified clean — the display layer fabricated the direction
---

The rule: **UI direction badges must come only from an explicit LONG/SHORT in the
signal string. A binary fallback (`isLong ? "LONG" : "SHORT"`) fabricates a
direction for non-directional payloads.**

**Why:** `/api/quant` can return `signal=NEUTRAL` with reference entry/SL/TP
levels attached. Geometry guards correctly skip it (no direction to enforce) and
it is never persisted (persist gate requires LONG/SHORT) — so every server
surface, DB row, and feed looked clean while users kept seeing "SHORT" cards
with long-side levels. The badge was invented client-side. A fake rr also
leaked in two ways: the LLM's own `tp1.rr_ratio` and an absolute-math rr
fallback, which promoted NEUTRAL into the scanner's "qualifying" bucket.

**How to apply:**
- When a repair guard is verified clean at every server emission point but the
  bad output persists, stop adding server guards — audit the DISPLAY layer's
  derivation of the disputed attribute (direction, status, etc.).
- Non-directional results must ship `rr=null` and must never render as trade
  cards; give them their own display bucket instead of dropping them silently.
- Reproduce with a real authed request (elite test user + bearer token) rather
  than reasoning from code — the NEUTRAL-with-levels shape was only visible in
  a live response.

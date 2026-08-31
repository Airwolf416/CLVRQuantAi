---
name: Dynamic universe authority
description: Admission boundary between discovered Hyperliquid markets and symbols allowed to be scored or emitted.
---

Dynamic discovery only establishes that a market exists. It never grants scoring or emission authority. Server-side request handlers, workers, and every persistence/serialization sink must re-check durable eligibility plus the explicit scorer-support policy.

**Why:** Picker validation alone does not protect background scanners or crafted requests; a quarantined, delisted, HIP-3-pending, newly unsupported, or unknown market could otherwise emit a card.

**How to apply:** Fail closed for discovered-but-unsupported markets, preserve the explicit legacy fallback allowlist when durable discovery is unavailable, and keep non-Hyperliquid Basket assets outside Hyperliquid-specific gating.
---
name: Signal expectancy diagnostics (ai_signal_log)
description: Empirical findings on why raw scanner signal expectancy is negative and which filter survives out-of-sample. Re-derive from fresh data before acting — dataset-dependent.
---

# Raw scanner-signal expectancy is negative; the conviction score inverts above ~50

**As of the ~1,260-resolved-signal snapshot (2026-04-16 → 2026-06-05) in the dev `ai_signal_log`.** Numbers will drift; re-run the diagnostic on current data before relying on them. The *shape* of the finding is the durable part.

- Equal-weight, 1u-notional baseline is a losing system: ~35% win rate, profit factor ~0.74, expectancy ~-0.29%/trade. Payoff ratio ~1.34 needs ~43% WR to break even; actual is well below.
- **Conviction is well-behaved up to 50, then inverts.** Buckets improve monotonically (conv 40-50 ≈ break-even, PF ~0.94) but the 50+ band collapses (PF ~0.40 at 50-60, ~0.13 at 60-80, WR ~11%).
  - **Mechanism (why the high-conviction band is toxic):** vs the <50 cohort, the 50+ cohort runs *higher leverage* (2x share drops ~96%→~65%, with a 3x–8x tail), *shorter holds* (median ~9h vs ~20h), and *concentrates in illiquid high-beta alts* (TIA/SEI/ONDO/JUP). The score is rewarding leverage-escalation + short-hold-alt setups, which are exactly the negative-EV ones.
- **A simple filter flips it and holds out-of-sample:** conviction in [30,50) AND leverage = 2x AND token in a train-derived positive-expectancy whitelist (majors + a few alts like ONDO/HYPE/WIF/BTC/ETH/BNB/JUP). On the held-out 40% it gave PF ~1.41 (n~102, WR ~48%); throttling to top-3/day pushed PF higher on a smaller n. This is consistent with the project's stated move to a deterministic scorer + edge-policy SUPPRESS/INVERT.

**Why this matters:** the edge is in *selection and risk caps*, not in the directional call — direction is roughly symmetric (LONG/SHORT PF both ~0.72–0.75). Leaks are: the 50+ conviction band, leverage >2x, and a handful of illiquid alts.

**How to apply:** treat conviction>50 and leverage>2x as risk flags, not green lights. The log has no MFE/MAE per trade, so trailing-exit / "let winners run" hypotheses can't be backtested yet — logging MFE going forward is the prerequisite.

**Gotcha:** `hold_hours` and `realized_R` are NOT columns on `ai_signal_log`; they are derived (hold = resolved-created; R = pnl_pct / planned-risk%). Backtest scripts that `SELECT` them from the table will fail — feed them the derived CSV export instead.

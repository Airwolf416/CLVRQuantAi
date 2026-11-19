# Latest shipped changes

Reviewed against serving release `002c3866b71198686e4f7dcc8172c374a1f7a686` on November 19, 2026. This is a recent-change summary, not a claim that the previous digest was delivered. Pending work is excluded.

## More market context, clearer research

**A separate “Equities & more” table**  
Explore Hyperliquid xyz equity, index, FX and commodity perpetuals in their own view. The existing crypto table remains separate.

**Visible scores and data coverage**  
The new table shows daily-candle directional signals, conviction, directional scores and history/coverage labels. Missing history is identified rather than presented as a completed signal.

**Independent price and history refresh**  
Hyperliquid xyz live marks refresh separately from cached daily history after history is available, keeping the two data sources distinct.

**Passing Trade Ideas and below-gate research**  
Passing setups appear first. Additional evaluated candidates can appear as clearly marked BELOW GATE research, showing their final conviction, applicable minimum and rejection reasons. Research is not an approved trade.

**Readable Morning Brief trade levels**  
Forex decimal precision and instrument-specific fractional prices are preserved, with a separate reward-to-risk label for each target.

**Local-time, weekend-aware Morning Brief support**  
Scheduling uses each subscriber's selected time zone for local 6 AM. Weekend content accounts for closed traditional markets alongside markets that continue trading.

Educational support only — not financial advice. DYOR.

## Release evidence

- Separate table and daily scoring: `a210baa2c01ba5963020662e04d2cb1913446b4c`
- Independent xyz mark/history refresh: `7eb8ffec32a0f287456457ad1d0deb02cf22d981`
- Evaluated Trade Ideas/research boundary: `002c3866b71198686e4f7dcc8172c374a1f7a686`
- Brief price precision/target labels: `ea892fef9729920699295933acb8fc5e229d84fa`, `8e2eb323c404c014f6d4bc66d6a6cde0e00bf383`
- Local-time/weekend-aware brief support: `c8edd654c101232c3f6415e9e03731649771c711`

GitHub showed these in the ancestry of the exact serving release; the serving release and its successful build/deploy workflow were independently checked. This evidence does not prove every feed currently has full coverage or that every email arrived in an inbox.

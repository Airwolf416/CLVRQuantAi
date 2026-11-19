// Reviewed facts supplement terse commit subjects; they are included ONLY when
// that exact commit is present in the verified serving release's change window.
// Future commits still use automatic detection. These are not pending features.
export const WEEKLY_RELEASE_FACTS: Record<string, string | null> = {
  a210baa2c01ba5963020662e04d2cb1913446b4c:
    'The separate "Equities & more" table covers Hyperliquid xyz equity, index, FX and commodity perpetuals without replacing the crypto table. Its daily-candle scorer shows LONG, SHORT, NEUTRAL or NO_DATA, conviction, directional scores and candle coverage/history labels. Do not imply every instrument has complete data.',
  "7eb8ffec32a0f287456457ad1d0deb02cf22d981":
    "Hyperliquid xyz live marks and cached daily candle histories refresh independently after history is available. Users can see price marks alongside historical scoring context. Do not promise zero stalls, instantaneous updates or complete historical coverage.",
  "002c3866b71198686e4f7dcc8172c374a1f7a686":
    "Trade Ideas displays server-evaluated passing setups separately from clearly marked BELOW GATE research, with final conviction, applicable minimum and rejection reasons. Research is not an approved trade and is excluded from trade logging. Gate minima differ by market risk tone and direction; never describe all assets/regimes as using uniform criteria.",
  ba7bec4a2ce5f5e72800e1defdd3c04acfc00e10:
    "Passing Trade Ideas come first, followed by distinctly labelled below-gate research when there is room. Counts distinguish both groups. Describe visibility and reasons, not guaranteed setup availability or uniform cross-asset thresholds.",
  ea892fef9729920699295933acb8fc5e229d84fa:
    "Morning Brief trade validation preserves forex decimal precision and labels the reward-to-risk ratio for each target. Explain readable price levels, not improved trading results.",
  "8e2eb323c404c014f6d4bc66d6a6cde0e00bf383":
    "Morning Brief validation preserves instrument-specific fractional prices rather than applying one rounding rule to every asset.",
  c8edd654c101232c3f6415e9e03731649771c711:
    "Morning Brief scheduling supports each subscriber's selected time zone at local 6 AM, and weekend-aware content accounts for closed traditional markets. This describes scheduling/content support, not evidence that every email reaches its inbox on time.",
  "1e004765a12f23df44c99d5b8f4e77b47ec6bb57":
    "Morning Brief email delivery recovery was updated for subscriber groups affected by older delivery records. Do not claim confirmed delivery to every recipient, on-time arrival, or a catch-up campaign.",
  a43032f5efe75401e394f94b379d306bf914030f: null, // Security implementation detail, not marketing copy.
};

export function commitDigestNotes(commits: { sha: string; message: string }[]): string[] {
  return commits.flatMap(commit => {
    const fact = WEEKLY_RELEASE_FACTS[commit.sha];
    if (fact === null) return [];
    const subject = commit.message.split("\n")[0].trim();
    return [fact ? `${subject} — VERIFIED RELEASE FACTS: ${fact}` : subject];
  });
}

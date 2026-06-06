# CLVRQuantAI — Full Source for AI Features

Generated export of the complete code behind: **CLVR AI Trade Ideas**, **Quant Scanner**, **Kronos**, **Ask AI**, and **Chart AI**.

Server routes are extracted by line range from `server/routes.ts`. Client components and shared libraries are included in full. A "Shared Signal Libraries" section at the end holds the modules every endpoint depends on (hardening, statistical brain, empirical filters, quant bridge).

---

## 1. CLVR AI Trade Ideas

**Endpoint:** `POST /api/ai/analyze` · **Client:** `TopTradeIdeas.jsx`, `TradeIdeaCard.jsx`, `SignalCard.jsx`

#### Backend: POST /api/ai/analyze — `server/routes.ts` (lines 8747–9144)
```ts
  app.post("/api/ai/analyze", aiIpLimiter, async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Anthropic API key not configured" });

    const systemRaw = req.body.system || req.body.systemPrompt || "";
    const userMessageRaw = req.body.userMessage || req.body.prompt || "";
    if (!userMessageRaw) return res.status(400).json({ error: "userMessage is required" });

    // ── Optional brain / vision / exec-level injection (Trade Ideas, QuantBrain) ──
    // Callers can opt-in to surface the same Statistical Brain + Chart Vision +
    // VWAP/ORH/ORL execution context that /api/quant uses. Falls open on every
    // sub-call: any failure here logs and continues without that block.
    //
    // SECURITY: tickers are concatenated into the system prompt — we therefore
    // hard-validate them as 1–10 char A-Z0-9 only. Anything else is dropped to
    // prevent a caller from injecting "\nNew system instructions: ..." via the
    // ticker field.
    const TICKER_RE = /^[A-Z0-9]{1,10}$/;
    const reqTickers: string[] = Array.isArray(req.body.tickers)
      ? Array.from(new Set(
          req.body.tickers
            .filter((t: any) => typeof t === "string")
            .map((t: string) => t.trim().toUpperCase())
            .filter((t: string) => TICKER_RE.test(t))
        )).slice(0, 10) as string[]
      : [];
    const attachBrainSummary: boolean = req.body.attachBrainSummary === true;
    const attachVision: boolean = req.body.attachVision === true;
    const visionTicker: string = typeof req.body.visionTicker === "string" ? req.body.visionTicker.trim().toUpperCase() : "";
    const visionDirection: "LONG" | "SHORT" | undefined =
      req.body.visionDirection === "LONG" || req.body.visionDirection === "SHORT" ? req.body.visionDirection : undefined;

    // Inject performance context into the system prompt (adaptive learning)
    const perfCtx = await buildPerformanceContext().catch(() => "");

    // ── 1. Per-ticker statistical brain blocks (LONG + SHORT for each requested ticker) ──
    let brainBlock = "";
    if (reqTickers.length > 0) {
      try {
        const _brainMod = await import("./lib/statisticalBrain");
        const perTicker: string[] = [];
        for (const tkr of reqTickers) {
          try {
            const [bL, bS] = await Promise.all([
              _brainMod.getBrainFor(tkr, "LONG"),
              _brainMod.getBrainFor(tkr, "SHORT"),
            ]);
            const parts: string[] = [];
            if (bL?.hasData) parts.push(bL.promptText);
            if (bS?.hasData) parts.push(bS.promptText);
            if (parts.length) perTicker.push(parts.join("\n\n"));
          } catch {}
        }
        if (perTicker.length) {
          brainBlock = `══════════════ STATISTICAL EDGE BRAIN — REQUESTED TICKERS ══════════════\nEmpirical edge per (token, direction) from resolved-trade history. STRICT LIMITS\nare advisory here (no veto), but SUPPRESS verdicts mean the combo has no\ndemonstrated edge — DO NOT recommend that direction unless confluence is\noverwhelming.\n\n${perTicker.join("\n\n")}\n══════════════════════════════════════════════════════════════════════\n`;
        }
      } catch (e: any) {
        console.warn("[ai/analyze] per-ticker brain failed:", e?.message || e);
      }
    }

    // ── 2. Global brain summary table (top combos across the whole universe) ──
    let brainSummaryBlock = "";
    if (attachBrainSummary) {
      try {
        const _brainMod = await import("./lib/statisticalBrain");
        const { rows, lookbackDays } = await _brainMod.getBrainSummary();
        const eligible = rows.filter(r => r.sampleSize >= 15);
        const preferred = [...eligible].filter(r => r.winRate >= 0.60).sort((a, b) => b.winRate - a.winRate).slice(0, 6);
        const suppressed = [...eligible].filter(r => r.winRate < 0.25).sort((a, b) => a.winRate - b.winRate).slice(0, 6);
        const fmtRow = (r: any) =>
          `  ${r.token.padEnd(8)} ${r.direction.padEnd(5)} | n=${String(r.sampleSize).padStart(3)} | WR ${(r.winRate*100).toFixed(1).padStart(5)}% | EV ${(r.expectedR>=0?"+":"")}${r.expectedR.toFixed(2)}R | avgWin ${r.avgWinR.toFixed(2)}R / avgLoss ${r.avgLossR.toFixed(2)}R`;
        if (preferred.length || suppressed.length) {
          const lines: string[] = [];
          lines.push(`══════════════ STATISTICAL BRAIN — TOP COMBOS (last ${lookbackDays}d) ══════════════`);
          if (preferred.length) {
            lines.push(`✅ PREFERRED (WR ≥ 60%, n ≥ 15) — favor these directions:`);
            preferred.forEach(r => lines.push(fmtRow(r)));
          }
          if (suppressed.length) {
            if (preferred.length) lines.push("");
            lines.push(`⛔ SUPPRESSED (WR < 25%, n ≥ 15) — DO NOT recommend these directions:`);
            suppressed.forEach(r => lines.push(fmtRow(r)));
          }
          lines.push(`════════════════════════════════════════════════════════════════════`);
          brainSummaryBlock = lines.join("\n") + "\n";
        }
      } catch (e: any) {
        console.warn("[ai/analyze] brain summary failed:", e?.message || e);
      }
    }

    // ── 3. Per-ticker execution context (VWAP / ORH / ORL) for eligible spot tickers ──
    let execLevelsBlock = "";
    if (reqTickers.length > 0) {
      try {
        const { isExecutionOverlayEligible } = await import("./lib/executionOverlay");
        const { computeExecutionLevels, formatExecutionContextBlock } = await import("./lib/executionLevels");
        const blocks: string[] = [];
        for (const tkr of reqTickers) {
          if (!isExecutionOverlayEligible(tkr)) continue;
          try {
            const lvl = await computeExecutionLevels(tkr);
            if (lvl) blocks.push(formatExecutionContextBlock(lvl));
          } catch {}
        }
        if (blocks.length) {
          execLevelsBlock = `══════════════ INTRADAY EXECUTION LEVELS (VWAP / Opening Range) ══════════════\nReference these levels in your reasoning where relevant. If a ticker is not\nlisted here it is not eligible for intraday session structure (crypto / perp).\n\n${blocks.join("\n\n")}\n════════════════════════════════════════════════════════════════════\n`;
        }
      } catch (e: any) {
        console.warn("[ai/analyze] exec levels failed:", e?.message || e);
      }
    }

    // ── 3b. Per-ticker Unusual Activity context (conditions, not prediction) ──
    let unusualBlock = "";
    if (reqTickers.length > 0) {
      try {
        const lines: string[] = [];
        for (const tkr of reqTickers) {
          const ua = getUnusualForSymbol(tkr);
          if (ua) lines.push(`  ${tkr}: score ${ua.score}/100 (${ua.band}) — ${ua.reasons.join("; ")}`);
        }
        if (lines.length) {
          unusualBlock = `══════════════ UNUSUAL ACTIVITY (conditions, not prediction) ══════════════\nAbnormal market conditions flagged right now (price velocity, volume, funding,\nopen interest, volatility). Treat as supporting context ONLY — it flags\nabnormal conditions, never a directional signal. Do not raise conviction on it\nalone. Tickers not listed have no abnormal conditions flagged.\n\n${lines.join("\n")}\n════════════════════════════════════════════════════════════════════\n`;
        }
      } catch (e: any) {
        console.warn("[ai/analyze] unusual activity failed:", e?.message || e);
      }
    }

    // ── 4. Render chart PNG for vision input (single ticker only) ──
    let chartImageB64: string | null = null;
    if (attachVision && visionTicker) {
      try {
        const cls: string = ["NVDA","TSLA","AAPL","MSFT","META","MSTR","COIN","PLTR","AMZN","GOOGL","AMD"].includes(visionTicker)
          ? "equity"
          : ["XAU","CL","SILVER","NATGAS","COPPER","BRENTOIL"].includes(visionTicker)
          ? "commodity"
          : "crypto";
        const candles1h = await fetchQuantCandles(visionTicker, cls, "1h", 48);
        if (candles1h && candles1h.length >= 20) {
          const { renderChartPng, computeEmaSeries } = await import("./lib/chartRenderer");
          const closes1h = candles1h.map((c: any) => c.c);
          const highs = candles1h.map((c: any) => c.h);
          const lows = candles1h.map((c: any) => c.l);
          chartImageB64 = await renderChartPng({
            token: visionTicker,
            direction: visionDirection,
            candles: candles1h,
            ema20: computeEmaSeries(closes1h, 20),
            ema50: computeEmaSeries(closes1h, 50),
            support: Math.min(...lows.slice(-24)),
            resistance: Math.max(...highs.slice(-24)),
            timeframeLabel: "1h",
          });
        }
      } catch (e: any) {
        console.warn(`[ai/analyze] chart vision render failed for ${visionTicker}:`, e?.message || e);
      }
    }

    // Compose the final system prompt: perf ctx → brain summary → per-ticker
    // brain → exec levels → caller's system prompt. All injected blocks are
    // omitted entirely when empty so callers that don't opt in are unaffected.
    const sysParts: string[] = [];
    if (perfCtx) sysParts.push(perfCtx);
    if (brainSummaryBlock) sysParts.push(brainSummaryBlock);
    if (brainBlock) sysParts.push(brainBlock);
    if (execLevelsBlock) sysParts.push(execLevelsBlock);
    if (unusualBlock) sysParts.push(unusualBlock);
    if (systemRaw) sysParts.push(systemRaw);
    const system = sysParts.join("\n\n");

    // If we rendered a chart, the user message becomes a mixed content array
    // (image + text). Otherwise stays a plain string for backward compat.
    const userMessage: any = chartImageB64
      ? [
          { type: "image", source: { type: "base64", media_type: "image/png", data: chartImageB64 } },
          { type: "text", text: `A live 1h candlestick chart of ${visionTicker} with EMA20/EMA50 overlays and S/R levels is attached above. Use it to confirm visual structure (clean trends, fakeout wicks, double tops/bottoms at key levels) before answering.\n\n${userMessageRaw}` },
        ]
      : userMessageRaw;

    // Auth check — AI is Pro-only
    const userId = (req.session as any)?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Sign in required to use AI." });
    }
    const dbUser = await storage.getUser(userId);
    if (!dbUser) {
      return res.status(401).json({ error: "Sign in required to use AI." });
    }
    const effectiveTier = await getEffectiveTier(dbUser);
    const isPro = effectiveTier === "pro" || effectiveTier === "elite";
    if (!isPro) {
      return res.status(403).json({ error: "AI Market Analyst is a Pro feature. Upgrade to Pro to unlock CLVR AI analysis." });
    }

    if (!checkAiRateLimit(userId, true)) {
      return res.status(429).json({
        error: "Rate limit: 60 AI requests/hour on Pro.",
        cached: false,
      });
    }

    // Check shared response cache — same prompt for any user = cached response
    // The cache key must distinguish callers using different brain/vision/exec
    // flags or different ticker focus lists, otherwise (because hashPrompt
    // truncates to 200/600 chars and Trade Ideas uses a fixed time-bucket key
    // that ignores `system` entirely) two users with different `tickers` could
    // share a cache entry — leaking BTC analysis to an ETH request, etc.
    // hashPrompt receives the typeof-string user message body for legacy
    // routing (TOP N TRADE IDEAS, macro), and the flags get appended.
    const userMessageStr = typeof userMessageRaw === "string" ? userMessageRaw : JSON.stringify(userMessageRaw);
    const flagSuffix =
      `|abs:${attachBrainSummary ? 1 : 0}` +
      `|av:${attachVision ? 1 : 0}` +
      `|vt:${visionTicker || "-"}` +
      `|vd:${visionDirection || "-"}` +
      `|tk:${reqTickers.join(",")}`;
    const cacheKey = hashPrompt(system, userMessageStr) + flagSuffix;
    const cached = aiCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < AI_CACHE_TTL) {
      return res.json({ text: cached.text, response: cached.text, cached: true });
    }

    // Pro users always get the latest Claude model for best quality analysis
    const model = CLAUDE_MODEL;
    // Callers can request more tokens (e.g. Morning Brief needs ~3000 for full JSON)
    const maxTokens = Math.min(parseInt(req.body.maxTokens) || 1500, 8192);
    // Callers can disable tool use (e.g. Morning Brief — has all data inline,
    // tool use causes Claude to return empty content after the tool round).
    const skipTools = req.body.skipTools === true;
    // Callers can opt-in to Anthropic's server-side web search tool so Claude
    // can pull in fresh real-world context (e.g. geopolitical headlines moving
    // oil) before answering. This is a "server tool" — Anthropic handles the
    // search results inline, so it doesn't trigger our local tool-use loop.
    const enableWebSearch = req.body.enableWebSearch === true;

    const callClaude = async (messages: any[], withTools = true) => {
      const body: any = {
        model,
        max_tokens: maxTokens,
        system: system || "",
        messages,
      };
      const tools: any[] = [];
      if (withTools) tools.push(...AI_TOOLS);
      if (enableWebSearch) tools.push({ type: "web_search_20250305", name: "web_search", max_uses: 5 });
      if (tools.length) body.tools = tools;
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(body),
      });
      return r;
    };

    try {
      const messages: any[] = [{ role: "user", content: userMessage }];
      let response = await callClaude(messages, !skipTools);

      if (!response.ok) {
        const errorText = await response.text();
        if (errorText.includes("credit balance") || errorText.includes("credit_balance") || response.status === 529) {
          return res.status(503).json({ error: "__MAINTENANCE__" });
        }
        return res.status(response.status).json({ error: `API Error ${response.status}: ${errorText}` });
      }

      // ── PROMPT_V2 shadow run (fire-and-forget; AI Analyst surface) ────────
      if (getPromptV2Mode() !== "off") {
        void (async () => {
          try {
            const { runAnalystV2 } = await import("./lib/promptV2Runner");
            await runAnalystV2({
              fullPerfContext: perfCtx || "",
              instrumentsLive: "(see user query)",
              killSwitches: [],
              userQuery: userMessage.slice(0, 2000),
            }, apiKey, systemRaw.slice(0, 200));
          } catch (e: any) { console.warn("[PROMPT_V2 analyst shadow]", e?.message || e); }
        })();
      }

      let data: any = await response.json();
      if (data.error) {
        const msg = data.error.message || "";
        if (msg.includes("credit balance") || msg.includes("credit_balance")) {
          return res.status(503).json({ error: "__MAINTENANCE__" });
        }
        return res.status(400).json({ error: msg });
      }

      // ── Tool use loop (max 3 tool calls to prevent runaway) ─────────────────
      let toolRounds = 0;
      while (data.stop_reason === "tool_use" && toolRounds < 3) {
        toolRounds++;
        const toolUseBlocks = (data.content || []).filter((b: any) => b.type === "tool_use");
        const toolResults: any[] = [];

        for (const tb of toolUseBlocks) {
          if (tb.name === "get_market_quote") {
            const rawTicker = tb.input?.ticker || "";
            console.log(`[ai-tools] get_market_quote called for: ${rawTicker}`);
            const quote = await fetchYahooQuote(rawTicker);
            const resultText = "error" in quote
              ? `Could not fetch quote for "${rawTicker}": ${quote.error}`
              : `LIVE QUOTE — ${quote.name} (${quote.ticker}) on ${quote.exchange}: ${quote.currency} ${quote.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} | Change: ${quote.change >= 0 ? "+" : ""}${quote.change.toFixed(4)} (${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%) | [Source: Yahoo Finance — live data]`;
            toolResults.push({
              type: "tool_result",
              tool_use_id: tb.id,
              content: resultText,
            });
          }
        }

        // If no tool results were generated (shouldn't happen), add a placeholder
        if (toolResults.length === 0) {
          for (const tb of toolUseBlocks) {
            toolResults.push({ type: "tool_result", tool_use_id: tb.id, content: "Tool unavailable — proceed with analysis using available data." });
          }
        }

        // Append assistant message + tool results and continue
        messages.push({ role: "assistant", content: data.content });
        messages.push({ role: "user", content: toolResults });

        response = await callClaude(messages, false); // no tools on follow-up — get final answer
        if (!response.ok) {
          const errorText = await response.text();
          return res.status(response.status).json({ error: `API Error ${response.status}: ${errorText}` });
        }
        data = await response.json();
        if (data.error) return res.status(400).json({ error: data.error.message || "AI error" });
      }

      let text = (data.content || []).map((b: any) => b.text || "").join("");

      // Defensive fallback: if Claude returned empty content after a tool-use
      // round (known failure mode where model emits end_turn with []), retry
      // once with the original prompt only and tools disabled.
      if (!text && toolRounds > 0) {
        console.warn("[ai/analyze] Empty content after tool use — retrying without tools.");
        try {
          const retryRes = await callClaude([{ role: "user", content: userMessage }], false);
          if (retryRes.ok) {
            const retryData: any = await retryRes.json();
            text = (retryData.content || []).map((b: any) => b.text || "").join("");
          }
        } catch {}
      }

      if (!text) {
        const errMsg = "CLVR AI did not return a response — please try again.";
        console.error("[ai/analyze] Claude returned empty content. stop_reason:", data.stop_reason, "content_types:", (data.content||[]).map((b:any)=>b.type));
        return res.json({ text: errMsg, response: errMsg, cached: false, model });
      }

      // ── Trade Ideas hardener ─────────────────────────────────────────────
      // If the response parses as Trade Ideas JSON ({trades:[...]}), wrap each
      // card with hardenSignal() before caching/returning. Pure pass-through
      // for any other /api/ai/analyze caller (Morning Brief, ad-hoc analysis).
      // Wrapped in try/catch — on any error the original `text` flows through
      // unmodified so a hardener bug can't blank-out Trade Ideas in prod.
      try {
        const trimmed = text.trim();
        const looksJson = trimmed.startsWith("{") && trimmed.includes('"trades"');
        if (looksJson) {
          const parsed: any = JSON.parse(trimmed);
          if (parsed && Array.isArray(parsed.trades) && parsed.trades.length > 0) {
            const hardened = await hardenTradeIdeas(parsed.trades, apiKey);
            parsed.trades = hardened.cards;
            text = JSON.stringify(parsed);
            console.log(
              `[ai/analyze] hardener: in=${hardened.inCount} out=${hardened.cards.length} ` +
              `(dropped=${hardened.dropped} vetoed=${hardened.vetoed} regen=${hardened.regenerated})`,
            );
          }
        }
      } catch (e: any) {
        console.warn("[ai/analyze] hardener skipped:", e?.message || e);
      }

      // Only cache valid non-empty responses (now post-hardening)
      aiCache.set(cacheKey, { text, ts: Date.now() });

      res.json({ text, response: text, cached: false, model });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── KRONOS FORECAST ENGINE ──────────────────────────────────────────────────
```

#### `client/src/components/ai/TopTradeIdeas.jsx`
```jsx
import { useState, useEffect, useCallback } from "react";
import TradeIdeaCard from "./TradeIdeaCard.jsx";
import MacroPreFlight from "./MacroPreFlight.jsx";
import { buildMarketSnapshot, buildMacroPreflightContext } from "../../utils/marketDataSnapshot.js";

const MONO = "'IBM Plex Mono', monospace";
const SERIF = "'Playfair Display', Georgia, serif";
const SANS = "'Barlow', system-ui, sans-serif";

// Granular Today sub-timeframes — Quick / Hours / Full Day
const TODAY_MODES = {
  quick:   { label: "⚡ Quick",     subtitle: "5-30 min scalps", atrRef: "ATR(5m)", tp1Mult: 0.3, tp2Mult: 0.6, slMult: 0.20, killClock: "30 min", maxLev: { crypto: 10, equity: 5, commodity: 5, fx: 20 }, hold: "5-30 minutes", killHours: 0.5, style: "AGGRESSIVE — maximize gain on quick momentum bursts" },
  hours:   { label: "📊 Hours",     subtitle: "1-4 hour holds",  atrRef: "ATR(1H)", tp1Mult: 0.5, tp2Mult: 1.0, slMult: 0.35, killClock: "4H",     maxLev: { crypto: 7,  equity: 3, commodity: 5, fx: 15 }, hold: "1-4 hours",    killHours: 4,   style: "BALANCED — standard intraday parameters" },
  fullDay: { label: "☀️ Full Day",  subtitle: "4-12 hour holds", atrRef: "ATR(4H)", tp1Mult: 0.5, tp2Mult: 1.0, slMult: 0.50, killClock: "12H",    maxLev: { crypto: 5,  equity: 2, commodity: 3, fx: 10 }, hold: "4-12 hours",   killHours: 12,  style: "PATIENT — ride the full session move" },
};

export default function TopTradeIdeas({
  mode, isElite, isPro, isPreview,
  storePerps, storeSpot, cryptoPrices, equityPrices, metalPrices, forexPrices,
  liveSignals, newsFeed, macroEvents, insiderData, regimeData,
  storeMode, storeTotalMarkets, storeAlerts,
  onAlertCreated,
}) {
  const [loading, setLoading] = useState(false);
  const [trades, setTrades] = useState(null);
  const [error, setError] = useState(null);
  const [timeframe, setTimeframe] = useState("today");
  const [todayMode, setTodayMode] = useState("hours"); // quick | hours | fullDay
  const [marketTypeFilter, setMarketTypeFilter] = useState("BOTH");
  // Asset-class scope: ALL | CRYPTO | EQUITY | COMMODITY | FOREX. Picked
  // BEFORE the market-type (PERP/SPOT/BOTH) toggle so the user can first
  // narrow "I only care about FX today" then choose spot/perp within that.
  // Forex has no perp market on HL — when FOREX is selected we auto-flip
  // marketTypeFilter to SPOT (handled in the onClick below).
  const [assetClass, setAssetClass] = useState("ALL");
  const [preflight, setPreflight] = useState(null);
  const [preflightLoading, setPreflightLoading] = useState(false);

  const tradeCount = isElite ? 6 : isPro ? 4 : 2;
  const maxTokens = isElite ? 6144 : 4096;
  const freeLimit = 2;

  const fetchPreflight = useCallback(async () => {
    setPreflightLoading(true);
    try {
      const res = await fetch("/api/macro/preflight", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setPreflight(data);
        setPreflightLoading(false);
        return data;
      }
    } catch {}
    setPreflightLoading(false);
    return null;
  }, []);

  useEffect(() => { fetchPreflight(); }, [fetchPreflight]);

  const runTradeIdeas = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    setTrades(null);

    try {
      const freshPreflight = await fetchPreflight();

      // Pass marketTypeFilter so the snapshot drops the wrong-section data
      // (PERP → no spot prices, SPOT → no perp prices). This fixes the bug
      // where selecting PERP returned an AMD entry priced at the Yahoo
      // spot ($145) even though AMD has a real HL perp on the xyz dex
      // ($340.50). Old code injected both Section A (HL xyz:AMD perp) AND
      // Section C (Yahoo AMD spot); AI grabbed the cheaper spot and labeled
      // it PERP. New code: under PERP, only Section A is shown, so the AI
      // can only quote the real perp price. signalFilter:true drops assets
      // without pump/dump movement so the AI focuses on real movers.
      const snap = buildMarketSnapshot({
        storePerps, storeSpot, cryptoPrices, equityPrices, metalPrices, forexPrices,
        liveSignals, newsFeed, macroEvents, insiderData, regimeData,
        storeMode, storeTotalMarkets, storeAlerts,
        marketTypeFilter,
        signalFilter: true,
        assetClass,
      });

      const macroCtx = buildMacroPreflightContext(freshPreflight);

      const tm = timeframe === "today" ? TODAY_MODES[todayMode] : null;
      const tfLabel = timeframe === "midterm" ? "MID-TERM (1-4 week)"
        : timeframe === "longterm" ? "LONG-TERM (1-3 month)"
        : `TODAY ${tm.label} (${tm.subtitle})`;

      const todayModeRule = tm ? `
TIMEFRAME MODE: ${tm.label} — ${tm.subtitle}
- ATR reference: ${tm.atrRef}
- TP1 = ${tm.tp1Mult}× ATR (50% position), TP2 = ${tm.tp2Mult}× ATR (30%), trail remainder
- SL    = ${tm.slMult}× ATR
- Kill clock: ${tm.killClock}
- Max hold: ${tm.hold}
- Style: ${tm.style}
- Max leverage caps: crypto ${tm.maxLev.crypto}x, equity ${tm.maxLev.equity}x, commodity ${tm.maxLev.commodity}x, fx ${tm.maxLev.fx}x

CRITICAL: Scale TPs to this timeframe. A 5-minute scalp with a 5% TP will NEVER hit. Keep TPs TIGHT and REALISTIC for the hold duration.
- ${todayMode === "quick"   ? 'Quick mode: typical crypto TP1 = 0.3-0.8%, TP2 = 0.6-1.5%. SL ~0.4-0.6%.'
   : todayMode === "hours"  ? 'Hours mode: typical crypto TP1 = 0.5-2%, TP2 = 1-3%. SL ~0.7-1.5%.'
                            : 'Full Day mode: typical crypto TP1 = 1-4%, TP2 = 2-6%. SL ~1.2-2.5%.'}
- Set "killClock":"${tm.killClock}" on every trade
- Respect the leverage caps above` : "";

      const marketTypeRule = marketTypeFilter === "PERP"
        ? `MARKET TYPE FILTER: PERP ONLY.
- Recommend ONLY perpetual futures / leveraged trades from Hyperliquid.
- ENTRY / SL / TP must come from the Section A perp prices below — do NOT use any spot price (none are supplied; that is intentional).
- If an asset is NOT listed in Section A, you CANNOT recommend it for this run. Either it has no Hyperliquid perp, or it has been filtered out by the active pump/dump signal filter. Either way: pick a different asset from Section A.
- HL equity & commodity perps (e.g. AMD, TSLA, GOLD) are SYNTHETIC and trade 24/7 — their prices can decouple meaningfully from Yahoo/FMP spot during off-hours. Use ONLY the Section A perp price; never substitute a spot reference.
- Include leverage on every trade (respect asset class caps).
- Tight SL. Thesis MUST reference funding rate, OI, or liquidation levels from the data shown.
- Every trade MUST set "marketType":"PERP".`
        : marketTypeFilter === "SPOT"
        ? `MARKET TYPE FILTER: SPOT ONLY.
- Recommend ONLY spot / cash trades.
- ENTRY / SL / TP must come from Section B (HL spot) or Section C (CoinGecko/Yahoo/FMP) prices below — do NOT invent perp prices (none are supplied).
- If an asset is NOT listed in Section B or Section C, you CANNOT recommend it for this run (either no spot feed, or filtered out by pump/dump). Pick a different asset.
- NO leverage — set "leverage":"1x" on every trade.
- Thesis should reference accumulation zones, DCA levels, or portfolio allocation.
- SL can be wider, kill clock can be longer.
- Every trade MUST set "marketType":"SPOT".`
        : `MARKET TYPE FILTER: BOTH.
- Mix of PERP and SPOT opportunities — diversify across both.
- For each trade label "marketType":"PERP" or "SPOT" explicitly. PERP trades MUST use the Section A price; SPOT trades MUST use the Section B/C price.
- IMPORTANT: HL equity/commodity perps (Section A) and Yahoo/FMP spots (Section C) for the same ticker can show meaningfully different prices because the HL synthetic trades 24/7 while spot is the cash market. Treat them as two distinct instruments. PERP trade → quote Section A. SPOT trade → quote Section C. Never cross them.
- PERP trades: include leverage, tight SL, funding/OI rationale. SPOT trades: "leverage":"1x", wider SL acceptable, accumulation/DCA rationale.`;

      // ── Kronos forecast context (Elite) — pulled from in-memory cache populated by KronosPanel ──
      let kronosCtx = "";
      try {
        const cache = (typeof window !== "undefined" ? window.__clvrKronosCache : null) || {};
        const FRESH_MS = 60 * 60 * 1000; // 1 hour
        const now = Date.now();
        const rows = Object.entries(cache)
          .filter(([, v]) => v && (now - (v.ts || 0)) < FRESH_MS && v.ensemble_signal)
          .slice(0, 6)
          .map(([asset, v]) => {
            const ts = v.trajectories_summary || {};
            const traj = [ts.bear, ts.base, ts.bull].filter(x => typeof x === "number");
            const trajStr = traj.length === 3 ? ` · 5-candle trajectories (bear/base/bull): ${ts.bear.toFixed(2)} / ${ts.base.toFixed(2)} / ${ts.bull.toFixed(2)}` : "";
            const volStr = v.volatility_regime ? ` · vol ${v.volatility_regime}` : "";
            return `  ${asset} [${v.timeframe || "4h"}]: ${v.ensemble_signal}${volStr}${trajStr}`;
          });
        if (rows.length) {
          kronosCtx = `\n\nKRONOS FORECAST ENGINE SIGNALS (multi-trajectory K-line forecasts, AAAI 2026 inspired):\n${rows.join("\n")}\n→ For any asset listed above, you MUST align direction with the Kronos ensemble_signal:\n   STRONG_LONG / LONG → prefer LONG trades; STRONG_SHORT / SHORT → prefer SHORT trades; NEUTRAL → skip unless other evidence is overwhelming.\n→ If conviction + Kronos STRONG_LONG/STRONG_SHORT + OI confluence all agree, you MAY set kronos:true (Elite only, max 2 per batch).`;
        }
      } catch { /* ignore */ }

      const sys = `You are CLVRQuantAI's Trade Idea Generator. Return UP TO ${tradeCount} trade ideas as a JSON object. No markdown. No prose. Only valid JSON.

${marketTypeRule}
${todayModeRule}

MANDATORY STEP 1 — MACRO PRE-FLIGHT CHECK:
${macroCtx || "No macro data available. Proceed with CAUTION flag."}${kronosCtx}

RULES:
- Return UP TO ${tradeCount} trades, ranked by conviction (highest first). It is BETTER to return fewer trades — or an empty "trades":[] array with a one-line "reason" — than to invent setups for assets that are not present in the market data sections below. The user's filter has deliberately narrowed the universe; do not fabricate.
- Cover diverse assets (crypto, equity, FX, commodity — don't repeat unless one class dominates), but ONLY from the assets actually listed in the snapshot.
- ATR-scaled TP/SL: TP1=0.5x ATR(4H) at 50%, TP2=1x ATR at 30%, TP3=1.5x ATR at 20% trailing
- Vol regime: compare ATR to 20-period avg. HIGH(>1.5x): compress TP 30%, widen SL 20%. LOW(<0.7x): skip.
- Minimum R:R to TP1: 1.2:1
- Kill clock: SCALP 2-4H, DAY 12-24H, SWING 48-72H
- Edge label: "OI-verified" if live OI, "estimated" if inferred, "no OI" if unavailable
- Timeframe focus: ${tfLabel}
- ${isElite ? 'For qualifying signals with extreme conviction (>80%), OI confirmation, AND multi-TF confluence, set kronos:true. Maximum 2 Kronos per batch.' : 'Set kronos:false for all trades.'}

WRITING DISCIPLINE — these rules apply to every "thesis" string and any prose field. The server runs a mechanical risk hardener over your output AFTER you respond, and prose that violates these rules will be rewritten. Save us the round-trip:
- BANNED SUPERLATIVES (never use without ranked-comparison data): "largest", "biggest", "highest", "most", "standout", "exceptional", "unprecedented", "leading", "best-in-class". Prefer "elevated", "notable", "positive".
- REGIME CONSISTENCY: the regime label you cite in any thesis MUST match the top-level "regime.label" field of this same JSON response. The user sees both side-by-side; mismatches are immediately visible.
- SAMPLE-SIZE HONESTY: when the per-ticker Statistical Brain block shows fewer than 30 resolved trades for the (token, direction) combo, you MUST write "small sample (n=X)" in the thesis. Never call <30-trade backtests "statistically significant" or "robust".
- FUNDING CALIBRATION: |funding| < 0.01%/8h is "near-flat" — do NOT describe it as "trending", "momentum confirmation", or "consistent with directional flow". Funding only matters at ≥0.01%/8h magnitude.
- OI SCOPE: any open-interest figure refers to THAT symbol only. Do not write cross-asset comparisons ("BTC has the highest OI of any asset") unless the brief snapshot explicitly ranks them.
- CHASE DISCLOSURE: if a LONG entry is set after a >+4% 24h move (or SHORT after <-4%), the thesis must acknowledge it as a late entry / chase, not "fresh breakout".
- NUMBER MATCHING: any price, %, RR, or leverage value mentioned in the thesis must match the card's structured fields exactly — no rounding drift.

TODAY: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} | ET: ${snap.nowET}

${snap.sections}

RESPOND WITH THIS EXACT JSON STRUCTURE — nothing else:
{"generated":"ISO-DATE","regime":{"score":63,"label":"RISK-ON","bias":"Mean-Reversion"},"macroStatus":{"clear":true,"nextEvent":"Event name","notes":"..."},"volRegime":"HIGH","trades":[{"rank":1,"asset":"BTC/USDT","direction":"LONG","tradeType":"DAY TRADE","marketType":"PERP","entry":65000,"sl":63500,"tp1":{"price":67000,"pct":50,"rr":"1.3:1"},"tp2":{"price":69000,"pct":30,"rr":"2.4:1"},"tp3":{"price":71000,"pct":20,"trailing":true},"leverage":"3x","killClock":"24H","conviction":72,"edge":"72%","edgeSource":"OI-verified","volRegime":"NORMAL","thesis":"Short thesis.","invalidation":"Break below $63.5K","flags":["flag1"],"scores":{"trend":75,"momentum":80,"structure":68,"oi":65,"volume":55,"macro":70},"postTp1":"SL to breakeven","kronos":false}]}`;

      const userMsg = `Generate ${tfLabel} TOP ${tradeCount} TRADE IDEAS. Return ONLY valid JSON matching the structure. No markdown, no text. Use live prices.`;

      // Focus tickers — server uses these to attach per-ticker Statistical
      // Brain blocks (LONG+SHORT empirical edge from resolved-trade history)
      // AND intraday execution context (VWAP / ORH / ORL) for eligible spot
      // tickers (equities / FX / commodities — crypto/perps are skipped by
      // the eligibility check). Capped at 10 server-side. attachBrainSummary
      // additionally pulls the global top-combos table so the AI sees which
      // (token, direction) combos are PREFERRED vs SUPPRESSED across the
      // entire 957-trade history.
      const focusTickers = [
        "BTC", "ETH", "SOL", "HYPE", "DOGE",
        "NVDA", "TSLA", "MSTR",
        "XAU", "CL",
      ];

      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: sys,
          userMessage: userMsg,
          maxTokens,
          attachBrainSummary: true,
          tickers: focusTickers,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setError("PRO_REQUIRED");
        } else if (data.error === "__MAINTENANCE__" || res.status === 503) {
          setError("MAINTENANCE");
        } else {
          setError(data.error || `Error ${res.status}`);
        }
        setLoading(false);
        return;
      }

      const text = data.text || "";
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          setTrades(parsed);

          // ── Log trades to ai_signal_log for adaptive learning ──
          if (Array.isArray(parsed?.trades) && parsed.trades.length) {
            const payload = parsed.trades.map(t => {
              const killClockHours = (() => {
                const k = String(t.killClock || "").toUpperCase();
                const m = k.match(/(\d+)\s*H/);
                if (m) return parseInt(m[1], 10);
                if (k.includes("DAY")) return 24;
                if (k.includes("SWING")) return 72;
                if (k.includes("SCALP")) return 4;
                return 24;
              })();
              const symbol = String(t.asset || "").split("/")[0].toUpperCase();
              return {
                token: symbol,
                direction: t.direction,
                tradeType: t.tradeType,
                entry: t.entry,
                tp1: t.tp1?.price ?? t.tp1,
                tp2: t.tp2?.price ?? t.tp2,
                tp3: t.tp3?.price ?? t.tp3,
                sl: t.sl,
                leverage: t.leverage,
                conviction: typeof t.conviction === "number" ? t.conviction : null,
                edge: t.edge,
                edgeSource: t.edgeSource,
                kronos: !!t.kronos,
                killClockHours,
                thesis: t.thesis,
                invalidation: t.invalidation,
                scores: t.scores,
              };
            });
            fetch("/api/ai/log-trades", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ trades: payload }),
            }).catch(() => {});
          }
        } else {
          setError("Failed to parse trade ideas. Please try again.");
        }
      } catch (parseErr) {
        setError("Failed to parse AI response. Please try again.");
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const tradesList = trades?.trades || [];

  return (
    <div data-testid="section-trade-ideas" style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontFamily: SERIF, color: "#e0e0e0", fontWeight: 700 }}>Trade Ideas</h3>
          <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: MONO, marginTop: 2, letterSpacing: "0.08em" }}>
            AI-GENERATED · {tradeCount} SIGNALS · {timeframe === "today" ? "INTRADAY" : timeframe === "midterm" ? "MID-TERM" : "LONG-TERM"}
          </div>
        </div>
        {isPro && (
          <div style={{ display: "flex", gap: 4 }}>
            {[{ k: "today", l: "Today" }, { k: "midterm", l: "Mid-Term" }, { k: "longterm", l: "Long-Term" }].map(t => (
              <button key={t.k} data-testid={`btn-tf-${t.k}`} onClick={() => setTimeframe(t.k)} style={{
                padding: "5px 10px", borderRadius: 6, border: `1px solid ${timeframe === t.k ? "rgba(201,168,76,0.4)" : "rgba(255,255,255,0.08)"}`,
                background: timeframe === t.k ? "rgba(201,168,76,0.1)" : "transparent",
                color: timeframe === t.k ? "#e8c96d" : "rgba(255,255,255,0.4)",
                fontFamily: MONO, fontSize: 9, cursor: "pointer", fontWeight: timeframe === t.k ? 700 : 400,
              }}>{t.l}</button>
            ))}
          </div>
        )}
      </div>

      {isPro && timeframe === "today" && (
        <div style={{ display: "flex", gap: 4, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: MONO, letterSpacing: "0.1em", marginRight: 2 }}>HORIZON:</span>
          {Object.entries(TODAY_MODES).map(([key, m]) => {
            const sel = todayMode === key;
            return (
              <button key={key} data-testid={`btn-todaymode-${key}`} onClick={() => setTodayMode(key)} style={{
                padding: "5px 10px", borderRadius: 6,
                border: `1px solid ${sel ? "rgba(201,168,76,0.4)" : "rgba(255,255,255,0.08)"}`,
                background: sel ? "rgba(201,168,76,0.1)" : "transparent",
                color: sel ? "#e8c96d" : "rgba(255,255,255,0.4)",
                fontFamily: MONO, fontSize: 9, cursor: "pointer", fontWeight: sel ? 700 : 400,
                display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2,
              }}>
                <span>{m.label}</span>
                <span style={{ fontSize: 7, opacity: 0.7, marginTop: 1 }}>{m.subtitle}</span>
              </button>
            );
          })}
        </div>
      )}

      {isPro && (
        <div style={{ display: "flex", gap: 4, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: MONO, letterSpacing: "0.1em", marginRight: 2 }}>ASSET CLASS:</span>
          {[
            { k: "ALL",       l: "All",         col: "#e8c96d" },
            { k: "CRYPTO",    l: "Crypto",      col: "#f7931a" },
            { k: "EQUITY",    l: "Equities",    col: "#22c55e" },
            { k: "COMMODITY", l: "Commodities", col: "#eab308" },
            { k: "FOREX",     l: "Forex",       col: "#3b82f6" },
          ].map(({ k, l, col }) => {
            const sel = assetClass === k;
            return (
              <button key={k} data-testid={`btn-assetclass-${k.toLowerCase()}`} onClick={() => {
                setAssetClass(k);
                // FX has no perp market on HL — auto-flip to SPOT so the
                // user doesn't sit in a permanently-empty PERP+FOREX state.
                if (k === "FOREX" && marketTypeFilter === "PERP") setMarketTypeFilter("SPOT");
              }} style={{
                padding: "5px 10px", borderRadius: 6,
                border: `1px solid ${sel ? col : "rgba(255,255,255,0.08)"}`,
                background: sel ? `${col}15` : "transparent",
                color: sel ? col : "rgba(255,255,255,0.4)",
                fontFamily: MONO, fontSize: 9, cursor: "pointer", fontWeight: sel ? 700 : 400, letterSpacing: "0.06em",
              }}>{l}</button>
            );
          })}
        </div>
      )}

      {isPro && (
        <div style={{ display: "flex", gap: 4, marginBottom: 10, alignItems: "center" }}>
          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: MONO, letterSpacing: "0.1em", marginRight: 2 }}>MARKET:</span>
          {["PERP", "SPOT", "BOTH"].map(m => {
            const col = m === "PERP" ? "#00d4ff" : m === "SPOT" ? "#a855f7" : "#e8c96d";
            const sel = marketTypeFilter === m;
            // FX has no perp listings on HL — disable PERP under FOREX class.
            const disabled = assetClass === "FOREX" && m === "PERP";
            return (
              <button
                key={m}
                data-testid={`btn-market-${m}`}
                onClick={() => { if (!disabled) setMarketTypeFilter(m); }}
                disabled={disabled}
                title={disabled ? "Forex has no perp market — use SPOT or BOTH" : ""}
                style={{
                  padding: "5px 12px", borderRadius: 6,
                  border: `1px solid ${sel ? col : "rgba(255,255,255,0.08)"}`,
                  background: sel ? `${col}15` : "transparent",
                  color: disabled ? "rgba(255,255,255,0.15)" : sel ? col : "rgba(255,255,255,0.4)",
                  fontFamily: MONO, fontSize: 9, cursor: disabled ? "not-allowed" : "pointer",
                  fontWeight: sel ? 700 : 400, letterSpacing: "0.06em",
                  opacity: disabled ? 0.5 : 1,
                }}
              >{m}</button>
            );
          })}
        </div>
      )}

      <MacroPreFlight data={preflight} loading={preflightLoading} />

      <button
        data-testid="btn-generate-trades"
        onClick={runTradeIdeas}
        disabled={loading}
        style={{
          width: "100%", height: 48, marginBottom: 16,
          background: loading ? "rgba(201,168,76,0.04)" : "linear-gradient(135deg, rgba(201,168,76,0.12), rgba(201,168,76,0.06))",
          border: `1px solid ${loading ? "rgba(201,168,76,0.1)" : "rgba(201,168,76,0.3)"}`,
          borderRadius: 10, cursor: loading ? "not-allowed" : "pointer",
          color: loading ? "rgba(255,255,255,0.3)" : "#e8c96d",
          fontFamily: SERIF, fontStyle: "italic", fontWeight: 700, fontSize: 14,
          letterSpacing: "0.02em", transition: "all 0.3s",
        }}
      >
        {loading ? "QuantBrain Analyzing..." : `Generate Top ${tradeCount} Trade Ideas ✦`}
      </button>

      {error === "PRO_REQUIRED" && (
        <div style={{ textAlign: "center", padding: "32px 16px", background: "rgba(201,168,76,0.04)", border: "1px solid rgba(201,168,76,0.15)", borderRadius: 10 }}>
          <div style={{ fontSize: 24, marginBottom: 10 }}>✦</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e8c96d", fontFamily: SERIF, marginBottom: 8 }}>PRO FEATURE</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: SANS, lineHeight: 1.7 }}>
            AI Trade Ideas are exclusive to Pro subscribers.
          </div>
        </div>
      )}

      {error === "MAINTENANCE" && (
        <div style={{ textAlign: "center", padding: "32px 16px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10 }}>
          <div style={{ fontSize: 24, marginBottom: 10 }}>🔧</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: SANS }}>AI engine is under maintenance. Please try again shortly.</div>
        </div>
      )}

      {error && error !== "PRO_REQUIRED" && error !== "MAINTENANCE" && (
        <div style={{ padding: "12px 14px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: "#ef4444", fontFamily: MONO }}>{error}</div>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", padding: "32px 16px" }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>🧠</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#e8c96d", fontFamily: MONO, letterSpacing: "0.1em", marginBottom: 8 }}>QUANTBRAIN ACTIVE</div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>Scanning markets for high-conviction setups...</div>
          <div style={{ width: "60%", margin: "12px auto", height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: "60%", background: "linear-gradient(90deg, #c9a84c, #e8c96d)", borderRadius: 3, animation: "pulse 1.5s ease-in-out infinite" }} />
          </div>
        </div>
      )}

      {tradesList.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {tradesList.map((trade, i) => {
            const locked = !isPro && i >= freeLimit;
            return (
              <div key={i} style={{ position: "relative" }}>
                <TradeIdeaCard trade={trade} rank={trade.rank || i + 1} mode={mode} isElite={isElite} locked={locked} onAlertCreated={onAlertCreated} />
                {locked && (
                  <div style={{
                    position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    background: "rgba(6,10,19,0.7)", borderRadius: 12, zIndex: 2,
                  }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 20, marginBottom: 6 }}>🔒</div>
                      <div style={{ fontSize: 10, color: "#e8c96d", fontFamily: MONO, fontWeight: 700 }}>PRO</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {trades && tradesList.length === 0 && !loading && (
        <div style={{ textAlign: "center", padding: "32px 16px", background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 10 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⛔</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#ef4444", fontFamily: MONO, marginBottom: 6 }}>NO HIGH-CONVICTION SETUPS</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: SANS }}>Macro conditions or regime prevented signal generation. Try again later.</div>
        </div>
      )}
    </div>
  );
}
```

#### `client/src/components/ai/TradeIdeaCard.jsx`
```jsx
import { useState } from "react";

const MONO = "'IBM Plex Mono', monospace";
const SERIF = "'Playfair Display', Georgia, serif";
const SANS = "'Barlow', system-ui, sans-serif";

function convictionColor(v) {
  if (v >= 65) return "#22c55e";
  if (v >= 40) return "#f59e0b";
  return "#ef4444";
}

function copyToClipboard(text) {
  try { navigator.clipboard.writeText(text); } catch { }
}

export default function TradeIdeaCard({ trade, rank, mode, isElite, locked, onAlertCreated }) {
  const [copied, setCopied] = useState(false);
  const [alertStatus, setAlertStatus] = useState(null);
  const isLong = trade.direction === "LONG";
  const borderColor = trade.kronos ? "#c9a84c" : isLong ? "#22c55e" : "#ef4444";
  const dirColor = isLong ? "#22c55e" : "#ef4444";
  const dirEmoji = isLong ? "🟢" : "🔴";

  const entry = trade.entry;
  const tp1 = trade.tp1?.price || trade.tp1;
  const sl = trade.sl;
  const tp1Pct = entry && tp1 ? (((tp1 - entry) / entry) * 100).toFixed(1) : null;
  const slPct = entry && sl ? (((sl - entry) / entry) * 100).toFixed(1) : null;
  const rr = trade.tp1?.rr || (entry && tp1 && sl ? `${(Math.abs(tp1 - entry) / Math.abs(entry - sl)).toFixed(1)}:1` : "—");
  const rawConviction = trade.conviction || 0;
  // ConvictionCap (May 2026): if the server capped the displayed value,
  // show that — never the raw ≥50 number — and surface a REVIEW chip so
  // users know the historical record above this threshold is unreliable.
  const hasCap = typeof trade.displayedConviction === "number"
    && trade.displayedConviction < rawConviction;
  const conviction = hasCap ? trade.displayedConviction : rawConviction;
  const reviewFlag = !!trade.highConvictionReview;
  const cColor = convictionColor(conviction);

  const fmtP = (p) => {
    if (!p && p !== 0) return "—";
    const n = Number(p);
    if (isNaN(n)) return "—";
    if (n >= 1000) return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (n >= 1) return "$" + n.toFixed(2);
    return "$" + n.toFixed(6);
  };

  const handleCopy = () => {
    const txt = `${trade.asset} ${trade.direction} | Entry: ${fmtP(entry)} | TP1: ${fmtP(tp1)} | SL: ${fmtP(sl)} | R:R: ${rr}`;
    copyToClipboard(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSetAlert = async () => {
    if (alertStatus === "saving" || alertStatus === "done") return;
    if (!entry) return;
    setAlertStatus("saving");
    try {
      const sym = (trade.asset || "").replace(/\/USDT?$/i, "").replace(/\/USD$/i, "").trim();
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sym,
          field: "price",
          condition: isLong ? "<=": ">=",
          threshold: entry,
          label: `${trade.direction} ${sym} entry @ ${fmtP(entry)}`,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed");
      }
      setAlertStatus("done");
      if (onAlertCreated) onAlertCreated();
      setTimeout(() => setAlertStatus(null), 3000);
    } catch {
      setAlertStatus("error");
      setTimeout(() => setAlertStatus(null), 2500);
    }
  };

  const killClockSimple = (kc) => {
    if (!kc) return "";
    const h = parseInt(kc);
    if (h <= 4) return "Exit within a few hours";
    if (h <= 24) return "Exit by tonight if no move";
    if (h <= 72) return "Hold 1-3 days";
    return `Hold up to ${kc}`;
  };

  // Parse killClock → hours (for "Exit by" timestamp)
  const parseKillHours = (kc) => {
    if (!kc) return null;
    const s = String(kc).toUpperCase().trim();
    const minMatch = s.match(/(\d+)\s*MIN/);
    if (minMatch) return parseInt(minMatch[1], 10) / 60;
    const hMatch = s.match(/(\d+(?:\.\d+)?)\s*H/);
    if (hMatch) return parseFloat(hMatch[1]);
    if (s.includes("DAY")) return 24;
    if (s.includes("SWING")) return 72;
    if (s.includes("SCALP")) return 4;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };
  const killHours = parseKillHours(trade.killClock);
  const exitByLabel = killHours
    ? new Date(Date.now() + killHours * 3600000).toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: killHours >= 24 ? "short" : undefined,
        hour: "numeric", minute: "2-digit",
      }) + " ET"
    : null;
  const holdLabel = killHours
    ? killHours < 1 ? `${Math.round(killHours * 60)} min`
      : killHours <= 4 ? `${Math.round(killHours)}H`
      : killHours <= 12 ? "Today"
      : killHours <= 24 ? "Today/Overnight"
      : `${Math.round(killHours / 24)}D`
    : null;

  return (
    <div
      data-testid={`trade-idea-card-${rank}`}
      style={{
        background: locked ? "#0c1220" : "#0c1220",
        border: "1px solid rgba(201,168,76,0.15)",
        borderLeft: `4px solid ${borderColor}`,
        borderRadius: 12,
        overflow: "hidden",
        transition: "box-shadow 0.2s",
        filter: locked ? "blur(6px)" : "none",
        userSelect: locked ? "none" : "auto",
        pointerEvents: locked ? "none" : "auto",
        position: "relative",
      }}
    >
      {trade.kronos && (
        <div style={{ background: "rgba(201,168,76,0.08)", padding: "4px 12px", display: "flex", alignItems: "center", gap: 6, borderBottom: "1px solid rgba(201,168,76,0.1)" }}>
          <span style={{ fontSize: 10 }}>⚡</span>
          <span style={{ fontSize: 8, fontWeight: 700, color: "#c9a84c", fontFamily: MONO, letterSpacing: "0.1em" }}>KRONOS — HIGH CONVICTION</span>
        </div>
      )}

      <div style={{ padding: "14px 14px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: "#e0e0e0", fontFamily: MONO }}>#{rank}</span>
              {mode === "pro" && trade.tradeType && (
                <span style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>{trade.tradeType}</span>
              )}
            </div>
            <div style={{ fontSize: 15, fontWeight: 900, color: "#e0e0e0", fontFamily: SERIF }}>{trade.asset}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {mode === "pro" && trade.volRegime && (
              <span style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>Vol: {trade.volRegime === "HIGH" ? "🔴" : trade.volRegime === "LOW" ? "🟢" : "🟡"} {trade.volRegime}</span>
            )}
            <span style={{
              fontSize: 11, fontWeight: 800, color: dirColor,
              background: `${dirColor}15`, border: `1px solid ${dirColor}40`,
              borderRadius: 6, padding: "4px 10px", fontFamily: MONO,
            }}>
              {dirEmoji} {trade.direction}
            </span>
          </div>
        </div>
      </div>

      <div style={{ padding: "0 14px", borderTop: "1px solid rgba(201,168,76,0.08)" }}>
        <div style={{ display: "grid", gridTemplateColumns: mode === "pro" ? "1fr" : "1fr", gap: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: MONO }}>Entry</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#c9a84c", fontFamily: MONO }}>{fmtP(entry)}</span>
          </div>

          {mode === "simple" ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: MONO }}>Target</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#22c55e", fontFamily: MONO }}>
                  {fmtP(tp1)}{tp1Pct ? <span style={{ fontSize: 9, marginLeft: 6, color: "#22c55e88" }}>({tp1Pct > 0 ? "+" : ""}{tp1Pct}%)</span> : ""}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: MONO }}>Stop</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#ef4444", fontFamily: MONO }}>
                  {fmtP(sl)}{slPct ? <span style={{ fontSize: 9, marginLeft: 6, color: "#ef444488" }}>({slPct > 0 ? "+" : ""}{slPct}%)</span> : ""}
                </span>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>TP1 ({trade.tp1?.pct || 50}%)</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#22c55e", fontFamily: MONO }}>{fmtP(tp1)} <span style={{ fontSize: 8, color: "#22c55e88" }}>{trade.tp1?.rr || ""}</span></span>
              </div>
              {trade.tp2 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>TP2 ({trade.tp2?.pct || 30}%)</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#22c55e", fontFamily: MONO }}>{fmtP(trade.tp2?.price || trade.tp2)} <span style={{ fontSize: 8, color: "#22c55e88" }}>{trade.tp2?.rr || ""}</span></span>
                </div>
              )}
              {trade.tp3 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>TP3 ({trade.tp3?.pct || 20}%) {trade.tp3?.trailing ? "trail" : ""}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#22c55e", fontFamily: MONO }}>{fmtP(trade.tp3?.price || trade.tp3)}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>SL</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", fontFamily: MONO }}>{fmtP(sl)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* PROMINENT LEVERAGE + HOLD-TIME STRIP — visible in BOTH simple & pro modes */}
      {(trade.leverage || holdLabel) && (
        <div data-testid={`leverage-hold-strip-${rank}`} style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 0,
          padding: "10px 14px",
          margin: "0 14px 8px",
          background: "rgba(0,0,0,0.3)",
          border: "1px solid rgba(201,168,76,0.12)",
          borderRadius: 8,
        }}>
          <div style={{ borderRight: "1px solid rgba(255,255,255,0.06)", paddingRight: 10 }}>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.45)", fontFamily: MONO, letterSpacing: "0.1em", marginBottom: 3 }}>⚡ LEVERAGE</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#c9a84c", fontFamily: MONO, lineHeight: 1 }}>
              {trade.leverage || "—"}{trade.leverage && !String(trade.leverage).includes("MAX") ? <span style={{ fontSize: 9, fontWeight: 400, color: "rgba(201,168,76,0.6)", marginLeft: 4 }}>MAX</span> : null}
            </div>
          </div>
          <div style={{ paddingLeft: 12 }}>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.45)", fontFamily: MONO, letterSpacing: "0.1em", marginBottom: 3 }}>⏱ HOLD TIME</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#e0e0e0", fontFamily: MONO, lineHeight: 1 }}>{holdLabel || "—"}</div>
            {exitByLabel && (
              <div style={{ fontSize: 8, color: "#00d4ff", fontFamily: MONO, marginTop: 4, letterSpacing: "0.04em" }}>
                Exit by: {exitByLabel}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ padding: "10px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>R:R</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: "#e0e0e0", fontFamily: MONO }}>{rr}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${conviction}%`,
              background: `linear-gradient(90deg, ${cColor}80, ${cColor})`,
              borderRadius: 3, transition: "width 1.2s ease",
            }} />
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, color: cColor, fontFamily: MONO, minWidth: 32, textAlign: "right" }} data-testid={`text-conviction-${trade.asset || "card"}`}>{conviction}%</span>
        </div>
        {reviewFlag && (
          <div
            title="Raw model conviction was ≥50, where historical win-rate falls to ~20%. Displayed value capped at 49 until the conviction model is recalibrated."
            data-testid={`chip-review-${trade.asset || "card"}`}
            style={{
              marginTop: 6, display: "inline-block",
              fontSize: 9, fontWeight: 700, letterSpacing: 0.6, fontFamily: MONO,
              color: "#f59e0b", background: "rgba(245,158,11,0.10)",
              border: "1px solid #f59e0b55", borderRadius: 3,
              padding: "2px 6px",
            }}
          >
            REVIEW
          </div>
        )}

        {mode === "pro" && (
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            {trade.edge && <span style={{ fontSize: 8, color: "#00d4ff", fontFamily: MONO }}>Edge: {trade.edge} ({trade.edgeSource || "est"})</span>}
            {trade.leverage && <span style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>Lev: {trade.leverage}</span>}
            {trade.killClock && <span style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>Kill: {trade.killClock}</span>}
          </div>
        )}

        {mode === "pro" && trade.scores && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4, marginTop: 10 }}>
            {Object.entries(trade.scores).map(([k, v]) => (
              <div key={k} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontFamily: MONO, letterSpacing: "0.06em", marginBottom: 2 }}>{k.substring(0, 4).toUpperCase()}</div>
                <div style={{ height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${v}%`, height: "100%", background: v >= 65 ? "#22c55e" : v >= 40 ? "#f59e0b" : "#ef4444", borderRadius: 2 }} />
                </div>
                <div style={{ fontSize: 8, color: "rgba(255,255,255,0.5)", fontFamily: MONO, marginTop: 1 }}>{v}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: "0 14px 12px" }}>
        <div style={{ fontSize: 11, color: "#e0e0e0", fontFamily: SANS, lineHeight: 1.7 }}>{trade.thesis}</div>

        {mode === "simple" && trade.killClock && (
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: SANS, marginTop: 6 }}>
            ⏱ {killClockSimple(trade.killClock)}
          </div>
        )}

        {mode === "pro" && trade.invalidation && (
          <div style={{ fontSize: 9, color: "#ef4444", fontFamily: SANS, marginTop: 6 }}>
            ✖ {trade.invalidation}
          </div>
        )}
        {mode === "pro" && trade.postTp1 && (
          <div style={{ fontSize: 9, color: "#22c55e", fontFamily: SANS, marginTop: 4 }}>
            ✓ Post-TP1: {trade.postTp1}
          </div>
        )}

        {trade.flags?.length > 0 && mode === "pro" && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
            {trade.flags.map((f, i) => (
              <span key={i} style={{ fontSize: 7, color: "#ff8c00", fontFamily: MONO, background: "rgba(255,140,0,0.08)", padding: "2px 6px", borderRadius: 3 }}>{f}</span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, borderTop: "1px solid rgba(201,168,76,0.08)" }}>
        <button
          data-testid={`btn-copy-trade-${rank}`}
          onClick={handleCopy}
          style={{ padding: "10px 8px", background: "transparent", border: "none", borderRight: "1px solid rgba(201,168,76,0.08)", color: copied ? "#22c55e" : "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: MONO, fontSize: 9, fontWeight: 600 }}
        >
          {copied ? "✓ Copied!" : "📋 Copy Trade"}
        </button>
        <button
          data-testid={`btn-alert-trade-${rank}`}
          onClick={handleSetAlert}
          disabled={alertStatus === "saving" || alertStatus === "done"}
          style={{
            padding: "10px 8px", background: "transparent", border: "none",
            color: alertStatus === "done" ? "#22c55e" : alertStatus === "error" ? "#ef4444" : alertStatus === "saving" ? "rgba(255,255,255,0.3)" : "#c9a84c",
            cursor: alertStatus === "saving" || alertStatus === "done" ? "default" : "pointer",
            fontFamily: MONO, fontSize: 9, fontWeight: 600,
          }}
        >
          {alertStatus === "saving" ? "⏳ Saving..." : alertStatus === "done" ? "✓ Alert Set!" : alertStatus === "error" ? "✖ Failed" : "⏰ Set Alert"}
        </button>
      </div>
    </div>
  );
}
```

#### `client/src/components/ai/SignalCard.jsx`
```jsx
import { useState } from "react";

const MONO = "'IBM Plex Mono', monospace";
const SERIF = "'Playfair Display', Georgia, serif";
const SANS = "'Barlow', system-ui, sans-serif";

function convictionColor(v) {
  if (v >= 65) return "#22c55e";
  if (v >= 40) return "#f59e0b";
  return "#ef4444";
}

function tierLabel(score) {
  if (score >= 90) return { key: "S", color: "#c9a84c", bg: "rgba(201,168,76,0.15)", border: "#c9a84c" };
  if (score >= 80) return { key: "A", color: "#22c55e", bg: "rgba(34,197,94,0.12)", border: "#22c55e" };
  if (score >= 70) return { key: "B", color: "#f59e0b", bg: "rgba(245,158,11,0.12)", border: "#f59e0b" };
  return { key: "C", color: "#ef4444", bg: "rgba(239,68,68,0.12)", border: "#ef4444" };
}

function copyToClipboard(text) {
  try { navigator.clipboard.writeText(text); } catch { }
}

export default function SignalCard({ ticker, result, rank, mode }) {
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!result || result.signal === "SUPPRESSED") return null;

  const isLong = result.signal?.includes("LONG");
  const borderColor = result.kronos ? "#c9a84c" : isLong ? "#22c55e" : "#ef4444";
  const dirColor = isLong ? "#22c55e" : "#ef4444";

  const winProb = result.win_probability || result.adjusted_score || 75;
  const tier = tierLabel(winProb);
  const cColor = convictionColor(winProb);

  const entry = result.entry?.price;
  const tp1 = result.tp1?.price;
  const tp2 = result.tp2?.price;
  const sl = result.stopLoss?.price;
  const rr = result.rr || (entry && tp1 && sl ? Math.abs(tp1 - entry) / Math.abs(entry - sl) : null);
  const leverage = result.leverage?.recommended || result.leverage?.max || result.leverage?.min || "—";
  const duration = result.hold?.duration || result.hold || "—";

  const fmtP = (p) => {
    if (!p && p !== 0) return "—";
    const n = Number(p);
    if (isNaN(n)) return "—";
    if (n >= 1000) return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (n >= 1) return "$" + n.toFixed(2);
    return "$" + n.toFixed(6);
  };

  const handleCopy = () => {
    const txt = `${ticker} ${isLong ? "LONG" : "SHORT"} | Entry: ${fmtP(entry)} | TP1: ${fmtP(tp1)} | SL: ${fmtP(sl)} | LEV: ${leverage}x`;
    copyToClipboard(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div data-testid={`signal-card-${ticker}`} style={{
      background: "#0c1220", border: "1px solid rgba(201,168,76,0.15)",
      borderLeft: `4px solid ${borderColor}`, borderRadius: 12, overflow: "hidden",
    }}>
      {result.kronos && (
        <div style={{ background: "rgba(201,168,76,0.08)", padding: "4px 12px", display: "flex", alignItems: "center", gap: 6, borderBottom: "1px solid rgba(201,168,76,0.1)" }}>
          <span style={{ fontSize: 10 }}>⚡</span>
          <span style={{ fontSize: 8, fontWeight: 700, color: "#c9a84c", fontFamily: MONO, letterSpacing: "0.1em" }}>KRONOS — HIGH CONVICTION</span>
        </div>
      )}

      <div style={{ padding: "14px 14px 10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: "#e0e0e0", fontFamily: MONO }}>#{rank + 1}</span>
            <span style={{ fontSize: 14, fontWeight: 900, color: "#e0e0e0", fontFamily: SERIF }}>{ticker}/USDT</span>
            {result.archetype && (() => {
              // Module 2 T11 — abbreviated badges per spec. Full archetype
              // name + reason still surface in the tooltip so the
              // information density of Module 1 is preserved.
              const palette = {
                NEWS_MOMO:                 { fg: "#f87171", bg: "rgba(248,113,113,0.12)", bd: "#f8717155", label: "NEWS" },
                MEAN_REVERSION_EXHAUSTION: { fg: "#a78bfa", bg: "rgba(167,139,250,0.12)", bd: "#a78bfa55", label: "MEAN-REV" },
                BREAKOUT_RETEST:           { fg: "#22d3ee", bg: "rgba(34,211,238,0.12)",  bd: "#22d3ee55", label: "BREAKOUT-RT" },
                VWAP_RECLAIM:              { fg: "#34d399", bg: "rgba(52,211,153,0.12)",  bd: "#34d39955", label: "VWAP-RCLM" },
                TREND_PULLBACK:            { fg: "#fbbf24", bg: "rgba(251,191,36,0.12)",  bd: "#fbbf2455", label: "PULLBACK" },
                RANGE_FADE:                { fg: "#94a3b8", bg: "rgba(148,163,184,0.12)", bd: "#94a3b855", label: "RANGE" },
                UNCLASSIFIED:              { fg: "#6b7280", bg: "rgba(107,114,128,0.10)", bd: "#6b728044", label: "UNCLASSIFIED — exp" },
              }[result.archetype] || { fg: "#94a3b8", bg: "rgba(148,163,184,0.10)", bd: "#94a3b833", label: result.archetype };
              // Hide the UNCLASSIFIED experimental badge unless the display
              // flag is on — keeps the default UI clean during the shadow
              // rollout while admin still gets full visibility via diagnostics.
              const useArchDisplay = String(import.meta.env.VITE_USE_ARCHETYPE_DISPLAY || "").toLowerCase() === "true";
              if (result.archetype === "UNCLASSIFIED" && !useArchDisplay) return null;
              const tip = result.archetype_reason
                ? `${result.archetype} · ${result.archetype_reason}${result.archetype_flipped_from ? ` · direction flipped from ${result.archetype_flipped_from} (fade)` : ""}`
                : result.archetype === "UNCLASSIFIED"
                  ? "No matching setup archetype — published in shadow mode for measurement"
                  : result.archetype;
              return (
                <span
                  data-testid={`badge-archetype-${ticker}`}
                  title={tip}
                  style={{
                    fontSize: 8, fontWeight: 800, color: palette.fg,
                    background: palette.bg, border: `1px solid ${palette.bd}`,
                    borderRadius: 4, padding: "2px 6px",
                    fontFamily: MONO, letterSpacing: "0.06em",
                  }}
                >
                  {palette.label}
                  {result.archetype_flipped_from && <span style={{ marginLeft: 4 }}>↺</span>}
                </span>
              );
            })()}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              fontSize: 11, fontWeight: 800, color: dirColor,
              background: `${dirColor}15`, border: `1px solid ${dirColor}40`,
              borderRadius: 6, padding: "3px 10px", fontFamily: MONO,
            }}>{isLong ? "↑ LONG" : "↓ SHORT"}</span>
            {tier.key && (
              <div style={{
                fontSize: 14, fontWeight: 900, color: tier.color,
                background: tier.bg, border: `2px solid ${tier.border}`,
                borderRadius: 6, width: 30, height: 30,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>{tier.key}</div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${winProb}%`, background: `linear-gradient(90deg, ${cColor}80, ${cColor})`, borderRadius: 3, transition: "width 1.2s ease" }} />
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, color: cColor, fontFamily: MONO }}>{winProb}%</span>
        </div>
      </div>

      {result.hardening?.adjustments?.length > 0 && (
        <div data-testid={`hardening-badges-${ticker}`} style={{
          display: "flex", flexWrap: "wrap", gap: 6,
          padding: "6px 14px 8px", borderTop: "1px solid rgba(255,255,255,0.04)",
        }}>
          {result.hardening.adjustments.map((a, i) => {
            const palette = a.type === "atr_widened"        ? { fg: "#22c55e", bg: "rgba(34,197,94,0.10)",  bd: "#22c55e55", label: "ATR-adjusted SL" }
                          : a.type === "size_reduced"       ? { fg: "#f59e0b", bg: "rgba(245,158,11,0.10)", bd: "#f59e0b55", label: `Size ${Math.round((a.after ?? 1) * 100)}%` }
                          : a.type === "liquidity_shifted"  ? { fg: "#22c55e", bg: "rgba(34,197,94,0.10)",  bd: "#22c55e55", label: "Liquidity-shifted SL" }
                          : a.type === "conviction_penalty" ? { fg: "#f59e0b", bg: "rgba(245,158,11,0.10)", bd: "#f59e0b55", label: "Counter-trend −15" }
                          :                                   { fg: "#e0e0e0", bg: "rgba(255,255,255,0.05)", bd: "rgba(255,255,255,0.10)", label: a.type };
            return (
              <span key={i} title={a.detail} style={{
                fontSize: 9, fontWeight: 700, color: palette.fg, background: palette.bg,
                border: `1px solid ${palette.bd}`, borderRadius: 4, padding: "2px 7px",
                fontFamily: MONO, letterSpacing: "0.04em", textTransform: "uppercase",
              }}>{palette.label}</span>
            );
          })}
        </div>
      )}

      {entry && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 0, borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          {[
            { label: "ENTRY", value: fmtP(entry), color: "#c9a84c" },
            { label: "TP1 🎯", value: fmtP(tp1), color: "#22c55e" },
            { label: "TP2", value: fmtP(tp2), color: "#22c55eaa" },
            { label: "SL 🛑", value: fmtP(sl), color: "#ef4444" },
          ].map((item, i) => (
            <div key={item.label} style={{ padding: "8px 10px", borderRight: i < 3 ? "1px solid rgba(255,255,255,0.04)" : "none", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <div style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontFamily: MONO, letterSpacing: "0.06em", marginBottom: 3 }}>{item.label}</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: item.color, fontFamily: MONO }}>{item.value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ padding: "8px", borderRight: "1px solid rgba(255,255,255,0.04)", textAlign: "center" }}>
          <div style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontFamily: MONO, marginBottom: 3 }}>LEVERAGE</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#e0e0e0", fontFamily: MONO }}>{leverage}x</div>
        </div>
        <div style={{ padding: "8px", borderRight: "1px solid rgba(255,255,255,0.04)", textAlign: "center" }}>
          <div style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontFamily: MONO, marginBottom: 3 }}>R:R</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: rr >= 2 ? "#22c55e" : rr >= 1.5 ? "#f59e0b" : "#ef4444", fontFamily: MONO }}>{rr ? `${rr.toFixed ? rr.toFixed(1) : rr}:1` : "—"}</div>
          {result.rrAfterFriction !== undefined && result.rrAfterFriction !== null && (
            <div title="R:R after slippage + funding cost" style={{ fontSize: 8, color: "rgba(255,255,255,0.45)", fontFamily: MONO, marginTop: 2 }}>
              net {Number(result.rrAfterFriction).toFixed(2)}:1
            </div>
          )}
          {Number.isFinite(result.sizeMultiplier) && result.sizeMultiplier < 1 && (
            <div data-testid={`text-size-mult-${ticker}`} title="Mechanical risk gates reduced size — your stop is wider than the original ATR floor, so position size was scaled down to keep $-risk constant. Multiply your normal position size by this number." style={{ fontSize: 8, color: "#f59e0b", fontFamily: MONO, marginTop: 2, fontWeight: 700 }}>
              size ×{Number(result.sizeMultiplier).toFixed(2)}
            </div>
          )}
        </div>
        <div style={{ padding: "8px", textAlign: "center" }}>
          <div style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontFamily: MONO, marginBottom: 3 }}>DURATION</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#00d4ff", fontFamily: MONO }}>{duration}</div>
        </div>
      </div>

      {result.archetype_stats && result.archetype_stats.n > 0 && (() => {
        const s = result.archetype_stats;
        // Module 2 T04: Wilson 80% LCB is the primary display number. Fall back
        // to 95% LB if the server hasn't been updated yet (one-release transition).
        const lcb80 = (typeof s.wr_wilson_lb_80 === "number" ? s.wr_wilson_lb_80 : s.wr_wilson_lb) ?? 0;
        const rawPct = (s.wr_point * 100).toFixed(0);
        const lcb80Pct = (lcb80 * 100).toFixed(0);
        const wlb95Pct = (s.wr_wilson_lb * 100).toFixed(0);
        const holdHrs = s.p75_hold_min > 60 ? `${(s.p75_hold_min / 60).toFixed(1)}h` : `${s.p75_hold_min}m`;
        const archLabel = (result.archetype || "").replace(/_/g, " ");
        // Color thresholds tuned for 80% LCB (gentler than 95% LB cutoffs)
        const wrColor = lcb80 >= 0.55 ? "#22c55e" : lcb80 >= 0.40 ? "#f59e0b" : "#ef4444";
        return (
          <div
            data-testid={`archetype-stats-${ticker}`}
            style={{
              padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)",
              display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 10,
              background: s.low_sample ? "rgba(245,158,11,0.04)" : "transparent",
            }}
          >
            {s.low_sample && (
              <span title={`Only ${s.n} resolved trades for this combo — Wilson 80% lower bound shown to be honest about uncertainty`} style={{
                fontSize: 8, fontWeight: 800, color: "#f59e0b",
                background: "rgba(245,158,11,0.10)", border: "1px solid #f59e0b55",
                borderRadius: 4, padding: "2px 6px", fontFamily: MONO, letterSpacing: "0.04em",
              }}>LOW SAMPLE — use caution</span>
            )}
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", fontFamily: MONO, letterSpacing: "0.04em" }}>
              {archLabel} WR:
            </span>
            <span
              title={`Wilson 80% lower bound (display default). Point estimate ${rawPct}% · Wilson 95% LB ${wlb95Pct}%`}
              style={{ fontSize: 11, fontWeight: 800, color: wrColor, fontFamily: MONO }}
              data-testid={`text-archetype-wr-${ticker}`}
            >
              {lcb80Pct}%
              {s.low_sample ? (
                <span style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.45)" }}> (n={s.n}, raw {rawPct}%)</span>
              ) : (
                <span style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.45)" }}> (n={s.n})</span>
              )}
            </span>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", fontFamily: MONO }}>·</span>
            <span title="Median realized R-multiple on resolved trades for this archetype" style={{ fontSize: 10, fontWeight: 700, color: "#e0e0e0", fontFamily: MONO }}>
              Med R: {s.median_r.toFixed(2)}
            </span>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", fontFamily: MONO }}>·</span>
            <span title={`75th-percentile resolution time · median win ${s.median_time_to_tp_min}m · median loss ${s.median_time_to_sl_min}m`} style={{ fontSize: 10, fontWeight: 700, color: "#e0e0e0", fontFamily: MONO }}>
              p75 hold: {holdHrs}
            </span>
          </div>
        );
      })()}

      {result.regime_gate && Array.isArray(result.regime_gate.checks) && result.regime_gate.checks.length > 0 && (
        <div
          data-testid={`regime-gate-${ticker}`}
          style={{
            margin: "10px 12px 0",
            padding: "10px 12px",
            borderRadius: 6,
            background:
              result.regime_gate.action === "BLOCK"
                ? "rgba(239,68,68,0.06)"
                : result.regime_gate.action === "DOWNGRADE"
                ? "rgba(245,158,11,0.06)"
                : "rgba(34,197,94,0.05)",
            border: `1px solid ${
              result.regime_gate.action === "BLOCK"
                ? "rgba(239,68,68,0.3)"
                : result.regime_gate.action === "DOWNGRADE"
                ? "rgba(245,158,11,0.3)"
                : "rgba(34,197,94,0.25)"
            }`,
          }}
        >
          <div
            style={{
              fontSize: 8,
              letterSpacing: 1.5,
              fontWeight: 700,
              fontFamily: MONO,
              marginBottom: 6,
              color:
                result.regime_gate.action === "BLOCK"
                  ? "#ef4444"
                  : result.regime_gate.action === "DOWNGRADE"
                  ? "#f59e0b"
                  : "#22c55e",
            }}
          >
            ◆ REGIME GATE — {result.regime_gate.verdict} ({result.regime_gate.score}%)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {result.regime_gate.checks.map((c, i) => (
              <div key={i} style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", display: "flex", gap: 5, alignItems: "flex-start", fontFamily: MONO }}>
                <span style={{ color: c.pass ? "#22c55e" : "#ef4444", flexShrink: 0, fontWeight: 700 }}>{c.pass ? "✓" : "✗"}</span>
                <div>
                  <div style={{ color: "rgba(255,255,255,0.85)", fontWeight: 600 }}>{c.name}</div>
                  <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 8 }}>{c.detail}</div>
                </div>
              </div>
            ))}
          </div>
          {result.gate_status && (
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.6)", marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)", fontFamily: MONO }}>
              {result.gate_status}
            </div>
          )}
        </div>
      )}

      {result.quant_rationale && (
        <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div style={{ fontSize: 10, color: "#e0e0e0", fontFamily: SANS, fontStyle: "italic", lineHeight: 1.7 }}>{result.quant_rationale}</div>
        </div>
      )}

      {result.invalidation && mode === "pro" && (
        <div style={{ padding: "8px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "flex-start", gap: 6 }}>
          <span style={{ fontSize: 10, flexShrink: 0 }}>❌</span>
          <div style={{ fontSize: 9, color: "#ef4444", fontFamily: SANS, lineHeight: 1.6 }}>{result.invalidation}</div>
        </div>
      )}

      {mode === "pro" && (result.indicators || result.multi_tf || result.bayesian) && (
        <div style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <button data-testid={`btn-detail-${ticker}`} onClick={() => setDetailExpanded(d => !d)} style={{ width: "100%", background: "transparent", border: "none", padding: "7px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: MONO }}>Advanced Quant Detail</span>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{detailExpanded ? "▾" : "▸"}</span>
          </button>
          {detailExpanded && (
            <div style={{ padding: "0 12px 12px" }}>
              {result.indicators && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 8 }}>
                  {[
                    { label: "RSI(14)", value: result.indicators.rsi, color: result.indicators.rsi > 60 ? "#22c55e" : result.indicators.rsi < 40 ? "#ef4444" : "#f59e0b" },
                    { label: "TREND", value: result.indicators.trend || "—", color: "rgba(255,255,255,0.5)" },
                    { label: "MOM", value: `${result.indicators.momentumScore || "—"}/100`, color: "rgba(255,255,255,0.5)" },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: "rgba(255,255,255,0.02)", borderRadius: 4, padding: "6px 8px", textAlign: "center" }}>
                      <div style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontFamily: MONO, marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color, fontFamily: MONO }}>{value}</div>
                    </div>
                  ))}
                </div>
              )}
              {result.bayesian && (
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: MONO, marginBottom: 4 }}>
                  Bayesian: {result.bayesian.probability}% ({result.bayesian.tier || result.conviction_tier})
                </div>
              )}
              {result.multi_tf && (
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>
                  Multi-TF: {Object.entries(result.multi_tf).map(([tf, v]) => `${tf}: ${v?.trend || v}`).join(" | ")}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        <button data-testid={`btn-copy-${ticker}`} onClick={handleCopy} style={{ padding: "10px 8px", background: "transparent", border: "none", borderRight: "1px solid rgba(201,168,76,0.08)", color: copied ? "#22c55e" : "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: MONO, fontSize: 9, fontWeight: 600 }}>
          {copied ? "✓ Copied!" : "📋 Copy Trade"}
        </button>
        <button data-testid={`btn-alert-${ticker}`} style={{ padding: "10px 8px", background: "transparent", border: "none", color: "#c9a84c", cursor: "pointer", fontFamily: MONO, fontSize: 9, fontWeight: 600 }}>
          ⏰ Set Alert
        </button>
      </div>
    </div>
  );
}

export function SuppressedSignal({ ticker, result }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div data-testid={`suppressed-card-${ticker}`} style={{ background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 8, padding: "8px 12px", marginBottom: 6 }}>
      <div data-testid={`btn-expand-suppressed-${ticker}`} onClick={() => setExpanded(!expanded)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: "#ef4444", fontFamily: MONO }}>🛑 {ticker}</span>
          <span style={{ fontSize: 8, color: "#ef444488" }}>SUPPRESSED</span>
        </div>
        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>{expanded ? "▾" : "▸"}</span>
      </div>
      {expanded && (
        <div style={{ marginTop: 6 }}>
          {result?.suppression_message && <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: MONO, lineHeight: 1.5 }}>{result.suppression_message}</div>}
          {result?.suppression_rules?.length > 0 && (
            <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
              {result.suppression_rules.slice(0, 3).map((r, i) => (
                <span key={i} style={{ fontSize: 7, color: "#ef4444", background: "rgba(239,68,68,0.08)", borderRadius: 3, padding: "2px 6px", fontFamily: MONO }}>R{r.id}: {r.name}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

---

## 2. Quant Scanner

**Endpoint:** `POST /api/quant` · **Client:** `QuantScanner.jsx`, `QuantStatusCard.jsx`, `ScanSummary.jsx` · **Bridge:** `quantClient.ts`

#### Backend: POST /api/quant — `server/routes.ts` (lines 6122–7731)
```ts
  app.post("/api/quant", aiIpLimiter, async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Anthropic API key not configured" });

    // Auth + tier gate — Quant Engine is Pro/Elite only
    const quantUserId = (req.session as any)?.userId;
    if (!quantUserId) return res.status(401).json({ error: "Sign in required to use CLVR Quant." });
    const quantUser = await storage.getUser(quantUserId);
    if (!quantUser) return res.status(401).json({ error: "Sign in required to use CLVR Quant." });
    const quantTier = await getEffectiveTier(quantUser);
    if (quantTier !== "pro" && quantTier !== "elite") {
      return res.status(403).json({ error: "CLVR Quant is a Pro feature. Upgrade to Pro to unlock full AI-powered analysis." });
    }
    if (!checkAiRateLimit(quantUserId, true)) {
      return res.status(429).json({ error: "Rate limit reached. You can make up to 60 AI requests per hour on Pro." });
    }

    try {
      const { ticker, marketType, userQuery, riskId, timeframeId, assetClass, twitterContext } = req.body;
      if (!ticker || !marketType || !riskId || !timeframeId) return res.status(400).json({ error: "Missing required parameters." });
      const risk = QUANT_RISK_PROFILES[riskId];
      const tfBase = QUANT_TIMEFRAMES[timeframeId];
      if (!risk || !tfBase) return res.status(400).json({ error: "Invalid risk or timeframe." });
      // Attach the lookup key as `id` so downstream gates (hardening horizon,
      // killHours, ai_signal_log.tradeType) can branch on the timeframe.
      const tf = { ...tfBase, id: timeframeId as string };
      const QUANT_EQUITIES = ["NVDA","TSLA","AAPL","MSFT","META","MSTR","COIN","PLTR","AMZN","GOOGL","AMD","HOOD","NFLX","ORCL","TSM","GME","RIVN","BABA","HIMS","CRCL"];
      const QUANT_COMMODITIES = ["XAU","XAG","WTI","BRENT","NATGAS","COPPER","PLATINUM"];
      const QUANT_FOREX = ["EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","USDCAD","NZDUSD","EURGBP","EURJPY","GBPJPY","USDMXN","USDZAR","USDTRY","USDSGD"];
      const cls: string = assetClass || (QUANT_EQUITIES.includes(ticker) ? "equity" : QUANT_COMMODITIES.includes(ticker) ? "commodity" : QUANT_FOREX.includes(ticker) ? "fx" : "crypto");

      // ── MARKET-OPEN GATE (non-crypto only) ────────────────────────────────
      // Skip generation entirely when the asset's session is closed — no point
      // producing a forex signal at 3am Sunday.
      const marketCheckClass = cls === "fx" ? "forex" : (cls as "equity" | "commodity" | "crypto");
      if (cls !== "crypto" && !isAssetMarketOpen(marketCheckClass)) {
        logRejection({
          source: "ai_signal", token: ticker, direction: null,
          reason: "MARKET_CLOSED",
          detail: `${cls.toUpperCase()} session closed`,
        });
        return res.json({
          signal: "SUPPRESSED",
          suppressed: true,
          suppression_message: `${ticker} ${cls.toUpperCase()} market is closed — no signal generated.`,
          suppression_rules: ["MARKET_CLOSED"],
        });
      }

      // ── COOLDOWN PRE-CHECK (both directions) ──────────────────────────────
      // If both LONG and SHORT are in 2h cooldown, skip Claude entirely.
      // Otherwise, surface the in-cooldown side(s) to the prompt so the AI
      // doesn't propose a direction we'd just have to reject post-hoc.
      const [cdLong, cdShort] = await Promise.all([
        isInCooldown(ticker, "LONG"),
        isInCooldown(ticker, "SHORT"),
      ]);
      if (cdLong.inCooldown && cdShort.inCooldown) {
        const detail = `LONG ${cdLong.minutesLeft}m, SHORT ${cdShort.minutesLeft}m left`;
        logRejection({
          source: "ai_signal", token: ticker, direction: "BOTH",
          reason: "COOLDOWN", detail,
        });
        return res.json({
          signal: "SUPPRESSED",
          suppressed: true,
          suppression_message: `${ticker} cooldown active (${COOLDOWN_WINDOW_MINUTES}m floor) — ${detail}.`,
          suppression_rules: ["COOLDOWN"],
        });
      }

      // ── MACRO RISK-OFF (BTC -3%/4h) — block LONGs only ────────────────────
      const macroRisk = await isMacroRiskOff();

      const [candles, candles15m, candles4h, candles1d, candles1h, fng] = await Promise.all([
        fetchQuantCandles(ticker, cls, tf.interval, tf.count),
        fetchQuantCandles(ticker, cls, "15m",  50),
        fetchQuantCandles(ticker, cls, "4h",   60),
        fetchQuantCandles(ticker, cls, "1d",   30),
        fetchQuantCandles(ticker, cls, "1h",   48),
        fetchFearAndGreed(),
      ]);
      if (!candles) return res.status(502).json({ error: "Failed to fetch market data." });
      const ind = computeQuantIndicators(candles);
      if (!ind) return res.status(500).json({ error: "Insufficient candle data for indicators." });

      const confluence      = computeMultiTFConfluence(candles15m, candles4h, candles1d);
      const patternResult   = taDetectPatterns(candles);
      // Pull per-(token,direction) recency-weighted prior from the calibration
      // cache. Direction is provisional here — derived from indicator trend —
      // because the AI hasn't yet declared LONG/SHORT. Using the trend-implied
      // direction matches what the bayesian scorer itself uses internally and
      // gives the prior a chance to bias the score toward historical reality.
      const _calib            = await import("./lib/calibration");
      const _trendDir: "LONG" | "SHORT" | null = ind.trend?.includes("UP") ? "LONG" : ind.trend?.includes("DOWN") ? "SHORT" : null;
      const _comboPrior       = _trendDir ? _calib.getComboPrior(ticker, _trendDir) : null;
      const bayesian        = computeBayesianScore(ind, confluence, patternResult.patterns, fng.signal, _comboPrior);
      if (_comboPrior !== null) {
        console.log(`[Calibration] ${ticker} ${_trendDir} prior=${(_comboPrior*100).toFixed(1)}% → bayesian=${bayesian.probability}`);
      }
      const macroKillSwitch = checkMacroKillSwitch(macroCache.data || []);

      // Get live funding rate from HL data (crypto only)
      const fundingRate: number = cls === "crypto" ? (hlData[ticker]?.funding || 0) : 0;

      // ── STATISTICAL BRAIN — empirical edge from resolved-trade history ────
      // Pre-compute brain output for both directions so we can suppress on the
      // trend-implied direction early AND check the AI's eventual direction in
      // hardening regardless of which way it went.
      const _brainMod = await import("./lib/statisticalBrain");
      const [brainLong, brainShort] = await Promise.all([
        _brainMod.getBrainFor(ticker, "LONG"),
        _brainMod.getBrainFor(ticker, "SHORT"),
      ]);
      const brainForTrend = _trendDir === "LONG" ? brainLong : _trendDir === "SHORT" ? brainShort : null;
      if (brainForTrend) {
        console.log(`[Brain] ${ticker} ${_trendDir} → ${brainForTrend.verdict} | ${brainForTrend.reason}`);
      }

      // ── GLOBAL CIRCUIT BREAKER (1h WR collapse) ─────────────────────────
      if (isHalted()) {
        const cb = getCircuitState();
        logRejection({
          source: "ai_signal", token: ticker, direction: null,
          reason: "CIRCUIT_BREAKER",
          detail: `L${cb.level} ${cb.reason || "halted"}`,
        });
        return res.json({
          signal: "SUPPRESSED",
          suppressed: true,
          suppression_message: `🛑 Signal Engine Halted — ${cb.reason || "1h win rate collapse detected"}. Auto-resume when 1h WR recovers ≥45%.`,
          suppression_rules: ["CIRCUIT_BREAKER"],
          circuit_breaker: cb,
        });
      }

      // ── Run Signal Suppression Rules BEFORE calling AI ────────────────────────
      const suppression = checkSignalSuppressionRules({
        ticker, cls, ind, candles1h, candles1d, candles15m, bayesian, macroKillSwitch, fundingRate,
      });

      // ── Adaptive learning gate: check if BOTH directions are suppressed ─────
      const [adaptLong, adaptShort] = await Promise.all([
        getThresholdFor(ticker, "LONG"),
        getThresholdFor(ticker, "SHORT"),
      ]);
      if (adaptLong?.suppressed && adaptShort?.suppressed) {
        logRejection({
          source: "ai_signal", token: ticker, direction: "BOTH",
          reason: "ADAPTIVE_SUPPRESSED",
          detail: `LONG ${adaptLong.winRate}% / SHORT ${adaptShort.winRate}% over 30d`,
        });
        return res.json({
          signal: "SUPPRESSED",
          suppressed: true,
          suppression_message: `Adaptive learning: ${ticker} suppressed (LONG ${adaptLong.winRate}%, SHORT ${adaptShort.winRate}% — both below 30% Wilson lower bound over last 30d).`,
          suppression_rules: ["ADAPTIVE_LEARNING"],
          adaptive: { long: adaptLong, short: adaptShort },
        });
      }

      // ── BRAIN SUPPRESS — both directions empirically dead (≥15 trades, <25% WR)
      // If both LONG and SHORT have a SUPPRESS verdict, refuse to generate
      // a signal in either direction. Keeps the engine from emitting
      // -334%-style trades on combos like BTC SHORT (0% over 20) or
      // DOGE SHORT (0% over 19).
      if (brainLong.verdict === "SUPPRESS" && brainShort.verdict === "SUPPRESS") {
        logRejection({
          source: "ai_signal", token: ticker, direction: "BOTH",
          reason: "BRAIN_SUPPRESSED_COMBO",
          detail: `LONG ${(brainLong.stat?.winRate ?? 0)*100}% / SHORT ${(brainShort.stat?.winRate ?? 0)*100}% — both below 25% empirical floor`,
        });
        return res.json({
          signal: "SUPPRESSED",
          suppressed: true,
          suppression_message: `Statistical Brain: ${ticker} has no demonstrated edge in either direction (${brainLong.reason}; ${brainShort.reason}).`,
          suppression_rules: ["BRAIN_SUPPRESSED_COMBO"],
          brain: { long: brainLong.reason, short: brainShort.reason },
        });
      }
      // ── BRAIN SUPPRESS — single direction (the trend-implied one) is dead
      // Don't even bother calling Claude — it'll just propose in the trend
      // direction and we'd reject in hardening. Save the API call.
      if (brainForTrend && brainForTrend.verdict === "SUPPRESS") {
        logRejection({
          source: "ai_signal", token: ticker, direction: _trendDir,
          reason: "BRAIN_SUPPRESSED_COMBO",
          detail: brainForTrend.reason,
        });
        return res.json({
          signal: "SUPPRESSED",
          suppressed: true,
          suppression_message: `Statistical Brain: ${ticker} ${_trendDir} historically loses (${brainForTrend.reason}). Trend-implied direction has no edge — refusing to emit.`,
          suppression_rules: ["BRAIN_SUPPRESSED_COMBO"],
          brain: brainForTrend,
        });
      }

      // If hard suppressed → return immediately without AI call
      if (suppression.hardSuppressed) {
        return res.json({
          signal: "SUPPRESSED",
          suppressed: true,
          suppression_message: suppression.suppressionMessage,
          suppression_rules: suppression.triggered,
          win_probability: suppression.adjustedProbability,
          indicators: ind,
          multi_tf: confluence,
          bayesian,
          macro_kill_switch: macroKillSwitch,
          patterns: patternResult,
          fear_greed: fng,
          conviction_tier: bayesian.tier,
        });
      }

      // ── CLVR Signal Validation Gate — pre-computed (cannot be overridden by AI) ─
      const oiM = cls === "crypto"
        ? Math.round((hlData[ticker]?.oi || 0) / 1e6)
        : cls === "equity" ? 2000 : 50;  // equities always liquid; commodities default

      const oiFactor = oiM < 5 ? 0          // HARD BLOCK
                     : oiM < 10 ? 0.60
                     : oiM < 20 ? 0.70
                     : oiM < 100 ? 0.90
                     : 1.00;

      const macroFactor = macroKillSwitch.safe ? 1.00
                        : (macroKillSwitch.warning || "").toUpperCase().includes("HIGH") ? 0.75
                        : 0.85;

      const nowET  = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      const etH    = nowET.getHours(), etMin2 = nowET.getMinutes();
      const etDec  = etH + etMin2 / 60;
      const isWeekend = [0, 6].includes(nowET.getDay());
      const sessionFactor = isWeekend ? 0.75
        : (etDec >= 9.5  && etDec < 11.0) ? 1.10   // NY Open 90 min
        : (etDec >= 8.0  && etDec < 9.5)  ? 1.05   // London Open 90 min
        : (etDec >= 21.0 || etDec < 3.0)  ? 0.85   // Asia / off-hours
        : 1.00;

      const atrPctNum     = parseFloat(String(ind.atrPct));
      const momentumFactor = atrPctNum > 1.5 ? 0.70   // spike too fast (noise)
                           : atrPctNum >= 0.5 ? 1.00   // normal 3–8 min formation
                           : 1.10;                      // slow, sustained build

      const rawScore  = bayesian.probability;
      const adjScore  = oiFactor > 0
        ? Math.round(rawScore * oiFactor * macroFactor * sessionFactor * momentumFactor)
        : 0;
      const signalTier = adjScore < 55 ? "BLOCKED" : adjScore < 65 ? "WATCH_ONLY"
                       : adjScore < 75 ? "MED" : adjScore < 85 ? "HIGH" : "STRONG";

      // Empirical pWin: ask the calibration cache what signals in this score
      // bucket actually win at. Falls back to the legacy hardcoded curve
      // (which was a best-guess, never validated against outcomes) when the
      // cache is cold or the bucket is too small to trust.
      const _empiricalPWin = _calib.getEmpiricalPWin(adjScore);
      const _legacyPWin    = adjScore < 65 ? 0.45 : adjScore < 75 ? 0.52 : adjScore < 85 ? 0.60 : 0.68;
      const pWin  = (_empiricalPWin !== null) ? _empiricalPWin : _legacyPWin;
      const pLoss = 1 - pWin;
      if (_empiricalPWin !== null) {
        console.log(`[Calibration] ${ticker} adjScore=${adjScore} → pWin empirical=${(_empiricalPWin*100).toFixed(1)}% (legacy would be ${(_legacyPWin*100).toFixed(0)}%)`);
      }

      const slDistPct  = risk.slMultiplier * atrPctNum;
      const tp1DistPct = slDistPct * risk.tpRatios[0];
      const evPct      = parseFloat(((pWin * tp1DistPct) - (pLoss * slDistPct)).toFixed(3));

      const kellyB    = risk.tpRatios[0];
      const kellyF    = (kellyB * pWin - pLoss) / kellyB;
      const kellyPct  = Math.max(0, parseFloat((kellyF * 100).toFixed(1)));
      const posTier   = kellyF <= 0 ? "BLOCKED" : kellyF < 0.10 ? "MINIMAL"
                      : kellyF < 0.20 ? "SMALL" : kellyF < 0.35 ? "MEDIUM" : "STANDARD";
      let marginPctRaw = posTier === "MINIMAL" ? 5 : posTier === "SMALL" ? 10
                       : posTier === "MEDIUM" ? 17 : 22;
      if (!macroKillSwitch.safe)                         marginPctRaw = Math.round(marginPctRaw * 0.50);
      if (oiM < 20 && cls === "crypto")                  marginPctRaw = Math.round(marginPctRaw * 0.70);
      if (adjScore < 65)                                  marginPctRaw = Math.round(marginPctRaw * 0.60);
      if (isWeekend || etDec >= 21.0 || etDec < 3.0)     marginPctRaw = Math.round(marginPctRaw * 0.75);
      const finalMarginPct = Math.min(Math.max(marginPctRaw, 2), 25);

      const spikeHigh    = ind.high24;
      const spikeLow     = ind.low24;
      const spikeRange   = spikeHigh - spikeLow;
      const fibConserv   = parseFloat((spikeHigh - spikeRange * 0.382).toFixed(6));
      const fibAggr      = parseFloat((spikeHigh - spikeRange * 0.500).toFixed(6));
      const useAggr      = adjScore >= 80 && oiM > 50 && macroKillSwitch.safe;
      const fibEntry     = useAggr ? fibAggr : fibConserv;

      const entryWindowMin   = oiM < 20 ? "2–5" : oiM < 100 ? "4–10" : "8–20";
      const momentumHalfLife = oiM < 20 ? "3–5 min" : oiM < 100 ? "6–10 min" : "12–23 min";

      const baseFormMin  = atrPctNum > 1.5 ? 3 : atrPctNum > 0.5 ? 6 : 12;
      const sHoldMult    = isWeekend ? 0.60 : (etDec >= 9.5 && etDec < 11.0) ? 0.80
                         : (etDec >= 21.0 || etDec < 3.0) ? 1.30 : 1.00;
      const formationMin = Math.max(2, Math.round(baseFormMin * sHoldMult));
      const targetExitMin = Math.round(formationMin * 1.5);
      const hardExitMin   = Math.round(formationMin * 2.0);

      const sessionLabel = isWeekend ? "Weekend" : (etDec >= 9.5 && etDec < 11.0) ? "NY Open 90min"
        : (etDec >= 8.0 && etDec < 9.5) ? "London Open 90min"
        : (etDec >= 21.0 || etDec < 3.0) ? "Asia/Off-hours" : "Regular";

      // OI hard block
      if (oiFactor === 0) {
        return res.json({
          signal: "SUPPRESSED", suppressed: true,
          suppression_message: `SIGNAL BLOCKED — Open Interest too low ($${oiM}M < $5M minimum)`,
          suppression_rules: [{ id: 0, name: "OI Liquidity Block", action: "KILL",
            message: `$${oiM}M OI is insufficient. Minimum $5M required for a valid signal.` }],
          win_probability: adjScore, adjusted_score: adjScore, ev: evPct,
          indicators: ind, multi_tf: confluence, bayesian, macro_kill_switch: macroKillSwitch,
          patterns: patternResult, fear_greed: fng, conviction_tier: bayesian.tier,
        });
      }

      // EV hard block
      if (evPct <= 0) {
        return res.json({
          signal: "SUPPRESSED", suppressed: true,
          suppression_message: `SIGNAL BLOCKED — Negative Expected Value (EV: ${evPct.toFixed(3)}%)`,
          suppression_rules: [{ id: 0, name: "EV Hard Block", action: "KILL",
            message: `EV=${evPct.toFixed(3)}%: P_win=${(pWin*100).toFixed(0)}%, TP=${tp1DistPct.toFixed(2)}% vs SL=${slDistPct.toFixed(2)}%. Reward does not justify risk.` }],
          win_probability: adjScore, adjusted_score: adjScore, ev: evPct,
          indicators: ind, multi_tf: confluence, bayesian, macro_kill_switch: macroKillSwitch,
          patterns: patternResult, fear_greed: fng, conviction_tier: bayesian.tier,
        });
      }

      const fngEmoji = fng.value <= 25 ? "🟢 Extreme Fear (contrarian bull)" : fng.value >= 75 ? "🔴 Extreme Greed (distribution risk)" : fng.value <= 45 ? "😨 Fear" : fng.value >= 60 ? "😎 Greed" : "😐 Neutral";
      const patternsStr = patternResult.patterns.length > 0 ? patternResult.patterns.join(", ") : "none detected";

      const mtfStr = `
MULTI-TIMEFRAME CONFLUENCE (EMA9 vs EMA21):
  15m: ${confluence["15m"].trend.padEnd(8)} | EMA9=$${confluence["15m"].ema9.toFixed(4)} vs EMA21=$${confluence["15m"].ema21.toFixed(4)} (${confluence["15m"].bars} bars)
  4h:  ${confluence["4h"].trend.padEnd(8)} | EMA9=$${confluence["4h"].ema9.toFixed(4)} vs EMA21=$${confluence["4h"].ema21.toFixed(4)} (${confluence["4h"].bars} bars)
  1d:  ${confluence["1d"].trend.padEnd(8)} | EMA9=$${confluence["1d"].ema9.toFixed(4)} vs EMA21=$${confluence["1d"].ema21.toFixed(4)} (${confluence["1d"].bars} bars)
  VERDICT: ${confluence.confluent ? "CONFLUENT" : "CONFLICTING"} — ${confluence.direction} (${confluence.strength})

PATTERN RECOGNITION ENGINE:
  Detected patterns: ${patternsStr}
  Bull Flag:         ${(patternResult.detected as any).bull_flag ? "YES — bullish continuation" : "No"}
  Bear Flag:         ${(patternResult.detected as any).bear_flag ? "YES — bearish continuation" : "No"}
  Head & Shoulders:  ${patternResult.detected.head_and_shoulders ? "YES — bearish reversal warning" : "No"}
  Double Top:        ${(patternResult.detected as any).double_top ? "YES — distribution / resistance" : "No"}
  Double Bottom:     ${(patternResult.detected as any).double_bottom ? "YES — accumulation / support" : "No"}

MACRO SENTIMENT (Fear & Greed Index):
  Value: ${fng.value}/100 — ${fng.classification} ${fngEmoji}
  Signal for Brain: ${fng.signal || "neutral — no contrarian edge"}

BAYESIAN BRAIN SCORE:
  Probability: ${bayesian.probability}% → ${bayesian.interpretation} [Tier ${bayesian.tier}]
  Active signals: ${bayesian.signals_used.join(", ") || "none"}

MACRO KILL SWITCH: ${macroKillSwitch.safe ? "CLEAR — no HIGH impact events within 4h" : macroKillSwitch.warning}`;

      const indContext = `
TECHNICAL ANALYSIS — ${tf.label} (${tf.interval} candles, ${candles.length} bars):
Current: $${ind.currentPrice.toFixed(4)}
EMA20:   $${ind.ema20.toFixed(4)} (${ind.priceVsEma20}% ${parseFloat(ind.priceVsEma20)>0?"above":"below"})
EMA50:   $${ind.ema50.toFixed(4)} (${ind.priceVsEma50}% ${parseFloat(ind.priceVsEma50)>0?"above":"below"})
EMA200:  $${ind.ema200.toFixed(4)} (${ind.priceVsEma200}% ${parseFloat(ind.priceVsEma200)>0?"above":"below"})
Trend: ${ind.trend}
RSI(14): ${ind.rsi} → ${ind.rsiLabel}
MACD(12,26,9) Histogram: ${ind.macdHist} → ${ind.macdCrossing}
ATR(14): $${ind.atr14} (${ind.atrPct}% of price)
→ ${risk.label} SL distance: $${(ind.atr14 * risk.slMultiplier).toFixed(4)} (${(ind.atrPct * risk.slMultiplier).toFixed(2)}%)
Nearest Resistance: $${ind.nearestResistance?.toFixed(4)||"none above"}
Nearest Support:    $${ind.nearestSupport?.toFixed(4)||"none below"}
24h High: $${ind.high24.toFixed(4)} | 24h Low: $${ind.low24.toFixed(4)} | Range: ${ind.range24hPct}%
7d  High: $${ind.high7d.toFixed(4)} | 7d  Low:  $${ind.low7d.toFixed(4)}
Position in 24h range: ${ind.posInRange}% from bottom
Volume: ${ind.volumeSignal} (${ind.volumeRatio}× average)
Momentum Score: ${ind.momentumScore}/100
${mtfStr}`;

      const perfCtx = await buildPerformanceContext();
      const adaptiveNotes: string[] = [];
      if (adaptLong?.suppressed) adaptiveNotes.push(`⛔ ${ticker} LONG is SUPPRESSED (30d win rate ${adaptLong.winRate}% / ${adaptLong.sampleSize} signals). DO NOT issue a LONG.`);
      else if (adaptLong && adaptLong.threshold !== 75) adaptiveNotes.push(`${ticker} LONG threshold is ${adaptLong.threshold}% (win rate ${adaptLong.winRate}% / ${adaptLong.sampleSize}). ${adaptLong.threshold > 75 ? "Require HIGHER conviction." : "Slightly lower bar OK."}`);
      if (adaptShort?.suppressed) adaptiveNotes.push(`⛔ ${ticker} SHORT is SUPPRESSED (30d win rate ${adaptShort.winRate}% / ${adaptShort.sampleSize} signals). DO NOT issue a SHORT.`);
      else if (adaptShort && adaptShort.threshold !== 75) adaptiveNotes.push(`${ticker} SHORT threshold is ${adaptShort.threshold}% (win rate ${adaptShort.winRate}% / ${adaptShort.sampleSize}). ${adaptShort.threshold > 75 ? "Require HIGHER conviction." : "Slightly lower bar OK."}`);
      // Surface in-cooldown directions to the AI so it doesn't propose them.
      if (cdLong.inCooldown) adaptiveNotes.push(`⏱ ${ticker} LONG is in 2h COOLDOWN (${cdLong.minutesLeft}m left). DO NOT issue a LONG.`);
      if (cdShort.inCooldown) adaptiveNotes.push(`⏱ ${ticker} SHORT is in 2h COOLDOWN (${cdShort.minutesLeft}m left). DO NOT issue a SHORT.`);
      if (macroRisk.halted) adaptiveNotes.push(`🛑 MACRO RISK-OFF active — ${macroRisk.reason}. DO NOT issue a LONG. SHORTs still permitted if setup is clean.`);

      // Multi-asset universe note — let the AI know it's not just looking at crypto.
      adaptiveNotes.push(`UNIVERSE: crypto perps, major forex (EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD), commodities (GOLD, SILVER, WTI, NATGAS), and large-cap US equities (SPY, QQQ, NVDA, AAPL, MSFT, TSLA). When the user asks for trade ideas without specifying an asset class, consider all four markets and pick the strongest technical setup across them — do not default to crypto.`);

      // ── NEWS CONTEXT — give Claude a snapshot of recent high/medium severity headlines ──
      let newsImpactLong: Awaited<ReturnType<typeof getNewsImpact>> | null = null;
      let newsImpactShort: Awaited<ReturnType<typeof getNewsImpact>> | null = null;
      let newsBlock = "";
      try {
        [newsImpactLong, newsImpactShort] = await Promise.all([
          getNewsImpact(ticker, "LONG", 240),
          getNewsImpact(ticker, "SHORT", 240),
        ]);
        const critical = await getRecentCriticalHeadlines(5, 4);
        const lines: string[] = [];
        if (critical.length) {
          lines.push("CURRENT MARKET NEWS (last 4h, high/medium severity):");
          for (const h of critical) lines.push(`• [${h.sentiment.toUpperCase()}/${h.severity}] ${h.title}`);
        }
        if (newsImpactLong?.shouldBlock) lines.push(`⛔ ${ticker} LONG is BLOCKED by news conflict — ${newsImpactLong.severity} severity bearish news contradicts. DO NOT issue a LONG.`);
        if (newsImpactShort?.shouldBlock) lines.push(`⛔ ${ticker} SHORT is BLOCKED by news conflict — ${newsImpactShort.severity} severity bullish news contradicts. DO NOT issue a SHORT.`);
        if (newsImpactLong && newsImpactLong.confidenceAdjustment < 0 && !newsImpactLong.shouldBlock) lines.push(`⚠ ${ticker} LONG faces news headwinds (${newsImpactLong.bearishCount} bearish vs ${newsImpactLong.bullishCount} bullish, ${newsImpactLong.severity} severity). Lower conviction by ${Math.abs(newsImpactLong.confidenceAdjustment)}%.`);
        if (newsImpactShort && newsImpactShort.confidenceAdjustment < 0 && !newsImpactShort.shouldBlock) lines.push(`⚠ ${ticker} SHORT faces news headwinds (${newsImpactShort.bullishCount} bullish vs ${newsImpactShort.bearishCount} bearish, ${newsImpactShort.severity} severity). Lower conviction by ${Math.abs(newsImpactShort.confidenceAdjustment)}%.`);
        newsBlock = lines.length ? `\n\n${lines.join("\n")}\n` : "";
      } catch {}

      const adaptiveBlock = adaptiveNotes.length ? `\n\nADAPTIVE LEARNING NOTES FOR ${ticker}:\n${adaptiveNotes.join("\n")}\n${newsBlock}` : newsBlock;

      // ── Statistical Brain block — empirical limits per direction ──────────
      // These are STRICT — hardening will VETO any signal that violates them.
      const brainBlock = `\n\n${brainLong.promptText}\n\n${brainShort.promptText}\n`;

      const system = `${perfCtx}
${adaptiveBlock}${brainBlock}
You are CLVRQuantAI Signal Engine — a precision trade signal generator for leveraged perpetual futures. Think like Paul Tudor Jones + Stan Druckenmiller. Capital preservation first. Never force a trade.

A live candlestick chart is attached to this message — the last ${candles1h?.length ?? 0} 1h bars of ${ticker} with EMA20/EMA50 overlays and key support/resistance levels. Use it to validate visual structure (clean trends, fakeouts, wicks at levels, double tops/bottoms) before committing to a direction.

PROFILE: ${risk.label}
Leverage: ${Math.max(risk.leverage[0], tf.leverage[0])}x–${Math.min(risk.leverage[1], tf.leverage[1])}x (intersect risk × timeframe) | Risk/trade: ${risk.riskPct}% | Min win prob: ${risk.minWinProb}%
TP1 ratio: ${Math.min(risk.tpRatios[0], tf.tpRatios[0])}:1 | TP2 ratio: ${Math.min(risk.tpRatios[1], tf.tpRatios[1])}:1 | Hold horizon: ${tf.holdHorizon} (timeframe-driven; risk floor: ${risk.holdHorizon})

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 1 — SIGNAL VALIDATION GATE (pre-computed — DO NOT recalculate)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Open Interest:      $${oiM}M  (OI factor: ${oiFactor}×)
Macro Risk:         ${macroKillSwitch.safe ? "CLEAR" : (macroKillSwitch.warning || "HIGH RISK ACTIVE")} (macro factor: ${macroFactor}×)
Session:            ${sessionLabel} (session factor: ${sessionFactor}×)
Momentum Speed:     ATR ${atrPctNum.toFixed(2)}% (momentum factor: ${momentumFactor}×)
ADJUSTED SCORE:     ${adjScore}/100 → ${signalTier}
P_WIN:              ${(pWin*100).toFixed(0)}%
EXPECTED VALUE:     ${evPct > 0 ? "+" : ""}${evPct.toFixed(3)}% (PASSED — EV positive)
KELLY f*:           ${kellyPct.toFixed(1)}% → ${posTier} tier → use ${finalMarginPct}% of margin max
OI HALF-LIFE:       ${momentumHalfLife}

Echo these exact values in your JSON output:
  adjusted_score = ${adjScore}
  ev = ${evPct}
  position_size.tier = "${posTier}"
  position_size.kelly_fraction = ${kellyPct}
  position_size.margin_pct = ${finalMarginPct}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 2 — ENTRY: FIBONACCI RETRACEMENT (MANDATORY — never enter at spike top)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
24h Spike Range: $${spikeLow.toFixed(4)} → $${spikeHigh.toFixed(4)} (range: $${spikeRange.toFixed(4)})
  Conservative entry (0.382 fib): $${fibConserv}
  Aggressive entry  (0.500 fib): $${fibAggr}
  RECOMMENDED: ${useAggr ? "AGGRESSIVE" : "CONSERVATIVE"} = $${fibEntry}
  (Aggressive only if: adj_score ≥ 80 AND OI > $50M AND macro clear — ${useAggr ? "all met" : "not all met"})

Set entry.price near $${fibEntry}. Adjust ± for structural support/resistance you detect in the data.
Entry window: ${entryWindowMin} min. If price does NOT retrace to entry zone within ${entryWindowMin} min — VOID.
Signal is immediately VOID if price breaks below the spike low ($${spikeLow.toFixed(4)}).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 3 — HOLD TIME & EXIT TIMING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Use the DURATION/KILL CLOCK categories above for hold.duration.
If TP1 is hit → move SL to breakeven immediately.
Once price is halfway to TP2 → trail SL to TP1 level.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 4 — TAKE PROFIT (momentum half-life: ${momentumHalfLife})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TP1 (60% position): Entry + (SL_distance × ${risk.tpRatios[0]}). Must be reachable within 1 half-life.
TP2 (30% position): Entry + (SL_distance × ${risk.tpRatios[1]}). ${oiM >= 20 ? `OI $${oiM}M > $20M — INCLUDE TP2.` : `OI $${oiM}M < $20M — OMIT TP2. Single target only.`}
TP3 (10% runner):   ${adjScore >= 85 && oiM > 100 ? `Adj score ${adjScore} ≥ 85 AND OI $${oiM}M > $100M — INCLUDE TP3 = Entry + (SL × 4.0).` : `OMIT — requires adj_score ≥ 85 AND OI > $100M (current: ${adjScore}, $${oiM}M).`}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ABSOLUTE RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. win_probability < ${risk.minWinProb}% → signal MUST be NEUTRAL.
2. NEVER set entry at spike high. Use Fibonacci levels above.
3. SL must be below structural low with ${risk.slMultiplier}× ATR buffer.
4. R:R ≥ 1.5:1 required. If not achievable → NEUTRAL.
5. Leverage: ${Math.max(risk.leverage[0], tf.leverage[0])}x–${Math.min(risk.leverage[1], tf.leverage[1])}x range only (risk × timeframe intersect).
6. Hold time / duration MUST fall inside "${tf.holdHorizon}" — do NOT recommend a longer or shorter horizon than the chosen timeframe permits.
7. ALWAYS include target_exit_min and hard_exit_min in hold object.
8. If MACD, RSI, EMA, and volume all conflict → NEUTRAL. Confluence required.
9. Output risk_flags for every active concern: macro, OI, session, funding, pattern.${suppression.flagsForAI.length > 0 ? `

SIGNAL SUPPRESSION OVERRIDES (enforce before finalizing):
${suppression.flagsForAI.map((f, i) => `${i + 9}. ${f}`).join("\n")}` : ""}

DIRECTION CONSISTENCY CHECK: If 3+ edge factors are bullish (bull cross, bullish divergence, price above key MA), the signal direction MUST be LONG. If 3+ edge factors are bearish, the direction MUST be SHORT. Never output a SHORT signal with majority bullish factors or vice versa. If factors conflict (mixed bull/bear), set signal to NEUTRAL.

ASSET CONSTRAINT (NON-NEGOTIABLE): You are analyzing ONLY the ticker "${ticker}". Do NOT substitute, recommend, or analyze any other asset. Your entire output must be about ${ticker} and nothing else. If you cannot generate a signal for ${ticker}, output signal: "NEUTRAL" with a reason — do NOT switch to a different asset. Every price level must correspond to ${ticker}.

🚨 ANTI-CHASE RULE (NON-NEGOTIABLE — VIOLATIONS WILL BE OVERRIDDEN TO NEUTRAL):
- Current position in 24h range: ${ind.posInRange}% (0 = at low, 100 = at high). 24h range size: ${ind.range24hPct}%.
- DO NOT recommend LONG when posInRange ≥ 80 AND range24hPct ≥ 4. The asset is already extended near the daily high — entering here is buying the top after the move. Recommend NEUTRAL or wait for pullback to mid-range (40–60%).
- DO NOT recommend SHORT when posInRange ≤ 20 AND range24hPct ≥ 4. The asset is already exhausted near the daily low — shorting here is selling the bottom. Recommend NEUTRAL or wait for retest of mid-range.
- The ONLY exception: a confirmed breakout to NEW 7-day highs/lows on volume ≥ 2x average AND with multi-timeframe confluence aligned. Otherwise treat extended price as a chase.

OUTPUT LENGTH RULES — STRICTLY ENFORCED:
- quant_rationale: EXACTLY 2 sentences. Sentence 1 = the setup (pattern + key indicator). Sentence 2 = the catalyst or confluence reason. No filler, no hedging.
- invalidation: EXACTLY 1 sentence. State the precise price level AND the condition (e.g. "Invalidated on a 4H close below 62,400 — breaks the rising trendline.").
- thesis: EXACTLY 2 sentences in plain English a non-quant can read. No jargon dumps.
- Do NOT explain your scoring methodology, internal logic, or numbered supporting factors.
- Do NOT reference "absolute rules", "pre-computed gates", "Kelly percentages", or internal calculations.

DURATION/KILL CLOCK — use ONLY these values for hold.duration:
- SCALP: "2-4 hours"
- DAY TRADE: "12-24 hours"
- SWING: "2-3 days"
- POSITION: "1-2 weeks"
Never output minute-level durations. The minimum kill clock is 2 hours.

DIRECTION VALIDATION — MANDATORY:
- If signal contains "LONG": TP1 > entry, TP2 > entry, SL < entry
- If signal contains "SHORT": TP1 < entry, TP2 < entry, SL > entry
- Verify this before outputting. If levels don't match direction, fix them.

Respond ONLY with valid JSON. No markdown. No backticks. No text before or after the JSON. Start with { and end with }.

{
  "signal": "STRONG_LONG"|"LONG"|"NEUTRAL"|"SHORT"|"STRONG_SHORT",
  "win_probability": 0-100,
  "adjusted_score": ${adjScore},
  "opportunity_score": 0-100,
  "ev": ${evPct},
  "entry": {
    "price": number,
    "zone_low": number,
    "zone_high": number,
    "fib_level": "${useAggr ? "0.500 aggressive" : "0.382 conservative"}",
    "window_min": "${entryWindowMin}",
    "rationale": "string"
  },
  "stopLoss": { "price": number, "distance_pct": number, "rationale": "string" },
  "tp1": { "price": number, "gain_pct": number, "rr_ratio": number, "rationale": "string", "size_pct": 60 },
  "tp2": { "price": number, "gain_pct": number, "rr_ratio": number, "rationale": "string", "size_pct": 30 },
  ${adjScore >= 85 && oiM > 100 ? `"tp3": { "price": number, "gain_pct": number, "rr_ratio": number, "rationale": "string", "size_pct": 10 },` : ""}
  "leverage": { "recommended": number, "max": number, "rationale": "string" },
  "hold": {
    "duration": "string",
    "target_exit_min": ${targetExitMin},
    "hard_exit_min": ${hardExitMin},
    "key_events": ["string"],
    "exit_conditions": ["string"]
  },
  "position_size": {
    "tier": "${posTier}",
    "kelly_fraction": ${kellyPct},
    "margin_pct": ${finalMarginPct},
    "rationale": "string"
  },
  "technical_summary": { "trend": "string", "key_levels": "string", "momentum": "string", "volume": "string", "pattern": "string" },
  "quant_rationale": "string — EXACTLY 2 sentences",
  "thesis": "string — EXACTLY 2 plain-English sentences a non-quant can read",
  "risks": ["string"],
  "risk_flags": ["string — format: CATEGORY: description"],
  "invalidation": "string — EXACTLY 1 sentence with price level + condition"
}`;

      const ua = getUnusualForSymbol(ticker);
      const uaContext = ua
        ? `UNUSUAL ACTIVITY (conditions, not prediction): score ${ua.score}/100 (${ua.band}). Drivers: ${ua.reasons.join("; ")}.`
        : `UNUSUAL ACTIVITY: no abnormal conditions flagged for ${ticker} right now.`;

      const userMsg = `ASSET: ${ticker} | MARKET: ${marketType} | CLASS: ${cls.toUpperCase()}
USER QUERY: "${userQuery || `Analyze optimal ${risk.label} setup`}"

${indContext}

${twitterContext ? `TWITTER/X SOCIAL INTELLIGENCE:\n${twitterContext}` : ""}

DATA SOURCES: HL candles (${candles.length} bars) + ${BINANCE_SYMBOLS[ticker] ? "Binance deeper history" : "Finnhub spot"} · All live

${uaContext}
Treat Unusual Activity as supporting context only — it flags abnormal conditions, never a directional signal. Do not raise conviction on it alone.

Calculate the highest probability setup for the ${risk.label} profile.
Every level must be technically defensible. Return JSON only.`;

      // ── Render candlestick chart for Claude vision input ──────────────────
      // Send the actual visual structure (not just indicator text) so Claude
      // can confirm patterns: clean trends, fakeout wicks, double tops at S/R,
      // failed breakouts. Falls open — if rendering fails, signal still ships.
      let chartImageB64: string | null = null;
      if (candles1h && candles1h.length > 0) {
        try {
          const { renderChartPng, computeEmaSeries } = await import("./lib/chartRenderer");
          const closes1h = candles1h.map(c => c.c);
          chartImageB64 = await renderChartPng({
            token: ticker,
            direction: _trendDir || undefined,
            candles: candles1h,
            ema20: computeEmaSeries(closes1h, 20),
            ema50: computeEmaSeries(closes1h, 50),
            support: ind.low24,        // 24h low as visual support reference
            resistance: ind.high24,    // 24h high as visual resistance reference
            entryZone: { low: Math.min(fibConserv, fibAggr), high: Math.max(fibConserv, fibAggr) },
            timeframeLabel: "1h",
          });
        } catch (e: any) {
          console.warn(`[chart-vision] ${ticker} render failed (continuing without):`, e?.message || e);
        }
      }

      // Build content array — text always, image when rendered successfully.
      // Claude messages API supports mixed content blocks for vision.
      const contentBlocks: any[] = [{ type: "text", text: userMsg }];
      if (chartImageB64) {
        contentBlocks.unshift({
          type: "image",
          source: { type: "base64", media_type: "image/png", data: chartImageB64 },
        });
      }

      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{ "Content-Type":"application/json", "x-api-key":apiKey, "anthropic-version":"2023-06-01" },
        body:JSON.stringify({ model:CLAUDE_MODEL, max_tokens:3000, system, messages:[{ role:"user", content: contentBlocks }] }),
      });
      if (!aiRes.ok) { const e = await aiRes.text(); console.error("[/api/quant]", e); return res.status(502).json({ error:"AI Engine failed." }); }

      const aiData: any = await aiRes.json();
      if (aiData.error) { console.error("[/api/quant] API error:", aiData.error.message || aiData.error); return res.status(502).json({ error: "AI Engine failed." }); }
      const rawText = (aiData.content || []).map((b: any) => b.text || "").join("");
      if (!rawText.trim()) {
        console.error("[/api/quant] Empty AI response, stop_reason:", aiData.stop_reason);
        return res.status(502).json({ error: "AI Engine returned empty response — please retry." });
      }
      const repairJson = (s: string): any => {
        let t = s.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
        if (t.includes("{")) t = t.slice(t.indexOf("{"));
        if (t.lastIndexOf("}") > 0) t = t.slice(0, t.lastIndexOf("}") + 1);
        t = t.replace(/,\s*([}\]])/g, "$1");
        try { return JSON.parse(t); } catch { return null; }
      };
      let parsed: any = repairJson(rawText);
      if (!parsed) {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = repairJson(jsonMatch[0]);
      }
      if (!parsed) {
        console.error("[/api/quant parse]", rawText.slice(0,500));
        return res.status(500).json({ error: "AI returned malformed data — please retry." });
      }

      // ── Asset constraint validation: force-correct token if AI substituted ──
      if (parsed.token && parsed.token !== ticker) {
        console.warn(`[Quant] AI returned wrong token: expected ${ticker}, got ${parsed.token} — overriding`);
      }
      if (parsed.asset && typeof parsed.asset === "string" && !parsed.asset.toUpperCase().includes(ticker.toUpperCase())) {
        console.warn(`[Quant] AI returned wrong asset: expected ${ticker}, got ${parsed.asset} — overriding`);
      }
      parsed.token = ticker;
      parsed.asset = ticker;

      // ── PROMPT_V2 shadow run (fire-and-forget; signal-gen surface) ────────
      // Fires AFTER `parsed` is populated so the V2 runner sees the real
      // signal/entry — previously this block was above the JSON-parse
      // boundary and referenced `parsed` via a TDZ-bound closure, which only
      // worked by accident because `await import(...)` yielded first. The
      // IIFE is still `void (async () => {...})()` so it runs in parallel
      // with the remainder of the /api/quant response path and does not
      // block the user-facing result.
      if (getPromptV2Mode() !== "off") {
        const shadowCtx = {
          signal: parsed?.signal,
          entry:  Number(parsed?.entry?.price) || undefined,
        };
        void (async () => {
          try {
            const { runSignalGenV2 } = await import("./lib/promptV2Runner");
            const perfCtxStr = await buildPerformanceContext().catch(() => "");
            const dirGuess: "LONG" | "SHORT" = (String(shadowCtx.signal || "").toUpperCase().includes("SHORT") ? "SHORT" : "LONG");

            // ── Phase 2.1 wiring — final mile ─────────────────────────────
            // Phase 2.1 moved the Regime Gate from prompt math into the
            // deterministic Python scorer, and signalGen.ts learned to read
            // a quantPrepass and emit a `SCORER PREPASS:` line that the
            // SIGNAL_ENGINE_V1 §1 SCORER-AUTHORITATIVE block defers to.
            // What was missing: nobody actually called the scorer here, so
            // the prepass was always empty and the AI kept recomputing
            // regime itself. This block fixes that — it asks the Python
            // scorer for its regime/signal_type/no_signal_reason verdict
            // BEFORE we hand the prompt to Claude.
            //
            // Wrapped in its own try/catch so a quant-service hiccup does
            // NOT cancel the whole V2 shadow comparison — we just omit the
            // SCORER PREPASS line and the prompt falls back to the
            // in-prompt regime math (same legacy behavior as before this
            // change). This is the spec's documented fail-open posture.
            // Phase 2.3 / 2.4 / 2.5 fields added: vol_percentile, rr_multiplier
            // (§3); p_loss_meta + kelly_fraction_applied (§4 — applied here,
            // not in the scorer, since kelly_base requires per-(token,
            // direction) calibration the scorer has no access to);
            // microstructure (§5: cvd_state / obi / ivrv_spread).
            let quantPrepass: {
              regime?: any; signal_type?: any; no_signal_reason?: any;
              direction_probability?: number; conviction?: number;
              vol_percentile?: number; rr_multiplier?: number;
              p_loss_meta?: number; kelly_fraction_applied?: number;
              microstructure?: { cvd_state?: any; obi?: number | null; ivrv_spread?: number | null };
            } | undefined;
            try {
              const { quantScore, normalizeAssetClass } = await import("./quantClient");
              const _ps = await quantScore({
                symbol: ticker,
                timeframe: "1m",
                // Don't ship Node-side bars — the Python scorer pulls real
                // candles internally (HL for perps, Binance/Yahoo for the
                // rest). Same convention as generateSignalPhase2A above.
                equity_usd: 10000,
                conviction: Math.max(0.1, Math.min(1.0, (Number(adjScore) || 60) / 100)),
                // Use the route's known asset class (`cls`) so commodities
                // and FX route to the right scorer data source (METAL /
                // FOREX) instead of falling through to STOCK. Subtlety:
                // for crypto we pass `undefined` so normalizeAssetClass's
                // symbol heuristic can promote BTC → "BTC" and ETH →
                // "ETH" (otherwise the raw "CRYPTO" branch fires first
                // and lumps BTC/ETH into MID_CAP_DEFAULT).
                asset_class: normalizeAssetClass(cls === "crypto" ? undefined : cls, ticker),
              });
              if (_ps?.regime) {
                // Phase 2.2/2.3/2.5: include all deterministic Signal Engine
                // v1 fields the scorer can produce so the AI defers to them
                // via SCORER PREPASS rather than recomputing.
                //
                // Phase 2.4: kelly_fraction_applied is computed HERE (not in
                // the Python scorer) because it depends on kelly_base from
                // the per-(token, direction) calibration block, which lives
                // in this route. Formula matches spec §4:
                //   kelly_fraction_applied = min(0.25,
                //                                kelly_base,
                //                                kelly_base * (1 - p_loss_meta)
                //                                  * regime_size_modifier
                //                                  * conviction)
                // regime_size_modifier = 0.5 in HIGH_VOL, 1.0 elsewhere.
                // The double-cap (0.25 AND kelly_base) enforces "never size
                // up because p_loss_meta is low — kelly_base is the ceiling".
                // Computed lazily so we only run when scorer actually emits
                // p_loss_meta + dual-score fields.
                let _kellyApplied: number | undefined;
                try {
                  if (typeof _ps.p_loss_meta === "number" && typeof _ps.conviction === "number") {
                    const { computeKellyFraction } = await import("./prompts/shared");
                    const _kellyBase = computeKellyFraction((pWin || 0), tp1DistPct, slDistPct, 25);
                    const _regMod = (_ps.regime === "HIGH_VOL") ? 0.5 : 1.0;
                    const _shrunk = _kellyBase * (1 - _ps.p_loss_meta) * _regMod * _ps.conviction;
                    _kellyApplied = Math.max(0, Math.min(0.25, Math.min(_kellyBase, _shrunk)));
                  }
                } catch (e: any) {
                  console.warn(`[PROMPT_V2 prepass] kelly_fraction_applied calc failed for ${ticker}:`, e?.message || e);
                }

                quantPrepass = {
                  regime: _ps.regime,
                  direction_probability: typeof _ps.direction_probability === "number" ? _ps.direction_probability : undefined,
                  conviction: typeof _ps.conviction === "number" ? _ps.conviction : undefined,
                  signal_type: _ps.signal_type ?? null,
                  no_signal_reason: _ps.no_signal_reason ?? null,
                  vol_percentile: typeof _ps.vol_percentile === "number" ? _ps.vol_percentile : undefined,
                  rr_multiplier: typeof _ps.rr_multiplier === "number" ? _ps.rr_multiplier : undefined,
                  p_loss_meta: typeof _ps.p_loss_meta === "number" ? _ps.p_loss_meta : undefined,
                  kelly_fraction_applied: _kellyApplied,
                  microstructure: _ps.microstructure
                    ? {
                        cvd_state:   _ps.microstructure.cvd_state,
                        obi:         _ps.microstructure.obi ?? null,
                        ivrv_spread: _ps.microstructure.ivrv_spread ?? null,
                      }
                    : undefined,
                };
                console.log(
                  `[PROMPT_V2 prepass] ${ticker} regime=${_ps.regime}` +
                  ` signal_type=${_ps.signal_type ?? "n/a"}` +
                  ` no_signal_reason=${_ps.no_signal_reason ?? "n/a"}` +
                  ` rr_mult=${typeof _ps.rr_multiplier === "number" ? _ps.rr_multiplier.toFixed(2) : "n/a"}` +
                  ` p_loss_meta=${typeof _ps.p_loss_meta === "number" ? _ps.p_loss_meta.toFixed(3) : "n/a"}` +
                  ` kelly_applied=${typeof _kellyApplied === "number" ? _kellyApplied.toFixed(4) : "n/a"}` +
                  ` cvd=${_ps.microstructure?.cvd_state ?? "n/a"}` +
                  ` obi=${_ps.microstructure?.obi != null ? _ps.microstructure.obi.toFixed(3) : "null"}`
                );
              }
            } catch (e: any) {
              console.warn(`[PROMPT_V2 prepass] quantScore failed for ${ticker} — proceeding without prepass:`, e?.message || e);
            }

            // Pass hardening context so the V2 path applies the same
            // mechanical gates as the auto-scanner once mode flips to "on".
            // Today (mode=shadow) the value is logged but the gate is skipped
            // — this keeps the wiring honest and ready.
            await runSignalGenV2({
              token: ticker, direction: dirGuess,
              perfContextForCombo: perfCtxStr,
              liveData: indContext.slice(0, 3000),
              kronosOutput: "",
              quantScore: adjScore,
              oiAdjustedScore: adjScore,
              killSwitches: !macroKillSwitch.safe ? [String(macroKillSwitch.warning || "macro")] : [],
              calibration: { winRate: (pWin || 0), avgWinPct: tp1DistPct, avgLossPct: slDistPct, sampleSize: 25, suppressionStatus: "active" },
              hardening: {
                candles: candles1h || [],
                // Deterministic price source order: HL perp → AI-proposed
                // entry → last computed indicator price. `ind.currentPrice`
                // is always populated for every asset class so the fallback
                // never produces NaN.
                currentPrice: Number(hlData[ticker]?.perpPrice) || shadowCtx.entry || Number(ind.currentPrice) || undefined,
                fundingRate: hlData[ticker]?.funding,
                volume24hUsd: Number(hlData[ticker]?.volume) || 0,
                holdHorizon: "scalp",
              },
              // undefined when quant unreachable — signalGen.ts already
              // tests `input.quantPrepass?.regime` and only emits the
              // SCORER PREPASS line when present, so this is safe.
              quantPrepass,
            }, apiKey, JSON.stringify({ signal: shadowCtx.signal, ev: evPct }).slice(0, 500));
          } catch (e: any) { console.warn("[PROMPT_V2 signalGen shadow]", e?.message || e); }
        })();
      }

      // ── ANTI-CHASE OVERRIDE — force NEUTRAL when entering a fully-extended move ──
      // Catches the "buy the top after a 5% pump" failure mode (e.g. PENDLE LONG at +5.5% intraday).
      // Triggered when price is at the extreme of the 24h range AND the daily range is >=4%.
      // Exception: legitimate breakout to NEW 7d high/low with strong volume + multi-tf confluence.
      const sigStr = String(parsed.signal || "").toUpperCase();
      const isLongSig  = sigStr.includes("LONG");
      const isShortSig = sigStr.includes("SHORT");
      const range24Pct = ind.range24hPct || 0;
      const pir        = ind.posInRange ?? 50;
      const volSurge   = (ind.volumeRatio || 1) >= 2.0;
      const breakoutHigh = ind.high7d && ind.currentPrice >= ind.high7d * 0.999;
      const breakoutLow  = ind.low7d  && ind.currentPrice <= ind.low7d  * 1.001;
      const tfAligned    = confluence?.confluent === true;

      const longChase  = isLongSig  && pir >= 80 && range24Pct >= 4 && !(breakoutHigh && volSurge && tfAligned);
      const shortChase = isShortSig && pir <= 20 && range24Pct >= 4 && !(breakoutLow  && volSurge && tfAligned);

      // ── NO-MOMENTUM GATE — block flat-market signals (the "0% move" complaint) ──
      // Daily range <1.5% AND volume not above average = no edge, just chop. Force NEUTRAL.
      const noMomentum = (isLongSig || isShortSig) && range24Pct < 1.5 && (ind.volumeRatio || 1) < 1.2;
      if (noMomentum) {
        const reason = `No-momentum gate: 24h range only ${range24Pct}%, volume ${(ind.volumeRatio || 1).toFixed(2)}× avg — no actionable setup`;
        console.warn(`[Quant] ${ticker} ${sigStr} blocked — ${reason}`);
        parsed.signal = "NEUTRAL";
        parsed.signal_strength = 0;
        parsed.no_momentum_blocked = true;
        parsed.no_momentum_reason = reason;
        parsed.quant_rationale = `${ticker} has only moved ${range24Pct}% over the last 24 hours on ${(ind.volumeRatio || 1).toFixed(2)}× average volume — there is no real edge here, just chop. Forcing a trade in this environment is the fastest way to give back gains.`;
        parsed.invalidation = `Wait for daily range to expand above 1.5% or volume to surge above 1.5× average before re-evaluating ${ticker}.`;
        parsed.thesis = `The market is asleep on ${ticker} right now. The right move is patience — come back when there is a real move to trade.`;
      }

      if (longChase || shortChase) {
        const reason = longChase
          ? `Anti-chase override: posInRange ${pir}% near 24h high, range ${range24Pct}% — buying the top risk`
          : `Anti-chase override: posInRange ${pir}% near 24h low, range ${range24Pct}% — selling the bottom risk`;
        console.warn(`[Quant] ${ticker} ${sigStr} blocked — ${reason}`);
        parsed.signal = "NEUTRAL";
        parsed.signal_strength = 0;
        parsed.anti_chase_blocked = true;
        parsed.anti_chase_reason = reason;
        parsed.quant_rationale = `${ticker} is currently at ${pir}% of its 24h range with a ${range24Pct}% daily span — entering ${isLongSig ? "long" : "short"} here means chasing a move that is already extended. Wait for a pullback toward the 40–60% range zone before re-evaluating.`;
        parsed.invalidation = `Setup re-validated only after price retraces to ${(ind.low24 + (ind.high24 - ind.low24) * 0.5).toFixed(4)} or breaks decisively beyond ${isLongSig ? ind.high24.toFixed(4) : ind.low24.toFixed(4)} on 2x+ volume.`;
        parsed.thesis = `The asset is exhausted at the edge of its 24h range, so a fresh ${isLongSig ? "long" : "short"} here has poor reward-to-risk. Patience for a mean-reversion entry will give a far better setup.`;
      }

      parsed.indicators        = ind;
      parsed.multi_tf          = confluence;
      parsed.bayesian          = bayesian;
      parsed.macro_kill_switch = macroKillSwitch;
      parsed.conviction_tier   = bayesian.tier;
      parsed.patterns          = patternResult;
      parsed.fear_greed        = fng;

      // ─── REGIME ALIGNMENT GATE ─────────────────────────────────────────────
      // Final post-AI sanity check: does the deterministic regime actually
      // support the direction Claude proposed? Six universal checks plus a
      // 7th funding check on crypto perps. ALIGNED = publish, PARTIAL =
      // halve leverage / cap conviction at C, MISALIGNED = force NEUTRAL.
      const fundingForGate = cls === "crypto" ? (hlData[ticker]?.funding ?? null) : null;
      const gate = computeRegimeGate(ind, confluence, bayesian, macroKillSwitch, parsed.signal, {
        assetClass: cls,
        funding: fundingForGate,
      });
      parsed.regime_gate = gate;

      if (gate.action === "BLOCK") {
        parsed.signal           = "NEUTRAL";
        parsed.entry            = null;
        parsed.tp1              = null;
        parsed.tp2              = null;
        parsed.tp3              = null;
        parsed.stopLoss         = null;
        parsed.leverage         = { recommended: 0, max: 0, rationale: "Trade blocked by regime gate." };
        parsed.conviction_tier  = "D";
        parsed.win_probability  = 0;
        parsed.gate_status      = `🛑 BLOCKED — ${gate.verdict.toLowerCase()} (${gate.score}%)`;
        const failing = gate.checks.filter((c: any) => !c.pass).map((c: any) => c.name).join(", ") || "macro window";
        parsed.quant_rationale  =
          `Trade blocked by regime gate. ${gate.reason}. ` +
          `Failing checks: ${failing}. ` +
          `The AI proposed ${gate.direction}, but the deterministic indicators do not support it. ` +
          `Wait for alignment before re-evaluating — taking misaligned setups is the single biggest drag on win rate.`;
      } else if (gate.action === "DOWNGRADE") {
        if (parsed.leverage?.recommended) {
          parsed.leverage.recommended = Math.max(1, Math.round(parsed.leverage.recommended * gate.adjustments.leverageMultiplier));
        }
        if (parsed.leverage?.max) {
          parsed.leverage.max = Math.max(1, Math.round(parsed.leverage.max * gate.adjustments.leverageMultiplier));
        }
        parsed.conviction_tier = gate.adjustments.convictionCap;
        parsed.gate_status     = `⚠️ PARTIAL ALIGNMENT (${gate.score}%) — leverage halved, conviction capped at ${gate.adjustments.convictionCap}`;
        const failing = gate.checks.filter((c: any) => !c.pass).map((c: any) => c.name).join(", ");
        parsed.quant_rationale = `[Regime gate ${gate.score}% — failing: ${failing}] ` + (parsed.quant_rationale || "");
      } else {
        parsed.gate_status = `✅ ALIGNED (${gate.score}%) — regime supports trade`;
      }
      parsed.suppression       = {
        triggered: suppression.triggered,
        flags: suppression.flagsForAI,
        adjusted_probability: suppression.adjustedProbability,
        conviction_downgraded: suppression.convictionDowngraded,
        intraday_drawdown_pct: suppression.intradayDrawdownPct,
      };
      // Always enforce pre-computed validation gate values (cannot be overridden by AI)
      parsed.adjusted_score = adjScore;
      parsed.ev             = evPct;
      parsed.signal_tier    = signalTier;
      parsed.position_size  = {
        ...(parsed.position_size || {}),
        tier:           posTier,
        kelly_fraction: kellyPct,
        margin_pct:     finalMarginPct,
        rationale:      parsed.position_size?.rationale || `Kelly f*=${kellyPct.toFixed(1)}% → ${posTier} sizing, max ${finalMarginPct}% of margin`,
      };
      parsed.fib_entry = {
        spike_high:   spikeHigh,
        spike_low:    spikeLow,
        conservative: fibConserv,
        aggressive:   fibAggr,
        recommended:  fibEntry,
        fib_level:    useAggr ? "0.500 aggressive" : "0.382 conservative",
        window_min:   entryWindowMin,
      };
      // Enforce hold time fields
      if (!parsed.hold) parsed.hold = {};
      parsed.hold.target_exit_min = targetExitMin;
      parsed.hold.hard_exit_min   = hardExitMin;
      const validDurations = ["2-4 hours","12-24 hours","2-3 days","1-2 weeks"];
      if (!parsed.hold.duration || !validDurations.includes(parsed.hold.duration.trim())) {
        const tfId2 = timeframeId || "today";
        parsed.hold.duration = tfId2 === "long" ? "1-2 weeks" : tfId2 === "mid" ? "2-3 days" : atrPctNum > 1.5 ? "2-4 hours" : "12-24 hours";
      }
      // ── Direction / TP / SL validation (fix inverted levels) ──
      // Coerce everything to numbers FIRST — AI sometimes returns string prices
      // which break `>=`/`<=` comparisons in subtle ways.
      if (parsed.signal && parsed.entry && parsed.tp1 && parsed.stopLoss) {
        parsed.entry.price = parseFloat(parsed.entry.price);
        parsed.tp1.price = parseFloat(parsed.tp1.price);
        parsed.stopLoss.price = parseFloat(parsed.stopLoss.price);
        if (parsed.tp2?.price != null) parsed.tp2.price = parseFloat(parsed.tp2.price);
        if (parsed.tp3?.price != null) parsed.tp3.price = parseFloat(parsed.tp3.price);

        const sigUpper = String(parsed.signal).toUpperCase();
        const isLong = sigUpper.includes("LONG");
        const isShort = sigUpper.includes("SHORT");
        const ep = parsed.entry.price;
        const ratios = risk.tpRatios || [1.5, 3.0];

        if ((isLong || isShort) && Number.isFinite(ep) && Number.isFinite(parsed.tp1.price) && Number.isFinite(parsed.stopLoss.price)) {
          // Compute the AI-given stop distance (always positive)
          let slDist = Math.abs(ep - parsed.stopLoss.price);
          // If AI returned zero/tiny SL, synthesize one from ATR-style 1% baseline
          if (slDist < ep * 0.0005) slDist = ep * 0.01;

          let fixedSide = false;
          let fixedTp = false;

          if (isLong) {
            if (parsed.stopLoss.price >= ep) { parsed.stopLoss.price = ep - slDist; fixedSide = true; }
            if (parsed.tp1.price <= ep) { parsed.tp1.price = ep + slDist * ratios[0]; fixedTp = true; }
            if (parsed.tp2?.price != null && parsed.tp2.price <= ep) { parsed.tp2.price = ep + slDist * ratios[1]; fixedTp = true; }
            if (parsed.tp3?.price != null && parsed.tp3.price <= ep) { parsed.tp3.price = ep + slDist * 4.0; fixedTp = true; }
          } else {
            if (parsed.stopLoss.price <= ep) { parsed.stopLoss.price = ep + slDist; fixedSide = true; }
            if (parsed.tp1.price >= ep) { parsed.tp1.price = ep - slDist * ratios[0]; fixedTp = true; }
            if (parsed.tp2?.price != null && parsed.tp2.price >= ep) { parsed.tp2.price = ep - slDist * ratios[1]; fixedTp = true; }
            if (parsed.tp3?.price != null && parsed.tp3.price >= ep) { parsed.tp3.price = ep - slDist * 4.0; fixedTp = true; }
          }

          if (fixedSide || fixedTp) {
            console.warn(`[Quant] ${ticker} ${sigUpper}: AI returned inverted levels — auto-corrected (sl=${parsed.stopLoss.price.toFixed(4)}, tp1=${parsed.tp1.price.toFixed(4)})`);
            parsed.levels_auto_corrected = true;
          }

          // Always recompute gain_pct, rr_ratio, distance_pct from final coherent prices
          slDist = Math.abs(ep - parsed.stopLoss.price);
          if (slDist > 0.000001) {
            parsed.tp1.gain_pct = parseFloat((Math.abs(parsed.tp1.price - ep) / ep * 100).toFixed(2));
            parsed.tp1.rr_ratio = parseFloat((Math.abs(parsed.tp1.price - ep) / slDist).toFixed(2));
            if (parsed.tp2?.price != null) {
              parsed.tp2.gain_pct = parseFloat((Math.abs(parsed.tp2.price - ep) / ep * 100).toFixed(2));
              parsed.tp2.rr_ratio = parseFloat((Math.abs(parsed.tp2.price - ep) / slDist).toFixed(2));
            }
            if (parsed.tp3?.price != null) {
              parsed.tp3.gain_pct = parseFloat((Math.abs(parsed.tp3.price - ep) / ep * 100).toFixed(2));
              parsed.tp3.rr_ratio = parseFloat((Math.abs(parsed.tp3.price - ep) / slDist).toFixed(2));
            }
            parsed.stopLoss.distance_pct = parseFloat((slDist / ep * 100).toFixed(2));
            parsed.rr = parsed.tp1.rr_ratio;
          }
        }
      }
      // ── POST-AI: COOLDOWN + MACRO-HALT ENFORCEMENT ────────────────────────
      // The AI may still propose a direction we already gated; double-check
      // here and force-suppress to NEUTRAL rather than emit a duplicate or a
      // long into a macro flush.
      if (parsed.signal && (parsed.signal.includes("LONG") || parsed.signal.includes("SHORT"))) {
        const aiDir: "LONG" | "SHORT" = parsed.signal.includes("LONG") ? "LONG" : "SHORT";
        const cdHit = aiDir === "LONG" ? cdLong : cdShort;
        if (cdHit.inCooldown) {
          logRejection({
            source: "ai_signal", token: ticker, direction: aiDir,
            reason: "COOLDOWN", detail: `${cdHit.minutesLeft}m left in 2h cooldown`,
          });
          parsed.signal = "NEUTRAL";
          parsed.suppressed = true;
          parsed.suppression_message = `${ticker} ${aiDir} cooldown active — ${cdHit.minutesLeft}m remaining (${COOLDOWN_WINDOW_MINUTES}m floor between same-direction signals).`;
          parsed.suppression_rules = ["COOLDOWN"];
        } else if (aiDir === "LONG" && macroRisk.halted) {
          logRejection({
            source: "ai_signal", token: ticker, direction: "LONG",
            reason: "MACRO_HALT", detail: macroRisk.reason || "BTC -3%/4h",
          });
          parsed.signal = "NEUTRAL";
          parsed.suppressed = true;
          parsed.suppression_message = `LONG suppressed — ${macroRisk.reason || "macro risk-off"}. SHORTs still permitted.`;
          parsed.suppression_rules = ["MACRO_HALT"];
        } else {
          // News-conflict post-AI guard — Claude may still propose against major news
          const newsHit = aiDir === "LONG" ? newsImpactLong : newsImpactShort;
          if (newsHit?.shouldBlock) {
            logRejection({
              source: "ai_signal", token: ticker, direction: aiDir,
              reason: "NEWS_CONFLICT_HIGH",
              detail: `${newsHit.severity} severity contradicts ${aiDir} — ${(newsHit.topHeadlines[0] || "").slice(0, 80)}`,
            });
            parsed.signal = "NEUTRAL";
            parsed.suppressed = true;
            parsed.suppression_message = `${aiDir} suppressed — high-severity news conflict (${newsHit.bearishCount}↓/${newsHit.bullishCount}↑). ${(newsHit.topHeadlines[0] || "").slice(0, 100)}`;
            parsed.suppression_rules = ["NEWS_CONFLICT_HIGH"];
          } else if (newsHit && newsHit.confidenceAdjustment !== 0 && typeof parsed.conviction === "number") {
            // Apply confidence adjustment for medium/low news conflict (or tailwinds)
            parsed.conviction = Math.max(0, Math.min(100, parsed.conviction + newsHit.confidenceAdjustment));
            parsed.news_confidence_adjustment = newsHit.confidenceAdjustment;
          }
        }
      }
      // ── SIGNAL ENGINE HARDENING (mechanical post-AI gates) ──────────────
      // Routes the v1 /api/quant AI plan output through the exact same
      // hardening pipeline already used by the auto-scanner (routes.ts:~1095)
      // and the V2 path (promptV2Runner.ts:~203). Single source of truth —
      // `applySignalHardening` in server/lib/signalHardening.ts.
      //
      // On REJECT: forces NEUTRAL + populates `suppressed`/`suppression_*`
      // fields (matches the pre-existing v1 cooldown/macro/news suppression
      // shape so the client contract is preserved) AND attaches a
      // `rejection` payload in the identical shape V2 returns, so any client
      // that understands the V2 rejection envelope reads both paths
      // identically.
      //
      // On ACCEPT/ADJUST: mutates parsed levels + conviction, recomputes
      // derived metrics (gain_pct, rr_ratio, distance_pct, rr), and attaches
      // `parsed.hardening = { action, sizeMultiplier, rrAfterFriction,
      // adjustments }` mirroring the auto-scanner's signal mutation.
      //
      // Fails open on unexpected errors — matches auto-scanner + V2
      // behaviour — so a transient Coinglass / hardening failure cannot
      // take down a user-facing /api/quant request.
      if (parsed.signal && (parsed.signal.includes("LONG") || parsed.signal.includes("SHORT"))
          && parsed.entry?.price && parsed.stopLoss?.price && parsed.tp1?.price
          && Array.isArray(candles1h) && candles1h.length > 0) {
        let hdDir: "LONG" | "SHORT" = parsed.signal.includes("LONG") ? "LONG" : "SHORT";
        const hdStart = Date.now();
        try {
          const { applySignalHardening, applyBrainLimits, recordOiSample, getOiChangePct } = await import("./lib/signalHardening");
          const { getLiquidityClusters } = await import("./services/coinglass");
          const { rejectionExplanation } = await import("./lib/promptV2Runner");
          const hlCtx: any = (typeof hlData !== "undefined" ? (hlData as any)[ticker] : undefined);
          if (hlCtx?.oi) recordOiSample(ticker, hlCtx.oi);
          const entryPx = Number(parsed.entry.price);

          // ── Module 1 (Setup Archetypes) — classify BEFORE brain check so
          // MEAN_REVERSION_EXHAUSTION can flip the direction and the brain
          // still has final say on the flipped (token, direction) combo.
          // Fully fail-open: any error leaves the original direction intact
          // and tags UNCLASSIFIED.
          try {
            const { classifyArchetype, buildArchetypeContext, shouldFlipForMeanReversion, ARCHETYPE_LOOKBACK_1H } =
              await import("./lib/archetype");
            // Module 2: fetch dedicated 336-bar 1h history (14 daily aggregated
            // bars) so daily ATR(14) is mathematically meaningful. The
            // surrounding TA pipeline keeps its 48-bar `candles1h` — only the
            // archetype classifier upgrades. Fail-open to the smaller array
            // if the wider fetch errors (classifier will degrade per its
            // own lookback gate).
            let archBars1h: any[] = candles1h as any[];
            try {
              const wide = await fetchQuantCandles(ticker, cls, "1h", ARCHETYPE_LOOKBACK_1H);
              if (Array.isArray(wide) && wide.length > (candles1h as any[]).length) {
                archBars1h = wide;
              }
            } catch (wideErr) {
              // keep narrow fallback; classifier will gate atrDaily appropriately
            }
            // Module 2: pull funding/OI through the shared snapshot helper so
            // diagnostics distinguish "ok" / "unavailable" / "no_concept"
            // identically across /api/quant, /api/ai/analyze, /api/kronos.
            // /api/quant is crypto-only today (HL universe) but the helper
            // accepts the asset class so future equity wiring is consistent.
            const { getMicrostructureSnapshot, buildClassificationDiagnostics } =
              await import("./lib/microstructureSnapshot");
            const microQ = getMicrostructureSnapshot(ticker, "crypto");
            const archCtx = buildArchetypeContext({
              token: ticker,
              direction: hdDir,
              price: entryPx,
              candles1h: (archBars1h as any[]).map((c: any) => ({
                open: Number(c.open ?? c.o), high: Number(c.high ?? c.h),
                low: Number(c.low ?? c.l), close: Number(c.close ?? c.c),
                volume: Number(c.volume ?? c.v ?? 0),
                timestamp: Number(c.timestamp ?? c.t ?? c.time ?? 0),
              })),
              fundingRate: microQ.fundingStatus === "ok" ? (microQ.funding ?? undefined) : undefined,
              oiChange6hPct: getOiChangePct(ticker),
              newsContext: (parsed as any).newsContext || (typeof newsImpactLong !== "undefined" ? newsImpactLong : undefined),
            });
            const archResult = classifyArchetype(archCtx);
            (parsed as any).archetype = archResult.archetype;
            (parsed as any).archetype_confidence = +archResult.confidence.toFixed(2);
            (parsed as any).archetype_reason = archResult.reason;
            (parsed as any).archetype_diagnostics = buildClassificationDiagnostics({
              ctx: archCtx as unknown as Record<string, unknown>,
              micro: microQ,
              clausesFired: archResult.archetype !== "UNCLASSIFIED" ? [archResult.archetype.toLowerCase()] : [],
              sourceEndpoint: "quant",
            });
            console.log(`[ARCHETYPE] ${ticker} ${hdDir} → ${archResult.archetype} (conf=${archResult.confidence.toFixed(2)}): ${archResult.reason}`);

            // ── Module 2 T05 — UNCLASSIFIED shadow/hot suppression. In shadow
            // mode (default) we still publish but write a row so admin can
            // measure footprint. In hot mode we early-return with a SUPPRESSED
            // payload AND write the row. Fail-open per-row.
            if (archResult.archetype === "UNCLASSIFIED") {
              try {
                const { archetypeSuppressionEnabled } = await import("./lib/featureFlags");
                const { logSuppressedSignal } = await import("./lib/suppressedSignalsLog");
                const hot = archetypeSuppressionEnabled();
                logSuppressedSignal({
                  ticker, intendedDirection: hdDir, assetClass: cls,
                  sourceEndpoint: "quant",
                  reason: hot ? "suppressed_no_archetype" : "would_suppress_no_archetype",
                  rawSignalPayload: {
                    signal: parsed.signal, entry: parsed.entry?.price,
                    sl: parsed.stopLoss?.price, tp1: parsed.tp1?.price,
                    conviction: parsed.conviction,
                  },
                  classificationDiagnostics: (parsed as any).archetype_diagnostics ?? null,
                }).catch(() => {});
                if (hot) {
                  parsed.signal = "SUPPRESSED";
                  parsed.suppressed = true;
                  parsed.suppression_message = "No matching setup archetype detected — signal withheld.";
                  parsed.suppression_rules = ["no_archetype"];
                  return res.json(parsed);
                }
              } catch { /* shadow log is best-effort */ }
            }

            const flipTo = shouldFlipForMeanReversion(archResult.archetype, archCtx.dayOpen, archCtx.price);
            if (flipTo && flipTo !== hdDir) {
              // FLIP: mean-reversion exhaustion fade. Edge policy / brain check
              // below still has final say — if the flipped (token, direction)
              // combo is historically weak, brain will SUPPRESS it.
              console.log(`[ARCHETYPE] ${ticker} MEAN_REVERSION_EXHAUSTION flip ${hdDir} → ${flipTo} (subject to brain veto)`);
              (parsed as any).archetype_flipped_from = hdDir;
              // Preserve any STRONG_ prefix etc. by swapping the LONG/SHORT token
              parsed.signal = parsed.signal.replace(/LONG/g, "__TMP__").replace(/SHORT/g, "LONG").replace(/__TMP__/g, "SHORT");
              // Sanity: if replacement somehow didn't yield the expected direction, fall back to plain replace
              if (!parsed.signal.includes(flipTo)) parsed.signal = flipTo;
              hdDir = flipTo;
              // Mirror SL/TP around entry so the flipped setup has symmetric levels.
              const ep = entryPx;
              const mirror = (lvl: any) => {
                const n = Number(lvl);
                if (!Number.isFinite(n) || n <= 0) return lvl;
                const m = 2 * ep - n;
                return m > 0 ? m : lvl;
              };
              if (parsed.stopLoss?.price != null) parsed.stopLoss.price = mirror(parsed.stopLoss.price);
              if (parsed.tp1?.price != null) parsed.tp1.price = mirror(parsed.tp1.price);
              if (parsed.tp2?.price != null) parsed.tp2.price = mirror(parsed.tp2.price);
              if (parsed.tp3?.price != null) parsed.tp3.price = mirror(parsed.tp3.price);
            }
          } catch (archErr: any) {
            console.warn(`[ARCHETYPE] ${ticker} classifier error (fail-open):`, archErr?.message || archErr);
            (parsed as any).archetype = "UNCLASSIFIED";
          }

          // ── Per-archetype Wilson-LB win rate for the card UI. Cheap cached
          // query; fail-open returns n=0 which the UI hides.
          if ((parsed as any).archetype && (parsed as any).archetype !== "UNCLASSIFIED") {
            try {
              const { getArchetypeStats } = await import("./lib/statisticalBrain");
              const stats = await getArchetypeStats(ticker, hdDir, (parsed as any).archetype);
              if (stats && stats.n > 0) {
                (parsed as any).archetype_stats = {
                  n: stats.n,
                  wins: stats.wins,
                  losses: stats.losses,
                  wr_point: +stats.wrPointEst.toFixed(4),
                  wr_wilson_lb: +stats.wrWilsonLB.toFixed(4),
                  wr_wilson_lb_80: +stats.wrWilsonLB80.toFixed(4),
                  median_r: +stats.medianR.toFixed(2),
                  p75_hold_min: Math.round(stats.p75HoldMinutes),
                  median_time_to_tp_min: Math.round(stats.medianTimeToTpMin),
                  median_time_to_sl_min: Math.round(stats.medianTimeToSlMin),
                  low_sample: stats.lowSample,
                };
              }
            } catch (statsErr: any) {
              console.warn(`[ARCHETYPE STATS] ${ticker} fall-open:`, statsErr?.message || statsErr);
            }
          }

          const dayVolUsd = Number(hlCtx?.volume) || 0;
          const clusters = await getLiquidityClusters(ticker, entryPx, dayVolUsd);
          const hdHorizon: "scalp" | "swing" = tf.id === "scalp" ? "scalp" : "swing";
          const convIn = typeof parsed.conviction === "number" ? parsed.conviction : (bayesian?.probability ?? 60);

          // ── Statistical Brain limits (STRICT) — gate BEFORE the standard
          // hardening pass so we reject empirically-impossible TPs/SLs/timing
          // before paying the cost of full hardening. Uses the actual AI-chosen
          // direction (not the trend-implied one).
          const brainForActual = hdDir === "LONG" ? brainLong : brainShort;
          if (brainForActual.hasData && brainForActual.limits) {
            // Planned hold in hours. parsed.hold.target_exit_min is in MINUTES.
            // Fall back to horizon defaults only if both target/hard exits are missing.
            const exitMin = Number(parsed.hold?.target_exit_min ?? parsed.hold?.hard_exit_min ?? 0);
            const killClockHrs = exitMin > 0 ? exitMin / 60 : (hdHorizon === "scalp" ? 4 : 24);
            // Translate brain's avgLossPct → minSlPct floor (spec: 0.80 × avg historical loss).
            const minSlPctFromBrain = brainForActual.stat ? brainForActual.stat.avgLossPct * 0.80 : undefined;
            const brainCheck = applyBrainLimits(
              {
                entry: entryPx,
                stopLoss: Number(parsed.stopLoss.price),
                tp1: Number(parsed.tp1.price),
                killClockHrs,
                direction: hdDir,
              },
              {
                maxTpR: brainForActual.limits.maxTpR,
                minSlPct: minSlPctFromBrain,
                maxKillClockHours: brainForActual.limits.maxKillClockHours,
              },
            );
            if (!brainCheck.ok) {
              console.log(`[BRAIN] ${ticker} ${hdDir} REJECTED — ${brainCheck.reason}: ${brainCheck.detail}`);
              logRejection({
                source: "ai_signal", token: ticker, direction: hdDir,
                reason: brainCheck.reason as any, detail: brainCheck.detail,
              });
              const explanation = rejectionExplanation(brainCheck.reason as any, brainCheck.detail, ticker);
              // Use "SUPPRESSED" (not "NEUTRAL") to match the schema used by every
              // other suppression path in /api/quant — keeps the frontend consistent.
              parsed.signal = "SUPPRESSED";
              parsed.suppressed = true;
              parsed.suppression_message = explanation;
              parsed.suppression_rules = [brainCheck.reason];
              (parsed as any).rejection = { status: "rejected", reason_code: brainCheck.reason, explanation, detail: brainCheck.detail };
              (parsed as any).brain = brainForActual;
              // Skip the rest of hardening — we've already vetoed.
              return res.json(parsed);
            }
          }

          console.log(`[HARDENING v1] ${ticker} ${hdDir} entry — entry=${entryPx} sl=${parsed.stopLoss.price} tp1=${parsed.tp1.price} conv=${convIn} horizon=${hdHorizon}`);
          const hard = applySignalHardening({
            token: ticker,
            direction: hdDir,
            entry: entryPx,
            stopLoss: Number(parsed.stopLoss.price),
            tp1: Number(parsed.tp1.price),
            tp2: Number(parsed.tp2?.price ?? parsed.tp1.price),
            conviction: convIn,
            candles: candles1h,
            fundingRate: hlCtx?.funding,
            oiChange6hPct: getOiChangePct(ticker),
            holdHorizon: hdHorizon,
            liquidityClusters: clusters,
            volume24hUsd: dayVolUsd,
            source: "ai_signal",
          });
          if (hard.action === "REJECT") {
            console.log(`[HARDENING v1] ${ticker} ${hdDir} REJECTED — ${hard.reason}: ${hard.detail} (${Date.now()-hdStart}ms)`);
            // Persist to rejection log, consistent with the cooldown/macro/news
            // gates above which also call logRejection.
            logRejection({
              source: "ai_signal", token: ticker, direction: hdDir,
              reason: hard.reason as any, detail: hard.detail,
            });
            const explanation = rejectionExplanation(hard.reason, hard.detail, ticker);
            parsed.signal = "NEUTRAL";
            parsed.suppressed = true;
            parsed.suppression_message = explanation;
            parsed.suppression_rules = [hard.reason];
            (parsed as any).rejection = { status: "rejected", reason_code: hard.reason, explanation, detail: hard.detail };
          } else {
            // ACCEPT or ADJUST — apply mutations and recompute derived metrics
            parsed.entry.price = hard.signal.entry;
            parsed.stopLoss.price = hard.signal.stopLoss;
            parsed.tp1.price = hard.signal.tp1;
            if (parsed.tp2) parsed.tp2.price = hard.signal.tp2;
            parsed.conviction = hard.signal.conviction;
            const ep2 = parsed.entry.price;
            const slDist2 = Math.abs(ep2 - parsed.stopLoss.price);
            if (slDist2 > 0.000001) {
              parsed.tp1.gain_pct = parseFloat((Math.abs(parsed.tp1.price - ep2) / ep2 * 100).toFixed(2));
              parsed.tp1.rr_ratio = parseFloat((Math.abs(parsed.tp1.price - ep2) / slDist2).toFixed(2));
              if (parsed.tp2?.price != null) {
                parsed.tp2.gain_pct = parseFloat((Math.abs(parsed.tp2.price - ep2) / ep2 * 100).toFixed(2));
                parsed.tp2.rr_ratio = parseFloat((Math.abs(parsed.tp2.price - ep2) / slDist2).toFixed(2));
              }
              parsed.stopLoss.distance_pct = parseFloat((slDist2 / ep2 * 100).toFixed(2));
              parsed.rr = parsed.tp1.rr_ratio;
            }
            (parsed as any).hardening = {
              action: hard.action,
              sizeMultiplier: hard.signal.sizeMultiplier,
              rrAfterFriction: hard.signal.rrAfterFriction,
              adjustments: hard.adjustments,
            };
            console.log(`[HARDENING v1] ${ticker} ${hdDir} ${hard.action}${hard.adjustments.length ? ` — adjustments: ${hard.adjustments.map(a => a.type).join(", ")}` : ""} (${Date.now()-hdStart}ms)`);
          }
        } catch (e: any) {
          console.warn(`[HARDENING v1] ${ticker} ${hdDir} gate error, fail-open:`, e?.message || e);
        }

        // ── HardTrendFilter + ConvictionCap (May 2026 publisher gates) ──────
        // Mirrors the scanner / /analyze / /kronos wiring so /api/quant
        // (the deterministic per-ticker quant scorer) cannot bypass the
        // win-rate hardening that the other three publish paths enforce.
        // Both gates wrapped in try/catch — any error leaves the signal
        // flowing unmodified.
        try {
          const { evaluateHardTrendFilter, fetchBinanceTrendCandles } = await import("./lib/hardTrendFilter");
          const { applyConvictionCap, recordHighConvictionReview } = await import("./lib/convictionCap");
          const { hardTrendFilterEnabled, convictionCapEnabled } = await import("./lib/featureFlags");
          const { logSuppressedSignal } = await import("./lib/suppressedSignalsLog");

          // /api/quant is crypto-only today — fetch via Binance helper
          // (10-min per-symbol cache). Fail-open returns empty arrays which
          // the filter degrades to insufficient_data → PASS.
          const { dailyCandles, hourlyCandles } = await fetchBinanceTrendCandles(ticker);
          const trendRes = evaluateHardTrendFilter({
            direction: hdDir,
            archetype: (parsed as any).archetype ?? null,
            currentPrice: Number(parsed.entry?.price ?? 0),
            dailyCandles,
            hourlyCandles,
          });
          (parsed as any).trendFilter = {
            decision: trendRes.decision,
            reason: trendRes.reason,
            trend: trendRes.trend,
            intradayTrend: trendRes.intradayTrend,
            strong: trendRes.strong,
          };
          if (trendRes.decision === "SUPPRESS") {
            const hot = hardTrendFilterEnabled();
            logSuppressedSignal({
              ticker, intendedDirection: hdDir, assetClass: cls,
              sourceEndpoint: "quant",
              reason: hot
                ? "suppressed_counter_trend_no_mean_rev_archetype"
                : "would_suppress_counter_trend_no_mean_rev_archetype",
              rawSignalPayload: {
                signal: parsed.signal, entry: parsed.entry?.price,
                conviction: parsed.conviction, archetype: (parsed as any).archetype,
                trend: trendRes.trend,
              },
            }).catch(() => {});
            if (hot) {
              parsed.signal = "SUPPRESSED";
              parsed.suppressed = true;
              parsed.suppression_message = `Counter-trend signal blocked — daily trend is ${trendRes.trend} and archetype is not MEAN_REVERSION_EXHAUSTION.`;
              parsed.suppression_rules = ["counter_trend_no_mean_rev_archetype"];
              return res.json(parsed);
            }
          }

          if (convictionCapEnabled() && typeof parsed.conviction === "number") {
            const capRes = applyConvictionCap(parsed.conviction);
            (parsed as any).displayedConviction = capRes.displayedConviction;
            if (capRes.capped) {
              (parsed as any).highConvictionReview = true;
              recordHighConvictionReview({
                rawConviction: capRes.rawConviction,
                sourceEndpoint: "quant",
                token: ticker,
                direction: hdDir,
                archetype: (parsed as any).archetype ?? null,
                signalId: null,
                aiSignalLogId: null,
                featureSnapshot: {
                  bayesian_probability: bayesian?.probability ?? null,
                  advanced_score: adjScore ?? null,
                  confluence_direction: confluence?.direction ?? null,
                  archetype: (parsed as any).archetype ?? null,
                  trend: trendRes.trend,
                  intraday_trend: trendRes.intradayTrend,
                  strong_trend: trendRes.strong,
                  rr: parsed.rr ?? null,
                  source: "quant",
                },
              }, capRes).catch(() => {});
            }
          }
        } catch (gateErr: any) {
          console.warn(`[QUANT GATES] ${ticker} ${hdDir} fail-open:`, gateErr?.message || gateErr);
        }
      }

      // Unified gate audit log — one line per signal attempt summarising every gate
      console.log(`[SIGNAL GATE] ${ticker} ${parsed.signal || "NONE"} — adaptL.suppressed=${!!adaptLong?.suppressed}, adaptS.suppressed=${!!adaptShort?.suppressed}, cdL=${cdLong.inCooldown ? cdLong.minutesLeft + "m" : "ok"}, cdS=${cdShort.inCooldown ? cdShort.minutesLeft + "m" : "ok"}, macroHalt=${macroRisk.halted}, circuit=${isHalted()}`);
      // Remove tp3 if AI hallucinated it when conditions not met
      if (!(adjScore >= 85 && oiM > 100)) delete parsed.tp3;
      if (!parsed.rr && parsed.tp1?.price && parsed.stopLoss?.price && parsed.entry?.price) {
        const rAmt = Math.abs(parsed.entry.price - parsed.stopLoss.price);
        const rwAmt = Math.abs(parsed.tp1.price - parsed.entry.price);
        parsed.rr = rAmt > 0.000001 ? rwAmt / rAmt : 0;
      }
      // ── Log to ai_signal_log (non-blocking) ──────────────────────────────
      if (parsed.signal && (parsed.signal.includes("LONG") || parsed.signal.includes("SHORT")) && parsed.entry?.price) {
        const killHours = tf.id === "scalp" ? 4 : tf.id === "day" ? 24 : tf.id === "swing" ? 72 : 168;
        // ── pwin Phase 1 — passive calibration snapshot ───────────────────
        // Build the snapshot from what's already in scope here (no new HTTP
        // calls, fully passive). direction_probability + p_loss_meta_proxy
        // are NULL on this code path because the V2 prepass pipeline isn't
        // live in production yet — once it is, those columns light up
        // automatically. Bayesian.probability is the closest existing proxy
        // and is logged in features_snapshot for cross-checking.
        const _dir = parsed.signal.includes("LONG") ? "long" : "short";
        const _pwin = await (async (): Promise<import("./lib/calibrationLog").PwinSnapshot | undefined> => {
          try {
            // Dynamic imports match the existing pattern at L1137 / L5698 and
            // hit Node's module cache after first call (negligible latency).
            const { normalizeAssetClass } = await import("./quantClient");
            const { instrumentClassFromScorer } = await import("./lib/calibrationLog");
            const scorerCls = normalizeAssetClass(undefined, ticker);
            return {
              instrument: ticker,
              instrumentClass: instrumentClassFromScorer(scorerCls),
              side: _dir as "long" | "short",
              entry: Number(parsed.entry.price),
              asofTs: Date.now(),
              tp: parsed.tp1?.price ?? null,
              sl: parsed.stopLoss?.price ?? null,
              holdWindowBars: killHours, // 1h-bar approximation; refine in Phase 2 with timeframe map
              directionProbability: null,
              directionProbabilityCalibrated: null,
              pLossMetaProxy: null,
              conviction: typeof parsed.conviction === "number" ? parsed.conviction : null,
              regime: typeof (parsed as any).regime === "string" ? (parsed as any).regime : null,
              timeframe: tf.id || null,
              atrPct: null,
              featuresSnapshot: {
                bayesian_probability: bayesian?.probability ?? null,
                advanced_score: adjScore ?? null,
                confluence_direction: confluence?.direction ?? null,
                edge: parsed.edge ?? null,
                edge_source: parsed.edge_source ?? null,
                kronos: !!parsed.kronos,
                source: "quant_scanner",
              },
            };
          } catch {
            return undefined; // never block signal publication on snapshot build
          }
        })();
        logSignal({
          source: "quant_scanner",
          token: ticker,
          direction: parsed.signal.includes("LONG") ? "LONG" : "SHORT",
          tradeType: tf.id || null,
          entryPrice: parsed.entry.price,
          tp1Price: parsed.tp1?.price ?? null,
          tp2Price: parsed.tp2?.price ?? null,
          tp3Price: parsed.tp3?.price ?? null,
          stopLoss: parsed.stopLoss?.price ?? null,
          leverage: parsed.leverage ? String(parsed.leverage) : null,
          conviction: typeof parsed.conviction === "number" ? parsed.conviction : (bayesian?.probability ?? null),
          edgeScore: parsed.edge || null,
          edgeSource: parsed.edge_source || null,
          kronos: !!parsed.kronos,
          killClockHours: killHours,
          thesis: parsed.thesis || null,
          invalidation: parsed.invalidation || null,
          scores: { bayesian: bayesian?.probability, advanced: adjScore, confluence: confluence?.direction },
          pwin: _pwin,
          archetype: (parsed as any).archetype || undefined,
          classificationSource: "live",
          classificationDiagnostics: (parsed as any).archetype_diagnostics || undefined,
          newsContext: (() => {
            const dir = parsed.signal.includes("LONG") ? "LONG" : "SHORT";
            const ni = dir === "LONG" ? newsImpactLong : newsImpactShort;
            if (!ni) return null;
            return {
              hasConflict: ni.hasConflict,
              severity: ni.severity,
              bearishCount: ni.bearishCount,
              bullishCount: ni.bullishCount,
              neutralCount: ni.neutralCount,
              confidenceAdjustment: ni.confidenceAdjustment,
              topHeadlines: ni.topHeadlines,
            };
          })(),
        }).catch(() => {});
      }
      // ── FINAL GEOMETRY GUARD ──────────────────────────────────────────────
      // Last line of defense: if any upstream path (LLM, archetype flip,
      // hardener, brain INVERT) ended up with a direction badge whose
      // SL/TP geometry contradicts it (e.g. SHORT with SL<entry & TP>entry),
      // mirror prices around entry so the card matches the action the user
      // would take. Same shape as the pre-LLM auto-correct at L6643 but
      // runs AFTER every mutation in the pipeline so it catches anything
      // that slipped through. Fails open on any error.
      try {
        if (parsed?.signal && parsed.entry?.price && parsed.stopLoss?.price && parsed.tp1?.price) {
          const sigU = String(parsed.signal).toUpperCase();
          const isLong  = sigU.includes("LONG");
          const isShort = sigU.includes("SHORT");
          const ep = Number(parsed.entry.price);
          const sl = Number(parsed.stopLoss.price);
          const t1 = Number(parsed.tp1.price);
          if ((isLong || isShort) && Number.isFinite(ep) && ep > 0 && Number.isFinite(sl) && Number.isFinite(t1)) {
            // Per-leg mismatch: a level is "wrong side" if it's on the side
            // the badge says it shouldn't be on. LONG → SL must be < ep,
            // TPs must be > ep; SHORT → mirror. This catches partial shapes
            // (e.g. LONG with SL>ep but TP also >ep) that the full-shape
            // check would miss after a downstream mutation.
            const wrongSide = (lvl: any, isStop: boolean): boolean => {
              if (lvl == null) return false;
              const n = Number(lvl);
              if (!Number.isFinite(n)) return false;
              if (isLong)  return isStop ? n >= ep : n <= ep;
              /* short */   return isStop ? n <= ep : n >= ep;
            };
            const anyWrong =
              wrongSide(sl, true) ||
              wrongSide(parsed.tp1?.price, false) ||
              (parsed.tp2?.price != null && wrongSide(parsed.tp2.price, false)) ||
              (parsed.tp3?.price != null && wrongSide(parsed.tp3.price, false));
            if (anyWrong) {
              const mirrorIfWrong = (lvl: any, isStop: boolean): any => {
                if (!wrongSide(lvl, isStop)) return lvl;
                const m = 2 * ep - Number(lvl);
                return m > 0 ? m : lvl;
              };
              parsed.stopLoss.price = mirrorIfWrong(parsed.stopLoss.price, true);
              if (parsed.tp1?.price != null) parsed.tp1.price = mirrorIfWrong(parsed.tp1.price, false);
              if (parsed.tp2?.price != null) parsed.tp2.price = mirrorIfWrong(parsed.tp2.price, false);
              if (parsed.tp3?.price != null) parsed.tp3.price = mirrorIfWrong(parsed.tp3.price, false);
              const slDist = Math.abs(ep - Number(parsed.stopLoss.price));
              if (slDist > 0.000001 && ep > 0) {
                if (parsed.tp1?.price != null) {
                  parsed.tp1.gain_pct = parseFloat((Math.abs(Number(parsed.tp1.price) - ep) / ep * 100).toFixed(2));
                  parsed.tp1.rr_ratio = parseFloat((Math.abs(Number(parsed.tp1.price) - ep) / slDist).toFixed(2));
                }
                if (parsed.tp2?.price != null) {
                  parsed.tp2.gain_pct = parseFloat((Math.abs(Number(parsed.tp2.price) - ep) / ep * 100).toFixed(2));
                  parsed.tp2.rr_ratio = parseFloat((Math.abs(Number(parsed.tp2.price) - ep) / slDist).toFixed(2));
                }
                if (parsed.tp3?.price != null) {
                  parsed.tp3.gain_pct = parseFloat((Math.abs(Number(parsed.tp3.price) - ep) / ep * 100).toFixed(2));
                  parsed.tp3.rr_ratio = parseFloat((Math.abs(Number(parsed.tp3.price) - ep) / slDist).toFixed(2));
                }
                parsed.stopLoss.distance_pct = parseFloat((slDist / ep * 100).toFixed(2));
                parsed.rr = parsed.tp1?.rr_ratio ?? parsed.rr;
              }
              parsed.geometry_auto_corrected = true;
              console.warn(`[Quant] ${ticker} ${sigU}: final geometry guard mirrored prices to match direction badge`);
            }
          }
        }
      } catch (geoErr: any) {
        console.warn("[Quant] geometry guard failed (non-fatal):", geoErr?.message || geoErr);
      }
      res.json(parsed);
    } catch (err: any) {
      console.error("[Quant Engine]", err);
      res.status(500).json({ error:"Internal server error in Quant Engine." });
    }
  });

  // ── /api/performance-context — AI learning context (plain text) ──────────
```

#### `client/src/components/ai/QuantScanner.jsx`
```jsx
import { useState, useCallback } from "react";
import SignalCard, { SuppressedSignal } from "./SignalCard.jsx";
import ScanSummary from "./ScanSummary.jsx";
import { useDataBus } from "../../context/DataBusContext.jsx";

const MONO = "'IBM Plex Mono', monospace";
const SERIF = "'Playfair Display', Georgia, serif";
const SANS = "'Barlow', system-ui, sans-serif";

const FULL_ASSET_LIBRARY = [
  { ticker:"BTC", name:"Bitcoin", cat:"CRYPTO" },{ ticker:"ETH", name:"Ethereum", cat:"CRYPTO" },
  { ticker:"SOL", name:"Solana", cat:"CRYPTO" },{ ticker:"BNB", name:"BNB", cat:"CRYPTO" },
  { ticker:"XRP", name:"XRP", cat:"CRYPTO" },{ ticker:"AVAX", name:"Avalanche", cat:"CRYPTO" },
  { ticker:"DOGE", name:"Dogecoin", cat:"CRYPTO" },{ ticker:"LINK", name:"Chainlink", cat:"CRYPTO" },
  { ticker:"ARB", name:"Arbitrum", cat:"CRYPTO" },{ ticker:"PEPE", name:"Pepe", cat:"CRYPTO" },
  { ticker:"ADA", name:"Cardano", cat:"CRYPTO" },{ ticker:"DOT", name:"Polkadot", cat:"CRYPTO" },
  { ticker:"UNI", name:"Uniswap", cat:"CRYPTO" },{ ticker:"AAVE", name:"Aave", cat:"CRYPTO" },
  { ticker:"NEAR", name:"NEAR", cat:"CRYPTO" },{ ticker:"SUI", name:"Sui", cat:"CRYPTO" },
  { ticker:"APT", name:"Aptos", cat:"CRYPTO" },{ ticker:"OP", name:"Optimism", cat:"CRYPTO" },
  { ticker:"TIA", name:"Celestia", cat:"CRYPTO" },{ ticker:"SEI", name:"Sei", cat:"CRYPTO" },
  { ticker:"JUP", name:"Jupiter", cat:"CRYPTO" },{ ticker:"ONDO", name:"Ondo", cat:"CRYPTO" },
  { ticker:"RENDER", name:"Render", cat:"CRYPTO" },{ ticker:"INJ", name:"Injective", cat:"CRYPTO" },
  { ticker:"FET", name:"Fetch.ai", cat:"CRYPTO" },{ ticker:"TAO", name:"Bittensor", cat:"CRYPTO" },
  { ticker:"PENDLE", name:"Pendle", cat:"CRYPTO" },{ ticker:"HBAR", name:"Hedera", cat:"CRYPTO" },
  { ticker:"TRUMP", name:"Trump", cat:"CRYPTO" },{ ticker:"HYPE", name:"Hyperliquid", cat:"CRYPTO" },
  { ticker:"WIF", name:"dogwifhat", cat:"CRYPTO" },
  { ticker:"SHIB", name:"Shiba Inu", cat:"CRYPTO" },{ ticker:"BONK", name:"Bonk", cat:"CRYPTO" },
  { ticker:"FLOKI", name:"Floki", cat:"CRYPTO" },{ ticker:"ATOM", name:"Cosmos", cat:"CRYPTO" },
  { ticker:"POL", name:"Polygon", cat:"CRYPTO" },{ ticker:"LDO", name:"Lido", cat:"CRYPTO" },
  { ticker:"MKR", name:"Maker", cat:"CRYPTO" },{ ticker:"FIL", name:"Filecoin", cat:"CRYPTO" },
  { ticker:"ICP", name:"Internet Computer", cat:"CRYPTO" },{ ticker:"WLD", name:"Worldcoin", cat:"CRYPTO" },
  { ticker:"TSLA", name:"Tesla", cat:"EQUITY" },{ ticker:"NVDA", name:"NVIDIA", cat:"EQUITY" },
  { ticker:"AAPL", name:"Apple", cat:"EQUITY" },{ ticker:"GOOGL", name:"Alphabet", cat:"EQUITY" },
  { ticker:"META", name:"Meta", cat:"EQUITY" },{ ticker:"MSFT", name:"Microsoft", cat:"EQUITY" },
  { ticker:"AMZN", name:"Amazon", cat:"EQUITY" },{ ticker:"MSTR", name:"MicroStrategy", cat:"EQUITY" },
  { ticker:"AMD", name:"AMD", cat:"EQUITY" },{ ticker:"PLTR", name:"Palantir", cat:"EQUITY" },
  { ticker:"COIN", name:"Coinbase", cat:"EQUITY" },{ ticker:"HOOD", name:"Robinhood", cat:"EQUITY" },
  { ticker:"NFLX", name:"Netflix", cat:"EQUITY" },{ ticker:"ORCL", name:"Oracle", cat:"EQUITY" },
  { ticker:"TSM", name:"TSMC", cat:"EQUITY" },{ ticker:"GME", name:"GameStop", cat:"EQUITY" },
  { ticker:"RIVN", name:"Rivian", cat:"EQUITY" },{ ticker:"BABA", name:"Alibaba", cat:"EQUITY" },
  { ticker:"HIMS", name:"Hims & Hers", cat:"EQUITY" },{ ticker:"CRCL", name:"Circle", cat:"EQUITY" },
  { ticker:"SPY", name:"S&P 500 ETF", cat:"EQUITY" },{ ticker:"QQQ", name:"Nasdaq 100 ETF", cat:"EQUITY" },
  { ticker:"IWM", name:"Russell 2000 ETF", cat:"EQUITY" },{ ticker:"DIA", name:"Dow Jones ETF", cat:"EQUITY" },
  { ticker:"XAU", name:"Gold", cat:"COMMODITY" },{ ticker:"XAG", name:"Silver", cat:"COMMODITY" },
  { ticker:"WTI", name:"Oil WTI", cat:"COMMODITY" },{ ticker:"BRENT", name:"Brent Crude", cat:"COMMODITY" },
  { ticker:"NATGAS", name:"Natural Gas", cat:"COMMODITY" },{ ticker:"COPPER", name:"Copper", cat:"COMMODITY" },
  { ticker:"PLATINUM", name:"Platinum", cat:"COMMODITY" },
  { ticker:"EURUSD", name:"EUR/USD", cat:"FX" },{ ticker:"GBPUSD", name:"GBP/USD", cat:"FX" },
  { ticker:"USDJPY", name:"USD/JPY", cat:"FX" },{ ticker:"USDCHF", name:"USD/CHF", cat:"FX" },
  { ticker:"AUDUSD", name:"AUD/USD", cat:"FX" },{ ticker:"USDCAD", name:"USD/CAD", cat:"FX" },
  { ticker:"NZDUSD", name:"NZD/USD", cat:"FX" },{ ticker:"EURGBP", name:"EUR/GBP", cat:"FX" },
  { ticker:"EURJPY", name:"EUR/JPY", cat:"FX" },{ ticker:"GBPJPY", name:"GBP/JPY", cat:"FX" },
  { ticker:"USDMXN", name:"USD/MXN", cat:"FX" },{ ticker:"USDZAR", name:"USD/ZAR", cat:"FX" },
  { ticker:"USDTRY", name:"USD/TRY", cat:"FX" },{ ticker:"USDSGD", name:"USD/SGD", cat:"FX" },
];

const CAT_COLORS = { CRYPTO: "#9945ff", EQUITY: "#3b82f6", COMMODITY: "#d4af37", FX: "#00e5ff" };
const TOP_5 = ["BTC", "ETH", "SOL", "BNB", "NVDA"];

function ASSET_CLASS(ticker) {
  const a = FULL_ASSET_LIBRARY.find(x => x.ticker === ticker);
  if (!a) return "crypto";
  if (a.cat === "EQUITY") return "equity";
  if (a.cat === "COMMODITY") return "commodity";
  if (a.cat === "FX") return "fx";
  return "crypto";
}

export default function QuantScanner({ mode, isPro, isElite }) {
  const [selected, setSelected] = useState(["BTC"]);
  const [market, setMarket] = useState("PERP");
  const [risk, setRisk] = useState("mid");
  const [tf, setTf] = useState("hours");
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("ALL");

  const { regime, killSwitch, macroEvents: macroEvts, prices, funding, oi } = useDataBus();

  const toggle = useCallback((t) => {
    setSelected(prev => {
      if (prev.includes(t)) return prev.filter(x => x !== t);
      if (prev.length >= 5) return prev;
      return [...prev, t];
    });
  }, []);

  const runScan = async () => {
    if (selected.length === 0 || scanning) return;
    setScanning(true);
    setResults([]);
    setProgress({ done: 0, total: selected.length });

    const collected = [];
    for (let i = 0; i < selected.length; i++) {
      const ticker = selected[i];
      const ac = ASSET_CLASS(ticker);
      // Crypto + FX both support PERP (Hyperliquid lists both). Equities/commodities are SPOT-only.
      const supportsPerp = ac === "crypto" || ac === "fx";
      const assetMarket = supportsPerp ? market : "SPOT";
      try {
        const res = await fetch("/api/quant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            ticker, marketType: assetMarket, riskId: risk, timeframeId: tf, assetClass: ac,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed (${res.status})`);
        }
        const data = await res.json();
        if (data.signal !== "SUPPRESSED" && !data.rr && data.entry?.price && data.tp1?.price && data.stopLoss?.price) {
          const r = Math.abs(data.entry.price - data.stopLoss.price);
          const w = Math.abs(data.tp1.price - data.entry.price);
          data.rr = r > 0.000001 ? w / r : 0;
        }
        collected.push({ ticker, result: data, error: null, fundingRate: funding[ticker] || 0 });
      } catch (err) {
        collected.push({ ticker, result: null, error: err.message });
      }
      setProgress({ done: i + 1, total: selected.length });
    }
    setScanning(false);
    setResults(collected);
  };

  const hasValidSignal = (r) => r.result && r.result.signal !== "SUPPRESSED" && r.result.signal && r.result.entry?.price;
  const qualifying = results.filter(r => hasValidSignal(r) && (r.result.rr == null || r.result.rr >= 1.3))
    .sort((a, b) => (b.result.win_probability || 0) - (a.result.win_probability || 0));
  const belowThreshold = results.filter(r => hasValidSignal(r) && r.result.rr != null && r.result.rr < 1.3)
    .sort((a, b) => (b.result.rr || 0) - (a.result.rr || 0));
  const suppressed = results.filter(r => r.result && r.result.signal === "SUPPRESSED");
  const errors = results.filter(r => r.error);
  const hasDone = results.length > 0 && !scanning;

  const filtered = FULL_ASSET_LIBRARY.filter(a => {
    const mc = catFilter === "ALL" || a.cat === catFilter;
    const q = search.toLowerCase();
    const ms = !q || a.ticker.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
    return mc && ms;
  });

  return (
    <div data-testid="section-quant-scanner" style={{ marginBottom: 24 }}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontFamily: SERIF, color: "#e0e0e0", fontWeight: 700 }}>Quant Scanner</h3>
        <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: MONO, marginTop: 2, letterSpacing: "0.08em" }}>
          MASTERBRAIN · BAYESIAN SCORING · MULTI-TF CONFLUENCE
        </div>
      </div>

      <div style={{ background: "#0c1220", border: "1px solid rgba(201,168,76,0.15)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ position: "relative", marginBottom: 10 }}>
          <input
            type="text" placeholder="Search assets..." value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-scanner-search"
            style={{ width: "100%", boxSizing: "border-box", background: "#0a0f1e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "9px 12px 9px 32px", color: "#e0e0e0", fontFamily: MONO, fontSize: 11, outline: "none" }}
          />
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, opacity: 0.3 }}>🔍</span>
        </div>

        <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
          {["ALL", "CRYPTO", "EQUITY", "COMMODITY", "FX"].map(c => (
            <button key={c} data-testid={`btn-scan-cat-${c}`} onClick={() => setCatFilter(c)} style={{
              padding: "4px 10px", borderRadius: 5,
              border: `1px solid ${catFilter === c ? (CAT_COLORS[c] || "rgba(201,168,76,0.4)") : "rgba(255,255,255,0.06)"}`,
              background: catFilter === c ? `${CAT_COLORS[c] || "#c9a84c"}15` : "transparent",
              color: catFilter === c ? (CAT_COLORS[c] || "#c9a84c") : "rgba(255,255,255,0.3)",
              fontFamily: MONO, fontSize: 8, cursor: "pointer", fontWeight: catFilter === c ? 700 : 400,
            }}>{c}</button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: MONO }}>{selected.length}/5</span>
          <button data-testid="btn-top5" onClick={() => setSelected(TOP_5.slice())} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid rgba(34,197,94,0.25)", background: "rgba(34,197,94,0.06)", color: "#22c55e", fontFamily: MONO, fontSize: 8, cursor: "pointer" }}>⭐ TOP 5</button>
          {selected.length > 0 && <button data-testid="btn-clear-scan" onClick={() => setSelected([])} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.06)", color: "#ef4444", fontFamily: MONO, fontSize: 8, cursor: "pointer" }}>CLEAR</button>}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 200, overflowY: "auto" }}>
          {filtered.map(a => {
            const isSel = selected.includes(a.ticker);
            const col = CAT_COLORS[a.cat] || "#6b7a99";
            const disabled = !isSel && selected.length >= 5;
            return (
              <button key={a.ticker} data-testid={`scan-chip-${a.ticker}`} onClick={() => !disabled && toggle(a.ticker)} style={{
                padding: "5px 10px", borderRadius: 6,
                border: `1px solid ${isSel ? col : "rgba(255,255,255,0.06)"}`,
                background: isSel ? `${col}18` : "transparent",
                color: isSel ? col : "rgba(255,255,255,0.4)",
                fontFamily: MONO, fontSize: 9, cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.3 : 1, fontWeight: isSel ? 700 : 400,
              }}>{a.ticker}</button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <select data-testid="select-scan-tf" value={tf} onChange={e => setTf(e.target.value)} style={{ flex: 1, background: "#0c1220", border: "1px solid rgba(201,168,76,0.15)", borderRadius: 8, padding: "9px 10px", color: "#e0e0e0", fontFamily: MONO, fontSize: 10, outline: "none" }}>
          <optgroup label="Today">
            <option value="quick">Quick (&lt;1h)</option>
            <option value="hours">Hours (1–8h)</option>
            <option value="fullday">Full Day (8–24h)</option>
          </optgroup>
          <option value="mid">Mid-Term (1–4 wks)</option>
          <option value="long">Long-Term (1–3 mo)</option>
        </select>
        <select data-testid="select-scan-market" value={market} onChange={e => setMarket(e.target.value)} style={{ flex: 1, background: "#0c1220", border: "1px solid rgba(201,168,76,0.15)", borderRadius: 8, padding: "9px 10px", color: "#e0e0e0", fontFamily: MONO, fontSize: 10, outline: "none" }}>
          <option value="PERP">PERP</option>
          <option value="SPOT">SPOT</option>
          <option value="BOTH">BOTH</option>
        </select>
        <select data-testid="select-scan-risk" value={risk} onChange={e => setRisk(e.target.value)} style={{ flex: 1, background: "#0c1220", border: "1px solid rgba(201,168,76,0.15)", borderRadius: 8, padding: "9px 10px", color: "#e0e0e0", fontFamily: MONO, fontSize: 10, outline: "none" }}>
          <option value="low">Conservative</option>
          <option value="mid">Balanced</option>
          <option value="high">Aggressive</option>
        </select>
        <button
          data-testid="btn-execute-scan"
          onClick={runScan}
          disabled={scanning || selected.length === 0}
          style={{
            padding: "9px 18px", borderRadius: 8,
            background: scanning ? "rgba(201,168,76,0.04)" : "linear-gradient(135deg, rgba(201,168,76,0.15), rgba(201,168,76,0.08))",
            border: `1px solid ${scanning ? "rgba(201,168,76,0.1)" : "rgba(201,168,76,0.3)"}`,
            color: scanning ? "rgba(255,255,255,0.3)" : "#e8c96d",
            fontFamily: MONO, fontSize: 10, fontWeight: 700, cursor: scanning ? "not-allowed" : "pointer",
          }}
        >
          {scanning ? "Scanning..." : "Execute →"}
        </button>
      </div>

      {scanning && (
        <div style={{ textAlign: "center", padding: "24px 16px" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🧠</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#e8c96d", fontFamily: MONO, letterSpacing: "0.1em", marginBottom: 8 }}>MASTERBRAIN ACTIVE</div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>Analyzing {progress.done} / {progress.total} assets...</div>
          <div style={{ width: "60%", margin: "10px auto", height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`, background: "linear-gradient(90deg, #c9a84c, #22c55e)", borderRadius: 3, transition: "width 0.5s ease" }} />
          </div>
        </div>
      )}

      {hasDone && (
        <ScanSummary scanned={results.length} found={qualifying.length} suppressed={suppressed.length} errors={errors.length} regime={regime} />
      )}

      {qualifying.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {qualifying.map((r, i) => (
            <SignalCard key={r.ticker} ticker={r.ticker} result={r.result} rank={i} mode={mode} />
          ))}
        </div>
      )}

      {belowThreshold.length > 0 && hasDone && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 8, color: "#f59e0b", fontFamily: MONO, letterSpacing: "0.08em", marginBottom: 6 }}>
            ⚠ BELOW R:R 1.3 THRESHOLD — {belowThreshold.length} setup{belowThreshold.length !== 1 ? "s" : ""} (shown for transparency)
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, opacity: 0.85 }}>
            {belowThreshold.map((r, i) => (
              <SignalCard key={r.ticker} ticker={r.ticker} result={r.result} rank={qualifying.length + i} mode={mode} />
            ))}
          </div>
        </div>
      )}

      {suppressed.length > 0 && hasDone && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: MONO, letterSpacing: "0.08em", marginBottom: 6 }}>SUPPRESSED</div>
          {suppressed.map(r => <SuppressedSignal key={r.ticker} ticker={r.ticker} result={r.result} />)}
        </div>
      )}

      {hasDone && qualifying.length === 0 && belowThreshold.length === 0 && suppressed.length === 0 && (
        <div style={{ textAlign: "center", padding: "32px 16px", background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 10 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⛔</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#ef4444", fontFamily: MONO }}>NO SETUPS FOUND</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: SANS, marginTop: 6 }}>Conditions prevented signal generation. Try different assets or timeframe.</div>
        </div>
      )}

      {errors.length > 0 && hasDone && (
        <div style={{ marginTop: 10 }}>
          {errors.map(e => (
            <div key={e.ticker} style={{ fontSize: 9, color: "#ef4444", fontFamily: MONO, padding: "4px 0" }}>⚠ {e.ticker}: {e.error}</div>
          ))}
        </div>
      )}
    </div>
  );
}
```

#### `client/src/components/QuantStatusCard.jsx`
```jsx
import { useQuery } from "@tanstack/react-query";

export default function QuantStatusCard() {
  const { data: health } = useQuery({
    queryKey: ["/api/quant/health"],
    refetchInterval: 15000,
  });
  const { data: recent = [] } = useQuery({
    queryKey: ["/api/quant/recent"],
    refetchInterval: 30000,
  });
  const { data: stats } = useQuery({
    queryKey: ["/api/quant/stats"],
    refetchInterval: 30000,
  });
  const { data: readiness } = useQuery({
    queryKey: ["/api/quant/readiness"],
    refetchInterval: 60000,
  });

  const ok = health?.ok && health?.ws_alive;
  const coinCount = health?.coins?.length || 0;
  const lastUpd = health?.last_update_ts ? new Date(health.last_update_ts).toLocaleTimeString() : "—";

  // Counters from /api/quant/stats (24h window from ai_signal_log)
  const passed = stats?.passed ?? 0;
  const blocked = (stats?.blocked_scorer ?? 0) + (stats?.blocked_cost ?? 0);
  const vetoed = stats?.vetoed ?? 0;

  const ready = readiness?.recommendation === "READY";
  const readinessLabel = readiness?.recommendation || "—";
  const coverage = readiness?.coverage_pct ?? 0;
  const closed30 = readiness?.closed_signals_30d ?? 0;

  return (
    <div
      data-testid="card-quant-status"
      className="rounded-2xl border border-amber-500/30 bg-slate-900/60 p-4 text-slate-100 shadow-lg"
      style={{ fontFamily: "'IBM Plex Mono', monospace" }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-amber-400 text-sm tracking-wider">QUANT ENGINE</h3>
        <span
          data-testid="status-quant-health"
          className={`px-2 py-0.5 rounded text-xs ${ok ? "bg-emerald-600/30 text-emerald-300" : "bg-rose-600/30 text-rose-300"}`}
        >
          {ok ? "ONLINE" : "OFFLINE"}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <div className="bg-emerald-500/10 rounded px-2 py-1">
          <div className="text-emerald-400 text-lg font-bold" data-testid="text-quant-passed">{passed}</div>
          <div className="text-[9px] text-slate-400 tracking-widest">PASSED</div>
        </div>
        <div className="bg-slate-500/10 rounded px-2 py-1">
          <div className="text-slate-300 text-lg font-bold" data-testid="text-quant-blocked">{blocked}</div>
          <div className="text-[9px] text-slate-400 tracking-widest">BLOCKED</div>
        </div>
        <div className="bg-rose-500/10 rounded px-2 py-1">
          <div className="text-rose-400 text-lg font-bold" data-testid="text-quant-vetoed">{vetoed}</div>
          <div className="text-[9px] text-slate-400 tracking-widest">VETOED</div>
        </div>
      </div>
      <div className="text-xs space-y-1 text-slate-300">
        <div>Streaming: <span data-testid="text-quant-coins" className="text-slate-100">{coinCount} coins</span></div>
        <div>Last tick: <span data-testid="text-quant-lastupd" className="text-slate-100">{lastUpd}</span></div>
        <div className="flex items-center justify-between pt-1">
          <span>Soak readiness:</span>
          <span
            data-testid="badge-quant-readiness"
            className={`px-2 py-0.5 rounded text-[10px] tracking-wider ${ready ? "bg-emerald-600/30 text-emerald-300" : "bg-amber-600/30 text-amber-300"}`}
            title={`Bar coverage ${coverage}% · Closed 30d signals ${closed30}`}
          >
            {readinessLabel}
          </span>
        </div>
        <div className="text-[10px] text-slate-500">
          Bars {coverage}% · Closed-signals(30d) {closed30}
        </div>
      </div>
      {recent.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-700/60 text-xs space-y-1">
          {recent.slice(0, 5).map((r) => (
            <div key={r.id} data-testid={`row-quant-score-${r.id}`} className="flex justify-between">
              <span className="text-slate-400">{r.symbol}</span>
              <span className={r.passes ? "text-emerald-400" : "text-slate-500"}>
                {r.side?.toUpperCase()} z={Number(r.composite_z ?? r.compositeZ ?? 0).toFixed(2)} · {r.regime}
                {r.passes ? " ✓" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

#### `client/src/components/ai/ScanSummary.jsx`
```jsx
const MONO = "'IBM Plex Mono', monospace";

export default function ScanSummary({ scanned, found, suppressed, errors, regime }) {
  const crashProb = Math.round((100 - (regime?.score || 50)) * 0.8);
  const crashColor = crashProb > 60 ? "#ff4444" : crashProb > 30 ? "#ff8c00" : "#22c55e";

  return (
    <div data-testid="scan-summary" style={{ background: "rgba(201,168,76,0.04)", border: "1px solid rgba(201,168,76,0.15)", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[
          { label: "SCANNED", value: scanned, color: "#e0e0e0" },
          { label: "SIGNALS", value: found, color: found > 0 ? "#22c55e" : "#ef4444" },
          { label: "REGIME", value: `${regime?.label || "NEUTRAL"} ${regime?.score || 50}/100`, color: regime?.label === "RISK_ON" ? "#22c55e" : regime?.label === "RISK_OFF" ? "#ef4444" : "#f59e0b" },
          { label: "CRASH PROB", value: `${crashProb}%`, color: crashColor },
        ].map(s => (
          <div key={s.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, padding: "6px 12px", flex: 1, minWidth: 80 }}>
            <div style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontFamily: MONO, letterSpacing: "0.08em", marginBottom: 3 }}>{s.label}</div>
            <div style={{ fontSize: 11, fontWeight: 800, color: s.color, fontFamily: MONO }}>{s.value}</div>
          </div>
        ))}
      </div>
      {suppressed > 0 && (
        <div style={{ fontSize: 8, color: "#ff8c00", fontFamily: MONO, marginTop: 8 }}>
          🛑 {suppressed} signal{suppressed > 1 ? "s" : ""} suppressed by risk rules
        </div>
      )}
      {errors > 0 && (
        <div style={{ fontSize: 8, color: "#ef4444", fontFamily: MONO, marginTop: 4 }}>
          ⚠ {errors} asset{errors > 1 ? "s" : ""} failed to analyze
        </div>
      )}
    </div>
  );
}
```

---

## 3. Kronos

**Endpoint:** `POST /api/kronos` · **Client:** `KronosPanel.jsx`

#### Backend: POST /api/kronos — `server/routes.ts` (lines 9145–10144)
```ts
  app.post("/api/kronos", async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Anthropic API key not configured" });

    // Tier check — Elite only
    const userId = (req.session as any)?.userId;
    if (userId) {
      try {
        const dbUser = await storage.getUser(userId);
        if (dbUser) {
          const tier = await getEffectiveTier(dbUser);
          if (tier !== "elite") return res.status(403).json({ error: "Kronos Forecast Engine requires Elite tier." });
        }
      } catch { /* allow through if check fails */ }
    }

    try {
      const { ticker = "BTC", timeframe = "4h" } = req.body;
      if (!ticker) return res.status(400).json({ error: "Missing ticker" });

      const cls: string = ["NVDA","TSLA","AAPL","MSFT","META","MSTR","COIN","PLTR","AMZN","GOOGL","AMD"].includes(ticker)
        ? "equity"
        : ["XAU","CL","SILVER","NATGAS","COPPER","BRENTOIL"].includes(ticker)
        ? "commodity"
        : "crypto";

      const candles = await fetchQuantCandles(ticker, cls, timeframe, 48);
      if (!candles || candles.length < 20) {
        return res.status(502).json({ error: "Insufficient candle data for Kronos forecast" });
      }

      const normalize = (c: any) => ({
        o: parseFloat((c.open ?? c.o ?? 0).toFixed(6)),
        h: parseFloat((c.high ?? c.h ?? 0).toFixed(6)),
        l: parseFloat((c.low  ?? c.l ?? 0).toFixed(6)),
        c: parseFloat((c.close ?? c.c ?? 0).toFixed(6)),
        v: Math.round(c.volume ?? c.v ?? 0),
      });

      const recent = candles.slice(-24).map(normalize).filter((c: any) => c.c > 0);
      if (recent.length < 10) return res.status(502).json({ error: "Not enough valid candles" });

      const currentPrice = recent[recent.length - 1].c;
      const closes = recent.map((c: any) => c.c);
      const highs = recent.map((c: any) => c.h);
      const lows = recent.map((c: any) => c.l);
      const logReturns = closes.slice(1).map((c: number, i: number) => Math.log(c / closes[i]));
      const meanR = logReturns.reduce((a: number, b: number) => a + b, 0) / logReturns.length;
      const variance = logReturns.reduce((a: number, b: number) => a + Math.pow(b - meanR, 2), 0) / logReturns.length;
      const histVolAnnualized = Math.sqrt(variance * 252) * 100;
      const nextCandleRangePct = Math.sqrt(variance) * 100 * 2;

      // ── RSI(14) ──
      const rsiPeriod = Math.min(14, closes.length - 1);
      let gains = 0, losses = 0;
      for (let i = closes.length - rsiPeriod; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
      }
      const avgGain = gains / rsiPeriod;
      const avgLoss = losses / rsiPeriod;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
      const rsiZone = rsi >= 70 ? "OVERBOUGHT" : rsi <= 30 ? "OVERSOLD" : rsi >= 55 ? "BULLISH" : rsi <= 45 ? "BEARISH" : "NEUTRAL";

      // ── ATR(14) for SL/TP sizing ──
      const atrPeriod = Math.min(14, recent.length - 1);
      let atrSum = 0;
      for (let i = recent.length - atrPeriod; i < recent.length; i++) {
        const tr = Math.max(
          highs[i] - lows[i],
          Math.abs(highs[i] - closes[i - 1]),
          Math.abs(lows[i] - closes[i - 1]),
        );
        atrSum += tr;
      }
      const atr = atrSum / atrPeriod;
      const atrPct = (atr / currentPrice) * 100;

      // ── Leverage suggestion based on asset class + volatility ──
      const suggestedLeverage = (() => {
        if (cls === "equity") return "1x (no leverage — equities)";
        if (cls === "commodity") return histVolAnnualized > 60 ? "2x" : "3x";
        // crypto
        if (histVolAnnualized > 100) return "2x (extreme vol)";
        if (histVolAnnualized > 70) return "3x";
        if (histVolAnnualized > 40) return "5x";
        return "5-10x (vol is low — still respect stops)";
      })();

      const ohlcvStr = recent
        .map((c: any, i: number) => `T${i < recent.length - 1 ? `-${recent.length - 1 - i}` : "+0"}: O=${c.o} H=${c.h} L=${c.l} C=${c.c} V=${c.v}`)
        .join("\n");

      // ── Inject adaptive-learning performance context (last 30d win rates, losing combos) ──
      const kronosPerfCtx = await buildPerformanceContext().catch(() => "");

      // ── Statistical Brain (advisory only — Kronos is forecast, not signal-gen) ──
      // Surface empirical edge for both directions so the forecast can lean
      // toward / away from sides that historically win or fail. NO veto here:
      // Kronos must always emit a forecast (the trade_plan can still be NO_TRADE).
      let kronosBrainCtx = "";
      try {
        const _brainMod = await import("./lib/statisticalBrain");
        const [bL, bS] = await Promise.all([
          _brainMod.getBrainFor(ticker, "LONG"),
          _brainMod.getBrainFor(ticker, "SHORT"),
        ]);
        const parts: string[] = [];
        if (bL?.hasData) parts.push(bL.promptText);
        if (bS?.hasData) parts.push(bS.promptText);
        if (parts.length) {
          kronosBrainCtx =
            `══════════════ STATISTICAL EDGE BRAIN (advisory) ══════════════\n` +
            `Empirical edge for ${ticker} from resolved-trade history. ADVISORY only — Kronos is\n` +
            `a forecast engine, not a signal gate. Use these stats to bias ensemble_signal\n` +
            `confidence and to inform the trade_plan side: SUPPRESS direction → strongly\n` +
            `prefer NO_TRADE or the opposite side. PREFERRED direction → up-weight that side.\n\n` +
            `${parts.join("\n\n")}\n` +
            `═══════════════════════════════════════════════════════════════\n`;
        }
      } catch (e: any) {
        console.warn(`[kronos] brain context failed for ${ticker}:`, e?.message || e);
      }

      const system = `${kronosPerfCtx ? kronosPerfCtx + "\n\n" : ""}${kronosBrainCtx ? kronosBrainCtx + "\n\n" : ""}You are the Kronos Forecast Engine — a probabilistic K-line sequence model inspired by the Kronos foundation model (AAAI 2026, arXiv:2508.02739). You analyze OHLCV sequences using autoregressive pattern recognition to generate multi-trajectory price forecasts.

Your methodology:
1. Analyze the K-line sequence for momentum, mean-reversion pressure, volatility regime, and structural pivot levels
2. Generate 3 distinct forward trajectories (BULL / BASE / BEAR) representing 5 future candles
3. Assign probabilities to each trajectory (must sum to 100)
4. Derive an ensemble signal by weighting trajectory directions and probabilities
5. Estimate forward volatility regime

Output ONLY valid JSON. No markdown, no backticks, no text outside the JSON object.

{
  "asset": "string",
  "timeframe": "string",
  "current_price": number,
  "ensemble_signal": "STRONG_LONG"|"LONG"|"NEUTRAL"|"SHORT"|"STRONG_SHORT",
  "ensemble_confidence": 0-100,
  "volatility_forecast": {
    "regime": "LOW"|"MODERATE"|"HIGH"|"EXTREME",
    "annualized_pct": number,
    "next_candle_range_pct": number,
    "note": "string"
  },
  "trajectories": {
    "bull": { "probability": 0-100, "prices": [number,number,number,number,number], "final_pct_change": number, "catalyst": "string", "label": "string" },
    "base": { "probability": 0-100, "prices": [number,number,number,number,number], "final_pct_change": number, "catalyst": "string", "label": "string" },
    "bear": { "probability": 0-100, "prices": [number,number,number,number,number], "final_pct_change": number, "catalyst": "string", "label": "string" }
  },
  "key_levels": { "resistance": number, "support": number },
  "sequence_pattern": "string",
  "trade_plan": {
    "direction": "LONG"|"SHORT"|"NO_TRADE",
    "entry": number,
    "entry_logic": "string — MUST reference the RSI value and zone provided (e.g. 'RSI 28 oversold — enter on reclaim of T+0 close')",
    "tp1": number,
    "tp1_pct": number,
    "tp2": number,
    "tp2_pct": number,
    "sl": number,
    "sl_pct": number,
    "rr_tp1": "string (e.g. '1.8:1')",
    "rr_tp2": "string (e.g. '3.2:1')",
    "leverage": "string (use the suggested leverage unless you have strong reason to deviate — if you deviate, explain why)",
    "invalidation": "string — what price action invalidates this setup",
    "notes": "string — risk caveats, kill clock, post-TP1 management"
  },
  "model_note": "string"
}

Rules:
- Trajectory probabilities must sum to exactly 100. prices arrays must have exactly 5 values. final_pct_change is relative to current_price.
- trade_plan MUST be internally consistent with ensemble_signal: LONG plans for LONG/STRONG_LONG, SHORT plans for SHORT/STRONG_SHORT, NO_TRADE for NEUTRAL or when R:R < 1.5:1.
- Derive entry using RSI: oversold (<30) → enter LONG on reclaim of recent pivot; overbought (>70) → enter SHORT on rejection; in-range → enter on pullback to key level.
- SL must be placed beyond the nearest invalidation level (support for LONG, resistance for SHORT), typically 1.0–1.5x ATR away.
- TP1 at 1.5–2x ATR (R:R ≥ 1.5:1). TP2 at 2.5–4x ATR.
- Use the suggested_leverage provided unless you have strong reason to deviate.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KRONOS OVERLAY: Only fire when ALL conditions met: edge>72%, vol NORMAL or HIGH, macro clear for full kill clock, OI confirms direction, 3+ factors score >70, R:R to TP1 >= 1.5:1. If any fail, output: "Kronos: No qualifying setup. Failed: [list]". Tag qualifying signals with "⚡ KRONOS — HIGH CONVICTION". If rolling win rate drops below 60% over 20 signals, self-mute 24H.`;

      const userMsg = `Asset: ${ticker} | Market: ${cls.toUpperCase()} | Timeframe: ${timeframe}
Current Price: $${currentPrice}
Historical Volatility: ${histVolAnnualized.toFixed(1)}% annualized | Est. next-candle range: ±${nextCandleRangePct.toFixed(2)}%

━━━ INDICATORS (server-computed — use exactly these values in trade_plan) ━━━
RSI(14): ${rsi.toFixed(1)} — ZONE: ${rsiZone}
ATR(14): ${atr.toFixed(6)} (${atrPct.toFixed(2)}% of price)
Suggested leverage: ${suggestedLeverage}

OHLCV K-LINE SEQUENCE — ${recent.length} candles (T-${recent.length - 1} oldest → T+0 current):
${ohlcvStr}

Detect the dominant K-line pattern, generate probabilistic 5-candle forecast trajectories, AND produce a concrete trade_plan (entry based on RSI zone, TP1/TP2 sized from ATR, SL beyond nearest invalidation, using the suggested leverage). If the setup does not meet R:R ≥ 1.5:1, set trade_plan.direction = "NO_TRADE".`;

      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 1200,
          system,
          messages: [{ role: "user", content: userMsg }],
        }),
      });

      // ── Server-computed fallback forecast (used when AI fails or returns malformed data) ──
      const buildFallbackForecast = (reasonNote: string) => {
        const trend = closes[closes.length - 1] - closes[0];
        const trendPct = (trend / closes[0]) * 100;
        const volBias = histVolAnnualized > 80 ? "EXTREME" : histVolAnnualized > 50 ? "HIGH" : histVolAnnualized > 25 ? "MODERATE" : "LOW";
        const sig = trendPct > 3 ? "LONG" : trendPct < -3 ? "SHORT" : "NEUTRAL";
        const conf = Math.min(72, Math.max(45, Math.round(50 + Math.abs(trendPct) * 2)));
        const stepPct = nextCandleRangePct / 100;
        const mkTraj = (mult: number) => {
          const arr: number[] = [];
          for (let i = 1; i <= 5; i++) arr.push(parseFloat((currentPrice * (1 + mult * stepPct * i)).toFixed(6)));
          return arr;
        };
        const bullPrices = mkTraj(0.7);
        const basePrices = mkTraj(trendPct > 0 ? 0.15 : trendPct < 0 ? -0.15 : 0);
        const bearPrices = mkTraj(-0.7);
        const recentHigh = Math.max(...highs);
        const recentLow = Math.min(...lows);
        return {
          asset: ticker,
          timeframe,
          current_price: currentPrice,
          ensemble_signal: sig === "LONG" ? "LONG" : sig === "SHORT" ? "SHORT" : "NEUTRAL",
          ensemble_confidence: conf,
          volatility_forecast: {
            regime: volBias,
            annualized_pct: parseFloat(histVolAnnualized.toFixed(1)),
            next_candle_range_pct: parseFloat(nextCandleRangePct.toFixed(2)),
            note: "Server-computed fallback (AI engine unavailable). Based on log-return volatility.",
          },
          trajectories: {
            bull: { probability: trendPct > 0 ? 40 : 25, prices: bullPrices, final_pct_change: parseFloat((((bullPrices[4] / currentPrice) - 1) * 100).toFixed(2)), catalyst: "Continuation of recent up-move + supportive momentum", label: "Bullish breakout" },
            base: { probability: 40, prices: basePrices, final_pct_change: parseFloat((((basePrices[4] / currentPrice) - 1) * 100).toFixed(2)), catalyst: "Range-bound consolidation around current levels", label: "Sideways drift" },
            bear: { probability: trendPct < 0 ? 40 : 25, prices: bearPrices, final_pct_change: parseFloat((((bearPrices[4] / currentPrice) - 1) * 100).toFixed(2)), catalyst: "Mean-reversion or risk-off rotation", label: "Bearish reversal" },
          },
          key_levels: { resistance: parseFloat(recentHigh.toFixed(6)), support: parseFloat(recentLow.toFixed(6)) },
          sequence_pattern: trendPct > 3 ? "Higher highs / higher lows" : trendPct < -3 ? "Lower highs / lower lows" : "Range-bound chop",
          trade_plan: { direction: "NO_TRADE", entry: 0, entry_logic: "AI engine unavailable — manual review recommended.", tp1: 0, tp2: 0, sl: 0, rr_tp1: "—", rr_tp2: "—", leverage: suggestedLeverage, invalidation: "—", notes: reasonNote },
          model_note: `Fallback forecast: ${reasonNote}`,
          fallback: true,
        };
      };

      let parsed: any = null;

      if (!aiRes.ok) {
        const errTxt = await aiRes.text().catch(() => "");
        console.warn("[/api/kronos] AI HTTP", aiRes.status, errTxt.slice(0, 300));
        parsed = buildFallbackForecast("AI service returned an error — using server-computed forecast.");
      } else {
        const aiData: any = await aiRes.json().catch(() => null);
        if (!aiData || aiData.error) {
          console.warn("[/api/kronos] AI error:", aiData?.error?.message || "no body");
          parsed = buildFallbackForecast("AI service error — using server-computed forecast.");
        } else {
          const rawTextK = (aiData.content || []).map((b: any) => b.text || "").join("");
          if (!rawTextK.trim()) {
            console.warn("[/api/kronos] Empty AI response");
            parsed = buildFallbackForecast("AI returned empty response — using server-computed forecast.");
          } else {
            const repairJsonK = (s: string): any => {
              let t = s.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
              if (t.includes("{")) t = t.slice(t.indexOf("{"));
              if (t.lastIndexOf("}") > 0) t = t.slice(0, t.lastIndexOf("}") + 1);
              t = t.replace(/,\s*([}\]])/g, "$1");
              try { return JSON.parse(t); } catch { return null; }
            };
            parsed = repairJsonK(rawTextK);
            if (!parsed) {
              const jsonMatch = rawTextK.match(/\{[\s\S]*\}/);
              if (jsonMatch) parsed = repairJsonK(jsonMatch[0]);
            }
            if (!parsed) {
              console.warn("[/api/kronos parse]", rawTextK.slice(0, 300));
              parsed = buildFallbackForecast("AI returned malformed data — using server-computed forecast.");
            }
          }
        }
      }

      if (!parsed.volatility_forecast?.annualized_pct) {
        parsed.volatility_forecast = {
          regime: histVolAnnualized > 80 ? "EXTREME" : histVolAnnualized > 50 ? "HIGH" : histVolAnnualized > 25 ? "MODERATE" : "LOW",
          annualized_pct: parseFloat(histVolAnnualized.toFixed(1)),
          next_candle_range_pct: parseFloat(nextCandleRangePct.toFixed(2)),
          note: "Server-computed from log returns",
        };
      }

      parsed.generated_at = new Date().toISOString();

      // ── Attach server-computed indicators (always trustworthy; never AI-hallucinated) ──
      parsed.indicators = {
        rsi: parseFloat(rsi.toFixed(1)),
        rsi_zone: rsiZone,
        atr: parseFloat(atr.toFixed(6)),
        atr_pct: parseFloat(atrPct.toFixed(2)),
        suggested_leverage: suggestedLeverage,
      };

      // ── Sanity-check trade_plan — force NO_TRADE if clearly inconsistent ──
      if (parsed.trade_plan && parsed.trade_plan.direction !== "NO_TRADE") {
        const tp = parsed.trade_plan;
        const e = parseFloat(tp.entry);
        const sl = parseFloat(tp.sl);
        const t1 = parseFloat(tp.tp1);
        if (Number.isFinite(e) && Number.isFinite(sl) && Number.isFinite(t1)) {
          const risk = Math.abs(e - sl);
          const reward = Math.abs(t1 - e);
          const rr = risk > 0 ? reward / risk : 0;
          if (rr < 1.2) {
            parsed.trade_plan.direction = "NO_TRADE";
            parsed.trade_plan.notes = `Auto-flagged NO_TRADE: R:R to TP1 = ${rr.toFixed(2)}:1 (below 1.2:1 minimum). ${parsed.trade_plan.notes || ""}`;
          }
        }
      }

      // ── Kronos flip push notification ────────────────────────────────────────
      try {
        const cacheKey = `${ticker}:${timeframe}`;
        const prior = kronosFlipCache.get(cacheKey);
        const newSignal: string = parsed.ensemble_signal;
        const newConf: number = parsed.ensemble_confidence ?? 0;
        if (prior && prior.ensemble_signal !== newSignal && newConf >= 65) {
          broadcastKronosFlipPush(ticker, timeframe, prior.ensemble_signal, newSignal, newConf).catch(() => {});
        }
        kronosFlipCache.set(cacheKey, { ensemble_signal: newSignal, ensemble_confidence: newConf });
      } catch { /* non-fatal */ }
      // ─────────────────────────────────────────────────────────────────────────

      // ── Kronos trade_plan hardener ────────────────────────────────────────
      // Same gates as Trade Ideas: ATR-floored stop, chase/crowded flags, Wilson
      // CI on backtest WR, regime leverage cap, conviction veto. Only runs when
      // trade_plan.direction is LONG/SHORT (NO_TRADE passes through). Wrapped in
      // try/catch — any hardener failure leaves trade_plan untouched.
      try {
        const tp = parsed.trade_plan;
        if (tp && (tp.direction === "LONG" || tp.direction === "SHORT")) {
          const e = parseFloat(tp.entry), sl = parseFloat(tp.sl);
          const t1 = parseFloat(tp.tp1), t2 = parseFloat(tp.tp2);
          if ([e, sl, t1].every(Number.isFinite)) {
            const { hardenSignal, getOiChangePct } = await import("./lib/signalHardening");
            const { getBrainFor, applyEdgePolicy, mirrorPrice } = await import("./lib/statisticalBrain");
            const { convictionTailSuppressEnabled, tokenSoftGateEnabled, empiricalLeverageCapEnabled } =
              await import("./lib/featureFlags");
            const { isConvictionTailToxic, applyTokenSoftGate, empiricalLeverageCeiling } =
              await import("./lib/empiricalFilters");
            const symbolK = String(parsed.asset || ticker).split("/")[0].toUpperCase();
            const llmDirK: "LONG" | "SHORT" = tp.direction;
            const bus = getDataBusStatus();
            const busLabel = (bus?.regime?.label || "NEUTRAL").toUpperCase();
            const regimeK: "MACRO_CLEAR" | "RISK_ON" | "RISK_OFF" | "MACRO_EVENT" =
              busLabel === "RISK_ON" ? "RISK_ON" :
              busLabel === "RISK_OFF" ? "RISK_OFF" :
              "MACRO_CLEAR"; // NEUTRAL → MACRO_CLEAR (MACRO_EVENT not yet wired in dataBus — mirrors hardenTradeIdeas regime mapping)

            // Edge policy: SUPPRESS losers, INVERT contra-indicators, recalibrate conviction
            const rawConfPct = Number(parsed.ensemble_confidence) || 50;
            const edgeK = await applyEdgePolicy(symbolK, llmDirK, rawConfPct);
            if (edgeK.action === "SUPPRESS") {
              parsed.trade_plan = {
                ...tp,
                direction: "NO_TRADE",
                notes: `Edge-policy SUPPRESS: ${edgeK.reason}. ${tp.notes || ""}`,
              };
              parsed.edgePolicy = { action: "SUPPRESS", brainVerdict: edgeK.brainVerdict, reason: edgeK.reason };
              console.log(`[kronos edge-policy] ${symbolK} ${llmDirK} SUPPRESSED: ${edgeK.reason}`);
            } else if (isConvictionTailToxic(parsed.ensemble_confidence, edgeK.brainVerdict, convictionTailSuppressEnabled())) {
              // Empirical conviction-tail suppression (June 2026): RAW conviction
              // >=50 INVERTS (PF 0.13-0.40). Drop the toxic tail (PREFERRED exempt).
              parsed.trade_plan = {
                ...tp,
                direction: "NO_TRADE",
                notes: `Empirical conviction-tail suppress: raw ${rawConfPct} >= 50 (inverted band). ${tp.notes || ""}`,
              };
              parsed.edgePolicy = { action: "SUPPRESS", brainVerdict: edgeK.brainVerdict, reason: `raw conviction ${rawConfPct} in toxic >=50 tail` };
              console.log(`[kronos empirical-filter] ${symbolK} ${llmDirK} SUPPRESSED: raw conviction ${rawConfPct} >= 50 (inverted tail)`);
            } else {
              const dirK = edgeK.recommendedDirection;
              let slK = sl, t1K = t1, t2K = t2;
              if (edgeK.action === "INVERT") {
                slK = mirrorPrice(e, sl);
                t1K = mirrorPrice(e, t1);
                if (Number.isFinite(t2)) t2K = mirrorPrice(e, t2);
                console.log(`[kronos edge-policy] ${symbolK} ${llmDirK}→${dirK} INVERTED: ${edgeK.reason}`);
              }
              const brainK = await getBrainFor(symbolK, dirK).catch(() => null as any);
              const statK = brainK?.stat;
              const targets = Number.isFinite(t2K) ? [t1K, t2K] : [t1K];
              const ctxK = {
                symbol: symbolK,
                direction: dirK,
                entry: e,
                proposedStop: slK,
                proposedTargets: targets,
                rawConviction: Math.max(0, Math.min(1, edgeK.recalibratedConvictionPct / 100)),
                atr1h: Number(atr) || 0,  // already computed for kronos
                pctChange24h: ((bus?.prices?.[symbolK]?.change24h ?? 0) / 100),
                funding8h: bus?.funding?.[symbolK] ?? 0,
                oiUsd: bus?.oi?.[symbolK] ?? 0,
                oiChange24hPct: ((getOiChangePct(symbolK) ?? 0) / 100),
                liquidationClusters: [],
                backtestN: statK?.sampleSize ?? 0,
                backtestWr: statK?.winRate ?? 0,
                backtestAvgR: statK?.expectedR ?? 0,
                regime: regimeK,
                edgeSource: "estimated" as const,
              };
              const hK = hardenSignal(ctxK);
              if (!hK.accept) {
                parsed.trade_plan = {
                  ...tp,
                  direction: "NO_TRADE",
                  notes: `Kronos hardener veto: ${hK.reasonsRejected.join("; ")}. ${tp.notes || ""}`,
                };
                console.log(`[kronos hardener] ${symbolK} ${dirK} VETOED: ${hK.reasonsRejected.join("; ")}`);
              } else {
                const riskNew = Math.abs(e - hK.stop);
                const rrK = (target: number) => riskNew > 0 ? `${(Math.abs(target - e) / riskNew).toFixed(1)}:1` : "—";
                const slPct = ((Math.abs(e - hK.stop) / e) * 100);
                const tp1Pct = ((Math.abs(hK.targets[0] - e) / e) * 100);
                const invertedNote = edgeK.action === "INVERT"
                  ? `EDGE-INVERTED ${llmDirK}→${dirK}: ${edgeK.reason}. `
                  : "";
                parsed.trade_plan = {
                  ...tp,
                  direction: dirK,                                  // <- reflects flip when INVERT
                  sl: parseFloat(hK.stop.toFixed(6)),
                  sl_pct: parseFloat(slPct.toFixed(2)),
                  tp1: parseFloat(hK.targets[0].toFixed(6)),
                  tp1_pct: parseFloat(tp1Pct.toFixed(2)),
                  tp2: Number.isFinite(hK.targets[1]) ? parseFloat(hK.targets[1].toFixed(6)) : tp.tp2,
                  rr_tp1: rrK(hK.targets[0]),
                  rr_tp2: Number.isFinite(hK.targets[1]) ? rrK(hK.targets[1]) : tp.rr_tp2,
                  leverage: `${Math.min(parseFloat(String(tp.leverage || "1").replace(/[^\d.]/g, "")) || 1, hK.leverageCap, empiricalLeverageCeiling(empiricalLeverageCapEnabled())).toFixed(0)}x (capped by ${regimeK})`,
                  notes: `${invertedNote}${hK.notes.length ? hK.notes.join("; ") + ". " : ""}${tp.notes || ""}`.trim(),
                };
                parsed.edgePolicy = {
                  action: edgeK.action,
                  originalDirection: edgeK.originalDirection,
                  recommendedDirection: edgeK.recommendedDirection,
                  brainVerdict: edgeK.brainVerdict,
                  rawConvictionPct: edgeK.rawConvictionPct,
                  recalibratedConvictionPct: edgeK.recalibratedConvictionPct,
                  reason: edgeK.reason,
                };
              parsed.ensemble_confidence = Math.round(hK.finalConviction * 100);
              // ── Empirical token soft-gate (June 2026) — off-list crypto keeps
              // publishing but its displayed conviction is capped (nothing hidden).
              const softGateK = applyTokenSoftGate(symbolK, true, parsed.ensemble_confidence, tokenSoftGateEnabled());
              if (softGateK.offList) {
                parsed.ensemble_confidence = softGateK.conviction;
                (parsed as any).offList = true;
              }
              // ── Module 2 (Setup Taxonomy) — classify the FINAL (post-edge,
              // post-hardener) Kronos plan. Like /api/ai/analyze, /api/kronos
              // does NOT auto-flip; it surfaces `recommendedFlip` for the UI.
              // Crypto-only today (Kronos universe is HL perps + select majors);
              // helper handles class-awareness if equities are added later.
              try {
                const { classifyArchetype, buildArchetypeContext, shouldFlipForMeanReversion, ARCHETYPE_LOOKBACK_1H } =
                  await import("./lib/archetype");
                const { getMicrostructureSnapshot, buildClassificationDiagnostics } =
                  await import("./lib/microstructureSnapshot");
                let archBarsK: any[] = [];
                try {
                  const fetchedK = await fetchQuantCandles(symbolK, "crypto", "1h", ARCHETYPE_LOOKBACK_1H);
                  archBarsK = Array.isArray(fetchedK) ? fetchedK : [];
                } catch { archBarsK = []; }
                if (Array.isArray(archBarsK) && archBarsK.length >= 24) {
                  const microK = getMicrostructureSnapshot(symbolK, "crypto");
                  const archCtxK = buildArchetypeContext({
                    token: symbolK,
                    direction: dirK,
                    price: e,
                    candles1h: archBarsK.map((c: any) => ({
                      open: Number(c.open ?? c.o), high: Number(c.high ?? c.h),
                      low: Number(c.low ?? c.l), close: Number(c.close ?? c.c),
                      volume: Number(c.volume ?? c.v ?? 0),
                      timestamp: Number(c.timestamp ?? c.t ?? c.time ?? 0),
                    })),
                    fundingRate: microK.fundingStatus === "ok" ? (microK.funding ?? undefined) : undefined,
                    oiChange6hPct: getOiChangePct(symbolK),
                  });
                  const archResK = classifyArchetype(archCtxK);
                  (parsed as any).archetype = archResK.archetype;
                  (parsed as any).archetype_confidence = +archResK.confidence.toFixed(2);
                  (parsed as any).archetype_reason = archResK.reason;
                  (parsed as any).archetype_diagnostics = buildClassificationDiagnostics({
                    ctx: archCtxK as unknown as Record<string, unknown>,
                    micro: microK,
                    clausesFired: archResK.archetype !== "UNCLASSIFIED" ? [archResK.archetype.toLowerCase()] : [],
                    sourceEndpoint: "kronos",
                  });
                  const flipToK = shouldFlipForMeanReversion(archResK.archetype, archCtxK.dayOpen, archCtxK.price);
                  (parsed as any).recommendedFlip = !!(flipToK && flipToK !== dirK);
                  // Module 2 T05 — UNCLASSIFIED shadow log. Hot mode marks the
                  // Kronos response as suppressed (UI will hide the trade plan).
                  if (archResK.archetype === "UNCLASSIFIED") {
                    try {
                      const { archetypeSuppressionEnabled } = await import("./lib/featureFlags");
                      const { logSuppressedSignal } = await import("./lib/suppressedSignalsLog");
                      const hot = archetypeSuppressionEnabled();
                      logSuppressedSignal({
                        ticker: symbolK, intendedDirection: dirK, assetClass: "crypto",
                        sourceEndpoint: "kronos",
                        reason: hot ? "suppressed_no_archetype" : "would_suppress_no_archetype",
                        rawSignalPayload: { entry: e, conviction: hK.finalConviction },
                        classificationDiagnostics: (parsed as any).archetype_diagnostics ?? null,
                      }).catch(() => {});
                      if (hot) {
                        (parsed as any).suppressed = true;
                        (parsed as any).suppression_message = "No matching setup archetype detected — Kronos plan withheld.";
                      }
                    } catch { /* shadow log is best-effort */ }
                  }
                  if (archResK.archetype && archResK.archetype !== "UNCLASSIFIED") {
                    try {
                      const { getArchetypeStats } = await import("./lib/statisticalBrain");
                      const sK = await getArchetypeStats(symbolK, dirK, archResK.archetype as any);
                      if (sK && sK.n > 0) {
                        (parsed as any).archetype_stats = {
                          n: sK.n, wins: sK.wins, losses: sK.losses,
                          wr_point: +sK.wrPointEst.toFixed(4),
                          wr_wilson_lb: +sK.wrWilsonLB.toFixed(4),
                          wr_wilson_lb_80: +sK.wrWilsonLB80.toFixed(4),
                          median_r: +sK.medianR.toFixed(2),
                          p75_hold_min: Math.round(sK.p75HoldMinutes),
                          median_time_to_tp_min: Math.round(sK.medianTimeToTpMin),
                          median_time_to_sl_min: Math.round(sK.medianTimeToSlMin),
                          low_sample: sK.lowSample,
                        };
                      }
                    } catch { /* fail-open */ }
                  }
                }
              } catch (archErrK: any) {
                console.warn(`[kronos ARCHETYPE] ${symbolK} fail-open:`, archErrK?.message || archErrK);
              }

              // ── HardTrendFilter (May 2026, shadow by default) — Kronos ──────
              let kronosTrendFilter: any = undefined;
              try {
                const { evaluateHardTrendFilter, fetchBinanceTrendCandles } = await import("./lib/hardTrendFilter");
                const { hardTrendFilterEnabled } = await import("./lib/featureFlags");
                const { dailyCandles, hourlyCandles } = await fetchBinanceTrendCandles(symbolK);
                const archetypeK = (parsed as any).archetype ?? null;
                const tf = evaluateHardTrendFilter({
                  direction: dirK,
                  archetype: archetypeK,
                  currentPrice: e,
                  dailyCandles,
                  hourlyCandles,
                });
                kronosTrendFilter = {
                  decision: tf.decision, reason: tf.reason, trend: tf.trend,
                  intradayTrend: tf.intradayTrend, strong: tf.strong, enforced: false,
                };
                if (tf.decision === "SUPPRESS") {
                  const hot = hardTrendFilterEnabled();
                  try {
                    const { logSuppressedSignal } = await import("./lib/suppressedSignalsLog");
                    logSuppressedSignal({
                      ticker: symbolK, intendedDirection: dirK, assetClass: "crypto",
                      sourceEndpoint: "kronos",
                      reason: hot
                        ? "suppressed_counter_trend_no_mean_rev_archetype"
                        : "would_suppress_counter_trend_no_mean_rev_archetype",
                      rawSignalPayload: { entry: e, conviction: hK.finalConviction, archetype: archetypeK },
                      classificationDiagnostics: tf.diagnostics as any,
                    }).catch(() => {});
                  } catch { /* best-effort */ }
                  if (hot) {
                    kronosTrendFilter.enforced = true;
                    (parsed as any).suppressed = true;
                    (parsed as any).suppression_message = "Counter-trend signal without mean-reversion archetype — Kronos plan withheld.";
                    parsed.trade_plan = {
                      ...parsed.trade_plan,
                      direction: "NO_TRADE",
                      notes: `HardTrendFilter veto: counter-trend (${tf.trend}) without MEAN_REVERSION_EXHAUSTION. ${parsed.trade_plan?.notes || ""}`,
                    };
                  }
                }
                (parsed as any).trend_filter = kronosTrendFilter;
              } catch (tfErrK: any) {
                console.warn(`[kronos HARD-TREND] ${symbolK} fail-open:`, tfErrK?.message || tfErrK);
              }

              // ── ConvictionCap (May 2026, default ON) — Kronos ───────────────
              try {
                const { convictionCapEnabled } = await import("./lib/featureFlags");
                if (convictionCapEnabled() && !(parsed as any).suppressed) {
                  const { applyConvictionCap, recordHighConvictionReview } = await import("./lib/convictionCap");
                  const rawPct = Number(parsed.ensemble_confidence) || Math.round(hK.finalConviction * 100);
                  const capResult = applyConvictionCap(rawPct);
                  if (capResult.capped) {
                    (parsed as any).displayedConviction = capResult.displayedConviction;
                    (parsed as any).highConvictionReview = true;
                    recordHighConvictionReview({
                      rawConviction: capResult.rawConviction,
                      sourceEndpoint: "kronos",
                      token: symbolK,
                      direction: dirK,
                      archetype: (parsed as any).archetype ?? null,
                      signalId: null,
                      aiSignalLogId: null,
                      featureSnapshot: {
                        archetype: (parsed as any).archetype ?? null,
                        archetype_confidence: (parsed as any).archetype_confidence ?? null,
                        trend_filter: kronosTrendFilter ?? null,
                        atr1h: Number(atr) || 0,
                        pctChange24h: ((bus?.prices?.[symbolK]?.change24h ?? 0) / 100),
                        funding8h: bus?.funding?.[symbolK] ?? 0,
                        oiUsd: bus?.oi?.[symbolK] ?? 0,
                        oiChange24hPct: ((getOiChangePct(symbolK) ?? 0) / 100),
                        regime: regimeK,
                        backtestN: statK?.sampleSize ?? 0,
                        backtestWr: statK?.winRate ?? 0,
                        backtestAvgR: statK?.expectedR ?? 0,
                        edge_action: edgeK.action,
                        edge_recalibrated_pct: edgeK.recalibratedConvictionPct,
                        hardener_size_multiplier: hK.sizeMultiplier,
                        hardener_wr_ci: [hK.wrCiLow, hK.wrCiHigh],
                        chase_flag: !!hK.chaseFlag, crowding_flag: !!hK.crowdingFlag,
                        low_sample_flag: !!hK.lowSampleFlag,
                        archetype_wr_lb_80: (parsed as any).archetype_stats?.wr_wilson_lb_80 ?? null,
                        archetype_median_r: (parsed as any).archetype_stats?.median_r ?? null,
                        archetype_n: (parsed as any).archetype_stats?.n ?? null,
                        recommendedFlip: !!(parsed as any).recommendedFlip,
                      },
                    }, capResult).catch(() => {});
                  }
                }
              } catch (capErrK: any) {
                console.warn(`[kronos CONV-CAP] ${symbolK} fail-open:`, capErrK?.message || capErrK);
              }

              parsed.hardener = {
                applied: true,
                sizeMultiplier: parseFloat(hK.sizeMultiplier.toFixed(3)),
                wrCi: [Math.round(hK.wrCiLow * 100), Math.round(hK.wrCiHigh * 100)],
                flags: [
                  ...(hK.chaseFlag ? ["chase"] : []),
                  ...(hK.crowdingFlag ? ["crowded"] : []),
                  ...(hK.lowSampleFlag ? ["low-sample"] : []),
                  ...(edgeK.action === "INVERT" ? ["edge-inverted"] : []),
                  ...(softGateK.offList ? ["off-list"] : []),
                ],
                materiallyMutated: edgeK.action === "INVERT" ? true : hK.materiallyMutated,
              };
              }
            }
          }
        }
      } catch (e: any) {
        console.warn("[kronos hardener] skipped:", e?.message || e);
      }

      // ── FINAL DEFENSIVE R:R FLOOR (mirror of hardenTradeIdeas defense) ──
      // If the hardener block above threw OR was skipped (LLM produced bad
      // fields, brain lookup failed, etc), the LLM's raw trade_plan with a
      // potentially sub-1.65 R:R would ship as-is. Coerce to NO_TRADE rather
      // than let an unhardened plan reach the user.
      try {
        const tpFinal = (parsed as any)?.trade_plan;
        if (tpFinal && (tpFinal.direction === "LONG" || tpFinal.direction === "SHORT")) {
          const eF  = Number(tpFinal.entry);
          const slF = Number(tpFinal.sl);
          const t1F = Number(tpFinal.tp1);
          if (Number.isFinite(eF) && Number.isFinite(slF) && Number.isFinite(t1F) && Math.abs(eF - slF) > 0) {
            const rrF = Math.abs(t1F - eF) / Math.abs(eF - slF);
            if (rrF < 1.65) {
              console.warn(`[kronos DEFENSE] coercing ${parsed?.asset || "?"} ${tpFinal.direction} to NO_TRADE — R:R ${rrF.toFixed(2)} < 1.65 (hardener fail-open)`);
              (parsed as any).trade_plan = {
                ...tpFinal,
                direction: "NO_TRADE",
                notes: `Defensive R:R floor: ${rrF.toFixed(2)} < 1.65. ${tpFinal.notes || ""}`.trim(),
              };
            }
          } else {
            console.warn(`[kronos DEFENSE] coercing ${parsed?.asset || "?"} ${tpFinal.direction} to NO_TRADE — cannot compute R:R (e=${eF} sl=${slF} tp1=${t1F})`);
            (parsed as any).trade_plan = {
              ...tpFinal,
              direction: "NO_TRADE",
              notes: `Defensive R:R floor: malformed entry/sl/tp1. ${tpFinal.notes || ""}`.trim(),
            };
          }
        }
      } catch (defErr: any) {
        console.warn("[kronos DEFENSE] floor check error (fail-open):", defErr?.message || defErr);
      }

      res.json(parsed);

    } catch (err: any) {
      console.error("[Kronos Engine]", err);
      res.status(500).json({ error: "Internal Kronos Engine error." });
    }
  });
  // ── END KRONOS ──────────────────────────────────────────────────────────────

  // ── MACRO CALENDAR ──────────────────────────────────────
  const MACRO_2026 = [
    // FED (FOMC) 2026 — published schedule
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-01-28",time:"14:00 ET",impact:"HIGH",desc:"Federal Reserve rate decision with press conference. Held at 4.25%–4.50%.",currency:"USD",forecast:"4.25%–4.50%",previous:"4.25%–4.50%",actual:"4.25%–4.50%",unit:"%",released:true},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-03-18",time:"14:00 ET",impact:"HIGH",desc:"Federal Reserve held rates at 4.25%–4.50% with updated dot plot. Powell flagged uncertainty but no urgency to cut.",currency:"USD",forecast:"4.25%–4.50%",previous:"4.25%–4.50%",actual:"4.25%–4.50%",unit:"%",released:true},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-04-29",time:"14:00 ET",impact:"HIGH",desc:"Federal Reserve rate decision. Watch for guidance on rate path.",currency:"USD",forecast:"4.25%–4.50%",previous:"4.25%–4.50%",unit:"%"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-06-17",time:"14:00 ET",impact:"HIGH",desc:"Mid-year FOMC with economic projections update. First potential cut of 2026.",currency:"USD",forecast:"4.00%–4.25%",previous:"4.25%–4.50%",unit:"%"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-07-29",time:"14:00 ET",impact:"HIGH",desc:"July FOMC rate decision.",currency:"USD",forecast:"4.00%–4.25%",previous:"4.00%–4.25%",unit:"%"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-09-16",time:"14:00 ET",impact:"HIGH",desc:"September FOMC with updated dot plot.",currency:"USD",forecast:"3.75%–4.00%",previous:"4.00%–4.25%",unit:"%"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-11-04",time:"14:00 ET",impact:"HIGH",desc:"November FOMC rate decision.",currency:"USD",forecast:"3.75%–4.00%",previous:"3.75%–4.00%",unit:"%"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-12-16",time:"14:00 ET",impact:"HIGH",desc:"Final 2026 FOMC with year-end projections.",currency:"USD",forecast:"3.50%–3.75%",previous:"3.75%–4.00%",unit:"%"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Minutes",date:"2026-02-18",time:"14:00 ET",impact:"MED",desc:"Minutes from January FOMC meeting.",currency:"USD"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Minutes",date:"2026-04-08",time:"14:00 ET",impact:"MED",desc:"Minutes from March FOMC meeting.",currency:"USD"},
    // ECB 2026 — Deposit Facility Rate
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-01-22",time:"13:45 CET",impact:"HIGH",desc:"ECB monetary policy decision. Held at 2.75%.",currency:"EUR",forecast:"2.75%",previous:"3.00%",actual:"2.75%",unit:"%",released:true},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-03-05",time:"13:45 CET",impact:"HIGH",desc:"ECB rate decision. Watch Lagarde presser for EUR/USD direction.",currency:"EUR",forecast:"2.50%",previous:"2.75%",unit:"%"},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-04-16",time:"13:45 CET",impact:"HIGH",desc:"Spring ECB meeting with updated staff projections.",currency:"EUR",forecast:"2.25%",previous:"2.50%",unit:"%"},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-06-04",time:"13:45 CET",impact:"HIGH",desc:"ECB mid-year rate decision.",currency:"EUR",forecast:"2.00%",previous:"2.25%",unit:"%"},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-07-16",time:"13:45 CET",impact:"HIGH",desc:"July ECB monetary policy decision.",currency:"EUR",forecast:"2.00%",previous:"2.00%",unit:"%"},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-09-10",time:"13:45 CET",impact:"HIGH",desc:"September ECB with updated projections.",currency:"EUR",forecast:"1.75%",previous:"2.00%",unit:"%"},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-10-29",time:"13:45 CET",impact:"HIGH",desc:"October ECB rate decision.",currency:"EUR",forecast:"1.75%",previous:"1.75%",unit:"%"},
    {bank:"ECB",flag:"🇪🇺",name:"ECB Rate Decision",date:"2026-12-17",time:"13:45 CET",impact:"HIGH",desc:"Final 2026 ECB meeting.",currency:"EUR",forecast:"1.50%",previous:"1.75%",unit:"%"},
    // BOJ 2026 — Short-term Policy Rate
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-01-22",time:"~03:00 ET",impact:"HIGH",desc:"Bank of Japan monetary policy decision. USD/JPY highly sensitive.",currency:"JPY",forecast:"0.50%",previous:"0.50%",unit:"%"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-03-19",time:"~03:00 ET",impact:"HIGH",desc:"BOJ spring meeting. Watch for rate hike signals.",currency:"JPY",forecast:"0.75%",previous:"0.50%",unit:"%"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-04-28",time:"~03:00 ET",impact:"HIGH",desc:"BOJ with updated quarterly outlook report.",currency:"JPY",forecast:"0.75%",previous:"0.75%",unit:"%"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-06-18",time:"~03:00 ET",impact:"HIGH",desc:"June BOJ. Hawkish surprise = major JPY rally.",currency:"JPY",forecast:"1.00%",previous:"0.75%",unit:"%"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-07-16",time:"~03:00 ET",impact:"HIGH",desc:"Mid-year BOJ with outlook report update.",currency:"JPY",forecast:"1.00%",previous:"1.00%",unit:"%"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-09-17",time:"~03:00 ET",impact:"HIGH",desc:"September BOJ meeting.",currency:"JPY",forecast:"1.25%",previous:"1.00%",unit:"%"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-10-29",time:"~03:00 ET",impact:"HIGH",desc:"October BOJ with quarterly outlook.",currency:"JPY",forecast:"1.25%",previous:"1.25%",unit:"%"},
    {bank:"BOJ",flag:"🇯🇵",name:"BOJ Rate Decision",date:"2026-12-18",time:"~03:00 ET",impact:"HIGH",desc:"Final 2026 BOJ meeting.",currency:"JPY",forecast:"1.50%",previous:"1.25%",unit:"%"},
    // BOC 2026 — Overnight Rate
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-01-21",time:"09:45 ET",impact:"HIGH",desc:"Bank of Canada rate decision. Cut to 2.75%.",currency:"CAD",forecast:"2.75%",previous:"3.00%",actual:"2.75%",unit:"%",released:true},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-03-04",time:"09:45 ET",impact:"HIGH",desc:"BOC rate decision. Oil prices key for CAD outlook.",currency:"CAD",forecast:"2.50%",previous:"2.75%",unit:"%"},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-04-15",time:"09:45 ET",impact:"HIGH",desc:"Spring BOC with MPR update.",currency:"CAD",forecast:"2.25%",previous:"2.50%",unit:"%"},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-06-03",time:"09:45 ET",impact:"HIGH",desc:"June BOC rate decision.",currency:"CAD",forecast:"2.00%",previous:"2.25%",unit:"%"},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-07-15",time:"09:45 ET",impact:"HIGH",desc:"Mid-year BOC with MPR.",currency:"CAD",forecast:"2.00%",previous:"2.00%",unit:"%"},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-09-09",time:"09:45 ET",impact:"HIGH",desc:"September BOC rate decision.",currency:"CAD",forecast:"1.75%",previous:"2.00%",unit:"%"},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-10-28",time:"09:45 ET",impact:"HIGH",desc:"October BOC with MPR update.",currency:"CAD",forecast:"1.75%",previous:"1.75%",unit:"%"},
    {bank:"BOC",flag:"🇨🇦",name:"BOC Rate Decision",date:"2026-12-09",time:"09:45 ET",impact:"HIGH",desc:"Final 2026 BOC meeting.",currency:"CAD",forecast:"1.50%",previous:"1.75%",unit:"%"},
    // BOE 2026 — Bank Rate
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-02-05",time:"12:00 GMT",impact:"HIGH",desc:"Bank of England rate decision with Monetary Policy Report. Cut to 4.50%.",currency:"GBP",forecast:"4.50%",previous:"4.75%",actual:"4.50%",unit:"%",released:true},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-03-19",time:"12:00 GMT",impact:"HIGH",desc:"BOE rate decision. GBP/USD driven by BoE tone.",currency:"GBP",forecast:"4.25%",previous:"4.50%",unit:"%"},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-05-07",time:"12:00 GMT",impact:"HIGH",desc:"Spring BOE with updated MPR.",currency:"GBP",forecast:"4.00%",previous:"4.25%",unit:"%"},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-06-18",time:"12:00 GMT",impact:"HIGH",desc:"June BOE rate decision.",currency:"GBP",forecast:"3.75%",previous:"4.00%",unit:"%"},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-08-06",time:"12:00 GMT",impact:"HIGH",desc:"August BOE with MPR update.",currency:"GBP",forecast:"3.75%",previous:"3.75%",unit:"%"},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-09-17",time:"12:00 GMT",impact:"HIGH",desc:"September BOE meeting.",currency:"GBP",forecast:"3.50%",previous:"3.75%",unit:"%"},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-11-05",time:"12:00 GMT",impact:"HIGH",desc:"November BOE with MPR.",currency:"GBP",forecast:"3.50%",previous:"3.50%",unit:"%"},
    {bank:"BOE",flag:"🇬🇧",name:"BOE Rate Decision",date:"2026-12-17",time:"12:00 GMT",impact:"HIGH",desc:"Final 2026 BOE meeting.",currency:"GBP",forecast:"3.25%",previous:"3.50%",unit:"%"},
    // RBA 2026
    {bank:"RBA",flag:"🇦🇺",name:"RBA Rate Decision",date:"2026-02-17",time:"14:30 AET",impact:"MED",desc:"Reserve Bank of Australia rate decision.",currency:"AUD"},
    {bank:"RBA",flag:"🇦🇺",name:"RBA Rate Decision",date:"2026-04-07",time:"14:30 AET",impact:"MED",desc:"RBA rate decision. AUD sensitive to China data.",currency:"AUD"},
    {bank:"RBA",flag:"🇦🇺",name:"RBA Rate Decision",date:"2026-05-19",time:"14:30 AET",impact:"MED",desc:"May RBA meeting.",currency:"AUD"},
    {bank:"RBA",flag:"🇦🇺",name:"RBA Rate Decision",date:"2026-07-07",time:"14:30 AET",impact:"MED",desc:"July RBA rate decision.",currency:"AUD"},
    {bank:"RBA",flag:"🇦🇺",name:"RBA Rate Decision",date:"2026-08-04",time:"14:30 AET",impact:"MED",desc:"August RBA meeting.",currency:"AUD"},
    {bank:"RBA",flag:"🇦🇺",name:"RBA Rate Decision",date:"2026-09-01",time:"14:30 AET",impact:"MED",desc:"September RBA rate decision.",currency:"AUD"},
    {bank:"RBA",flag:"🇦🇺",name:"RBA Rate Decision",date:"2026-11-03",time:"14:30 AET",impact:"MED",desc:"November RBA meeting.",currency:"AUD"},
    {bank:"RBA",flag:"🇦🇺",name:"RBA Rate Decision",date:"2026-12-01",time:"14:30 AET",impact:"MED",desc:"Final 2026 RBA meeting.",currency:"AUD"},
    // Key US economic data releases 2026
    {bank:"CPI",flag:"🇦🇺",name:"CPI m/m",date:"2026-02-24",time:"08:30 ET",impact:"HIGH",desc:"Australia CPI month-over-month.",currency:"AUD"},
    {bank:"CPI",flag:"🇦🇺",name:"CPI y/y",date:"2026-02-24",time:"08:30 ET",impact:"HIGH",desc:"Australia CPI year-over-year.",currency:"AUD"},
    {bank:"USD",flag:"🇺🇸",name:"Unemployment Claims",date:"2026-02-26",time:"08:30 ET",impact:"MED",desc:"Weekly initial jobless claims.",currency:"USD"},
    {bank:"GDP",flag:"🇺🇸",name:"GDP m/m",date:"2026-02-27",time:"08:30 ET",impact:"HIGH",desc:"US GDP month-over-month.",currency:"USD"},
    {bank:"USD",flag:"🇺🇸",name:"Core PPI m/m",date:"2026-02-27",time:"08:30 ET",impact:"MED",desc:"US Core Producer Price Index month-over-month.",currency:"USD"},
    {bank:"USD",flag:"🇺🇸",name:"PPI m/m",date:"2026-02-27",time:"08:30 ET",impact:"MED",desc:"US Producer Price Index month-over-month.",currency:"USD"},
    {bank:"USD",flag:"🇺🇸",name:"Non-Farm Payrolls",date:"2026-03-06",time:"08:30 ET",impact:"HIGH",desc:"US jobs report.",currency:"USD"},
    {bank:"CPI",flag:"🇺🇸",name:"CPI m/m",date:"2026-03-11",time:"08:30 ET",impact:"HIGH",desc:"US Consumer Price Index month-over-month.",currency:"USD"},
    {bank:"CPI",flag:"🇺🇸",name:"CPI y/y",date:"2026-03-11",time:"08:30 ET",impact:"HIGH",desc:"US Consumer Price Index year-over-year.",currency:"USD"},
    {bank:"CPI",flag:"🇺🇸",name:"Core CPI m/m",date:"2026-03-11",time:"08:30 ET",impact:"HIGH",desc:"Core CPI (excl. food & energy).",currency:"USD"},
    {bank:"FED",flag:"🇺🇸",name:"FOMC Rate Decision",date:"2026-03-18",time:"14:00 ET",impact:"HIGH",desc:"Federal Reserve rate decision with projections.",currency:"USD"},
  ].map((e, i) => ({ current: "—", forecast: "—", previous: "—", unit: "", ...e, id: i + 1 }));

  let macroCache: { data: any[]; ts: number } = { data: [], ts: 0 };
  // Keeps released events for today so they're never lost when the API stops returning them
  const releasedEventsMemory: Map<string, any> = new Map();
  let releasedMemoryDate = ""; // track which calendar date the memory belongs to
  const MACRO_CACHE_MS = 300000; // 5 minutes — avoids ForexFactory rate limits (429 retry-after ~300s)
  let ffRateLimitUntil = 0; // don't re-hit FF API until this timestamp passes

  // Returns true if any event is past its scheduled release time but still has no actual value
  // In that case we skip cache and fetch fresh data immediately
  function hasPastDueEvents(events: any[]): boolean {
    const nowMs = Date.now();
    return events.some((e: any) => {
      if (e.released || e.actual) return false;
      try {
        const [y, mo, d] = e.date.split("-").map(Number);
        const [h, m] = (e.timeET || "00:00").split(":").map(Number);
        // Convert ET release time to UTC (use -4 for EDT March-November, -5 for EST)
        const etOffset = (mo >= 3 && mo <= 11) ? 4 : 5;
        const releaseMs = Date.UTC(y, mo - 1, d, h + etOffset, m, 0);
        return releaseMs < nowMs;
      } catch { return false; }
    });
  }

  function getDateRange() {
    // Use ET date to match client-side macroTodayStr
    const todayETStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const todayStart = new Date(todayETStr + "T00:00:00");
    const endDate = new Date(todayStart);
    endDate.setDate(todayStart.getDate() + 14);
    endDate.setHours(23, 59, 59, 999);
    return { todayStart, endDate };
  }

  const COUNTRY_TO_REGION: Record<string,string> = {
    USD:"United States",EUR:"Eurozone",GBP:"United Kingdom",
    CAD:"Canada",JPY:"Japan",AUD:"Australia",CHF:"Switzerland",NZD:"New Zealand",CNY:"China",
  };
  const COUNTRY_TO_CODE: Record<string,string> = {
    USD:"US",EUR:"EU",GBP:"UK",CAD:"CA",JPY:"JP",AUD:"AU",CHF:"CH",NZD:"NZ",CNY:"CN",
  };

  // Compute whether an event's scheduled release time has already passed
  function computeIsPast(dateStr: string, timeET: string): boolean {
    try {
      const [y, mo, d] = dateStr.split("-").map(Number);
      const [h, m] = timeET.split(":").map(Number);
      const etOffset = (mo >= 3 && mo <= 11) ? 4 : 5; // EDT vs EST
      return Date.UTC(y, mo - 1, d, h + etOffset, m, 30) < Date.now(); // +30s grace
    } catch { return false; }
  }

  // Build ForexFactory day URLs for a range of days around today
  function getFFDayUrls(): string[] {
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const urls: string[] = [];
    for (let offset = -3; offset <= 14; offset++) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      if (d.getDay() === 0 || d.getDay() === 6) continue; // skip weekends
      const mon = months[d.getMonth()];
      urls.push(`https://www.forexfactory.com/calendar?day=${mon}${d.getDate()}.${d.getFullYear()}`);
    }
    return urls;
  }


  // Parse event JSON objects from ForexFactory website HTML using brace counting
  // The website embeds full event data (including actual values) that the JSON API lacks
  function parseFFWebsiteEvents(html: string): any[] {
    const events: any[] = [];
    const marker = '{"id":';
    let pos = 0;
    while ((pos = html.indexOf(marker, pos)) !== -1) {
      // Walk forward counting braces to find the closing }
      let depth = 0;
      let inStr = false;
      let i = pos;
      for (; i < Math.min(html.length, pos + 4000); i++) {
        const c = html[i];
        if (inStr) {
          if (c === "\\") { i++; } // skip escaped char
          else if (c === '"') { inStr = false; }
        } else {
          if (c === '"') { inStr = true; }
          else if (c === '{') { depth++; }
          else if (c === '}') {
            depth--;
            if (depth === 0) { i++; break; }
          }
        }
      }
      const objStr = html.slice(pos, i);
      try {
        const obj = JSON.parse(objStr);
        // Only include if it has the fields we expect from calendar events
        if (obj.ebaseId !== undefined && obj.dateline && obj.currency && obj.impactName) {
          events.push(obj);
        }
      } catch {}
      pos = pos + 1;
    }
    return events;
  }

  async function fetchLiveCalendar(): Promise<any[]> {
    // Skip if currently rate-limited
    if (Date.now() < ffRateLimitUntil) {
      console.log(`[macro] FF rate-limited for ${Math.round((ffRateLimitUntil - Date.now()) / 1000)}s more`);
      return [];
    }
    const RELEVANT_CURRENCIES = new Set(["USD","EUR","GBP","JPY","CAD","AUD","CHF","NZD"]);
    const allRaw: any[] = [];

    const seenEventIds = new Set<number>();
    const dayUrls = getFFDayUrls();
    let rateLimited = false;

    try {
      // Fetch all day pages in parallel (3 at a time) to get actual values for each day
      const BATCH_SIZE = 3;
      for (let b = 0; b < dayUrls.length && !rateLimited; b += BATCH_SIZE) {
        const batch = dayUrls.slice(b, b + BATCH_SIZE);
        const results = await Promise.allSettled(batch.map(url =>
          fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
            },
            signal: AbortSignal.timeout(12000),
          }).then(async res => ({ url, res, html: res.ok ? await res.text() : null }))
        ));

        for (const result of results) {
          if (result.status !== "fulfilled") continue;
          const { url, res, html } = result.value;
          if (res.status === 429) {
            const retryAfter = parseInt(res.headers.get("retry-after") || "300") * 1000;
            ffRateLimitUntil = Date.now() + retryAfter;
            console.log(`[macro] FF website 429 — backing off ${Math.round(retryAfter / 1000)}s`);
            rateLimited = true; break;
          }
          if (!html) { console.log(`[macro] FF ${res.status} for ${url}`); continue; }
          const parsed = parseFFWebsiteEvents(html);
          let added = 0;
          for (const obj of parsed) {
            if (!RELEVANT_CURRENCIES.has(obj.currency)) continue;
            if (obj.name === "Bank Holiday") continue;
            if (seenEventIds.has(obj.id)) continue; // dedup across pages
            seenEventIds.add(obj.id);
            allRaw.push(obj);
            added++;
          }
          console.log(`[macro] FF ${url.slice(-15)}: ${parsed.length} parsed, ${added} new`);
        }
      }
    } catch {}

    if (!allRaw.length) return [];

    return allRaw.map((e: any, i: number) => {
      const dt = new Date(e.dateline * 1000);
      const dateStr = dt.toISOString().slice(0, 10);
      const timeET = dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" });
      const actual = e.actual && e.actual !== "" ? String(e.actual) : null;
      const forecast = e.forecast && e.forecast !== "" ? String(e.forecast) : "—";
      const previous = e.previous && e.previous !== "" ? String(e.previous) : "—";
      const released = actual !== null;
      const isPast = computeIsPast(dateStr, timeET);
      const cc = COUNTRY_TO_CODE[e.currency] || e.currency?.slice(0, 2) || "US";
      return {
        id: 10000 + i,
        bank: mapCountryToBank(e.currency, e.name),
        flag: countryFlag(e.currency),
        name: e.name,
        date: dateStr,
        time: timeET + " ET",
        timeET,
        country: cc,
        region: COUNTRY_TO_REGION[e.currency] || cc,
        current: previous,
        forecast,
        previous,
        actual,
        unit: "",
        released,
        isPast,
        impact: e.impactName === "high" ? "HIGH" : e.impactName === "medium" ? "MED" : "LOW",
        desc: `${e.name}. Previous: ${previous}. Forecast: ${forecast}.${released ? ` Actual: ${actual}.` : isPast ? " Data not yet available." : " Pending release."}`,
        currency: e.currency,
        live: true,
      };
    });
  }

  function mapCountryToBank(country: string, title: string): string {
    const t = title.toLowerCase();
    if (t.includes("fomc") || t.includes("fed")) return "FED";
    if (t.includes("ecb")) return "ECB";
    if (t.includes("boj")) return "BOJ";
    if (t.includes("boc") || (country === "CAD" && t.includes("rate"))) return "BOC";
    if (t.includes("boe") || (country === "GBP" && t.includes("rate"))) return "BOE";
    if (t.includes("rba") || (country === "AUD" && t.includes("rate"))) return "RBA";
    if (t.includes("cpi") || t.includes("inflation")) return "CPI";
    if (t.includes("nonfarm") || t.includes("non-farm") || t.includes("employment change")) return "NFP";
    if (t.includes("pce")) return "PCE";
    if (t.includes("gdp")) return "GDP";
    if (t.includes("pmi")) return "PMI";
    return country;
  }

  function countryFlag(country: string): string {
    const flags: Record<string,string> = {USD:"🇺🇸",EUR:"🇪🇺",GBP:"🇬🇧",JPY:"🇯🇵",CAD:"🇨🇦",AUD:"🇦🇺",CHF:"🇨🇭",NZD:"🇳🇿"};
    return flags[country] || "🌐";
  }

```

#### `client/src/components/KronosPanel.jsx`
```jsx
import { useState } from "react";

const mono  = "'IBM Plex Mono', monospace";
const serif = "'Playfair Display', serif";

const KRONOS_ASSETS = ["BTC","ETH","SOL","HYPE","DOGE","AVAX","XRP","LINK","NVDA","TSLA","XAU","CL"];
const KRONOS_TFS = [
  { id:"15m", label:"15m" },
  { id:"1h",  label:"1H"  },
  { id:"4h",  label:"4H"  },
  { id:"1d",  label:"1D"  },
];

const SIG_COLOR = {
  STRONG_LONG:  "#00ff88",
  LONG:         "#4ade80",
  NEUTRAL:      "#f59e0b",
  SHORT:        "#f87171",
  STRONG_SHORT: "#ff2d55",
};

const SIG_LABEL = {
  STRONG_LONG:  "⬆ STRONG LONG",
  LONG:         "↑ LONG",
  NEUTRAL:      "→ NEUTRAL",
  SHORT:        "↓ SHORT",
  STRONG_SHORT: "⬇ STRONG SHORT",
};

const VOL_COLOR = {
  LOW:      "#4ade80",
  MODERATE: "#f59e0b",
  HIGH:     "#f97316",
  EXTREME:  "#ff2d55",
};

function MiniSparkline({ prices, color }) {
  if (!prices || prices.length < 2) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const w = 80;
  const h = 28;
  const pts = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * w;
    const y = h - ((p - min) / range) * h;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={w} cy={h - ((prices[prices.length - 1] - min) / range) * h} r={2.5} fill={color} />
    </svg>
  );
}

function TrajectoryCard({ traj, color, label, icon, currentPrice }) {
  if (!traj) return null;
  const pct = traj.final_pct_change ?? 0;
  const pctStr = (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%";
  return (
    <div style={{
      background: `${color}09`,
      border: `1px solid ${color}33`,
      borderRadius: 8,
      padding: "10px 11px",
      flex: 1,
      minWidth: 0,
    }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
        <div style={{ fontSize:9, fontWeight:800, color, fontFamily:mono, letterSpacing:1 }}>
          {icon} {label}
        </div>
        <div style={{
          fontSize:9, fontWeight:800, fontFamily:mono,
          color: pct > 0 ? "#00ff88" : pct < 0 ? "#ff2d55" : "#f59e0b",
          background: pct > 0 ? "rgba(0,255,136,.08)" : pct < 0 ? "rgba(255,45,85,.08)" : "rgba(245,158,11,.08)",
          border: `1px solid ${pct > 0 ? "rgba(0,255,136,.25)" : pct < 0 ? "rgba(255,45,85,.25)" : "rgba(245,158,11,.25)"}`,
          borderRadius:3, padding:"2px 6px",
        }}>
          {pctStr}
        </div>
      </div>
      <MiniSparkline prices={traj.prices} color={color} />
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:5 }}>
        <div style={{ fontSize:8, color:"#6b7a99", fontFamily:mono }}>
          P({Math.round(traj.probability)}%)
        </div>
        <div style={{ fontSize:10, fontWeight:900, color, fontFamily:mono }}>
          ${traj.prices?.[4]?.toLocaleString("en-US", { maximumFractionDigits:2 }) ?? "—"}
        </div>
      </div>
      {traj.catalyst && (
        <div style={{ marginTop:5, fontSize:7, color:"#3a4560", fontFamily:mono, lineHeight:1.5, borderTop:"1px solid rgba(255,255,255,0.04)", paddingTop:5 }}>
          {traj.catalyst}
        </div>
      )}
    </div>
  );
}

export default function KronosPanel({ defaultAsset = "BTC" }) {
  const [asset,   setAsset]   = useState(defaultAsset);
  const [tf,      setTf]      = useState("4h");
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState(null);
  const [open,    setOpen]    = useState(false);

  const handleForecast = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/kronos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ticker: asset, timeframe: tf }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Kronos Engine failed (${res.status}): ${txt}`);
      }
      const data = await res.json();
      if (!data.trajectories || !data.ensemble_signal) throw new Error("Incomplete Kronos response");
      setResult(data);
      setOpen(true);
      // ── Publish latest forecast to a window-level cache so TopTradeIdeas can feed it to Claude ──
      try {
        if (typeof window !== "undefined") {
          if (!window.__clvrKronosCache) window.__clvrKronosCache = {};
          window.__clvrKronosCache[asset] = {
            ts: Date.now(),
            timeframe: tf,
            ensemble_signal: data.ensemble_signal,
            volatility_regime: data.volatility_forecast?.regime,
            annualized_vol_pct: data.volatility_forecast?.annualized_pct,
            next_candle_range_pct: data.volatility_forecast?.next_candle_range_pct,
            trajectories_summary: {
              bull: data.trajectories?.bull?.[data.trajectories?.bull?.length - 1]?.close,
              base: data.trajectories?.base?.[data.trajectories?.base?.length - 1]?.close,
              bear: data.trajectories?.bear?.[data.trajectories?.bear?.length - 1]?.close,
            },
          };
        }
      } catch { /* ignore cache errors */ }
    } catch (err) {
      setError(err.message || "Kronos Engine error");
    } finally {
      setLoading(false);
    }
  };

  const ensigCol = result ? (SIG_COLOR[result.ensemble_signal] || "#f59e0b") : "#f59e0b";
  const volCol   = result ? (VOL_COLOR[result.volatility_forecast?.regime] || "#f59e0b") : "#f59e0b";

  return (
    <div style={{
      background: "rgba(10,15,30,0.6)",
      border: "1px solid rgba(90,60,200,0.25)",
      borderRadius: 10,
      marginBottom: 12,
      overflow: "hidden",
    }}>
      {/* Header row (always visible) */}
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"10px 14px", cursor:"pointer",
          borderBottom: open ? "1px solid rgba(90,60,200,0.2)" : "none",
        }}
      >
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{
            width:22, height:22, borderRadius:5,
            background:"rgba(90,60,200,0.2)", border:"1px solid rgba(90,60,200,0.45)",
            display:"flex", alignItems:"center", justifyContent:"center", fontSize:11,
          }}>⏱</div>
          <div>
            <div style={{ fontSize:9, fontWeight:800, color:"#9b8cff", fontFamily:mono, letterSpacing:1.5 }}>
              KRONOS FORECAST ENGINE
            </div>
            <div style={{ fontSize:7, color:"#3a4560", fontFamily:mono, marginTop:1 }}>
              Multi-trajectory K-line forecasting · Inspired by AAAI 2026 research
            </div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {result && !loading && (
            <div style={{
              fontSize:9, fontWeight:800, fontFamily:mono, color:ensigCol,
              background:`${ensigCol}12`, border:`1px solid ${ensigCol}33`,
              borderRadius:3, padding:"2px 7px", letterSpacing:0.5,
            }}>
              {SIG_LABEL[result.ensemble_signal] || result.ensemble_signal}
            </div>
          )}
          <div style={{ fontSize:10, color:"#3a4560" }}>{open ? "▲" : "▼"}</div>
        </div>
      </div>

      {/* Collapsible body */}
      {open && (
        <div style={{ padding:"12px 14px" }}>
          {/* Controls */}
          <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
            <div style={{ display:"flex", gap:4, flexWrap:"wrap", flex:1 }}>
              {KRONOS_ASSETS.map(a => (
                <button
                  key={a}
                  data-testid={`kronos-asset-${a}`}
                  onClick={() => { setAsset(a); setResult(null); }}
                  style={{
                    background: asset === a ? "rgba(155,140,255,0.12)" : "transparent",
                    border: `1px solid ${asset === a ? "rgba(155,140,255,0.5)" : "#1a2235"}`,
                    color: asset === a ? "#9b8cff" : "#6b7a99",
                    padding:"4px 10px", borderRadius:4,
                    cursor:"pointer", fontFamily:mono, fontSize:9, fontWeight: asset === a ? 800 : 400,
                  }}
                >{a}</button>
              ))}
            </div>
            <div style={{ display:"flex", gap:4 }}>
              {KRONOS_TFS.map(t => (
                <button
                  key={t.id}
                  data-testid={`kronos-tf-${t.id}`}
                  onClick={() => { setTf(t.id); setResult(null); }}
                  style={{
                    background: tf === t.id ? "rgba(155,140,255,0.12)" : "transparent",
                    border: `1px solid ${tf === t.id ? "rgba(155,140,255,0.5)" : "#1a2235"}`,
                    color: tf === t.id ? "#9b8cff" : "#6b7a99",
                    padding:"4px 10px", borderRadius:4,
                    cursor:"pointer", fontFamily:mono, fontSize:9, fontWeight: tf === t.id ? 800 : 400,
                  }}
                >{t.label}</button>
              ))}
            </div>
          </div>

          {/* Run button */}
          <button
            data-testid="btn-run-kronos"
            onClick={handleForecast}
            disabled={loading}
            style={{
              width:"100%",
              background: loading ? "rgba(155,140,255,0.03)" : "rgba(155,140,255,0.08)",
              border: `1px solid ${loading ? "#1a2235" : "rgba(155,140,255,0.4)"}`,
              color: loading ? "#3a4560" : "#9b8cff",
              padding:"11px 16px", borderRadius:6,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily:serif, fontStyle:"italic", fontSize:14,
              letterSpacing:0.5, marginBottom:14,
              transition:"all 0.2s",
              boxShadow: loading ? "none" : "0 0 18px rgba(155,140,255,0.1)",
            }}
          >
            {loading
              ? "⏳ Kronos Engine running…"
              : result
              ? `⏱ Re-run Kronos Forecast — ${asset} ${tf.toUpperCase()}`
              : `⏱ Run Kronos Forecast — ${asset} ${tf.toUpperCase()} →`}
          </button>

          {/* Error */}
          {error && (
            <div style={{
              background:"rgba(255,45,85,0.08)", border:"1px solid #ff2d55",
              color:"#f87171", padding:"10px 12px", borderRadius:6,
              fontFamily:mono, fontSize:10, marginBottom:12,
            }}>
              ⚠ {error}
            </div>
          )}

          {/* Results */}
          {result && !loading && (
            <>
              <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap" }}>
                {/* Ensemble signal */}
                <div style={{
                  flex:2, minWidth:120,
                  background:`${ensigCol}10`, border:`1px solid ${ensigCol}35`,
                  borderRadius:8, padding:"10px 12px",
                  display:"flex", flexDirection:"column", gap:4,
                }}>
                  <div style={{ fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:1.5 }}>ENSEMBLE SIGNAL</div>
                  <div style={{ fontSize:16, fontWeight:900, color:ensigCol, fontFamily:mono, letterSpacing:0.5 }}>
                    {SIG_LABEL[result.ensemble_signal] || result.ensemble_signal}
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <div style={{ flex:1, height:4, background:"rgba(255,255,255,0.05)", borderRadius:2, overflow:"hidden" }}>
                      <div style={{
                        height:"100%", width:`${result.ensemble_confidence || 0}%`,
                        background:`linear-gradient(90deg,${ensigCol}60,${ensigCol})`,
                        borderRadius:2, transition:"width 1s",
                      }} />
                    </div>
                    <span style={{ fontSize:9, fontWeight:800, color:ensigCol, fontFamily:mono }}>
                      {result.ensemble_confidence}%
                    </span>
                  </div>
                </div>

                {/* Volatility */}
                <div style={{
                  flex:1, minWidth:90,
                  background:`${volCol}10`, border:`1px solid ${volCol}35`,
                  borderRadius:8, padding:"10px 12px",
                }}>
                  <div style={{ fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:1.5, marginBottom:4 }}>VOLATILITY</div>
                  <div style={{ fontSize:13, fontWeight:900, color:volCol, fontFamily:mono }}>
                    {result.volatility_forecast?.regime}
                  </div>
                  <div style={{ fontSize:8, color:volCol, fontFamily:mono, marginTop:2, opacity:0.8 }}>
                    {result.volatility_forecast?.annualized_pct?.toFixed(1)}% ann.
                  </div>
                  <div style={{ fontSize:7, color:"#3a4560", fontFamily:mono, marginTop:2 }}>
                    ±{result.volatility_forecast?.next_candle_range_pct?.toFixed(2)}% / candle
                  </div>
                </div>

                {/* Key levels */}
                {result.key_levels && (
                  <div style={{
                    flex:1, minWidth:90,
                    background:"rgba(255,255,255,0.02)", border:"1px solid #1a2235",
                    borderRadius:8, padding:"10px 12px",
                  }}>
                    <div style={{ fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:1.5, marginBottom:6 }}>KEY LEVELS</div>
                    <div style={{ fontSize:8, color:"#ff2d55", fontFamily:mono, marginBottom:4 }}>
                      R: ${result.key_levels.resistance?.toLocaleString("en-US", { maximumFractionDigits:2 })}
                    </div>
                    <div style={{ fontSize:8, color:"#00ff88", fontFamily:mono }}>
                      S: ${result.key_levels.support?.toLocaleString("en-US", { maximumFractionDigits:2 })}
                    </div>
                  </div>
                )}
              </div>

              {/* Trajectory header */}
              <div style={{
                fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:2,
                marginBottom:8, paddingTop:4,
              }}>
                ◆ 5-CANDLE TRAJECTORIES — {asset} · {tf.toUpperCase()}
              </div>

              {/* 3 trajectory cards */}
              <div style={{ display:"flex", gap:8, marginBottom:12 }}>
                <TrajectoryCard traj={result.trajectories?.bull} color="#00ff88" label="BULL" icon="⬆" currentPrice={result.current_price} />
                <TrajectoryCard traj={result.trajectories?.base} color="#9b8cff" label="BASE" icon="→" currentPrice={result.current_price} />
                <TrajectoryCard traj={result.trajectories?.bear} color="#ff2d55" label="BEAR" icon="⬇" currentPrice={result.current_price} />
              </div>

              {/* ── TRADE PLAN (entry / TP1 / TP2 / SL / leverage / RSI) ── */}
              {result.trade_plan && (() => {
                const tp = result.trade_plan;
                const ind = result.indicators || {};
                const dirIsLong = tp.direction === "LONG";
                const dirIsShort = tp.direction === "SHORT";
                const noTrade = tp.direction === "NO_TRADE" || (!dirIsLong && !dirIsShort);
                const dirCol = noTrade ? "#6b7a99" : dirIsLong ? "#00ff88" : "#ff2d55";
                const rsiVal = ind.rsi;
                const rsiCol = rsiVal >= 70 ? "#ff2d55" : rsiVal <= 30 ? "#00ff88" : "#f59e0b";
                const fmt = (v) => (v == null || Number.isNaN(parseFloat(v)))
                  ? "—"
                  : `$${parseFloat(v).toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
                return (
                  <div style={{
                    background: `${dirCol}08`,
                    border: `1px solid ${dirCol}33`,
                    borderRadius: 8,
                    padding: "10px 12px",
                    marginBottom: 10,
                  }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                      <div style={{ fontSize:8, color:"#9b8cff", fontFamily:mono, letterSpacing:1.5, fontWeight:800 }}>
                        ◆ TRADE PLAN
                      </div>
                      <div style={{
                        fontSize:9, fontWeight:800, fontFamily:mono, color: dirCol,
                        background: `${dirCol}12`, border: `1px solid ${dirCol}33`,
                        borderRadius:3, padding:"2px 7px", letterSpacing:0.5,
                      }}>
                        {noTrade ? "⛔ NO TRADE" : dirIsLong ? "⬆ LONG" : "⬇ SHORT"}
                      </div>
                    </div>

                    {/* RSI + leverage strip */}
                    <div style={{ display:"flex", gap:8, marginBottom:8, flexWrap:"wrap" }}>
                      <div style={{ flex:1, minWidth:90, background:`${rsiCol}10`, border:`1px solid ${rsiCol}33`, borderRadius:5, padding:"6px 8px" }}>
                        <div style={{ fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:1 }}>RSI(14)</div>
                        <div style={{ fontSize:12, fontWeight:900, color:rsiCol, fontFamily:mono }}>
                          {typeof rsiVal === "number" ? rsiVal.toFixed(1) : "—"}
                        </div>
                        <div style={{ fontSize:7, color:rsiCol, fontFamily:mono, opacity:0.8 }}>
                          {ind.rsi_zone || "—"}
                        </div>
                      </div>
                      <div style={{ flex:1, minWidth:90, background:"rgba(255,255,255,0.02)", border:"1px solid #1a2235", borderRadius:5, padding:"6px 8px" }}>
                        <div style={{ fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:1 }}>LEVERAGE</div>
                        <div style={{ fontSize:11, fontWeight:900, color:"#e8c96d", fontFamily:mono }}>
                          {tp.leverage || ind.suggested_leverage || "—"}
                        </div>
                      </div>
                      <div style={{ flex:1, minWidth:90, background:"rgba(255,255,255,0.02)", border:"1px solid #1a2235", borderRadius:5, padding:"6px 8px" }}>
                        <div style={{ fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:1 }}>ATR</div>
                        <div style={{ fontSize:11, fontWeight:900, color:"#9b8cff", fontFamily:mono }}>
                          {typeof ind.atr_pct === "number" ? `${ind.atr_pct.toFixed(2)}%` : "—"}
                        </div>
                      </div>
                    </div>

                    {!noTrade && (
                      <>
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:6, marginBottom:6 }}>
                          <div style={{ background:"rgba(232,201,109,0.06)", border:"1px solid rgba(232,201,109,0.2)", borderRadius:5, padding:"6px 8px" }}>
                            <div style={{ fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:1 }}>ENTRY</div>
                            <div style={{ fontSize:11, fontWeight:900, color:"#e8c96d", fontFamily:mono }}>{fmt(tp.entry)}</div>
                          </div>
                          <div style={{ background:"rgba(255,45,85,0.06)", border:"1px solid rgba(255,45,85,0.2)", borderRadius:5, padding:"6px 8px" }}>
                            <div style={{ fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:1 }}>STOP LOSS</div>
                            <div style={{ fontSize:11, fontWeight:900, color:"#ff2d55", fontFamily:mono }}>{fmt(tp.sl)}</div>
                          </div>
                          <div style={{ background:"rgba(0,255,136,0.06)", border:"1px solid rgba(0,255,136,0.2)", borderRadius:5, padding:"6px 8px" }}>
                            <div style={{ fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:1 }}>TP1 · {tp.rr_tp1 || "—"}</div>
                            <div style={{ fontSize:11, fontWeight:900, color:"#00ff88", fontFamily:mono }}>{fmt(tp.tp1)}</div>
                          </div>
                          <div style={{ background:"rgba(0,255,136,0.06)", border:"1px solid rgba(0,255,136,0.2)", borderRadius:5, padding:"6px 8px" }}>
                            <div style={{ fontSize:7, color:"#6b7a99", fontFamily:mono, letterSpacing:1 }}>TP2 · {tp.rr_tp2 || "—"}</div>
                            <div style={{ fontSize:11, fontWeight:900, color:"#00ff88", fontFamily:mono }}>{fmt(tp.tp2)}</div>
                          </div>
                        </div>
                        {tp.entry_logic && (
                          <div style={{ fontSize:8, color:"#a0aec0", fontFamily:mono, lineHeight:1.6, marginTop:6 }}>
                            <span style={{ color:"#9b8cff" }}>Entry logic:</span> {tp.entry_logic}
                          </div>
                        )}
                        {tp.invalidation && (
                          <div style={{ fontSize:8, color:"#a0aec0", fontFamily:mono, lineHeight:1.6, marginTop:3 }}>
                            <span style={{ color:"#ff2d55" }}>Invalidation:</span> {tp.invalidation}
                          </div>
                        )}
                      </>
                    )}
                    {tp.notes && (
                      <div style={{ fontSize:8, color:"#6b7a99", fontFamily:mono, lineHeight:1.6, marginTop:5, borderTop:"1px solid rgba(255,255,255,0.04)", paddingTop:5 }}>
                        {tp.notes}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Pattern detected */}
              {result.sequence_pattern && (
                <div style={{
                  background:"rgba(155,140,255,0.05)", border:"1px solid rgba(155,140,255,0.15)",
                  borderRadius:6, padding:"8px 12px", marginBottom:10,
                  display:"flex", gap:8, alignItems:"flex-start",
                }}>
                  <span style={{ fontSize:12 }}>🔍</span>
                  <div>
                    <div style={{ fontSize:8, color:"#9b8cff", fontFamily:mono, fontWeight:700, marginBottom:2, letterSpacing:1 }}>
                      SEQUENCE PATTERN DETECTED
                    </div>
                    <div style={{ fontSize:9, color:"#a0aec0", fontFamily:mono, lineHeight:1.6 }}>
                      {result.sequence_pattern}
                    </div>
                  </div>
                </div>
              )}

              {/* Volatility note */}
              {result.volatility_forecast?.note && (
                <div style={{ fontSize:7, color:"#2a3550", fontFamily:mono, lineHeight:1.6 }}>
                  ◦ {result.volatility_forecast.note}
                </div>
              )}

              {/* Timestamp + disclaimer */}
              <div style={{
                marginTop:10, paddingTop:8, borderTop:"1px solid rgba(255,255,255,0.04)",
                display:"flex", justifyContent:"space-between", alignItems:"center",
              }}>
                <div style={{ fontSize:7, color:"#2a3550", fontFamily:mono }}>
                  Kronos-inspired · Claude Sonnet 4 · {result.generated_at ? new Date(result.generated_at).toLocaleTimeString() : "—"}
                </div>
                <div style={{
                  fontSize:7, color:"#9b8cff", fontFamily:mono,
                  background:"rgba(155,140,255,0.08)", border:"1px solid rgba(155,140,255,0.15)",
                  borderRadius:3, padding:"2px 6px",
                }}>
                  AAAI 2026 METHODOLOGY
                </div>
              </div>
            </>
          )}

          {/* Empty state */}
          {!result && !loading && !error && (
            <div style={{
              textAlign:"center", padding:"16px 0",
              fontSize:8, color:"#2a3550", fontFamily:mono, lineHeight:2,
            }}>
              Probabilistic 5-candle forecast · BULL / BASE / BEAR trajectories<br />
              Volatility regime · Ensemble signal · Sequence pattern detection<br />
              <span style={{ color:"#3a4560" }}>Methodology inspired by Kronos (arXiv:2508.02739)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

---

## 4. Ask AI

**Endpoints:** `POST /api/concierge/chat` (concierge) + shared `POST /api/ai/analyze` (see §1) · **Client:** `AIChat.jsx`, `ModeToggle.jsx`, `MacroPreFlight.jsx`

#### Backend: POST /api/concierge/chat — `server/routes.ts` (lines 5206–5328)
```ts
  app.post("/api/concierge/chat", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ error: "Sign in to use the concierge." });

    const today = new Date().toISOString().slice(0, 10);

    // Validate + trim incoming history.
    const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const cleaned = incoming
      .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m: any) => ({ role: m.role, content: m.content }));
    const last = cleaned[cleaned.length - 1];
    if (!last || last.role !== "user" || !last.content.trim()) {
      return res.status(400).json({ error: "Empty message." });
    }
    if (last.content.length > 1000) {
      return res.status(400).json({ error: "Message too long (max 1000 characters)." });
    }
    const trimmed = cleaned.slice(-10);

    try {
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ error: "Sign in to use the concierge." });
      const pricing = await resolveConciergePricing(user);
      const isFreeElite = pricing.tier === "elite" && pricing.eliteFreeRemaining > 0;
      const freeRemaining = pricing.eliteFreeRemaining;
      const eliteNote = isFreeElite
        ? `As an Elite member you have ${freeRemaining} free training session${freeRemaining === 1 ? "" : "s"} remaining`
        : "";

      // ── Canned-answer layer — instant pre-written replies for common
      // questions. Runs BEFORE the daily cap + Anthropic call: no token cost,
      // and these do NOT count against the cap. Unmatched messages fall
      // through to the AI flow below unchanged.
      const q = String(last.content || "").toLowerCase().trim();
      const bookingLine = isFreeElite
        ? `As an Elite member you have ${freeRemaining} free 30-minute training session${freeRemaining === 1 ? "" : "s"} left. Tap Book above to pick a time and I'll set it up.`
        : `A 30-minute 1-on-1 training session is ${pricing.priceDisplay} for your account. Tap Book above to choose a time.`;
      const CANNED: { match: RegExp; answer: string }[] = [
        { match: /(differ|compare|free.*pro|pro.*elite|which (plan|tier)|what.*plans?)/i,
          answer: `Quick version of the three plans. Free gets you live prices, the macro calendar, basic signals and one morning brief idea. Pro at 29.99 a month adds the CLVR AI market chat, full signals, the sentiment feed and custom alerts. Elite at 129 a month unlocks everything, including the AI Quant Engine, SEC Insider Flow, Basket Analysis, the Squawk Box and whale tracking. Want me to go deeper on any one of them?` },
        { match: /(book|session|1.?on.?1|one.?on.?one|training|call with|talk to|consult)/i,
          answer: `Happy to help you book. {BOOKING_LINE} The session is a live walkthrough of the platform, just education on how to use the tools, not financial advice.` },
        { match: /(pulse|unusual activity)/i,
          answer: `Pulse flags assets showing unusual conditions right now, things like a sudden volume jump, accelerating price, or extreme funding. It scores each one and sorts them, so it is a heads up to go look, not a prediction or a signal to trade. It pairs well with the Signals tab for confirmation. Want me to show you where it lives in the app?` },
        { match: /(quant engine|masterbrain|master brain)/i,
          answer: `The Quant Engine, or MasterBrain, is the Elite deep-analysis tool. It stacks multiple factors together, price action, funding, open interest, momentum and macro context, then lays out a full trade blueprint with entry, stop, targets and a suggested position size. Think of it as the heavyweight analysis on top of the quick signals. Want a live walkthrough of it?` },
        { match: /(quantbrain|signal|how.*signal|what.*signal)/i,
          answer: `QuantBrain reads price action on any ticker and flags entry and exit zones along with trend strength and momentum. Open a ticker, check the Signals tab, and it does the rest. The Quant Engine then adds extra confluence on top for higher-probability setups. Want me to walk you through reading one?` },
        { match: /(upgrade|how.*pay|subscribe|change.*plan|go (pro|elite))/i,
          answer: `To upgrade, tap your tier badge in the header and pick Pro or Elite. Checkout is handled securely through Stripe and you can cancel anytime. Want me to explain what you'd unlock on each tier first?` },
      ];
      const cannedHit = CANNED.find((c) => c.match.test(q));
      if (cannedHit) {
        const reply = cannedHit.answer.replace("{BOOKING_LINE}", bookingLine);
        const used = conciergeUsage[userId] && conciergeUsage[userId].day === today ? conciergeUsage[userId].count : 0;
        return res.json({ reply, action: null, usage: { used, cap: CONCIERGE_DAILY_CAP }, canned: true });
      }

      // Daily cap — applies only to AI-backed replies (canned answers are free).
      const usedToday = conciergeUsage[userId] && conciergeUsage[userId].day === today ? conciergeUsage[userId].count : 0;
      if (usedToday >= CONCIERGE_DAILY_CAP) {
        return res.status(429).json({ error: "Daily concierge limit reached. Try again tomorrow." });
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(502).json({ error: "Concierge unavailable, try again." });

      const system = `You are the CLVRQuant Concierge — a friendly, professional support assistant for the CLVRQuant platform (clvrquantai.com) ONLY.

STRICT SCOPE — you may ONLY help with:
1. Explaining CLVRQuant features and how to use them: QuantBrain AI signals, the AI Quant Engine (MasterBrain), Signals tab, AI Radar, Pulse (Unusual Activity), Earnings tab, Social Intelligence, Polymarket data, Morning Brief, Alerts, Squawk Box, SEC Insider Flow, Basket Analysis, the three plans (Free, Pro $29.99/mo, Elite $129/mo), and how to navigate the app.
2. Helping the user book a paid 30-min 1-on-1 platform training session.

YOU MUST REFUSE, politely and briefly, anything outside this scope. This includes: general knowledge, current events, web lookups, math/homework, coding help, medical/legal/tax questions, SPECIFIC FINANCIAL OR TRADING ADVICE ("should I buy X?", price predictions, what to invest in), personal opinions, or anything unrelated to using CLVRQuant. For off-topic requests say: "I can only help with using the CLVRQuant platform and booking a training session. Is there something about the platform I can help with?"

NEVER give personalized financial, investment, or trading advice. CLVRQuant is an information and education tool, not financial advice. If asked what to trade or whether something will go up, decline and redirect to how the platform's tools work.

TONE: professional, concise, encouraging. No profanity. If a user is abusive or uses profanity, stay calm, do not mirror it, and ask them to keep it respectful. Never produce unsafe, explicit, hateful, or harmful content.

WRITING STYLE — sound like a friendly human teammate, not a brochure:
- Plain conversational text. NO markdown symbols at all: no **, no ##, no backticks, no bullet characters like - or *.
- Do NOT output long numbered feature lists. Explain in 2–4 short sentences, like you're talking to someone.
- If you must list steps, weave them into a sentence or use simple short lines with no symbols, max 3 lines.
- No emojis. No exclamation spam. Warm but professional.
- Keep the whole reply under ~80 words unless the user asks for detail.
- End naturally — only mention booking when it's relevant, and state the user's real free-session count if they're Elite.

BOOKING: This user's session price is ${pricing.priceDisplay}. ${eliteNote}. A session is a live 30-minute 1-on-1 walkthrough of the platform — educational only, not financial advice. When the user wants to book, tell them their price and say they can pick a time using the Book button below the chat, OR if they confirm intent to book, end your message with the exact tag [BOOK] on its own line so the app can open the booking flow. Only emit [BOOK] when the user clearly wants to proceed.

Stay in scope no matter how the user rephrases.`;

      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 500, system, messages: trimmed }),
      });
      if (!aiRes.ok) { console.error("[concierge/chat]", await aiRes.text()); return res.status(502).json({ error: "Concierge unavailable, try again." }); }
      const aiData: any = await aiRes.json();
      if (aiData.error) { console.error("[concierge/chat] API error:", aiData.error.message || aiData.error); return res.status(502).json({ error: "Concierge unavailable, try again." }); }

      let reply = (aiData.content || []).map((b: any) => b.text || "").join("").trim();
      let action: "book" | null = null;
      // Strip a lone [BOOK] line and flag the booking action.
      if (/(^|\n)\s*\[BOOK\]\s*(\n|$)/.test(reply)) {
        action = "book";
        reply = reply.replace(/(^|\n)\s*\[BOOK\]\s*(\n|$)/g, "\n").trim();
      }
      if (!reply) return res.status(502).json({ error: "Concierge unavailable, try again." });

      // Increment daily count only on a successful reply. Read the current
      // value at write time (not the pre-await snapshot) so interleaved
      // requests don't clobber each other's increment.
      const cur = conciergeUsage[userId] && conciergeUsage[userId].day === today ? conciergeUsage[userId].count : 0;
      const newCount = cur + 1;
      conciergeUsage[userId] = { count: newCount, day: today };
      res.json({ reply, action, usage: { used: newCount, cap: CONCIERGE_DAILY_CAP } });
    } catch (e: any) {
      console.error("[concierge/chat]", e?.message || e);
      res.status(502).json({ error: "Concierge unavailable, try again." });
    }
  });

```

#### `client/src/components/ai/AIChat.jsx`
```jsx
import { useState, useRef, useEffect } from "react";
import { buildMarketSnapshot, buildMacroPreflightContext } from "../../utils/marketDataSnapshot.js";

const MONO = "'IBM Plex Mono', monospace";
const SERIF = "'Playfair Display', Georgia, serif";
const SANS = "'Barlow', system-ui, sans-serif";

// ── Lightweight markdown renderer for AI responses ────────────────────────────
function renderInline(text) {
  // Escape HTML, then re-apply **bold**, *italic*, `code`, and color tags for LONG/SHORT/STOP
  const esc = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  let html = esc
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#e8c96d;font-weight:700">$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(201,168,76,0.08);padding:1px 6px;border-radius:3px;font-family:\'IBM Plex Mono\',monospace;font-size:0.9em;color:#e8c96d">$1</code>')
    .replace(/\b(LONG|BUY|BULLISH)\b/g, '<span style="color:#22c55e;font-weight:700">$1</span>')
    .replace(/\b(SHORT|SELL|BEARISH)\b/g, '<span style="color:#ef4444;font-weight:700">$1</span>')
    .replace(/\b(NO[- ]?TRADE|NEUTRAL|WAIT|SKIP)\b/gi, '<span style="color:#94a3b8;font-weight:700">$1</span>')
    .replace(/\b(SL|STOP[- ]?LOSS|STOP):/gi, '<span style="color:#ef4444;font-weight:700">$1:</span>')
    .replace(/\b(TP[123]?|TARGET|TAKE[- ]?PROFIT):/gi, '<span style="color:#22c55e;font-weight:700">$1:</span>')
    .replace(/\b(ENTRY|ENTER):/gi, '<span style="color:#e8c96d;font-weight:700">$1:</span>');
  return html;
}

function FormattedAIMessage({ text }) {
  if (!text) return null;
  const lines = String(text).split(/\r?\n/);
  const blocks = [];
  let listBuffer = [];
  const flushList = () => {
    if (listBuffer.length === 0) return;
    blocks.push(
      <ul key={"ul-" + blocks.length} style={{ margin: "6px 0 10px 0", paddingLeft: 18, listStyle: "none" }}>
        {listBuffer.map((item, i) => (
          <li key={i} style={{ position: "relative", paddingLeft: 14, marginBottom: 4, lineHeight: 1.7 }}>
            <span style={{ position: "absolute", left: 0, top: 0, color: "#c9a84c" }}>•</span>
            <span dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
          </li>
        ))}
      </ul>
    );
    listBuffer = [];
  };

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (!line.trim()) { flushList(); blocks.push(<div key={"sp-" + idx} style={{ height: 6 }} />); return; }

    // Heading: ## or # or ALL-CAPS LINE ending in ":"
    const h2 = line.match(/^##\s+(.+)$/);
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1 || h2) {
      flushList();
      const txt = (h1 ? h1[1] : h2[1]).trim();
      blocks.push(
        <div key={"h-" + idx} style={{
          fontFamily: SERIF, fontSize: h1 ? 15 : 13, fontWeight: 700, color: "#e8c96d",
          marginTop: 10, marginBottom: 6, paddingBottom: 4, borderBottom: "1px solid rgba(201,168,76,0.18)",
          letterSpacing: "0.02em",
        }}>{txt}</div>
      );
      return;
    }

    // Bullet line
    const bullet = line.match(/^\s*[-•*]\s+(.+)$/);
    if (bullet) { listBuffer.push(bullet[1]); return; }

    // Numbered bullet "1. xxx"
    const num = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (num) { listBuffer.push(num[1]); return; }

    // Section divider (=== or ---)
    if (/^[-=─━]{3,}$/.test(line.trim())) {
      flushList();
      blocks.push(<div key={"hr-" + idx} style={{ height: 1, background: "rgba(201,168,76,0.15)", margin: "10px 0" }} />);
      return;
    }

    // Key: Value line — render with subtle column treatment
    const kv = line.match(/^([A-Z][A-Za-z0-9 \/()._-]{1,32}):\s*(.+)$/);
    if (kv) {
      flushList();
      blocks.push(
        <div key={"kv-" + idx} style={{ display: "flex", gap: 10, marginBottom: 4, lineHeight: 1.7 }}>
          <div style={{ minWidth: 90, color: "#94a3b8", fontFamily: MONO, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 }}>{kv[1]}</div>
          <div style={{ flex: 1, color: "#e6e9ef" }} dangerouslySetInnerHTML={{ __html: renderInline(kv[2]) }} />
        </div>
      );
      return;
    }

    // Default paragraph
    flushList();
    blocks.push(
      <p key={"p-" + idx} style={{ margin: "0 0 6px 0", lineHeight: 1.75, color: "#e6e9ef" }}
         dangerouslySetInnerHTML={{ __html: renderInline(line) }} />
    );
  });
  flushList();
  return <div style={{ fontFamily: SANS, fontSize: 12.5 }}>{blocks}</div>;
}

const QUICK_CHIPS = ["BTC", "ETH", "SOL", "TRUMP", "HYPE", "XAU", "WTI", "EURUSD", "TSLA", "NVDA"];

// Module-level cache for the eligible execution-overlay symbol map.
// Single fetch is shared across all AIChat sendMessage calls.
let __eligibleExecCache = null;
async function getEligibleExecutionSymbols() {
  if (__eligibleExecCache) return __eligibleExecCache;
  __eligibleExecCache = (async () => {
    try {
      const r = await fetch("/api/execution_levels/eligible", { credentials: "include" });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  })();
  return __eligibleExecCache;
}

export default function AIChat({
  storePerps, storeSpot, cryptoPrices, equityPrices, metalPrices, forexPrices,
  liveSignals, newsFeed, macroEvents, insiderData, regimeData,
  storeMode, storeTotalMarkets, storeAlerts, isPro, isElite,
  allPrices, fmt,
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dailyCount, setDailyCount] = useState(0);
  const [marketTypeFilter, setMarketTypeFilter] = useState("BOTH");
  const scrollRef = useRef(null);

  const dailyLimit = isElite ? 999 : 30;
  const atLimit = dailyCount >= dailyLimit;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const fmtPrice = (p, sym) => {
    if (fmt) return fmt(p, sym);
    if (!p) return "—";
    return "$" + Number(p).toLocaleString();
  };

  const sendMessage = async () => {
    if (!input.trim() || loading || atLimit) return;
    const userMsg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      let preflight = null;
      try {
        const pRes = await fetch("/api/macro/preflight", { credentials: "include" });
        if (pRes.ok) preflight = await pRes.json();
      } catch {}

      // Same filter pattern as TopTradeIdeas — PERP/SPOT drops the wrong-
      // section data so the AI can't reach for a spot price (e.g. Yahoo's
      // $145 AMD) when the user selected perps and the real HL xyz:AMD perp
      // is trading $340. signalFilter focuses chat answers on assets
      // actually moving (pump/dump) instead of the full stale universe.
      const snap = buildMarketSnapshot({
        storePerps, storeSpot, cryptoPrices, equityPrices, metalPrices, forexPrices,
        liveSignals, newsFeed, macroEvents, insiderData, regimeData,
        storeMode, storeTotalMarkets, storeAlerts,
        marketTypeFilter,
        signalFilter: true,
      });

      const macroCtx = buildMacroPreflightContext(preflight);

      // ── Execution context (VWAP + Opening Range) ─────────────────────────
      // Detect spot equity / FX / commodity tickers mentioned in the user's
      // question, fetch /api/execution_levels for each, and append a context
      // block. The endpoint returns 404 for ineligible (crypto / perp) so we
      // never feed VWAP/OR for those — which keeps the analyst silent on
      // session structure for assets that have no defined session anchor.
      // Client-side: pre-filter against the eligible map so we don't fire
      // wasted requests for noise tokens (AND/VS/etc.) or crypto mentions.
      let execContext = "";
      try {
        const eligibleMap = await getEligibleExecutionSymbols();
        const eligibleSet = new Set([
          ...(eligibleMap?.equity || []),
          ...(eligibleMap?.fx || []),
          ...(eligibleMap?.commodity || []),
        ]);
        const mentions = Array.from(new Set(
          (userMsg.toUpperCase().match(/\b[A-Z]{2,8}\b/g) || []).filter(t =>
            eligibleSet.has(t)
          )
        )).slice(0, 3);
        const blocks = [];
        for (const sym of mentions) {
          try {
            const r = await fetch(`/api/execution_levels/${sym}`, { credentials: "include" });
            if (!r.ok) continue;
            const lvl = await r.json();
            const dec = lvl.current_price < 10 ? 4 : 2;
            const f = (n) => Number(n).toFixed(dec);
            const rangePos = lvl.in_or_range ? "inside" : (lvl.current_price > lvl.orh ? "above" : "below");
            const ts = new Date(lvl.current_ts).toISOString().slice(11, 16) + " UTC";
            blocks.push(
              `EXECUTION CONTEXT (${lvl.symbol}, ${ts}):\n` +
              `- Session VWAP: $${f(lvl.vwap)} (price ${lvl.price_vs_vwap_pct >= 0 ? "+" : ""}${lvl.price_vs_vwap_pct}% away)\n` +
              `- VWAP bands: $${f(lvl.vwap_lower_1sd)} / $${f(lvl.vwap_upper_1sd)}\n` +
              `- Opening Range: $${f(lvl.orl)} — $${f(lvl.orh)} (width ${lvl.or_width_pct}%)\n` +
              `- Current price: $${f(lvl.current_price)} (${rangePos} opening range)\n` +
              `- ORB status: ${lvl.orb_status}`
            );
          } catch {}
        }
        if (blocks.length) execContext = blocks.join("\n\n");
      } catch {}

      const execContextRule = execContext
        ? `When the EXECUTION CONTEXT block is present, reference VWAP and opening range levels in your tape-read. If absent, do not mention these levels — the asset is not eligible for intraday session structure analysis.`
        : `Do NOT mention VWAP or opening range levels in this response — no execution context was supplied for the assets in question.`;

      const marketTypeRule = marketTypeFilter === "PERP"
        ? `MARKET TYPE FILTER: PERP ONLY. Recommend ONLY perpetual futures / leveraged setups. Use ONLY the Section A perp prices supplied below for entry/SL/TP — no spot prices are provided. If an asset is not in Section A it has no Hyperliquid perp; do NOT suggest it. Include leverage. Tight SL. Reference funding/OI/liquidation in thesis.`
        : marketTypeFilter === "SPOT"
        ? `MARKET TYPE FILTER: SPOT ONLY. Recommend ONLY spot / cash trades. Use ONLY the Section B/C spot prices supplied below — no perp prices are provided. If an asset is not in Section B or C, do NOT suggest it. NO leverage — set leverage 1x. Wider SL acceptable. Reference accumulation/DCA logic.`
        : `MARKET TYPE FILTER: BOTH. Mix of PERP and SPOT — label every recommendation as PERP or SPOT and use the price from the matching section (PERP→A, SPOT→B/C, never mix). PERP: leverage + funding/OI rationale. SPOT: 1x, accumulation logic.`;

      // If the user asks about an asset that's been intentionally filtered out
      // (no pump/dump signal, or wrong section for the active marketType),
      // don't guess — say so plainly. This prevents the AI from inventing
      // prices for assets the snapshot deliberately omitted.
      const outOfUniverseRule = `OUT-OF-UNIVERSE QUESTIONS: If the user asks about an asset that is NOT present in the snapshot sections below, do NOT invent a price or setup. Say plainly: "[ASSET] is not in the current data feed — it's either filtered out by the active market-type filter (${marketTypeFilter}) or has no pump/dump movement right now. Switch the market-type filter or wait for a signal." Then offer to discuss assets that ARE in the snapshot.`;

      const sys = `You are CLVRQuantAI's AI Analyst for leveraged perp futures across crypto, FX, commodities, and equities. Be direct, data-driven, no fluff.

${marketTypeRule}

${outOfUniverseRule}

MANDATORY STEP 1 — MACRO PRE-FLIGHT:
${macroCtx || "No macro data. Proceed with CAUTION."}

${execContext ? execContext + "\n\n" : ""}EXECUTION CONTEXT RULE: ${execContextRule}

RULES:
1. TRADE TYPE: Classify as SCALP (1-4H), DAY TRADE (4-24H), SWING (1-7D), or POSITION (1-4W).
2. VOL REGIME: Compare ATR to 20-period avg. HIGH(>1.5x): compress TP 30%, widen SL 20%. LOW(<0.7x): skip or reduce 50%.
3. ATR-SCALED TP/SL. Min R:R to TP1: 1.2:1.
4. KILL CLOCK: SCALP=2-4H, DAY=12-24H, SWING=48-72H.
5. MACRO GATE: Block within 2H of FOMC/CPI/NFP. Dampen 20% within 4H of PPI/GDP.
6. OI OVERLAY when available. 7. EDGE LABELING. 8. POST-TP1: SL to breakeven.

OUTPUT FORMAT for signals:
[EMOJI] [ASSET]/USDT [DIRECTION] — [TRADE TYPE]
Vol Regime: [🔴/🟡/🟢] | Entry: [price] | TP1-3 | SL | R:R | Edge | Kill | Leverage
Thesis | Invalidation | Post-TP1 plan

TODAY: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} | ET: ${snap.nowET}

${snap.sections}

WRITING DISCIPLINE — applies to every signal, thesis, and prose answer:
- BANNED SUPERLATIVES: do not use "largest / biggest / highest / most / standout / exceptional / unprecedented / leading / best-in-class" without ranked-comparison data in the snapshot. Prefer "elevated / notable / positive".
- REGIME CONSISTENCY: any regime label you cite must match what the snapshot's regime context says — the user sees the same UI banner.
- SAMPLE-SIZE HONESTY: when a Statistical Brain block shows fewer than 30 resolved trades for the (token, direction) combo, write "small sample (n=X)" and never call it "statistically significant".
- FUNDING CALIBRATION: |funding| < 0.01%/8h is "near-flat" — not "trending", not "momentum confirmation".
- OI SCOPE: open-interest figures refer to that one symbol; never say "highest of any asset" without a ranked comparison.
- CHASE DISCLOSURE: a LONG entry after >+4% 24h move (or SHORT after <-4%) is a late entry / chase — say so, do not call it a "fresh breakout".
- NUMBER MATCHING: any price/%/RR/leverage in prose must match the structured fields exactly.

⚠️ AI analysis only. Always apply your own judgment and risk management.`;

      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system: sys, userMessage: userMsg }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setMessages(prev => [...prev, { role: "assistant", content: "✦ PRO FEATURE — AI Chat requires a Pro subscription." }]);
        } else if (data.error === "__MAINTENANCE__" || res.status === 503) {
          setMessages(prev => [...prev, { role: "assistant", content: "🔧 AI engine is under maintenance. Please try again shortly." }]);
        } else {
          setMessages(prev => [...prev, { role: "assistant", content: data.error || `Error ${res.status}` }]);
        }
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: data.text || "No response." }]);
        setDailyCount(c => c + 1);
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${e.message}` }]);
    }
    setLoading(false);
  };

  const handleChip = (sym) => {
    const store = storePerps[sym] || storeSpot[sym];
    const legacy = allPrices?.[sym];
    const d = store?.price ? { price: store.price, chg: store.change24h || 0 } : legacy;
    const px = store?.price > 0 ? fmtPrice(store.price, sym) : fmtPrice(d?.price, sym);
    setInput(`${sym} — long or short? Price: ${px}`);
  };

  return (
    <div data-testid="section-ask-ai" style={{ marginBottom: 24 }}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontFamily: SERIF, color: "#e0e0e0", fontWeight: 700 }}>Ask AI</h3>
        <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: MONO, marginTop: 2, letterSpacing: "0.08em" }}>
          CLVR AI · CLAUDE SONNET · {dailyCount}/{dailyLimit} TODAY
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {["PERP", "SPOT", "BOTH"].map(m => {
          const col = m === "PERP" ? "#00d4ff" : m === "SPOT" ? "#a855f7" : "#e8c96d";
          const sel = marketTypeFilter === m;
          return (
            <button
              key={m}
              data-testid={`btn-aichat-mkt-${m}`}
              onClick={() => setMarketTypeFilter(m)}
              style={{
                padding: "4px 10px", borderRadius: 5,
                border: `1px solid ${sel ? col : "rgba(255,255,255,0.08)"}`,
                background: sel ? `${col}18` : "transparent",
                color: sel ? col : "rgba(255,255,255,0.4)",
                fontFamily: MONO, fontSize: 8, cursor: "pointer", fontWeight: sel ? 700 : 400,
                letterSpacing: "0.08em",
              }}
            >{m}</button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
        {QUICK_CHIPS.map(sym => (
          <button key={sym} data-testid={`chat-chip-${sym}`} onClick={() => handleChip(sym)} style={{
            padding: "4px 10px", borderRadius: 5,
            border: "1px solid rgba(201,168,76,0.2)", background: "#0c1220",
            color: "rgba(255,255,255,0.5)", fontFamily: MONO, fontSize: 9, cursor: "pointer",
          }}>{sym}</button>
        ))}
      </div>

      {messages.length > 0 && (
        <div ref={scrollRef} style={{
          background: "#0c1220", border: "1px solid rgba(201,168,76,0.1)", borderRadius: 10,
          padding: 14, marginBottom: 12, maxHeight: 400, overflowY: "auto",
          WebkitOverflowScrolling: "touch",
        }}>
          {messages.map((m, i) => (
            <div key={i} style={{
              marginBottom: 14, padding: "12px 14px",
              background: m.role === "user" ? "rgba(201,168,76,0.06)" : "rgba(8,12,24,0.6)",
              border: `1px solid ${m.role === "user" ? "rgba(201,168,76,0.18)" : "rgba(201,168,76,0.08)"}`,
              borderRadius: 10,
            }}>
              <div style={{
                fontSize: 8, color: m.role === "user" ? "#c9a84c" : "#22c55e",
                fontFamily: MONO, letterSpacing: "0.14em", marginBottom: 8, fontWeight: 700,
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: m.role === "user" ? "#c9a84c" : "#22c55e", display: "inline-block" }} />
                {m.role === "user" ? "YOU" : "CLVR AI ANALYST"}
              </div>
              {m.role === "user" ? (
                <div style={{ fontSize: 12, color: "#e6e9ef", fontFamily: SANS, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {m.content}
                </div>
              ) : (
                <FormattedAIMessage text={m.content} />
              )}
            </div>
          ))}
          {loading && (
            <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.02)", borderRadius: 8 }}>
              <div style={{ fontSize: 7, color: "#22c55e", fontFamily: MONO, letterSpacing: "0.1em", marginBottom: 4 }}>CLVR AI</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: MONO }}>Analyzing...</div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          data-testid="input-ai-chat"
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && sendMessage()}
          placeholder={atLimit ? "Daily limit reached" : '"Long BTC now?" · "Is XAU overextended?"'}
          disabled={atLimit}
          style={{
            flex: 1, background: "#0c1220", border: "1px solid rgba(201,168,76,0.15)",
            borderRadius: 8, padding: "11px 14px", color: "#e0e0e0",
            fontFamily: MONO, fontSize: 11, outline: "none",
          }}
        />
        <button
          data-testid="btn-send-ai"
          onClick={sendMessage}
          disabled={loading || !input.trim() || atLimit}
          style={{
            padding: "11px 20px", borderRadius: 8,
            background: loading ? "rgba(201,168,76,0.04)" : "linear-gradient(135deg, rgba(201,168,76,0.15), rgba(201,168,76,0.08))",
            border: `1px solid ${loading ? "rgba(201,168,76,0.1)" : "rgba(201,168,76,0.3)"}`,
            color: loading ? "rgba(255,255,255,0.3)" : "#e8c96d",
            fontFamily: SERIF, fontWeight: 700, fontSize: 12, cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "..." : "Ask →"}
        </button>
      </div>
    </div>
  );
}
```

#### `client/src/components/ai/ModeToggle.jsx`
```jsx
const MONO = "'IBM Plex Mono', monospace";

export default function ModeToggle({ mode, onChange, isPro }) {
  if (!isPro) return null;

  return (
    <div style={{ display: "flex", background: "#0c1220", border: "1px solid rgba(201,168,76,0.15)", borderRadius: 8, overflow: "hidden" }}>
      <button
        data-testid="btn-mode-simple"
        onClick={() => onChange("simple")}
        style={{
          flex: 1, padding: "8px 16px", background: mode === "simple" ? "rgba(201,168,76,0.12)" : "transparent",
          border: "none", borderRight: "1px solid rgba(201,168,76,0.15)",
          color: mode === "simple" ? "#e8c96d" : "rgba(255,255,255,0.4)",
          fontFamily: MONO, fontSize: 10, fontWeight: mode === "simple" ? 700 : 400,
          letterSpacing: "0.08em", cursor: "pointer", transition: "all 0.2s",
        }}
      >
        Simple
      </button>
      <button
        data-testid="btn-mode-pro"
        onClick={() => onChange("pro")}
        style={{
          flex: 1, padding: "8px 16px", background: mode === "pro" ? "rgba(201,168,76,0.12)" : "transparent",
          border: "none",
          color: mode === "pro" ? "#e8c96d" : "rgba(255,255,255,0.4)",
          fontFamily: MONO, fontSize: 10, fontWeight: mode === "pro" ? 700 : 400,
          letterSpacing: "0.08em", cursor: "pointer", transition: "all 0.2s",
        }}
      >
        Pro
      </button>
    </div>
  );
}
```

#### `client/src/components/ai/MacroPreFlight.jsx`
```jsx
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'Barlow', system-ui, sans-serif";

const STATUS_COLORS = {
  CLEAR: { bg: "rgba(0,199,135,0.06)", border: "rgba(0,199,135,0.2)", icon: "✅", color: "#00c787", label: "MACRO CLEAR" },
  CAUTION: { bg: "rgba(255,140,0,0.06)", border: "rgba(255,140,0,0.2)", icon: "⚠️", color: "#ff8c00", label: "MACRO CAUTION" },
  BLOCKED: { bg: "rgba(255,68,68,0.06)", border: "rgba(255,68,68,0.2)", icon: "🚫", color: "#ff4444", label: "MACRO BLOCKED" },
};

export default function MacroPreFlight({ data, loading }) {
  if (loading) {
    return (
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(201,168,76,0.1)", borderRadius: 8, padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12 }}>📡</span>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: MONO }}>Checking macro conditions...</span>
      </div>
    );
  }

  if (!data) return null;

  const cfg = STATUS_COLORS[data.status] || STATUS_COLORS.CLEAR;
  const checkedTime = data.timestamp ? new Date(data.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York", hour12: true }) + " ET" : "";

  return (
    <div data-testid="macro-preflight-bar" style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: data.breakingNews?.length > 0 || data.eventsNext2H?.length > 0 || data.eventsNext4H?.length > 0 ? 8 : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12 }}>📡</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: cfg.color, fontFamily: MONO, letterSpacing: "0.06em" }}>{cfg.label}</span>
        </div>
        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: MONO }}>Checked {checkedTime}</span>
      </div>

      {data.eventsNext2H?.filter(e => e.status === "UPCOMING").length > 0 && (
        <div style={{ marginBottom: 4 }}>
          {data.eventsNext2H.filter(e => e.status === "UPCOMING").map((e, i) => (
            <div key={i} style={{ fontSize: 9, color: "#ff4444", fontFamily: SANS, lineHeight: 1.6 }}>
              {cfg.icon} {e.impact === "HIGH" ? "🔴" : "🟡"} {e.event} at {e.time} — {e.impact} impact
            </div>
          ))}
        </div>
      )}

      {data.eventsNext4H?.filter(e => e.status === "UPCOMING").length > 0 && (
        <div style={{ marginBottom: 4 }}>
          {data.eventsNext4H.filter(e => e.status === "UPCOMING").map((e, i) => (
            <div key={i} style={{ fontSize: 9, color: "#ff8c00", fontFamily: SANS, lineHeight: 1.6 }}>
              ⚠️ {e.event} at {e.time} — {e.impact}
            </div>
          ))}
        </div>
      )}

      {data.eventsNext24H?.length > 0 && data.eventsNext2H?.filter(e => e.status === "UPCOMING").length === 0 && (
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: SANS, lineHeight: 1.6 }}>
          Next event: {data.eventsNext24H[0].event} at {data.eventsNext24H[0].time} {data.eventsNext24H[0].date}
        </div>
      )}

      {data.breakingNews?.length > 0 && data.breakingNews.map((n, i) => (
        <div key={i} style={{ fontSize: 9, color: "#ff4444", fontFamily: SANS, lineHeight: 1.6, marginTop: 2 }}>
          🔴 Breaking: {n.headline}{n.affectedAssets?.length > 0 ? ` → Affects: ${n.affectedAssets.join(", ")}` : ""}
        </div>
      ))}
    </div>
  );
}
```

---

## 5. Chart AI

**Endpoints:** `POST /api/chart-ai/analyze` + `GET /api/chart-ai/usage` · **Client:** `ChartAITab.jsx`

#### Backend: POST /api/chart-ai/analyze — `server/routes.ts` (lines 3956–4466)
```ts
    app.post("/api/chart-ai/analyze", (req: any, res: any) => {
      chartAiUpload(req, res, async (uploadErr: any) => {
        try {
          if (uploadErr) {
            const msg = uploadErr.code === "LIMIT_FILE_SIZE"
              ? "Image must be ≤ 5 MB"
              : "Image upload failed";
            return res.status(400).json({ error: msg });
          }

          // Auth + Elite gate (matches existing requireElite pattern)
          const userId = await requireElite(req, res);
          if (!userId) return;

          // Monthly kill switch
          const month = utcMonthStr();
          const spendRow = await pool.query(
            "SELECT total_spend, alert_sent_at FROM chart_ai_monthly_spend WHERE month = $1",
            [month],
          );
          const totalSpend = parseFloat(spendRow.rows[0]?.total_spend ?? "0");
          if (totalSpend >= CHART_AI_MONTHLY_BUDGET) {
            return res.status(503).json({ error: "service_temporarily_paused" });
          }

          // Validate inputs
          const horizon = String(req.body.horizon || "").toLowerCase();
          if (!["scalp", "intraday", "swing", "position"].includes(horizon)) {
            return res.status(400).json({ error: "Invalid horizon. Use scalp | intraday | swing | position." });
          }
          const asset = req.body.asset ? String(req.body.asset).slice(0, 32).trim() : null;
          const file = req.file;
          if (!file) return res.status(400).json({ error: "image is required" });
          const allowedMime = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
          const mime = (file.mimetype || "").toLowerCase();
          if (!allowedMime.includes(mime)) {
            return res.status(400).json({ error: "image must be PNG, JPG, or WebP" });
          }

          // Daily limit (UTC)
          const today = utcDateStr();
          const usageRow = await pool.query(
            "SELECT count FROM chart_ai_usage WHERE user_id = $1 AND date = $2",
            [userId, today],
          );
          const usedToday = usageRow.rows[0]?.count ?? 0;
          if (usedToday >= CHART_AI_DAILY_LIMIT) {
            return res.status(429).json({
              error: "daily_limit_reached",
              remaining: 0,
              resets_at: nextUtcMidnight(),
            });
          }

          // Resize image to max 1600px wide using sharp
          let resized: Buffer;
          let resizedMime = "image/jpeg";
          try {
            resized = await sharpLib(file.buffer)
              .rotate()
              .resize({ width: 1600, withoutEnlargement: true })
              .jpeg({ quality: 88 })
              .toBuffer();
          } catch (e: any) {
            console.error("[chart-ai] sharp resize failed:", e?.message);
            return res.status(400).json({ error: "Could not process image. Try a different file." });
          }
          const imageHash = cryptoCreateHash("sha256").update(resized).digest("hex");
          const imageBase64 = resized.toString("base64");

          // News cache per asset (15 min)
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (!apiKey) return res.status(503).json({ error: "AI temporarily unavailable" });

          const cacheBucket = Math.floor(Date.now() / CHART_AI_NEWS_TTL_MS);
          const newsCacheKey = `chart_ai_news:${asset || "_"}:${cacheBucket}`;
          const cachedNews = chartAiNewsCache.get(newsCacheKey);

          // Pull recent in-app news headlines (CLVRQuant feed) for the model
          let inAppNewsBlock = "";
          try {
            const newsCached = (cache as any)?.["news"];
            const items: any[] = Array.isArray(newsCached?.data?.items) ? newsCached.data.items
                              : Array.isArray(newsCached?.data) ? newsCached.data : [];
            if (items.length) {
              const upperAsset = (asset || "").toUpperCase();
              const matchA = (h: any) => {
                if (!upperAsset) return true;
                const t = String(h.title || "").toUpperCase();
                if (t.includes(upperAsset)) return true;
                const arr = Array.isArray(h.assets) ? h.assets.map((s: any) => String(s).toUpperCase()) : [];
                return arr.includes(upperAsset);
              };
              const picked = items.filter(matchA).slice(0, 8);
              const finalList = (picked.length ? picked : items.slice(0, 6))
                .map((h: any) => `• ${String(h.title || "").slice(0, 160)}${h.source ? `  (${h.source})` : ""}`)
                .join("\n");
              if (finalList) {
                inAppNewsBlock = `\n\nIN-APP NEWS FEED (CLVRQuant aggregated, freshest first${asset ? ` — filtered for ${asset}` : ""}):\n${finalList}\n`;
              }
            }
          } catch (e: any) {
            console.error("[chart-ai] in-app news inject failed:", e?.message);
          }

          // Build system prompt
          const nowIso = new Date().toISOString();
          const assetLabel = asset || "DETECT FROM CHART (look at title bar, ticker label, exchange watermark, axis annotations)";
          const cachedNewsBlock = cachedNews
            ? `\n\nFRESH WEB NEWS CONTEXT (cached, last 15 min — do NOT re-search):\n${cachedNews.newsContext}\n`
            : "";

          // ── Execution context block (VWAP + Opening Range) ─────────────
          // Computed only when the user supplied an asset AND it is a spot
          // equity / spot FX / spot commodity. Crypto and perps return null
          // here so the prompt remains silent on session-structure levels
          // for them.
          let execContextBlock = "";
          let execEligibleNote = "";
          if (asset) {
            try {
              const { isExecutionOverlayEligible } = await import("./lib/executionOverlay");
              if (isExecutionOverlayEligible(asset)) {
                const { computeExecutionLevels, formatExecutionContextBlock } = await import("./lib/executionLevels");
                const lvl = await computeExecutionLevels(asset);
                if (lvl) {
                  execContextBlock = "\n\n" + formatExecutionContextBlock(lvl) + "\n";
                  execEligibleNote = `When the EXECUTION CONTEXT block is present above, reference VWAP and opening range levels in your "reasoning" tape-read. If absent, do not mention these levels — the asset is not eligible for intraday session structure analysis.`;
                }
              }
            } catch (e: any) {
              console.error("[chart-ai] exec levels inject failed:", e?.message);
            }
          }

          const system = `You are an elite quantitative technical analyst for CLVRQuantAI. Analyze the attached chart and return ONLY a JSON object — no prose, no markdown fences, no explanation outside the JSON.

Context:
- Trading horizon: ${horizon}
- Asset (user-provided): ${assetLabel}
- Current UTC time: ${nowIso}${cachedNewsBlock}${inAppNewsBlock}${execContextBlock}${execEligibleNote ? "\n\n" + execEligibleNote : ""}

═══ MANDATORY ANALYSIS CHECKLIST — complete EVERY step before deciding ═══

Step 1 — IDENTIFY THE ASSET. Look at the chart for ticker text, exchange logo (Binance/Bybit/TradingView/MT4/etc.), watermarks, pair labels (e.g. "BTCUSDT", "EUR/USD", "AAPL", "XAUUSD"), and the price axis magnitude. Set "detected_asset" to what you see (ticker symbol). If the user provided an asset above and the chart agrees, use the user's value. If you genuinely cannot tell, set "detected_asset": "unknown".

Step 2 — READ PRICE STRUCTURE. Identify: current price, recent swing highs/lows, trend direction (HH/HL or LH/LL), key horizontal support & resistance, any visible trendlines, breakouts, fakeouts, liquidity sweeps, and the timeframe shown (e.g. 1m/5m/1h/4h/1D).

Step 3 — TECHNICAL INDICATORS. From what is visible on the chart, evaluate ALL of:
  • Moving averages (EMA/SMA crossovers, slope, price-to-MA distance)
  • RSI (overbought >70, oversold <30, divergence with price)
  • MACD (histogram direction, signal-line cross, zero-line position)
  • Volume (climactic, fading, divergence with price)
  • Bollinger Bands / volatility (squeeze, expansion, band ride)
  • Any other indicators visible (Stoch RSI, ATR, OBV, VWAP, Ichimoku, etc.)
If an indicator is NOT visible on the chart, infer the likely state from price action alone — do not invent a reading.

Step 4 — NEWS + CATALYST CHECK.
  ${cachedNews ? "Use the FRESH WEB NEWS CONTEXT above (already cached) and the IN-APP NEWS FEED above. DO NOT re-run web search."
              : "Use web search 1–2 times to check headlines, macro events, earnings, regulatory news, or on-chain catalysts in the last 24h for this asset. ALSO incorporate the IN-APP NEWS FEED above."}
Cross-reference: does news flow agree with the technical setup? Is there an event-risk window (FOMC, CPI, earnings) inside the trade horizon?

Step 5 — CONFLUENCE SCORING. A high-confidence (>70) call requires confluence across: structure + at least 2 indicators + news/catalyst alignment. If conflicting signals dominate, return "no_trade".

Step 6 — RISK CALIBRATION (use the actual price level visible — never invent levels):
  • scalp (1–15min): stops 0.3–0.8%, TPs at 1R, 2R, 3R
  • intraday (hours): stops 0.8–2%, targets at prior day H/L or intraday key levels
  • swing (days–weeks): stops 3–8%, targets at weekly S/R
  • position (weeks–months): stops 8–20%, targets at monthly/quarterly structure

Step 7 — NO-TRADE RULE. If the chart is unreadable, ambiguous, mid-range chop, or fights the news flow, return "direction": "no_trade". A "no_trade" is better than a forced trade.

═══ RETURN THIS SCHEMA EXACTLY (JSON ONLY, no prose) ═══
{
  "detected_asset": "<ticker as seen on chart, e.g. BTCUSDT | EURUSD | AAPL | XAUUSD | unknown>",
  "timeframe": "<e.g. 5m | 1h | 4h | 1D | unknown>",
  "direction": "long" | "short" | "no_trade",
  "confidence": <0-100>,
  "entry": { "price": <number>, "type": "market" | "limit" | "breakout" },
  "entry_zone": { "low": <number>, "high": <number> },
  "stop_loss": <number>,
  "take_profits": [
    { "level": 1, "price": <number> },
    { "level": 2, "price": <number> },
    { "level": 3, "price": <number> }
  ],
  "rr_tp1": <number>,
  "rr_tp2": <number>,
  "risk_reward": <number>,
  "time_horizon_minutes": <integer>,
  "hard_exit_timer_minutes": <integer>,
  "indicators": {
    "trend": "<bullish|bearish|sideways + brief structure note>",
    "rsi": "<reading or 'not visible — inferred X from price action'>",
    "macd": "<reading or inference>",
    "moving_averages": "<EMA/SMA observation>",
    "volume": "<observation>",
    "other": "<any other visible indicator notes, or empty string>"
  },
  "reasoning": "<=3 sentences tying structure + indicators + news into the call",
  "key_levels": { "support": [<numbers>], "resistance": [<numbers>] },
  "invalidation": "what price action would void this setup",
  "news_context": "<=1 sentence summarizing relevant news found, or 'no material catalysts'",
  "warnings": ["low volume" | "news risk" | "choppy" | "overextended" | "event window" | etc.]
}

═══ WRITING DISCIPLINE for the "reasoning" field ═══
- BANNED SUPERLATIVES: do not use "largest / biggest / highest / most / standout / exceptional / unprecedented / leading / best-in-class" unless the chart visibly shows ranked context. Prefer "elevated / notable / positive".
- SAMPLE-SIZE HONESTY: if you cite a backtest or pattern frequency, never call <30 occurrences "statistically significant".
- NO FORCED CONFLUENCE: if structure + indicators + news do not actually agree, say so and lean toward "no_trade" rather than inventing alignment.
- NUMBER MATCHING: any price/RR/% mentioned in "reasoning" must match the entry/stop_loss/take_profits values you returned above.
- CHASE DISCLOSURE: a long entry near a recent fresh swing high after a big move is a chase — call it that, do not call it a "breakout" without explicit breakout structure.
- FUNDING / OI mentions only when visible on the chart (rare).`;

          const messages = [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: resizedMime, data: imageBase64 } },
              { type: "text", text: `Analyze this chart for a ${horizon} trade${asset ? ` on ${asset}` : ""}. Return JSON only.` },
            ],
          }];

          const body: any = {
            model: CLAUDE_MODEL,
            max_tokens: 2000,
            system,
            messages,
          };
          if (!cachedNews) {
            body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }];
          }

          const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "anthropic-version": "2023-06-01",
              "x-api-key": apiKey,
            },
            body: JSON.stringify(body),
          });

          if (!aiRes.ok) {
            const errText = await aiRes.text().catch(() => "");
            if (errText.includes("credit_balance") || aiRes.status === 529) {
              return res.status(503).json({ error: "service_temporarily_paused" });
            }
            console.error("[chart-ai] anthropic err:", aiRes.status, errText.slice(0, 300));
            return res.status(502).json({ error: "AI analysis failed. Try again." });
          }
          const data: any = await aiRes.json();

          // Extract text content (skip tool_use / web_search_tool_result blocks)
          let raw = "";
          if (Array.isArray(data.content)) {
            for (const block of data.content) {
              if (block.type === "text" && typeof block.text === "string") raw += block.text;
            }
          }
          // Strip optional fences
          raw = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

          let analysis: any;
          try {
            analysis = JSON.parse(raw);
          } catch {
            // Try to extract first {...} block
            const m = raw.match(/\{[\s\S]*\}/);
            if (!m) {
              console.error("[chart-ai] parse fail, raw:", raw.slice(0, 500));
              return res.status(502).json({ error: "AI returned malformed response. Try again." });
            }
            try { analysis = JSON.parse(m[0]); }
            catch { return res.status(502).json({ error: "AI returned malformed response. Try again." }); }
          }

          // Schema sanity
          const validDirs = ["long", "short", "no_trade"];
          if (!analysis || typeof analysis !== "object" || !validDirs.includes(analysis.direction)) {
            return res.status(502).json({ error: "AI response failed validation. Try again." });
          }

          // ── Empirical confidence warning (June 2026) ─────────────────────────
          // Scanner study shows confidence >50 has historically been unreliable.
          // Keep the plan (user's choice) but surface a caution; nothing dropped.
          try {
            const { chartAiConfidenceWarningEnabled } = await import("./lib/featureFlags");
            const { parseConfidencePct } = await import("./lib/empiricalFilters");
            const confPct = parseConfidencePct(analysis.confidence);
            if (chartAiConfidenceWarningEnabled() && Number.isFinite(confPct) && confPct > 50) {
              if (!Array.isArray(analysis.warnings)) analysis.warnings = [];
              analysis.warnings.push("High-confidence calls (>50%) have historically been less reliable in our data — size conservatively and confirm with structure.");
              analysis.high_confidence_caution = true;
            }
          } catch { /* non-fatal — never block the analysis on the warning */ }

          // ── PROMPT_V2 shadow run (fire-and-forget) ─────────────────────────
          if (getPromptV2Mode() !== "off") {
            void (async () => {
              try {
                const { runChartAIv2 } = await import("./lib/promptV2Runner");
                const perfCtxAsset = await buildPerformanceContext().catch(() => "");
                await runChartAIv2({
                  asset: asset || "UNKNOWN",
                  perfContextForAsset: perfCtxAsset,
                  liveData: { price: 0, range24hLow: 0, range24hHigh: 0, keyStructure: "from-image" },
                  killSwitches: [],
                  userQuestion: `Analyze chart for ${horizon} trade${asset ? " on " + asset : ""}.`,
                }, apiKey, JSON.stringify(analysis).slice(0, 500));
              } catch (e: any) { console.warn("[PROMPT_V2 chartAI shadow]", e?.message || e); }
            })();
          }

          // Cache the news_context for this asset (only if we ran a search this call)
          if (!cachedNews && analysis.news_context && asset) {
            chartAiNewsCache.set(newsCacheKey, { newsContext: String(analysis.news_context), ts: Date.now() });
          }

          // Persist analysis + bump counters (best-effort, don't fail the response on log errors)
          try {
            await pool.query(
              `INSERT INTO chart_ai_analyses (user_id, horizon, asset, image_hash, response_json, cost_estimate)
               VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
              [userId, horizon, asset, imageHash, JSON.stringify(analysis), CHART_AI_COST_PER_CALL],
            );
            await pool.query(
              `INSERT INTO chart_ai_usage (user_id, date, count)
               VALUES ($1, $2, 1)
               ON CONFLICT (user_id, date) DO UPDATE SET count = chart_ai_usage.count + 1`,
              [userId, today],
            );
            const updSpend = await pool.query(
              `INSERT INTO chart_ai_monthly_spend (month, total_spend) VALUES ($1, $2)
               ON CONFLICT (month) DO UPDATE SET total_spend = chart_ai_monthly_spend.total_spend + EXCLUDED.total_spend
               RETURNING total_spend, alert_sent_at`,
              [month, CHART_AI_COST_PER_CALL],
            );
            const newSpend = parseFloat(updSpend.rows[0]?.total_spend ?? "0");
            const alertSent = updSpend.rows[0]?.alert_sent_at;
            if (newSpend >= CHART_AI_ALERT_THRESHOLD && !alertSent) {
              await pool.query(
                "UPDATE chart_ai_monthly_spend SET alert_sent_at = NOW() WHERE month = $1",
                [month],
              );
              try {
                const resend = await getUncachableResendClient().catch(() => null);
                if (resend) {
                  await resend.client.emails.send({
                    from: "CLVRQuantAI Alerts <alerts@clvrquantai.com>",
                    to: OWNER_EMAIL,
                    subject: `[Chart AI] Spend $${newSpend.toFixed(2)} crossed $${CHART_AI_ALERT_THRESHOLD} threshold`,
                    text: `Chart AI monthly spend for ${month} has crossed the $${CHART_AI_ALERT_THRESHOLD} alert threshold.\n\nCurrent: $${newSpend.toFixed(2)} / $${CHART_AI_MONTHLY_BUDGET} kill switch.\n\nThe service will auto-pause when spend reaches $${CHART_AI_MONTHLY_BUDGET}.`,
                  });
                  console.log(`[chart-ai] sent owner alert at $${newSpend.toFixed(2)} spend`);
                }
              } catch (e: any) {
                console.error("[chart-ai] alert email failed:", e?.message);
              }
            }
          } catch (e: any) {
            console.error("[chart-ai] persist failed:", e?.message);
          }

          // ── Persist structured plan + seed outcome row (best-effort) ──────
          // Writes a richer, ML-ready row into chartai_plans alongside the
          // existing chart_ai_analyses log. Stamped with schema/framework
          // version so downstream analytics can segment by contract.
          // Errors are swallowed — never fail the user's response on this.
          let chartAIRequestId: string | null = null;
          try {
            const { randomBytes } = await import("crypto");
            chartAIRequestId = randomBytes(6).toString("hex");

            const tickerRaw =
              String(analysis?.detected_asset ?? asset ?? "").trim().slice(0, 32) || "UNKNOWN";
            const ticker = tickerRaw.toUpperCase();

            // Lightweight asset-class heuristic (best-effort; default unknown)
            const assetClass = (() => {
              const t = ticker;
              if (/^(BTC|ETH|SOL|XRP|DOGE|ADA|BNB|AVAX|MATIC|DOT|LINK)/.test(t) || /USDT$|USDC$|PERP$/.test(t)) return "perp";
              if (/^(EUR|GBP|USD|JPY|AUD|NZD|CAD|CHF)(EUR|GBP|USD|JPY|AUD|NZD|CAD|CHF)$/.test(t.replace(/[/]/g, ""))) return "fx";
              if (/^(XAU|XAG|CL|GC|NG|SI|HG|PL|PA|ZC|ZW|ZS|BZ)/.test(t)) return "commodity";
              if (/^[A-Z.]{1,5}$/.test(t)) return "equity";
              return "unknown";
            })();

            const dirRaw = String(analysis?.direction ?? "").toLowerCase();
            const direction = ["long", "short", "no_trade"].includes(dirRaw) ? dirRaw : null;

            // Entry zone with fallback to ±0.1% band around single entry price.
            let entryLow: number | null = null;
            let entryHigh: number | null = null;
            const ez = analysis?.entry_zone;
            if (ez && Number.isFinite(Number(ez.low)) && Number.isFinite(Number(ez.high))) {
              entryLow = Math.min(Number(ez.low), Number(ez.high));
              entryHigh = Math.max(Number(ez.low), Number(ez.high));
            } else if (analysis?.entry?.price != null && Number.isFinite(Number(analysis.entry.price))) {
              const p = Number(analysis.entry.price);
              const band = Math.abs(p) * 0.001;
              entryLow = p - band;
              entryHigh = p + band;
            }

            const num = (v: any): number | null => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
            const stopLoss = num(analysis?.stop_loss);
            const tps: any[] = Array.isArray(analysis?.take_profits) ? analysis.take_profits : [];
            const tp1 = num(tps[0]?.price);
            const tp2 = num(tps[1]?.price);
            const rrTp1 = num(analysis?.rr_tp1);
            const rrTp2 = num(analysis?.rr_tp2);
            const horizonMin = num(analysis?.time_horizon_minutes);
            const hardExitMin = num(analysis?.hard_exit_timer_minutes);
            const conviction = num(analysis?.confidence);

            const snapshot = {
              horizon,
              asset,
              image_hash: imageHash,
              cached_news: !!cachedNews,
              detected_asset: analysis?.detected_asset ?? null,
              timeframe: analysis?.timeframe ?? null,
              indicators: analysis?.indicators ?? null,
              key_levels: analysis?.key_levels ?? null,
              news_context: analysis?.news_context ?? null,
              risk_reward: analysis?.risk_reward ?? null,
              warnings: analysis?.warnings ?? null,
            };

            // Atomic: plan + outcome must succeed together. Without a TX, a
            // second-insert failure would leave an orphan plan with no
            // outcome row — the resolver would never pick it up and the row
            // would be invisible to the perf views (since they JOIN on both).
            const actionable =
              direction === "long" || direction === "short";
            const tradeable = actionable
              && entryLow != null && entryHigh != null && stopLoss != null;

            const client = await pool.connect();
            try {
              await client.query("BEGIN");
              await client.query(
                `INSERT INTO chartai_plans (
                  request_id, user_id, ticker, asset_class, direction,
                  entry_low, entry_high, stop_loss, take_profit_1, take_profit_2,
                  rr_tp1, rr_tp2, time_horizon_min, hard_exit_timer_min,
                  conviction, invalidation, rationale, snapshot, model,
                  chart_image_attached, schema_version, framework_version
                ) VALUES (
                  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                  $11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21,$22
                )`,
                [
                  chartAIRequestId, userId, ticker, assetClass, direction,
                  entryLow, entryHigh, stopLoss, tp1, tp2,
                  rrTp1, rrTp2,
                  horizonMin != null ? Math.floor(horizonMin) : null,
                  hardExitMin != null ? Math.floor(hardExitMin) : null,
                  conviction != null ? Math.floor(conviction) : null,
                  analysis?.invalidation ?? null,
                  analysis?.reasoning ?? null,
                  JSON.stringify(snapshot),
                  CLAUDE_MODEL,
                  true,
                  CHARTAI_SCHEMA_VERSION,
                  CHARTAI_FRAMEWORK_VERSION,
                ],
              );
              // Seed outcome row only for actionable plans (real direction +
              // bounded entry zone + stop). no_trade and refusals get a plan
              // row (for ML) but no outcome to track.
              if (tradeable) {
                await client.query(
                  `INSERT INTO chartai_outcomes (request_id, status) VALUES ($1, 'open')`,
                  [chartAIRequestId],
                );
              }
              await client.query("COMMIT");
            } catch (txErr) {
              await client.query("ROLLBACK").catch(() => {});
              throw txErr;
            } finally {
              client.release();
            }
          } catch (e: any) {
            // Loud log so missed plans are visible in production monitoring.
            // Persistence is intentionally best-effort: the analysis was
            // returned successfully and we won't punish the user for a DB
            // hiccup, but every miss is a gap in the ML dataset.
            console.error(
              "[chart-ai] PLAN_PERSIST_FAILED user=%s ticker=%s err=%s",
              userId, asset || "?", e?.message,
            );
            chartAIRequestId = null;
          }

          const newCount = usedToday + 1;
          return res.json({
            analysis,
            request_id: chartAIRequestId,
            remaining_today: Math.max(0, CHART_AI_DAILY_LIMIT - newCount),
            resets_at: nextUtcMidnight(),
          });
        } catch (e: any) {
          console.error("[chart-ai] unexpected:", e?.message, e?.stack?.slice(0, 300));
          return res.status(500).json({ error: "Chart analysis failed. Please try again." });
        }
      });
    });

    // GET /api/chart-ai/usage — for the counter UI on the tab
```

#### Backend: GET /api/chart-ai/usage — `server/routes.ts` (lines 4467–4484)
```ts
    app.get("/api/chart-ai/usage", async (req: any, res: any) => {
      const userId = await requireElite(req, res);
      if (!userId) return;
      const today = utcDateStr();
      const r = await pool.query(
        "SELECT count FROM chart_ai_usage WHERE user_id = $1 AND date = $2",
        [userId, today],
      );
      const used = r.rows[0]?.count ?? 0;
      res.json({
        used_today: used,
        remaining_today: Math.max(0, CHART_AI_DAILY_LIMIT - used),
        daily_limit: CHART_AI_DAILY_LIMIT,
        resets_at: nextUtcMidnight(),
      });
    });
  }

```

#### `client/src/tabs/ChartAITab.jsx`
```jsx
import { useState, useRef, useCallback, useEffect } from "react";
import {
  ScanLine, Upload, X, Zap, Clock, TrendingUp, Calendar,
  Info, Share2, RotateCcw, AlertTriangle, Camera, Sparkles,
} from "lucide-react";
import LiveOverlayChart from "../components/chartai/LiveOverlayChart.jsx";

// AI provider tagline shown in the header so users know which model is
// powering the analysis (matches server-side CLAUDE_MODEL = sonnet-4-6).
const AI_PROVIDER_LABEL = "Powered by Anthropic Claude Sonnet 4.6";

// Capture an SVG element (Recharts renders ONE svg per ResponsiveContainer)
// and rasterize it to a PNG Blob. Returns null on failure so callers can
// fall back to an error message. We draw a black background first so the
// transparent recharts SVG matches the live chart's on-screen look.
async function svgElementToPngBlob(svgEl, scale = 2) {
  if (!svgEl) return null;
  try {
    const w = svgEl.clientWidth || svgEl.viewBox?.baseVal?.width || 800;
    const h = svgEl.clientHeight || svgEl.viewBox?.baseVal?.height || 320;

    // Clone + ensure xmlns so the serialized string is a standalone document
    const clone = svgEl.cloneNode(true);
    if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    if (!clone.getAttribute("width"))  clone.setAttribute("width",  String(w));
    if (!clone.getAttribute("height")) clone.setAttribute("height", String(h));

    const svgString = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width  = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((b) => resolve(b), "image/png", 0.92);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  } catch {
    return null;
  }
}

const HORIZONS = [
  { id: "scalp",    label: "Scalp",    sub: "1–15m",         Icon: Zap },
  { id: "intraday", label: "Intraday", sub: "hours",         Icon: Clock },
  { id: "swing",    label: "Swing",    sub: "days–weeks",    Icon: TrendingUp },
  { id: "position", label: "Position", sub: "weeks–months",  Icon: Calendar },
];

const LOADING_MESSAGES = [
  "Reading chart…",
  "Identifying levels…",
  "Checking news…",
  "Calibrating for {horizon}…",
];

const ACCENT = "#9b59ff";       // purple
const ACCENT_DIM = "rgba(155,89,255,0.12)";
const ACCENT_BORDER = "rgba(155,89,255,0.4)";

function fmtPrice(n) {
  if (n == null || isNaN(n)) return "—";
  const num = Number(n);
  if (Math.abs(num) >= 1000) return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(num) >= 1)    return num.toFixed(2);
  return num.toPrecision(4);
}

export default function ChartAITab({ C, MONO, SERIF, SANS, isMobile }) {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [horizon, setHorizon] = useState("intraday");
  const [asset, setAsset] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingIdx, setLoadingIdx] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [usage, setUsage] = useState({ used_today: 0, remaining_today: 5, daily_limit: 5, resets_at: null });
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  // ── Live-chart capture state ──────────────────────────────────────────────
  // We mirror LiveOverlayChart's internal sym + readiness so the "Analyze
  // this Live Chart" button knows (a) what asset to send to Claude and (b)
  // whether the chart's SVG is actually populated (skip if showing error/empty).
  const liveChartRef = useRef(null);
  const [liveSym, setLiveSym] = useState((asset || "AAPL").toUpperCase());
  const [liveReady, setLiveReady] = useState(false);
  const handleLiveSymChange = useCallback((s) => { if (s) setLiveSym(s.toUpperCase()); }, []);
  const handleLiveLevelsChange = useCallback((levels, bars) => {
    setLiveReady(!!(levels && Array.isArray(bars) && bars.length > 0));
  }, []);

  // ── Usage counter ─────────────────────────────────────────────────────────
  const refreshUsage = useCallback(async () => {
    try {
      const r = await fetch("/api/chart-ai/usage", { credentials: "include" });
      if (r.ok) setUsage(await r.json());
    } catch {}
  }, []);
  useEffect(() => { refreshUsage(); }, [refreshUsage]);

  // ── Loading-text rotator ──────────────────────────────────────────────────
  useEffect(() => {
    if (!loading) return;
    setLoadingIdx(0);
    const t = setInterval(() => setLoadingIdx(i => (i + 1) % LOADING_MESSAGES.length), 1700);
    return () => clearInterval(t);
  }, [loading]);

  // ── File handling ─────────────────────────────────────────────────────────
  const acceptFile = useCallback((f) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { setError("Image must be ≤ 5 MB"); return; }
    if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) {
      setError("Only PNG, JPG, or WebP are supported"); return;
    }
    setError("");
    setFile(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
  }, [previewUrl]);

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) acceptFile(f);
  }, [acceptFile]);

  const removeImage = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null); setPreviewUrl("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const analyze = async () => {
    if (!file) { setError("Please upload a chart image first."); return; }
    if (!horizon) { setError("Pick a trading horizon."); return; }
    setError(""); setResult(null); setLoading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      fd.append("horizon", horizon);
      if (asset.trim()) fd.append("asset", asset.trim());
      const r = await fetch("/api/chart-ai/analyze", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (data?.error === "daily_limit_reached") {
          setError(`Daily limit reached — resets at ${new Date(data.resets_at).toUTCString().split(" ").slice(1, 5).join(" ")} UTC.`);
          setUsage(u => ({ ...u, used_today: u.daily_limit, remaining_today: 0, resets_at: data.resets_at }));
        } else if (data?.error === "service_temporarily_paused") {
          setError("Chart AI is temporarily paused. Please try again later.");
        } else {
          setError(data?.error || "Analysis failed. Try again.");
        }
        return;
      }
      setResult(data.analysis);
      setUsage(u => ({
        ...u,
        used_today: u.daily_limit - (data.remaining_today ?? 0),
        remaining_today: data.remaining_today ?? Math.max(0, u.remaining_today - 1),
        resets_at: data.resets_at,
      }));
    } catch (e) {
      setError("Network error. Check connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  // Capture the LiveOverlayChart's SVG, rasterize it to a PNG Blob, and
  // send it through the same /api/chart-ai/analyze endpoint as an uploaded
  // file. No backend changes required — Claude treats it identically to a
  // user-uploaded screenshot. Auto-fills `asset` with the live symbol so
  // the prompt has the correct ticker context.
  const analyzeLiveChart = async () => {
    if (!horizon) { setError("Pick a trading horizon."); return; }
    if (!liveReady) {
      setError("Live chart isn't ready yet — wait for it to load and try again.");
      return;
    }
    const svgEl = liveChartRef.current?.querySelector?.("svg");
    if (!svgEl) {
      setError("Could not capture the live chart. Try uploading a screenshot instead.");
      return;
    }
    setError(""); setResult(null); setLoading(true);
    try {
      const blob = await svgElementToPngBlob(svgEl, 2);
      if (!blob) {
        setError("Chart capture failed. Try uploading a screenshot instead.");
        return;
      }
      // The captured PNG is of `liveSym` (the LiveOverlayChart's internal
      // selector), NOT the upload form's `asset` input. Prefer liveSym so the
      // prompt always describes the chart we actually sent. Fall back to the
      // manual `asset` only when liveSym is empty (e.g. very early mount).
      const tickerForPrompt = (liveSym || asset.trim() || "").toUpperCase();
      const fd = new FormData();
      fd.append("image", new File([blob], `live-${liveSym || "chart"}.png`, { type: "image/png" }));
      fd.append("horizon", horizon);
      if (tickerForPrompt) fd.append("asset", tickerForPrompt);
      const r = await fetch("/api/chart-ai/analyze", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (data?.error === "daily_limit_reached") {
          setError(`Daily limit reached — resets at ${new Date(data.resets_at).toUTCString().split(" ").slice(1, 5).join(" ")} UTC.`);
          setUsage(u => ({ ...u, used_today: u.daily_limit, remaining_today: 0, resets_at: data.resets_at }));
        } else if (data?.error === "service_temporarily_paused") {
          setError("Chart AI is temporarily paused. Please try again later.");
        } else {
          setError(data?.error || "Analysis failed. Try again.");
        }
        return;
      }
      setResult(data.analysis);
      setUsage(u => ({
        ...u,
        used_today: u.daily_limit - (data.remaining_today ?? 0),
        remaining_today: data.remaining_today ?? Math.max(0, u.remaining_today - 1),
        resets_at: data.resets_at,
      }));
    } catch (e) {
      setError("Network error. Check connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const analyzeAnother = () => {
    setResult(null); removeImage();
  };

  const copySummary = async () => {
    if (!result) return;
    const tps = (result.take_profits || []).map(tp => `TP${tp.level} ${fmtPrice(tp.price)}`).join(" · ");
    const txt = [
      `CLVRQuant Chart AI · ${horizon.toUpperCase()}${asset ? " · " + asset.toUpperCase() : ""}`,
      `Direction: ${String(result.direction).toUpperCase()}  (Conf ${result.confidence ?? "—"})`,
      `Entry: ${fmtPrice(result.entry?.price)} (${result.entry?.type || "market"})`,
      `Stop:  ${fmtPrice(result.stop_loss)}`,
      tps,
      `R:R ${result.risk_reward ?? "—"}`,
      result.reasoning ? `\n${result.reasoning}` : "",
    ].filter(Boolean).join("\n");
    try { await navigator.clipboard.writeText(txt); } catch {}
  };

  // ── Styles (theme-aware) ──────────────────────────────────────────────────
  const card = {
    background: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: 16,
  };
  const labelMono = {
    fontFamily: MONO, fontSize: 9, color: C.muted,
    letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600,
  };
  const btnBase = {
    minHeight: 44, padding: "10px 16px", borderRadius: 4,
    cursor: "pointer", fontFamily: MONO, fontSize: 11,
    letterSpacing: "0.08em", fontWeight: 600,
    transition: "all 0.15s",
  };

  const dirColor = result?.direction === "long"  ? "#00c787"
                 : result?.direction === "short" ? "#ff4060"
                 : "#888";
  const dirLabel = result?.direction === "long"  ? "LONG"
                 : result?.direction === "short" ? "SHORT"
                 : "NO TRADE";

  const remaining = usage.remaining_today ?? 0;
  const usedDay   = usage.used_today ?? 0;
  const limit     = usage.daily_limit ?? 5;

  return (
    <div data-testid="tab-chart-ai" style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 24 }}>
      {/* ─── Top bar ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ScanLine size={20} color={ACCENT} />
          <div>
            <div style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 22, color: C.gold2, letterSpacing: "-0.02em" }}>
              Chart AI
            </div>
            <div style={{ ...labelMono, marginTop: 2, color: C.muted2 }}>
              ELITE · UPLOAD CHART → AI TRADE PLAN
            </div>
            <div data-testid="text-ai-provider" style={{
              fontFamily: MONO, fontSize: 9, color: ACCENT,
              letterSpacing: "0.14em", textTransform: "uppercase",
              fontWeight: 600, marginTop: 3, opacity: 0.85,
              display: "flex", alignItems: "center", gap: 5,
            }}>
              <Sparkles size={10} />
              {AI_PROVIDER_LABEL}
            </div>
          </div>
          <div title={`${AI_PROVIDER_LABEL} — Upload a chart OR analyze the live execution overlay below`} style={{ display: "flex", alignItems: "center", marginLeft: 4, cursor: "help" }}>
            <Info size={14} color={C.muted} />
          </div>
        </div>
        <div data-testid="text-usage-counter" style={{ textAlign: isMobile ? "left" : "right", fontFamily: MONO, fontSize: 10, color: C.muted2, lineHeight: 1.5 }}>
          <div style={{ color: remaining === 0 ? "#ff4060" : C.gold }}>
            <strong style={{ fontSize: 13 }}>{remaining}</strong> of <strong>{limit}</strong> analyses remaining today
          </div>
          <div>Resets at 00:00 UTC</div>
        </div>
      </div>

      {/* ─── Live Execution Overlay (spot equities/FX/commodities only) ── */}
      <div ref={liveChartRef} data-testid="wrap-live-chart">
        <LiveOverlayChart
          symbol={asset || "AAPL"}
          onSymbolChange={handleLiveSymChange}
          onLevelsChange={handleLiveLevelsChange}
        />
        <button
          data-testid="btn-analyze-live-chart"
          onClick={analyzeLiveChart}
          disabled={loading || !liveReady || remaining === 0}
          style={{
            ...btnBase,
            width: "100%",
            marginTop: -6,
            marginBottom: 4,
            background: (loading || !liveReady || remaining === 0)
              ? "rgba(155,89,255,0.18)"
              : "transparent",
            color: (loading || !liveReady || remaining === 0) ? C.muted2 : ACCENT,
            border: `1px solid ${(loading || !liveReady || remaining === 0) ? "rgba(155,89,255,0.25)" : ACCENT_BORDER}`,
            fontSize: 11,
            letterSpacing: "0.12em",
            cursor: (loading || !liveReady || remaining === 0) ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
          title={!liveReady ? "Waiting for live chart data…" : `Send the live ${liveSym} chart to Claude for analysis`}
        >
          <Sparkles size={13} />
          {loading
            ? "Analyzing…"
            : remaining === 0
              ? "Daily limit reached"
              : !liveReady
                ? "Loading live chart…"
                : `Analyze Live ${liveSym} Chart`}
        </button>
      </div>

      {/* ─── Upload area ────────────────────────────────────────── */}
      <div
        data-testid="dropzone-chart"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          background: dragOver ? ACCENT_DIM : C.panel,
          border: `2px dashed ${dragOver ? ACCENT : ACCENT_BORDER}`,
          borderRadius: 8,
          padding: previewUrl ? 12 : 28,
          textAlign: "center",
          transition: "all 0.15s",
          minHeight: previewUrl ? "auto" : 180,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        }}
      >
        {previewUrl ? (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
            <img
              data-testid="img-chart-preview"
              src={previewUrl}
              alt="chart preview"
              style={{ width: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 4, background: "#000" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted }}>
                {file?.name?.slice(0, 40)} · {(file?.size / 1024).toFixed(0)} KB
              </div>
              <button
                data-testid="btn-remove-image"
                onClick={removeImage}
                style={{ ...btnBase, background: "transparent", border: `1px solid ${C.border2 || C.border}`, color: C.muted2, padding: "6px 12px", fontSize: 10, minHeight: 36 }}
              >
                <X size={12} style={{ verticalAlign: "middle", marginRight: 4 }}/>Remove
              </button>
            </div>
          </div>
        ) : (
          <>
            <Upload size={32} color={ACCENT} style={{ marginBottom: 10 }} />
            <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 6 }}>
              Drop a chart here, or
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <button
                data-testid="btn-browse-file"
                onClick={() => fileInputRef.current?.click()}
                style={{ ...btnBase, background: ACCENT, color: "#fff", border: "none" }}
              >
                Browse files
              </button>
              <button
                data-testid="btn-camera-capture"
                onClick={() => cameraInputRef.current?.click()}
                style={{ ...btnBase, background: "transparent", border: `1px solid ${ACCENT_BORDER}`, color: ACCENT }}
              >
                <Camera size={13} style={{ verticalAlign: "middle", marginRight: 5 }}/>Use camera
              </button>
            </div>
            <div style={{ fontFamily: MONO, fontSize: 9, color: C.muted, marginTop: 12, letterSpacing: "0.06em" }}>
              PNG · JPG · WebP · max 5 MB
            </div>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: "none" }}
          onChange={(e) => acceptFile(e.target.files?.[0])}
          data-testid="input-file-chart"
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => acceptFile(e.target.files?.[0])}
          data-testid="input-camera-chart"
        />
      </div>

      {/* hint */}
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted2, lineHeight: 1.6 }}>
        💡 Keep the price axis visible on the right side of the chart for best results.
      </div>

      {/* ─── Horizon selector ───────────────────────────────────── */}
      <div>
        <div style={{ ...labelMono, marginBottom: 8 }}>Horizon</div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 8 }}>
          {HORIZONS.map(h => {
            const Icon = h.Icon;
            const active = horizon === h.id;
            return (
              <button
                key={h.id}
                data-testid={`btn-horizon-${h.id}`}
                onClick={() => setHorizon(h.id)}
                style={{
                  ...btnBase,
                  background: active ? ACCENT_DIM : C.panel,
                  border: `1px solid ${active ? ACCENT : C.border}`,
                  color: active ? ACCENT : C.text,
                  borderRadius: 999,
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                  padding: "10px 8px",
                }}
              >
                <Icon size={14} />
                <div style={{ fontWeight: 700, fontSize: 11 }}>{h.label}</div>
                <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, letterSpacing: "0.06em" }}>{h.sub}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Asset (optional) ───────────────────────────────────── */}
      <div>
        <label style={{ ...labelMono, display: "block", marginBottom: 6 }}>Asset (optional)</label>
        <input
          data-testid="input-asset"
          value={asset}
          onChange={(e) => setAsset(e.target.value)}
          placeholder="e.g., BTC, EUR/USD, AAPL"
          style={{
            width: "100%", padding: "11px 12px", minHeight: 44,
            background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4,
            color: C.text, fontFamily: MONO, fontSize: 12,
            outline: "none",
          }}
        />
      </div>

      {/* ─── Analyze button ─────────────────────────────────────── */}
      <button
        data-testid="btn-analyze-chart"
        onClick={analyze}
        disabled={loading || !file || remaining === 0}
        style={{
          ...btnBase,
          width: isMobile ? "100%" : "auto",
          minWidth: isMobile ? "100%" : 240,
          alignSelf: isMobile ? "stretch" : "flex-start",
          minHeight: 48,
          padding: "14px 24px",
          background: (loading || !file || remaining === 0) ? "rgba(155,89,255,0.25)" : ACCENT,
          color: "#fff",
          border: "none",
          fontSize: 13,
          letterSpacing: "0.12em",
          opacity: (loading || !file || remaining === 0) ? 0.7 : 1,
          cursor: (loading || !file || remaining === 0) ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Analyzing…" : remaining === 0 ? "Daily limit reached" : "Analyze Chart"}
      </button>

      {/* ─── Error banner ───────────────────────────────────────── */}
      {error && (
        <div data-testid="text-chart-error" style={{
          ...card,
          borderColor: "rgba(255,64,96,.4)",
          background: "rgba(255,64,96,.08)",
          color: "#ff4060",
          fontFamily: MONO, fontSize: 11,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <AlertTriangle size={14}/> {error}
        </div>
      )}

      {/* ─── Loading skeleton ───────────────────────────────────── */}
      {loading && (
        <div data-testid="loader-chart-ai" style={{ ...card, padding: "28px 18px", textAlign: "center" }}>
          <div style={{ fontFamily: MONO, fontSize: 11, color: ACCENT, letterSpacing: "0.1em", marginBottom: 14, fontWeight: 600 }}>
            {LOADING_MESSAGES[loadingIdx].replace("{horizon}", horizon)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[80, 95, 60, 88, 70].map((w, i) => (
              <div key={i} style={{
                height: 10,
                width: `${w}%`,
                margin: "0 auto",
                background: `linear-gradient(90deg, ${C.border} 0%, ${ACCENT_DIM} 50%, ${C.border} 100%)`,
                backgroundSize: "200% 100%",
                animation: "chartai-shimmer 1.4s infinite linear",
                borderRadius: 4,
              }}/>
            ))}
          </div>
          <style>{`@keyframes chartai-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }`}</style>
        </div>
      )}

      {/* ─── Results card ───────────────────────────────────────── */}
      {result && !loading && (
        <div data-testid="card-chart-result" style={{ ...card, padding: 0, overflow: "hidden" }}>
          {/* direction + confidence */}
          <div style={{ padding: "16px 18px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div data-testid="badge-direction" style={{
                  fontFamily: SERIF, fontWeight: 900, fontSize: 26,
                  color: dirColor, letterSpacing: "0.04em",
                }}>
                  {dirLabel}
                </div>
                {(result.detected_asset || result.timeframe) && (
                  <div data-testid="text-detected-asset" style={{ fontFamily: MONO, fontSize: 10, color: C.muted2, marginTop: 4, letterSpacing: "0.08em" }}>
                    {result.detected_asset && result.detected_asset !== "unknown" && (
                      <span style={{ color: ACCENT, fontWeight: 700 }}>{String(result.detected_asset).toUpperCase()}</span>
                    )}
                    {result.detected_asset && result.detected_asset !== "unknown" && result.timeframe && result.timeframe !== "unknown" && (
                      <span style={{ color: C.muted }}> · </span>
                    )}
                    {result.timeframe && result.timeframe !== "unknown" && (
                      <span>{result.timeframe}</span>
                    )}
                    {(!result.detected_asset || result.detected_asset === "unknown") && (
                      <span style={{ color: C.muted }}>asset not detected on chart</span>
                    )}
                  </div>
                )}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, letterSpacing: "0.12em" }}>
                CONFIDENCE
                <strong data-testid="text-confidence" style={{ marginLeft: 8, color: C.text, fontSize: 13 }}>
                  {result.confidence ?? "—"}
                </strong>
              </div>
            </div>
            <div style={{
              marginTop: 10, height: 6, borderRadius: 3, background: C.bg, overflow: "hidden",
            }}>
              <div style={{
                height: "100%",
                width: `${Math.max(0, Math.min(100, Number(result.confidence) || 0))}%`,
                background: `linear-gradient(90deg, #ff4060 0%, ${ACCENT} 50%, #00c787 100%)`,
                transition: "width 0.4s",
              }}/>
            </div>
          </div>

          {/* key levels table */}
          {result.direction !== "no_trade" && (
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ ...labelMono, marginBottom: 10 }}>Key Levels</div>
              <table data-testid="table-key-levels" style={{ width: "100%", borderCollapse: "collapse", fontFamily: MONO, fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "6px 0", color: C.muted, fontWeight: 600, fontSize: 10, letterSpacing: "0.12em", borderBottom: `1px solid ${C.border}` }}>LEVEL</th>
                    <th style={{ textAlign: "right", padding: "6px 0", color: C.muted, fontWeight: 600, fontSize: 10, letterSpacing: "0.12em", borderBottom: `1px solid ${C.border}` }}>PRICE</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}`, color: C.text }}>
                      Entry <span style={{ color: C.muted, fontSize: 10 }}>({result.entry?.type || "market"})</span>
                    </td>
                    <td data-testid="text-entry-price" style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}`, color: C.text, textAlign: "right", fontWeight: 600 }}>
                      ${fmtPrice(result.entry?.price)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}`, color: "#ff4060" }}>Stop Loss</td>
                    <td data-testid="text-stop-loss" style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}`, color: "#ff4060", textAlign: "right", fontWeight: 600 }}>
                      ${fmtPrice(result.stop_loss)}
                    </td>
                  </tr>
                  {(result.take_profits || []).map(tp => (
                    <tr key={tp.level}>
                      <td style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}`, color: "#00c787" }}>TP{tp.level}</td>
                      <td data-testid={`text-tp-${tp.level}`} style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}`, color: "#00c787", textAlign: "right", fontWeight: 600 }}>
                        ${fmtPrice(tp.price)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ padding: "8px 0", color: C.muted2 }}>R:R</td>
                    <td data-testid="text-rr" style={{ padding: "8px 0", color: C.text, textAlign: "right", fontWeight: 600 }}>
                      {result.risk_reward != null ? Number(result.risk_reward).toFixed(2) : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* indicators */}
          {result.indicators && typeof result.indicators === "object" && (
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ ...labelMono, marginBottom: 8 }}>Technical Read</div>
              <div data-testid="grid-indicators" style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
                {[
                  ["Trend",     result.indicators.trend],
                  ["RSI",       result.indicators.rsi],
                  ["MACD",      result.indicators.macd],
                  ["MAs",       result.indicators.moving_averages],
                  ["Volume",    result.indicators.volume],
                  ["Other",     result.indicators.other],
                ].filter(([, v]) => v && String(v).trim()).map(([k, v]) => (
                  <div key={k} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: "8px 10px" }}>
                    <div style={{ fontFamily: MONO, fontSize: 9, color: ACCENT, letterSpacing: "0.12em", fontWeight: 600, marginBottom: 3 }}>{k.toUpperCase()}</div>
                    <div data-testid={`text-indicator-${k.toLowerCase()}`} style={{ fontFamily: MONO, fontSize: 11, color: C.text, lineHeight: 1.4 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* reasoning */}
          {result.reasoning && (
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ ...labelMono, marginBottom: 6 }}>Reasoning</div>
              <blockquote data-testid="text-reasoning" style={{
                margin: 0, padding: "10px 14px",
                borderLeft: `3px solid ${ACCENT}`,
                background: ACCENT_DIM,
                color: C.text, fontFamily: SERIF, fontSize: 14, fontStyle: "italic", lineHeight: 1.65,
              }}>
                {result.reasoning}
              </blockquote>
            </div>
          )}

          {/* news context */}
          {result.news_context && (
            <div style={{ padding: "10px 18px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ ...labelMono, marginBottom: 4 }}>News Context</div>
              <div data-testid="text-news-context" style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 12, color: C.muted2, lineHeight: 1.55 }}>
                {result.news_context}
              </div>
            </div>
          )}

          {/* warnings */}
          {Array.isArray(result.warnings) && result.warnings.length > 0 && (
            <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ ...labelMono, marginBottom: 8 }}>Warnings</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {result.warnings.map((w, i) => (
                  <span key={i} data-testid={`chip-warning-${i}`} style={{
                    background: "rgba(255,64,96,.12)",
                    border: "1px solid rgba(255,64,96,.4)",
                    color: "#ff4060",
                    fontFamily: MONO, fontSize: 10, letterSpacing: "0.06em",
                    padding: "4px 9px", borderRadius: 999, fontWeight: 600,
                    textTransform: "uppercase",
                  }}>{w}</span>
                ))}
              </div>
            </div>
          )}

          {/* invalidation */}
          {result.invalidation && (
            <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontFamily: MONO, fontSize: 11, color: C.text, lineHeight: 1.6 }}>
                <strong style={{ color: "#ff4060", letterSpacing: "0.05em" }}>Setup invalid if:</strong>{" "}
                <span data-testid="text-invalidation" style={{ color: C.muted2 }}>{result.invalidation}</span>
              </div>
            </div>
          )}

          {/* actions */}
          <div style={{ padding: "14px 18px", display: "flex", gap: 8, flexWrap: "wrap", background: C.bg }}>
            <button
              data-testid="btn-share-summary"
              onClick={copySummary}
              style={{ ...btnBase, background: "transparent", border: `1px solid ${C.border}`, color: C.text, flex: isMobile ? 1 : "0 0 auto" }}
            >
              <Share2 size={13} style={{ verticalAlign: "middle", marginRight: 6 }}/>Copy summary
            </button>
            <button
              data-testid="btn-analyze-another"
              onClick={analyzeAnother}
              style={{ ...btnBase, background: ACCENT, color: "#fff", border: "none", flex: isMobile ? 1 : "0 0 auto" }}
            >
              <RotateCcw size={13} style={{ verticalAlign: "middle", marginRight: 6 }}/>Analyze another
            </button>
          </div>

          {/* disclaimer */}
          <div style={{ padding: "10px 18px", fontFamily: MONO, fontSize: 9, color: C.muted, lineHeight: 1.6, textAlign: "center" }}>
            AI analysis for informational purposes only. Not financial advice. Past performance does not guarantee future results.
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## Shared Signal Libraries (used by Trade Ideas, Kronos, Quant)

#### `server/lib/empiricalFilters.ts`
```ts
// ── Empirical Expectancy Filters (June 2026) ────────────────────────────────
// Derived from the 1,260-resolved-signal expectancy study on `ai_signal_log`
// (2026-04-16 → 2026-06-05; see scripts/signal_backtest.cjs and
// .agents/memory/signal-expectancy-diagnostics.md). The raw scanner book is
// net-negative (profit factor ~0.74). Three leaks drive it:
//
//   1. LEVERAGE  — losses concentrate in the 3x+ tail. Cap live signals at 2x.
//   2. CONVICTION — the score INVERTS above 50 (PF ~0.40 at 50-60, ~0.13 at
//      60-80). The highest-"conviction" signals are the worst trades. Suppress
//      that tail outright (PREFERRED brain verdicts exempt — those are proven
//      edge, not unverified over-confidence).
//   3. TOKEN MIX — a small allowlist of names held positive expectancy
//      out-of-sample. SOFT gate: off-list coins still publish but their
//      displayed conviction is capped (nothing hidden, just down-weighted).
//
// An OOS-validated combination (conviction in [30,50) + 2x + allowlist) flipped
// profit factor to ~1.41 on the held-out 40% of trades.
//
// Pure module — no DB, no I/O. Every helper is flag-gated by the caller via
// server/lib/featureFlags.ts so an operator can toggle each lever independently.
//
// NOTE: POSITIVE_EXPECTANCY_TOKENS is SNAPSHOT-DERIVED and will drift as the
// book grows. It is intentionally a single editable constant — revisit it after
// re-running scripts/signal_backtest.cjs on fresh data.

/** Hard ceiling for leverage on live signals (the 3x+ tail is where losses concentrate). */
export const EMPIRICAL_LEVERAGE_CAP = 2;

/** Raw conviction at or above this is the empirically-inverted toxic tail. */
export const CONVICTION_TAIL_THRESHOLD = 50;

/** Displayed-conviction ceiling applied to off-list crypto tokens (soft gate). */
export const OFFLIST_CONVICTION_CAP = 40;

/**
 * Out-of-sample-validated positive-expectancy crypto universe. Off-list coins
 * are NOT dropped (soft gate) — only down-weighted. SNAPSHOT-DERIVED: re-derive
 * from scripts/signal_backtest.cjs as the trade book grows.
 */
export const POSITIVE_EXPECTANCY_TOKENS: ReadonlySet<string> = new Set([
  "ONDO", "HYPE", "WIF", "BTC", "ETH", "BNB", "JUP",
]);

export function isPositiveExpectancyToken(token: string): boolean {
  return POSITIVE_EXPECTANCY_TOKENS.has(String(token || "").toUpperCase().trim());
}

/**
 * Parse a confidence/conviction value to a 0..100 number, tolerating strings
 * like "55%" or "60". Returns NaN when unparseable so callers can fail open
 * (i.e. NOT suppress) rather than coerce a missing value into a false signal.
 */
export function parseConfidencePct(val: unknown): number {
  if (typeof val === "number") return Number.isFinite(val) ? val : NaN;
  const n = parseFloat(String(val ?? "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/** Parse a leverage value ("3x", "3", 3) to a positive number; defaults to 1. */
export function parseLeverageNum(lev: unknown): number {
  if (typeof lev === "number" && Number.isFinite(lev) && lev > 0) return lev;
  const n = parseFloat(String(lev ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Returns the empirical leverage ceiling to fold into existing `Math.min(...)`
 * leverage caps. Returns Infinity when disabled so callers can always write
 * `Math.min(lev, regimeCap, empiricalLeverageCeiling(enabled))`.
 */
export function empiricalLeverageCeiling(enabled: boolean): number {
  return enabled ? EMPIRICAL_LEVERAGE_CAP : Infinity;
}

/**
 * True when a signal sits in the empirically-toxic conviction tail and should
 * be dropped. PREFERRED brain verdicts (>=60% historical WR over n>=20) are
 * exempt — the inversion is a property of UNVERIFIED high conviction, not of
 * proven edge.
 */
export function isConvictionTailToxic(
  rawConviction: unknown,
  brainVerdict: string | null | undefined,
  enabled: boolean,
): boolean {
  if (!enabled) return false;
  if (brainVerdict === "PREFERRED") return false;
  const pct = parseConfidencePct(rawConviction);
  if (!Number.isFinite(pct)) return false; // fail open: don't suppress on unparseable/missing conviction
  return pct >= CONVICTION_TAIL_THRESHOLD;
}

export interface TokenSoftGateResult {
  offList: boolean;
  conviction: number; // possibly-capped, 0..100
  capped: boolean;
}

/**
 * Soft token gate: off-list CRYPTO tokens keep publishing but their displayed
 * conviction is capped to OFFLIST_CONVICTION_CAP. Non-crypto and on-list tokens
 * pass through untouched. Nothing is ever dropped here — that is the whole point
 * of the "soft" choice; the only thing that drops an off-list coin is the
 * independent conviction-tail rule (same as for any coin).
 */
export function applyTokenSoftGate(
  token: string,
  isCrypto: boolean,
  displayedConvictionPct: number,
  enabled: boolean,
): TokenSoftGateResult {
  const conv = Math.max(0, Math.min(100, Number(displayedConvictionPct) || 0));
  if (!enabled || !isCrypto || isPositiveExpectancyToken(token)) {
    return { offList: false, conviction: conv, capped: false };
  }
  const capped = conv > OFFLIST_CONVICTION_CAP;
  return { offList: true, conviction: Math.min(conv, OFFLIST_CONVICTION_CAP), capped };
}
```

#### `server/lib/signalHardening.ts`
```ts
// ============================================================================
// signalHardening — mechanical post-signal gates that protect against the
// failure modes documented in the ONDO short stop-out (tight SL inside one-
// candle noise + sitting on a visible liquidity cluster + counter to a clear
// higher-low microstructure).
//
// Five gates, applied in order:
//   1) ATR-gated SL          — SL distance must be ≥ 1.5·ATR(14)
//   2) Counter-trend micro   — −15 conviction if signal fights last-6-candle bias
//   3) Liquidity-aware SL    — shift SL beyond clusters within 0.2% of stop
//   4) Funding/OI crowded    — reject when one side is provably overcrowded
//   5) Friction-adjusted R:R — require post-cost R:R ≥ 1.8
//
// Each gate returns either ACCEPT, ADJUST (with `adjustments_applied` notes
// and possibly a sized-down position), or REJECT (with a structured reason).
// ============================================================================

import { calcATR14, detectMicrostructure, type Candle } from "../services/ta";
import { logRejection, type RejectionReason } from "./rejectionLog";

export type HoldHorizon = "scalp" | "swing";       // <4h vs ≥4h

export interface HardeningInput {
  token:           string;
  direction:       "LONG" | "SHORT";
  entry:           number;
  stopLoss:        number;
  tp1:             number;
  tp2:             number;
  conviction:      number;          // 0–100, the engine's own score
  candles:         Candle[];        // entry-timeframe OHLC, oldest → newest
  fundingRate?:    number;          // %/8h, e.g. 0.012 == +0.012%
  oiChange6hPct?:  number;          // % change in OI over last 6h
  expectedHoldHrs?: number;         // for friction calc, default = scalp/swing inferred
  holdHorizon?:    HoldHorizon;
  liquidityClusters?: Array<{ price: number; side: "LONG" | "SHORT"; notionalUsd?: number }>;
  volume24hUsd?:   number;          // for cluster-significance threshold (passed through to caller)
  source:          "auto_scanner" | "ai_signal" | "manual";
}

export interface HardeningAdjustment {
  type:    "atr_widened" | "size_reduced" | "liquidity_shifted" | "conviction_penalty";
  detail:  string;
  before?: number;
  after?:  number;
}

export type HardeningResult =
  | {
      action:        "ACCEPT";
      signal:        Pick<HardeningInput, "entry" | "stopLoss" | "tp1" | "tp2" | "conviction"> & { sizeMultiplier: number; rrAfterFriction: number };
      adjustments:   HardeningAdjustment[];
    }
  | {
      action:        "ADJUST";
      signal:        Pick<HardeningInput, "entry" | "stopLoss" | "tp1" | "tp2" | "conviction"> & { sizeMultiplier: number; rrAfterFriction: number };
      adjustments:   HardeningAdjustment[];
    }
  | {
      action:        "REJECT";
      reason:        RejectionReason;
      detail:        string;
      adjustments:   HardeningAdjustment[];
    };

// ── Tunables (centralized so they're easy to tweak in one place) ────────────
const MIN_ATR_MULTIPLE        = 1.5;
const MIN_CONFIDENCE          = 55;
const COUNTER_TREND_PENALTY   = 15;
const LIQUIDITY_PROXIMITY_PCT = 0.002;   // 0.2%
const LIQUIDITY_BUFFER_PCT    = 0.0015;  // 0.15%
const FUNDING_SHORT_THRESHOLD = -0.01;   // %/8h — shorts crowded if funding ≤ this
const FUNDING_LONG_THRESHOLD  =  0.03;   // %/8h — longs crowded if funding ≥ this
const OI_CROWDED_THRESHOLD    =  3.0;    // % growth over 6h
const SLIPPAGE_BPS            =  2;      // each side
// Lowered from 1.8 → 1.65 (Apr 2026) after rejection-log analysis showed
// the engine consistently produces post-friction R:R in the 1.60–1.72
// band; the 1.80 floor was killing ~3,000 borderline signals/day for no
// statistical benefit. 1.65 still rejects truly thin setups (< 1.5 R:R
// after costs) while letting the engine's normal output flow through.
const MIN_RR_AFTER_FRICTION   =  1.65;

// Real Coinglass heatmap is fetched by the caller (server/services/coinglass.ts);
// the gate accepts an optional cluster array so the hardening module stays
// dependency-free and unit-testable.

// ── Gate 1: ATR-gated SL ────────────────────────────────────────────────────
function gate_atr(input: HardeningInput, atr: number, adj: HardeningAdjustment[]): { stopLoss: number; sizeMultiplier: number } | { reject: { reason: RejectionReason; detail: string } } {
  const slDist = Math.abs(input.entry - input.stopLoss);
  const minDist = MIN_ATR_MULTIPLE * atr;
  if (atr <= 0) return { stopLoss: input.stopLoss, sizeMultiplier: 1 };  // no candle data → skip
  if (slDist >= minDist) return { stopLoss: input.stopLoss, sizeMultiplier: 1 };

  const horizon: HoldHorizon = input.holdHorizon || ((input.expectedHoldHrs ?? 1) >= 4 ? "swing" : "scalp");
  if (horizon === "swing") {
    return { reject: { reason: "SL_TOO_TIGHT_VS_ATR", detail: `swing signal: SL ${slDist.toFixed(6)} < 1.5·ATR ${minDist.toFixed(6)}` } };
  }
  // Scalp: widen SL to 1.5·ATR, scale size down proportionally to preserve $ risk.
  const newStop = input.direction === "LONG" ? input.entry - minDist : input.entry + minDist;
  const sizeMultiplier = slDist / minDist;
  adj.push({
    type: "atr_widened",
    detail: `ATR-adjusted SL: ${input.stopLoss.toFixed(6)} → ${newStop.toFixed(6)} (1.5·ATR floor)`,
    before: input.stopLoss, after: newStop,
  });
  adj.push({
    type: "size_reduced",
    detail: `Position size scaled to ${(sizeMultiplier * 100).toFixed(0)}% to preserve original $ risk`,
    before: 1, after: sizeMultiplier,
  });
  return { stopLoss: newStop, sizeMultiplier };
}

// ── Gate 2: Counter-trend microstructure penalty ────────────────────────────
function gate_microstructure(input: HardeningInput, conv: number, adj: HardeningAdjustment[]): { conviction: number } | { reject: { reason: RejectionReason; detail: string } } {
  const ms = detectMicrostructure(input.candles, 6);
  const fightsTrend =
    (input.direction === "SHORT" && ms.microUp) ||
    (input.direction === "LONG"  && ms.microDown);
  if (!fightsTrend) return { conviction: conv };
  const after = conv - COUNTER_TREND_PENALTY;
  adj.push({
    type: "conviction_penalty",
    detail: `Counter-trend micro (HH:${ms.hhCount} HL:${ms.hlCount} LH:${ms.lhCount} LL:${ms.llCount}) → −${COUNTER_TREND_PENALTY}`,
    before: conv, after,
  });
  if (after < MIN_CONFIDENCE) {
    return { reject: { reason: "COUNTER_TREND_MICRO", detail: `conv ${conv}→${after} < ${MIN_CONFIDENCE} after counter-trend penalty` } };
  }
  return { conviction: after };
}

// ── Gate 3: Liquidity-aware SL placement ────────────────────────────────────
function gate_liquidity(input: HardeningInput, currentStop: number, adj: HardeningAdjustment[]): { stopLoss: number } | { reject: { reason: RejectionReason; detail: string } } {
  const clusters = input.liquidityClusters || [];
  if (!clusters.length) return { stopLoss: currentStop };  // no data → no-op
  const proximity = currentStop * LIQUIDITY_PROXIMITY_PCT;
  // For SHORT, sweep side is ABOVE entry (clusters above stop are dangerous).
  // For LONG,  sweep side is BELOW entry (clusters below stop are dangerous).
  // For a LONG setup the stop sits BELOW entry; if a LONG-liquidation cluster
  // sits at/just past the stop, a flush there triggers a cascade that sweeps
  // the stop. Symmetric reasoning for SHORT (cluster of shorts above stop →
  // squeeze cascade). So the dangerous side equals the trade direction.
  const sweepSide = input.direction;
  const danger = clusters.find(c => c.side === sweepSide && Math.abs(c.price - currentStop) <= proximity);
  if (!danger) return { stopLoss: currentStop };

  const buffer = currentStop * LIQUIDITY_BUFFER_PCT;
  const newStop = input.direction === "SHORT" ? danger.price + buffer : danger.price - buffer;
  // Verify R:R hasn't collapsed (target must still be > 1× shifted SL distance).
  const newSlDist = Math.abs(input.entry - newStop);
  const tp1Dist = Math.abs(input.entry - input.tp1);
  if (newSlDist > 0 && (tp1Dist / newSlDist) < 1) {
    return { reject: { reason: "SL_IN_LIQUIDITY_POCKET", detail: `cluster at ${danger.price} blocks safe SL placement (R:R would invert)` } };
  }
  adj.push({
    type: "liquidity_shifted",
    detail: `Liquidity-shifted SL: ${currentStop.toFixed(6)} → ${newStop.toFixed(6)} (cluster @ ${danger.price})`,
    before: currentStop, after: newStop,
  });
  return { stopLoss: newStop };
}

// ── Gate 4: Funding + OI crowded ────────────────────────────────────────────
function gate_funding_oi(input: HardeningInput): { reject: { reason: RejectionReason; detail: string } } | null {
  const fr = input.fundingRate;
  const oiChg = input.oiChange6hPct;
  if (fr === undefined || oiChg === undefined) return null;     // gracefully skip when data missing
  if (input.direction === "SHORT" && fr < FUNDING_SHORT_THRESHOLD && oiChg > OI_CROWDED_THRESHOLD) {
    return { reject: { reason: "SHORTS_CROWDED", detail: `funding ${fr.toFixed(4)}%/8h, OI +${oiChg.toFixed(1)}% (squeeze risk)` } };
  }
  if (input.direction === "LONG" && fr > FUNDING_LONG_THRESHOLD && oiChg > OI_CROWDED_THRESHOLD) {
    return { reject: { reason: "LONGS_CROWDED", detail: `funding ${fr.toFixed(4)}%/8h, OI +${oiChg.toFixed(1)}% (flush risk)` } };
  }
  return null;
}

// ── Gate 5: Friction-adjusted R:R ───────────────────────────────────────────
// Returns the computed friction-adjusted R:R alongside any rejection so the
// caller can surface it on the signal card (spec requires displayed R:R to
// reflect real execution cost).
export function computeFrictionRR(input: { entry: number; stopLoss: number; tp: number; fundingRate?: number; expectedHoldHrs?: number; holdHorizon?: HoldHorizon }): number {
  const slDist = Math.abs(input.entry - input.stopLoss);
  if (slDist <= 0) return 0;
  const tpDist = Math.abs(input.entry - input.tp);
  const slipCost = input.entry * (SLIPPAGE_BPS / 10_000) * 2;
  const holdHrs  = input.expectedHoldHrs ?? (input.holdHorizon === "swing" ? 12 : 2);
  const fundingCost = input.fundingRate !== undefined ? Math.abs(input.entry * (input.fundingRate / 100) * (holdHrs / 8)) : 0;
  const adjReward = Math.max(0, tpDist - slipCost - fundingCost);
  return adjReward / slDist;
}
function gate_friction(input: HardeningInput, currentStop: number): { reject: { reason: RejectionReason; detail: string } } | null {
  const adjRR = computeFrictionRR({ entry: input.entry, stopLoss: currentStop, tp: input.tp1, fundingRate: input.fundingRate, expectedHoldHrs: input.expectedHoldHrs, holdHorizon: input.holdHorizon });
  if (adjRR > 0 && adjRR < MIN_RR_AFTER_FRICTION) {
    return { reject: { reason: "RR_TOO_LOW_AFTER_FRICTION", detail: `post-friction R:R ${adjRR.toFixed(4)} < ${MIN_RR_AFTER_FRICTION}` } };
  }
  return null;
}

// ── Statistical Brain limits gate (STRICT) ──────────────────────────────────
// Empirical floor/ceiling on TP, SL, and kill clock derived from this combo's
// historical resolved trades. Vetoes signals that violate physically-realistic
// limits the engine has demonstrated in the wild.
//
// Returns { ok: true } when the proposal is within limits or the brain has
// no data. Returns { reject } when STRICT mode trips a violation.
//
// Inputs in price units. Brain limits are in R-multiples — caller passes
// limits and we convert against the proposal's own SL distance.
// Note on minSlR: R is always 1.0 relative to the proposal's own SL by
// definition, so a minSlR floor cannot be enforced from R alone. Caller must
// translate the brain's avgLossPct into minSlPct and pass that.
export interface BrainLimitsCheck {
  entry:        number;
  stopLoss:     number;
  tp1:          number;
  killClockHrs: number;
  direction:    "LONG" | "SHORT";  // kept for log/debug context
}
export interface BrainLimitsInput {
  maxTpR?:            number;     // strict cap on TP1 R-multiple
  minSlPct?:          number;     // strict floor on SL distance as % of price
  maxKillClockHours?: number;     // strict cap on planned hold duration
}
export type BrainLimitsResult =
  | { ok: true }
  | { ok: false; reason: RejectionReason; detail: string };

export function applyBrainLimits(
  proposal: BrainLimitsCheck,
  limits:   BrainLimitsInput,
): BrainLimitsResult {
  const slDist = Math.abs(proposal.entry - proposal.stopLoss);
  if (slDist <= 0 || !Number.isFinite(slDist)) return { ok: true };  // trust earlier gates
  const tpDist = Math.abs(proposal.entry - proposal.tp1);
  const tpR    = tpDist / slDist;

  // 1) TP cap — can't exceed empirical winner reach × headroom
  if (limits.maxTpR != null && tpR > limits.maxTpR) {
    return { ok: false, reason: "TP_BEYOND_BRAIN_LIMIT" as RejectionReason,
      detail: `TP1 R=${tpR.toFixed(2)} exceeds Brain max ${limits.maxTpR.toFixed(2)}R (historical winners cap here)` };
  }

  // 2) SL distance floor — can't be tighter than empirical noise band
  if (limits.minSlPct != null) {
    const slPct = (slDist / proposal.entry) * 100;
    if (slPct < limits.minSlPct) {
      return { ok: false, reason: "SL_TIGHTER_THAN_BRAIN_LIMIT" as RejectionReason,
        detail: `SL distance ${slPct.toFixed(2)}% < Brain min ${limits.minSlPct.toFixed(2)}% (avg loser depth)` };
    }
  }

  // 3) Kill clock cap — must resolve in empirically-observed window
  if (limits.maxKillClockHours != null && proposal.killClockHrs > limits.maxKillClockHours) {
    return { ok: false, reason: "KILL_CLOCK_BEYOND_BRAIN_LIMIT" as RejectionReason,
      detail: `kill clock ${proposal.killClockHrs}h > Brain max ${limits.maxKillClockHours}h (median resolution time)` };
  }

  return { ok: true };
}

// ── Public entry point — runs all gates in order ────────────────────────────
export function applySignalHardening(input: HardeningInput): HardeningResult {
  const adjustments: HardeningAdjustment[] = [];
  let stopLoss   = input.stopLoss;
  let conviction = input.conviction;
  const sizeMultiplier = 1;

  const atr = calcATR14(input.candles);

  // Helper to consistently log + return REJECT with the proposal context so
  // the admin tuning dashboard sees the entry/SL/TP that would have shipped.
  const ctx = { proposedEntry: input.entry, proposedSl: input.stopLoss, proposedTp1: input.tp1, conviction: input.conviction };
  const reject = (reason: RejectionReason, detail: string): HardeningResult => {
    logRejection({ source: input.source, token: input.token, direction: input.direction, reason, detail }, ctx);
    return { action: "REJECT", reason, detail, adjustments };
  };

  // 1) ATR
  const r1 = gate_atr(input, atr, adjustments);
  if ("reject" in r1) return reject(r1.reject.reason, r1.reject.detail);
  stopLoss = r1.stopLoss;
  let resultSizeMul = r1.sizeMultiplier;

  // 2) Microstructure
  const r2 = gate_microstructure(input, conviction, adjustments);
  if ("reject" in r2) return reject(r2.reject.reason, r2.reject.detail);
  conviction = r2.conviction;

  // 3) Liquidity
  const r3 = gate_liquidity(input, stopLoss, adjustments);
  if ("reject" in r3) return reject(r3.reject.reason, r3.reject.detail);
  stopLoss = r3.stopLoss;

  // 4) Funding / OI
  const r4 = gate_funding_oi(input);
  if (r4) return reject(r4.reject.reason, r4.reject.detail);

  // 5) Friction-adjusted R:R (use the post-liquidity SL)
  const r5 = gate_friction({ ...input, stopLoss }, stopLoss);
  if (r5) return reject(r5.reject.reason, r5.reject.detail);

  const action = adjustments.length > 0 ? "ADJUST" : "ACCEPT";
  const rrAfterFriction = computeFrictionRR({ entry: input.entry, stopLoss, tp: input.tp1, fundingRate: input.fundingRate, expectedHoldHrs: input.expectedHoldHrs, holdHorizon: input.holdHorizon });
  return {
    action,
    signal: { entry: input.entry, stopLoss, tp1: input.tp1, tp2: input.tp2, conviction, sizeMultiplier: resultSizeMul, rrAfterFriction: +rrAfterFriction.toFixed(2) },
    adjustments,
  };
}

// ── Lightweight OI-history cache for 6h delta computation ───────────────────
// Keyed by token; stores {ts, oi} samples and exposes pctChange over a window.
// The auto-scanner ticks frequently so this stays warm without any DB hit.
const oiSamples = new Map<string, Array<{ ts: number; oi: number }>>();
const OI_TTL_MS = 7 * 60 * 60 * 1000;  // keep 7h so 6h lookback is always covered
export function recordOiSample(token: string, oi: number, now = Date.now()): void {
  if (!Number.isFinite(oi) || oi <= 0) return;
  const arr = oiSamples.get(token) || [];
  arr.push({ ts: now, oi });
  // Drop expired samples from the head (oldest first)
  const cutoff = now - OI_TTL_MS;
  while (arr.length > 0 && arr[0].ts < cutoff) arr.shift();
  oiSamples.set(token, arr);
}
export function getOiChangePct(token: string, windowMs = 6 * 60 * 60 * 1000, now = Date.now()): number | undefined {
  const arr = oiSamples.get(token);
  if (!arr || arr.length < 2) return undefined;
  const target = now - windowMs;
  // Find the sample closest to target time (binary not needed — array small)
  let baseline = arr[0];
  for (const s of arr) {
    if (s.ts <= target) baseline = s;
    else break;
  }
  // Require the baseline to actually be near the requested window (within 25%)
  const ageMs = now - baseline.ts;
  if (ageMs < windowMs * 0.75) return undefined;
  const latest = arr[arr.length - 1];
  if (baseline.oi <= 0) return undefined;
  return ((latest.oi - baseline.oi) / baseline.oi) * 100;
}

// ============================================================================
// hardenSignal — post-LLM hardening for Trade Ideas cards (separate API from
// the older applySignalHardening / quant-scanner gates above; intentionally
// kept side-by-side, no shared types). Wired from /api/ai/analyze AFTER the
// LLM JSON parses, BEFORE response cache + res.json.
//
// Companion: server/lib/rationalePrompt.ts (RATIONALE_REGEN_SYSTEM_PROMPT +
// buildRationaleUserMsg) for the optional prose-regen call.
// ============================================================================

export type HSDirection = "LONG" | "SHORT";
export type HSRegime = "MACRO_CLEAR" | "RISK_ON" | "RISK_OFF" | "MACRO_EVENT";

export interface HSLiquidationCluster {
  price: number;
  side: "long" | "short";
  size_usd: number;
}

export interface SignalContext {
  symbol: string;
  direction: HSDirection;
  entry: number;
  proposedStop: number;
  proposedTargets: number[]; // TP1, TP2, TP3 prices from the LLM card
  rawConviction: number;     // 0..1
  atr1h: number;
  pctChange24h: number;      // +0.0548 = +5.48%
  funding8h: number;         // percent units, e.g. +0.0013 = +0.0013%/8h
  oiUsd: number;
  oiChange24hPct: number;    // 6h proxy from getOiChangePct() in production —
                             // 24h feed not on databus; documented in caller.
  liquidationClusters: HSLiquidationCluster[];
  backtestN: number;
  backtestWr: number;        // 0..1
  backtestAvgR: number;
  regime: HSRegime;          // MUST come from same source as UI banner
  edgeSource?: "OI-verified" | "estimated" | "no OI";
}

export interface HardenedSignal {
  accept: boolean;
  reasonsRejected: string[];
  direction: HSDirection;
  entry: number;
  stop: number;
  targets: number[];         // recomputed; preserves LLM's R-multiples off the new stop
  rrFirst: number;
  leverageCap: number;
  finalConviction: number;   // 0..1
  sizeMultiplier: number;    // 0..1
  wrCiLow: number;
  wrCiHigh: number;
  chaseFlag: boolean;
  crowdingFlag: boolean;
  lowSampleFlag: boolean;
  regimeUsed: HSRegime;
  notes: string[];
  materiallyMutated: boolean;
}

export interface HardenConfig {
  minBacktestN?: number;
  minRr?: number;
  minPostHaircutConviction?: number;
  maxChasePct?: number;
  materialStopMovePct?: number;
  materialConvictionDelta?: number;
  atrStopMult?: number;
}

function _wilsonCi(wins: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin =
    (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function _kellySize(ciLow: number, avgR: number, fraction = 0.25): number {
  const p = ciLow;
  const b = Math.max(0.1, avgR);
  if (p <= 0) return 0;
  const kelly = (p * (b + 1) - 1) / b;
  return Math.max(0, Math.min(1, kelly * fraction));
}

function _atrStopFloor(entry: number, atr1h: number, direction: HSDirection, mult: number): number {
  const distance = atr1h * mult;
  return direction === "LONG" ? entry - distance : entry + distance;
}

function _liquidityAwareStop(
  entry: number,
  direction: HSDirection,
  clusters: HSLiquidationCluster[],
  atr1h: number,
  maxAtrExtension = 3.0,
): number | null {
  if (!clusters.length || atr1h <= 0) return null;
  const band = atr1h * maxAtrExtension;
  const candidates: Array<{ size: number; price: number }> = [];
  for (const c of clusters) {
    if (direction === "LONG" && c.price < entry && entry - c.price <= band) {
      candidates.push({ size: c.size_usd, price: c.price });
    } else if (direction === "SHORT" && c.price > entry && c.price - entry <= band) {
      candidates.push({ size: c.size_usd, price: c.price });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.size - a.size);
  const clusterPrice = candidates[0].price;
  const buffer = atr1h * 0.3;
  return direction === "LONG" ? clusterPrice - buffer : clusterPrice + buffer;
}

function _detectChase(ctx: SignalContext, threshold: number): boolean {
  if (ctx.direction === "LONG" && ctx.pctChange24h > threshold) return true;
  if (ctx.direction === "SHORT" && ctx.pctChange24h < -threshold) return true;
  return false;
}

function _detectCrowding(ctx: SignalContext): [boolean, string] {
  if (ctx.edgeSource === "no OI") return [false, ""];
  const elevatedFunding =
    (ctx.direction === "LONG" && ctx.funding8h > 0.01) ||
    (ctx.direction === "SHORT" && ctx.funding8h < -0.01);
  const risingOi = ctx.oiChange24hPct > 0.10;
  if (elevatedFunding && risingOi) {
    return [
      true,
      `Crowded: funding ${ctx.funding8h.toFixed(4)}%/8h with OI ${(ctx.oiChange24hPct * 100).toFixed(1)}%`,
    ];
  }
  return [false, ""];
}

const _REGIME_LEVERAGE_CAP: Record<HSRegime, number> = {
  MACRO_CLEAR: 5.0,
  RISK_ON:     5.0,
  RISK_OFF:    3.0,
  MACRO_EVENT: 2.0,
};

export function hardenSignal(ctx: SignalContext, config: HardenConfig = {}): HardenedSignal {
  const {
    minBacktestN = 30,
    minRr = 1.8,
    minPostHaircutConviction = 0.5,
    maxChasePct = 0.04,
    materialStopMovePct = 0.15,
    materialConvictionDelta = 0.15,
    atrStopMult = 1.8,
  } = config;

  const notes: string[] = [];
  const rejected: string[] = [];

  // 1. Stop: take the FURTHER of (ATR floor, liquidity-aware) from entry
  const atrFloor = _atrStopFloor(ctx.entry, ctx.atr1h, ctx.direction, atrStopMult);
  const liqStop = _liquidityAwareStop(
    ctx.entry, ctx.direction, ctx.liquidationClusters, ctx.atr1h,
  );
  let finalStop: number;
  if (liqStop !== null) {
    finalStop = ctx.direction === "LONG"
      ? Math.min(liqStop, atrFloor)
      : Math.max(liqStop, atrFloor);
    notes.push("Stop placed beyond liquidation cluster (ATR-validated)");
  } else {
    finalStop = atrFloor;
    notes.push(`Stop = entry ± ${atrStopMult}x ATR(1h) (no liq cluster data)`);
  }

  // 2. TP ladder: preserve LLM's R-multiples off NEW stop; floor TP1 at minRr
  const origRisk = Math.abs(ctx.entry - ctx.proposedStop);
  const newRisk = Math.abs(ctx.entry - finalStop);
  const rMultiples = ctx.proposedTargets.map((tp) =>
    origRisk > 0 ? Math.abs(tp - ctx.entry) / origRisk : 0,
  );
  const adjustedR = rMultiples.map((r, i) => (i === 0 ? Math.max(r, minRr) : r));
  const hardenedTargets = adjustedR.map((r) =>
    ctx.direction === "LONG" ? ctx.entry + newRisk * r : ctx.entry - newRisk * r,
  );
  const rrFirst = adjustedR[0] ?? minRr;

  // 3. Flags
  const chase = _detectChase(ctx, maxChasePct);
  if (chase) notes.push(`CHASE: entering after ${(ctx.pctChange24h * 100).toFixed(1)}% 24h move`);
  const [crowded, crowdMsg] = _detectCrowding(ctx);
  if (crowded) notes.push(crowdMsg);

  // 4. Backtest CI
  const wins = Math.round(ctx.backtestWr * ctx.backtestN);
  const [ciLow, ciHigh] = _wilsonCi(wins, ctx.backtestN);
  const lowSample = ctx.backtestN < minBacktestN;
  if (lowSample) {
    notes.push(
      `Low sample: n=${ctx.backtestN} (<${minBacktestN}); WR 95% CI [${(ciLow * 100).toFixed(0)}%, ${(ciHigh * 100).toFixed(0)}%]`,
    );
  }

  // 5. Leverage cap from regime
  const leverageCap = _REGIME_LEVERAGE_CAP[ctx.regime] ?? 3.0;

  // 6. Conviction haircuts (multiplicative)
  let finalConv = ctx.rawConviction;
  if (chase) finalConv *= 0.70;
  if (crowded) finalConv *= 0.75;
  if (lowSample) finalConv *= 0.80;

  // 7. Quarter-Kelly off CI lower bound
  const sizeMultiplier = _kellySize(ciLow, ctx.backtestAvgR);

  // 8. Veto checks
  if (chase && crowded) {
    rejected.push("VETO: chase + crowded = late entry into already-positioned move");
  }
  if (finalConv < minPostHaircutConviction) {
    rejected.push(
      `VETO: post-haircut conviction ${(finalConv * 100).toFixed(0)}% below ${(minPostHaircutConviction * 100).toFixed(0)}%`,
    );
  }
  if (rrFirst < minRr) {
    rejected.push(`VETO: RR ${rrFirst.toFixed(2)} below min ${minRr}`);
  }
  if (ctx.atr1h <= 0) {
    rejected.push("VETO: missing ATR data — cannot validate stop placement");
  }

  // 9. Material mutation → gates prose regen
  const stopMovePctOfRisk = origRisk > 0 ? Math.abs(ctx.proposedStop - finalStop) / origRisk : 0;
  const convictionDelta = ctx.rawConviction - finalConv;
  const materiallyMutated =
    stopMovePctOfRisk > materialStopMovePct ||
    convictionDelta > materialConvictionDelta ||
    chase ||
    crowded;

  return {
    accept: rejected.length === 0,
    reasonsRejected: rejected,
    direction: ctx.direction,
    entry: ctx.entry,
    stop: finalStop,
    targets: hardenedTargets,
    rrFirst,
    leverageCap,
    finalConviction: finalConv,
    sizeMultiplier,
    wrCiLow: ciLow,
    wrCiHigh: ciHigh,
    chaseFlag: chase,
    crowdingFlag: crowded,
    lowSampleFlag: lowSample,
    regimeUsed: ctx.regime,
    notes,
    materiallyMutated,
  };
}
```

#### `server/lib/statisticalBrain.ts`
```ts
// ============================================================================
// statisticalBrain — empirical edge engine that turns 957 resolved signals
// into prescriptive guidance for entry, SL, TP, and hold timing.
//
// For every (token, direction) combo this module computes:
//   - Win rate over the last 60 days
//   - Realized R on average winner / loser (R = pnl_pct / sl_pct)
//   - Expected R per trade (EV)
//   - Median trade duration
//   - Typical SL distance the engine has been using
//
// From those numbers it derives STRICT LIMITS that hardening enforces:
//   - maxTpR              — TP1 cannot exceed historical winner reach
//   - minSlR              — SL must give the trade room (>= avg loser MAE proxy)
//   - maxKillClockHours   — kill clock cannot exceed empirical resolution time
//
// And it issues a verdict:
//   - SUPPRESS   — n>=15 and WR<25%  → bail out before calling Claude
//   - CAUTION    — n>=15 and WR 25-40%
//   - PREFERRED  — n>=20 and WR>=60%
//   - NORMAL     — otherwise (or insufficient sample)
//
// Cached for 5 minutes. Falls open on DB error (returns NORMAL verdict, no
// limits) so a bad query never blocks signal generation.
// ============================================================================

import { sql } from "drizzle-orm";
import { db } from "../db";

const WIN_OUTCOMES  = new Set(["TP1_HIT", "TP2_HIT", "TP3_HIT", "EXPIRED_WIN"]);
const LOSS_OUTCOMES = new Set(["SL_HIT", "EXPIRED_LOSS"]);

const LOOKBACK_DAYS    = 60;
const MIN_SAMPLE_LIMIT = 15;   // need >=15 trades to enforce strict limits
const MIN_SAMPLE_SUPP  = 15;   // need >=15 trades to suppress on WR
const MIN_SAMPLE_PREF  = 20;   // need >=20 trades to mark PREFERRED
const MIN_SAMPLE_INVERT = 20;  // need >=20 trades to MECHANICALLY FLIP direction
const INVERT_WR        = 0.15; // WR<15% on n>=20 → contra-indicator, flip direction
const SUPPRESS_WR      = 0.25;
const CAUTION_WR       = 0.40;
const PREFERRED_WR     = 0.60;

const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache: { ts: number; rows: ComboStat[] } | null = null;

// INVERT — WR<15% on n>=20 means the model is a perfect contra-indicator for
// this (token, direction). We trade the OPPOSITE direction instead. Empirical:
// BTC SHORT 0% (n=20), DOGE SHORT 5% (n=21), WIF LONG 5% (n=20), APT SHORT 8%
// (n=25). Flipping these alone lifts pooled WR from 23% → ~40%.
export type BrainVerdict = "INVERT" | "SUPPRESS" | "CAUTION" | "NORMAL" | "PREFERRED";

export interface ComboStat {
  token: string;
  direction: "LONG" | "SHORT";
  sampleSize: number;
  wins: number;
  losses: number;
  winRate: number;             // 0..1
  avgWinPct: number;           // % move on winners (positive)
  avgLossPct: number;          // % move on losers (positive number — magnitude)
  avgSlPct: number;            // typical SL distance the engine used
  medianDurationMin: number;
  // Derived R-multiples (realized return divided by SL distance)
  avgWinR: number;             // typical winner reach in R (e.g. 1.5)
  p90WinR: number;             // 90th-percentile winner reach in R — strict TP cap
  avgLossR: number;            // typical loser depth in R (positive — e.g. 0.85)
  expectedR: number;           // EV per trade in R
}

export interface BrainLimits {
  maxTpR: number;              // strict — TP1 R must be <= this
  minSlR: number;              // strict — SL R must be >= this
  maxKillClockHours: number;   // strict — kill clock <= this
}

export interface BrainOutput {
  token: string;
  direction: "LONG" | "SHORT";
  verdict: BrainVerdict;
  hasData: boolean;            // true when sample >= MIN_SAMPLE_LIMIT
  stat: ComboStat | null;
  limits: BrainLimits | null;  // null when hasData=false (don't enforce)
  reason: string;              // human-readable summary
  promptText: string;          // ready-to-inject prompt block
}

// ── Refresh ────────────────────────────────────────────────────────────────

async function refresh(): Promise<ComboStat[]> {
  const cutoffDays = LOOKBACK_DAYS;
  const result: any = await db.execute(sql`
    SELECT
      token,
      direction,
      outcome,
      pnl_pct,
      ABS((stop_loss - entry_price) / NULLIF(entry_price, 0)) * 100 AS sl_pct,
      EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60                AS duration_min
    FROM ai_signal_log
    WHERE outcome IS NOT NULL
      AND outcome <> 'PENDING'
      AND entry_price > 0
      AND stop_loss   > 0
      AND created_at >= NOW() - (${cutoffDays}::int || ' days')::interval
  `);
  const rows: Array<{
    token: string;
    direction: string;
    outcome: string;
    pnl_pct: string | null;
    sl_pct: string | null;
    duration_min: string | null;
  }> = Array.isArray(result) ? result : (result?.rows || []);

  // Aggregate per (token, direction)
  type Acc = {
    token: string;
    direction: "LONG" | "SHORT";
    wins: number;
    losses: number;
    winPnls: number[];
    lossPnls: number[];   // stored positive
    winRs: number[];      // per-row winner R = pnl_pct / sl_pct (true distribution)
    slPcts: number[];
    durations: number[];
  };
  const map = new Map<string, Acc>();
  for (const r of rows) {
    const dir = (r.direction || "").toUpperCase();
    if (dir !== "LONG" && dir !== "SHORT") continue;
    const key = `${r.token}|${dir}`;
    let a = map.get(key);
    if (!a) {
      a = { token: r.token, direction: dir as "LONG" | "SHORT",
            wins: 0, losses: 0, winPnls: [], lossPnls: [], winRs: [], slPcts: [], durations: [] };
      map.set(key, a);
    }
    const pnl = r.pnl_pct != null ? parseFloat(r.pnl_pct) : NaN;
    const slP = r.sl_pct  != null ? parseFloat(r.sl_pct)  : NaN;
    const dur = r.duration_min != null ? parseFloat(r.duration_min) : NaN;
    if (Number.isFinite(slP) && slP > 0 && slP < 50) a.slPcts.push(slP);  // sanity guard
    if (Number.isFinite(dur) && dur > 0)             a.durations.push(dur);
    if (WIN_OUTCOMES.has(r.outcome)) {
      a.wins++;
      if (Number.isFinite(pnl)) {
        a.winPnls.push(pnl);
        // True per-row R for this winner = pnl% / sl% (when both available)
        if (Number.isFinite(slP) && slP > 0 && slP < 50) a.winRs.push(pnl / slP);
      }
    } else if (LOSS_OUTCOMES.has(r.outcome)) {
      a.losses++;
      if (Number.isFinite(pnl)) a.lossPnls.push(Math.abs(pnl));
    }
  }

  const out: ComboStat[] = [];
  for (const a of map.values()) {
    const total = a.wins + a.losses;
    if (total === 0) continue;
    const avgWinPct  = a.winPnls.length  > 0 ? a.winPnls.reduce((s, x) => s + x, 0)  / a.winPnls.length  : 0;
    const avgLossPct = a.lossPnls.length > 0 ? a.lossPnls.reduce((s, x) => s + x, 0) / a.lossPnls.length : 0;
    const avgSlPct   = a.slPcts.length   > 0 ? a.slPcts.reduce((s, x) => s + x, 0)   / a.slPcts.length   : 0;
    const medDur     = median(a.durations);
    const avgWinR    = avgSlPct > 0 ? avgWinPct  / avgSlPct : 0;
    const avgLossR   = avgSlPct > 0 ? avgLossPct / avgSlPct : 0;
    // p90 of per-row winner R distribution — true historical reach cap
    const p90WinR    = percentile(a.winRs, 0.90);
    const winRate    = a.wins / total;
    const expectedR  = winRate * avgWinR - (1 - winRate) * avgLossR;
    out.push({
      token: a.token,
      direction: a.direction,
      sampleSize: total,
      wins: a.wins,
      losses: a.losses,
      winRate,
      avgWinPct,
      avgLossPct,
      avgSlPct,
      medianDurationMin: medDur,
      avgWinR,
      avgLossR,
      p90WinR,
      expectedR,
    });
  }
  return out;
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))));
  return s[idx];
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function getRows(): Promise<ComboStat[]> {
  const now = Date.now();
  if (_cache && now - _cache.ts < CACHE_TTL_MS) return _cache.rows;
  try {
    const rows = await refresh();
    _cache = { ts: now, rows };
    return rows;
  } catch (err: any) {
    console.warn("[statisticalBrain] refresh failed (using last cache):", err.message);
    return _cache?.rows || [];
  }
}

// Public API ─────────────────────────────────────────────────────────────────

export async function getBrainFor(
  token: string,
  direction: "LONG" | "SHORT",
): Promise<BrainOutput> {
  const rows = await getRows();
  const stat = rows.find(r => r.token === token && r.direction === direction) || null;

  if (!stat || stat.sampleSize < MIN_SAMPLE_LIMIT) {
    return {
      token, direction,
      verdict: "NORMAL",
      hasData: false,
      stat,
      limits: null,
      reason: stat
        ? `Sample too small (n=${stat.sampleSize}, need ${MIN_SAMPLE_LIMIT}+) — no strict limits enforced.`
        : `No historical data for ${token} ${direction} in the last ${LOOKBACK_DAYS} days.`,
      promptText: stat
        ? `STATISTICAL EDGE BRAIN — ${token} ${direction}\n  Sample: ${stat.sampleSize} trades (insufficient for strict guidance, advisory only)\n  Win rate: ${(stat.winRate*100).toFixed(1)}% | Avg winner: +${stat.avgWinPct.toFixed(2)}% | Avg loser: -${stat.avgLossPct.toFixed(2)}%`
        : `STATISTICAL EDGE BRAIN — ${token} ${direction}\n  No prior resolved trades for this combo. AI judgement only.`,
    };
  }

  // Enough sample. Compute verdict. INVERT takes priority over SUPPRESS — a
  // combo at WR<15% with n>=20 is a perfect contra-indicator and we'd rather
  // trade the OPPOSITE direction than skip the trade entirely.
  let verdict: BrainVerdict = "NORMAL";
  if (stat.sampleSize >= MIN_SAMPLE_INVERT && stat.winRate < INVERT_WR) verdict = "INVERT";
  else if (stat.sampleSize >= MIN_SAMPLE_SUPP && stat.winRate < SUPPRESS_WR) verdict = "SUPPRESS";
  else if (stat.sampleSize >= MIN_SAMPLE_LIMIT && stat.winRate < CAUTION_WR) verdict = "CAUTION";
  else if (stat.sampleSize >= MIN_SAMPLE_PREF && stat.winRate >= PREFERRED_WR) verdict = "PREFERRED";

  // Derive STRICT LIMITS from empirical reality (per spec):
  // - maxTpR             = p90 of winner R distribution (cap TPs at the 90th-pct
  //                        historical reach — beyond this is wishful thinking).
  //                        Falls back to avgWinR*1.2 if winRs distribution empty.
  // - minSlR             = 0.80 × avgLossR (SL must allow at least 80% of avg
  //                        loser depth or it gets noised out by normal MAE).
  // - maxKillClockHours  = ceil(medianDurationMin/60 × 1.5)
  //                        (anything longer than 1.5× median is hope, not edge).
  const tpFromP90 = stat.p90WinR > 0 ? stat.p90WinR : stat.avgWinR * 1.20;
  const limits: BrainLimits = {
    maxTpR: Math.max(1.2, +tpFromP90.toFixed(2)),
    minSlR: Math.max(0.8, +(stat.avgLossR * 0.80).toFixed(2)),
    maxKillClockHours: Math.max(2, Math.ceil((stat.medianDurationMin / 60) * 1.5)),
  };

  // Build the prompt block
  const evSign = stat.expectedR >= 0 ? "+" : "";
  const lines: string[] = [];
  lines.push(`STATISTICAL EDGE BRAIN — ${token} ${direction}  [${verdict}]`);
  lines.push(`  Sample: ${stat.sampleSize} resolved trades (last ${LOOKBACK_DAYS}d) — ${stat.wins}W / ${stat.losses}L`);
  lines.push(`  Win rate: ${(stat.winRate*100).toFixed(1)}%  |  EV: ${evSign}${stat.expectedR.toFixed(2)}R per trade`);
  lines.push(`  Avg winner reach: ${stat.avgWinR.toFixed(2)}R (+${stat.avgWinPct.toFixed(2)}%)  |  Avg loser depth: ${stat.avgLossR.toFixed(2)}R (-${stat.avgLossPct.toFixed(2)}%)`);
  lines.push(`  Median resolution time: ${formatDuration(stat.medianDurationMin)}`);
  lines.push(``);
  lines.push(`  STRICT LIMITS — hardening will VETO if violated:`);
  lines.push(`    • TP1 R must be ≤ ${limits.maxTpR.toFixed(2)} (historical winners cap at ~${stat.avgWinR.toFixed(2)}R)`);
  lines.push(`    • SL R must be ≥ ${limits.minSlR.toFixed(2)} (avg loser depth ${stat.avgLossR.toFixed(2)}R — tighter SL gets noised out)`);
  lines.push(`    • Kill clock must be ≤ ${limits.maxKillClockHours}h (median resolution ${formatDuration(stat.medianDurationMin)})`);

  if (verdict === "INVERT") {
    const opp: "LONG" | "SHORT" = direction === "LONG" ? "SHORT" : "LONG";
    lines.push(``);
    lines.push(`  🔄 INVERT: WR ${(stat.winRate*100).toFixed(1)}% over ${stat.sampleSize} trades is below the ${(INVERT_WR*100).toFixed(0)}% floor.`);
    lines.push(`     This (token, direction) is a PERFECT CONTRA-INDICATOR. Trade ${opp} instead of ${direction}.`);
    lines.push(`     Mirror entry/SL/TP1 around current price for the ${opp} setup. The risk hardener will mechanically flip if you do not.`);
  } else if (verdict === "SUPPRESS") {
    lines.push(``);
    lines.push(`  ⛔ SUPPRESS: WR ${(stat.winRate*100).toFixed(1)}% over ${stat.sampleSize} trades is below the ${(SUPPRESS_WR*100).toFixed(0)}% floor.`);
    lines.push(`     This direction has no demonstrated edge. Return NEUTRAL.`);
  } else if (verdict === "CAUTION") {
    lines.push(``);
    lines.push(`  ⚠️  CAUTION: WR ${(stat.winRate*100).toFixed(1)}% is below 40%. Only emit if confluence is unusually strong.`);
  } else if (verdict === "PREFERRED") {
    lines.push(``);
    lines.push(`  ✅ PREFERRED: ${(stat.winRate*100).toFixed(1)}% WR over ${stat.sampleSize} trades — historically strong combo.`);
  }

  return {
    token, direction,
    verdict,
    hasData: true,
    stat,
    limits,
    reason: `${verdict} — ${(stat.winRate*100).toFixed(1)}% WR over ${stat.sampleSize} trades, EV ${evSign}${stat.expectedR.toFixed(2)}R`,
    promptText: lines.join("\n"),
  };
}

function formatDuration(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return "n/a";
  if (min < 60) return `${Math.round(min)}min`;
  const h = min / 60;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h/24).toFixed(1)}d`;
}

// Admin/debug surface — used by /api/admin/brain/summary if we ever expose it
export async function getBrainSummary(): Promise<{ rows: ComboStat[]; lookbackDays: number }> {
  const rows = await getRows();
  return { rows: [...rows].sort((a, b) => b.sampleSize - a.sampleSize), lookbackDays: LOOKBACK_DAYS };
}

export function invalidateBrainCache(): void { _cache = null; }

// ── Edge policy + conviction recalibration ───────────────────────────────────
// Calibration audit (1,074 dev rows, mirrors prod's 4,833-row pattern) showed
// raw conviction is INVERSELY calibrated above 50:
//   bucket 20→32% WR, 30→36%, 40→40%, 50→22%, 60→14%, 70→25%
// So a raw conviction of 60 is a WORSE signal than 30. We cap displayed
// conviction at 40 whenever raw >= 50 unless the brain says PREFERRED (real
// historical edge). Also fold in the INVERT/SUPPRESS verdicts so callers can
// flip or veto in one step.

export type EdgeAction = "KEEP" | "SUPPRESS" | "INVERT";

export interface EdgePolicy {
  action: EdgeAction;
  originalDirection: "LONG" | "SHORT";
  recommendedDirection: "LONG" | "SHORT";
  rawConvictionPct: number;            // 0..100 — what the LLM emitted
  recalibratedConvictionPct: number;   // 0..100 — apply downstream
  brainVerdict: BrainVerdict;
  reason: string;
}

/**
 * Recalibrate raw conviction (0..100) using the empirical inversion finding.
 * Hard cap at 40 above 50 unless the (token, direction) combo has a PREFERRED
 * verdict (>=60% historical WR over n>=20). Below 50 → unchanged.
 */
export function recalibrateConviction(rawPct: number, verdict: BrainVerdict): number {
  if (!Number.isFinite(rawPct)) return 0;
  const r = Math.max(0, Math.min(100, rawPct));
  if (verdict === "PREFERRED") return r;             // real edge — trust it
  if (verdict === "INVERT" || verdict === "SUPPRESS") return Math.min(r, 25);
  if (r >= 50) return 40;                            // collapse the inverted tail
  return r;
}

/**
 * Single-call edge policy resolver. Looks up the brain for (token, direction),
 * folds in conviction recalibration, and returns:
 *   - action="INVERT"  → flip direction; mirror entry/SL/TPs around entry price
 *   - action="SUPPRESS"→ veto entirely (caller decides: drop card, NO_TRADE, etc.)
 *   - action="KEEP"    → proceed normally, but USE recalibratedConvictionPct
 *
 * Falls open on any error (returns KEEP with raw conviction) so a brain failure
 * never blocks signal generation.
 */
export async function applyEdgePolicy(
  token: string,
  direction: "LONG" | "SHORT",
  rawConvictionPct: number,
): Promise<EdgePolicy> {
  try {
    const b = await getBrainFor(token, direction);
    const v = b.verdict;
    const opp: "LONG" | "SHORT" = direction === "LONG" ? "SHORT" : "LONG";

    if (v === "INVERT") {
      // Re-check the OPPOSITE direction — only flip if the inverse isn't ALSO
      // suppressed (otherwise the asset is just unpredictable, skip entirely).
      const inv = await getBrainFor(token, opp);
      if (inv.verdict === "SUPPRESS" || inv.verdict === "INVERT") {
        return {
          action: "SUPPRESS",
          originalDirection: direction,
          recommendedDirection: direction,
          rawConvictionPct,
          recalibratedConvictionPct: recalibrateConviction(rawConvictionPct, "SUPPRESS"),
          brainVerdict: v,
          reason: `${token} ${direction} is a contra-indicator (WR ${(b.stat?.winRate ?? 0)*100|0}%) but ${token} ${opp} is also weak (verdict ${inv.verdict}) — vetoed`,
        };
      }
      // Recalibrate against the INVERTED direction's verdict (we're trading that)
      return {
        action: "INVERT",
        originalDirection: direction,
        recommendedDirection: opp,
        rawConvictionPct,
        recalibratedConvictionPct: recalibrateConviction(rawConvictionPct, inv.verdict),
        brainVerdict: v,
        reason: `${token} ${direction} flipped to ${opp}: WR ${((b.stat?.winRate ?? 0)*100).toFixed(1)}% over ${b.stat?.sampleSize ?? 0} trades — perfect contra-indicator`,
      };
    }

    if (v === "SUPPRESS") {
      return {
        action: "SUPPRESS",
        originalDirection: direction,
        recommendedDirection: direction,
        rawConvictionPct,
        recalibratedConvictionPct: recalibrateConviction(rawConvictionPct, v),
        brainVerdict: v,
        reason: `${token} ${direction} suppressed: WR ${((b.stat?.winRate ?? 0)*100).toFixed(1)}% over ${b.stat?.sampleSize ?? 0} trades`,
      };
    }

    return {
      action: "KEEP",
      originalDirection: direction,
      recommendedDirection: direction,
      rawConvictionPct,
      recalibratedConvictionPct: recalibrateConviction(rawConvictionPct, v),
      brainVerdict: v,
      reason: b.reason,
    };
  } catch (err: any) {
    console.warn("[edgePolicy] fall-open:", err?.message || err);
    return {
      action: "KEEP",
      originalDirection: direction,
      recommendedDirection: direction,
      rawConvictionPct,
      recalibratedConvictionPct: rawConvictionPct,
      brainVerdict: "NORMAL",
      reason: "edge policy unavailable — passing through",
    };
  }
}

/** Mirror a price around an anchor (entry). LONG SL below → SHORT SL above, etc. */
export function mirrorPrice(entry: number, price: number): number {
  return 2 * entry - price;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module 1 (Setup Archetypes) — per-(token, direction, archetype) stats
//
// Queries the `archetype` column added additively in server/initDb.ts. Returns
// Wilson 95% lower bound win rate (so small samples don't masquerade as edge),
// median R, p75 hold time, and median time-to-TP / time-to-SL. `lowSample` flag
// fires when n <= 20 so the UI can prefix "LOW SAMPLE — use caution".
//
// Fully cached for 5 minutes per (token, direction, archetype) combo. Falls
// open on DB error — caller treats `n=0, lowSample=true` as "no data, hide".
// ─────────────────────────────────────────────────────────────────────────────

export interface ArchetypeStats {
  token: string;
  direction: "LONG" | "SHORT";
  archetype: string;
  n: number;
  wins: number;
  losses: number;
  wrPointEst: number;          // 0..1
  /** @deprecated kept for one release; use wrWilsonLB80 for display. */
  wrWilsonLB: number;          // 0..1, 95% lower bound (z = 1.96)
  wrWilsonLB80: number;        // 0..1, 80% lower bound (z = 0.8416) — display default per Module 2 T04
  medianR: number;             // realized R-multiple across all resolved
  p75HoldMinutes: number;      // 75th percentile of resolution time
  medianTimeToTpMin: number;   // median over winners only
  medianTimeToSlMin: number;   // median over losers only
  lowSample: boolean;          // n <= 20
}

/**
 * Wilson lower bound. Default z=1.96 (95%) preserved for back-compat; pass
 * z=0.8416 for the 80% LCB that Module 2 surfaces on cards. The 80% bound is
 * the "lukewarm-but-honest" floor — tight enough to penalise tiny samples
 * but not so harsh it hides marginal edges with n=15-30.
 */
function wilsonLowerBound(wins: number, n: number, z = 1.96): number {
  if (!n || n <= 0) return 0;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return Math.max(0, Math.min(1, (centre - margin) / denom));
}

const _archCache = new Map<string, { ts: number; stats: ArchetypeStats }>();
const ARCH_TTL_MS = 5 * 60 * 1000;

/**
 * Module 2 T10 (cycle-safe fix): raw TS query path that NEVER consults
 * STATS_SOURCE. This is what the MV repo's catch block + the shadow-compare
 * scheduler's "TS side" call into, so a misbehaving MV (or a flipped flag)
 * can't trigger recursion or invalidate shadow comparisons. All callers
 * outside the repository abstraction should keep using `getArchetypeStats`
 * (which honors STATS_SOURCE); this export is intentionally low-level.
 */
export async function getArchetypeStatsTsOnly(
  token: string,
  direction: "LONG" | "SHORT",
  archetype: string,
): Promise<ArchetypeStats> {
  return _getArchetypeStatsTsRaw(token, direction, archetype);
}

async function _getArchetypeStatsTsRaw(
  token: string,
  direction: "LONG" | "SHORT",
  archetype: string,
): Promise<ArchetypeStats> {
  const key = `${token}|${direction}|${archetype}|ts`;
  const cached = _archCache.get(key);
  const now = Date.now();
  if (cached && now - cached.ts < ARCH_TTL_MS) return cached.stats;
  const empty: ArchetypeStats = {
    token, direction, archetype,
    n: 0, wins: 0, losses: 0,
    wrPointEst: 0, wrWilsonLB: 0, wrWilsonLB80: 0, medianR: 0,
    p75HoldMinutes: 0, medianTimeToTpMin: 0, medianTimeToSlMin: 0,
    lowSample: true,
  };
  try {
    // Module 2 T05: treat UNCLASSIFIED as a 7th archetype that ALSO pools
    // rows where the column is NULL (historical signals predating Module 1
    // had no archetype written at all). Classified archetypes use strict
    // equality so they aren't polluted by NULLs.
    const isUnclassified = archetype === "UNCLASSIFIED";
    // Module 2 T07: when USE_BACKFILLED_STATS is on, UNION the live
    // ai_signal_log rows with the same outcomes joined through
    // backfilled_classifications. Backfill rows are tagged via their own
    // archetype column (computed by the 1h-only backfill script), so live's
    // NULL/UNCLASSIFIED bucket and backfill's UNCLASSIFIED bucket combine
    // naturally. SKIPPED_* / BACKFILL_UNRECOVERABLE sentinel rows in the
    // backfill table are filtered out so they don't dilute classified stats.
    let useBackfill = false;
    try {
      const { useBackfilledStats } = await import("./featureFlags");
      useBackfill = useBackfilledStats();
    } catch { /* fail-closed to live-only */ }

    const liveArchClause = isUnclassified
      ? sql`(archetype IS NULL OR archetype = 'UNCLASSIFIED')`
      : sql`archetype = ${archetype}`;

    const result: any = useBackfill
      ? await db.execute(sql`
          SELECT
            outcome,
            pnl_pct,
            ABS((stop_loss - entry_price) / NULLIF(entry_price, 0)) * 100 AS sl_pct,
            EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60            AS duration_min
          FROM ai_signal_log
          WHERE token = ${token}
            AND direction = ${direction}
            AND ${liveArchClause}
            AND outcome IS NOT NULL
            AND outcome <> 'PENDING'
            AND resolved_at IS NOT NULL
            AND created_at >= NOW() - (${LOOKBACK_DAYS} || ' days')::interval
            AND (classification_source IS NULL OR classification_source = 'live')
          UNION ALL
          SELECT
            sl.outcome,
            sl.pnl_pct,
            ABS((sl.stop_loss - sl.entry_price) / NULLIF(sl.entry_price, 0)) * 100 AS sl_pct,
            EXTRACT(EPOCH FROM (sl.resolved_at - sl.created_at)) / 60       AS duration_min
          FROM backfilled_classifications bc
          JOIN ai_signal_log sl ON sl.id = bc.source_signal_id
          WHERE sl.token = ${token}
            AND sl.direction = ${direction}
            AND bc.archetype = ${archetype}
            AND sl.outcome IS NOT NULL
            AND sl.outcome <> 'PENDING'
            AND sl.resolved_at IS NOT NULL
            AND sl.created_at >= NOW() - (${LOOKBACK_DAYS} || ' days')::interval
            AND (sl.classification_source IS NULL OR sl.classification_source = 'live')
        `)
      : await db.execute(sql`
          SELECT
            outcome,
            pnl_pct,
            ABS((stop_loss - entry_price) / NULLIF(entry_price, 0)) * 100 AS sl_pct,
            EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60            AS duration_min
          FROM ai_signal_log
          WHERE token = ${token}
            AND direction = ${direction}
            AND ${liveArchClause}
            AND outcome IS NOT NULL
            AND outcome <> 'PENDING'
            AND resolved_at IS NOT NULL
            AND created_at >= NOW() - (${LOOKBACK_DAYS} || ' days')::interval
        `);
    const rows: any[] = result?.rows || result || [];
    if (!rows.length) {
      _archCache.set(key, { ts: now, stats: empty });
      return empty;
    }
    let wins = 0, losses = 0;
    const allR: number[] = [];
    const allDur: number[] = [];
    const winDur: number[] = [];
    const lossDur: number[] = [];
    for (const r of rows) {
      const outcome = String(r.outcome || "");
      const pnlPct = Number(r.pnl_pct);
      const slPct = Number(r.sl_pct);
      const durMin = Number(r.duration_min);
      const isWin = WIN_OUTCOMES.has(outcome);
      const isLoss = LOSS_OUTCOMES.has(outcome);
      if (isWin) wins++;
      if (isLoss) losses++;
      if (Number.isFinite(pnlPct) && Number.isFinite(slPct) && slPct > 0) {
        allR.push(pnlPct / slPct);
      }
      if (Number.isFinite(durMin) && durMin > 0) {
        allDur.push(durMin);
        if (isWin) winDur.push(durMin);
        if (isLoss) lossDur.push(durMin);
      }
    }
    const n = wins + losses;
    const wrPt = n > 0 ? wins / n : 0;
    const stats: ArchetypeStats = {
      token, direction, archetype,
      n, wins, losses,
      wrPointEst: wrPt,
      wrWilsonLB: wilsonLowerBound(wins, n),
      wrWilsonLB80: wilsonLowerBound(wins, n, 0.8416),
      medianR: percentile(allR, 0.5),
      p75HoldMinutes: percentile(allDur, 0.75),
      medianTimeToTpMin: percentile(winDur, 0.5),
      medianTimeToSlMin: percentile(lossDur, 0.5),
      lowSample: n <= 20,
    };
    _archCache.set(key, { ts: now, stats });
    return stats;
  } catch (err: any) {
    console.warn(`[archetypeStats] fall-open ${key}:`, err?.message || err);
    return empty;
  }
}

/**
 * Public stats accessor honored by every signal-path caller. Routes through
 * STATS_SOURCE; falls open to the cycle-safe `_getArchetypeStatsTsRaw` on
 * any MV failure or when MV returns an empty bucket.
 */
export async function getArchetypeStats(
  token: string,
  direction: "LONG" | "SHORT",
  archetype: string,
): Promise<ArchetypeStats> {
  const key = `${token}|${direction}|${archetype}`;
  const cached = _archCache.get(key);
  const now = Date.now();
  if (cached && now - cached.ts < ARCH_TTL_MS) return cached.stats;
  try {
    const { statsSource } = await import("./featureFlags");
    if (statsSource() === "mv") {
      const { MaterializedViewStatsRepository } = await import("./statsRepository");
      const mv = new MaterializedViewStatsRepository();
      const out = await mv.getArchetypeStats(token, direction, archetype);
      if (out && out.n > 0) {
        _archCache.set(key, { ts: now, stats: out });
        return out;
      }
      // fall through to TS query if MV returned empty (e.g. arch not in MV yet)
    }
  } catch { /* fall through to TS raw */ }
  const stats = await _getArchetypeStatsTsRaw(token, direction, archetype);
  _archCache.set(key, { ts: now, stats });
  return stats;
}

export interface ArchetypeSummaryRow {
  archetype: string;
  n: number;
  wins: number;
  wrPointEst: number;
  /** @deprecated kept for one release; use wrWilsonLB80 for display. */
  wrWilsonLB: number;
  wrWilsonLB80: number;
  medianR: number;
}

/** Cross-token archetype summary for the admin dashboard. */
export async function getArchetypeSummary(): Promise<{
  rows: ArchetypeSummaryRow[];
  lookbackDays: number;
}> {
  try {
    const result: any = await db.execute(sql`
      SELECT
        COALESCE(archetype, 'UNCLASSIFIED') AS archetype,
        COUNT(*)                            AS n,
        SUM(CASE WHEN outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','EXPIRED_WIN') THEN 1 ELSE 0 END) AS wins,
        AVG(CASE WHEN ABS((stop_loss - entry_price) / NULLIF(entry_price,0)) > 0
                 THEN pnl_pct / (ABS((stop_loss - entry_price) / NULLIF(entry_price,0)) * 100)
                 ELSE NULL END)             AS avg_r
      FROM ai_signal_log
      WHERE outcome IS NOT NULL
        AND outcome <> 'PENDING'
        AND created_at >= NOW() - (${LOOKBACK_DAYS} || ' days')::interval
      GROUP BY 1
      ORDER BY n DESC
    `);
    const raw: any[] = result?.rows || result || [];
    const rows: ArchetypeSummaryRow[] = raw.map(r => {
      const n = Number(r.n) || 0;
      const wins = Number(r.wins) || 0;
      return {
        archetype: String(r.archetype || "UNCLASSIFIED"),
        n,
        wins,
        wrPointEst: n > 0 ? wins / n : 0,
        wrWilsonLB: wilsonLowerBound(wins, n),
        wrWilsonLB80: wilsonLowerBound(wins, n, 0.8416),
        medianR: Number(r.avg_r) || 0,
      };
    });
    return { rows, lookbackDays: LOOKBACK_DAYS };
  } catch (err: any) {
    console.warn("[archetypeSummary] fall-open:", err?.message || err);
    return { rows: [], lookbackDays: LOOKBACK_DAYS };
  }
}

export function invalidateArchetypeCache(): void { _archCache.clear(); }
```

#### `server/quantClient.ts`
```ts
// Phase 2A: Node-side client for the Python quant microservice
// All HTTP calls hit 127.0.0.1 (NOT localhost — Node 17+ may resolve to ::1)
const QUANT_URL = process.env.QUANT_URL || "http://127.0.0.1:8081";

// Normalize free-form asset class strings → the canonical set the Python
// scorer expects. Prevents passing a raw symbol (e.g. "SPY") as a class,
// which would mis-route the external-bar fetch to Binance.
const _CRYPTO_SET = new Set([
  "BTC", "ETH", "SOL", "WIF", "DOGE", "AVAX", "LINK", "ARB", "kPEPE", "PEPE",
  "XRP", "BNB", "ADA", "DOT", "POL", "UNI", "AAVE", "NEAR", "SUI", "APT", "OP",
  "TIA", "SEI", "JUP", "ONDO", "RENDER", "INJ", "FET", "TAO", "PENDLE", "HBAR",
  "TRUMP", "HYPE",
]);
export function normalizeAssetClass(raw: string | undefined, symbol: string): string {
  const s = (raw || "").toUpperCase();
  if (s === "STOCK" || s === "EQUITY" || s === "ETF" || s === "INDEX") return "STOCK";
  if (s === "METAL" || s === "COMMODITY") return "METAL";
  if (s === "FOREX" || s === "FX") return "FOREX";
  if (s === "BTC" || s === "ETH") return s;
  if (s === "CRYPTO" || s === "MID_CAP_DEFAULT" || s === "MID_CAP") return "MID_CAP_DEFAULT";
  // Heuristic from symbol when class isn't given
  if (_CRYPTO_SET.has(symbol)) {
    return symbol === "BTC" || symbol === "ETH" ? symbol : "MID_CAP_DEFAULT";
  }
  // 6-letter alpha pair like EURUSD → forex
  if (/^[A-Z]{6}$/.test(symbol)) return "FOREX";
  // Default to STOCK for anything else (SPY, AAPL, etc.) — never mis-route to Binance
  return "STOCK";
}

export interface QuantScoreRequest {
  symbol: string;
  timeframe?: string;
  ohlcv?: number[][];   // optional — Python falls back to internal HL bars or external provider
  daily_returns?: number[];
  equity_usd?: number;
  conviction?: number;
  wilson_lb?: number | null;
  stocktwits_score?: number | null;
  asset_class?: string;
  planned_rr?: number;
}

export interface QuantScoreResponse {
  passes: boolean;
  side: "long" | "short" | null;
  composite_z: number;
  // Signal Engine v1 §1 regime states (Phase 2.1 — uppercase, 5-state with
  // directional trend split). Was previously lowercase 4-state; downstream
  // consumers only stringify this for logs so the change is non-breaking.
  regime: "TREND_UP" | "TREND_DOWN" | "RANGE" | "HIGH_VOL" | "CHOP";
  // Signal Engine v1 §2 (Phase 2.2) — Dual Score.
  // Both bounded [0.50, 0.85] (dir_prob) / [0.40, 0.95] (conviction).
  // When either falls below the per-asset-class threshold (see
  // quant/scorer.py DUAL_SCORE_THRESHOLDS), no_signal_reason is set to
  // "below_thresholds" — the same canonical reason the legacy z_threshold
  // gate produces. AI defers to these via the SCORER PREPASS line.
  // Phase 2.5 note: these values are POST-microstructure adjustment
  // (CVD/OBI deltas already folded in by the scorer).
  direction_probability?: number;
  conviction?: number;
  // Signal Engine v1 §3 (Phase 2.3) — Vol-Percentile-Adjusted R:R.
  // vol_percentile is the percentile rank of ATR(14)/close over the last
  // 90 bars (0.0–1.0). rr_multiplier is the spec-bucket scaling factor
  // (0.70 / 1.00 / 1.30 / 1.60), capped at 1.00 in RANGE regime.
  vol_percentile?: number;
  rr_multiplier?: number;
  // Signal Engine v1 §4 (Phase 2.4) — Meta-label proxy.
  // p_loss_meta is currently 1 - direction_probability (deterministic
  // proxy). Server uses it to compute kelly_fraction_applied =
  // min(0.25, kelly_base * (1 - p_loss_meta) * regime_mod * conviction)
  // BEFORE prompt build, then transmits the final value via PREPASS so
  // the AI emits it verbatim without re-computing. See routes.ts.
  p_loss_meta?: number;
  // Signal Engine v1 §5 (Phase 2.5) — Crypto microstructure features.
  // Crypto only; non-crypto returns {cvd_state: "n/a", obi: null,
  // ivrv_spread: null}. ivrv_spread is always null today (Deribit feed
  // pending — field exists for forward compat).
  microstructure?: {
    cvd_state?:   "confirm" | "bullish_div" | "bearish_div" | "contradict" | "n/a";
    obi?:         number | null;
    ivrv_spread?: number | null;
  };
  suggested_size_usd: number;
  sl_atr_mult: number;
  tp_atr_mult: number;
  sl_pct: number;
  sigma_ann: number;
  gates_failed: string[];
  factors: Record<string, number>;
  sl: number | null;
  tp: number | null;
  entry_ref: number;
  ts: number;
  // Signal Engine v1 (Phase 2.1) additions — both optional for backward compat
  // with any consumer that pre-dates this rollout.
  signal_type?: "momentum" | "mean_reversion" | null;
  no_signal_reason?: string | null;
}

export interface QuantCostRequest {
  symbol: string;
  order_usd: number;
  adv_usd: number;
  sigma_daily_dec: number;
  expected_alpha_bps: number;
  asset_class?: string;
}

export interface QuantCostResponse {
  total_bps: number;
  half_spread_bps: number;
  fee_bps: number;
  impact_bps: number;
  ev_pass: boolean;
}

async function postJson<T>(path: string, body: any, timeoutMs = 8000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${QUANT_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`quant ${path} ${r.status}: ${text.slice(0, 200)}`);
    }
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export async function quantScore(payload: QuantScoreRequest): Promise<QuantScoreResponse> {
  return postJson<QuantScoreResponse>("/quant/score", payload);
}

export async function quantCost(payload: QuantCostRequest): Promise<QuantCostResponse> {
  return postJson<QuantCostResponse>("/quant/cost", payload);
}

export async function quantHealth(): Promise<{ ok: boolean; ws_alive?: boolean; coins?: string[]; last_update_ts?: number; server_ts?: number }> {
  try {
    const r = await fetch(`${QUANT_URL}/quant/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return { ok: false };
    return await r.json();
  } catch {
    return { ok: false };
  }
}

// ── Phase 2A signal generator ────────────────────────────────────────────────
// Deterministic Python scorer → cost/EV gate → Claude veto-only.
// Returns a result the existing scanner can act on. Gated by PHASE2A_ENABLED env.
import { db } from "./db";
import { aiSignalLog, adaptiveThresholds, type InsertAiSignalLog } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { CLAUDE_MODEL } from "./config";

export interface Phase2ACtx {
  symbol: string;
  timeframe: string;
  ohlcv?: number[][];          // [[ts,o,h,l,c,v], ...] ascending; optional — Python will fetch real bars
  dailyReturns?: number[];
  equityUsd: number;
  convictionHint: number;      // 0-1
  stocktwitsScore?: number | null;
  assetClass: string;
}

export type Phase2AResult =
  | { emitted: false; reason: string; score?: QuantScoreResponse; cost?: QuantCostResponse; veto?: any }
  | { emitted: true; signal: any; score: QuantScoreResponse; cost: QuantCostResponse; veto: any };

async function logAi(row: Partial<InsertAiSignalLog> & { source: string; token: string; direction: string; entryPrice: string }) {
  try {
    await db.insert(aiSignalLog).values({
      tp1Price: null, tp2Price: null, tp3Price: null, stopLoss: null,
      ...row,
    } as InsertAiSignalLog);
  } catch (e) {
    console.warn("[Phase2A] aiSignalLog insert failed:", (e as Error).message);
  }
}

// Direction-aware Wilson lower bound (95%) computed from aiSignalLog over last 30d
async function wilsonLbForDirection(token: string, direction: "LONG" | "SHORT"): Promise<number | null> {
  try {
    const { sql } = await import("drizzle-orm");
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await db.execute(sql`
      SELECT outcome, COUNT(*)::int AS n FROM ai_signal_log
      WHERE token=${token} AND direction=${direction}
        AND created_at >= ${cutoff}
        AND outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','SL_HIT','EXPIRED_WIN','EXPIRED_LOSS')
      GROUP BY outcome
    `);
    let wins = 0, total = 0;
    for (const r of (rows as any).rows ?? rows) {
      const n = Number(r.n);
      total += n;
      if (String(r.outcome).startsWith("TP") || r.outcome === "EXPIRED_WIN") wins += n;
    }
    if (total < 10) return null;
    const p = wins / total;
    const z = 1.96;
    const denom = 1 + (z * z) / total;
    const center = p + (z * z) / (2 * total);
    const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
    return (center - margin) / denom;
  } catch {
    return null;
  }
}

// In-memory cooldown to prevent write amplification when detectMoves repeatedly
// re-evaluates the same symbol every 5s and Phase 2A keeps blocking.
// Key: `${symbol}:${reasonHead}`, Value: epoch ms. Cooldown window = 90s.
const _phase2aBlockCooldown = new Map<string, number>();
const PHASE2A_BLOCK_COOLDOWN_MS = 90_000;

function _cooldownActive(symbol: string, reasonHead: string): boolean {
  const key = `${symbol}:${reasonHead}`;
  const last = _phase2aBlockCooldown.get(key);
  if (last && Date.now() - last < PHASE2A_BLOCK_COOLDOWN_MS) return true;
  return false;
}
function _markCooldown(symbol: string, reasonHead: string) {
  _phase2aBlockCooldown.set(`${symbol}:${reasonHead}`, Date.now());
  // bound the map
  if (_phase2aBlockCooldown.size > 1000) {
    const cutoff = Date.now() - PHASE2A_BLOCK_COOLDOWN_MS;
    for (const [k, v] of _phase2aBlockCooldown) if (v < cutoff) _phase2aBlockCooldown.delete(k);
  }
}

export async function generateSignalPhase2A(ctx: Phase2ACtx): Promise<Phase2AResult> {
  // 1) Wilson LB (combined long+short for this symbol — direction-faithful, not biased)
  // Scorer doesn't know side yet, so we use combined history rather than max(long,short).
  let wilsonLb: number | null = null;
  try {
    const { sql } = await import("drizzle-orm");
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows: any = await db.execute(sql`
      SELECT outcome, COUNT(*)::int AS n FROM ai_signal_log
      WHERE token=${ctx.symbol} AND created_at >= ${cutoff}
        AND outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','SL_HIT','EXPIRED_WIN','EXPIRED_LOSS')
      GROUP BY outcome
    `);
    let wins = 0, total = 0;
    for (const r of rows.rows ?? rows) {
      const n = Number(r.n);
      total += n;
      if (String(r.outcome).startsWith("TP") || r.outcome === "EXPIRED_WIN") wins += n;
    }
    if (total >= 10) {
      const p = wins / total;
      const z = 1.96;
      const denom = 1 + (z * z) / total;
      const center = p + (z * z) / (2 * total);
      const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
      wilsonLb = (center - margin) / denom;
    }
    if (wilsonLb == null) {
      const at = await db.select().from(adaptiveThresholds)
        .where(eq(adaptiveThresholds.token, ctx.symbol))
        .orderBy(desc(adaptiveThresholds.updatedAt))
        .limit(1);
      if (at[0]?.winRate30d != null) wilsonLb = Number(at[0].winRate30d) / 100;
    }
  } catch { /* fall through with null */ }

  // 2) Python scorer
  let score: QuantScoreResponse;
  try {
    score = await quantScore({
      symbol: ctx.symbol,
      timeframe: ctx.timeframe,
      ohlcv: ctx.ohlcv,
      daily_returns: ctx.dailyReturns ?? [],
      equity_usd: ctx.equityUsd,
      conviction: ctx.convictionHint,
      wilson_lb: wilsonLb,
      stocktwits_score: ctx.stocktwitsScore ?? null,
      asset_class: ctx.assetClass,
      planned_rr: 2.0,
    });
  } catch (e) {
    return { emitted: false, reason: `quant_unreachable:${(e as Error).message}` };
  }

  if (!score.passes) {
    if (!_cooldownActive(ctx.symbol, "scorer")) {
      _markCooldown(ctx.symbol, "scorer");
      await logAi({
        source: "phase2a_scorer",
        token: ctx.symbol,
        direction: (score.side || "long").toUpperCase(),
        entryPrice: String(score.entry_ref),
        thesis: `Quant pre-filter blocked: ${score.gates_failed.join(", ")}`,
        invalidation: `regime=${score.regime}, composite_z=${score.composite_z.toFixed(2)}`,
        scores: score as any,
        conviction: 0,
        outcome: "EXPIRED_LOSS",
      });
    }
    return { emitted: false, reason: `scorer_blocked:${score.gates_failed.join(",")}`, score };
  }

  // 3) Cost / EV gate
  const advRows = ctx.ohlcv ?? [];
  const adv = advRows.slice(-1440).reduce((a, r) => a + (r[5] || 0) * (r[4] || 0), 0);
  const expectedAlphaBps = Math.abs(score.composite_z) * score.sigma_ann * 10_000 / Math.sqrt(365);
  let cost: QuantCostResponse;
  try {
    cost = await quantCost({
      symbol: ctx.symbol,
      order_usd: Math.max(score.suggested_size_usd, 1),
      adv_usd: Math.max(adv, 1),
      sigma_daily_dec: score.sigma_ann / Math.sqrt(365),
      expected_alpha_bps: expectedAlphaBps,
      asset_class: ctx.assetClass,
    });
  } catch (e) {
    return { emitted: false, reason: `cost_unreachable:${(e as Error).message}`, score };
  }

  if (!cost.ev_pass) {
    if (!_cooldownActive(ctx.symbol, "cost")) {
      _markCooldown(ctx.symbol, "cost");
      await logAi({
        source: "phase2a_cost",
        token: ctx.symbol,
        direction: (score.side || "long").toUpperCase(),
        entryPrice: String(score.entry_ref),
        thesis: `EV fail: alpha ${expectedAlphaBps.toFixed(1)}bps vs cost ${cost.total_bps.toFixed(1)}bps`,
        invalidation: `Need alpha >= 2x cost (${(2 * cost.total_bps).toFixed(1)}bps)`,
        scores: { score, cost } as any,
        conviction: 0,
        outcome: "EXPIRED_LOSS",
      });
    }
    return { emitted: false, reason: "ev_blocked", score, cost };
  }

  // 4) Claude VETO-ONLY (raw fetch to match codebase pattern)
  const vetoPrompt =
    `You are a risk officer. The quant model produced a ${score.side?.toUpperCase()} signal on ${ctx.symbol} ` +
    `with composite z-score ${score.composite_z.toFixed(2)}, regime "${score.regime}", ` +
    `entry ~${score.entry_ref}, SL ${score.sl}, TP ${score.tp}. ` +
    `Veto ONLY if explicit news/macro right now invalidates this thesis. ` +
    `Return STRICT JSON: {"veto": boolean, "reason": string}. No prose outside JSON.`;
  let veto: { veto: boolean; reason: string } = { veto: false, reason: "" };
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 200,
          messages: [{ role: "user", content: vetoPrompt }],
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const j: any = await r.json();
        const text = j?.content?.[0]?.text ?? "";
        const m = text.match(/\{[\s\S]*\}/);
        if (m) veto = JSON.parse(m[0]);
      }
    }
  } catch {
    // parse/network failure → do NOT veto, quant decision stands
  }

  if (veto.veto) {
    await logAi({
      source: "phase2a_veto",
      token: ctx.symbol,
      direction: (score.side || "long").toUpperCase(),
      entryPrice: String(score.entry_ref),
      thesis: `Claude veto: ${veto.reason}`,
      invalidation: `Quant said go but Claude saw a news/macro reason to abstain`,
      scores: { score, cost, veto } as any,
      conviction: 0,
      outcome: "EXPIRED_LOSS",
    });
    return { emitted: false, reason: `claude_veto:${veto.reason}`, score, cost, veto };
  }

  // 5) Emit
  const signal = {
    symbol: ctx.symbol,
    side: score.side,
    entry: score.entry_ref,
    sl: score.sl,
    tp: score.tp,
    sizeUsd: score.suggested_size_usd,
    compositeZ: score.composite_z,
    regime: score.regime,
    slAtrMult: score.sl_atr_mult,
    tpAtrMult: score.tp_atr_mult,
    factors: score.factors,
  };
  await logAi({
    source: "phase2a",
    token: ctx.symbol,
    direction: (score.side || "long").toUpperCase(),
    tradeType: ctx.timeframe.toUpperCase(),
    entryPrice: String(score.entry_ref),
    tp1Price: score.tp != null ? String(score.tp) : null,
    stopLoss: score.sl != null ? String(score.sl) : null,
    thesis: `Phase2A emit: composite_z=${score.composite_z.toFixed(2)}, regime=${score.regime}`,
    invalidation: `SL at ${score.sl} (${(score.sl_pct * 100).toFixed(2)}%)`,
    scores: { signal, score, cost, veto } as any,
    conviction: Math.min(100, Math.round(Math.abs(score.composite_z) * 33)),
    outcome: "PENDING",
  });
  return { emitted: true, signal, score, cost, veto };
}
```

#### `client/src/tabs/AITab.jsx`
```jsx
import { useState } from "react";
import ModeToggle from "../components/ai/ModeToggle.jsx";
import TopTradeIdeas from "../components/ai/TopTradeIdeas.jsx";
import QuantScanner from "../components/ai/QuantScanner.jsx";
import AIChat from "../components/ai/AIChat.jsx";
import KronosPanel from "../components/KronosPanel.jsx";

const MONO = "'IBM Plex Mono', monospace";
const SERIF = "'Playfair Display', Georgia, serif";

export default function AITab({
  isPro, isElite, isPreview,
  storePerps, storeSpot, cryptoPrices, equityPrices, metalPrices, forexPrices,
  liveSignals, newsFeed, macroEvents, insiderData, regimeData,
  storeMode, storeTotalMarkets, storeAlerts,
  allPrices, fmt, onUpgrade, onAlertCreated,
}) {
  const [mode, setMode] = useState("simple");

  const tierLabel = isElite ? "ELITE" : isPro ? "PRO" : "FREE";
  const tierColor = isElite ? "#c9a84c" : isPro ? "#22c55e" : "rgba(255,255,255,0.3)";

  return (
    <div style={{ backgroundColor: "#060a13", minHeight: "100vh", padding: "20px 16px", fontFamily: MONO, color: "#e0e0e0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(201,168,76,0.12)", paddingBottom: 14, marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontFamily: SERIF, color: "#e0e0e0", fontWeight: 700 }}>CLVR AI</h2>
          <div style={{ fontSize: 7, color: "rgba(255,255,255,0.25)", letterSpacing: "0.12em", marginTop: 3 }}>
            QUANTBRAIN · MACRO PRE-FLIGHT · CLAUDE SONNET
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ModeToggle mode={mode} onChange={setMode} isPro={isPro} />
          <div style={{
            border: `1px solid ${tierColor}`, color: tierColor,
            padding: "4px 10px", borderRadius: 5,
            fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", fontFamily: MONO,
          }}>{tierLabel}</div>
        </div>
      </div>

      <TopTradeIdeas
        mode={mode} isElite={isElite} isPro={isPro} isPreview={isPreview}
        storePerps={storePerps} storeSpot={storeSpot}
        cryptoPrices={cryptoPrices} equityPrices={equityPrices}
        metalPrices={metalPrices} forexPrices={forexPrices}
        liveSignals={liveSignals} newsFeed={newsFeed}
        macroEvents={macroEvents} insiderData={insiderData}
        regimeData={regimeData} storeMode={storeMode}
        storeTotalMarkets={storeTotalMarkets} storeAlerts={storeAlerts}
        onAlertCreated={onAlertCreated}
      />

      {isPro && (
        <>
          <div style={{ height: 1, background: "rgba(201,168,76,0.08)", margin: "24px 0" }} />
          <QuantScanner mode={mode} isPro={isPro} isElite={isElite} />
        </>
      )}

      {/* ── KRONOS FORECAST ENGINE (Elite) — forecasts feed into Trade Ideas above ── */}
      <div style={{ height: 1, background: "rgba(155,140,255,0.10)", margin: "24px 0" }} />
      {isElite ? (
        <KronosPanel />
      ) : (
        <div
          onClick={onUpgrade}
          style={{
            background: "rgba(155,140,255,0.04)",
            border: "1px solid rgba(155,140,255,0.18)",
            borderRadius: 10, padding: "14px 16px", marginBottom: 12,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            cursor: "pointer",
          }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: "#9b8cff", fontWeight: 800, letterSpacing: 1.5 }}>
              ⏱ KRONOS FORECAST ENGINE
            </div>
            <div style={{ fontFamily: MONO, fontSize: 8, color: "rgba(255,255,255,0.45)", marginTop: 4, lineHeight: 1.5 }}>
              Multi-trajectory K-line forecasting · 5-candle BULL/BASE/BEAR trajectories.<br/>
              Elite signals also feed into the Top Trade Ideas generator above for sharper predictions.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <div style={{ fontFamily: MONO, fontSize: 9, color: "#9b8cff", background: "rgba(155,140,255,0.1)", border: "1px solid rgba(155,140,255,0.25)", borderRadius: 3, padding: "3px 8px" }}>ELITE</div>
            <div style={{ fontSize: 15 }}>🔒</div>
          </div>
        </div>
      )}

      {isPro && (
        <>
          <div style={{ height: 1, background: "rgba(201,168,76,0.08)", margin: "24px 0" }} />
          <AIChat
            storePerps={storePerps} storeSpot={storeSpot}
            cryptoPrices={cryptoPrices} equityPrices={equityPrices}
            metalPrices={metalPrices} forexPrices={forexPrices}
            liveSignals={liveSignals} newsFeed={newsFeed}
            macroEvents={macroEvents} insiderData={insiderData}
            regimeData={regimeData} storeMode={storeMode}
            storeTotalMarkets={storeTotalMarkets} storeAlerts={storeAlerts}
            isPro={isPro} isElite={isElite}
            allPrices={allPrices} fmt={fmt}
          />
        </>
      )}

      {!isPro && (
        <div style={{ textAlign: "center", padding: "32px 16px", background: "rgba(201,168,76,0.04)", border: "1px solid rgba(201,168,76,0.15)", borderRadius: 12, marginTop: 24 }}>
          <div style={{ fontSize: 24, marginBottom: 10 }}>✦</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e8c96d", fontFamily: SERIF, marginBottom: 8 }}>Unlock Full AI Suite</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: "'Barlow', sans-serif", lineHeight: 1.7, marginBottom: 16 }}>
            Upgrade to Pro for Quant Scanner, Ask AI chat, and more trade ideas.
          </div>
          {onUpgrade && (
            <button data-testid="btn-upgrade-ai" onClick={onUpgrade} style={{
              padding: "10px 24px", borderRadius: 8,
              background: "linear-gradient(135deg, rgba(201,168,76,0.2), rgba(201,168,76,0.1))",
              border: "1px solid rgba(201,168,76,0.4)", color: "#e8c96d",
              fontFamily: SERIF, fontWeight: 700, fontSize: 13, cursor: "pointer",
            }}>Upgrade to Pro</button>
          )}
        </div>
      )}

      <div style={{ textAlign: "center", padding: "16px 0", marginTop: 16 }}>
        <div style={{ fontSize: 7, color: "rgba(255,255,255,0.15)", fontFamily: MONO, letterSpacing: "0.1em" }}>
          AI analysis only. Always apply your own judgment and risk management.
        </div>
      </div>
    </div>
  );
}
```

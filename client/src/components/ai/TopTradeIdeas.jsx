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

      const snap = buildMarketSnapshot({
        storePerps, storeSpot, cryptoPrices, equityPrices, metalPrices, forexPrices,
        liveSignals, newsFeed, macroEvents, insiderData, regimeData,
        storeMode, storeTotalMarkets, storeAlerts,
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
        ? `MARKET TYPE FILTER: PERP ONLY. Recommend ONLY perpetual futures / leveraged trades. Use Hyperliquid perp data (Section A) as primary. Include leverage suggestion on every trade (respect asset class caps). Tight SL. Thesis must reference funding rate, OI, or liquidation levels. Every trade MUST set "marketType":"PERP".`
        : marketTypeFilter === "SPOT"
        ? `MARKET TYPE FILTER: SPOT ONLY. Recommend ONLY spot / cash trades. NO leverage — set "leverage":"1x" on every trade. Use Section B (HL spot) and Section C (CoinGecko/Finnhub). Thesis should reference accumulation zones, DCA levels, or portfolio allocation. SL can be wider, kill clock can be longer. Every trade MUST set "marketType":"SPOT".`
        : `MARKET TYPE FILTER: BOTH. Mix of PERP and SPOT opportunities — diversify across both. For each trade, label "marketType":"PERP" or "SPOT" explicitly. PERP trades: include leverage suggestion, tight SL, funding/OI rationale. SPOT trades: "leverage":"1x", wider SL acceptable, accumulation/DCA rationale.`;

      const sys = `You are CLVRQuantAI's Trade Idea Generator. Return exactly ${tradeCount} trade ideas as a JSON object. No markdown. No prose. Only valid JSON.

${marketTypeRule}
${todayModeRule}

MANDATORY STEP 1 — MACRO PRE-FLIGHT CHECK:
${macroCtx || "No macro data available. Proceed with CAUTION flag."}

RULES:
- Return EXACTLY ${tradeCount} trades, ranked by conviction (highest first)
- Cover diverse assets (crypto, equity, FX, commodity — don't repeat unless one class dominates)
- ATR-scaled TP/SL: TP1=0.5x ATR(4H) at 50%, TP2=1x ATR at 30%, TP3=1.5x ATR at 20% trailing
- Vol regime: compare ATR to 20-period avg. HIGH(>1.5x): compress TP 30%, widen SL 20%. LOW(<0.7x): skip.
- Minimum R:R to TP1: 1.2:1
- Kill clock: SCALP 2-4H, DAY 12-24H, SWING 48-72H
- Edge label: "OI-verified" if live OI, "estimated" if inferred, "no OI" if unavailable
- Timeframe focus: ${tfLabel}
- ${isElite ? 'For qualifying signals with extreme conviction (>80%), OI confirmation, AND multi-TF confluence, set kronos:true. Maximum 2 Kronos per batch.' : 'Set kronos:false for all trades.'}

TODAY: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} | ET: ${snap.nowET}

${snap.sections}

RESPOND WITH THIS EXACT JSON STRUCTURE — nothing else:
{"generated":"ISO-DATE","regime":{"score":63,"label":"RISK-ON","bias":"Mean-Reversion"},"macroStatus":{"clear":true,"nextEvent":"Event name","notes":"..."},"volRegime":"HIGH","trades":[{"rank":1,"asset":"BTC/USDT","direction":"LONG","tradeType":"DAY TRADE","marketType":"PERP","entry":65000,"sl":63500,"tp1":{"price":67000,"pct":50,"rr":"1.3:1"},"tp2":{"price":69000,"pct":30,"rr":"2.4:1"},"tp3":{"price":71000,"pct":20,"trailing":true},"leverage":"3x","killClock":"24H","conviction":72,"edge":"72%","edgeSource":"OI-verified","volRegime":"NORMAL","thesis":"Short thesis.","invalidation":"Break below $63.5K","flags":["flag1"],"scores":{"trend":75,"momentum":80,"structure":68,"oi":65,"volume":55,"macro":70},"postTp1":"SL to breakeven","kronos":false}]}`;

      const userMsg = `Generate ${tfLabel} TOP ${tradeCount} TRADE IDEAS. Return ONLY valid JSON matching the structure. No markdown, no text. Use live prices.`;

      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system: sys, userMessage: userMsg, maxTokens }),
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
            {[{ k: "today", l: "Today" }, { k: "midterm", l: "Mid" }, { k: "longterm", l: "Long" }].map(t => (
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
        <div style={{ display: "flex", gap: 4, marginBottom: 10, alignItems: "center" }}>
          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: MONO, letterSpacing: "0.1em", marginRight: 2 }}>MARKET:</span>
          {["PERP", "SPOT", "BOTH"].map(m => {
            const col = m === "PERP" ? "#00d4ff" : m === "SPOT" ? "#a855f7" : "#e8c96d";
            const sel = marketTypeFilter === m;
            return (
              <button key={m} data-testid={`btn-market-${m}`} onClick={() => setMarketTypeFilter(m)} style={{
                padding: "5px 12px", borderRadius: 6,
                border: `1px solid ${sel ? col : "rgba(255,255,255,0.08)"}`,
                background: sel ? `${col}15` : "transparent",
                color: sel ? col : "rgba(255,255,255,0.4)",
                fontFamily: MONO, fontSize: 9, cursor: "pointer", fontWeight: sel ? 700 : 400, letterSpacing: "0.06em",
              }}>{m}</button>
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

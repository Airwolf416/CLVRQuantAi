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
  const abortRef = useRef(null);

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
    // Capture prior turns BEFORE appending the new user message so the just-
    // typed turn isn't duplicated. Last 8 turns, content clamped to 4000.
    const history = messages.slice(-8).map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Independent pre-fetches run concurrently; each resolves to null on
      // failure so one never blocks or fails the other.
      const [preflight, eligibleMap] = await Promise.all([
        fetch("/api/macro/preflight", { credentials: "include" })
          .then(r => (r.ok ? r.json() : null))
          .catch(() => null),
        getEligibleExecutionSymbols().catch(() => null),
      ]);

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
        // Fetch all eligible symbols concurrently; Promise.all preserves the
        // original `mentions` order, and filter(Boolean) drops the misses.
        const settled = await Promise.all(mentions.map(async (sym) => {
          try {
            const r = await fetch(`/api/execution_levels/${sym}`, { credentials: "include" });
            if (!r.ok) return null;
            const lvl = await r.json();
            const dec = lvl.current_price < 10 ? 4 : 2;
            const f = (n) => Number(n).toFixed(dec);
            const rangePos = lvl.in_or_range ? "inside" : (lvl.current_price > lvl.orh ? "above" : "below");
            const ts = new Date(lvl.current_ts).toISOString().slice(11, 16) + " UTC";
            return (
              `EXECUTION CONTEXT (${lvl.symbol}, ${ts}):\n` +
              `- Session VWAP: $${f(lvl.vwap)} (price ${lvl.price_vs_vwap_pct >= 0 ? "+" : ""}${lvl.price_vs_vwap_pct}% away)\n` +
              `- VWAP bands: $${f(lvl.vwap_lower_1sd)} / $${f(lvl.vwap_upper_1sd)}\n` +
              `- Opening Range: $${f(lvl.orl)} — $${f(lvl.orh)} (width ${lvl.or_width_pct}%)\n` +
              `- Current price: $${f(lvl.current_price)} (${rangePos} opening range)\n` +
              `- ORB status: ${lvl.orb_status}`
            );
          } catch { return null; }
        }));
        const blocks = settled.filter(Boolean);
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
        body: JSON.stringify({ system: sys, userMessage: userMsg, history }),
        signal: controller.signal,
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
      // Aborts are handled by stopGeneration (which already appended the
      // cancellation notice) — never render them as an error.
      if (e.name !== "AbortError") {
        setMessages(prev => [...prev, { role: "assistant", content: `Error: ${e.message}` }]);
      }
    } finally {
      abortRef.current = null;
    }
    setLoading(false);
  };

  const stopGeneration = () => {
    if (abortRef.current) abortRef.current.abort();
    setLoading(false);
    setMessages(prev => [...prev, { role: "assistant", content: "— response cancelled —" }]);
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
        {loading && (
          <button
            data-testid="btn-stop-ai"
            onClick={stopGeneration}
            style={{
              padding: "11px 16px", borderRadius: 8,
              background: "rgba(201,168,76,0.06)",
              border: "1px solid rgba(201,168,76,0.3)",
              color: "#e8c96d", fontFamily: MONO, fontWeight: 700, fontSize: 10,
              letterSpacing: "0.1em", cursor: "pointer",
            }}
          >
            STOP
          </button>
        )}
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

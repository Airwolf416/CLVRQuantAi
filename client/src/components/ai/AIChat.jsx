import { useState, useRef, useEffect } from "react";
import { buildMarketSnapshot, buildMacroPreflightContext } from "../../utils/marketDataSnapshot.js";

const MONO = "'IBM Plex Mono', monospace";
const SERIF = "'Playfair Display', Georgia, serif";
const SANS = "'Barlow', system-ui, sans-serif";

const QUICK_CHIPS = ["BTC", "ETH", "SOL", "TRUMP", "HYPE", "XAU", "WTI", "EURUSD", "TSLA", "NVDA"];

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

      const snap = buildMarketSnapshot({
        storePerps, storeSpot, cryptoPrices, equityPrices, metalPrices, forexPrices,
        liveSignals, newsFeed, macroEvents, insiderData, regimeData,
        storeMode, storeTotalMarkets, storeAlerts,
      });

      const macroCtx = buildMacroPreflightContext(preflight);

      const sys = `You are CLVRQuantAI's AI Analyst for leveraged perp futures across crypto, FX, commodities, and equities. Be direct, data-driven, no fluff.

MANDATORY STEP 1 — MACRO PRE-FLIGHT:
${macroCtx || "No macro data. Proceed with CAUTION."}

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
              marginBottom: 12, padding: "10px 12px",
              background: m.role === "user" ? "rgba(201,168,76,0.06)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${m.role === "user" ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.04)"}`,
              borderRadius: 8,
            }}>
              <div style={{ fontSize: 7, color: m.role === "user" ? "#c9a84c" : "#22c55e", fontFamily: MONO, letterSpacing: "0.1em", marginBottom: 4 }}>
                {m.role === "user" ? "YOU" : "CLVR AI"}
              </div>
              <div style={{
                fontSize: 11, color: "#e0e0e0", fontFamily: SANS, lineHeight: 1.8,
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>{m.content}</div>
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

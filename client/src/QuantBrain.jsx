import { useState, useEffect, useCallback } from "react";
import QuantStatusCard from "./components/QuantStatusCard";

const C = {
  bg:"#050709", panel:"#0c1220", border:"#141e35", border2:"#1c2b4a",
  gold:"#c9a84c", gold2:"#e8c96d", gold3:"#f7e0a0",
  text:"#c8d4ee", muted:"#4a5d80", muted2:"#6b7fa8", white:"#f0f4ff",
  green:"#00c787", red:"#ff4060", orange:"#ff8c00",
  cyan:"#00d4ff", blue:"#3b82f6", inputBg:"#080d18",
};
const SERIF = "'Playfair Display', Georgia, serif";
const MONO  = "'IBM Plex Mono', monospace";
const SANS  = "'Barlow', system-ui, sans-serif";

function calcConfluence(signals) {
  let score = 0;
  const breakdown = [];

  if (signals.fundingRate > 0.01) { score -= 1; breakdown.push({ label: "Funding Rate", note: "Positive — longs overcrowded", val: -1 }); }
  else if (signals.fundingRate < -0.01) { score += 1; breakdown.push({ label: "Funding Rate", note: "Negative — shorts overcrowded", val: +1 }); }
  else breakdown.push({ label: "Funding Rate", note: "Neutral", val: 0 });

  if (signals.volumeSpike >= 2) { score += 1; breakdown.push({ label: "Volume Spike", note: `${signals.volumeSpike.toFixed(1)}x avg — momentum`, val: +1 }); }
  else breakdown.push({ label: "Volume", note: "No significant spike", val: 0 });

  if (signals.oiTrend === "rising") { score += 1; breakdown.push({ label: "Open Interest", note: "Rising OI — new money entering", val: +1 }); }
  else if (signals.oiTrend === "falling") { score -= 1; breakdown.push({ label: "Open Interest", note: "Falling OI — positions closing", val: -1 }); }
  else breakdown.push({ label: "Open Interest", note: "Flat", val: 0 });

  if (signals.polyBTC100k > 60) { score += 1; breakdown.push({ label: "Polymarket BTC $100k", note: `${signals.polyBTC100k}% YES — bullish consensus`, val: +1 }); }
  else if (signals.polyBTC100k < 25) { score -= 1; breakdown.push({ label: "Polymarket BTC $100k", note: `${signals.polyBTC100k}% YES — bearish consensus`, val: -1 }); }
  else breakdown.push({ label: "Polymarket BTC $100k", note: `${signals.polyBTC100k}% YES — neutral`, val: 0 });

  if (signals.polyFedCut > 60) { score += 1; breakdown.push({ label: "Polymarket Fed Cut", note: `${signals.polyFedCut}% YES — macro tailwind`, val: +1 }); }
  else if (signals.polyFedCut < 20) { score -= 1; breakdown.push({ label: "Polymarket Fed Cut", note: `${signals.polyFedCut}% YES — macro headwind`, val: -1 }); }
  else breakdown.push({ label: "Polymarket Fed Cut", note: `${signals.polyFedCut}% YES — neutral`, val: 0 });

  if (signals.socialSentiment === "bullish") { score += 1; breakdown.push({ label: "Social Sentiment", note: "Bullish dominant", val: +1 }); }
  else if (signals.socialSentiment === "bearish") { score -= 1; breakdown.push({ label: "Social Sentiment", note: "Bearish dominant", val: -1 }); }
  else breakdown.push({ label: "Social Sentiment", note: "Mixed/neutral", val: 0 });

  if (signals.liqAbove > signals.liqBelow * 1.5) { score -= 1; breakdown.push({ label: "Liq Heatmap", note: "Heavy liq cluster above — resistance", val: -1 }); }
  else if (signals.liqBelow > signals.liqAbove * 1.5) { score += 1; breakdown.push({ label: "Liq Heatmap", note: "Heavy liq cluster below — support", val: +1 }); }
  else breakdown.push({ label: "Liq Heatmap", note: "Balanced", val: 0 });

  if (signals.fearGreed >= 75) { score -= 1; breakdown.push({ label: "Fear & Greed", note: `${signals.fearGreed} — Extreme Greed (fade)`, val: -1 }); }
  else if (signals.fearGreed <= 25) { score += 1; breakdown.push({ label: "Fear & Greed", note: `${signals.fearGreed} — Extreme Fear (buy)`, val: +1 }); }
  else breakdown.push({ label: "Fear & Greed", note: `${signals.fearGreed} — Neutral`, val: 0 });

  const regime = signals.volumeSpike >= 2 && signals.oiTrend === "rising" ? "momentum" : "mean_reversion";
  return { score, breakdown, regime, maxScore: 8 };
}

function kelly(winRate, rewardRiskRatio) {
  const w = winRate / 100;
  const r = rewardRiskRatio;
  const k = w - (1 - w) / r;
  return Math.max(0, Math.min(k * 100, 25));
}

function scoreToProbability(score) {
  const normalized = score / 8;
  const prob = 50 + normalized * 40;
  return Math.max(5, Math.min(95, prob));
}

export default function QuantBrainPanel({ cryptoPrices, walletData }) {
  const [signals, setSignals] = useState({
    fundingRate: 0.005,
    volumeSpike: 1.2,
    oiTrend: "flat",
    polyBTC100k: 38,
    polyFedCut: 14,
    socialSentiment: "neutral",
    liqAbove: 50,
    liqBelow: 50,
    fearGreed: 45,
  });

  const [tradeSetup, setTradeSetup] = useState({
    asset: "BTC",
    direction: "long",
    entry: "",
    target: "",
    stop: "",
    accountSize: "10000",
  });

  const [aiResponse, setAiResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("signals");

  useEffect(() => {
    if (!cryptoPrices) return;
    const btc = cryptoPrices["BTC"];
    if (btc) {
      if (btc.funding !== undefined) setSignals(s => ({ ...s, fundingRate: btc.funding }));
      if (btc.volume > 0 && btc.volHistory?.length >= 5) {
        const avg = btc.volHistory.slice(-5).reduce((a, b) => a + b, 0) / 5;
        if (avg > 0) setSignals(s => ({ ...s, volumeSpike: btc.volume / avg }));
      }
      if (btc.oiHistory?.length >= 2) {
        const last = btc.oiHistory[btc.oiHistory.length - 1];
        const prev = btc.oiHistory[btc.oiHistory.length - 2];
        const trend = last > prev * 1.02 ? "rising" : last < prev * 0.98 ? "falling" : "flat";
        setSignals(s => ({ ...s, oiTrend: trend }));
      }
    }
  }, [cryptoPrices]);

  const { score, breakdown, regime, maxScore } = calcConfluence(signals);
  const probability = scoreToProbability(score);

  const entry = parseFloat(tradeSetup.entry);
  const target = parseFloat(tradeSetup.target);
  const stop = parseFloat(tradeSetup.stop);
  const rr = entry && target && stop
    ? tradeSetup.direction === "long"
      ? (target - entry) / (entry - stop)
      : (entry - target) / (stop - entry)
    : 2;

  const winRate = probability;
  const kellyPct = kelly(winRate, Math.max(rr, 0.1));
  const accountSize = parseFloat(tradeSetup.accountSize) || 10000;
  const positionSize = (accountSize * kellyPct / 100).toFixed(2);

  const conviction =
    score >= 5 ? { label: "HIGH CONVICTION LONG", color: C.green, bg: "rgba(0,199,135,.08)" } :
    score >= 3 ? { label: "MODERATE LONG BIAS", color: C.green, bg: "rgba(0,199,135,.05)" } :
    score <= -5 ? { label: "HIGH CONVICTION SHORT", color: C.red, bg: "rgba(255,64,96,.08)" } :
    score <= -3 ? { label: "MODERATE SHORT BIAS", color: C.red, bg: "rgba(255,64,96,.05)" } :
    { label: "NO EDGE — STAY OUT", color: C.muted2, bg: C.panel };

  const askAI = useCallback(async () => {
    setLoading(true);
    setAiResponse(null);
    const { score: s2, breakdown: bd, regime: rg } = calcConfluence(signals);
    const prob = scoreToProbability(s2);
    const k = kelly(prob, Math.max(rr, 0.1));

    const systemPrompt = `You are CLVRQuantAI's Quant Engine. You are a computation engine, not a chatbot. Output structured signal data only — no markdown, no prose preamble.

PIPELINE — execute in order for every request:
1. CLASSIFY trade type: SCALP|DAY TRADE|SWING|POSITION (default DAY TRADE)
2. VOL REGIME: current ATR vs 20-period avg. HIGH(>1.5x)|NORMAL(0.7-1.5x)|LOW(<0.7x)
3. MACRO GATE: block if high-impact event within 2H, dampen if within 4H
4. SCORE: Trend(25%), Momentum(20%), Structure(20%), OI(15%), Volume(10%), Macro(10%). Each 0-100. Net edge = weighted sum. Below 55% = no signal.
5. ENTRY: Use fib retracement of last impulse. 38.2-50% for trend, 50-61.8% for mean reversion.
6. TP/SL: ATR-scaled. TP1=0.5x ATR(50%), TP2=1x ATR(30%), TP3=1.5x ATR(20% trail). SL per trade type. HIGH vol: compress TP 30%, widen SL 20%.
7. SIZING: Half-Kelly adjusted for vol regime. Leverage caps: BTC/ETH 10x, large alt 7x, mid alt 5x, small alt 3x, FX major 20x, FX cross 10x, commodities 10x.
8. KILL CLOCK: SCALP 2-4H, DAY 12-24H, SWING 48-72H, POSITION 5-7D.

ASSET SUITABILITY: Mid/small cap alts cannot be scalped. Flag and suggest DAY TRADE instead.
EDGE LABELS: "OI-verified" if live OI data, "estimated" if delayed/inferred, "no OI" if unavailable.
R:R FLOOR: TP1 R:R must be >= 1.2:1 or reject signal.

OUTPUT FORMAT:
━━ CLVRQUANTAI SIGNAL ━━━
[🟢/🔴] [ASSET]/USDT [LONG/SHORT]
Type: [trade type] | Vol: [regime] | Edge: [XX]% ([source])
Score: Trend XX | Mom XX | Struct XX | OI XX | Vol XX | Macro XX
Entry: [price] | TP1: [price] (50%) R:R [X:1] | TP2: [price] (30%) | TP3: [price] (20% trail) | SL: [price] | Liq: ~[price] at [X]x
Sizing: [Half-Kelly %] at [X]x | Kill: [X]H
Thesis: [1-2 sentences] | Invalidation: [condition]
Post-TP1: SL→BE. Trail TP3 at 0.5x ATR.

If no signal qualifies:
━━ NO SIGNAL ━━━
[ASSET]/USDT — Rejected. Reason: [why]. Next check: [when].`;

    const userPrompt = `Analyze this trade setup using full quantitative rigor AND provide today's top trade ideas with correlated plays:

ASSET: ${tradeSetup.asset}
DIRECTION: ${tradeSetup.direction.toUpperCase()}
ENTRY: $${tradeSetup.entry || "not set"}
TARGET: $${tradeSetup.target || "not set"}
STOP: $${tradeSetup.stop || "not set"}
ACCOUNT SIZE: $${accountSize}
R/R RATIO: ${rr.toFixed(2)}

CONFLUENCE SCORE: ${s2} / ${maxScore} (${s2 > 0 ? "+" : ""}${s2})
REGIME: ${rg === "momentum" ? "MOMENTUM" : "MEAN REVERSION"}
PROBABILITY ESTIMATE: ${prob.toFixed(1)}%
KELLY FRACTION: ${k.toFixed(1)}% = $${(accountSize * k / 100).toFixed(2)} position size

SIGNAL BREAKDOWN:
${bd.map(b => `- ${b.label}: ${b.note} (${b.val > 0 ? "+" : ""}${b.val})`).join("\n")}

POLYMARKET CONTEXT:
- BTC $100k: ${signals.polyBTC100k}% YES
- Fed Rate Cut: ${signals.polyFedCut}% YES
- Fear & Greed Index: ${signals.fearGreed}

${walletData ? `WALLET CONTEXT:\n- SOL Balance: ${walletData.balance} SOL\n- Holdings: ${walletData.tokens?.map(t => t.symbol).join(", ") || "none"}` : ""}

TODAY'S DATE: ${new Date().toDateString()}

Tasks:
1. Analyze the ${tradeSetup.direction} ${tradeSetup.asset} setup above
2. Give me TODAY'S TOP 3 TRADE IDEAS based on all signals (can include crypto, forex, metals)
3. For each trade idea list the correlated plays
4. Tell me which correlated trades have the best risk-adjusted return today`;

    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userPrompt, systemPrompt }),
      });
      const data = await res.json();
      setAiResponse(data.text || data.response || data.error || "No response.");
    } catch (e) {
      setAiResponse("Error calling AI: " + e.message);
    }
    setLoading(false);
  }, [signals, tradeSetup, rr, accountSize, walletData]);

  const card = { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 2, padding: 16, marginBottom: 12, overflow: "hidden" };
  const labelStyle = { fontSize: 10, color: C.muted2, marginBottom: 5, fontFamily: MONO, letterSpacing: "0.1em", textTransform: "uppercase" };
  const inputStyle = { width: "100%", background: C.inputBg, border: `1px solid ${C.border}`, borderRadius: 2, padding: "10px 12px", color: C.text, fontSize: 13, fontFamily: MONO, boxSizing: "border-box", outline: "none" };
  const selectStyle = { ...inputStyle, appearance: "none", WebkitAppearance: "none" };
  const row2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 };

  const tabBtn = (t, label) => (
    <button key={t} data-testid={`qb-tab-${t}`} onClick={() => setActiveTab(t)}
      style={{ padding: "6px 12px", borderRadius: 2, whiteSpace: "nowrap", cursor: "pointer", fontFamily: MONO, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase",
        border: `1px solid ${activeTab === t ? C.gold : C.border}`, background: activeTab === t ? "rgba(201,168,76,.07)" : C.panel, color: activeTab === t ? C.gold : C.muted2 }}>
      {label}
    </button>
  );

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <QuantStatusCard />
      </div>
      <div style={{ background: conviction.bg, border: `1px solid ${conviction.color}33`, borderRadius: 2, padding: "14px 16px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 9, color: C.muted, letterSpacing: "0.15em", marginBottom: 3 }}>CURRENT SIGNAL</div>
          <div data-testid="text-conviction" style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 900, color: conviction.color }}>{conviction.label}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div data-testid="text-score" style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 900, color: conviction.color }}>{score > 0 ? "+" : ""}{score}</div>
          <div style={{ fontFamily: MONO, fontSize: 9, color: C.muted }}>/ {maxScore} signals</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
        {[
          { label: "WIN PROB", value: `${probability.toFixed(0)}%`, color: probability >= 60 ? C.green : probability <= 40 ? C.red : C.orange },
          { label: "KELLY SIZE", value: `${kellyPct.toFixed(1)}%`, color: C.gold2 },
          { label: "REGIME", value: regime === "momentum" ? "MOM" : "MEAN REV", color: regime === "momentum" ? C.cyan : C.orange },
        ].map(m => (
          <div key={m.label} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 2, padding: "12px 8px", textAlign: "center" }}>
            <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, letterSpacing: "0.12em", marginBottom: 4 }}>{m.label}</div>
            <div style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 900, color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 14, overflowX: "auto", paddingBottom: 2 }}>
        {tabBtn("signals", "Signals")}
        {tabBtn("setup", "Trade Setup")}
        {tabBtn("kelly", "Kelly")}
        {tabBtn("analyst", "AI Analyst")}
      </div>

      {activeTab === "signals" && (
        <div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, marginBottom: 12, letterSpacing: "0.06em" }}>Adjust signals manually or auto-filled from live data</div>

          <div style={row2}>
            <div><div style={labelStyle}>Funding Rate (%)</div><input data-testid="qb-funding" type="number" step="0.001" value={signals.fundingRate} onChange={e => setSignals(s => ({ ...s, fundingRate: parseFloat(e.target.value) || 0 }))} style={inputStyle} /></div>
            <div><div style={labelStyle}>Volume Spike (x avg)</div><input data-testid="qb-vol" type="number" step="0.1" value={signals.volumeSpike} onChange={e => setSignals(s => ({ ...s, volumeSpike: parseFloat(e.target.value) || 0 }))} style={inputStyle} /></div>
          </div>

          <div style={row2}>
            <div>
              <div style={labelStyle}>OI Trend</div>
              <select data-testid="qb-oi" value={signals.oiTrend} onChange={e => setSignals(s => ({ ...s, oiTrend: e.target.value }))} style={selectStyle}>
                <option value="rising">Rising</option>
                <option value="flat">Flat</option>
                <option value="falling">Falling</option>
              </select>
            </div>
            <div>
              <div style={labelStyle}>Social Sentiment</div>
              <select data-testid="qb-social" value={signals.socialSentiment} onChange={e => setSignals(s => ({ ...s, socialSentiment: e.target.value }))} style={selectStyle}>
                <option value="bullish">Bullish</option>
                <option value="neutral">Neutral</option>
                <option value="bearish">Bearish</option>
              </select>
            </div>
          </div>

          <div style={row2}>
            <div><div style={labelStyle}>Polymarket BTC $100k (%)</div><input data-testid="qb-poly-btc" type="number" value={signals.polyBTC100k} onChange={e => setSignals(s => ({ ...s, polyBTC100k: parseFloat(e.target.value) || 0 }))} style={inputStyle} /></div>
            <div><div style={labelStyle}>Polymarket Fed Cut (%)</div><input data-testid="qb-poly-fed" type="number" value={signals.polyFedCut} onChange={e => setSignals(s => ({ ...s, polyFedCut: parseFloat(e.target.value) || 0 }))} style={inputStyle} /></div>
          </div>

          <div style={row2}>
            <div><div style={labelStyle}>Liq Cluster Above ($M)</div><input data-testid="qb-liq-above" type="number" value={signals.liqAbove} onChange={e => setSignals(s => ({ ...s, liqAbove: parseFloat(e.target.value) || 0 }))} style={inputStyle} /></div>
            <div><div style={labelStyle}>Liq Cluster Below ($M)</div><input data-testid="qb-liq-below" type="number" value={signals.liqBelow} onChange={e => setSignals(s => ({ ...s, liqBelow: parseFloat(e.target.value) || 0 }))} style={inputStyle} /></div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={labelStyle}>Fear & Greed Index (0-100)</div>
            <input data-testid="qb-fear-greed" type="range" min="0" max="100" value={signals.fearGreed}
              onChange={e => setSignals(s => ({ ...s, fearGreed: parseInt(e.target.value) }))}
              style={{ width: "100%", accentColor: C.gold }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 10, color: C.muted }}>
              <span>Extreme Fear</span>
              <span style={{ color: signals.fearGreed >= 75 ? C.red : signals.fearGreed <= 25 ? C.green : C.muted2, fontWeight: 700 }}>{signals.fearGreed}</span>
              <span>Extreme Greed</span>
            </div>
          </div>

          <div style={card}>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.gold, letterSpacing: "0.12em", marginBottom: 10 }}>SIGNAL BREAKDOWN</div>
            {breakdown.map((b, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < breakdown.length - 1 ? `1px solid ${C.border}` : "none" }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text, fontFamily: SANS }}>{b.label}</div>
                  <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>{b.note}</div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: b.val > 0 ? C.green : b.val < 0 ? C.red : C.muted, minWidth: 24, textAlign: "right", fontFamily: MONO }}>
                  {b.val > 0 ? "+" : ""}{b.val}
                </div>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, borderTop: `1px solid ${C.border2}`, marginTop: 4 }}>
              <span style={{ fontWeight: 700, fontFamily: SERIF, fontSize: 14, color: C.white }}>Total Score</span>
              <span style={{ fontWeight: 900, fontSize: 18, fontFamily: SERIF, color: score > 0 ? C.green : score < 0 ? C.red : C.muted2 }}>{score > 0 ? "+" : ""}{score} / {maxScore}</span>
            </div>
          </div>
        </div>
      )}

      {activeTab === "setup" && (
        <div>
          <div style={row2}>
            <div>
              <div style={labelStyle}>Asset</div>
              <select data-testid="qb-asset" value={tradeSetup.asset} onChange={e => setTradeSetup(s => ({ ...s, asset: e.target.value }))} style={selectStyle}>
                {["BTC", "ETH", "SOL", "XAU", "EURUSD", "TSLA", "NVDA", "TRUMP", "HYPE", "WIF"].map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Direction</div>
              <div style={{ display: "flex", gap: 6 }}>
                {["long", "short"].map(d => (
                  <button key={d} data-testid={`qb-dir-${d}`} onClick={() => setTradeSetup(s => ({ ...s, direction: d }))}
                    style={{ flex: 1, padding: "10px", borderRadius: 2, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 12, fontFamily: MONO, letterSpacing: "0.08em",
                      background: tradeSetup.direction === d ? (d === "long" ? "rgba(0,199,135,.12)" : "rgba(255,64,96,.12)") : C.panel,
                      color: tradeSetup.direction === d ? (d === "long" ? C.green : C.red) : C.muted }}>
                    {d.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={row2}>
            <div><div style={labelStyle}>Entry Price ($)</div><input data-testid="qb-entry" value={tradeSetup.entry} onChange={e => setTradeSetup(s => ({ ...s, entry: e.target.value }))} placeholder="95000" style={inputStyle} /></div>
            <div><div style={labelStyle}>Target Price ($)</div><input data-testid="qb-target" value={tradeSetup.target} onChange={e => setTradeSetup(s => ({ ...s, target: e.target.value }))} placeholder="100000" style={inputStyle} /></div>
          </div>

          <div style={row2}>
            <div><div style={labelStyle}>Stop Loss ($)</div><input data-testid="qb-stop" value={tradeSetup.stop} onChange={e => setTradeSetup(s => ({ ...s, stop: e.target.value }))} placeholder="92000" style={inputStyle} /></div>
            <div><div style={labelStyle}>Account Size ($)</div><input data-testid="qb-account" value={tradeSetup.accountSize} onChange={e => setTradeSetup(s => ({ ...s, accountSize: e.target.value }))} placeholder="10000" style={inputStyle} /></div>
          </div>

          {entry > 0 && target > 0 && stop > 0 && (
            <div style={{ ...card, border: `1px solid rgba(201,168,76,.18)` }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {[
                  { label: "R/R Ratio", value: rr.toFixed(2) + ":1", color: rr >= 2 ? C.green : rr >= 1 ? C.orange : C.red },
                  { label: "Risk $", value: "$" + Math.abs(tradeSetup.direction === "long" ? entry - stop : stop - entry).toFixed(0), color: C.red },
                  { label: "Reward $", value: "$" + Math.abs(tradeSetup.direction === "long" ? target - entry : entry - target).toFixed(0), color: C.green },
                ].map(m => (
                  <div key={m.label} style={{ textAlign: "center" }}>
                    <div style={{ fontFamily: MONO, fontSize: 9, color: C.muted, letterSpacing: "0.1em" }}>{m.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: m.color, fontFamily: SERIF }}>{m.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "kelly" && (
        <div>
          <div style={{ ...card, border: `1px solid rgba(201,168,76,.18)` }}>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.gold, letterSpacing: "0.12em", marginBottom: 14 }}>KELLY CRITERION POSITION SIZING</div>
            <div style={{ fontFamily: MONO, background: C.inputBg, borderRadius: 2, padding: 14, fontSize: 13, color: C.gold2, marginBottom: 16, lineHeight: 1.8, border: `1px solid ${C.border}` }}>
              Kelly % = W - (1 - W) / R<br />
              W = {probability.toFixed(1)}% win rate<br />
              R = {rr.toFixed(2)} reward/risk<br />
              <span style={{ color: C.green, fontWeight: 700 }}>Kelly = {kellyPct.toFixed(1)}%</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[
                { label: "Full Kelly", pct: kellyPct, note: "Max growth (volatile)" },
                { label: "Half Kelly", pct: kellyPct / 2, note: "Recommended (safer)" },
                { label: "Quarter Kelly", pct: kellyPct / 4, note: "Conservative" },
                { label: "Fixed 1%", pct: 1, note: "Beginner safe" },
              ].map(k => (
                <div key={k.label} style={{ background: C.inputBg, borderRadius: 2, padding: 14, border: `1px solid ${C.border}` }}>
                  <div style={{ fontFamily: MONO, fontSize: 9, color: C.muted, letterSpacing: "0.08em" }}>{k.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: C.gold2, fontFamily: SERIF }}>{k.pct.toFixed(1)}%</div>
                  <div style={{ fontSize: 13, color: C.green, fontFamily: MONO }}>${(accountSize * k.pct / 100).toFixed(2)}</div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 3, fontFamily: MONO }}>{k.note}</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 14, fontSize: 11, color: C.muted, lineHeight: 1.8, borderTop: `1px solid ${C.border}`, paddingTop: 12, fontFamily: SANS }}>
              <strong style={{ color: C.gold }}>Pro tip:</strong> Most quant funds use Half Kelly or less. Full Kelly maximizes long-run growth but causes painful drawdowns. Never risk more than 5% per trade regardless of Kelly output.
            </div>
          </div>

          <div style={card}>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.gold, letterSpacing: "0.12em", marginBottom: 12 }}>EXPECTED VALUE PER TRADE</div>
            {(() => {
              const w = probability / 100;
              const reward = entry && target ? Math.abs(tradeSetup.direction === "long" ? target - entry : entry - target) : 100;
              const risk = entry && stop ? Math.abs(tradeSetup.direction === "long" ? entry - stop : stop - entry) : 50;
              const posSize = accountSize * kellyPct / 100;
              const ev = (w * (posSize * reward / (entry || 1))) - ((1 - w) * (posSize * risk / (entry || 1)));
              return (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: MONO, fontSize: 9, color: C.muted, letterSpacing: "0.1em" }}>Expected Value (Kelly position)</div>
                  <div data-testid="text-ev" style={{ fontSize: 28, fontWeight: 900, color: ev >= 0 ? C.green : C.red, fontFamily: SERIF }}>
                    {ev >= 0 ? "+" : ""}${ev.toFixed(2)}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 4, fontFamily: MONO }}>per trade on avg at ${posSize.toFixed(2)} position</div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {activeTab === "analyst" && (
        <div>
          <div style={{ ...card, border: `1px solid rgba(201,168,76,.12)` }}>
            <div style={{ fontFamily: MONO, fontSize: 9, color: C.gold, letterSpacing: "0.15em", marginBottom: 10 }}>HOW QUANTBRAIN THINKS</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 5 }}>
              {[
                "Reasons from current signal data — not fixed rules",
                "Derives cross-asset relationships from macro context right now",
                "Challenges its own assumptions and flags conflicting signals",
                "Sizes positions via Kelly Criterion based on actual edge",
                "Gives 3 trade ideas built from today's data, not yesterday's playbook",
              ].map(text => (
                <div key={text} style={{ display: "flex", alignItems: "center", gap: 10, background: C.inputBg, borderRadius: 2, padding: "8px 12px", border: `1px solid ${C.border}` }}>
                  <span style={{ color: C.gold, fontSize: 10 }}>✦</span>
                  <span style={{ fontSize: 11, color: C.muted2, fontFamily: SANS }}>{text}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 14, lineHeight: 1.7, fontFamily: SANS }}>
            QuantBrain will analyze your setup, suggest <strong style={{ color: C.gold2 }}>today's top 3 trade ideas</strong>, and list correlated plays for each.
          </div>

          <button data-testid="button-quantbrain-analyze" onClick={askAI} disabled={loading}
            style={{ width: "100%", height: 48, background: loading ? C.panel : "rgba(201,168,76,.1)", border: `1px solid rgba(201,168,76,.35)`, color: loading ? C.muted : C.gold2, borderRadius: 2, cursor: loading ? "not-allowed" : "pointer", fontFamily: SERIF, fontWeight: 700, fontStyle: "italic", fontSize: 16, marginBottom: 14 }}>
            {loading ? "QuantBrain Analyzing..." : "Get Today's Trade Ideas + Analysis"}
          </button>

          {loading && (
            <div style={{ ...card, textAlign: "center", padding: 30 }}>
              <div style={{ fontFamily: SERIF, fontSize: 28, color: C.gold, marginBottom: 8 }}>QB</div>
              <div style={{ color: C.gold2, fontSize: 13, fontFamily: SANS }}>Running Bayesian analysis...</div>
              <div style={{ color: C.muted, fontSize: 11, marginTop: 4, fontFamily: MONO }}>Scoring {maxScore} signals · Calculating Kelly · Detecting regime</div>
            </div>
          )}

          {aiResponse && (
            <div style={{ ...card, border: `1px solid rgba(201,168,76,.18)` }}>
              <div style={{ fontFamily: MONO, fontSize: 9, color: C.gold, marginBottom: 10, letterSpacing: "0.15em" }}>QUANTBRAIN ANALYSIS</div>
              <div data-testid="text-qb-response" style={{ fontSize: 13, lineHeight: 1.9, color: C.text, whiteSpace: "pre-wrap", fontFamily: SANS, maxHeight: 500, overflowY: "auto" }}>{aiResponse}</div>
            </div>
          )}

          <div style={{ ...card, marginTop: 8 }}>
            <div style={{ fontFamily: MONO, fontSize: 9, color: C.muted, letterSpacing: "0.12em", marginBottom: 10 }}>CURRENT SNAPSHOT</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { l: "Confluence", v: `${score > 0 ? "+" : ""}${score} / ${maxScore}`, c: score > 2 ? C.green : score < -2 ? C.red : C.muted2 },
                { l: "Win Probability", v: `${probability.toFixed(0)}%`, c: probability > 60 ? C.green : probability < 40 ? C.red : C.orange },
                { l: "Kelly Size", v: `${kellyPct.toFixed(1)}%`, c: C.gold2 },
                { l: "Regime", v: regime === "momentum" ? "Momentum" : "Mean Rev", c: C.cyan },
                { l: "R/R", v: rr.toFixed(2) + ":1", c: rr >= 2 ? C.green : C.orange },
                { l: "Position $", v: `$${positionSize}`, c: C.green },
              ].map(({ l, v, c }) => (
                <div key={l} style={{ background: C.inputBg, borderRadius: 2, padding: "10px 12px", border: `1px solid ${C.border}` }}>
                  <div style={{ fontFamily: MONO, fontSize: 9, color: C.muted, letterSpacing: "0.08em" }}>{l}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: c, marginTop: 2, fontFamily: MONO }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

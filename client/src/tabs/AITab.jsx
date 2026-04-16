import { useState } from "react";
import ModeToggle from "../components/ai/ModeToggle.jsx";
import TopTradeIdeas from "../components/ai/TopTradeIdeas.jsx";
import QuantScanner from "../components/ai/QuantScanner.jsx";
import AIChat from "../components/ai/AIChat.jsx";

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

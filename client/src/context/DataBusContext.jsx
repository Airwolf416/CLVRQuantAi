import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// DataBusContext — CLVRQuant AI
//
// Single source of truth for backend-computed market intelligence:
//   • regime     — RISK_ON / RISK_OFF / NEUTRAL with score + trend
//   • fearGreed  — Fear & Greed index (alternative.me)
//   • killSwitch — Trading halt signal with reason + nearest macro event
//   • prices     — Backend price map (48 symbols, supplements HL)
//   • funding    — Funding rate map (32 crypto perps)
//   • oi         — Open interest map (32 crypto perps)
//   • freshness  — ms since last backend databus tick
//
// Polls /api/databus/status every 30s (backend refreshes on same cadence).
// ─────────────────────────────────────────────────────────────────────────────

const POLL_MS = 30_000;

const DEFAULT_REGIME = { score: 50, label: "NEUTRAL", trend: "sideways" };
const DEFAULT_FEAR_GREED = { value: 50, classification: "Neutral", signal: "neutral" };
const DEFAULT_KILL_SWITCH = { active: false, reason: null, expiresAt: null, nearest_event: null };

export const DataBusCtx = createContext({
  regime:      DEFAULT_REGIME,
  fearGreed:   DEFAULT_FEAR_GREED,
  killSwitch:  DEFAULT_KILL_SWITCH,
  prices:      {},
  funding:     {},
  oi:          {},
  freshness:   null,
  macroEvents: [],
  loading:     true,
  lastFetch:   null,
  error:       null,
  refetch:     () => {},
});

export function useDataBus() {
  return useContext(DataBusCtx);
}

// Map DataBus RISK_ON/RISK_OFF/NEUTRAL → SignalCard regimeName vocabulary
export function mapRegimeLabel(label) {
  if (label === "RISK_ON")  return "BULL_TREND";
  if (label === "RISK_OFF") return "BEAR_TREND";
  return ""; // NEUTRAL → no badge
}

// Map score to multiplier used by signal scoring
export function regimeMultiplier(label) {
  if (label === "RISK_ON")  return 1.1;
  if (label === "RISK_OFF") return 0.7;
  return 1.0;
}

// Fear & Greed → colour
export function fearGreedColor(value) {
  if (value <= 20) return "#ff2d55";   // Extreme Fear
  if (value <= 40) return "#f59e0b";   // Fear
  if (value <= 60) return "#6b7a99";   // Neutral
  if (value <= 80) return "#00c787";   // Greed
  return "#00ff88";                    // Extreme Greed
}

export function DataBusProvider({ children }) {
  const [regime,      setRegime]      = useState(DEFAULT_REGIME);
  const [fearGreed,   setFearGreed]   = useState(DEFAULT_FEAR_GREED);
  const [killSwitch,  setKillSwitch]  = useState(DEFAULT_KILL_SWITCH);
  const [prices,      setPrices]      = useState({});
  const [funding,     setFunding]     = useState({});
  const [oi,          setOi]          = useState({});
  const [freshness,   setFreshness]   = useState(null);
  const [macroEvents, setMacroEvents] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [lastFetch,   setLastFetch]   = useState(null);
  const [error,       setError]       = useState(null);

  const abortRef = useRef(null);

  const fetchBus = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    try {
      const res = await fetch("/api/databus/status", {
        credentials: "include",
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();

      if (d.regime)      setRegime(d.regime);
      if (d.fearGreed)   setFearGreed(d.fearGreed);
      if (d.killSwitch)  setKillSwitch(d.killSwitch);
      if (d.prices)      setPrices(d.prices);
      if (d.funding)     setFunding(d.funding);
      if (d.oi)          setOi(d.oi);
      if (d.freshness != null) setFreshness(d.freshness);
      if (Array.isArray(d.macroEvents) && d.macroEvents.length > 0)
        setMacroEvents(d.macroEvents);

      setLastFetch(Date.now());
      setError(null);
    } catch (e) {
      if (e.name !== "AbortError") setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBus();
    const iv = setInterval(fetchBus, POLL_MS);
    return () => {
      clearInterval(iv);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchBus]);

  const value = {
    regime, fearGreed, killSwitch,
    prices, funding, oi,
    freshness, macroEvents,
    loading, lastFetch, error,
    refetch: fetchBus,
  };

  return <DataBusCtx.Provider value={value}>{children}</DataBusCtx.Provider>;
}

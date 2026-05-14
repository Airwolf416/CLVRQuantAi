// Fire-and-forget HTTP client to the quant /calibration/* endpoints.
//
// Phase 1 — passive tracker only. Every call here is wrapped so a quant
// outage, slow DB, or malformed input NEVER breaks the live signal path.
// Failures are logged at warn level only.
//
// Two hooks call into this module:
//   - server/lib/signalLogger.ts  (after aiSignalLog INSERT) → logPrediction()
//   - server/lib/outcomeResolver.ts (after outcome flip)     → resolvePrediction()
//
// The Node side never reads from prediction_log — that table belongs to
// the Python quant service. The /calibration/dashboard endpoint is the
// authoritative read path.

const QUANT_URL = process.env.QUANT_URL || "http://127.0.0.1:8081";
const TIMEOUT_MS = 1500; // keep the live signal path snappy

export interface PwinSnapshot {
  // Required for a useful row
  instrument: string;
  instrumentClass: string;          // "crypto" | "fx" | "commodity" | "equity"
  side: "long" | "short";
  entry: number;
  asofTs: number;                   // unix ms
  // Strongly recommended
  tp?: number | null;
  sl?: number | null;
  holdWindowBars?: number | null;
  // Calibration inputs (may be null when scorer wasn't consulted)
  directionProbability?: number | null;
  directionProbabilityCalibrated?: number | null;
  pLossMetaProxy?: number | null;
  conviction?: number | null;
  // Context (used by reliability slicing + Phase 2 regime priors)
  regime?: string | null;
  timeframe?: string | null;
  atrPct?: number | null;
  featuresSnapshot?: Record<string, unknown> | null;
}

type LogPredictionInput = { predictionId: string | number } & PwinSnapshot;

function _toFloat(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// Map the scorer-internal asset_class enum (BTC / ETH / MID_CAP_DEFAULT /
// FOREX / METAL / STOCK) to the spec's calibration buckets (crypto / fx /
// commodity / equity). Aggregating BTC+ETH+MID_CAP_DEFAULT under "crypto"
// is intentional — calibration needs N≥30 per bucket to fit, and per-coin
// crypto buckets won't reach that for months. Phase 2's regime_prior can
// re-slice if needed.
export function instrumentClassFromScorer(
  scorerAssetClass: string,
): "crypto" | "fx" | "commodity" | "equity" {
  switch (scorerAssetClass) {
    case "BTC":
    case "ETH":
    case "MID_CAP_DEFAULT":
      return "crypto";
    case "FOREX":
      return "fx";
    case "METAL":
      return "commodity";
    case "STOCK":
    default:
      return "equity";
  }
}

// Map the Node-side aiSignalLog.outcome enum to the simple win/loss/void
// scheme the quant tracker expects. Anything not in this map is treated
// as "void" (e.g. cancelled, never_filled) so we don't pollute Brier with
// non-trades.
export function mapOutcomeToWinLoss(
  nodeOutcome: string,
): "win" | "loss" | "void" {
  switch (nodeOutcome) {
    case "TP1_HIT":
    case "TP2_HIT":
    case "TP3_HIT":
    case "EXPIRED_WIN":
      return "win";
    case "SL_HIT":
    case "EXPIRED_LOSS":
      return "loss";
    default:
      return "void";
  }
}

async function _post(path: string, body: unknown): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${QUANT_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.warn(
        `[calibrationLog] ${path} → HTTP ${r.status} ${txt.slice(0, 160)}`,
      );
    }
  } catch (e: any) {
    // Quant down, slow, or DB issue. Phase 1 invariant: never block the
    // live signal path on this.
    console.warn(`[calibrationLog] ${path} failed: ${e?.message || e}`);
  } finally {
    clearTimeout(timer);
  }
}

export function logPrediction(input: LogPredictionInput): void {
  // Fire-and-forget. We deliberately don't await; the live signal path
  // returns immediately. Errors are logged inside _post.
  void _post("/calibration/log", {
    prediction_id: String(input.predictionId),
    instrument: input.instrument,
    instrument_class: input.instrumentClass,
    side: input.side,
    regime: input.regime ?? null,
    timeframe: input.timeframe ?? null,
    entry: _toFloat(input.entry),
    tp: _toFloat(input.tp),
    sl: _toFloat(input.sl),
    hold_window_bars: input.holdWindowBars ?? null,
    atr_pct: _toFloat(input.atrPct),
    asof_ts: input.asofTs,
    direction_probability: _toFloat(input.directionProbability),
    direction_probability_calibrated: _toFloat(
      input.directionProbabilityCalibrated,
    ),
    p_loss_meta_proxy: _toFloat(input.pLossMetaProxy),
    conviction: _toFloat(input.conviction),
    features_snapshot: input.featuresSnapshot ?? null,
  });
}

export function resolvePrediction(args: {
  predictionId: string | number;
  outcome: "win" | "loss" | "void";
  exitPrice?: number | null;
  pnlPct?: number | null;
}): void {
  void _post("/calibration/resolve", {
    prediction_id: String(args.predictionId),
    outcome: args.outcome,
    exit_price: _toFloat(args.exitPrice),
    pnl_pct: _toFloat(args.pnlPct),
  });
}

import { pool } from "../db";

const VERSION = "signal_calibration_v1";
const MIN_N = 25;
const LEASE = "signal_calibration_v1";

type LabelRow = { source: string; direction: string; signal_policy_snapshot: any; calibration_label: "WIN" | "LOSS" };
function dimensions(row: LabelRow, level: number): Record<string, string> {
  const s = row.signal_policy_snapshot || {};
  const d = s.dimensions || {};
  const all: Record<string, string> = {
    source: row.source, assetClass: d.assetClass || "unknown", direction: row.direction,
    venueProfile: d.venueProfile || "unknown", holdHorizonBand: d.holdHorizonBand || "unknown",
    rrBand: d.rrBand || "unknown", regime: d.regime || "unknown",
    leverageTier: d.leverageTier || "unknown", policyVersion: s.policyVersion || "unknown",
  };
  // Specific -> progressively pooled documented backoff.
  const drop = [["leverageTier"], ["regime", "leverageTier"], ["rrBand", "regime", "leverageTier"], ["holdHorizonBand", "rrBand", "regime", "leverageTier"]][level] || [];
  for (const key of drop) all[key] = "ALL";
  return all;
}

export async function refreshSignalCalibration(): Promise<{ ran: boolean; buckets: number }> {
  if ((process.env.CALIBRATION_MODE || "shadow").toLowerCase() === "off") return { ran: false, buckets: 0 };
  const holder = `${process.pid}:${Date.now()}`;
  const lease = await pool.query(`
    INSERT INTO signal_policy_leases (lease_name, holder, expires_at)
    VALUES ($1, $2, NOW() + INTERVAL '4 minutes')
    ON CONFLICT (lease_name) DO UPDATE SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at, updated_at = NOW()
      WHERE signal_policy_leases.expires_at < NOW()
    RETURNING holder`, [LEASE, holder]);
  if (!lease.rowCount) return { ran: false, buckets: 0 };
  try {
    const rows = (await pool.query(`
      SELECT source, direction, signal_policy_snapshot, calibration_label
      FROM ai_signal_log
      WHERE resolved_at >= NOW() - INTERVAL '30 days'
        AND calibration_label IN ('WIN', 'LOSS')
        AND entry_fill_status = 'VERIFIED'
        AND observation_method_version = 'authoritative_ohlc_1m_v1'
        AND signal_policy_snapshot IS NOT NULL`)).rows as LabelRow[];
    const buckets = new Map<string, { dimensions: Record<string, string>; wins: number; n: number; level: number }>();
    for (const row of rows) for (let level = 0; level < 4; level++) {
      const d = dimensions(row, level), key = JSON.stringify(d);
      const b = buckets.get(key) || { dimensions: d, wins: 0, n: 0, level };
      b.n++; if (row.calibration_label === "WIN") b.wins++; buckets.set(key, b);
    }
    let written = 0;
    for (const [key, b] of buckets) {
      if (b.n < MIN_N) continue;
      await pool.query(`
        INSERT INTO signal_calibration (model_version, bucket_key, dimensions, wins, sample_size, p_win, backoff_level, lookback_start, lookback_end, computed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW() - INTERVAL '30 days',NOW(),NOW())
        ON CONFLICT (model_version,bucket_key) DO UPDATE SET dimensions=EXCLUDED.dimensions,wins=EXCLUDED.wins,sample_size=EXCLUDED.sample_size,p_win=EXCLUDED.p_win,backoff_level=EXCLUDED.backoff_level,lookback_start=EXCLUDED.lookback_start,lookback_end=EXCLUDED.lookback_end,computed_at=NOW()`,
        [VERSION, key, JSON.stringify(b.dimensions), b.wins, b.n, (b.wins + 1) / (b.n + 2), b.level]);
      written++;
    }
    return { ran: true, buckets: written };
  } finally {
    await pool.query(`DELETE FROM signal_policy_leases WHERE lease_name = $1 AND holder = $2`, [LEASE, holder]).catch(() => {});
  }
}

let calibrationTimer: NodeJS.Timeout | null = null;
export function startSignalCalibrationJob(): void {
  if (calibrationTimer) return;
  const tick = () => refreshSignalCalibration().catch(e => console.warn("[signalCalibration] refresh failed:", e?.message || e));
  setTimeout(tick, 120_000);
  calibrationTimer = setInterval(tick, 60 * 60 * 1000);
  console.log("[signalCalibration] shadow job scheduled hourly (CALIBRATION_MODE=shadow)");
}
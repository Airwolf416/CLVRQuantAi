import { pool } from "../db";

export const HOURLY_CLOSE_SOURCE_VERSION = "live_mark_1h_v1";

function hourStartUtc(now: Date): Date {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

/** Idempotent synchronized close write. Call once with the same observation
 * instant for BTC and every candidate; do not use the in-memory tick history
 * as a correlation source. */
export async function persistHourlyCloses(
  prices: Record<string, number>,
  observedAt = new Date(),
  sourceVersion = HOURLY_CLOSE_SOURCE_VERSION,
): Promise<number> {
  const closeAt = hourStartUtc(observedAt);
  let written = 0;
  for (const [symbol, raw] of Object.entries(prices)) {
    const price = Number(raw);
    if (!Number.isFinite(price) || price <= 0) continue;
    const result = await pool.query(`
      INSERT INTO hourly_market_closes (symbol, close_at, close_price, source_version, observed_at)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (symbol, close_at, source_version)
      DO UPDATE SET close_price = EXCLUDED.close_price, observed_at = EXCLUDED.observed_at`,
      [symbol.toUpperCase(), closeAt, price, sourceVersion, observedAt]);
    written += result.rowCount || 0;
  }
  return written;
}

export function fallbackCorrelation(assetClass: string, symbol: string): number | null {
  const s = symbol.toUpperCase();
  if (s === "BTC" || s === "ETH") return 1;
  if (assetClass.toLowerCase() === "crypto") return .9;
  return null;
}

export async function correlationToBtc(symbol: string, assetClass: string): Promise<{ correlation: number | null; sufficient: boolean; sourceVersion: string }> {
  const result = await pool.query(`
    WITH aligned AS (
      SELECT a.close_at, a.close_price::double precision AS asset_close,
             b.close_price::double precision AS btc_close
        FROM hourly_market_closes a
        JOIN hourly_market_closes b ON b.close_at = a.close_at
          AND b.source_version = a.source_version AND b.symbol = 'BTC'
       WHERE a.symbol = $1 AND a.source_version = $2
         AND a.close_at >= NOW() - INTERVAL '30 days'
    ), returns AS (
      SELECT close_at,
        LN(asset_close / LAG(asset_close) OVER (ORDER BY close_at)) AS asset_return,
        LN(btc_close / LAG(btc_close) OVER (ORDER BY close_at)) AS btc_return
      FROM aligned
    )
    SELECT corr(asset_return, btc_return) AS correlation,
           COUNT(*) FILTER (WHERE asset_return IS NOT NULL AND btc_return IS NOT NULL) AS n,
           COUNT(DISTINCT close_at::date) FILTER (WHERE asset_return IS NOT NULL AND btc_return IS NOT NULL) AS days
      FROM returns`, [symbol.toUpperCase(), HOURLY_CLOSE_SOURCE_VERSION]);
  const row = result.rows[0] || {};
  const sufficient = Number(row.days) >= 20 && Number(row.n) >= 20 * 24;
  if (!sufficient) return { correlation: fallbackCorrelation(assetClass, symbol), sufficient: false, sourceVersion: HOURLY_CLOSE_SOURCE_VERSION };
  const correlation = Number(row.correlation);
  return { correlation: Number.isFinite(correlation) ? correlation : null, sufficient: true, sourceVersion: HOURLY_CLOSE_SOURCE_VERSION };
}

let hourlyTimer: NodeJS.Timeout | null = null;
export function startHourlyCloseCollection(getPrices: () => Record<string, number>): void {
  if (hourlyTimer) return;
  const tick = async () => {
    const holder = `${process.pid}:${Date.now()}`;
    const lease = await pool.query(`
      INSERT INTO signal_policy_leases (lease_name, holder, expires_at)
      VALUES ('hourly_close_collection_v1',$1,NOW() + INTERVAL '5 minutes')
      ON CONFLICT (lease_name) DO UPDATE SET holder=EXCLUDED.holder, expires_at=EXCLUDED.expires_at, updated_at=NOW()
       WHERE signal_policy_leases.expires_at < NOW()
      RETURNING holder`, [holder]);
    if (!lease.rowCount) return;
    try { await persistHourlyCloses(getPrices()); }
    catch (e: any) { console.warn("[hourlyCloseHistory] write failed:", e?.message || e); }
    finally { await pool.query(`DELETE FROM signal_policy_leases WHERE lease_name='hourly_close_collection_v1' AND holder=$1`, [holder]).catch(() => {}); }
  };
  tick();
  const msToNextHour = 60 * 60 * 1000 - (Date.now() % (60 * 60 * 1000)) + 5_000;
  setTimeout(() => { tick(); hourlyTimer = setInterval(tick, 60 * 60 * 1000); }, msToNextHour);
  console.log("[hourlyCloseHistory] UTC synchronized close collection scheduled");
}
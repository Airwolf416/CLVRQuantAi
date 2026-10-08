import { pool } from "../db";
import { rSet } from "../services/redis";
import { ROTATION_CONFIG } from "./config";
import type { RotationAllSources, CoinGeckoMarket } from "./types";

export type UniverseEntry = {
  coin: CoinGeckoMarket;
  included: boolean;
  exclusionReason: string | null;
};

export function classifyRotationUniverse(
  coins: CoinGeckoMarket[],
  stableIds: Set<string> | null,
): UniverseEntry[] {
  const exclusions = ROTATION_CONFIG.exclusions;
  return coins.map(coin => {
    const symbol = coin.symbol.toLowerCase();
    let exclusionReason: string | null = null;
    if (symbol === "btc" || coin.id === "bitcoin") exclusionReason = "BITCOIN";
    else if (exclusions.stableSymbols.includes(symbol as never)) exclusionReason = "STABLECOIN";
    else if (stableIds === null) exclusionReason = "STABLECOIN_SOURCE_UNAVAILABLE";
    else if (stableIds.has(coin.id)) exclusionReason = "STABLECOIN";
    else if (exclusions.peggedSymbols.includes(symbol as never)) exclusionReason = "PEGGED_COMMODITY";
    else if (exclusions.stakingSymbols.includes(symbol as never)) exclusionReason = "LIQUID_STAKING_DERIVATIVE";
    else if (exclusions.wrappedSymbols.includes(symbol as never)) exclusionReason = "WRAPPED_OR_BRIDGED";
    return { coin, included: exclusionReason === null, exclusionReason };
  });
}

export type RotationSnapshotInput = {
  snapshotDate: string;
  asOf: string;
  sources: RotationAllSources;
  universe: UniverseEntry[];
};

export async function getLatestRotationSnapshot(): Promise<any | null> {
  const { rows } = await pool.query(
    `SELECT market_state FROM rotation_snapshots ORDER BY as_of DESC LIMIT 1`,
  );
  return rows[0]?.market_state ?? null;
}

export async function rotationSnapshotExists(snapshotDate: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM rotation_snapshots WHERE snapshot_date = $1 AND granularity = 'daily' LIMIT 1`,
    [snapshotDate],
  );
  return rows.length > 0;
}

export async function saveDailyRotationSnapshot(input: RotationSnapshotInput): Promise<number> {
  const client = await pool.connect();
  const marketState = {
    phase: "data-layer",
    status: "raw-crypto-sources",
    asOf: input.asOf,
    snapshotDate: input.snapshotDate,
    sources: input.sources,
    staleSources: Object.entries(input.sources).filter(([, result]) => result.stale).map(([name]) => name),
    historyEligibility: "pending-phase-2",
  };
  try {
    await client.query("BEGIN");
    const saved = await client.query(
      `INSERT INTO rotation_snapshots (snapshot_date, as_of, granularity, market_state)
       VALUES ($1, $2, 'daily', $3::jsonb)
       ON CONFLICT (snapshot_date) WHERE granularity = 'daily'
       DO UPDATE SET as_of = EXCLUDED.as_of, market_state = EXCLUDED.market_state
       RETURNING id`,
      [input.snapshotDate, input.asOf, JSON.stringify(marketState)],
    );
    const snapshotId = Number(saved.rows[0].id);
    for (const row of input.universe) {
      await client.query(
        `INSERT INTO rotation_universe
           (snapshot_date, coin_id, symbol, rank, market_cap, included, exclusion_reason, history_pending)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)
         ON CONFLICT (snapshot_date, coin_id) DO UPDATE SET
           symbol = EXCLUDED.symbol, rank = EXCLUDED.rank, market_cap = EXCLUDED.market_cap,
           included = EXCLUDED.included, exclusion_reason = EXCLUDED.exclusion_reason,
           history_pending = EXCLUDED.history_pending`,
        [input.snapshotDate, row.coin.id, row.coin.symbol.toUpperCase(),
          row.coin.market_cap_rank, row.coin.market_cap, row.included, row.exclusionReason],
      );
    }
    await client.query("COMMIT");
    await rSet(ROTATION_CONFIG.cache.marketStateKey, marketState, ROTATION_CONFIG.cache.marketStateTtlSeconds);
    return snapshotId;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

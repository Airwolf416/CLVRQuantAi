import { pool } from "../db";
import { rSet } from "../services/redis";
import { ROTATION_CONFIG } from "./config";
import type { RotationAllSources, CoinGeckoMarket } from "./types";

export type UniverseEntry = {
  coin: CoinGeckoMarket;
  included: boolean;
  exclusionReason: string | null;
  historyPending?: boolean;
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
    `SELECT id, snapshot_date, as_of, granularity, market_state FROM rotation_snapshots ORDER BY as_of DESC LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function getDailyRotationSnapshot(snapshotDate: string): Promise<any | null> {
  const { rows } = await pool.query(
    `SELECT id, snapshot_date, as_of, market_state FROM rotation_snapshots
     WHERE snapshot_date = $1 AND granularity = 'daily' LIMIT 1`,
    [snapshotDate],
  );
  return rows[0] ?? null;
}

export async function getRecentDailyRotationStates(beforeDate: string, limit = 365): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT snapshot_date, as_of, market_state FROM rotation_snapshots
     WHERE granularity = 'daily' AND snapshot_date < $1
     ORDER BY snapshot_date DESC LIMIT $2`,
    [beforeDate, Math.max(1, Math.min(400, Math.floor(limit)))],
  );
  return rows;
}

export async function getPriorDominance(snapshotDate: string): Promise<{ btcExStables: number | null; stable: number | null } | null> {
  const { rows } = await pool.query(
    `SELECT dominance_ex_stables, total_mcap, usdt_usdc_mcap
     FROM dominance_history WHERE date <= $1::date - INTERVAL '30 days'
     ORDER BY date DESC LIMIT 1`,
    [snapshotDate],
  );
  const row = rows[0];
  if (!row) return null;
  const stable = Number(row.total_mcap) > 0 && row.usdt_usdc_mcap != null
    ? Number(row.usdt_usdc_mcap) / Number(row.total_mcap) * 100 : null;
  return {
    btcExStables: row.dominance_ex_stables == null ? null : Number(row.dominance_ex_stables),
    stable,
  };
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
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (snapshot_date, coin_id) DO UPDATE SET
           symbol = EXCLUDED.symbol, rank = EXCLUDED.rank, market_cap = EXCLUDED.market_cap,
           included = EXCLUDED.included, exclusion_reason = EXCLUDED.exclusion_reason,
           history_pending = EXCLUDED.history_pending`,
        [input.snapshotDate, row.coin.id, row.coin.symbol.toUpperCase(),
           row.coin.market_cap_rank, row.coin.market_cap, row.included, row.exclusionReason, row.historyPending ?? true],
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

export async function saveCryptoEngineData(input: {
  snapshotId: number;
  snapshotDate: string;
  universe: UniverseEntry[];
  returns: {
    coinId: string; ret30: number; ret60: number; ret90: number;
    beatBtc30: boolean; beatBtc60: boolean; beatBtc90: boolean;
  }[];
  cryptoState: Record<string, unknown>;
  btcMcap: number | null;
  totalMcap: number | null;
  stableMcap: number;
  usdtUsdcMcap: number;
  btcDominance: number | null;
  dominanceExStables: number | null;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of input.universe) {
      await client.query(
        `UPDATE rotation_universe SET included = $3, exclusion_reason = $4, history_pending = $5
         WHERE snapshot_date = $1 AND coin_id = $2`,
        [input.snapshotDate, row.coin.id, row.included, row.exclusionReason, row.historyPending ?? true],
      );
    }
    for (const row of input.returns) {
      await client.query(
        `INSERT INTO rotation_coin_returns
          (snapshot_date, coin_id, ret30, ret60, ret90, beat_btc30, beat_btc60, beat_btc90)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (snapshot_date, coin_id) DO UPDATE SET
          ret30 = EXCLUDED.ret30, ret60 = EXCLUDED.ret60, ret90 = EXCLUDED.ret90,
          beat_btc30 = EXCLUDED.beat_btc30, beat_btc60 = EXCLUDED.beat_btc60, beat_btc90 = EXCLUDED.beat_btc90`,
        [input.snapshotDate, row.coinId, row.ret30, row.ret60, row.ret90, row.beatBtc30, row.beatBtc60, row.beatBtc90],
      );
    }
    await client.query(
      `INSERT INTO dominance_history
        (date, btc_mcap, total_mcap, stable_mcap, dominance, dominance_ex_stables, usdt_usdc_mcap)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (date) DO UPDATE SET btc_mcap = EXCLUDED.btc_mcap,
        total_mcap = EXCLUDED.total_mcap, stable_mcap = EXCLUDED.stable_mcap,
        dominance = EXCLUDED.dominance, dominance_ex_stables = EXCLUDED.dominance_ex_stables,
        usdt_usdc_mcap = EXCLUDED.usdt_usdc_mcap`,
      [input.snapshotDate, input.btcMcap, input.totalMcap, input.stableMcap,
        input.btcDominance, input.dominanceExStables, input.usdtUsdcMcap],
    );
    await client.query(
      `UPDATE rotation_snapshots
       SET market_state = market_state || jsonb_build_object('crypto', $2::jsonb)
       WHERE id = $1`,
      [input.snapshotId, JSON.stringify(input.cryptoState)],
    );
    await client.query("COMMIT");
    const { rows } = await pool.query(`SELECT market_state FROM rotation_snapshots WHERE id = $1`, [input.snapshotId]);
    if (rows[0]) await rSet(ROTATION_CONFIG.cache.marketStateKey, rows[0].market_state, ROTATION_CONFIG.cache.marketStateTtlSeconds);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function saveMacroFactorValues(asOf: string, factors: any[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of factors) {
      await client.query(
        `INSERT INTO macro_factor_values (as_of, factor, raw_value, change_20d, zscore, contribution, stale)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (as_of, factor) DO UPDATE SET
          raw_value = EXCLUDED.raw_value, change_20d = EXCLUDED.change_20d,
          zscore = EXCLUDED.zscore, contribution = EXCLUDED.contribution, stale = EXCLUDED.stale`,
        [asOf, row.factor, row.rawValue, row.change20d, row.zscore, row.contribution, row.stale],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function updateDailyMacroState(snapshotId: number, macroState: Record<string, unknown>): Promise<void> {
  await pool.query(
    `UPDATE rotation_snapshots
     SET market_state = market_state || jsonb_build_object('macro', $2::jsonb)
     WHERE id = $1`,
    [snapshotId, JSON.stringify(macroState)],
  );
  await saveMacroFactorValues(String((macroState as any).asOf), (macroState as any).factors ?? []);
  const { rows } = await pool.query(`SELECT market_state FROM rotation_snapshots WHERE id = $1`, [snapshotId]);
  if (rows[0]) await rSet(ROTATION_CONFIG.cache.marketStateKey, rows[0].market_state, ROTATION_CONFIG.cache.marketStateTtlSeconds);
}

export async function saveIntradayMacroSnapshot(input: {
  snapshotDate: string;
  asOf: string;
  marketState: Record<string, unknown>;
  macroState: Record<string, unknown>;
}): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const saved = await client.query(
      `INSERT INTO rotation_snapshots (snapshot_date, as_of, granularity, market_state)
       VALUES ($1, $2, 'intraday', $3::jsonb) RETURNING id`,
      [input.snapshotDate, input.asOf, JSON.stringify(input.marketState)],
    );
    await client.query("COMMIT");
    await saveMacroFactorValues(input.asOf, (input.macroState as any).factors ?? []);
    await rSet(ROTATION_CONFIG.cache.marketStateKey, input.marketState, ROTATION_CONFIG.cache.marketStateTtlSeconds);
    return Number(saved.rows[0].id);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

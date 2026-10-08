import type { PoolClient } from "pg";
import { pool } from "../db";
import { buildMacroInputs } from "./sources/macroInputs";
import { createEtfFlowSource } from "./sources/etfFlows";
import { createFredSource } from "./sources/fred";
import { createYahooMacroSource } from "./sources/yahooMacro";
import {
  getLatestRotationSnapshot,
  saveIntradayMacroSnapshot,
} from "./repository";
import { isIntradayMacroWindow, torontoDateTime } from "./usTradingCalendar";

const LOCK_NAME = "clvr-rotation-brain-intraday-macro-v1";
const MINUTE_MS = 60_000;
let scheduler: ReturnType<typeof setInterval> | null = null;
let localRun = false;

function macroFailure(error: unknown) {
  return {
    data: null,
    asOf: null,
    stale: true,
    error: error instanceof Error ? error.message : "Macro source request failed",
  };
}

export async function runIntradayMacroUpdate(now = new Date()): Promise<boolean> {
  if (localRun) return false;
  localRun = true;
  let client: PoolClient | null = null;
  let locked = false;
  try {
    client = await pool.connect();
    const lock = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [LOCK_NAME],
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) return false;

    const asOf = now.toISOString();
    const date = torontoDateTime(now).date;
    const fredEndDate = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    const [fred, etfFlows, yahoo] = await Promise.all([
      createFredSource().fetch(fredEndDate).catch(macroFailure),
      createEtfFlowSource().fetch(utcDate(now)).catch(macroFailure),
      createYahooMacroSource().fetch(asOf).catch(macroFailure),
    ]);
    const inputs = buildMacroInputs({ fred, etfFlows, yahoo });
    const macroState = {
      ...inputs.state(asOf),
      engineVersion: "phase3-v1",
      sourceStatus: inputs.sourceStatus,
      adaptiveWeighting: { enabled: false, reason: "disabled_by_default" },
    };
    const latest = await getLatestRotationSnapshot();
    const marketState = {
      ...(latest?.market_state ?? {}),
      snapshotDate: date,
      asOf,
      macro: macroState,
      macroUpdateGranularity: "intraday",
    };
    await saveIntradayMacroSnapshot({ snapshotDate: date, asOf, marketState, macroState });
    console.log(`[rotation] Intraday macro snapshot ${asOf}: ${macroState.status}, ${macroState.activeFactorCount}/8 active factors.`);
    return true;
  } catch (error) {
    console.error("[rotation] Intraday macro update failed:", error instanceof Error ? error.message : error);
    return false;
  } finally {
    if (client && locked) {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [LOCK_NAME]).catch(() => {});
    }
    client?.release();
    localRun = false;
  }
}

function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function bucketKey(date: Date): string {
  const parts = torontoDateTime(date);
  return `${parts.date}T${String(parts.hour).padStart(2, "0")}:${String(Math.floor(parts.minute / 15) * 15).padStart(2, "0")}`;
}

export function startIntradayMacroScheduler(): void {
  if (scheduler) return;
  let lastBucket = "";
  const tick = async () => {
    const now = new Date();
    if (!isIntradayMacroWindow(now)) return;
    const bucket = bucketKey(now);
    if (bucket === lastBucket) return;
    if (await runIntradayMacroUpdate(now)) lastBucket = bucket;
  };
  scheduler = setInterval(() => { void tick(); }, MINUTE_MS);
  scheduler.unref?.();
  void tick();
  console.log("[rotation] Intraday macro refresh scheduled every 15 minutes, 08:00–17:00 America/Toronto on US trading days.");
}

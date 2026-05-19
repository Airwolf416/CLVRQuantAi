// ── Earnings Radar Scheduler ───────────────────────────────────────────────
// Daily 06:15 ET scan that populates earnings_cache via Claude Sonnet 4.6.
// 1-min tick + date-key dedupe (same pattern as dailyBrief/weeklyModelReport).
// Boot catch-up: if server starts after 06:15 ET on a day that hasn't run
// yet, fire once after a 30s settle delay.

import { runEarningsScan } from "./earningsAnalyzer";
import { db } from "../db";
import { sql } from "drizzle-orm";

const SCAN_HOUR_ET = 6;
const SCAN_MINUTE_ET = 15;
const SCAN_MV_TAG = "earnings_radar_scan";
let lastScanDate: string | null = null;
let inFlight = false;

// DB-backed dedupe: returns true if we've already stamped a successful scan
// for `dateKey` (survives restarts). Falls open (returns false) on error so
// we'd rather over-scan than miss a day.
async function alreadyScannedInDb(dateKey: string): Promise<boolean> {
  try {
    const r: any = await db.execute(sql`
      SELECT 1 FROM stats_refresh_log
       WHERE mv_name = ${SCAN_MV_TAG}
         AND started_at::date = ${dateKey}::date
       LIMIT 1
    `);
    const rows = Array.isArray(r) ? r : (r?.rows || []);
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function stampScanInDb(dateKey: string, cached: number, scanned: number) {
  try {
    await db.execute(sql`
      INSERT INTO stats_refresh_log (mv_name, started_at, finished_at, success, error_message)
      VALUES (${SCAN_MV_TAG}, NOW(), NOW(), true, ${`cached=${cached}/${scanned} dateKey=${dateKey}`})
    `);
  } catch (e: any) {
    console.warn(`[earnings-radar] stampScanInDb failed: ${e?.message || e}`);
  }
}

function getETComponents(): { hour: number; minute: number; dateKey: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value || "0";
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const dateKey = `${get("year")}-${get("month")}-${get("day")}`;
  return { hour, minute, dateKey };
}

async function attemptScan(reason: string, dateKey: string) {
  if (inFlight) {
    console.log(`[earnings-radar] ${reason} skipped — already in flight`);
    return;
  }
  if (lastScanDate === dateKey) {
    return;
  }
  // DB cross-restart guard — if any process already stamped this date, skip.
  if (await alreadyScannedInDb(dateKey)) {
    lastScanDate = dateKey;
    console.log(`[earnings-radar] ${reason} ${dateKey} — already stamped in DB, skipping`);
    return;
  }
  inFlight = true;
  try {
    console.log(`[earnings-radar] ${reason} ${dateKey} — starting`);
    const res = await runEarningsScan();
    lastScanDate = dateKey;
    await stampScanInDb(dateKey, res.cached, res.scanned);
    console.log(`[earnings-radar] ${reason} ${dateKey} — done cached=${res.cached}/${res.scanned} errors=${res.errors}`);
  } catch (e: any) {
    console.error(`[earnings-radar] ${reason} ${dateKey} — failed:`, e?.message || e);
    // Do NOT stamp lastScanDate — leave open for retry next minute.
  } finally {
    inFlight = false;
  }
}

export function startEarningsScanScheduler() {
  if (!process.env.FMP_API_KEY || !process.env.ANTHROPIC_API_KEY) {
    console.log("[earnings-radar] scheduler not started — missing FMP_API_KEY or ANTHROPIC_API_KEY");
    return;
  }
  console.log(`[earnings-radar] scheduler started — daily ${SCAN_HOUR_ET}:${String(SCAN_MINUTE_ET).padStart(2, "0")} ET`);

  // Tick every minute; only fires when the clock hits the slot and today
  // hasn't run yet.
  setInterval(async () => {
    const { hour, minute, dateKey } = getETComponents();
    if (hour === SCAN_HOUR_ET && minute === SCAN_MINUTE_ET && lastScanDate !== dateKey) {
      attemptScan("tick", dateKey).catch(() => {});
    }
  }, 60 * 1000);

  // Boot catch-up: if we started after the scan slot today and haven't run,
  // fire once after a short settle delay so DB init/quant boot complete first.
  setTimeout(() => {
    const { hour, minute, dateKey } = getETComponents();
    const pastSlot = hour > SCAN_HOUR_ET || (hour === SCAN_HOUR_ET && minute >= SCAN_MINUTE_ET);
    if (pastSlot && lastScanDate !== dateKey) {
      console.log(`[earnings-radar] boot catch-up — past ${SCAN_HOUR_ET}:${String(SCAN_MINUTE_ET).padStart(2, "0")} ET on ${dateKey}`);
      attemptScan("boot-catchup", dateKey).catch(() => {});
    }
  }, 30 * 1000);
}

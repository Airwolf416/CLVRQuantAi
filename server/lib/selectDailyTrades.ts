// ============================================================================
// selectDailyTrades — choose the 3 highest-quality day trades for the morning
// brief. Composite scoring + hard filters + asset-class diversification.
//
// Selection rules (per spec):
//   - Score   = 0.40·winRate30d + 0.25·rrNorm + 0.15·kronos + 0.10·macro + 0.10·flow
//   - Reject  : suppressed, sample<25, winRate<0.45, RR<1.8, killswitch, crowded funding
//   - Diversity: max 2 per asset class, max 1 per instrument, fill from underrep class
//   - Yield  ≤3 winners; never pad to hit a quota
//
// Pro = top 2 of the Elite list of 3.
// ============================================================================

import { pool } from "../db";
import { buildPerformanceContextStructured, type PerComboStat } from "./performanceContext";

export type AssetClass = "crypto" | "fx" | "commodity" | "equity";

export interface CandidatePlan {
  instrument:        string;
  assetClass:        AssetClass;
  direction:         "LONG" | "SHORT";
  entry:             number;
  stop:              number;
  tp1:               number;
  tp2:               number;
  riskReward:        number;
  winRate30d:        number;          // 0..1
  sampleSize:        number;
  kronosConfidence:  number;          // 0..1
  macroAlignment:    -1 | 0 | 1;
  flowScore:         number;          // -1..1
  thesis:            string;
  sessionFlag?:      string;
  fundingCrowded:    boolean;
  killSwitchActive:  boolean;
  liquidityOK:       boolean;
  compositeScore?:   number;
}

export interface SelectionResult {
  trades:       CandidatePlan[];      // up to 3, ranked by composite score
  filteredOut:  Array<{ instrument: string; direction: string; reason: string }>;
  generatedAt:  string;
  candidateCount: number;
}

const MIN_WIN_RATE  = 0.45;
const MIN_SAMPLE    = 25;
const MIN_RR        = 1.8;
const MAX_PER_CLASS = 2;
const MAX_TRADES    = 3;

// ── Composite score (deterministic) ─────────────────────────────────────────
export function compositeScore(c: CandidatePlan): number {
  const rrNorm = Math.min(c.riskReward / 3, 1);
  return (
    c.winRate30d       * 0.40 +
    rrNorm             * 0.25 +
    c.kronosConfidence * 0.15 +
    ((c.macroAlignment + 1) / 2) * 0.10 +
    ((c.flowScore + 1) / 2)      * 0.10
  );
}

// ── Hard filters — reject ineligible candidates ─────────────────────────────
export function passesHardFilters(c: CandidatePlan): { ok: boolean; reason?: string } {
  if (c.sampleSize < MIN_SAMPLE)        return { ok: false, reason: `insufficient_sample (n=${c.sampleSize})` };
  if (c.winRate30d < MIN_WIN_RATE)      return { ok: false, reason: `low_winrate (${(c.winRate30d*100).toFixed(0)}%)` };
  if (c.riskReward < MIN_RR)            return { ok: false, reason: `low_rr (${c.riskReward.toFixed(2)})` };
  if (c.killSwitchActive)               return { ok: false, reason: `killswitch` };
  if (!c.liquidityOK)                   return { ok: false, reason: `liquidity` };
  if (c.fundingCrowded)                 return { ok: false, reason: `funding_crowded` };
  return { ok: true };
}

// ── Diversification: max 2 per class, max 1 per instrument ──────────────────
export function diversify(ranked: CandidatePlan[]): CandidatePlan[] {
  const picked: CandidatePlan[] = [];
  const classCount: Record<AssetClass, number> = { crypto: 0, fx: 0, commodity: 0, equity: 0 };
  const instrumentSeen = new Set<string>();

  for (const cand of ranked) {
    if (picked.length >= MAX_TRADES) break;
    if (instrumentSeen.has(cand.instrument)) continue;
    if (classCount[cand.assetClass] >= MAX_PER_CLASS) continue;
    picked.push(cand);
    classCount[cand.assetClass]++;
    instrumentSeen.add(cand.instrument);
  }

  // If we ended up under MAX_TRADES because of diversity blocks, try once more
  // for an underrepresented-class candidate that we previously skipped.
  if (picked.length < MAX_TRADES) {
    const underrep = (Object.entries(classCount) as Array<[AssetClass, number]>)
      .filter(([, n]) => n === 0).map(([k]) => k);
    if (underrep.length) {
      for (const cand of ranked) {
        if (picked.length >= MAX_TRADES) break;
        if (instrumentSeen.has(cand.instrument)) continue;
        if (!underrep.includes(cand.assetClass)) continue;
        picked.push(cand);
        instrumentSeen.add(cand.instrument);
      }
    }
  }

  return picked;
}

// ── Public: build the canonical Elite list of up to 3 trades ────────────────
export async function selectDailyTrades(allCandidates: CandidatePlan[]): Promise<SelectionResult> {
  const filteredOut: SelectionResult["filteredOut"] = [];
  const survivors: CandidatePlan[] = [];

  for (const c of allCandidates) {
    const f = passesHardFilters(c);
    if (!f.ok) {
      filteredOut.push({ instrument: c.instrument, direction: c.direction, reason: f.reason || "unknown" });
      continue;
    }
    c.compositeScore = compositeScore(c);
    survivors.push(c);
  }

  survivors.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));
  const trades = diversify(survivors);

  return {
    trades,
    filteredOut,
    generatedAt:    new Date().toISOString(),
    candidateCount: allCandidates.length,
  };
}

// ── Tier slice: Pro gets best 2, Elite gets all 3, Free gets none ───────────
export function sliceForTier(elite: CandidatePlan[], tier: string): CandidatePlan[] {
  const t = (tier || "free").toLowerCase();
  if (t === "elite") return elite.slice(0, 3);
  if (t === "pro")   return elite.slice(0, 2);
  return [];
}

// ── Audit log: record what each tier received for later perf review ─────────
export async function logTierDistribution(dateKey: string, elite: CandidatePlan[]) {
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS daily_brief_trade_log (
         id SERIAL PRIMARY KEY,
         date_key TEXT NOT NULL,
         tier TEXT NOT NULL,
         instrument TEXT NOT NULL,
         direction TEXT NOT NULL,
         composite_score REAL,
         win_rate_30d REAL,
         sample_size INT,
         risk_reward REAL,
         created_at TIMESTAMP NOT NULL DEFAULT NOW()
       )`
    );
    for (const tier of ["pro", "elite"]) {
      const slice = sliceForTier(elite, tier);
      for (const t of slice) {
        await pool.query(
          `INSERT INTO daily_brief_trade_log (date_key, tier, instrument, direction, composite_score, win_rate_30d, sample_size, risk_reward)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [dateKey, tier, t.instrument, t.direction, t.compositeScore || 0, t.winRate30d, t.sampleSize, t.riskReward]
        );
      }
    }
  } catch (e: any) { console.log("[selectDailyTrades] audit log failed:", e.message); }
}

// ── Feature flag ────────────────────────────────────────────────────────────
//  off    — legacy brief format (current behaviour)
//  shadow — generate v1 list and log what would have been sent; legacy brief still ships
//  on     — tiered brief is authoritative
export type TieredBriefMode = "off" | "shadow" | "on";
export function getTieredBriefMode(): TieredBriefMode {
  const v = (process.env.TIERED_BRIEF_V1 || "off").toLowerCase();
  if (v === "on" || v === "shadow") return v;
  return "off";
}

// ── Helper: hydrate calibration (winRate30d + sampleSize) from perf context ──
export async function hydrateCalibration(candidates: CandidatePlan[]): Promise<CandidatePlan[]> {
  try {
    const ctx = await buildPerformanceContextStructured();
    const stats = ctx.combos || [];
    const byKey = new Map<string, PerComboStat>();
    for (const s of stats) byKey.set(`${s.token}|${s.direction}`, s);
    return candidates.map(c => {
      const stat = byKey.get(`${c.instrument}|${c.direction}`);
      if (stat) {
        c.winRate30d = stat.winRate;
        c.sampleSize = stat.sampleSize;
      }
      return c;
    });
  } catch (e: any) {
    console.log("[selectDailyTrades] calibration hydrate failed:", e.message);
    return candidates;
  }
}

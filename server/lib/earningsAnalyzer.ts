// ── Earnings Radar Analyzer — CLVRQuantAI ──────────────────────────────────
// Node-side AI verdict generator for upcoming earnings events.
//
// Why Node (not Python): the user's "Drizzle only" + "no raw pg" + single-
// service rule rules out the Python cron from the attached spec. We mirror
// the spec's feature set using FMP free-tier endpoints + Yahoo daily prices
// (paid endpoints — options, upgrades-downgrades, historical-price-full,
// economic_calendar — are intentionally omitted).
//
// Output: one Claude verdict per (symbol, report_date), upserted into
// earnings_cache via Drizzle's db.execute(sql`...`).

import { db } from "../db";
import { sql } from "drizzle-orm";
import { CLAUDE_MODEL } from "../config";
import { getEarningsCalendar, getEarningsHistory, type EarningsRow } from "../services/fmpEarnings";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const FMP_KEY = process.env.FMP_API_KEY || "";

type AiVerdict = {
  verdict: "BULLISH" | "BEARISH" | "AVOID";
  confidence: number;
  expected_move_pct: number;
  directional_bias: "LONG" | "SHORT" | "NEUTRAL";
  trade_structure: string;
  entry_strategy: string;
  entry_level: number | null;
  stop_loss: number | null;
  target: number | null;
  kelly_size_pct: number;
  thesis: string;
  key_risks: string[];
};

type Features = {
  hist_avg_move_1d: number;
  beat_rate_8q: number;
  drift_beat_5d: number;
  drift_miss_5d: number;
  revenue_growth_yoy: number | null;
  recent_3mo_return_pct: number;
  avg_eps_surprise_pct: number;
  sample_size: number;
};

const RADAR_WATCHLIST = [
  // Mega-cap tech
  "TSLA","NVDA","AAPL","GOOGL","GOOG","META","MSFT","AMZN","NFLX",
  // High-beta / momentum names users actively trade
  "AMD","PLTR","COIN","SQ","SHOP","CRM","DIS","MSTR","HOOD","RBLX",
  "SMCI","MU","AVGO","INTC","ORCL","ADBE","NOW","SNOW","UBER","ABNB",
  // Financials / mega caps
  "JPM","BAC","GS","MS","WFC","V","MA",
  // Industrials / consumer / health
  "BA","CAT","WMT","COST","HD","NKE","KO","PEP","MCD","SBUX",
  "LLY","UNH","JNJ","PFE","ABBV","MRK",
  // Energy / commodities
  "XOM","CVX","OXY",
];

const YF_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

type YahooBar = { date: string; close: number };

async function fetchYahooDailyCloses(symbol: string, range = "6mo"): Promise<YahooBar[]> {
  try {
    const r = await fetch(`${YF_CHART}/${encodeURIComponent(symbol)}?interval=1d&range=${range}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const data: any = await r.json();
    const result = data?.chart?.result?.[0];
    const ts: number[] = result?.timestamp || [];
    const closes: number[] = result?.indicators?.quote?.[0]?.close || [];
    const out: YahooBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (c == null || !Number.isFinite(c)) continue;
      out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: c });
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchProfile(symbol: string): Promise<{ companyName?: string; mktCap?: number }> {
  if (!FMP_KEY) return {};
  try {
    const r = await fetch(`https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return {};
    const data: any = await r.json();
    const row = Array.isArray(data) ? data[0] : data;
    return {
      companyName: row?.companyName || row?.name || undefined,
      mktCap: row?.mktCap || row?.marketCap || undefined,
    };
  } catch {
    return {};
  }
}

function nearestPriorClose(bars: YahooBar[], targetDate: string): { idx: number; bar: YahooBar } | null {
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].date <= targetDate) return { idx: i, bar: bars[i] };
  }
  return null;
}

export async function computeFeatures(symbol: string): Promise<Features | null> {
  try {
    const [history, bars] = await Promise.all([
      getEarningsHistory(symbol, 12),
      fetchYahooDailyCloses(symbol, "2y"),
    ]);
    // history is sorted newest first by fmpEarnings.ts
    const resolved = history.filter(h => h.epsActual != null && h.epsEstimated != null);
    if (resolved.length === 0 || bars.length < 30) return null;

    // Yahoo bars come oldest→newest; flip to newest-first for lookup.
    const barsDesc = [...bars].reverse();

    const moves: number[] = [];
    const driftBeat: number[] = [];
    const driftMiss: number[] = [];
    const surprisePcts: number[] = [];
    let beats = 0;
    for (const ev of resolved.slice(0, 8)) {
      const anchor = nearestPriorClose(barsDesc, ev.date);
      if (!anchor) continue;
      const pT = anchor.bar.close;
      const pT1 = barsDesc[Math.max(anchor.idx - 1, 0)]?.close;
      const pT5 = barsDesc[Math.max(anchor.idx - 5, 0)]?.close;
      if (!pT || !pT1 || !pT5) continue;
      moves.push(Math.abs(pT1 / pT - 1) * 100);
      const isBeat = (ev.epsActual as number) > (ev.epsEstimated as number);
      if (isBeat) {
        beats++;
        driftBeat.push((pT5 / pT - 1) * 100);
      } else {
        driftMiss.push((pT5 / pT - 1) * 100);
      }
      const est = Math.abs(ev.epsEstimated as number);
      if (est > 1e-9) {
        surprisePcts.push(((ev.epsActual as number) - (ev.epsEstimated as number)) / est * 100);
      }
    }

    const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

    // YoY revenue growth (most recent quarter vs same quarter prior year ≈ idx 4)
    let revGrowth: number | null = null;
    if (resolved.length >= 5 && resolved[0].revenueActual && resolved[4].revenueActual) {
      revGrowth = ((resolved[0].revenueActual as number) / (resolved[4].revenueActual as number) - 1) * 100;
    }

    // 3mo return from yahoo
    const last = bars[bars.length - 1].close;
    const idx3mo = Math.max(0, bars.length - 63);
    const recentRet = (last / bars[idx3mo].close - 1) * 100;

    return {
      hist_avg_move_1d: +avg(moves).toFixed(2),
      beat_rate_8q: +(beats / Math.min(resolved.length, 8) * 100).toFixed(1),
      drift_beat_5d: +avg(driftBeat).toFixed(2),
      drift_miss_5d: +avg(driftMiss).toFixed(2),
      revenue_growth_yoy: revGrowth == null ? null : +revGrowth.toFixed(2),
      recent_3mo_return_pct: +recentRet.toFixed(2),
      avg_eps_surprise_pct: +avg(surprisePcts).toFixed(2),
      sample_size: Math.min(resolved.length, 8),
    };
  } catch (e: any) {
    console.warn(`[earnings-radar] features(${symbol}) failed:`, e?.message || e);
    return null;
  }
}

export async function getClaudeVerdict(
  symbol: string,
  meta: { companyName?: string; reportDate: string; reportTime: string; mktCap?: number; epsEstimate?: number | null; revenueEstimate?: number | null },
  feats: Features,
): Promise<AiVerdict | null> {
  if (!ANTHROPIC_KEY) return null;

  const prompt = `SYMBOL: ${symbol} (${meta.companyName || "—"})
REPORT: ${meta.reportDate} ${meta.reportTime}
MARKET CAP: ${meta.mktCap ? "$" + meta.mktCap.toLocaleString() : "—"}
CONSENSUS EPS: ${meta.epsEstimate ?? "—"}
CONSENSUS REVENUE: ${meta.revenueEstimate ? "$" + meta.revenueEstimate.toLocaleString() : "—"}

QUANT FEATURES (n=${feats.sample_size})
- Avg 1d post-earnings move: ${feats.hist_avg_move_1d}%
- Beat rate: ${feats.beat_rate_8q}%
- Avg EPS surprise: ${feats.avg_eps_surprise_pct}%
- 5d drift after beat / miss: +${feats.drift_beat_5d}% / ${feats.drift_miss_5d}%
- Revenue growth YoY: ${feats.revenue_growth_yoy == null ? "—" : feats.revenue_growth_yoy + "%"}
- Recent 3mo return: ${feats.recent_3mo_return_pct}%

EDGE LOGIC
- High beat rate (>70%) + positive YoY rev growth + positive 3mo return → BULLISH bias
- Low beat rate (<40%) or negative drift_miss → BEARISH bias
- Small sample (<4) or conflicting signals → AVOID
- High historical move (>5%) → outright trades are higher risk; favor smaller size or call/put spreads

Return STRICT JSON only — no prose, no markdown. confidence < 60 → verdict=AVOID, trade_structure=skip.
{
  "verdict":"BULLISH|BEARISH|AVOID","confidence":0-100,
  "expected_move_pct":float,"directional_bias":"LONG|SHORT|NEUTRAL",
  "trade_structure":"outright_long|outright_short|call_spread|put_spread|skip",
  "entry_strategy":"pre_earnings|post_earnings_drift|fade_reaction|skip",
  "entry_level":float|null,"stop_loss":float|null,"target":float|null,
  "kelly_size_pct":float,
  "thesis":"2 sentences max","key_risks":["risk1","risk2"]
}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 800,
        system: "You are an institutional equity derivatives strategist. Output STRICT JSON only, no prose, no markdown fencing.",
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) {
      console.warn(`[earnings-radar] claude ${r.status} for ${symbol}`);
      return null;
    }
    const data: any = await r.json();
    let txt: string = (data.content || []).map((b: any) => b.text || "").join("").trim();
    txt = txt.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    if (txt.includes("{")) txt = txt.slice(txt.indexOf("{"));
    if (txt.lastIndexOf("}") > 0) txt = txt.slice(0, txt.lastIndexOf("}") + 1);
    const parsed = JSON.parse(txt);
    return parsed as AiVerdict;
  } catch (e: any) {
    console.warn(`[earnings-radar] claude verdict(${symbol}) failed:`, e?.message || e);
    return null;
  }
}

export async function analyzeAndCache(symbol: string, reportDate: string, calRow: EarningsRow): Promise<boolean> {
  try {
    const [feats, profile] = await Promise.all([computeFeatures(symbol), fetchProfile(symbol)]);
    if (!feats) return false;
    const reportTime = "BMO";
    const verdict = await getClaudeVerdict(symbol, {
      companyName: profile.companyName,
      reportDate,
      reportTime,
      mktCap: profile.mktCap,
      epsEstimate: calRow.epsEstimated,
      revenueEstimate: calRow.revenueEstimated,
    }, feats);
    if (!verdict) return false;

    await db.execute(sql`
      INSERT INTO earnings_cache
        (symbol, report_date, report_time, company_name, market_cap,
         eps_estimate, revenue_estimate, features, ai_analysis, computed_at)
      VALUES
        (${symbol}, ${reportDate}, ${reportTime}, ${profile.companyName ?? null}, ${profile.mktCap ?? null},
         ${calRow.epsEstimated ?? null}, ${calRow.revenueEstimated ?? null},
         ${JSON.stringify(feats)}::jsonb, ${JSON.stringify(verdict)}::jsonb, NOW())
      ON CONFLICT (symbol, report_date) DO UPDATE SET
        report_time      = EXCLUDED.report_time,
        company_name     = EXCLUDED.company_name,
        market_cap       = EXCLUDED.market_cap,
        eps_estimate     = EXCLUDED.eps_estimate,
        revenue_estimate = EXCLUDED.revenue_estimate,
        features         = EXCLUDED.features,
        ai_analysis      = EXCLUDED.ai_analysis,
        computed_at      = NOW()
    `);
    return true;
  } catch (e: any) {
    console.warn(`[earnings-radar] analyzeAndCache(${symbol}, ${reportDate}) failed:`, e?.message || e);
    return false;
  }
}

export async function runEarningsScan(opts?: { lookaheadDays?: number; symbols?: string[] }): Promise<{ scanned: number; cached: number; errors: number }> {
  const lookaheadDays = opts?.lookaheadDays ?? 5;
  const whitelist = (opts?.symbols && opts.symbols.length) ? opts.symbols.map(s => s.toUpperCase()) : RADAR_WATCHLIST;
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const from = fmt(today);
  const to = fmt(new Date(today.getTime() + lookaheadDays * 86400000));

  console.log(`[earnings-radar] scan starting from=${from} to=${to} symbols=${whitelist.length}`);
  const calendar = await getEarningsCalendar(from, to);
  const targets = calendar.filter(r => whitelist.includes(r.symbol));
  console.log(`[earnings-radar] ${targets.length} upcoming events match watchlist`);

  let cached = 0;
  let errors = 0;
  // Sequential to stay polite to FMP free tier + Anthropic rate limits.
  for (const row of targets) {
    try {
      const ok = await analyzeAndCache(row.symbol, row.date, row);
      if (ok) cached++; else errors++;
    } catch (e: any) {
      console.warn(`[earnings-radar] iter ${row.symbol} failed:`, e?.message || e);
      errors++;
    }
    await new Promise(r => setTimeout(r, 600)); // ~1.6 req/s
  }
  console.log(`[earnings-radar] scan complete cached=${cached} errors=${errors} scanned=${targets.length}`);
  return { scanned: targets.length, cached, errors };
}

export async function listRadar(opts?: { lookaheadDays?: number }): Promise<any[]> {
  const lookaheadDays = opts?.lookaheadDays ?? 14;
  const today = new Date();
  const to = new Date(today.getTime() + lookaheadDays * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  try {
    const r: any = await db.execute(sql`
      SELECT symbol, report_date, report_time, company_name, market_cap,
             eps_estimate, revenue_estimate, features, ai_analysis, computed_at
        FROM earnings_cache
       WHERE report_date BETWEEN ${fmt(today)}::date AND ${fmt(to)}::date
       ORDER BY (ai_analysis->>'confidence')::numeric DESC NULLS LAST, report_date ASC
       LIMIT 50
    `);
    return Array.isArray(r) ? r : (r?.rows || []);
  } catch (e: any) {
    console.warn("[earnings-radar] listRadar failed:", e?.message || e);
    return [];
  }
}

// ============================================================
// scripts/signal_backtest.cjs
// CLVRQuant — Signal diagnostic + out-of-sample filtered backtest
// ------------------------------------------------------------
// PURPOSE
//   A) Diagnose WHY the conviction score inverts above ~50.
//   B) Test whether structural filters flip profit factor > 1,
//      validated OUT-OF-SAMPLE (train-derived rules, test-applied)
//      so the result is honest, not curve-fit.
//
// DATA SOURCE (auto):
//   - If DATABASE_URL is set → reads table `ai_signal_log`.
//   - Else if arg --csv <path> → reads that CSV.
//   - Read-only. No writes. No schema changes.
//
// RUN:  node scripts/signal_backtest.cjs
//   or: node scripts/signal_backtest.cjs --csv ./signal_trade_log.csv
// ============================================================

const fs = require("fs");

// ---- config (tune here) ----
const CONV_BAND   = [30, 50];     // keep conviction in [lo, hi) — drops the toxic 50+ band
const ALLOWED_LEV = ["2x"];       // leverage whitelist
const TRAIN_FRAC  = 0.60;         // earliest 60% by resolved_at = training
const MIN_TOK_TRAIN = 8;          // min train trades for a token to qualify for whitelist
const THROTTLE_K  = 3;            // max trades/day in throttle simulation

// ---------- load ----------
async function load() {
  const csvArg = process.argv.indexOf("--csv");
  if (csvArg === -1 && process.env.DATABASE_URL) {
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false } });
    const { rows } = await pool.query(
      `SELECT token, direction, leverage, conviction, hold_hours,
              entry_price, stop_loss, tp1_price, tp2_price, tp3_price,
              outcome, pnl_pct, realized_R, created_at, resolved_at
       FROM ai_signal_log
       WHERE outcome IS NOT NULL AND resolved_at IS NOT NULL`);
    await pool.end();
    return rows.map(normalize);
  }
  const path = csvArg !== -1 ? process.argv[csvArg + 1] : "./signal_trade_log.csv";
  const raw = fs.readFileSync(path, "utf8").trim().split("\n");
  const head = raw[0].split(",");
  const idx = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  return raw.slice(1).map(line => {
    const c = line.split(",");
    return normalize({
      token: c[idx.token], direction: c[idx.direction], leverage: c[idx.leverage],
      conviction: c[idx.conviction], hold_hours: c[idx.hold_hours],
      entry_price: c[idx.entry_price], stop_loss: c[idx.stop_loss], tp1_price: c[idx.tp1_price],
      outcome: c[idx.outcome], pnl_pct: c[idx.pnl_pct],
      realized_R: c[idx.realized_R], created_at: c[idx.created_at], resolved_at: c[idx.resolved_at],
    });
  }).filter(r => r.outcome && !isNaN(r.pnl) && !isNaN(r.resolved.getTime()));
}
const num = v => (v === undefined || v === null || v === "" ? NaN : parseFloat(v));
function normalize(r) {
  return {
    token: r.token, direction: r.direction, leverage: r.leverage,
    conviction: num(r.conviction), hold_hours: num(r.hold_hours),
    entry: num(r.entry_price), stop: num(r.stop_loss), tp1: num(r.tp1_price),
    outcome: r.outcome, pnl: num(r.pnl_pct), R: num(r.realized_R),
    created: new Date(r.created_at), resolved: new Date(r.resolved_at),
  };
}

// ---------- metrics ----------
function metrics(rows) {
  const n = rows.length;
  if (!n) return { n: 0 };
  const wins = rows.filter(r => r.R > 0);
  const gp = rows.filter(r => r.pnl > 0).reduce((a, r) => a + r.pnl, 0);
  const gl = -rows.filter(r => r.pnl < 0).reduce((a, r) => a + r.pnl, 0);
  const seq = [...rows].sort((a, b) => a.resolved - b.resolved);
  let eq = 100, peak = 100, maxDD = 0;
  for (const r of seq) { eq *= 1 + r.pnl / 100; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq / peak - 1); }
  const avgW = wins.length ? wins.reduce((a, r) => a + r.pnl, 0) / wins.length : 0;
  const losers = rows.filter(r => r.pnl < 0);
  const avgL = losers.length ? losers.reduce((a, r) => a + r.pnl, 0) / losers.length : 0;
  return {
    n, wr: wins.length / n * 100, pf: gl > 0 ? gp / gl : Infinity,
    expPct: rows.reduce((a, r) => a + r.pnl, 0) / n,
    expR: rows.reduce((a, r) => a + (isNaN(r.R) ? 0 : r.R), 0) / n,
    finalEq: eq, maxDD: maxDD * 100, avgW, avgL,
  };
}
const fmt = (label, m) => m.n
  ? `${label.padEnd(34)} n=${String(m.n).padStart(4)}  WR=${m.wr.toFixed(1).padStart(5)}%  PF=${m.pf.toFixed(2).padStart(4)}  E[%]=${(m.expPct>=0?"+":"")+m.expPct.toFixed(2)}  finalEq=${m.finalEq.toFixed(1).padStart(6)}  maxDD=${m.maxDD.toFixed(1)}%`
  : `${label.padEnd(34)} n=0`;
const median = arr => { const s = arr.filter(x => !isNaN(x)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
function plannedRR(r) {
  if (isNaN(r.tp1) || isNaN(r.entry) || isNaN(r.stop)) return NaN;
  return r.direction === "LONG" ? (r.tp1 - r.entry) / (r.entry - r.stop) : (r.entry - r.tp1) / (r.stop - r.entry);
}

// ---------- main ----------
(async () => {
  const data = await load();
  data.sort((a, b) => a.resolved - b.resolved);
  console.log(`\n================  CLVRQuant SIGNAL DIAGNOSTIC  ================`);
  console.log(`Loaded ${data.length} resolved trades · ${data[0].resolved.toISOString().slice(0,10)} → ${data[data.length-1].resolved.toISOString().slice(0,10)}\n`);

  console.log(`---- BASELINE ----`);
  console.log(fmt("ALL TRADES", metrics(data)));

  // ===== PART A: conviction inversion diagnostic =====
  console.log(`\n========  PART A · WHY CONVICTION INVERTS  ========`);
  console.log(`Conviction bucket performance:`);
  for (const [lo, hi] of [[20,30],[30,40],[40,50],[50,60],[60,80]]) {
    console.log(fmt(`  conv ${lo}-${hi}`, metrics(data.filter(r => r.conviction >= lo && r.conviction < hi))));
  }
  const lowC  = data.filter(r => r.conviction < 50);
  const highC = data.filter(r => r.conviction >= 50);
  const profile = (rows, name) => {
    const lev = {}; rows.forEach(r => lev[r.leverage] = (lev[r.leverage]||0)+1);
    const tok = {}; rows.forEach(r => tok[r.token] = (tok[r.token]||0)+1);
    const topTok = Object.entries(tok).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([t,c])=>`${t}:${(c/rows.length*100).toFixed(0)}%`).join(" ");
    console.log(`\n  [${name}] n=${rows.length}`);
    console.log(`    median hold_hours : ${median(rows.map(r=>r.hold_hours)).toFixed(1)}`);
    console.log(`    % SHORT           : ${(rows.filter(r=>r.direction==="SHORT").length/rows.length*100).toFixed(0)}%`);
    console.log(`    median planned R:R: ${median(rows.map(plannedRR)).toFixed(2)}`);
    console.log(`    leverage mix      : ${Object.entries(lev).map(([k,v])=>`${k}:${(v/rows.length*100).toFixed(0)}%`).join(" ")}`);
    console.log(`    top tokens        : ${topTok}`);
  };
  console.log(`\nStructural comparison — what is DIFFERENT about high-conviction signals:`);
  profile(lowC,  "conviction < 50");
  profile(highC, "conviction >= 50 (the toxic band)");
  console.log(`\n  → Read the deltas above: if the 50+ cohort holds longer, is more short,`);
  console.log(`    runs higher leverage, or concentrates in specific alts, THAT is the`);
  console.log(`    mechanism. The score is rewarding whatever that feature is.`);

  // ===== PART B: out-of-sample filtered backtest =====
  console.log(`\n========  PART B · OUT-OF-SAMPLE FILTERED BACKTEST  ========`);
  const cut = Math.floor(data.length * TRAIN_FRAC);
  const train = data.slice(0, cut), test = data.slice(cut);
  console.log(`Train: ${train.length} trades (to ${train[train.length-1].resolved.toISOString().slice(0,10)})`);
  console.log(`Test : ${test.length} trades (held out, from ${test[0].resolved.toISOString().slice(0,10)})`);

  // derive whitelist from TRAIN ONLY (no peeking at test)
  const byTok = {};
  train.forEach(r => (byTok[r.token] ||= []).push(r));
  const whitelist = Object.entries(byTok)
    .filter(([, rs]) => rs.length >= MIN_TOK_TRAIN && metrics(rs).expPct > 0)
    .map(([t]) => t);
  console.log(`\nWhitelist DERIVED FROM TRAIN (n>=${MIN_TOK_TRAIN}, positive expectancy): ${whitelist.join(", ") || "(none)"}`);

  const rule = r => r.conviction >= CONV_BAND[0] && r.conviction < CONV_BAND[1]
    && ALLOWED_LEV.includes(r.leverage) && whitelist.includes(r.token);

  console.log(`\nRule: conviction in [${CONV_BAND[0]},${CONV_BAND[1]}) AND leverage in {${ALLOWED_LEV}} AND token in whitelist\n`);
  console.log(fmt("TRAIN · baseline",   metrics(train)));
  console.log(fmt("TRAIN · filtered",   metrics(train.filter(rule))));
  console.log(fmt("TEST  · baseline",   metrics(test)));
  const testF = test.filter(rule);
  console.log(fmt("TEST  · filtered (OOS)", metrics(testF)));
  const mtf = metrics(testF);
  console.log(`\n  >>> HONEST VERDICT: out-of-sample filtered PF = ${mtf.n ? mtf.pf.toFixed(2) : "n/a"}` +
    `${mtf.n && mtf.pf > 1 ? "  ✅ edge holds out-of-sample" : "  ⚠️ does NOT hold — rules were curve-fit"}`);
  if (mtf.n < 30) console.log(`  ⚠️ WARNING: only ${mtf.n} OOS trades — sample too small to trust. Gather more data.`);

  // ===== PART C: frequency throttle on OOS filtered =====
  console.log(`\n========  PART C · FREQUENCY THROTTLE (OOS)  ========`);
  const byDay = {};
  testF.forEach(r => (byDay[r.created.toISOString().slice(0,10)] ||= []).push(r));
  const throttled = Object.values(byDay).flatMap(rs =>
    rs.sort((a,b)=>b.conviction-a.conviction).slice(0, THROTTLE_K));
  console.log(`Cap ${THROTTLE_K} highest-conviction trades/day within the filtered set:`);
  console.log(fmt(`TEST · filtered + throttle`, metrics(throttled)));

  // ===== PART D: exit geometry =====
  console.log(`\n========  PART D · EXIT GEOMETRY  ========`);
  const all = metrics(data);
  const breakevenWR = -all.avgL / (all.avgW - all.avgL) * 100;
  console.log(`Avg winner: ${all.avgW.toFixed(2)}%  |  avg loser: ${all.avgL.toFixed(2)}%  |  payoff ratio: ${(all.avgW/-all.avgL).toFixed(2)}`);
  console.log(`Win rate needed to break even at this payoff: ${breakevenWR.toFixed(1)}%  (actual: ${all.wr.toFixed(1)}%)`);
  console.log(`NOTE: log does not contain max-favorable-excursion (MFE), so "let winners run"`);
  console.log(`      cannot be backtested here. ACTION: log MFE per trade going forward to test trailing exits.`);
  console.log(`\n==============================================================\n`);
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });

// ─── SEC EDGAR Form 4 Insider Purchase Tracker ────────────────────────────────
// Uses SEC EDGAR company submissions API to find insider purchases (code "P")
// in 50+ popular companies over the last 14 days.
// - Fetches submissions.json for each company (fast, one API call per company)
// - Downloads and parses only the qualifying Form 4 XML documents
// - Caches results for 20 minutes, refreshes in background

let insiderCache: { data: InsiderTrade[]; ts: number } | null = null;
const CACHE_TTL = 20 * 60 * 1000;
let scanInProgress = false;
let scanProgress = { done: 0, total: 0, phase: "" };

export interface InsiderTrade {
  id: string;
  ticker: string;
  company: string;
  insiderName: string;
  title: string;
  price: number;
  qty: number;
  value: number;
  filingDate: string;
  tradeDate: string;
  isCluster: boolean;
  clusterCount: number;
}

const DATA_API = "https://data.sec.gov/submissions";
const EDGAR_FILES = "https://www.sec.gov/Archives/edgar/data";
const UA = "CLVRQuant market-intelligence@clvrquant.com";

// 50+ popular companies with their SEC CIKs (10-digit padded)
const WATCHLIST: { ticker: string; cik: string }[] = [
  { ticker: "AAPL",  cik: "0000320193" }, { ticker: "MSFT",  cik: "0000789019" },
  { ticker: "GOOGL", cik: "0001652044" }, { ticker: "AMZN",  cik: "0001018724" },
  { ticker: "META",  cik: "0001326801" }, { ticker: "NVDA",  cik: "0001045810" },
  { ticker: "TSLA",  cik: "0001318605" }, { ticker: "NFLX",  cik: "0001065280" },
  { ticker: "AMD",   cik: "0000002488" }, { ticker: "PLTR",  cik: "0001321655" },
  { ticker: "COIN",  cik: "0001679273" }, { ticker: "MSTR",  cik: "0001050446" },
  { ticker: "HOOD",  cik: "0001783398" }, { ticker: "GME",   cik: "0001326380" },
  { ticker: "RIVN",  cik: "0001874178" }, { ticker: "HIMS",  cik: "0001643953" },
  { ticker: "ORCL",  cik: "0001341439" }, { ticker: "JPM",   cik: "0000019617" },
  { ticker: "BAC",   cik: "0000070858" }, { ticker: "GS",    cik: "0000886982" },
  { ticker: "WMT",   cik: "0000104169" }, { ticker: "XOM",   cik: "0000034088" },
  { ticker: "DIS",   cik: "0001001039" }, { ticker: "CRM",   cik: "0001108524" },
  { ticker: "SHOP",  cik: "0001594805" }, { ticker: "SQ",    cik: "0001512673" },
  { ticker: "UBER",  cik: "0001543151" }, { ticker: "LYFT",  cik: "0001759509" },
  { ticker: "SNAP",  cik: "0001564408" }, { ticker: "RBLX",  cik: "0001854815" },
  { ticker: "AFRM",  cik: "0001821144" }, { ticker: "SOFI",  cik: "0001818201" },
  { ticker: "LCID",  cik: "0001841209" }, { ticker: "NIO",   cik: "0001690820" },
  { ticker: "ARM",   cik: "0001728117" }, { ticker: "SMCI",  cik: "0001375365" },
  { ticker: "VRT",   cik: "0001091818" }, { ticker: "DKNG",  cik: "0001801144" },
  { ticker: "PENN",  cik: "0000921738" }, { ticker: "SPOT",  cik: "0001639920" },
  { ticker: "INTC",  cik: "0000050863" }, { ticker: "T",     cik: "0000732717" },
  { ticker: "BA",    cik: "0000012927" }, { ticker: "LMT",   cik: "0000936468" },
  { ticker: "PFE",   cik: "0000078003" }, { ticker: "JNJ",   cik: "0000200406" },
  { ticker: "MRNA",  cik: "0001682852" }, { ticker: "BNTX",  cik: "0001776985" },
  { ticker: "ABBV",  cik: "0001551152" }, { ticker: "BMY",   cik: "0000014272" },
  { ticker: "V",     cik: "0001403161" }, { ticker: "MA",    cik: "0001141391" },
  { ticker: "PYPL",  cik: "0001633917" }, { ticker: "AAON",  cik: "0000824142" },
  { ticker: "SOUN",  cik: "0001840292" }, { ticker: "BBAI",  cik: "0001820175" },
];

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

function normalizeTitle(t: string): string {
  if (!t) return "Insider";
  const u = t.toUpperCase();
  if (u.includes("CEO") || u.includes("CHIEF EXEC")) return "CEO";
  if (u.includes("CFO") || u.includes("CHIEF FIN")) return "CFO";
  if (u.includes("COO") || u.includes("CHIEF OPER")) return "COO";
  if (u.includes("CTO") || u.includes("CHIEF TECH")) return "CTO";
  if (u.includes("CHAIRMAN")) return "Chairman";
  if (u.includes("PRESIDENT")) return "President";
  if (u.includes("DIRECTOR")) return "Director";
  if (u.includes("10%") || u.includes("TEN PERCENT") || u.includes("MAJOR OWNER")) return "10%+ Owner";
  if (u.includes("OFFICER")) return "Officer";
  return t.split(",")[0].trim().substring(0, 22) || "Insider";
}

function parseFloat2(s: string): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(/[$,\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

function resolveTitle(xml: string): string {
  const officerTitle = xml.match(/<officerTitle>([^<]+)<\/officerTitle>/)?.[1]?.trim();
  if (officerTitle) return normalizeTitle(officerTitle);
  const isDirector = xml.match(/<isDirector>([^<]+)<\/isDirector>/)?.[1]?.trim();
  if (isDirector === "1") return "Director";
  const isTen = xml.match(/<isTenPercentOwner>([^<]+)<\/isTenPercentOwner>/)?.[1]?.trim();
  if (isTen === "1") return "10%+ Owner";
  return "Insider";
}

// Parse a Form 4 XML document for purchase transactions
function parseForm4Xml(xml: string, ticker: string, filingDate: string, adsh: string): InsiderTrade[] {
  const ownerName = xml.match(/<rptOwnerName>([^<]*)<\/rptOwnerName>/)?.[1]?.trim() || "Insider";
  const issuerName = xml.match(/<issuerName>([^<]*)<\/issuerName>/)?.[1]?.trim() || ticker;
  const title = resolveTitle(xml);

  const txnBlocks = xml.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/g) || [];
  const trades: InsiderTrade[] = [];

  for (const block of txnBlocks) {
    const code = block.match(/<transactionCode>([^<]+)<\/transactionCode>/)?.[1]?.trim();
    if (code !== "P") continue;

    // Trade date from <transactionDate><value>
    const tradeDateRaw = block.match(/<transactionDate>\s*<value>([^<]+)<\/value>/)?.[1]?.trim() || filingDate;

    const sharesRaw = block.match(/<transactionShares>\s*<value>([^<]+)<\/value>/)?.[1];
    const priceRaw  = block.match(/<transactionPricePerShare>\s*<value>([^<]+)<\/value>/)?.[1];
    const shares = parseFloat2(sharesRaw || "0");
    const price  = parseFloat2(priceRaw  || "0");
    const value  = shares * price;

    if (value < 25000) continue; // $25K minimum

    trades.push({
      id: `${ticker}-${ownerName}-${adsh}`.replace(/[\s\/]/g, "").substring(0, 60),
      ticker,
      company: issuerName.substring(0, 40),
      insiderName: ownerName,
      title,
      price,
      qty: Math.round(shares),
      value,
      filingDate,
      tradeDate: tradeDateRaw,
      isCluster: false,
      clusterCount: 1,
    });
  }
  return trades;
}

// Fetch Form 4 XML for a specific filing
// Raw XML is always at form4.xml in the accession root (primaryDoc may be xslF345X06/form4.xml)
async function fetchForm4Xml(
  filerCik: string, adsh: string, filingDate: string, ticker: string
): Promise<InsiderTrade[]> {
  try {
    const accNoDash = adsh.replace(/-/g, "");
    // Always try raw form4.xml at root first; fall back to .txt submission wrapper
    const urls = [
      `${EDGAR_FILES}/${filerCik}/${accNoDash}/form4.xml`,
      `${EDGAR_FILES}/${filerCik}/${accNoDash}/form4.htm`,
      `${EDGAR_FILES}/${filerCik}/${accNoDash}/${adsh}.txt`,
    ];

    for (const url of urls) {
      try {
        const r = await fetch(url, {
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) continue;
        const text = await r.text();
        if (text.startsWith("<!") || text.startsWith("<html") || text.includes("Rate Threshold")) continue;
        const trades = parseForm4Xml(text, ticker, filingDate, adsh);
        if (trades.length > 0 || text.includes("ownershipDocument")) return trades;
      } catch { continue; }
    }
    return [];
  } catch {
    return [];
  }
}

// Fetch recent Form 4 accession numbers for a company from EDGAR submissions API
async function fetchCompanyForm4s(
  ticker: string, cik: string, cutoff: string
): Promise<{ adsh: string; filerCik: string; filingDate: string }[]> {
  try {
    const r = await fetch(`${DATA_API}/CIK${cik}.json`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return [];
    const d: any = await r.json();
    const forms: string[]   = d?.filings?.recent?.form || [];
    const dates: string[]   = d?.filings?.recent?.filingDate || [];
    const accNums: string[] = d?.filings?.recent?.accessionNumber || [];

    const results: { adsh: string; filerCik: string; filingDate: string }[] = [];
    for (let i = 0; i < forms.length; i++) {
      if (forms[i] !== "4" && forms[i] !== "4/A") continue;
      if (dates[i] < cutoff) break; // filings sorted newest first, stop when too old
      const rawAcc = accNums[i]; // e.g. "0001108524-26-000066"
      const adsh = rawAcc; // keep formatted with dashes
      const filerCik = rawAcc.replace(/-/g, "").substring(0, 10).replace(/^0+/, "");
      results.push({ adsh, filerCik, filingDate: dates[i] });
    }
    return results;
  } catch {
    return [];
  }
}

const MAX_SCAN_MS = 5 * 60 * 1000; // 5-minute hard cap

async function runEdgarScan(): Promise<void> {
  if (scanInProgress) return;
  scanInProgress = true;
  scanProgress = { done: 0, total: WATCHLIST.length, phase: "submissions" };
  const startMs = Date.now();
  try {
    const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().split("T")[0];

    // Step 1: Fetch submissions for all watchlist companies (parallel, 6 at a time)
    const CONCURRENCY = 6;
    type FilingInfo = { ticker: string; adsh: string; filerCik: string; filingDate: string };
    const allFilings: FilingInfo[] = [];

    for (let i = 0; i < WATCHLIST.length; i += CONCURRENCY) {
      if (Date.now() - startMs > MAX_SCAN_MS) {
        console.warn("[insider] scan hit 5-min cap during submissions phase — using partial results");
        break;
      }
      const batch = WATCHLIST.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async ({ ticker, cik }) => {
          const filings = await fetchCompanyForm4s(ticker, cik, cutoff);
          return filings.map(f => ({ ticker, ...f }));
        })
      );
      batchResults.forEach(r => allFilings.push(...r));
      scanProgress.done = Math.min(i + CONCURRENCY, WATCHLIST.length);
      await sleep(250);
    }

    console.log(`[insider] ${allFilings.length} recent Form 4s found for watchlist companies; fetching XMLs...`);

    // Step 2: Download and parse Form 4 XMLs sequentially (800ms gap = SEC-compliant)
    scanProgress = { done: 0, total: allFilings.length, phase: "filings" };
    const allTrades: InsiderTrade[] = [];
    for (let i = 0; i < allFilings.length; i++) {
      if (Date.now() - startMs > MAX_SCAN_MS) {
        console.warn(`[insider] scan hit 5-min cap at filing ${i}/${allFilings.length} — using partial results`);
        scanProgress.done = allFilings.length; // mark as complete so frontend stops spinning
        break;
      }
      const f = allFilings[i];
      const trades = await fetchForm4Xml(f.filerCik, f.adsh, f.filingDate, f.ticker);
      allTrades.push(...trades);
      scanProgress.done = i + 1;
      await sleep(800);
    }

    // Deduplicate
    const seen = new Set<string>();
    const deduped: InsiderTrade[] = [];
    for (const t of allTrades) {
      if (!seen.has(t.id)) { seen.add(t.id); deduped.push(t); }
    }

    // Cluster detection
    const tickerCounts: Record<string, number> = {};
    for (const t of deduped) tickerCounts[t.ticker] = (tickerCounts[t.ticker] || 0) + 1;
    for (const t of deduped) {
      t.clusterCount = tickerCounts[t.ticker] || 1;
      t.isCluster = t.clusterCount >= 2;
    }

    deduped.sort((a, b) => (b.isCluster ? 1 : 0) - (a.isCluster ? 1 : 0) || b.value - a.value);
    const data = deduped.slice(0, 60);
    insiderCache = { data, ts: Date.now() };
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(0);
    console.log(`[insider] EDGAR scan done in ${elapsed}s: ${data.length} purchases ≥$25K in last 14 days (${data.filter(t => t.isCluster).length} cluster)`);
  } catch (e: any) {
    console.error("[insider] scan failed:", e.message);
  } finally {
    scanInProgress = false;
  }
}

// Public API: returns cached data immediately; triggers background refresh if stale
export async function fetchInsiderData(): Promise<InsiderTrade[]> {
  const stale = !insiderCache || (Date.now() - insiderCache.ts > CACHE_TTL);
  if (stale && !scanInProgress) {
    runEdgarScan().catch(e => console.error("[insider] bg scan error:", e.message));
  }
  return insiderCache?.data ?? [];
}

export function getInsiderScanStatus() {
  return {
    scanning: scanInProgress,
    phase: scanProgress.phase,
    done: scanProgress.done,
    total: scanProgress.total,
    hasCachedData: (insiderCache?.data?.length ?? 0) > 0,
    cachedCount: insiderCache?.data?.length ?? 0,
    cachedAt: insiderCache?.ts ?? null,
  };
}

// Called once at server startup to warm the cache
export function startInsiderRefresh(): void {
  console.log("[insider] starting background EDGAR company scan...");
  runEdgarScan().catch(e => console.error("[insider] startup scan error:", e.message));
  setInterval(() => {
    runEdgarScan().catch(e => console.error("[insider] periodic scan error:", e.message));
  }, CACHE_TTL);
}

export function buildInsiderAIContext(trades: InsiderTrade[]): string {
  if (!trades || trades.length === 0) return "";
  const byTicker: Record<string, InsiderTrade[]> = {};
  for (const t of trades) {
    if (!byTicker[t.ticker]) byTicker[t.ticker] = [];
    byTicker[t.ticker].push(t);
  }
  const sorted = Object.entries(byTicker)
    .sort(([, a], [, b]) => b.reduce((s, x) => s + x.value, 0) - a.reduce((s, x) => s + x.value, 0))
    .slice(0, 6);

  const lines: string[] = ["INSIDER BUYING SIGNALS (SEC Form 4, last 14 days, $25K+ buys):"];
  for (const [ticker, ins] of sorted) {
    const total = ins.reduce((s, x) => s + x.value, 0);
    const fmtV = total >= 1e6 ? `$${(total / 1e6).toFixed(1)}M` : `$${(total / 1e3).toFixed(0)}K`;
    const roles = [...new Set(ins.map(i => i.title))].slice(0, 2).join(", ");
    const cluster = ins.length >= 2 ? " [CLUSTER BUY ⚠️]" : "";
    lines.push(`  ${ticker}: ${ins.length} insider${ins.length > 1 ? "s" : ""} (${roles}) bought ${fmtV}${cluster}`);
  }
  return lines.join("\n");
}

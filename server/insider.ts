// ─── OpenInsider.com SEC insider trading scraper ───────────────────────────
// Fetches cluster buys and large individual purchases ($100K+, last 7 days)
// Cached for 15 minutes to avoid hammering the site

let insiderCache: { data: InsiderTrade[]; ts: number } | null = null;
const CACHE_TTL = 15 * 60 * 1000;

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

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === "," && !inQ) { result.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  result.push(cur.trim());
  return result;
}

function parseCSV(text: string): string[][] {
  return text.split("\n").filter(l => l.trim().length > 3).map(parseCSVLine);
}

function parseValue(s: string): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(/[$,\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

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
  if (u.includes("10%") || u.includes("TEN PERCENT") || u.includes("OWNER")) return "10%+ Owner";
  if (u.includes("OFFICER")) return "Officer";
  return t.split(",")[0].trim().substring(0, 22) || "Insider";
}

function parseRows(rows: string[][]): InsiderTrade[] {
  if (rows.length < 2) return [];
  const header = rows[0].map(h => h.toLowerCase());

  const idx = (names: string[]) => {
    for (const n of names) {
      const i = header.findIndex(h => h.includes(n));
      if (i !== -1) return i;
    }
    return -1;
  };

  // OpenInsider CSV columns: X, Filing Date, Trade Date, Ticker, CIK, Insider Name, Title, Trade Type, Price, Qty, Owned, ΔOwned, Value, 1d, 1w, 1m, 6m
  const filingIdx  = idx(["filing date", "filing"]);
  const tradeIdx   = idx(["trade date"]);
  const tickerIdx  = idx(["ticker"]);
  const compIdx    = idx(["company", "issuer"]);
  const nameIdx    = idx(["insider name", "insider", "name"]);
  const titleIdx   = idx(["title"]);
  const typeIdx    = idx(["trade type", "type"]);
  const priceIdx   = idx(["price"]);
  const qtyIdx     = idx(["qty", "shares"]);
  const valueIdx   = idx(["value"]);

  const trades: InsiderTrade[] = [];
  for (const row of rows.slice(1)) {
    if (row.length < 5) continue;

    const tradeType = (row[typeIdx] || "").trim();
    if (!tradeType.startsWith("P") && !tradeType.toUpperCase().includes("PURCHASE")) continue;

    const ticker = (row[tickerIdx] || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
    if (!ticker || ticker.length > 6) continue;

    const value = parseValue(row[valueIdx]);
    if (value < 100000) continue;

    const qty   = Math.round(parseValue((row[qtyIdx] || "").replace(/,/g, "")));
    const price = parseValue(row[priceIdx]);
    const name  = (row[nameIdx] || "").trim();
    const filing = (row[filingIdx] || "").trim();
    const traded = (row[tradeIdx] || filing).trim();

    trades.push({
      id: `${ticker}-${name}-${filing}`.replace(/[\s\/]/g, ""),
      ticker,
      company: (row[compIdx] || ticker).trim().substring(0, 40),
      insiderName: name,
      title: normalizeTitle(row[titleIdx] || ""),
      price,
      qty,
      value,
      filingDate: filing,
      tradeDate:  traded,
      isCluster:  false,
      clusterCount: 1,
    });
  }
  return trades;
}

async function fetchCSV(url: string): Promise<InsiderTrade[]> {
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,text/csv,application/csv,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://openinsider.com/",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return [];
    const text = await r.text();
    if (!text.includes(",") || text.trim().startsWith("<!DOCTYPE")) return [];
    const rows = parseCSV(text);
    return parseRows(rows);
  } catch (e: any) {
    console.error("[insider] fetch error:", e.message?.substring(0, 80));
    return [];
  }
}

export async function fetchInsiderData(): Promise<InsiderTrade[]> {
  if (insiderCache && Date.now() - insiderCache.ts < CACHE_TTL) {
    return insiderCache.data;
  }

  // Fetch from two endpoints: cluster buys page + large screener buys
  const [clusterRaw, screenerRaw] = await Promise.all([
    fetchCSV("https://openinsider.com/latest-cluster-buys?csv=1"),
    fetchCSV(
      "https://openinsider.com/screener?s=&o=&pl=&ph=&ll=&lh=&fd=7&td=&tdr=&fdlyl=&fdlyh=&daysago=&xp=1&xs=1&xd=1&xa=1&xg=1&xf=1&xn=1&po=1&oo=&io=&iod=&fil=0&vl=100&vh=&sortcol=0&cnt=100&page=1&csv=1"
    ),
  ]);

  // Mark cluster buys
  const clusterSet = new Set(clusterRaw.map(t => t.ticker));
  for (const t of clusterRaw) t.isCluster = true;

  // Merge and deduplicate by id
  const seen = new Set<string>();
  const all: InsiderTrade[] = [];
  for (const t of [...clusterRaw, ...screenerRaw]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    if (clusterSet.has(t.ticker)) t.isCluster = true;
    all.push(t);
  }

  // Count insiders per ticker to set clusterCount
  const tickerCounts: Record<string, number> = {};
  for (const t of all) tickerCounts[t.ticker] = (tickerCounts[t.ticker] || 0) + 1;
  for (const t of all) {
    t.clusterCount = tickerCounts[t.ticker] || 1;
    if (t.clusterCount >= 2) t.isCluster = true;
  }

  all.sort((a, b) => {
    if (b.isCluster !== a.isCluster) return b.isCluster ? 1 : -1;
    return b.value - a.value;
  });

  const data = all.slice(0, 60);
  insiderCache = { data, ts: Date.now() };
  console.log(`[insider] Loaded ${data.length} insider trades (${data.filter(t => t.isCluster).length} cluster)`);
  return data;
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

  const lines: string[] = ["INSIDER BUYING SIGNALS (SEC filings, last 7 days, $100K+ buys):"];
  for (const [ticker, ins] of sorted) {
    const total = ins.reduce((s, x) => s + x.value, 0);
    const fmtV = total >= 1e6 ? `$${(total / 1e6).toFixed(1)}M` : `$${(total / 1e3).toFixed(0)}K`;
    const roles = [...new Set(ins.map(i => i.title))].slice(0, 2).join(", ");
    const cluster = ins.length >= 2 ? " [CLUSTER BUY ⚠️]" : "";
    lines.push(`  ${ticker}: ${ins.length} insider${ins.length > 1 ? "s" : ""} (${roles}) bought ${fmtV}${cluster}`);
  }
  return lines.join("\n");
}

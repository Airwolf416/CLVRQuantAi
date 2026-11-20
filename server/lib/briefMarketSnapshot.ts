export interface BriefMarketRow {
  symbol?: string;
  pair?: string;
  price: string;
  priceValue?: number;
  change: string;
  changeNum: number | null;
  sourceChangeNum?: number | null;
}

export interface BriefMarketData {
  crypto: BriefMarketRow[];
  forex: BriefMarketRow[];
  metals: BriefMarketRow[];
  equities: BriefMarketRow[];
  capturedAt?: string;
  changeWindow?: string;
}

export interface StoredBriefMarketSnapshot {
  localDate: string;
  timeZone: string;
  capturedAt: string;
  changeWindow: string;
  data: BriefMarketData;
}

type QueryResult = { rows: any[]; rowCount?: number | null };
type SnapshotDatabase = { query(sql: string, values?: any[]): Promise<QueryResult> };

export const BRIEF_MARKET_SNAPSHOT_DDL = `
  CREATE TABLE IF NOT EXISTS daily_brief_market_snapshots (
    time_zone TEXT NOT NULL,
    local_date DATE NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (time_zone, local_date)
  )
`;

function parsePrice(value: unknown): number {
  if (typeof value === "number") return value;
  const n = Number(String(value ?? "").replace(/[$€£¥,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function rowKey(row: BriefMarketRow): string {
  return String(row.pair || row.symbol || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function snapshotChange(current: number, previous: number | undefined): number | null {
  if (!(Number.isFinite(current) && current > 0 && Number.isFinite(previous) && (previous as number) > 0)) return null;
  return ((current - (previous as number)) / (previous as number)) * 100;
}

function formatChange(change: number | null): string {
  return change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
}

export function buildBriefMarketSnapshot(
  data: BriefMarketData,
  previous: BriefMarketData | null,
  localDate: string,
  timeZone: string,
  capturedAt: string,
): StoredBriefMarketSnapshot {
  const previousPrices = new Map<string, number>();
  if (previous) {
    for (const group of ["crypto", "forex", "metals", "equities"] as const) {
      for (const row of previous[group] || []) {
        const key = rowKey(row);
        const value = Number.isFinite(Number(row.priceValue)) ? Number(row.priceValue) : parsePrice(row.price);
        if (key && Number.isFinite(value) && value > 0) previousPrices.set(key, value);
      }
    }
  }

  const withChanges = {} as BriefMarketData;
  for (const group of ["crypto", "forex", "metals", "equities"] as const) {
    withChanges[group] = (data[group] || []).map(row => {
      const key = rowKey(row);
      const currentPrice = Number.isFinite(Number(row.priceValue)) ? Number(row.priceValue) : parsePrice(row.price);
      const changeNum = snapshotChange(currentPrice, previousPrices.get(key));
      return { ...row, priceValue: currentPrice, changeNum, change: formatChange(changeNum) };
    });
  }
  const changeWindow = previous
    ? "Since the previous local 6:00 AM snapshot"
    : "No previous local 6:00 AM snapshot; change unavailable";
  withChanges.capturedAt = capturedAt;
  withChanges.changeWindow = changeWindow;
  return { localDate, timeZone, capturedAt, changeWindow, data: withChanges };
}

function normalizeStoredRow(row: any, localDate: string, timeZone: string): StoredBriefMarketSnapshot | null {
  if (!row) return null;
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  if (!payload || typeof payload !== "object" || !payload.data) return null;
  const capturedAt = payload.capturedAt || row.captured_at;
  if (!capturedAt) return null;
  const data = payload.data as BriefMarketData;
  return {
    localDate: payload.localDate || localDate,
    timeZone: payload.timeZone || timeZone,
    capturedAt: new Date(capturedAt).toISOString(),
    changeWindow: payload.changeWindow || "Since the previous local 6:00 AM snapshot",
    data: { ...data, capturedAt: new Date(capturedAt).toISOString(), changeWindow: payload.changeWindow || "Since the previous local 6:00 AM snapshot" },
  };
}

async function readSnapshot(db: SnapshotDatabase, timeZone: string, localDate: string) {
  const result = await db.query(`
    SELECT time_zone, local_date::text AS local_date, captured_at, payload
    FROM daily_brief_market_snapshots
    WHERE time_zone=$1 AND local_date=$2::date
    LIMIT 1
  `, [timeZone, localDate]);
  return result.rows[0] || null;
}

export async function getOrCreateBriefMarketSnapshot(
  db: SnapshotDatabase,
  timeZone: string,
  localDate: string,
  fetchCurrent: () => Promise<BriefMarketData>,
  now: () => Date = () => new Date(),
): Promise<StoredBriefMarketSnapshot> {
  const existing = normalizeStoredRow(await readSnapshot(db, timeZone, localDate), localDate, timeZone);
  if (existing) return existing;

  const previousResult = await db.query(`
    SELECT payload
    FROM daily_brief_market_snapshots
    WHERE time_zone=$1 AND local_date=($2::date - 1)
    LIMIT 1
  `, [timeZone, localDate]);
  const previousPayload = previousResult.rows[0]?.payload;
  const previous = previousPayload
    ? (typeof previousPayload === "string" ? JSON.parse(previousPayload) : previousPayload)?.data as BriefMarketData || null
    : null;

  const data = await fetchCurrent();
  const capturedAt = now().toISOString();
  const snapshot = buildBriefMarketSnapshot(data, previous, localDate, timeZone, capturedAt);
  const payload = JSON.stringify(snapshot);
  const inserted = await db.query(`
    INSERT INTO daily_brief_market_snapshots (time_zone, local_date, captured_at, payload)
    VALUES ($1, $2::date, $3::timestamptz, $4::jsonb)
    ON CONFLICT (time_zone, local_date) DO NOTHING
    RETURNING time_zone
  `, [timeZone, localDate, capturedAt, payload]);
  if (inserted.rows.length) return snapshot;

  // A concurrent caller won the insert. Return its immutable snapshot instead
  // of sending with the losing caller's independently fetched prices.
  const winner = normalizeStoredRow(await readSnapshot(db, timeZone, localDate), localDate, timeZone);
  if (!winner) throw new Error("Morning market snapshot was not available after a concurrent insert");
  return winner;
}

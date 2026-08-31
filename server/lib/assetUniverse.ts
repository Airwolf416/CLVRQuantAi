import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { CRYPTO_SYMS, HL_PERP_SYMS, HL_TO_APP, HL_SCALE_FACTORS } from "../config/assets";
import {
  UNIVERSE_SCHEMA_VERSION,
  type AssetUniverseRecord,
  type UniverseDto,
  type UniverseReasonCode,
} from "@shared/universe";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const STALE_MS = 12 * 60 * 60 * 1000;
const LEASE_MS = 2 * 60 * 1000;
const holder = `${process.pid}:${randomUUID()}`;
let nextPersistAt = 0;
let inFlight: Promise<void> | null = null;
let lastGood: UniverseDto | null = null;
const graduatedNewListings = new Set<string>();
type UniverseDb = Pick<typeof pool, "query" | "connect">;
let universeDb: UniverseDb = pool;

/** Test seam for isolated repository integration tests. */
export function setUniverseRepositoryForTests(repository: UniverseDb | null): void {
  universeDb = repository || pool;
  lastGood = null;
  nextPersistAt = 0;
  inFlight = null;
  graduatedNewListings.clear();
}

const scorerSymbols = new Set(CRYPTO_SYMS);
const scorerRawSymbols = new Set(HL_PERP_SYMS);
const scorerCanonicalSymbols = new Set(HL_PERP_SYMS.map(symbol => HL_TO_APP[symbol] || symbol));

export function isHyperliquidScorerSupported(symbol: string): boolean {
  const raw = String(symbol || "").trim();
  const canonical = HL_TO_APP[raw] || raw;
  return scorerSymbols.has(canonical) && scorerCanonicalSymbols.has(canonical);
}

export function newListingGraduated(
  floorMetSince: string | null | undefined,
  uncensoredOutcomeCount: number | null | undefined,
  now = Date.now(),
): boolean {
  if (Number.isFinite(uncensoredOutcomeCount) && Number(uncensoredOutcomeCount) >= 25) return true;
  const floor = floorMetSince ? new Date(floorMetSince).getTime() : NaN;
  return Number.isFinite(floor) && now - floor >= 30 * 86400_000;
}

function finite(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseHyperliquidUniverse(
  payload: unknown,
  now = new Date(),
  existingFirstSeen: Record<string, string> = {},
  venue = "hyperliquid",
): AssetUniverseRecord[] {
  if (!Array.isArray(payload) || payload.length !== 2) throw new Error("HL_UNIVERSE_MALFORMED");
  const meta = payload[0] as any;
  const contexts = payload[1] as any;
  if (!meta || !Array.isArray(meta.universe) || !Array.isArray(contexts)
      || contexts.length !== meta.universe.length) throw new Error("HL_UNIVERSE_PARTIAL");
  const at = now.toISOString();
  return meta.universe.map((asset: any, index: number) => {
    if (!asset || typeof asset.name !== "string" || !asset.name.trim()
        || !Number.isInteger(asset.szDecimals)) throw new Error("HL_UNIVERSE_ASSET_MALFORMED");
    const rawSymbol = asset.name.trim();
    const canonicalSymbol = HL_TO_APP[rawSymbol] || rawSymbol;
    const ctx = contexts[index];
    if (!ctx || typeof ctx !== "object") throw new Error("HL_UNIVERSE_CONTEXT_MALFORMED");
    const scale = HL_SCALE_FACTORS[rawSymbol] ?? 1;
    const markRaw = finite(ctx.markPx);
    const markPrice = markRaw == null ? NaN : markRaw * scale;
    const volume24hUsd = finite(ctx.dayNtlVlm) ?? 0;
    const openInterestRaw = finite(ctx.openInterest);
    // OI is denominated in venue contract units, so its USD notional uses the
    // venue mark before display-token alias scaling (not the canonical token mark).
    const openInterestUsd = openInterestRaw != null && markRaw != null
      ? openInterestRaw * markRaw : null;
    const funding = finite(ctx.funding);
    const explicitlyDelisted = asset.isDelisted === true;
    // The default Hyperliquid clearinghouse metadata is crypto. HIP-3 metadata
    // must explicitly provide an asset class; symbol-name heuristics are forbidden.
    const isHip3 = asset.isHip3 === true || asset.hip3 === true || typeof asset.dex === "string";
    const assetClass = isHip3 ? "equity"
      : asset.assetClass === "equity" ? "equity"
      // The native (no-dex) meta endpoint is the authoritative crypto
      // clearinghouse universe. A dex-tagged market without an explicit
      // authoritative class must fail closed above rather than be guessed.
      : asset.assetClass === "crypto" || asset.assetClass == null ? "crypto" : "unknown";
    const scorerSupported = assetClass === "crypto"
      && scorerRawSymbols.has(rawSymbol) && scorerSymbols.has(canonicalSymbol);
    const reasons: UniverseReasonCode[] = [];
    if (explicitlyDelisted) reasons.push("NOT_TRADABLE");
    if (!(Number.isFinite(markPrice) && markPrice > 0)) reasons.push("INVALID_MARK");
    if (volume24hUsd < 25_000_000) reasons.push("VOLUME_BELOW_25M");
    if (openInterestUsd == null) reasons.push("OPEN_INTEREST_MISSING");
    else if (openInterestUsd < 5_000_000) reasons.push("OPEN_INTEREST_BELOW_5M");
    if (assetClass === "unknown") reasons.push("ASSET_CLASS_CONTEXT_MISSING");
    if (assetClass === "equity") reasons.push("EQUITY_CONTEXT_PENDING");
    if (!scorerSupported && assetClass !== "equity") reasons.push("SCORER_UNSUPPORTED");
    const discoveredAt = existingFirstSeen[rawSymbol] || at;
    const venueListedAt = asset.listedAt && Number.isFinite(new Date(asset.listedAt).getTime())
      ? new Date(asset.listedAt).toISOString() : null;
    // First-seen is valid lower-bound evidence only for genuinely newly
    // discovered contracts. The startup allowlist predates this collector and
    // must not be falsely labelled as newly listed on migration day.
    const ageEvidenceAt = venueListedAt || (!scorerRawSymbols.has(rawSymbol) ? discoveredAt : null);
    const isNew = ageEvidenceAt != null
      && now.getTime() - new Date(ageEvidenceAt).getTime() < 30 * 86400_000;
    if (isNew) reasons.push("NEW_LISTING");
    const blocking = reasons.filter(reason => reason !== "NEW_LISTING");
    const liquid = !reasons.includes("VOLUME_BELOW_25M")
      && !reasons.includes("OPEN_INTEREST_MISSING")
      && !reasons.includes("OPEN_INTEREST_BELOW_5M");
    return {
      venue,
      rawSymbol,
      displaySymbol: canonicalSymbol,
      canonicalSymbol,
      marketType: "perp",
      assetClass,
      sizeDecimals: asset.szDecimals,
      priceDecimals: Number.isInteger(asset.pxDecimals) ? asset.pxDecimals : null,
      maxLeverage: finite(asset.maxLeverage),
      markPrice: Number.isFinite(markPrice) ? markPrice : 0,
      volume24hUsd,
      openInterestRaw,
      openInterestUsd,
      funding,
      status: explicitlyDelisted ? "delisted" : liquid ? "active" : "quarantine",
      eligible: blocking.length === 0,
      eligibilityReasons: reasons.length ? reasons : ["ELIGIBLE"],
      scorerSupported,
      scorerSupportReason: scorerSupported ? null
        : assetClass === "equity" ? "EQUITY_CONTEXT_PENDING" : "SCORER_UNSUPPORTED",
      discoveredAt,
      lastSeenAt: at,
      lastSuccessfulRefreshAt: at,
      floorMetSince: liquid ? at : null,
      listingEvidence: venueListedAt
        ? { kind: "venue", at: venueListedAt }
        : { kind: "first_seen", at: scorerRawSymbols.has(rawSymbol) ? null : discoveredAt },
      version: UNIVERSE_SCHEMA_VERSION,
    };
  });
}

export function staticUniverse(now = new Date()): UniverseDto {
  const at = now.toISOString();
  return {
    version: UNIVERSE_SCHEMA_VERSION,
    generatedAt: at,
    source: "static-fallback",
    stale: true,
    fallback: true,
    assets: HL_PERP_SYMS.map(rawSymbol => {
      const canonicalSymbol = HL_TO_APP[rawSymbol] || rawSymbol;
      return {
        venue: "hyperliquid", rawSymbol, displaySymbol: canonicalSymbol, canonicalSymbol,
        marketType: "perp", assetClass: "crypto", sizeDecimals: 0, priceDecimals: null,
        maxLeverage: null, markPrice: 0, volume24hUsd: 0, openInterestRaw: null,
        openInterestUsd: null, funding: null, status: "active", eligible: true,
        eligibilityReasons: ["ELIGIBLE"], scorerSupported: true, scorerSupportReason: null,
        discoveredAt: at, lastSeenAt: at, lastSuccessfulRefreshAt: at,
        floorMetSince: null, listingEvidence: { kind: "first_seen", at: null },
        version: UNIVERSE_SCHEMA_VERSION,
      };
    }),
  };
}

async function acquireLease(): Promise<boolean> {
  const result = await universeDb.query(`
    INSERT INTO signal_policy_leases (lease_name, holder, expires_at, updated_at)
    VALUES ('hl-universe-discovery', $1, NOW() + ($2 * INTERVAL '1 millisecond'), NOW())
    ON CONFLICT (lease_name) DO UPDATE SET holder=EXCLUDED.holder,
      expires_at=EXCLUDED.expires_at, updated_at=NOW()
    WHERE signal_policy_leases.expires_at < NOW() OR signal_policy_leases.holder=EXCLUDED.holder
    RETURNING holder
  `, [holder, LEASE_MS]);
  return result.rowCount === 1;
}

async function persistSnapshot(payload: unknown, venue = "hyperliquid", includeDexes = true): Promise<void> {
  if (!await acquireLease()) {
    // A replica that lost the lease must converge on the winner's committed
    // snapshot instead of serving its process-local stale copy.
    await loadUniverseLastKnownGood();
    return;
  }
  const firstSeenResult = await universeDb.query(
    "SELECT raw_symbol, canonical_symbol, discovered_at, floor_met_since FROM asset_universe WHERE venue=$1", [venue],
  );
  const firstSeen = Object.fromEntries(firstSeenResult.rows.map(row =>
    [row.raw_symbol, new Date(row.discovered_at).toISOString()]));
  const refreshNow = new Date();
  const assets = parseHyperliquidUniverse(payload, refreshNow, firstSeen, venue);
  // Graduation is based solely on durable evidence. A DB error intentionally
  // leaves the listing pending (fail closed), never grants an emission right.
  let outcomeCounts: Record<string, number> = {};
  try {
    const counts = await universeDb.query(`
      SELECT UPPER(token) AS symbol, COUNT(*)::int AS count
      FROM ai_signal_log
      WHERE calibration_label IN ('WIN','LOSS')
      GROUP BY UPPER(token)
    `);
    outcomeCounts = Object.fromEntries(counts.rows.map(row => [row.symbol, Number(row.count)]));
  } catch {
    outcomeCounts = {};
  }
  const priorFloors = Object.fromEntries(firstSeenResult.rows.map(row => [row.raw_symbol, row.floor_met_since]));
  for (const asset of assets) {
    const priorFloor = priorFloors[asset.rawSymbol];
    if (asset.status === "active" && priorFloor) asset.floorMetSince = new Date(priorFloor).toISOString();
    if (newListingGraduated(asset.floorMetSince, outcomeCounts[asset.canonicalSymbol.toUpperCase()], refreshNow.getTime())) {
      asset.eligibilityReasons = asset.eligibilityReasons.filter(reason => reason !== "NEW_LISTING");
      if (!asset.eligibilityReasons.length) asset.eligibilityReasons = ["ELIGIBLE"];
      graduatedNewListings.add(asset.canonicalSymbol.toUpperCase());
    } else if (asset.eligibilityReasons.includes("NEW_LISTING")) {
      graduatedNewListings.delete(asset.canonicalSymbol.toUpperCase());
    }
  }
  const rawUniverse = (payload as any)[0].universe;
  const rawContexts = (payload as any)[1];
  const client = await universeDb.connect();
  try {
    await client.query("BEGIN");
    const versionResult = await client.query(
      "INSERT INTO asset_universe_snapshots (schema_version, asset_count) VALUES ($1,$2) RETURNING id, created_at",
      [UNIVERSE_SCHEMA_VERSION, assets.length],
    );
    const snapshotId = Number(versionResult.rows[0].id);
    for (const [assetIndex, asset] of assets.entries()) {
      await client.query(`
        INSERT INTO asset_universe (
          venue, raw_symbol, display_symbol, canonical_symbol, market_type, asset_class,
          size_decimals, price_decimals, max_leverage, mark_price, day_volume_usd,
          open_interest_raw, open_interest_usd, funding, status, eligible,
          eligibility_reasons, scorer_supported, scorer_support_reason, discovered_at,
          last_seen_at, last_successful_refresh_at, floor_met_since, listing_evidence,
          missing_refresh_count, last_missing_at, snapshot_version, schema_version, raw_metadata, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
          $20,$21,$22,$23,$24,0,NULL,$25,$26,$27,NOW()
        )
        ON CONFLICT (venue, raw_symbol) DO UPDATE SET
          display_symbol=EXCLUDED.display_symbol, canonical_symbol=EXCLUDED.canonical_symbol,
          market_type=EXCLUDED.market_type, asset_class=EXCLUDED.asset_class,
          size_decimals=EXCLUDED.size_decimals, price_decimals=EXCLUDED.price_decimals,
          max_leverage=EXCLUDED.max_leverage, mark_price=EXCLUDED.mark_price,
          day_volume_usd=EXCLUDED.day_volume_usd, open_interest_raw=EXCLUDED.open_interest_raw,
          open_interest_usd=EXCLUDED.open_interest_usd, funding=EXCLUDED.funding,
          status=EXCLUDED.status, eligible=EXCLUDED.eligible,
          eligibility_reasons=EXCLUDED.eligibility_reasons,
          scorer_supported=EXCLUDED.scorer_supported,
          scorer_support_reason=EXCLUDED.scorer_support_reason,
          last_seen_at=EXCLUDED.last_seen_at,
          last_successful_refresh_at=EXCLUDED.last_successful_refresh_at,
          floor_met_since=CASE WHEN EXCLUDED.status='active'
            THEN COALESCE(asset_universe.floor_met_since, EXCLUDED.floor_met_since) ELSE NULL END,
          listing_evidence=EXCLUDED.listing_evidence, missing_refresh_count=0,
          last_missing_at=NULL, snapshot_version=EXCLUDED.snapshot_version,
          schema_version=EXCLUDED.schema_version, raw_metadata=EXCLUDED.raw_metadata, updated_at=NOW()
      `, [
        asset.venue, asset.rawSymbol, asset.displaySymbol, asset.canonicalSymbol,
        asset.marketType, asset.assetClass, asset.sizeDecimals, asset.priceDecimals,
        asset.maxLeverage, asset.markPrice, asset.volume24hUsd, asset.openInterestRaw,
        asset.openInterestUsd, asset.funding, asset.status, asset.eligible,
        asset.eligibilityReasons, asset.scorerSupported, asset.scorerSupportReason,
        asset.discoveredAt, asset.lastSeenAt, asset.lastSuccessfulRefreshAt,
        asset.floorMetSince, asset.listingEvidence, snapshotId, UNIVERSE_SCHEMA_VERSION,
        {
          source: "metaAndAssetCtxs",
          asset: rawUniverse[assetIndex],
          context: rawContexts[assetIndex],
        },
      ]);
    }
    await client.query(`
      UPDATE asset_universe SET missing_refresh_count=missing_refresh_count+1,
        last_missing_at=NOW(),
        status=CASE WHEN missing_refresh_count+1 >= 2 THEN 'delisted' ELSE status END,
        eligible=CASE WHEN missing_refresh_count+1 >= 2 THEN false ELSE eligible END,
        updated_at=NOW()
      WHERE venue=$2 AND snapshot_version <> $1
    `, [snapshotId, venue]);
    await client.query("COMMIT");
    lastGood = {
      version: `${UNIVERSE_SCHEMA_VERSION}:${snapshotId}`,
      generatedAt: new Date(versionResult.rows[0].created_at).toISOString(),
      source: "live", stale: false, fallback: false, assets,
    };
    // HIP-3/perp-dex markets are discovered through the venue's bulk dex
    // metadata flow only. This runs under the same lease/cadence, never from
    // the five-second tick and never with per-symbol requests.
    if (includeDexes) {
      const dexResponse = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "perpDexs" }), signal: AbortSignal.timeout(5000),
      });
      if (!dexResponse.ok) throw new Error("HL_PERP_DEX_METADATA_FAILED");
      const dexes: any = await dexResponse.json();
      if (!Array.isArray(dexes)) throw new Error("HL_PERP_DEX_METADATA_MALFORMED");
      for (const dex of dexes) {
        const name = typeof dex === "string" ? dex : dex?.name;
        if (!name || typeof name !== "string") continue;
        const response = await fetch("https://api.hyperliquid.xyz/info", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "metaAndAssetCtxs", dex: name }), signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`HL_PERP_DEX_${name}_FAILED`);
        const dexPayload: any = await response.json();
        // Tag every dex market as HIP-3 unless the authoritative dex metadata
        // explicitly declares another class. Parser therefore fails closed.
        if (Array.isArray(dexPayload?.[0]?.universe)) {
          dexPayload[0].universe = dexPayload[0].universe.map((asset: any) => ({
            ...asset, dex: name, assetClass: dex?.assetClass ?? asset?.assetClass ?? "unknown",
          }));
        }
        await persistSnapshot(dexPayload, `hyperliquid:${name}`, false);
      }
      await loadUniverseLastKnownGood();
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Executes the complete leased transaction without upstream dex I/O. */
export async function persistUniverseSnapshotForTests(payload: unknown, venue = "hyperliquid"): Promise<void> {
  await persistSnapshot(payload, venue, false);
}

export function observeHyperliquidMeta(payload: unknown): void {
  if (Date.now() < nextPersistAt || inFlight) return;
  nextPersistAt = Date.now() + SIX_HOURS_MS;
  inFlight = persistSnapshot(payload)
    .catch(error => console.error("[hl-universe] refresh failed; retaining LKG:", error?.message))
    .finally(() => { inFlight = null; });
}

function rowToRecord(row: any): AssetUniverseRecord {
  return {
    venue: "hyperliquid", rawSymbol: row.raw_symbol, displaySymbol: row.display_symbol,
    canonicalSymbol: row.canonical_symbol, marketType: "perp", assetClass: row.asset_class,
    sizeDecimals: row.size_decimals, priceDecimals: row.price_decimals,
    maxLeverage: finite(row.max_leverage), markPrice: finite(row.mark_price) || 0,
    volume24hUsd: finite(row.day_volume_usd) || 0, openInterestRaw: finite(row.open_interest_raw),
    openInterestUsd: finite(row.open_interest_usd), funding: finite(row.funding),
    status: row.status, eligible: row.eligible, eligibilityReasons: row.eligibility_reasons,
    scorerSupported: row.scorer_supported, scorerSupportReason: row.scorer_support_reason,
    discoveredAt: new Date(row.discovered_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
    lastSuccessfulRefreshAt: new Date(row.last_successful_refresh_at).toISOString(),
    floorMetSince: row.floor_met_since ? new Date(row.floor_met_since).toISOString() : null,
    listingEvidence: row.listing_evidence, version: row.schema_version,
  };
}

export async function loadUniverseLastKnownGood(): Promise<void> {
  try {
    const result = await universeDb.query("SELECT * FROM asset_universe ORDER BY canonical_symbol");
    if (!result.rows.length) return;
    const assets = result.rows.map(rowToRecord);
    const generatedAt = assets.reduce((latest, asset) =>
      asset.lastSuccessfulRefreshAt > latest ? asset.lastSuccessfulRefreshAt : latest, "");
    const stale = Date.now() - new Date(generatedAt).getTime() > STALE_MS;
    lastGood = {
      version: `${UNIVERSE_SCHEMA_VERSION}:lkg`, generatedAt,
      source: stale ? "last-known-good" : "live", stale, fallback: false, assets,
    };
  } catch (error: any) {
    console.warn("[hl-universe] no durable snapshot; using static fallback:", error?.message);
  }
}

export function getUniverseDto(): UniverseDto {
  if (!lastGood) return staticUniverse();
  const stale = Date.now() - new Date(lastGood.generatedAt).getTime() > STALE_MS;
  return { ...lastGood, stale, source: stale ? "last-known-good" : lastGood.source };
}

export function getDiscoveredHyperliquidSupport(symbol: string): {
  discovered: boolean; supported: boolean; code: string | null;
} {
  const normalized = String(symbol || "").trim().toUpperCase();
  const asset = lastGood?.assets.find(item =>
    item.canonicalSymbol.toUpperCase() === normalized || item.rawSymbol.toUpperCase() === normalized);
  return asset
    ? {
        discovered: true,
        supported: asset.eligible && asset.status === "active" && asset.scorerSupported,
        code: asset.scorerSupportReason || (asset.eligible ? null : asset.eligibilityReasons[0]) || null,
      }
    : { discovered: false, supported: false, code: null };
}

export function getHyperliquidEmissionEligibility(
  symbol: string,
  context: { marketType?: string | null; assetClass?: string | null; forceHyperliquid?: boolean } = {},
): { applies: boolean; allowed: boolean; code: string | null } {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized) return { applies: false, allowed: true, code: null };
  const asset = lastGood?.assets.find(item =>
    item.canonicalSymbol.toUpperCase() === normalized || item.rawSymbol.toUpperCase() === normalized);
  const legacyApproved = isHyperliquidScorerSupported(normalized);
  const marketType = String(context.marketType || "").toUpperCase();
  const assetClass = String(context.assetClass || "").toLowerCase();
  const applies = context.forceHyperliquid === true
    || ((!!asset || legacyApproved)
      && (marketType === "PERP" || marketType === "BOTH" || assetClass === "crypto"));
  if (!applies) return { applies: false, allowed: true, code: null };
  if (asset) {
    const allowed = asset.status === "active" && asset.eligible && asset.scorerSupported;
    const code = allowed ? null : asset.status === "delisted" ? "MARKET_DELISTED"
      : asset.status === "quarantine" ? "LIQUIDITY_QUARANTINED"
      : asset.scorerSupportReason || asset.eligibilityReasons.find(reason => reason !== "ELIGIBLE")
      || "SCORER_UNSUPPORTED";
    return { applies: true, allowed, code };
  }
  // Durable state may be unavailable during startup. Only the explicit,
  // longstanding scorer allowlist survives that fallback; unknowns fail shut.
  return { applies: true, allowed: legacyApproved, code: legacyApproved ? null : "SCORER_UNSUPPORTED" };
}

/** Synchronous policy input populated only from a validated durable snapshot. */
export function isNewListingPending(symbol: string): boolean {
  const normalized = String(symbol || "").trim().toUpperCase();
  const asset = lastGood?.assets.find(item => item.canonicalSymbol.toUpperCase() === normalized);
  if (!asset?.scorerSupported || graduatedNewListings.has(normalized)
      || !asset.eligibilityReasons.includes("NEW_LISTING")) return false;
  return !asset.floorMetSince
    || Date.now() - new Date(asset.floorMetSince).getTime() < 30 * 86400_000;
}
export const UNIVERSE_SCHEMA_VERSION = "hl-universe-v1";

export type UniverseVenue = string;
export type UniverseStatus = "active" | "quarantine" | "delisted";
export type UniverseReasonCode =
  | "ELIGIBLE"
  | "NOT_TRADABLE"
  | "INVALID_MARK"
  | "VOLUME_BELOW_25M"
  | "OPEN_INTEREST_MISSING"
  | "OPEN_INTEREST_BELOW_5M"
  | "SCORER_UNSUPPORTED"
  | "ASSET_CLASS_CONTEXT_MISSING"
  | "EQUITY_CONTEXT_PENDING"
  | "NEW_LISTING";

export interface AssetUniverseRecord {
  venue: UniverseVenue;
  rawSymbol: string;
  displaySymbol: string;
  canonicalSymbol: string;
  marketType: "perp";
  assetClass: "crypto" | "equity" | "unknown";
  sizeDecimals: number;
  priceDecimals: number | null;
  maxLeverage: number | null;
  markPrice: number;
  volume24hUsd: number;
  openInterestRaw: number | null;
  openInterestUsd: number | null;
  funding: number | null;
  status: UniverseStatus;
  eligible: boolean;
  eligibilityReasons: UniverseReasonCode[];
  scorerSupported: boolean;
  scorerSupportReason: UniverseReasonCode | null;
  discoveredAt: string;
  lastSeenAt: string;
  lastSuccessfulRefreshAt: string;
  floorMetSince: string | null;
  listingEvidence: { kind: "first_seen" | "venue"; at: string | null };
  version: string;
}

export interface UniverseDto {
  version: string;
  generatedAt: string;
  source: "live" | "last-known-good" | "static-fallback";
  stale: boolean;
  fallback: boolean;
  assets: AssetUniverseRecord[];
}
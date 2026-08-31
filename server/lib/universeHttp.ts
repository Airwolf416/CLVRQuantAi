import type { Express, Request } from "express";
import { getUniverseDto, loadUniverseLastKnownGood } from "./assetUniverse";

export function canonicalMarketType(value: unknown): "PERP" | "SPOT" | "BOTH" | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized === "PERP" || normalized === "SPOT" || normalized === "BOTH" ? normalized : null;
}

export function discoveredPerpDenial(
  marketType: "PERP" | "SPOT" | "BOTH",
  symbol: string,
  support: { discovered: boolean; supported: boolean },
  status?: string,
): string | null {
  if (marketType === "SPOT" || !support.discovered || support.supported) return null;
  return status === "delisted" ? "MARKET_DELISTED"
    : status === "quarantine" ? "LIQUIDITY_QUARANTINED" : "SCORER_UNSUPPORTED";
}

export function registerUniverseHttpRoute(
  app: Pick<Express, "get">,
  deps = { load: loadUniverseLastKnownGood, get: getUniverseDto },
): void {
  app.get("/api/universe", async (req: Request, res) => {
    if (!(req.session as any)?.userId) {
      return res.status(401).json({ error: "Authentication required", code: "UNAUTHENTICATED" });
    }
    await deps.load();
    const universe = deps.get();
    res.setHeader("Cache-Control", "private, max-age=60, stale-if-error=300");
    return res.json({
      version: universe.version, generatedAt: universe.generatedAt,
      freshness: { stale: universe.stale, fallback: universe.fallback, source: universe.source },
      assets: universe.assets.map(asset => ({
        venue: asset.venue, rawSymbol: asset.rawSymbol, symbol: asset.displaySymbol,
        canonicalSymbol: asset.canonicalSymbol, marketType: asset.marketType,
        assetClass: asset.assetClass, status: asset.status, eligible: asset.eligible,
        supportStatus: asset.scorerSupported ? "supported" : "unsupported",
        supportReason: asset.scorerSupportReason, reasons: asset.eligibilityReasons,
        markPrice: asset.markPrice || null, volume24hUsd: asset.volume24hUsd || null,
        openInterestUsd: asset.openInterestUsd, funding: asset.funding, lastSeenAt: asset.lastSeenAt,
      })),
    });
  });
}
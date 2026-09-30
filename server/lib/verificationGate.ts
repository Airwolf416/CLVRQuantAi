// Public site metadata and auth/account endpoints remain accessible. Protect
// actual market/AI data, including direct HTTP access without a dashboard.
const protectedPaths = [
  "/api/signals", "/api/signal-history", "/api/signal-status",
  "/api/crypto", "/api/perps", "/api/finnhub", "/api/solana-rpc",
  "/api/stream", "/api/twitter", "/api/databus/status",
  "/api/macro", "/api/macro-intel", "/api/news", "/api/cryptopanic",
  "/api/polymarket", "/api/whales", "/api/regime", "/api/unusual",
  "/api/quant", "/api/ai", "/api/chart-ai", "/api/kronos",
  "/api/insider", "/api/earnings", "/api/ipo",
  "/api/execution_levels", "/api/performance-context",
  "/api/track-record", "/api/performance-highlights",
  "/api/alerts", "/api/weekly-update/latest",
  "/api/journal", "/api/positions", "/api/watchlist",
  "/api/basket-prices", "/api/basket/promoted",
];
export function requiresVerifiedEmail(path: string): boolean {
  // Health/status probes do not serve actionable market data.
  if (["/api/quant/health", "/api/quant/ready", "/api/quant/readiness"].includes(path)) return false;
  return protectedPaths.some(p => path === p || path.startsWith(p + "/"));
}

export function verificationAccess(user: { emailVerified: boolean; isAdmin?: boolean } | null): number {
  if (!user) return 401;
  return user.emailVerified || user.isAdmin ? 200 : 403;
}
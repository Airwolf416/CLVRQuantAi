/**
 * Single source of truth for the public-facing base URL the app is served at.
 *
 * Resolution order:
 *  1. APP_URL env var (explicit override — set this on Railway/prod to "https://clvrquantai.com")
 *  2. REPLIT_DOMAINS env var (Replit dev preview / staging)
 *  3. "https://clvrquantai.com" as a last-resort fallback
 *
 * Use this anywhere an email or webhook needs to build a link that the user will
 * click and that must land on the *currently-running* app instance with a valid
 * token or session — verify-email, password-reset, OPEN TERMINAL CTAs, etc.
 *
 * Static marketing links (unsubscribe, privacy policy, etc.) that should always
 * point to production can keep using the literal "https://clvrquantai.com" since
 * production is the canonical destination for those.
 */
export function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.REPLIT_DOMAINS) {
    const first = process.env.REPLIT_DOMAINS.split(",")[0].trim();
    if (first) return `https://${first}`;
  }
  return "https://clvrquantai.com";
}

export function isTrustedCookieMutation(input: {
  origin?: string;
  fetchSite?: string;
  requestOrigin: string;
  trustedOrigins: Iterable<string>;
}): boolean {
  // Browser cookie requests must provide both signals. Bearer requests do not
  // use this function and remain suitable for non-browser compatibility.
  if (!input.origin || !input.fetchSite || input.fetchSite === "cross-site") return false;
  if (!["same-origin", "same-site", "none"].includes(input.fetchSite)) return false;
  const trusted = new Set(input.trustedOrigins);
  return input.origin === input.requestOrigin || trusted.has(input.origin);
}
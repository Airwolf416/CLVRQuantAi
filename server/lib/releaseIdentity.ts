export const TRADE_IDEA_POLICY_REVISION = "crypto-compatible-floor-v1";

export function releaseIdentity(revision = process.env.APP_BUILD_SHA) {
  return {
    revision: /^[a-f0-9]{40}$/i.test(revision || "") ? revision!.toLowerCase() : "unknown",
    tradeIdeaPolicy: TRADE_IDEA_POLICY_REVISION,
  };
}

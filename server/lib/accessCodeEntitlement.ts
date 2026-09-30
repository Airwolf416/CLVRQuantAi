// Access-code product tiers. The issued trial and PRO- codes promise Pro;
// VIP/FF codes promise Elite. Unknown types must not grant paid access.
export function accessCodeTier(type: string): "pro" | "elite" | null {
  if (type === "trial" || type === "pro") return "pro";
  if (type === "vip") return "elite";
  return null;
}

export function effectiveCodeTier(current: string, granted: "pro" | "elite"): string {
  const rank: Record<string, number> = { free: 0, pro: 1, elite: 2, vip_group: 3 };
  return (rank[granted] > (rank[current] ?? 0)) ? granted : current;
}

export function redemptionError(reason: "not_found" | "expired" | "already_redeemed_user" | "already_redeemed_global") {
  const messages = {
    not_found: "Code not found or no longer active",
    expired: "This code has expired",
    already_redeemed_user: "You have already redeemed this code",
    already_redeemed_global: "This code has already been claimed",
  };
  return { valid: false, code: reason, error: messages[reason] };
}
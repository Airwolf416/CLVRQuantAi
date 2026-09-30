export const ACCESS_CODE_FORMATS = "Accepted issued formats: CLVR-TRIAL-… (trial), CLVR-VIP-… (VIP), CLVR-FF-… (friends & family), PRO-XXXXX-XXX (Pro).";

export function accessCodeFeedback(data) {
  if (!data?.valid) {
    const errors = {
      expired: "This code has expired",
      already_redeemed_user: "You have already redeemed this code",
      already_redeemed_global: "This code has already been claimed",
      not_found: "Code not found or no longer active",
      global_limit_reached: "This code has reached its maximum redemptions",
    };
    return { success: false, message: data?.error || errors[data?.code] || "Code verification failed. Please try again." };
  }
  // Entitlement is read from the server response, not inferred from a prefix.
  if (!["pro", "elite", "vip_group"].includes(data.tier)) {
    return { success: false, message: "Code accepted, but the plan could not be confirmed. Refresh your account." };
  }
  const tier = data.tier === "pro" ? "Pro" : data.tier === "elite" ? "Elite" : "VIP Group";
  const date = data.expiresAt ? new Date(data.expiresAt) : null;
  const until = date && !Number.isNaN(date.getTime())
    ? ` until ${date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}`
    : "";
  return {
    success: true,
    message: data.type === "trial" ? `Trial activated: ${tier}${until}` : `${tier} access activated${until}`,
  };
}
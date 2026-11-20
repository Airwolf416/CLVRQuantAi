export type EliteMonitorAuthorization =
  | { allowed: true; userId: string; user: any; effectiveTier: string }
  | { allowed: false; status: 401 | 403; error: string };

export async function authorizeEliteMonitor(
  userId: unknown,
  loadUser: (id: string) => Promise<any>,
  resolveEffectiveTier: (user: any) => Promise<string>,
  ownerEmail: string,
): Promise<EliteMonitorAuthorization> {
  if (typeof userId !== "string" || !userId) {
    return { allowed: false, status: 401, error: "Sign in required." };
  }
  const user = await loadUser(userId);
  if (!user) return { allowed: false, status: 401, error: "Sign in required." };

  const effectiveTier = await resolveEffectiveTier(user);
  const isOwner = String(user.email || "").toLowerCase() === ownerEmail.toLowerCase();
  if (effectiveTier !== "elite" && !isOwner) {
    return { allowed: false, status: 403, error: "Portfolio Advisor is an Elite feature." };
  }
  return { allowed: true, userId, user, effectiveTier };
}

// ── User tier resolver ───────────────────────────────────────────────────────
// Single source of truth for the free / pro / elite gate. Reads `users.tier`
// (the canonical column on the users table) and normalises legacy aliases.

import { db } from "../db";
import { users } from "../../shared/schema";
import { eq } from "drizzle-orm";

export type Tier = "free" | "pro" | "elite";

export async function getUserTier(userId: string): Promise<Tier> {
  if (!userId) return "free";
  try {
    const rows = await db.select({ tier: users.tier }).from(users).where(eq(users.id, userId)).limit(1);
    const raw = (rows[0]?.tier || "free").toLowerCase();
    if (raw === "elite" || raw === "premium") return "elite";
    if (raw === "pro" || raw === "standard") return "pro";
    return "free";
  } catch {
    return "free";
  }
}

export function getMaxIdeasForTier(tier: Tier): number {
  return tier === "elite" ? 3 : tier === "pro" ? 1 : 0;
}

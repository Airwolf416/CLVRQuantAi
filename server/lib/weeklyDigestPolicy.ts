import { createHash } from "node:crypto";
import { WEEKLY_DIGEST_POLICY, WEEKLY_TIME_ZONE } from "../../shared/weeklyDigestSchedule.js";
export { WEEKLY_DIGEST_POLICY, WEEKLY_TIME_ZONE };

export const WEEKLY_RETRY_MS = 5 * 60_000;
// Resend retains idempotency keys for 24 hours. Stop automatic retries early
// when an earlier request might have succeeded without a database receipt.
export const SAFE_PROVIDER_RETRY_MS = 23 * 60 * 60_000;

export class DigestError extends Error {
  constructor(public stage: string, public code: string) {
    super(`${stage}: ${code}`);
  }
}

// Wall-clock window: Saturday 10 AM through Sunday before 10 AM Eastern.
// Intl handles DST without depending on the server's own timezone.
export function saturdayDigestWindow(now: Date): string | null {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: WEEKLY_TIME_ZONE, weekday: "short", year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map(p => [p.type, p.value]));
  const hour = Number(parts.hour);
  if (parts.weekday === "Sat" && hour >= 10) return `${parts.year}-${parts.month}-${parts.day}`;
  if (parts.weekday === "Sun" && hour < 10) {
    return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - 1))
      .toISOString().slice(0, 10);
  }
  return null;
}

export function publicCommitSubjects(subjects: string[]): string[] {
  // Fixes and performance improvements are NOT inherently internal.
  // The editor still excludes changes without a concrete user-visible benefit.
  const internal = /^(checkpoint|wip|merge)\b|^(chore|refactor|test|tests|ci|build|deps)(\(|:)|\b(lint|eslint|dockerfile|backfill)\b/i;
  return [...new Set(subjects.map(s => s.trim()).filter(s => s && !internal.test(s)))];
}

export function recipientIdentity(email: string): { email: string; key: string } {
  const normalized = email.trim().toLowerCase();
  return { email: normalized, key: createHash("sha256").update(normalized).digest("hex") };
}

export function providerIdempotencyKey(updateId: number, recipientKey: string): string {
  return `weekly-update/${updateId}/${recipientKey}`;
}

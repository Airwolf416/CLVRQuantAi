// Prod mirror for the improvement log (HTTP webhook variant).
//
// Why this exists:
//   The agent's `logImprovement()` helper writes a one-line entry into
//   `update_log_entries` every time we ship a small user-visible change.
//   Those writes go to whatever DATABASE_URL the running process has — which
//   in dev is the workspace DB, NOT the live production DB on Railway.
//   As a result the admin "Improvement Log" panel on the deployed site
//   stayed empty even though the dev panel filled up.
//
// How it works:
//   When IMPROVEMENT_MIRROR_URL + IMPROVEMENT_MIRROR_SECRET are configured,
//   each entry is also POSTed to the prod server's HMAC-authed mirror
//   endpoint (`/api/internal/improvement-log/mirror`). The prod server
//   verifies the signature and writes the entry into ITS OWN database.
//   No prod database credentials are ever needed in dev — just a shared
//   HMAC secret. This sidesteps the entire "what's the prod DATABASE_URL"
//   problem.
//
// Safety guarantees:
//   - Best-effort: failures are caught and logged; never breaks the local
//     insert, never bubbles up, never breaks the calling feature.
//   - No-op when the URL or secret env vars are absent (dev still works).
//   - 5s request timeout so a slow / unreachable prod can't stall callers.
//   - Self-call guard: if the mirror URL points at this server's own host,
//     the call is skipped (otherwise prod would mirror onto itself).
//   - The receiving endpoint does its own 7-day dedupe, so retries / restarts
//     don't create duplicate prod rows.

import { createHmac } from "crypto";

export interface MirrorInput {
  headline: string;
  detail: string | null;
  emoji: string | null;
  addedBy: string;
  createdAt?: Date | string;
}

let warnedDisabled = false;
let loggedSelfSkip = false;

function isSelfCall(url: string): boolean {
  // If the mirror URL host matches this process's own deploy host, skip
  // (prevents prod from mirroring to itself).
  try {
    const u = new URL(url);
    const ownHosts = [
      process.env.RAILWAY_PUBLIC_DOMAIN,
      process.env.RAILWAY_STATIC_URL,
      process.env.REPLIT_DEPLOYMENT_DOMAIN,
      process.env.REPL_URL,
    ]
      .filter(Boolean)
      .map((h) => String(h).replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase());
    return ownHosts.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export async function mirrorImprovementToProd(input: MirrorInput): Promise<void> {
  const url = process.env.IMPROVEMENT_MIRROR_URL;
  const secret = process.env.IMPROVEMENT_MIRROR_SECRET;

  if (!url || !secret) {
    if (!warnedDisabled) {
      warnedDisabled = true;
      console.log("[prod-mirror] IMPROVEMENT_MIRROR_URL or _SECRET not set — mirror disabled");
    }
    return;
  }

  if (isSelfCall(url)) {
    if (!loggedSelfSkip) {
      loggedSelfSkip = true;
      console.log("[prod-mirror] mirror URL points at self — skipping (already running in prod)");
    }
    return;
  }

  const payload = {
    headline: input.headline,
    detail: input.detail,
    emoji: input.emoji,
    addedBy: input.addedBy,
    createdAt:
      input.createdAt instanceof Date
        ? input.createdAt.toISOString()
        : input.createdAt || undefined,
  };
  const raw = JSON.stringify(payload);
  const sig = createHmac("sha256", secret).update(raw).digest("hex");

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mirror-signature": sig,
      },
      body: raw,
      signal: ctl.signal,
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.warn(`[prod-mirror] HTTP ${r.status} for "${input.headline}" — ${txt.slice(0, 200)}`);
      return;
    }
    const data: any = await r.json().catch(() => ({}));
    if (data?.action === "inserted") {
      console.log(`[prod-mirror] +${input.emoji || "•"} ${input.headline}`);
    }
  } catch (e: any) {
    console.warn(`[prod-mirror] mirror failed for "${input.headline}":`, e?.message || e);
  } finally {
    clearTimeout(timer);
  }
}

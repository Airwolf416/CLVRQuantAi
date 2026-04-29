type AnySignal = Record<string, any>;

export type NotifyResult =
  | { ok: true; status: number }
  | { ok: false; reason: "missing_env"; detail: string }
  | { ok: false; reason: "invalid_signal"; detail: string }
  | { ok: false; reason: "http_error"; status: number; detail?: string }
  | { ok: false; reason: "network_error"; detail: string };

const REQUIRED_FIELDS = [
  "token",
  "dir",
  "entry",
  "stopLoss",
  "tp1",
  "lev",
  "conf",
  "advancedScore",
  "reasoning",
  "ts",
] as const;

// ── In-memory ring buffer of recent autoposter attempts ────────────────────
// Used by /api/admin/autoposter/status so the owner can self-diagnose why
// Telegram isn't receiving signals (missing env, invalid payload, http error,
// network error). Bounded at 50 to keep memory tiny.
type AttemptRecord = {
  ts: number;
  token: string;
  direction: string;
  ok: boolean;
  reason?: string;
  status?: number;
  detail?: string;
};
const recentAttempts: AttemptRecord[] = [];
const MAX_RECENT_ATTEMPTS = 50;

function recordAttempt(rec: AttemptRecord) {
  recentAttempts.push(rec);
  if (recentAttempts.length > MAX_RECENT_ATTEMPTS) {
    recentAttempts.splice(0, recentAttempts.length - MAX_RECENT_ATTEMPTS);
  }
}

export function getAutoposterStatus() {
  const baseUrl = process.env.AUTOPOSTER_WEBHOOK_URL;
  const secret = process.env.AUTOPOSTER_WEBHOOK_SECRET;
  // Mask URL host so we can confirm it's set without leaking the full webhook.
  let urlHostMasked: string | null = null;
  if (baseUrl) {
    try {
      const u = new URL(baseUrl);
      urlHostMasked = `${u.protocol}//${u.hostname}${u.pathname.replace(/\/[^/]+$/, "/***")}`;
    } catch {
      urlHostMasked = "<invalid URL>";
    }
  }
  const successCount = recentAttempts.filter(a => a.ok).length;
  const failCount = recentAttempts.filter(a => !a.ok).length;
  const lastFailure = [...recentAttempts].reverse().find(a => !a.ok) || null;
  const lastSuccess = [...recentAttempts].reverse().find(a => a.ok) || null;
  return {
    envConfigured: !!(baseUrl && secret),
    urlSet: !!baseUrl,
    secretSet: !!secret,
    urlHostMasked,
    totalAttempts: recentAttempts.length,
    successCount,
    failCount,
    lastSuccess,
    lastFailure,
    recentAttempts: [...recentAttempts].reverse().slice(0, 20),
  };
}

export async function notifyAutoposter(signal: AnySignal): Promise<NotifyResult> {
  const attemptToken = (signal && typeof signal === "object" && signal.token) ? String(signal.token) : "?";
  const attemptDir = (signal && typeof signal === "object" && signal.dir) ? String(signal.dir) : "?";
  try {
    const baseUrl = process.env.AUTOPOSTER_WEBHOOK_URL;
    const secret = process.env.AUTOPOSTER_WEBHOOK_SECRET;

    if (!baseUrl || !secret) {
      const detail = "AUTOPOSTER_WEBHOOK_URL or AUTOPOSTER_WEBHOOK_SECRET not set";
      recordAttempt({ ts: Date.now(), token: attemptToken, direction: attemptDir, ok: false, reason: "missing_env", detail });
      return { ok: false, reason: "missing_env", detail };
    }

    if (!signal || typeof signal !== "object") {
      const detail = "signal is missing or not an object";
      console.warn(`[AUTOPOSTER] Skipping notify: ${detail}`);
      recordAttempt({ ts: Date.now(), token: attemptToken, direction: attemptDir, ok: false, reason: "invalid_signal", detail });
      return { ok: false, reason: "invalid_signal", detail };
    }

    for (const field of REQUIRED_FIELDS) {
      const value = (signal as AnySignal)[field];
      if (value === undefined || value === null) {
        const msg = `required field "${field}" is missing or null on signal`;
        console.warn(`[AUTOPOSTER] Skipping notify: ${msg}`);
        recordAttempt({ ts: Date.now(), token: attemptToken, direction: attemptDir, ok: false, reason: "invalid_signal", detail: msg });
        return { ok: false, reason: "invalid_signal", detail: msg };
      }
    }

    if (!Array.isArray(signal.reasoning)) {
      const msg = '"reasoning" must be an array of strings';
      console.warn(`[AUTOPOSTER] Skipping notify: ${msg}`);
      recordAttempt({ ts: Date.now(), token: attemptToken, direction: attemptDir, ok: false, reason: "invalid_signal", detail: msg });
      return { ok: false, reason: "invalid_signal", detail: msg };
    }

    const entry = parseFloat(signal.entry);
    const stopLoss = parseFloat(signal.stopLoss);
    const tp1 = parseFloat(signal.tp1);
    const tp2 = signal.tp2 !== undefined && signal.tp2 !== null ? parseFloat(signal.tp2) : undefined;

    if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || !Number.isFinite(tp1)) {
      const msg = "entry/stopLoss/tp1 did not parse to finite numbers";
      console.warn(`[AUTOPOSTER] Skipping notify: ${msg}`);
      recordAttempt({ ts: Date.now(), token: attemptToken, direction: attemptDir, ok: false, reason: "invalid_signal", detail: msg });
      return { ok: false, reason: "invalid_signal", detail: msg };
    }

    const payload = {
      token: signal.token,
      direction: signal.dir,
      entry,
      stopLoss,
      tp1,
      tp2,
      leverage: String(signal.lev),
      confidence: signal.conf,
      advancedScore: signal.advancedScore,
      reasoning: signal.reasoning,
      isStrongSignal: signal.isStrongSignal === true,
      timestamp: new Date(signal.ts).toISOString(),
    };

    // Use AUTOPOSTER_WEBHOOK_URL exactly as configured. We accept either
    // the full webhook endpoint (e.g. https://host/webhook/signal) or a
    // bare base URL — if the configured value doesn't already include the
    // /webhook/signal path, we append it. This lets operators paste the
    // exact URL their downstream service exposes without surprises.
    const trimmed = baseUrl.replace(/\/+$/, "");
    const url = /\/webhook\/signal$/i.test(trimmed) ? trimmed : trimmed + "/webhook/signal";

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signal-Secret": secret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      console.warn(
        `[AUTOPOSTER] Webhook returned non-OK status ${res.status} for ${payload.token} ${payload.direction}`
      );
      recordAttempt({ ts: Date.now(), token: String(payload.token), direction: String(payload.direction), ok: false, reason: "http_error", status: res.status });
      return { ok: false, reason: "http_error", status: res.status };
    }

    console.log(`[AUTOPOSTER] Notified for ${payload.token} ${payload.direction}`);
    recordAttempt({ ts: Date.now(), token: String(payload.token), direction: String(payload.direction), ok: true, status: res.status });
    return { ok: true, status: res.status };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.warn(`[AUTOPOSTER] Notify failed (non-fatal): ${msg}`);
    recordAttempt({ ts: Date.now(), token: attemptToken, direction: attemptDir, ok: false, reason: "network_error", detail: msg });
    return { ok: false, reason: "network_error", detail: msg };
  }
}

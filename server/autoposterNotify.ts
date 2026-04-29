import { createHash } from "crypto";

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

    // Stable idempotency key per logical signal — same value on retry so the
    // downstream can dedupe if attempt 1 actually landed and only the
    // response path failed. Built from token+direction+timestamp so two
    // distinct signals never collide.
    const idempotencyKey = createHash("sha1")
      .update(`${payload.token}|${payload.direction}|${payload.timestamp}`)
      .digest("hex");

    // Two attempts with a 15s per-attempt timeout. Production was failing
    // at the previous 5s ceiling on every single signal even though the
    // downstream service responds in <500ms when probed directly — the
    // extra slack covers Railway-to-Railway latency spikes, and a single
    // retry on an abort/timeout keeps one bad packet from dropping a
    // real signal.
    const ATTEMPT_TIMEOUT_MS = 15_000;
    const MAX_ATTEMPTS = 2;
    let lastNetworkError: string | null = null;

    // Decide whether a thrown fetch error is worth retrying. We retry on
    // aborts (our own timeout firing) and on the well-known transient
    // network class names. Everything else (TypeErrors from bad config,
    // DNS failures that won't fix themselves in 500ms, etc.) fails fast
    // so we don't waste time and don't risk surprising side effects.
    const isRetryable = (e: unknown): boolean => {
      const err = e as { name?: string; code?: string; cause?: { code?: string } } | null;
      if (!err) return false;
      if (err.name === "AbortError" || err.name === "TimeoutError") return true;
      const code = err.code || err.cause?.code;
      if (code && ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(code)) return true;
      return false;
    };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const startedAt = Date.now();
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Signal-Secret": secret,
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        });

        if (!res.ok) {
          // HTTP errors are not retried — 4xx is a payload/auth issue,
          // 5xx means the downstream actually responded and rejected us.
          console.warn(
            `[AUTOPOSTER] Webhook returned non-OK status ${res.status} for ${payload.token} ${payload.direction} (attempt ${attempt}/${MAX_ATTEMPTS}, ${Date.now() - startedAt}ms)`
          );
          recordAttempt({ ts: Date.now(), token: String(payload.token), direction: String(payload.direction), ok: false, reason: "http_error", status: res.status });
          return { ok: false, reason: "http_error", status: res.status };
        }

        console.log(`[AUTOPOSTER] Notified for ${payload.token} ${payload.direction} (attempt ${attempt}, ${Date.now() - startedAt}ms)`);
        recordAttempt({ ts: Date.now(), token: String(payload.token), direction: String(payload.direction), ok: true, status: res.status });
        return { ok: true, status: res.status };
      } catch (innerErr) {
        lastNetworkError = (innerErr as Error)?.message ?? String(innerErr);
        const elapsed = Date.now() - startedAt;
        const retryable = isRetryable(innerErr);
        if (attempt < MAX_ATTEMPTS && retryable) {
          console.warn(
            `[AUTOPOSTER] Attempt ${attempt}/${MAX_ATTEMPTS} failed for ${payload.token} ${payload.direction} after ${elapsed}ms (retryable=true): ${lastNetworkError} — retrying`
          );
          // Tiny backoff so we don't immediately re-hit the same broken socket.
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        console.warn(
          `[AUTOPOSTER] Attempt ${attempt}/${MAX_ATTEMPTS} failed for ${payload.token} ${payload.direction} after ${elapsed}ms (retryable=${retryable}): ${lastNetworkError}` +
          (retryable ? "" : " — not retrying")
        );
        break;
      }
    }

    recordAttempt({ ts: Date.now(), token: String(payload.token), direction: String(payload.direction), ok: false, reason: "network_error", detail: lastNetworkError ?? "unknown" });
    return { ok: false, reason: "network_error", detail: lastNetworkError ?? "unknown" };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.warn(`[AUTOPOSTER] Notify failed (non-fatal): ${msg}`);
    recordAttempt({ ts: Date.now(), token: attemptToken, direction: attemptDir, ok: false, reason: "network_error", detail: msg });
    return { ok: false, reason: "network_error", detail: msg };
  }
}

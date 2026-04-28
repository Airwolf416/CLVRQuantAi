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

export async function notifyAutoposter(signal: AnySignal): Promise<NotifyResult> {
  try {
    const baseUrl = process.env.AUTOPOSTER_WEBHOOK_URL;
    const secret = process.env.AUTOPOSTER_WEBHOOK_SECRET;

    if (!baseUrl || !secret) {
      return { ok: false, reason: "missing_env", detail: "AUTOPOSTER_WEBHOOK_URL or AUTOPOSTER_WEBHOOK_SECRET not set" };
    }

    if (!signal || typeof signal !== "object") {
      console.warn("[AUTOPOSTER] Skipping notify: signal is missing or not an object");
      return { ok: false, reason: "invalid_signal", detail: "signal is missing or not an object" };
    }

    for (const field of REQUIRED_FIELDS) {
      const value = (signal as AnySignal)[field];
      if (value === undefined || value === null) {
        const msg = `required field "${field}" is missing or null on signal`;
        console.warn(`[AUTOPOSTER] Skipping notify: ${msg}`);
        return { ok: false, reason: "invalid_signal", detail: msg };
      }
    }

    if (!Array.isArray(signal.reasoning)) {
      const msg = '"reasoning" must be an array of strings';
      console.warn(`[AUTOPOSTER] Skipping notify: ${msg}`);
      return { ok: false, reason: "invalid_signal", detail: msg };
    }

    const entry = parseFloat(signal.entry);
    const stopLoss = parseFloat(signal.stopLoss);
    const tp1 = parseFloat(signal.tp1);
    const tp2 = signal.tp2 !== undefined && signal.tp2 !== null ? parseFloat(signal.tp2) : undefined;

    if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || !Number.isFinite(tp1)) {
      const msg = "entry/stopLoss/tp1 did not parse to finite numbers";
      console.warn(`[AUTOPOSTER] Skipping notify: ${msg}`);
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
    const url = /\/webhook\/signal$/.test(trimmed) ? trimmed : trimmed + "/webhook/signal";

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
      return { ok: false, reason: "http_error", status: res.status };
    }

    console.log(`[AUTOPOSTER] Notified for ${payload.token} ${payload.direction}`);
    return { ok: true, status: res.status };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.warn(`[AUTOPOSTER] Notify failed (non-fatal): ${msg}`);
    return { ok: false, reason: "network_error", detail: msg };
  }
}

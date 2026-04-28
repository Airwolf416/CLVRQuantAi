type AnySignal = Record<string, any>;

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

export async function notifyAutoposter(signal: AnySignal): Promise<void> {
  try {
    const baseUrl = process.env.AUTOPOSTER_WEBHOOK_URL;
    const secret = process.env.AUTOPOSTER_WEBHOOK_SECRET;

    if (!baseUrl || !secret) {
      return;
    }

    if (!signal || typeof signal !== "object") {
      console.warn("[AUTOPOSTER] Skipping notify: signal is missing or not an object");
      return;
    }

    for (const field of REQUIRED_FIELDS) {
      const value = (signal as AnySignal)[field];
      if (value === undefined || value === null) {
        console.warn(`[AUTOPOSTER] Skipping notify: required field "${field}" is missing or null on signal`);
        return;
      }
    }

    if (!Array.isArray(signal.reasoning)) {
      console.warn('[AUTOPOSTER] Skipping notify: "reasoning" must be an array of strings');
      return;
    }

    const entry = parseFloat(signal.entry);
    const stopLoss = parseFloat(signal.stopLoss);
    const tp1 = parseFloat(signal.tp1);
    const tp2 = signal.tp2 !== undefined && signal.tp2 !== null ? parseFloat(signal.tp2) : undefined;

    if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || !Number.isFinite(tp1)) {
      console.warn("[AUTOPOSTER] Skipping notify: entry/stopLoss/tp1 did not parse to finite numbers");
      return;
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

    const url = baseUrl.replace(/\/+$/, "") + "/webhook/signal";

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
      return;
    }

    console.log(`[AUTOPOSTER] Notified for ${payload.token} ${payload.direction}`);
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.warn(`[AUTOPOSTER] Notify failed (non-fatal): ${msg}`);
  }
}

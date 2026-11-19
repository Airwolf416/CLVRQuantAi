import type { DigestMailer } from "./weeklyDigestDelivery";

// The installed Resend SDK predates request idempotency options. Sending an
// ignored SDK option would silently remove duplicate protection, so use the
// documented HTTP header explicitly for this sender only.
export function createWeeklyDigestMailer(apiKey: string, transport: typeof fetch = fetch): DigestMailer {
  return {
    async send(payload, options) {
      const response = await transport("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": options.idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await response.json();
      return response.ok ? { data: body } : { error: { statusCode: response.status } };
    },
  };
}

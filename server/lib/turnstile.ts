type TurnstileResponse = { success?: boolean; "error-codes"?: string[]; hostname?: string };

export async function verifyTurnstile(
  token: unknown,
  ip: string | undefined,
  secret: string | undefined = process.env.TURNSTILE_SECRET_KEY,
  request: typeof fetch = fetch,
): Promise<boolean> {
  if (!secret || typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const response = await request("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;
    const result = await response.json() as TurnstileResponse;
    return result.success === true;
  } catch {
    return false;
  }
}
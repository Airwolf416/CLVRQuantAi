import { Resend } from 'resend';

// Replit Resend connector — fetches API key from the Replit connector service.
// WARNING: Never cache this client. Tokens/keys can be rotated.
// Always call getUncachableResendClient() fresh on every send operation.

async function getCredentials(): Promise<{ apiKey: string; fromEmail: string }> {
  // Development fallback: if RESEND_API_KEY is set directly, use it
  if (process.env.RESEND_API_KEY) {
    return {
      apiKey: process.env.RESEND_API_KEY,
      fromEmail: process.env.RESEND_FROM_EMAIL || 'CLVRQuant <hello@clvrquantai.com>',
    };
  }

  // Production: fetch credentials from Replit connector service
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  if (!hostname) {
    throw new Error('[resend] REPLIT_CONNECTORS_HOSTNAME not set and RESEND_API_KEY not set — emails disabled');
  }

  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error('[resend] X-Replit-Token not available (no REPL_IDENTITY or WEB_REPL_RENEWAL)');
  }

  const connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=resend',
    {
      headers: {
        Accept: 'application/json',
        'X-Replit-Token': xReplitToken,
      },
    }
  )
    .then(res => res.json())
    .then((data: any) => data.items?.[0]);

  if (!connectionSettings?.settings?.api_key) {
    throw new Error('[resend] Resend connector not connected or missing api_key');
  }

  const fromEmail =
    connectionSettings.settings.from_email ||
    process.env.RESEND_FROM_EMAIL ||
    'CLVRQuant <hello@clvrquantai.com>';

  return { apiKey: connectionSettings.settings.api_key, fromEmail };
}

export async function getUncachableResendClient() {
  const { apiKey, fromEmail } = await getCredentials();
  return {
    client: new Resend(apiKey),
    fromEmail,
  };
}

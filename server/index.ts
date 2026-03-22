import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { WebhookHandlers } from "./webhookHandlers";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./stripeClient";
import { startDailyBriefScheduler } from "./dailyBrief";

let shuttingDown = false;
const _origExit = process.exit;
(process as any).exit = function(code?: number) {
  if (code === 1 && !shuttingDown) {
    console.error("Vite esbuild service error — keeping server alive");
    return undefined as never;
  }
  return _origExit.call(process, code) as never;
};
process.on('SIGTERM', () => { shuttingDown = true; });
process.on('SIGINT', () => { shuttingDown = true; });

const app = express();
const httpServer = createServer(app);

// ── Stripe webhook — MUST be registered before app.use(express.json()) ───────
// express.raw() captures the unmodified body buffer Stripe needs for HMAC verification.
// Any JSON body parser applied first will break the signature check.
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signatureHeader = req.headers['stripe-signature'];
    if (!signatureHeader) {
      console.error('[stripe] Webhook rejected: missing stripe-signature header');
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }
    const sig = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    // Guard: STRIPE_WEBHOOK_SECRET must be set
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('[stripe] Webhook rejected: STRIPE_WEBHOOK_SECRET env var is not set');
      return res.status(400).json({ error: 'Server webhook secret not configured' });
    }

    // Verify the payload is a raw Buffer (confirms express.raw() ran before express.json())
    if (!Buffer.isBuffer(req.body)) {
      console.error('[stripe] Webhook rejected: body is not a Buffer — express.json() may have run first');
      return res.status(400).json({ error: 'Webhook body must be raw Buffer' });
    }

    try {
      // Step 1: Verify signature directly using process.env.STRIPE_WEBHOOK_SECRET
      const { getUncachableStripeClient } = await import('./stripeClient');
      const stripe = await getUncachableStripeClient();
      const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      console.log(`[stripe] Webhook verified: ${event.type} (id: ${event.id})`);

      // Step 2: Payment confirmation email for checkout.session.completed
      if (event.type === 'checkout.session.completed') {
        try {
          const session = event.data.object as any;
          const toEmail = session.customer_details?.email;
          const customerName = session.customer_details?.name || 'Valued Member';
          const amountCents = session.amount_total || 0;
          const txDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
          const txId = (session.payment_intent || session.id || '').toString().substring(0, 20);

          let planName = 'CLVRQuantAI Pro';
          let planInterval = '';
          let planColor = '#e8c96d';
          if (amountCents === 2900) {
            planName = 'Pro Plan — Monthly';
            planInterval = '$29.00 / month';
          } else if (amountCents === 19900) {
            planName = 'Pro Plan — Annual';
            planInterval = '$199.00 / year';
            planColor = '#00c787';
          } else {
            planInterval = `$${(amountCents / 100).toFixed(2)} ${(session.currency || 'usd').toUpperCase()}`;
          }

          if (toEmail) {
            const { getUncachableResendClient } = await import('./resendClient');
            const { client: resend, fromEmail: payFrom } = await getUncachableResendClient();
            await resend.emails.send({
              from: payFrom,
              to: toEmail,
              reply_to: 'MikeClaver@CLVRQuantAI.com',
              subject: 'Your CLVRQuantAI Payment Confirmation',
              text: `Payment Confirmed — CLVRQuantAI\n\nThank you, ${customerName}. Your CLVRQuantAI Pro subscription is now active.\n\nPlan: ${planName}\nAmount: ${planInterval}\nDate: ${txDate}\nTransaction: ${txId}\n\nYour Pro features:\n- CLVR AI — Full Claude-powered market analyst\n- 4 AI trade ideas per morning brief\n- Unlimited price alerts\n- Real-time signals with AI reasoning\n- Liquidation heatmap & whale tracker\n- Volume & funding rate monitors\n\nOpen your dashboard: https://clvrquantai.com\n\nQuestions? MikeClaver@CLVRQuantAI.com\n\n© 2026 CLVRQuantAI`,
              html: `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#050709;color:#c8d4ee;padding:0;margin:0">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid #141e35">
      <div style="font-family:Georgia,serif;font-size:34px;font-weight:900;color:#e8c96d;letter-spacing:0.04em">CLVRQuantAI</div>
      <div style="font-family:'Courier New',monospace;font-size:9px;color:#4a5d80;letter-spacing:0.25em;margin-top:4px">MARKET INTELLIGENCE PLATFORM</div>
    </div>

    <!-- Body -->
    <p style="font-size:15px;color:#f0f4ff;margin-bottom:6px">Payment Confirmed</p>
    <p style="font-size:13px;color:#6b7fa8;line-height:1.8;margin-bottom:20px">
      Thank you, ${customerName}. Your CLVRQuantAI Pro subscription is now active. Below is your receipt for your records.
    </p>

    <!-- Invoice box -->
    <div style="background:#0a1020;border:1px solid #1a2840;border-radius:4px;padding:20px;margin-bottom:24px">
      <div style="font-family:'Courier New',monospace;font-size:9px;color:#4a5d80;letter-spacing:0.2em;margin-bottom:14px">PAYMENT RECEIPT</div>
      <table style="width:100%;border-collapse:collapse">
        <tr style="border-bottom:1px solid #141e35">
          <td style="padding:10px 0;font-size:12px;color:#6b7fa8;font-family:'Courier New',monospace;letter-spacing:0.08em">PLAN</td>
          <td style="padding:10px 0;font-size:13px;color:#f0f4ff;text-align:right;font-weight:600">${planName}</td>
        </tr>
        <tr style="border-bottom:1px solid #141e35">
          <td style="padding:10px 0;font-size:12px;color:#6b7fa8;font-family:'Courier New',monospace;letter-spacing:0.08em">AMOUNT</td>
          <td style="padding:10px 0;font-size:13px;text-align:right;font-weight:700;color:${planColor}">${planInterval}</td>
        </tr>
        <tr style="border-bottom:1px solid #141e35">
          <td style="padding:10px 0;font-size:12px;color:#6b7fa8;font-family:'Courier New',monospace;letter-spacing:0.08em">DATE</td>
          <td style="padding:10px 0;font-size:12px;color:#c8d4ee;text-align:right">${txDate}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;font-size:12px;color:#6b7fa8;font-family:'Courier New',monospace;letter-spacing:0.08em">TRANSACTION</td>
          <td style="padding:10px 0;font-size:11px;color:#4a5d80;text-align:right;font-family:'Courier New',monospace">${txId}...</td>
        </tr>
      </table>
    </div>

    <!-- Pro features -->
    <div style="background:#0a1020;border:1px solid #1a2840;border-left:3px solid #e8c96d;border-radius:4px;padding:16px;margin-bottom:24px">
      <div style="font-family:'Courier New',monospace;font-size:9px;color:#e8c96d;letter-spacing:0.2em;margin-bottom:10px">YOUR PRO FEATURES</div>
      <div style="font-size:12px;color:#6b7fa8;line-height:2">
        ✦ CLVR AI — Full Claude-powered market analyst<br>
        ✦ 4 AI trade ideas per morning brief<br>
        ✦ Unlimited price alerts<br>
        ✦ Real-time signals with AI reasoning<br>
        ✦ Liquidation heatmap &amp; whale tracker<br>
        ✦ Volume &amp; funding rate monitors
      </div>
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:28px">
      <a href="https://clvrquantai.com" style="display:inline-block;background:linear-gradient(135deg,#c9a84c,#e8c96d);color:#050709;font-family:'Courier New',monospace;font-size:11px;font-weight:700;letter-spacing:0.15em;padding:14px 32px;border-radius:3px;text-decoration:none">OPEN DASHBOARD</a>
    </div>

    <!-- Note -->
    <p style="font-size:12px;color:#4a5d80;line-height:1.8;text-align:center;margin-bottom:20px">
      Questions or need help? Reply to this email or reach us at<br>
      <a href="mailto:MikeClaver@CLVRQuantAI.com" style="color:#c9a84c;text-decoration:none">MikeClaver@CLVRQuantAI.com</a>
    </p>

    <!-- Footer -->
    <div style="border-top:1px solid #141e35;padding-top:16px;text-align:center">
      <p style="font-size:11px;color:#2a3650;margin:0">© 2026 CLVRQuantAI · All rights reserved</p>
      <p style="font-size:9px;color:#1e2c45;margin:6px 0 0">
        You are receiving this because you subscribed to CLVRQuantAI.
        <a href="https://clvrquantai.com/api/unsubscribe?email=${encodeURIComponent(toEmail)}" style="color:#2a3650;text-decoration:underline">Unsubscribe</a>
      </p>
    </div>

  </div>
</div>`,
            });
            console.log(`[stripe] Payment confirmation email sent to ${toEmail} for ${planName}`);
          }
        } catch (emailErr: any) {
          console.error('[stripe] Payment confirmation email error (non-fatal):', emailErr.message);
        }
      }

      // Step 3: Sync event data to DB via stripe-replit-sync (non-fatal if it fails)
      try {
        await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      } catch (syncErr: any) {
        console.warn('[stripe] DB sync warning (non-fatal):', syncErr.message);
      }

      res.status(200).json({ received: true });
    } catch (e: any) {
      console.error('[stripe] Webhook signature verification failed:', e.message);
      res.status(400).json({ error: e.message });
    }
  }
);

app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db";
const PgSession = connectPgSimple(session);
const isProduction = process.env.NODE_ENV === "production";
app.set("trust proxy", 1);
app.use(session({
  store: new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 60,
  }),
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
  },
}));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      log(logLine);
    }
  });

  next();
});

async function ensureStripeProducts() {
  try {
    const { getUncachableStripeClient } = await import('./stripeClient');
    const stripe = await getUncachableStripeClient();

    // Check if prices with the required lookup_keys already exist
    const existing = await stripe.prices.list({
      lookup_keys: ['pro_monthly', 'pro_yearly'],
      active: true,
    });
    if (existing.data.length >= 2) {
      log(`Stripe prices OK: found pro_monthly + pro_yearly by lookup_key`, 'stripe');
      return;
    }

    // Find or create the product
    const productSearch = await stripe.products.search({ query: "metadata['app']:'clvrquant'" });
    let product = productSearch.data[0];
    if (!product) {
      product = await stripe.products.create({
        name: 'CLVRQuant Pro',
        description: 'Full access to CLVRQuant AI trading intelligence: AI analyst, trade ideas, morning briefs, unlimited alerts, signals, liquidation heatmap, volume & funding monitors.',
        metadata: { tier: 'pro', app: 'clvrquant' },
      });
      log(`Created Stripe product ${product.id}`, 'stripe');
    }

    // Create missing prices with lookup_keys
    const hasMonthly = existing.data.some(p => p.lookup_key === 'pro_monthly');
    const hasYearly  = existing.data.some(p => p.lookup_key === 'pro_yearly');

    if (!hasMonthly) {
      await stripe.prices.create({
        product: product.id, unit_amount: 2900, currency: 'usd',
        recurring: { interval: 'month' },
        lookup_key: 'pro_monthly',
        transfer_lookup_key: true,
        metadata: { plan: 'pro_monthly' },
      });
      log('Created price: pro_monthly ($29/month)', 'stripe');
    }
    if (!hasYearly) {
      await stripe.prices.create({
        product: product.id, unit_amount: 19900, currency: 'usd',
        recurring: { interval: 'year' },
        lookup_key: 'pro_yearly',
        transfer_lookup_key: true,
        metadata: { plan: 'pro_yearly' },
      });
      log('Created price: pro_yearly ($199/year)', 'stripe');
    }
  } catch (e: any) {
    console.error('[stripe] Product setup error:', e.message);
  }
}

async function initStripe() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn('[stripe] DATABASE_URL not set, skipping Stripe init');
    return;
  }
  try {
    await runMigrations({ databaseUrl });
    log('Stripe migrations complete', 'stripe');

    const stripeSync = await getStripeSync();

    const webhookBaseUrl = process.env.APP_URL
      || (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}` : null);
    if (webhookBaseUrl) {
      await stripeSync.findOrCreateManagedWebhook(
        `${webhookBaseUrl}/api/stripe/webhook`
      );
      log('Stripe webhook configured', 'stripe');
    } else {
      log('No APP_URL or REPLIT_DOMAINS set — skipping webhook registration', 'stripe');
    }

    await ensureStripeProducts();
    await stripeSync.syncBackfill();
    log('Stripe sync complete', 'stripe');
  } catch (e: any) {
    console.error('[stripe] Init error:', e.message);
  }
}

(async () => {
  await initStripe();
  await registerRoutes(httpServer, app);
  startDailyBriefScheduler();

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();

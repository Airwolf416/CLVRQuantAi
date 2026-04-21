import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { spawn as spawnChild } from "child_process";
import { WebhookHandlers } from "./webhookHandlers";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./stripeClient";
import { startDailyBriefScheduler } from "./dailyBrief";
import { initializeDatabase } from "./initDb";
import { startOutcomeResolver } from "./lib/outcomeResolver";
import { startAdaptiveThresholds, suppressHistoricalBleeders } from "./lib/adaptiveThresholds";
import { startCircuitBreaker } from "./lib/circuitBreaker";
import { initSocketIO } from "./socketServer";

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

const isProduction = process.env.NODE_ENV === "production";

// ── Security headers (helmet) ─────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// ── CORS — restrict cross-origin API calls in production ──────────────────────
const ALLOWED_ORIGINS = isProduction
  ? [
      "https://clvrquantai.com",
      "https://www.clvrquantai.com",
    ]
  : true;

app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
}));

// ── Global API rate limiter — 300 requests / 5 minutes per IP ─────────────────
const globalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !req.path.startsWith("/api/"),
  message: { error: "Too many requests. Please slow down." },
});
app.use(globalLimiter);

// ── AI/Quant endpoint rate limiter — 30 requests / 15 minutes per IP ──────────
export const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  message: { error: "AI rate limit reached. Please wait before trying again." },
  keyGenerator: (req) => {
    const userId = (req.session as any)?.userId;
    return userId ? `user:${userId}` : req.ip || "anon";
  },
});

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

          // Detect plan tier from amount
          const isEliteSubscription = amountCents >= 11900; // Elite: $129/mo or $1199/yr
          let planName = isEliteSubscription ? 'CLVRQuantAI Elite' : 'CLVRQuantAI Pro';
          let planInterval = '';
          let planColor = isEliteSubscription ? '#c9a84c' : '#e8c96d';
          if (amountCents >= 119000) {
            planName = 'Elite Plan — Annual';
            planInterval = `$${(amountCents / 100).toFixed(2)} / year`;
            planColor = '#00c787';
          } else if (amountCents >= 11900) {
            planName = 'Elite Plan — Monthly';
            planInterval = `$${(amountCents / 100).toFixed(2)} / month`;
          } else if (amountCents >= 25000) {
            planName = 'Pro Plan — Annual';
            planInterval = `$${(amountCents / 100).toFixed(2)} / year`;
            planColor = '#00c787';
          } else {
            planName = 'Pro Plan — Monthly';
            planInterval = `$${(amountCents / 100).toFixed(2)} / month`;
          }

          if (toEmail) {
            const { getUncachableResendClient } = await import('./resendClient');
            const { client: resend, fromEmail: payFrom } = await getUncachableResendClient();
            await resend.emails.send({
              from: payFrom,
              to: toEmail,
              replyTo: 'Support@clvrquantai.com',
              subject: isEliteSubscription ? '✦ Your CLVRQuantAI Elite Subscription is Active' : 'Your CLVRQuantAI Payment Confirmation',
              text: isEliteSubscription
                ? `✦ Elite Access Confirmed — CLVRQuantAI\n\nWelcome to the Elite tier, ${customerName}. Your exclusive CLVRQuantAI Elite subscription is now active.\n\nPlan: ${planName}\nAmount: ${planInterval}\nDate: ${txDate}\nTransaction: ${txId}\n\nYour Elite features (full access):\n- Unlimited CLVR AI — Claude Sonnet, unrestricted\n- All real-time signals: crypto, equities, commodities & forex\n- Full Hyperliquid perpetuals data & funding rate monitor\n- Daily Morning Intelligence Brief\n- Priority price alerts & push notifications\n- Phantom Wallet Solana integration\n- Macro calendar with AI event analysis\n\nTrade with precision — CLVRQuant is your edge.\nhttps://clvrquantai.com\n\nQuestions? Support@clvrquantai.com\n\n© 2026 CLVRQuantAI`
                : `Payment Confirmed — CLVRQuantAI\n\nThank you, ${customerName}. Your CLVRQuantAI Pro subscription is now active.\n\nPlan: ${planName}\nAmount: ${planInterval}\nDate: ${txDate}\nTransaction: ${txId}\n\nYour Pro features:\n- CLVR AI — Full Claude-powered market analyst\n- 4 AI trade ideas per morning brief\n- Unlimited price alerts\n- Real-time signals with AI reasoning\n- Liquidation heatmap & whale tracker\n- Volume & funding rate monitors\n\nOpen your dashboard: https://clvrquantai.com\n\nQuestions? Support@clvrquantai.com\n\n© 2026 CLVRQuantAI`,
              html: `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#050709;color:#c8d4ee;padding:0;margin:0">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid #141e35">
      <div style="font-family:Georgia,serif;font-size:34px;font-weight:900;color:#e8c96d;letter-spacing:0.04em">CLVRQuantAI</div>
      <div style="font-family:'Courier New',monospace;font-size:9px;color:#4a5d80;letter-spacing:0.25em;margin-top:4px">MARKET INTELLIGENCE PLATFORM</div>
    </div>

    <!-- Body -->
    <p style="font-size:15px;color:#f0f4ff;margin-bottom:6px">${isEliteSubscription ? '✦ Elite Access Confirmed' : 'Payment Confirmed'}</p>
    <p style="font-size:13px;color:#6b7fa8;line-height:1.8;margin-bottom:20px">
      ${isEliteSubscription ? `Welcome to the <strong style="color:#e8c96d">Elite tier</strong>, ${customerName}. Your exclusive CLVRQuantAI Elite membership is now active. Below is your receipt.` : `Thank you, ${customerName}. Your CLVRQuantAI Pro subscription is now active. Below is your receipt for your records.`}
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
      <div style="font-family:'Courier New',monospace;font-size:9px;color:#e8c96d;letter-spacing:0.2em;margin-bottom:10px">${isEliteSubscription ? 'YOUR ELITE ACCESS' : 'YOUR PRO FEATURES'}</div>
      <div style="font-size:12px;color:#6b7fa8;line-height:2">
        ${isEliteSubscription ? `✦ Unlimited CLVR AI — Claude Sonnet, unrestricted<br>
        ✦ All real-time signals: crypto, equities, commodities &amp; forex<br>
        ✦ Full Hyperliquid perpetuals data &amp; funding rate monitor<br>
        ✦ Daily Morning Intelligence Brief<br>
        ✦ Priority price alerts &amp; push notifications<br>
        ✦ Phantom Wallet Solana integration<br>
        ✦ Macro calendar with AI event-by-event analysis` : `✦ CLVR AI — Full Claude-powered market analyst<br>
        ✦ 4 AI trade ideas per morning brief<br>
        ✦ Unlimited price alerts<br>
        ✦ Real-time signals with AI reasoning<br>
        ✦ Liquidation heatmap &amp; whale tracker<br>
        ✦ Volume &amp; funding rate monitors`}
      </div>
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:28px">
      <a href="https://clvrquantai.com" style="display:inline-block;background:linear-gradient(135deg,#c9a84c,#e8c96d);color:#050709;font-family:'Courier New',monospace;font-size:11px;font-weight:700;letter-spacing:0.15em;padding:14px 32px;border-radius:3px;text-decoration:none">OPEN DASHBOARD</a>
    </div>

    <!-- Note -->
    <p style="font-size:12px;color:#4a5d80;line-height:1.8;text-align:center;margin-bottom:20px">
      Questions or need help? Reply to this email or reach us at<br>
      <a href="mailto:Support@clvrquantai.com" style="color:#c9a84c;text-decoration:none">Support@clvrquantai.com</a>
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

      // ── invoice.paid — recurring monthly/yearly billing receipt ─────────────
      if (event.type === 'invoice.paid') {
        try {
          const invoice = event.data.object as any;
          const toEmail   = invoice.customer_email;
          const custName  = invoice.customer_name || 'Valued Member';
          const amountCents = invoice.amount_paid || 0;
          const currency  = (invoice.currency || 'usd').toUpperCase();
          const amountFmt = `$${(amountCents / 100).toFixed(2)} ${currency}`;
          const invoiceNum = invoice.number || invoice.id?.slice(-8).toUpperCase() || '—';
          const periodEnd  = invoice.period_end
            ? new Date(invoice.period_end * 1000).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })
            : '—';
          const nextBill   = invoice.next_payment_attempt
            ? new Date(invoice.next_payment_attempt * 1000).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })
            : '—';
          const txDate     = new Date((invoice.created || Date.now()/1000) * 1000).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
          const invoiceUrl = invoice.hosted_invoice_url || 'https://clvrquantai.com';

          // Determine plan from amount
          let planName = 'CLVRQuantAI Pro';
          let planInterval = amountFmt;
          let planColor = '#e8c96d';
          let billingCycle = '';
          if (amountCents >= 19000 && amountCents < 22000) {
            planName = 'Pro Plan — Annual';
            planInterval = `$199.00 CAD/year`;
            planColor = '#00c787';
            billingCycle = 'Annual subscription — next renewal in 12 months';
          } else if (amountCents >= 2500 && amountCents < 3500) {
            planName = 'Pro Plan — Monthly';
            planInterval = `$29.00 CAD/month`;
            billingCycle = 'Monthly subscription — next renewal in 30 days';
          }

          if (toEmail) {
            const { getUncachableResendClient } = await import('./resendClient');
            const { client: resend, fromEmail: billFrom } = await getUncachableResendClient();
            const unsubUrl = `https://clvrquantai.com/api/unsubscribe?email=${encodeURIComponent(toEmail)}`;
            await resend.emails.send({
              from: billFrom,
              to: toEmail,
              replyTo: 'Support@clvrquantai.com',
              subject: `CLVRQuantAI — Billing Receipt ${invoiceNum}`,
              headers: {
                'List-Unsubscribe': `<${unsubUrl}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              },
              text: `CLVRQuantAI — Billing Receipt\n\nHello ${custName},\n\nYour CLVRQuantAI subscription has been renewed successfully. Thank you!\n\nInvoice: ${invoiceNum}\nPlan: ${planName}\nAmount charged: ${planInterval}\nDate: ${txDate}\nPeriod end: ${periodEnd}\nNext billing: ${nextBill}\n\nView full invoice: ${invoiceUrl}\n\nYour Pro features:\n- CLVR AI — Full Claude-powered market analyst\n- Real-time signals with AI reasoning\n- Unlimited price alerts\n- Liquidation heatmap & whale tracker\n- Insider trading feed\n- Global asset basket (140+ assets)\n\nQuestions? Reply to this email or contact Support@clvrquantai.com\n\n© 2026 CLVRQuantAI · 1 Place Ville-Marie, Montréal, QC, Canada\nThis email was sent because you have an active CLVRQuantAI Pro subscription.\nTo unsubscribe from billing receipts: ${unsubUrl}`,
              html: `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#050709;color:#c8d4ee;padding:0;margin:0">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid #141e35">
      <div style="font-family:Georgia,serif;font-size:34px;font-weight:900;color:#e8c96d;letter-spacing:0.04em">CLVRQuantAI</div>
      <div style="font-family:'Courier New',monospace;font-size:9px;color:#4a5d80;letter-spacing:0.25em;margin-top:4px">BILLING RECEIPT · SUBSCRIPTION RENEWED</div>
    </div>

    <p style="font-size:15px;color:#f0f4ff;margin-bottom:6px">Hello ${custName},</p>
    <p style="font-size:13px;color:#6b7fa8;line-height:1.8;margin-bottom:20px">
      Your CLVRQuantAI Pro subscription has been renewed. Here is your receipt for your records.
    </p>

    <!-- Invoice table -->
    <div style="background:#0a1020;border:1px solid #1a2840;border-radius:4px;padding:20px;margin-bottom:24px">
      <div style="font-family:'Courier New',monospace;font-size:9px;color:#4a5d80;letter-spacing:0.2em;margin-bottom:14px">INVOICE ${invoiceNum}</div>
      <table style="width:100%;border-collapse:collapse">
        <tr style="border-bottom:1px solid #141e35">
          <td style="padding:10px 0;font-size:12px;color:#6b7fa8;font-family:'Courier New',monospace;letter-spacing:0.06em">PLAN</td>
          <td style="padding:10px 0;font-size:13px;color:#f0f4ff;text-align:right;font-weight:600">${planName}</td>
        </tr>
        <tr style="border-bottom:1px solid #141e35">
          <td style="padding:10px 0;font-size:12px;color:#6b7fa8;font-family:'Courier New',monospace;letter-spacing:0.06em">AMOUNT CHARGED</td>
          <td style="padding:10px 0;font-size:14px;text-align:right;font-weight:700;color:${planColor}">${planInterval}</td>
        </tr>
        <tr style="border-bottom:1px solid #141e35">
          <td style="padding:10px 0;font-size:12px;color:#6b7fa8;font-family:'Courier New',monospace;letter-spacing:0.06em">DATE</td>
          <td style="padding:10px 0;font-size:12px;color:#c8d4ee;text-align:right">${txDate}</td>
        </tr>
        <tr style="border-bottom:1px solid #141e35">
          <td style="padding:10px 0;font-size:12px;color:#6b7fa8;font-family:'Courier New',monospace;letter-spacing:0.06em">PERIOD END</td>
          <td style="padding:10px 0;font-size:12px;color:#c8d4ee;text-align:right">${periodEnd}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;font-size:12px;color:#6b7fa8;font-family:'Courier New',monospace;letter-spacing:0.06em">NEXT BILLING</td>
          <td style="padding:10px 0;font-size:12px;color:#c8d4ee;text-align:right">${nextBill}</td>
        </tr>
      </table>
    </div>

    ${billingCycle ? `<div style="background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.2);border-radius:4px;padding:10px 14px;margin-bottom:20px;font-size:11px;color:#c9a84c;font-family:'Courier New',monospace;letter-spacing:0.06em">${billingCycle}</div>` : ''}

    <!-- View invoice CTA -->
    <div style="text-align:center;margin-bottom:24px">
      <a href="${invoiceUrl}" style="display:inline-block;background:linear-gradient(135deg,#c9a84c,#e8c96d);color:#050709;font-family:'Courier New',monospace;font-size:10px;font-weight:700;letter-spacing:0.15em;padding:12px 28px;border-radius:3px;text-decoration:none;margin-right:8px">VIEW INVOICE</a>
      <a href="https://clvrquantai.com" style="display:inline-block;background:transparent;border:1px solid #c9a84c;color:#c9a84c;font-family:'Courier New',monospace;font-size:10px;font-weight:700;letter-spacing:0.15em;padding:12px 28px;border-radius:3px;text-decoration:none">OPEN DASHBOARD</a>
    </div>

    <!-- Pro features reminder -->
    <div style="background:#0a1020;border:1px solid #1a2840;border-left:3px solid #e8c96d;border-radius:4px;padding:14px;margin-bottom:24px">
      <div style="font-family:'Courier New',monospace;font-size:9px;color:#e8c96d;letter-spacing:0.2em;margin-bottom:10px">YOUR ACTIVE PRO FEATURES</div>
      <div style="font-size:11px;color:#6b7fa8;line-height:2">
        ✦ CLVR AI — Full Claude-powered market analyst<br>
        ✦ Real-time signals with AI reasoning<br>
        ✦ Unlimited price alerts &amp; push notifications<br>
        ✦ Insider trading feed (SEC filings, $100K+ buys)<br>
        ✦ Global asset basket — 140+ assets, Halal screened<br>
        ✦ Daily 6 AM Morning Brief
      </div>
    </div>

    <p style="font-size:12px;color:#4a5d80;line-height:1.8;text-align:center;margin-bottom:20px">
      Questions about your billing? Reply to this email or contact<br>
      <a href="mailto:Support@clvrquantai.com" style="color:#c9a84c;text-decoration:none">Support@clvrquantai.com</a>
    </p>

    <!-- CASL/CAN-SPAM footer -->
    <div style="border-top:1px solid #141e35;padding-top:16px;text-align:center">
      <p style="font-size:10px;color:#2a3650;margin:0">© 2026 CLVRQuantAI · 1 Place Ville-Marie, Montréal, QC H3B 4A9, Canada</p>
      <p style="font-size:9px;color:#1e2c45;margin:6px 0 0;line-height:1.8">
        You are receiving this billing receipt because you have an active CLVRQuantAI Pro subscription.<br>
        To stop receiving billing receipts, cancel your subscription in the 
        <a href="https://clvrquantai.com" style="color:#2a3650;text-decoration:underline">Account</a> tab
        or <a href="${unsubUrl}" style="color:#2a3650;text-decoration:underline">Unsubscribe</a> from all emails.
      </p>
    </div>

  </div>
</div>`,
            });
            console.log(`[stripe] Billing receipt sent to ${toEmail} for ${planName} (${amountFmt})`);
          }
        } catch (billErr: any) {
          console.error('[stripe] Billing receipt email error (non-fatal):', billErr.message);
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

// Default JSON parser (100kb). Skip it for routes that install their own
// larger-limit parser (e.g. /api/journal/extract handles up to 12mb images).
const SKIP_GLOBAL_JSON_PATHS = new Set(["/api/journal/extract"]);
const globalJsonParser = express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  },
});
app.use((req, res, next) => {
  if (SKIP_GLOBAL_JSON_PATHS.has(req.path)) return next();
  return globalJsonParser(req, res, next);
});

app.use(express.urlencoded({ extended: false }));

import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db";
const PgSession = connectPgSimple(session);
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
      lookup_keys: ['pro_monthly1', 'pro_yearly1'],
      active: true,
    });
    if (existing.data.length >= 2) {
      log(`Stripe prices OK: found pro_monthly1 + pro_yearly1 by lookup_key`, 'stripe');
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
    const hasMonthly = existing.data.some(p => p.lookup_key === 'pro_monthly1');
    const hasYearly  = existing.data.some(p => p.lookup_key === 'pro_yearly1');

    if (!hasMonthly) {
      await stripe.prices.create({
        product: product.id, unit_amount: 2900, currency: 'usd',
        recurring: { interval: 'month' },
        lookup_key: 'pro_monthly1',
        transfer_lookup_key: true,
        metadata: { plan: 'pro_monthly1' },
      });
      log('Created price: pro_monthly1 ($29/month)', 'stripe');
    }
    if (!hasYearly) {
      await stripe.prices.create({
        product: product.id, unit_amount: 19900, currency: 'usd',
        recurring: { interval: 'year' },
        lookup_key: 'pro_yearly1',
        transfer_lookup_key: true,
        metadata: { plan: 'pro_yearly1' },
      });
      log('Created price: pro_yearly1 ($199/year)', 'stripe');
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

// ── Phase 2A: spawn Python quant microservice on 127.0.0.1:8081 ──────────────
function startQuantService() {
  if (process.env.PHASE2A_DISABLED === "1") {
    log("Phase2A disabled via PHASE2A_DISABLED=1", "quant");
    return;
  }
  try {
    const child = spawnChild(
      "python",
      ["-m", "uvicorn", "quant.main:app", "--host", "127.0.0.1", "--port", "8081", "--log-level", "info"],
      { env: { ...process.env, PYTHONUNBUFFERED: "1" }, stdio: ["ignore", "pipe", "pipe"] }
    );
    child.stdout?.on("data", (b: Buffer) => process.stdout.write(`[quant] ${b}`));
    child.stderr?.on("data", (b: Buffer) => process.stderr.write(`[quant] ${b}`));
    child.on("error", (err: Error) => console.error("[quant] child error:", err.message));
    child.on("exit", (code: number | null) => log(`quant service exited code=${code}`, "quant"));
    process.on("exit", () => { try { child.kill("SIGTERM"); } catch {} });
    process.on("SIGINT", () => { try { child.kill("SIGTERM"); } catch {} });
    process.on("SIGTERM", () => { try { child.kill("SIGTERM"); } catch {} });
    log("quant service spawning on 127.0.0.1:8081", "quant");
  } catch (e: any) {
    console.error("[quant] spawn failed:", e.message);
  }
}

(async () => {
  startQuantService();
  await initializeDatabase();
  await initStripe();
  await registerRoutes(httpServer, app);
  initSocketIO(httpServer);
  startDailyBriefScheduler();
  startOutcomeResolver();
  startAdaptiveThresholds();
  startCircuitBreaker();
  // Catch up the system to historical reality on every startup (idempotent).
  // Suppresses any token+direction with <30% WR over 10+ resolved signals.
  suppressHistoricalBleeders().catch(e => console.error("[startup] suppressHistoricalBleeders failed:", e));

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

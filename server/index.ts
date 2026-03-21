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

app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature) return res.status(400).json({ error: 'Missing signature' });
    const sig = Array.isArray(signature) ? signature[0] : signature;
    try {
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (e: any) {
      console.error('Webhook error:', e.message);
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

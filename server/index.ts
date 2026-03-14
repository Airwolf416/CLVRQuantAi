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
    const existing = await stripe.products.search({ query: "metadata['app']:'clvrquant'" });
    if (existing.data.length > 0) {
      const prices = await stripe.prices.list({ product: existing.data[0].id, active: true });
      log(`Stripe products OK: ${existing.data[0].id} with ${prices.data.length} prices`, 'stripe');
      return;
    }
    const product = await stripe.products.create({
      name: 'CLVRQuant Pro',
      description: 'Full access to CLVRQuant AI trading intelligence: AI analyst, trade ideas, morning briefs, unlimited alerts, signals, liquidation heatmap, volume & funding monitors.',
      metadata: { tier: 'pro', app: 'clvrquant' },
    });
    await stripe.prices.create({
      product: product.id, unit_amount: 2900, currency: 'usd',
      recurring: { interval: 'month' }, metadata: { plan: 'pro_monthly' },
    });
    await stripe.prices.create({
      product: product.id, unit_amount: 19900, currency: 'usd',
      recurring: { interval: 'year' }, metadata: { plan: 'pro_yearly' },
    });
    log(`Created Stripe product ${product.id} with monthly + yearly prices`, 'stripe');
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

    const domains = process.env.REPLIT_DOMAINS?.split(',') || [];
    if (domains.length > 0) {
      const webhookBaseUrl = `https://${domains[0]}`;
      await stripeSync.findOrCreateManagedWebhook(
        `${webhookBaseUrl}/api/stripe/webhook`
      );
      log('Stripe webhook configured', 'stripe');
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

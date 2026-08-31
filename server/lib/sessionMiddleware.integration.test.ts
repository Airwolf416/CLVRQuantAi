import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import session from "express-session";
import { createServer } from "node:http";
import {
  initializeAuthenticatedSession,
  sessionPolicyMiddleware,
  sessionStatus,
  updateSessionActivity,
} from "./sessionSecurity";

async function withApp(run: (base: string) => Promise<void>) {
  const app = express();
  app.use(session({ secret: "test-secret", resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.post("/seed/:kind", (req, res) => {
    initializeAuthenticatedSession(req.session as any, "test-user");
    if (req.params.kind === "idle") (req.session as any).lastActivityAt = Date.now() - 9 * 60 * 60 * 1000;
    if (req.params.kind === "absolute") (req.session as any).loginAt = Date.now() - 31 * 24 * 60 * 60 * 1000;
    if (req.params.kind === "heartbeat") (req.session as any).lastActivityAt = Date.now() - 6 * 60 * 1000;
    req.session.save(error => error ? res.sendStatus(500) : res.json({ ok: true }));
  });
  app.use(sessionPolicyMiddleware);
  app.get("/probe", (req, res) => res.json(sessionStatus(req) || { authenticated: false }));
  app.post("/heartbeat", async (req, res) => {
    await updateSessionActivity(req);
    res.json(sessionStatus(req));
  });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

async function seeded(base: string, kind: string) {
  const response = await fetch(`${base}/seed/${kind}`, { method: "POST" });
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return { cookie: cookie! };
}

test("isolated cookie middleware returns structured idle and absolute expiry", async () => {
  await withApp(async base => {
    for (const [kind, code] of [["idle", "SESSION_IDLE_EXPIRED"], ["absolute", "SESSION_MAX_AGE"]] as const) {
      const { cookie } = await seeded(base, kind);
      const response = await fetch(`${base}/probe`, { headers: { cookie } });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).code, code);
    }
  });
});

test("isolated heartbeat updates cookie session activity", async () => {
  await withApp(async base => {
    const { cookie } = await seeded(base, "heartbeat");
    const response = await fetch(`${base}/heartbeat`, { method: "POST", headers: { cookie } });
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.ok(status.idleExpiresAt > Date.now() + 7 * 60 * 60 * 1000);
  });
});
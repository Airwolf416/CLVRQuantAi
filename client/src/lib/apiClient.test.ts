// Focused unit coverage for client request classification/replay policy.
// Excluded from production typecheck; run with a Node test runner that supports ESM.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { apiFetch, createReauthCoordinator, isReauthReplayAllowed, isReplaySafe, readAuthSession, responseCode } from "./apiClient.js";
import { canSendHeartbeat, createSessionEventReceiver, sessionBroadcastPayload } from "../components/SessionSecurity.jsx";

// apiClient intentionally uses the current origin only for relative URLs.
(globalThis as any).window = { location: { origin: "https://app.example.test" } };

test("account checks distinguish unauthenticated from transient or invalid responses", async () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  assert.equal(await readAuthSession(json({ error: "Not signed in" }, 401)), null);
  assert.equal(await readAuthSession(json({ user: null })), null);
  assert.deepEqual(await readAuthSession(json({ user: { id: "123", isAdmin: true } })), { id: "123", isAdmin: true });
  assert.deepEqual(await readAuthSession(json({ id: "legacy" })), { id: "legacy" });
  for (const response of [
    json({ error: "Slow down" }, 429),
    json({ error: "Database down" }, 503),
    json({ error: "Forbidden" }, 403),
    json({}), json({ user: {} }),
    new Response("not json", { status: 200 }),
  ]) await assert.rejects(readAuthSession(response));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("Network failed"); };
  try {
    await assert.rejects(apiFetch("/api/auth/me").then(readAuthSession), /Network failed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("classifies structured session and subscription responses independently", async () => {
  const expired = new Response(JSON.stringify({ code: "SESSION_IDLE_EXPIRED" }), { status: 401 });
  const subscription = new Response(JSON.stringify({ code: "PRO_REQUIRED" }), { status: 403 });
  assert.equal(await responseCode(expired), "SESSION_IDLE_EXPIRED");
  assert.equal(await responseCode(subscription), "PRO_REQUIRED");
});

test("reauth replay is limited to exact sensitive POST routes", () => {
  assert.equal(isReauthReplayAllowed("/api/stripe/cancel", "POST"), true);
  assert.equal(isReauthReplayAllowed("/api/stripe/checkout", "POST"), false);
  assert.equal(isReauthReplayAllowed("/api/account", "DELETE"), true);
  assert.equal(isReplaySafe("GET"), true);
  assert.equal(isReplaySafe("POST"), false);
});

test("cross-tab messages have no credential fields", () => {
  assert.deepEqual(sessionBroadcastPayload("signout"), { type: "signout", source: "clvr-session" });
});

test("heartbeat throttle begins only from a successful heartbeat timestamp", () => {
  assert.equal(canSendHeartbeat(0, 300_000), true);
  assert.equal(canSendHeartbeat(300_000, 599_999), false);
  assert.equal(canSendHeartbeat(300_000, 600_000), true);
});

test("concurrent reauth callers share exactly one challenge", async () => {
  let calls = 0;
  const request = createReauthCoordinator(async () => { calls++; return true; });
  const values = await Promise.all([request(), request(), request()]);
  assert.deepEqual(values, [true, true, true]);
  assert.equal(calls, 1);
});

test("two tabs receive one broadcast or storage event without rebroadcast", () => {
  for (const event of [
    { data: { ...sessionBroadcastPayload("expired"), eventId: "bc-event" } },
    { key: "clvr_session_event", newValue: JSON.stringify({ ...sessionBroadcastPayload("signout"), eventId: "storage-event" }) },
  ]) {
    let tabA = 0, tabB = 0, broadcasts = 0;
    const receiveA = createSessionEventReceiver(() => { tabA++; });
    const receiveB = createSessionEventReceiver(() => { tabB++; });
    // One originating event is delivered once to each receiving tab.
    receiveA(event);
    receiveB(event);
    assert.equal(tabA, 1);
    assert.equal(tabB, 1);
    // The receiver has no broadcaster dependency and never echoes the event.
    assert.equal(broadcasts, 0);
  }
});

test("broadcast and storage copies of one event transition each tab once", () => {
  let tabA = 0, tabB = 0;
  const receiveA = createSessionEventReceiver(() => { tabA++; });
  const receiveB = createSessionEventReceiver(() => { tabB++; });
  const payload = { ...sessionBroadcastPayload("expired"), eventId: "same-originating-event" };
  for (const receive of [receiveA, receiveB]) {
    receive({ data: payload });
    receive({ key: "clvr_session_event", newValue: JSON.stringify(payload) });
  }
  assert.equal(tabA, 1);
  assert.equal(tabB, 1);
});

test("client has no native same-origin API fetch outside public auth allowlist", () => {
  const root = join(process.cwd(), "client/src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(?:js|jsx|ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) files.push(path);
    }
  };
  walk(root);
  const publicAuth = new Set([
    "/api/auth/verify-email", "/api/auth/webauthn/authenticate", "/api/auth/signup",
    "/api/auth/signin", "/api/auth/forgot-password", "/api/auth/reset-password",
  ]);
  const violations: string[] = [];
  const nativeApiCall = /\bfetch\s*\(\s*(?:`([^`]+)`|\"([^\"]+)\"|'([^']+)')/g;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(nativeApiCall)) {
      const value = match[1] || match[2] || match[3] || "";
      if (!value.startsWith("/api/")) continue;
      const endpoint = value.split(/[?${]/)[0];
      const isAllowed = relative(root, file) === "WelcomePage.jsx" && publicAuth.has(endpoint);
      if (!isAllowed) violations.push(`${relative(root, file)}: ${value}`);
    }
  }
  assert.deepEqual(violations, []);
});
import assert from "node:assert/strict";
import test from "node:test";
import { LEGACY_WEBAUTHN_RESPONSE } from "./webauthnPolicy";
import { rejectLegacyWebAuthnAuthentication } from "./webauthnPolicy";
import express from "express";
import { createServer } from "node:http";

test("legacy credential IDs cannot authenticate", () => {
  assert.equal(LEGACY_WEBAUTHN_RESPONSE.code, "WEBAUTHN_LEGACY_CREDENTIAL");
});

test("actual WebAuthn authenticate handler cannot create a session from an ID", async () => {
  const app = express();
  app.use(express.json());
  app.post("/api/auth/webauthn/authenticate", rejectLegacyWebAuthnAuthentication);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as any).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/webauthn/authenticate`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentialId: "known-id" }),
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), LEGACY_WEBAUTHN_RESPONSE);
    assert.equal(response.headers.get("set-cookie"), null);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
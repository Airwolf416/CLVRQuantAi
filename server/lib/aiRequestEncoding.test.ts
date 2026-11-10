import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clampAiText, serializeAiRequest, describeAiProviderFailure } from "./aiRequestEncoding";

function assertWellFormed(value: unknown): void {
  if (typeof value === "string") assert.equal(value.isWellFormed(), true);
  else if (Array.isArray(value)) value.forEach(assertWellFormed);
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => {
    assert.equal(key.isWellFormed(), true);
    assertWellFormed(item);
  });
}

test("all three input budgets preserve complete emoji at the exact boundary", () => {
  for (const limit of [4000, 16000, 30000]) {
    const text = "x".repeat(limit - 1) + "🧠" + "live market data";
    const old = text.slice(0, limit);
    assert.equal(old.isWellFormed(), false); // Reproduces the production defect.
    const safe = clampAiText(text, limit);
    assert.equal(safe.length, limit - 1);
    assert.equal(safe.isWellFormed(), true);
    assert.equal(safe.includes("\uFFFD"), false); // Drop a split valid emoji, don't corrupt it.
  }
});

test("valid emoji, multilingual data, and escaped literals are preserved", () => {
  const text = '🧠📈📉 BTC → ETH; 日本語; pétrole; "quotes"; \\\\ literal \\uD83D\n\tend';
  assert.equal(clampAiText(text, 30000), text);
  const parsed = JSON.parse(serializeAiRequest({ messages: [{ content: text }] }));
  assert.equal(parsed.messages[0].content, text);
});

test("pre-existing lone surrogates are repaired, not sent as escaped invalid Unicode", () => {
  const text = "start\uD83Dmiddle\uDC00end";
  assert.equal(clampAiText(text, 100), "start\uFFFDmiddle\uFFFDend");
  assertWellFormed(JSON.parse(serializeAiRequest({ system: text, messages: [{ content: text }] })));
});

test("the final serializer protects system context, history, and tool follow-ups", () => {
  const payload = {
    system: "feed data \uD83D",
    messages: [
      { role: "user", content: "question \uDC00" },
      { role: "assistant", content: [{ type: "tool_use", id: "tool-1", input: { ticker: "BTC" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "quote \uD83D" }] },
    ],
  };
  assertWellFormed(JSON.parse(serializeAiRequest(payload)));
});

test("strict provider validation accepts the repaired request, not the old JSON", () => {
  const strictProvider = (body: string) => {
    const payload = JSON.parse(body);
    assertWellFormed(payload);
    return { trades: [{ direction: "LONG" }, { direction: "SHORT" }] };
  };
  const payload = { model: "test", messages: [{ role: "user", content: "x".repeat(94000) + "\uD83D" }] };
  assert.throws(() => strictProvider(JSON.stringify(payload)));
  const response = strictProvider(serializeAiRequest(payload));
  assert.deepEqual(response.trades.map(trade => trade.direction), ["LONG", "SHORT"]);
});

test("all small boundary offsets stay within the limit and remain Unicode-safe", () => {
  const text = "📈🧠日本語\\\"BTC\n".repeat(30);
  for (let limit = 0; limit < text.length + 2; limit++) {
    const safe = clampAiText(text, limit);
    assert.ok(safe.length <= limit);
    assert.equal(safe.isWellFormed(), true);
    assertWellFormed(JSON.parse(serializeAiRequest({ context: safe })));
  }
});

test("invalid budgets and non-JSON requests fail explicitly", () => {
  for (const limit of [-1, NaN, Infinity, 1.5]) assert.throws(() => clampAiText("abc", limit), RangeError);
  assert.throws(() => serializeAiRequest(undefined), TypeError);
});

test("encoding errors are actionable failures, never empty trade results or raw API JSON", () => {
  const failure = describeAiProviderFailure(400, '{"error":{"message":"The request body is not valid JSON: unexpected end of hex escape"}}');
  assert.equal(failure.status, 502);
  assert.equal(failure.code, "AI_REQUEST_ENCODING_ERROR");
  assert.match(failure.error, /text-encoding error/);
  assert.equal(failure.error.includes('{"error"'), false);
  assert.equal("trades" in failure, false);
});

test("provider authentication errors never masquerade as an expired user session", () => {
  assert.equal(describeAiProviderFailure(401, "provider authentication failed").status, 502);
  assert.equal(describeAiProviderFailure(429, "busy").code, "AI_BUSY");
  assert.equal(describeAiProviderFailure(529, "overloaded").error, "__MAINTENANCE__");
  assert.equal(describeAiProviderFailure(400, "credit balance too low").error, "__MAINTENANCE__");
});

test("the real analyst route uses safe truncation and serialization", () => {
  const source = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
  assert.ok(source.includes("clampAiText(contextRaw, 30000)"));
  assert.ok(source.includes("clampAiText(m.content, 4000)"));
  assert.ok(source.includes("clampAiText(userMessageInput, 16000)"));
  const transport = source.slice(source.indexOf("const callClaude = async"), source.indexOf("const messages: any[] = [...validatedHistory"));
  assert.match(transport, /body: serializeAiRequest\(body\)/);
});

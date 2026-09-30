// Static guardrails for the A15/A16 decorative-motion release.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createResponseItemIdResolver, MOTION_SEEN_ID_LIMIT } from "./hooks/useNewItemMotion.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("motion utilities remain composited and reduced-motion safe", () => {
  const css = read("./index.css");
  assert.match(css, /\.motion-card-enter/);
  assert.match(css, /transform: translateY\(8px\)/);
  assert.match(css, /\.motion-meter[\s\S]*transform: scaleX/);
  assert.match(css, /\.motion-shimmer::after/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /transition:\s*all/);
});

test("card lists use stable IDs and a single accessible loading status", () => {
  const ideas = read("./components/ai/TopTradeIdeas.jsx");
  const scanner = read("./components/ai/QuantScanner.jsx");
  assert.match(ideas, /useNewItemMotion/);
  assert.match(ideas, /key=\{id\}/);
  assert.match(ideas, /aria-busy="true"/);
  assert.match(ideas, /aria-hidden="true"/);
  assert.match(scanner, /useNewItemMotion/);
  assert.match(scanner, /aria-busy="true"/);
  assert.match(scanner, /aria-hidden="true"/);
  assert.doesNotMatch(ideas, /transition:\s*"all/);
});

test("filter tabs retain native button focus semantics during crossfade", () => {
  const ideas = read("./components/ai/TopTradeIdeas.jsx");
  assert.match(ideas, /<button className="motion-press" key=\{t\.k\}/);
  assert.match(ideas, /className="motion-tab-content"/);
  assert.doesNotMatch(ideas, /tabIndex=\{-1\}/);
});

test("response identities disambiguate collisions and survive reorder", () => {
  const ids = createResponseItemIdResolver("test");
  const first = { ticker: "BTC" };
  const duplicate = { ticker: "BTC" };
  const initial = ids([first, duplicate], () => undefined);
  assert.notEqual(initial[0], initial[1]);
  assert.deepEqual(ids([duplicate, first], () => undefined), [initial[1], initial[0]]);
  assert.deepEqual(ids([{ id: "same" }, { id: "same" }], item => item.id), [
    "test:server:same",
    "test:server:same:occurrence:1",
  ]);

  // A repeated scan response with the same ticker is a new result object and
  // therefore receives a new identity and can receive its one entrance.
  assert.notEqual(ids([{ ticker: "BTC" }], () => undefined)[0], initial[0]);
  assert.equal(MOTION_SEEN_ID_LIMIT, 500);
});

test("idle and price decorative effects are reduced-motion safe", () => {
  const css = read("./index.css");
  const session = read("./components/SessionSecurity.jsx");
  const market = read("./tabs/MarketTab.jsx");
  assert.match(css, /\.motion-idle-banner-enter/);
  assert.match(css, /\.motion-price-pulse::after/);
  assert.match(session, /motion-idle-banner-(enter|exit)/);
  assert.match(market, /motion-price-pulse/);
});
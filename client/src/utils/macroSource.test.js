import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
const basket = readFileSync(new URL("../components/MyBasket.jsx", import.meta.url), "utf8");

test("Basket owns the only non-Elite upsell; parent generic gate does not render beside it", () => {
  assert.match(app, /tab!=="basket"&&ELITE_TABS_GATE\.includes\(tab\)&&<TabUpgradeGate/);
  const basketPanel = app.slice(app.indexOf('{tab==="basket"&&<>'), app.indexOf('{/* ══ GUIDE ══ */}'));
  assert.match(basketPanel, /<MyBasket[\s\S]*isPro=\{isElite\}/);
  assert.doesNotMatch(basketPanel, /<ProGate|<TabUpgradeGate/);
  assert.match(basket, /if \(!isPro\) \{[\s\S]*data-testid="btn-upgrade-my-basket"/);
  assert.equal((basket.match(/data-testid="btn-upgrade-my-basket"/g) || []).length, 1);
  assert.doesNotMatch(basket, /data-testid="btn-upgrade-promote"/);
});

test("Radar and Macro cards share the same upcoming event list", () => {
  assert.match(app, /macroUpcomingEvents=selectUpcomingMacroEvents\(macroEvents,today\)/);
  assert.match(app, /macroNextPending=macroUpcomingEvents\[0\]/);
  assert.match(app, /nextEvents=macroUpcomingEvents/);
});
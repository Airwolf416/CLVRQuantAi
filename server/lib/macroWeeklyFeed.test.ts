import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMacroWeeklyCsv, parseMacroWeeklyXml, validateMacroWeeklyFeed } from "./macroWeeklyFeed";

test("valid empty feed is distinct from malformed or previous-week response", () => {
  assert.deepEqual(validateMacroWeeklyFeed([], "2026-09-30"), []);
  assert.throws(() => validateMacroWeeklyFeed({ error: "blocked" }, "2026-09-30"));
  assert.throws(() => validateMacroWeeklyFeed([{ title: "CPI", country: "USD", date: "bad", impact: "High" }], "2026-09-30"));
  assert.throws(() => validateMacroWeeklyFeed([{ title: "CPI", country: "USD", date: "2026-09-20T08:30:00-04:00", impact: "High" }], "2026-09-30"));
  assert.equal(validateMacroWeeklyFeed([{ title: "CPI", country: "USD", date: "2026-09-30T08:30:00-04:00", impact: "High" }], "2026-09-30").length, 1);
});

test("official CSV fallback preserves UTC times and refuses incomplete rows", () => {
  const header = "Title,Country,Date,Time,Impact,Forecast,Previous,URL";
  const csv = `${header}\nCPI m/m,USD,09-30-2026,12:30pm,High,0.2%,0.1%,https://www.forexfactory.com/calendar/123`;
  assert.deepEqual(parseMacroWeeklyCsv(csv)[0], {
    title: "CPI m/m", country: "USD", date: "2026-09-30T12:30:00Z",
    impact: "High", forecast: "0.2%", previous: "0.1%",
  });
  assert.deepEqual(validateMacroWeeklyFeed(parseMacroWeeklyCsv(header), "2026-09-30"), []);
  assert.throws(() => parseMacroWeeklyCsv(`${header}\nCPI,USD,09-30-2026`));
});

test("official XML fallback matches CSV fields and refuses truncated XML", () => {
  const xml = `<?xml version="1.0"?><weeklyevents><event>
    <title><![CDATA[CPI m/m]]></title><country>USD</country>
    <date><![CDATA[09-30-2026]]></date><time><![CDATA[12:30pm]]></time>
    <impact><![CDATA[High]]></impact><forecast><![CDATA[0.2%]]></forecast>
    <previous><![CDATA[0.1%]]></previous><url />
    </event></weeklyevents>`;
  assert.equal(parseMacroWeeklyXml(xml)[0].date, "2026-09-30T12:30:00Z");
  assert.deepEqual(parseMacroWeeklyXml("<weeklyevents></weeklyevents>"), []);
  assert.throws(() => parseMacroWeeklyXml(xml.replace("</weeklyevents>", "")));
  assert.throws(() => parseMacroWeeklyXml(xml.replace("<previous><![CDATA[0.1%]]></previous>", "")));
});
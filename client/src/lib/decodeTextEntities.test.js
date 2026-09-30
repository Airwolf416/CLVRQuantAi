import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { decodeTextEntities } from "./decodeTextEntities.js";

assert.equal(decodeTextEntities("Israel&#039;s partners"), "Israel's partners");
assert.equal(decodeTextEntities("A &amp; B"), "A &amp; B"); // Browser decodes named references.
const dangerous = decodeTextEntities("&#60;img src=x onerror=alert(1)&#62;");
assert.equal(dangerous, "<img src=x onerror=alert(1)>");
const output = renderToStaticMarkup(createElement("div", null, dangerous));
assert.equal(output, '<div>&lt;img src=x onerror=alert(1)&gt;</div>');
console.log("Feed text entity and XSS rendering checks passed");
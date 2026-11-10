// script/test.ts discovers server/tests only. Keep the encoding regression
// suite in the normal GitHub test run, not just manual node --test runs.
import "../lib/aiRequestEncoding.test";

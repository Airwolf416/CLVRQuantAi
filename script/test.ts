/**
 * Test runner — discovers every `*.test.ts` file under `server/tests/`
 * and runs each one in its own `tsx` subprocess (the fixtures call
 * `process.exit`, so isolating them keeps one failure from aborting the
 * whole run before later files execute).
 *
 * Usage:
 *   npx tsx script/test.ts
 *
 * Exits 0 only when every discovered test file exits 0; exits 1 if any
 * file fails or if no test files are found.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, sep } from "node:path";

const TEST_ROOT = "server/tests";

function discoverTestFiles(root: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root, { recursive: true }) as string[];
  } catch {
    return [];
  }
  return entries
    .filter((rel) => rel.endsWith(".test.ts"))
    .map((rel) => join(root, rel))
    .sort();
}

function runOne(file: string): boolean {
  console.log(`\n──────────────────────────────────────────`);
  console.log(`▶ ${file}`);
  console.log(`──────────────────────────────────────────`);
  const result = spawnSync("npx", ["tsx", file], { stdio: "inherit" });
  return result.status === 0;
}

const files = discoverTestFiles(TEST_ROOT);

if (files.length === 0) {
  console.error(`[test] no *.test.ts files found under ${TEST_ROOT}${sep}`);
  process.exit(1);
}

console.log(`[test] discovered ${files.length} test file(s):`);
files.forEach((f) => console.log(`  • ${f}`));

const results = files.map((file) => ({ file, ok: runOne(file) }));
const failures = results.filter((r) => !r.ok);

console.log(`\n══════════════════════════════════════════`);
console.log(`[test] ${results.length - failures.length}/${results.length} file(s) passed.`);
if (failures.length > 0) {
  console.log(`\nFailed file(s):`);
  failures.forEach((r) => console.log(`  ✗ ${r.file}`));
  process.exit(1);
}
console.log(`[test] all green.`);
process.exit(0);

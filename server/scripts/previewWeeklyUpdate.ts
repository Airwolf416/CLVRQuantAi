// Offline DRY RUN of the weekly-update pipeline. Writes NOTHING, sends NOTHING.
//
//   npx tsx server/scripts/previewWeeklyUpdate.ts [days]
//
// Defaults to the last 14 days of commits. Prints the fetched commits, the
// chosen source, the AI-rewritten subscriber copy, compliance flags, and a
// check that the email footer/tagline are present.

import { buildWeeklyUpdatePreview } from "../weeklyUpdate";
import { pool } from "../db";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

async function main() {
  const days = Number(process.argv[2]) || 14;
  console.log(`\n=== WEEKLY UPDATE DRY RUN — last ${days} days (no send / no publish) ===\n`);

  const p = await buildWeeklyUpdatePreview({ sinceDays: days, commitsOnly: process.argv.includes("--commits-only") });

  console.log(`source            : ${p.source}`);
  console.log(`since             : ${p.since}`);
  console.log(`source release    : ${p.sourceHeadSha}`);
  console.log(`manual log entries: ${p.pendingCount}`);
  p.pendingEntries.forEach((e) => console.log(`   • ${e.emoji || "•"} ${e.headline}`));
  console.log(`commits (user-facing, after filter): ${p.commitCount}`);
  p.commits.forEach((c) => console.log(`   - ${c}`));
  console.log("");

  if (p.skipped || !p.digest) {
    console.log(`>> SKIPPED: ${p.skipReason}`);
    console.log(">> No update was published and no email was sent.");
    if (!p.ok) throw new Error(p.skipReason || "Digest preview failed validation");
  } else {
    console.log("=== RENDERED DIGEST (subscriber copy) ===");
    console.log(`version : ${p.digest.version || "(none)"}`);
    console.log(`title   : ${p.digest.title}`);
    console.log(`summary : ${p.digest.summary}`);
    console.log(`bullets : ${p.digest.items.length}`);
    p.digest.items.forEach((it, i) => {
      console.log(`  ${i + 1}. ${it.emoji} ${it.title}`);
      console.log(`     ${it.description}`);
    });
    console.log("");
    console.log(`compliance flags : ${p.complianceFlags.length === 0 ? "NONE ✓" : p.complianceFlags.join("; ")}`);
    console.log(`footer present   : ${p.emailHtml?.includes("not financial advice") ? "YES ✓" : "NO ✗"}`);
    console.log(`tagline present  : ${p.emailHtml?.includes("Personal Edge") ? "YES ✓" : "NO ✗"}`);
    console.log(`email HTML size  : ${p.emailHtml?.length || 0} chars (NOT sent)`);
    const output = process.argv.find(arg => arg.startsWith("--out="))?.slice(6);
    if (output && p.emailHtml && p.ok) {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, p.emailHtml, "utf8");
      console.log(`preview saved     : ${output} (file only; no publication or email)`);
    }
  }

  console.log("\n=== END DRY RUN — nothing was saved or emailed ===\n");
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error("dry-run error:", e);
  process.exit(1);
});

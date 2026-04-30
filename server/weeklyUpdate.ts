// Weekly Update — "What's New This Week" digest email.
// • Admin posts a major update via /api/admin/weekly-update
// • Saturday 10:00 ET scheduler (re-checked every minute) automatically emails
//   it to all active subscribers IF the update was created in the last 7 days
//   AND has not been emailed yet.
// • Admin can also force a manual send via /api/admin/weekly-update/send-now

import { pool } from "./db";
import { getUncachableResendClient } from "./resendClient";
import type { WeeklyUpdate } from "@shared/schema";
import { CLAUDE_MODEL } from "./config";
import { execSync } from "child_process";
import { getRecentCommitsViaApi } from "./githubClient";

const ET_TZ = "America/New_York";

// In production deployments there is no .git directory and no git binary, so
// the local CLI returns nothing. Falling back to the GitHub REST API via the
// Replit GitHub connector lets the digest still find commits in prod. The
// repo can be overridden with GITHUB_REPO if it ever moves.
const GITHUB_REPO = process.env.GITHUB_REPO || "Airwolf416/CLVRQuantAi";

// Read git commit subjects from the last N days. Returns one subject per line,
// de-duplicated, with checkpoint/auto-merge noise filtered out. Tries the
// local git CLI first (fast, no network); if that fails or returns nothing,
// falls back to the GitHub API so this works in production too.
export async function getRecentCommitSubjects(days: number = 7): Promise<string[]> {
  let raw = "";
  let usedFallback = false;

  // 1) Local git CLI (works in dev / Replit workspace).
  try {
    raw = execSync(
      `git log --since="${days} days ago" --no-merges --pretty=format:"%s" -n 200`,
      { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
  } catch (e: any) {
    console.log("[weekly-update] git log unavailable:", e?.message || e);
  }

  // 2) GitHub API fallback (production — no .git directory, no git binary).
  if (!raw.trim()) {
    try {
      const commits = await getRecentCommitsViaApi(GITHUB_REPO, days);
      raw = commits
        .map((c) => (c.message || "").split("\n")[0].trim())
        .filter(Boolean)
        .join("\n");
      usedFallback = true;
      console.log(
        `[weekly-update] used GitHub API fallback for ${GITHUB_REPO} — ${commits.length} commits in last ${days}d`
      );
    } catch (e: any) {
      console.log("[weekly-update] GitHub API fallback failed:", e?.message || e);
      return [];
    }
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    if (/^(checkpoint|wip|chore: bump|merge)/i.test(s)) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= 60) break;
  }
  if (!usedFallback) {
    // Tag local-git results too so we can correlate the source in logs.
    console.log(`[weekly-update] used local git CLI — ${out.length} unique subjects in last ${days}d`);
  }
  return out;
}

// Read curated update-log entries that haven't been shipped yet. These are
// what the owner adds via the admin UI throughout the week — the source of
// truth for the digest, since git history isn't always present in production.
export async function getPendingUpdateLogEntries(): Promise<
  { id: number; headline: string; detail: string | null; emoji: string | null; createdAt: Date }[]
> {
  try {
    const r = await pool.query(
      `SELECT id, headline, detail, emoji, created_at
         FROM update_log_entries
        WHERE included_in_update_id IS NULL
        ORDER BY created_at ASC
        LIMIT 100`
    );
    return r.rows.map((row) => ({
      id: row.id,
      headline: row.headline,
      detail: row.detail,
      emoji: row.emoji,
      createdAt: row.created_at,
    }));
  } catch (e: any) {
    console.log("[weekly-update] update_log_entries read failed:", e?.message || e);
    return [];
  }
}

// Mark the given log-entry IDs as shipped under a given update id.
export async function markLogEntriesShipped(entryIds: number[], updateId: number): Promise<void> {
  if (!entryIds.length) return;
  try {
    await pool.query(
      `UPDATE update_log_entries SET included_in_update_id=$1 WHERE id = ANY($2::int[])`,
      [updateId, entryIds]
    );
  } catch (e: any) {
    console.log("[weekly-update] markLogEntriesShipped failed:", e?.message || e);
  }
}

// Ask Claude to turn raw commit subjects into a polished WeeklyUpdate object.
export async function synthesizeWeeklyUpdateFromCommits(
  commits: string[]
): Promise<{ title: string; summary: string; items: { emoji: string; title: string; description: string }[] } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("[weekly-update] ANTHROPIC_API_KEY not set — cannot auto-generate");
    return null;
  }
  if (commits.length === 0) {
    console.log("[weekly-update] no recent commits to summarize");
    return null;
  }

  const weekLabel = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: ET_TZ });
  const prompt = `You are the product editor for CLVRQuantAI — a luxury mobile-first market intel dashboard for crypto / equities / commodities / forex traders. Tier: Free, Pro ($29.99/mo), Elite ($129/mo).

Below are the raw git commit subjects from the past week (${weekLabel}). Distill them into a polished "What's New This Week" digest for paying subscribers. Drop pure-bug-fix / typo / test / refactor commits. Group related commits. Translate engineer-speak into trader-friendly value (focus on what the user can now SEE or DO).

Voice: confident, concise, premium. No marketing fluff. No emojis except in the leading "emoji" field of each item. Speak directly to the trader ("you can now…", "your dashboard now…").

Return ONLY valid JSON in this exact shape, no markdown fence:
{
  "title": "<short headline, max 8 words>",
  "summary": "<2-sentence overview, max 240 chars>",
  "items": [
    { "emoji": "<single emoji>", "title": "<short title, max 60 chars>", "description": "<1-3 sentence value-focused explainer, max 280 chars>" }
  ]
}

Rules:
- 3 to 6 items. Pick only the most user-visible improvements.
- If commits are mostly internal/refactor, return fewer items rather than padding.
- If literally nothing user-visible shipped, return: {"title":"","summary":"","items":[]}
- Suggested emojis: 📊 data, ⚡ performance, 🤖 AI, 🔔 alerts, 📓 journal, 🛡️ reliability, 💎 polish, 📣 squawk, 🪙 commodities, 📈 markets.

Commits:
${commits.map((c) => "- " + c).join("\n")}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) {
      console.log("[weekly-update] Claude error", r.status, (await r.text()).slice(0, 200));
      return null;
    }
    const data: any = await r.json();
    const raw: string = (data.content || []).map((b: any) => b.text || "").join("").trim();
    let t = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    if (t.includes("{")) t = t.slice(t.indexOf("{"));
    if (t.lastIndexOf("}") > 0) t = t.slice(0, t.lastIndexOf("}") + 1);
    const parsed = JSON.parse(t);
    if (!parsed?.title || !Array.isArray(parsed?.items) || parsed.items.length === 0) {
      console.log("[weekly-update] AI returned empty digest — nothing user-visible this week");
      return null;
    }
    return parsed;
  } catch (e: any) {
    console.log("[weekly-update] synthesize error:", e?.message || e);
    return null;
  }
}

// Auto-generate this week's update via Claude, then insert it.
// Source priority: curated update_log_entries (the owner's own log) FIRST,
// falling back to git commit subjects. The buffer is the reliable source —
// git history isn't always present in production deployments.
// Returns the new update or null if nothing to ship.
export async function generateWeeklyUpdateWithAI(): Promise<WeeklyUpdate | null> {
  const pending = await getPendingUpdateLogEntries();
  const commits = await getRecentCommitSubjects(7);
  console.log(`[weekly-update] AI generation: ${pending.length} pending log entries + ${commits.length} commits from last 7d`);

  // Build the input the AI will distill. Prefer the curated buffer entries —
  // they're already trader-friendly. Fall back to commit subjects only when
  // the buffer is empty so we still have something to summarize.
  let inputs: string[];
  let source: "log" | "commits" | "both";
  if (pending.length > 0 && commits.length > 0) {
    source = "both";
    inputs = [
      ...pending.map((p) => `[LOG${p.emoji ? " " + p.emoji : ""}] ${p.headline}${p.detail ? " — " + p.detail : ""}`),
      ...commits.map((c) => `[GIT] ${c}`),
    ];
  } else if (pending.length > 0) {
    source = "log";
    inputs = pending.map((p) => `${p.emoji ? p.emoji + " " : ""}${p.headline}${p.detail ? " — " + p.detail : ""}`);
  } else if (commits.length > 0) {
    source = "commits";
    inputs = commits;
  } else {
    console.log("[weekly-update] no log entries AND no commits — nothing to summarize");
    return null;
  }

  const digest = await synthesizeWeeklyUpdateFromCommits(inputs);
  if (!digest) return null;
  const created = await createWeeklyUpdate({
    version: null,
    title: digest.title,
    summary: digest.summary,
    items: digest.items,
    createdBy: source === "log" ? "ai-from-log" : source === "commits" ? "ai-from-commits" : "ai-from-both",
  });
  // Mark all consumed buffer entries as shipped so they don't reappear next week.
  if (pending.length > 0) {
    await markLogEntriesShipped(pending.map((p) => p.id), created.id);
  }
  console.log(`[weekly-update] AI-generated update id=${created.id} from ${source}: "${digest.title}" (${digest.items.length} items)`);
  return created;
}

function nowInET(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: ET_TZ }));
}

export async function getLatestWeeklyUpdate(): Promise<WeeklyUpdate | null> {
  const r = await pool.query(
    `SELECT * FROM weekly_updates ORDER BY created_at DESC LIMIT 1`
  );
  if (!r.rows[0]) return null;
  const row = r.rows[0];
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    summary: row.summary,
    items: row.items,
    emailSentAt: row.email_sent_at,
    emailRecipientCount: row.email_recipient_count,
    createdBy: row.created_by,
    createdAt: row.created_at,
  } as WeeklyUpdate;
}

export async function createWeeklyUpdate(input: {
  version?: string | null;
  title: string;
  summary: string;
  items: { emoji?: string; title: string; description: string }[];
  createdBy?: string | null;
}): Promise<WeeklyUpdate> {
  const r = await pool.query(
    `INSERT INTO weekly_updates (version, title, summary, items, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING *`,
    [input.version || null, input.title, input.summary, JSON.stringify(input.items || []), input.createdBy || null]
  );
  return r.rows[0];
}

function renderWeeklyUpdateEmail(u: WeeklyUpdate, recipientEmail: string): string {
  const items: { emoji?: string; title: string; description: string }[] = (u.items as any) || [];
  const verBadge = u.version
    ? `<div style="display:inline-block;font-family:monospace;font-size:10px;color:#c9a84c;letter-spacing:.18em;background:rgba(201,168,76,.08);border:1px solid rgba(201,168,76,.3);border-radius:4px;padding:4px 10px">${u.version}</div>`
    : "";
  const itemHtml = items
    .map(
      (it, i) => `
      <div style="display:flex;gap:10px;align-items:flex-start;padding:14px 0;${i < items.length - 1 ? "border-bottom:1px solid rgba(140,160,200,.12)" : ""}">
        <div style="font-size:18px;line-height:1.2;width:26px;text-align:center;flex-shrink:0">${it.emoji || "✨"}</div>
        <div style="flex:1;min-width:0">
          <div style="font-family:Georgia,serif;font-size:14px;font-weight:700;color:#e8c96d;margin-bottom:4px">${it.title}</div>
          <div style="font-size:12px;color:#a8b3c8;line-height:1.7">${it.description}</div>
        </div>
      </div>`
    )
    .join("");
  const unsub = `https://clvrquantai.com/api/unsubscribe?email=${encodeURIComponent(recipientEmail)}`;
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#080d18;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e8e0d0">
  <div style="max-width:620px;margin:0 auto;background:linear-gradient(180deg,#0a1020,#0c1424);border:1px solid rgba(201,168,76,.2);border-radius:10px;overflow:hidden">
    <div style="padding:24px 24px 8px;text-align:center;border-bottom:1px solid rgba(201,168,76,.18)">
      <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;letter-spacing:-.02em">CLVR<span style="color:#c9a84c">Quant</span><span style="color:#e8c96d">AI</span></div>
      <div style="font-family:monospace;font-size:9px;color:#c9a84c;letter-spacing:.3em;margin-top:4px">WHAT'S NEW THIS WEEK</div>
    </div>
    <div style="padding:22px 24px 8px;text-align:center">
      ${verBadge}
      <h1 style="font-family:Georgia,serif;font-size:22px;color:#e8e0d0;margin:14px 0 8px">${u.title}</h1>
      <p style="font-size:13px;color:#a8b3c8;line-height:1.7;margin:0 auto;max-width:480px">${u.summary}</p>
    </div>
    <div style="padding:8px 24px 24px">
      <div style="background:rgba(0,229,255,.04);border:1px solid rgba(0,229,255,.18);border-radius:8px;padding:8px 18px">
        ${itemHtml}
      </div>
    </div>
    <div style="padding:0 24px 24px;text-align:center">
      <a href="https://clvrquantai.com" style="display:inline-block;font-family:monospace;font-size:11px;letter-spacing:.18em;color:#080d18;background:#e8c96d;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:700">OPEN CLVRQUANT →</a>
    </div>
    <div style="padding:14px 24px 22px;border-top:1px solid rgba(140,160,200,.1);text-align:center">
      <div style="font-family:monospace;font-size:9px;color:#5a6a8a;letter-spacing:.1em;margin-bottom:6px">© 2026 CLVRQuant · Support@CLVRQuantAI.com</div>
      <a href="${unsub}" style="font-family:monospace;font-size:9px;color:#5a6a8a;text-decoration:underline">Unsubscribe</a>
    </div>
  </div>
</body></html>`;
}

// Returns {sent, total} or throws on Resend client failure.
export async function sendWeeklyUpdateNow(opts: {
  updateId?: number;            // if omitted, uses latest update
  ignoreFreshnessGate?: boolean; // if true, sends regardless of created_at age
} = {}): Promise<{ sent: number; total: number; updateId: number; alreadySent?: boolean }> {
  const u = opts.updateId
    ? (await pool.query(`SELECT * FROM weekly_updates WHERE id=$1`, [opts.updateId])).rows[0]
    : (await pool.query(`SELECT * FROM weekly_updates ORDER BY created_at DESC LIMIT 1`)).rows[0];
  if (!u) throw new Error("No weekly update found");
  if (u.email_sent_at && !opts.ignoreFreshnessGate) {
    return { sent: 0, total: 0, updateId: u.id, alreadySent: true };
  }
  // Freshness gate (skip in manual send): only auto-send if created in the last 7 days
  if (!opts.ignoreFreshnessGate) {
    const ageMs = Date.now() - new Date(u.created_at).getTime();
    if (ageMs > 8 * 24 * 60 * 60 * 1000) {
      console.log(`[weekly-update] latest update is ${(ageMs / 86400000).toFixed(1)}d old — skipping auto-send`);
      return { sent: 0, total: 0, updateId: u.id };
    }
  }

  const subsResult = await pool.query(
    `SELECT email FROM subscribers WHERE active=true ORDER BY created_at DESC`
  );
  const subs: { email: string }[] = subsResult.rows;
  if (subs.length === 0) {
    console.log("[weekly-update] no active subscribers");
    await pool.query(
      `UPDATE weekly_updates SET email_sent_at=NOW(), email_recipient_count=0 WHERE id=$1`,
      [u.id]
    );
    return { sent: 0, total: 0, updateId: u.id };
  }

  const updateRecord: WeeklyUpdate = {
    id: u.id,
    version: u.version,
    title: u.title,
    summary: u.summary,
    items: u.items,
    emailSentAt: u.email_sent_at,
    emailRecipientCount: u.email_recipient_count,
    createdBy: u.created_by,
    createdAt: u.created_at,
  };

  let sent = 0;
  try {
    const { client } = await getUncachableResendClient();
    for (let i = 0; i < subs.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 250));
      const sub = subs[i];
      try {
        const html = renderWeeklyUpdateEmail(updateRecord, sub.email);
        const resp = await client.emails.send({
          from: "CLVRQuant <hello@clvrquantai.com>",
          to: sub.email,
          replyTo: "noreply@clvrquantai.com",
          subject: `🆕 What's New on CLVRQuant — ${u.title}`,
          headers: {
            "List-Unsubscribe": `<https://clvrquantai.com/api/unsubscribe?email=${encodeURIComponent(sub.email)}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
          html,
        });
        if ((resp as any).error) throw new Error(JSON.stringify((resp as any).error));
        sent++;
      } catch (err: any) {
        console.log(`[weekly-update] failed for ${sub.email}:`, err?.message || err);
      }
    }
  } catch (e: any) {
    console.log("[weekly-update] resend client error:", e.message);
    throw e;
  }
  await pool.query(
    `UPDATE weekly_updates SET email_sent_at=NOW(), email_recipient_count=$1 WHERE id=$2`,
    [sent, u.id]
  );
  console.log(`[weekly-update] sent ${sent}/${subs.length} for update id=${u.id}`);
  return { sent, total: subs.length, updateId: u.id };
}

// Saturday 10:00 ET scheduler. Polled once per minute; we use a saw-tooth guard
// so we only fire inside the [10:00, 10:05) ET window each Saturday.
let lastFiredKey = "";
let schedulerStarted = false;
export function startWeeklyUpdateScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const tick = async () => {
    try {
      const et = nowInET();
      const isSaturday = et.getDay() === 6;
      const hour = et.getHours();
      const minute = et.getMinutes();
      if (!isSaturday || hour !== 10 || minute > 5) return;
      const key = `${et.getFullYear()}-${et.getMonth() + 1}-${et.getDate()}`;
      if (key === lastFiredKey) return;
      lastFiredKey = key;
      console.log("[weekly-update] Saturday 10:00 ET — auto-pipeline starting");

      // 1) Check whether a fresh (last 7 days) update already exists.
      //    If admin posted manually this week, respect that and skip AI generation.
      const latest = await getLatestWeeklyUpdate();
      const fresh = latest?.createdAt != null && (Date.now() - new Date(latest.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000);
      const alreadyEmailed = latest?.emailSentAt != null;

      if (!fresh || alreadyEmailed) {
        console.log(
          `[weekly-update] no fresh unsent update (fresh=${!!fresh}, alreadyEmailed=${!!alreadyEmailed}) — generating with AI`
        );
        const created = await generateWeeklyUpdateWithAI();
        if (!created) {
          console.log("[weekly-update] AI produced nothing user-visible — skipping send this week");
          return;
        }
      } else {
        console.log(`[weekly-update] using existing fresh update id=${latest!.id} (admin-posted this week)`);
      }

      // 2) Send to all active subscribers.
      const result = await sendWeeklyUpdateNow({});
      if (result.alreadySent) console.log("[weekly-update] latest update already emailed earlier — skipping");
      else if (result.total === 0) console.log("[weekly-update] nothing to send (no subscribers)");
      else console.log(`[weekly-update] auto-send complete: ${result.sent}/${result.total}`);
    } catch (e: any) {
      console.log("[weekly-update] scheduler error:", e?.message || e);
    }
  };
  setInterval(tick, 60_000);
  console.log("[weekly-update] Scheduler started — Saturdays at 10:00 AM ET (AI auto-generates from git commits if no fresh manual update, then emails)");
}

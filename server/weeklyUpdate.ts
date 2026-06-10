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
import { getCommitsViaOctokit } from "./githubClient";

const ET_TZ = "America/New_York";

// Repo we read commits from for the digest. The GitHub API works identically
// in dev and prod (unlike the old `git log` CLI, which is dead in Docker).
// Both can be overridden by env if the repo/branch ever moves.
const GITHUB_REPO = process.env.GITHUB_REPO || "Airwolf416/CLVRQuantAI";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

// Marketing + compliance constants for the subscriber-facing digest.
const TAGLINE = "Institutional Intelligence. Personal Edge.";
const COMPLIANCE_FOOTER = "Educational support only — not financial advice. DYOR.";

// Commit subjects that are internal-only and must never reach subscriber copy.
// Dropped BEFORE the AI sees them (defense in depth — the AI prompt also
// filters, and a compliance gate scrubs the final output). Only conventional
// internal TYPES (with a "(" or ":") and a tight keyword set match, so plain
// feature subjects like "Add IPO calendar" pass through untouched.
const INTERNAL_COMMIT_RE =
  /^(checkpoint|wip|merge|revert|bump|release)\b|^(fix|chore|refactor|test|tests|ci|build|perf|style|docs|deps|security|sec)(\(|:)|\b(bug ?fix|hotfix|regression|typo|lint|eslint|dockerfile|workflow|backfill)\b/i;

// Hard compliance violations that must never appear in published copy. Any
// bullet that matches is dropped; headline/summary matches are flagged loudly.
const COMPLIANCE_RULES: { re: RegExp; label: string }[] = [
  { re: /\d+(\.\d+)?\s?%/, label: "percentage figure" },
  { re: /\b\d+(\.\d+)?\s?x\b/i, label: "multiplier/return figure" },
  { re: /win[\s-]?rate/i, label: "win-rate language" },
  { re: /\b(guarantee[ds]?|proven|risk[\s-]?free|surefire|foolproof)\b/i, label: "performance guarantee" },
  { re: /\b(highest|best|top)[\s-]?(performing|returns?|roi|profit)/i, label: "superlative performance claim" },
  { re: /\b(buy|sell|long|short)\s+(now|today|this|these|the)\b/i, label: "trade recommendation" },
];

// Resolve the commit lookback window. Prefer "since the last published update"
// so we never repeat items week to week; fall back to `fallbackDays` ago when
// nothing has been published yet (or the lookup fails).
export async function resolveCommitSince(fallbackDays: number = 7): Promise<Date> {
  try {
    const latest = await getLatestWeeklyUpdate();
    if (latest?.createdAt) {
      const d = new Date(latest.createdAt as any);
      if (!isNaN(d.getTime())) return d;
    }
  } catch {
    // fall through to the day-based window
  }
  return new Date(Date.now() - fallbackDays * 24 * 60 * 60 * 1000);
}

// Drop internal-only commit subjects (bug fixes, refactors, CI/build, etc.)
// before the AI ever sees them. Manual log entries are NOT filtered here —
// they're owner-curated and already user-facing.
function filterPublicCommitSubjects(subjects: string[]): string[] {
  return subjects.filter((s) => s && !INTERNAL_COMMIT_RE.test(s.trim()));
}

// Read commit subjects from GitHub since `since`. De-duplicated, internal-noise
// filtered, capped at 60. Returns [] when the token is missing or the API fails
// — getCommitsViaOctokit emits the loud "[weeklyUpdate] commit fallback
// unavailable:" warning in that case, so the failure is never silent.
export async function getRecentCommitSubjects(since: Date): Promise<string[]> {
  const commits = await getCommitsViaOctokit(GITHUB_REPO, since, GITHUB_BRANCH);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of commits) {
    const s = (c.message || "").split("\n")[0].trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  const filtered = filterPublicCommitSubjects(out).slice(0, 60);
  console.log(
    `[weekly-update] GitHub API: ${commits.length} commits since ${since.toISOString().slice(0, 10)} → ${out.length} unique, ${filtered.length} user-facing`,
  );
  return filtered;
}

// Build the AI input list from curated log entries (PRIMARY) + commit subjects
// (FALLBACK). Manual entries always lead; commits only supplement.
function buildDigestInputs(
  pending: { headline: string; detail: string | null; emoji: string | null }[],
  commits: string[],
): { inputs: string[]; source: "log" | "commits" | "both" | "none" } {
  if (pending.length > 0 && commits.length > 0) {
    return {
      source: "both",
      inputs: [
        ...pending.map((p) => `[LOG${p.emoji ? " " + p.emoji : ""}] ${p.headline}${p.detail ? " — " + p.detail : ""}`),
        ...commits.map((c) => `[GIT] ${c}`),
      ],
    };
  }
  if (pending.length > 0) {
    return {
      source: "log",
      inputs: pending.map((p) => `${p.emoji ? p.emoji + " " : ""}${p.headline}${p.detail ? " — " + p.detail : ""}`),
    };
  }
  if (commits.length > 0) {
    return { source: "commits", inputs: commits };
  }
  return { source: "none", inputs: [] };
}

type DigestShape = {
  version: string;
  title: string;
  summary: string;
  items: { emoji: string; title: string; description: string }[];
};

// Defense-in-depth compliance gate. Drops any bullet containing a hard
// violation (percentages, win-rate, guarantees, trade calls) and records a
// flag. Headline/summary violations are flagged + logged loudly but kept (they
// are rare given the prompt) so the owner can see and fix them in preview.
export function enforceCompliance(digest: DigestShape): { digest: DigestShape; flags: string[] } {
  const flags: string[] = [];
  const check = (text: string): string | null => {
    for (const rule of COMPLIANCE_RULES) {
      if (rule.re.test(text || "")) return rule.label;
    }
    return null;
  };

  const headlineHit = check(digest.title);
  if (headlineHit) flags.push(`headline: ${headlineHit}`);
  const summaryHit = check(digest.summary);
  if (summaryHit) flags.push(`summary: ${summaryHit}`);

  const keptItems = digest.items.filter((it) => {
    const hit = check(`${it.title} ${it.description}`);
    if (hit) {
      flags.push(`dropped bullet "${it.title}": ${hit}`);
      return false;
    }
    return true;
  });

  if (flags.length > 0) {
    console.warn(`[weeklyUpdate] compliance gate flagged ${flags.length} issue(s): ${flags.join("; ")}`);
  }
  return { digest: { ...digest, items: keptItems }, flags };
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

// Safety-net cleanup: stamps EVERY still-pending update_log_entries row as
// shipped under the given update id. Used after a successful send (manual or
// scheduled) so the buffer is empty for next week regardless of which path
// generated the update — the AI flow already stamps the rows it consumed,
// this catches anything that slipped through (manual editor publishes, entries
// added between generate-and-send, etc.). Idempotent and fail-soft.
export async function sweepPendingLogEntries(updateId: number): Promise<number> {
  try {
    const r = await pool.query(
      `UPDATE update_log_entries
          SET included_in_update_id=$1
        WHERE included_in_update_id IS NULL
        RETURNING id`,
      [updateId]
    );
    const n = r.rowCount || 0;
    if (n > 0) console.log(`[weekly-update] sweepPendingLogEntries: stamped ${n} pending entries under update id=${updateId}`);
    return n;
  } catch (e: any) {
    console.log("[weekly-update] sweepPendingLogEntries failed:", e?.message || e);
    return 0;
  }
}

// Ask Claude to turn the raw change log into a compliant, subscriber-ready
// "What's New" digest. Uses the existing Anthropic endpoint (no new provider).
export async function synthesizeWeeklyUpdateFromCommits(
  inputs: string[],
): Promise<DigestShape | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[weeklyUpdate] ANTHROPIC_API_KEY not set — cannot generate digest");
    return null;
  }
  if (inputs.length === 0) {
    console.log("[weekly-update] no inputs to summarize");
    return null;
  }

  const weekLabel = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: ET_TZ });
  const prompt = `You are the product-marketing editor for CLVRQuantAI — a luxury, mobile-first market-intelligence dashboard for crypto, equities, commodities, and forex traders. Brand voice: confident, concise, terminal-clean. Tagline: "${TAGLINE}".

Turn the raw change log below (week of ${weekLabel}) into a subscriber-ready "What's New This Week" email. The audience is paying SUBSCRIBERS, not developers.

WRITE each kept item as a benefit-led feature note describing what the user can now SEE or DO. Example:
  raw:  "add IPO rows to earnings radar endpoint"
  good: "AI Earnings Radar now covers IPOs — spot scheduled listings before they price."

EXCLUDE entirely (never mention, even indirectly): internal refactors, bug fixes, error/crash fixes, security patches, build/CI/deploy/infra changes, schema/migration/database plumbing, tests, dependency bumps, and anything about position sizing, leverage math, or secrets/keys. Keep ONLY genuinely user-visible features and improvements.

COMPLIANCE — NON-NEGOTIABLE. Applies to the headline, the summary, and EVERY bullet:
- NO win-rate, accuracy, or hit-rate language.
- NO return figures, profit figures, or percentages of any kind (no "%", no "Nx returns").
- NO performance guarantees or superlatives ("guaranteed", "proven", "highest", "best-performing", "risk-free").
- NO trade recommendations or calls to buy/sell/long/short anything.
- Tone is strictly EDUCATIONAL — describe tools and information, never advice or outcomes.

Return ONLY valid JSON (no markdown fence), exactly this shape:
{
  "version": "<short label, e.g. 'Week of ${weekLabel}'>",
  "title": "<headline, max 8 words, benefit-led, compliance-safe>",
  "summary": "<1-2 sentences, max 240 chars, compliance-safe>",
  "items": [
    { "emoji": "<single emoji>", "title": "<short feature title, max 60 chars>", "description": "<1-2 sentence benefit, max 240 chars>" }
  ]
}

Rules:
- 3 to 7 items. Pick only the most user-visible improvements; group related changes.
- If, after the exclusions above, nothing is genuinely user-visible, return exactly: {"version":"","title":"","summary":"","items":[]}
- Never pad with filler to reach 3. Fewer real items beats invented ones.
- Suggested emojis: 📊 data, ⚡ speed, 🤖 AI, 🔔 alerts, 📓 journal, 🛡️ reliability, 💎 polish, 🪙 commodities, 📈 markets, 🗓️ calendar.

Change log:
${inputs.map((c) => "- " + c).join("\n")}`;

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
      console.warn("[weeklyUpdate] Claude error", r.status, (await r.text()).slice(0, 200));
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
    return {
      version: String(parsed.version || ""),
      title: String(parsed.title),
      summary: String(parsed.summary || ""),
      items: parsed.items.map((it: any) => ({
        emoji: String(it.emoji || "✨"),
        title: String(it.title || ""),
        description: String(it.description || ""),
      })),
    };
  } catch (e: any) {
    console.warn("[weeklyUpdate] synthesize error:", e?.message || e);
    return null;
  }
}

// Auto-generate this week's update via Claude, then insert it.
// Source priority: curated update_log_entries (the owner's own log) FIRST,
// GitHub commit subjects only as a fallback/supplement. Returns the new update,
// or null (and a loud "nothing user-visible" log) when there's nothing to ship.
export async function generateWeeklyUpdateWithAI(): Promise<WeeklyUpdate | null> {
  const pending = await getPendingUpdateLogEntries();
  const since = await resolveCommitSince(7);
  const commits = await getRecentCommitSubjects(since);
  console.log(`[weekly-update] AI generation: ${pending.length} pending log entries + ${commits.length} user-facing commits since ${since.toISOString().slice(0, 10)}`);

  const { inputs, source } = buildDigestInputs(pending, commits);
  if (inputs.length === 0) {
    console.log("[weeklyUpdate] nothing user-visible this week — skipped.");
    return null;
  }

  const raw = await synthesizeWeeklyUpdateFromCommits(inputs);
  if (!raw) {
    console.log("[weeklyUpdate] nothing user-visible this week — skipped.");
    return null;
  }

  const { digest, flags } = enforceCompliance(raw);
  if (digest.items.length === 0) {
    console.log("[weeklyUpdate] nothing user-visible this week — skipped.");
    return null;
  }
  // Headline/summary compliance is non-negotiable. Violating bullets are
  // silently dropped above, but a non-compliant headline/summary cannot be
  // auto-fixed — BLOCK the unattended publish rather than email it. The admin
  // preview still renders it (flagged) so the owner can edit the log and re-run.
  const headerFlags = flags.filter((f) => f.startsWith("headline:") || f.startsWith("summary:"));
  if (headerFlags.length > 0) {
    console.warn(`[weeklyUpdate] BLOCKED publish — non-compliant headline/summary: ${headerFlags.join("; ")}`);
    return null;
  }
  if (flags.length > 0) {
    console.warn(`[weeklyUpdate] published digest dropped ${flags.length} non-compliant bullet(s): ${flags.join("; ")}`);
  }

  const created = await createWeeklyUpdate({
    version: digest.version || null,
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

// Read-only dry run of the FULL pipeline: resolve window → fetch commits →
// filter → merge with the manual log → AI rewrite → compliance gate → render
// the email. Writes NOTHING and sends NOTHING. Backs the admin "PREVIEW AI
// DIGEST" button and the offline preview script. When `sinceDays` is given it
// overrides the lookback window (the button mirrors publish by omitting it).
export async function buildWeeklyUpdatePreview(
  opts: { sinceDays?: number } = {},
): Promise<{
  ok: boolean;
  source: "log" | "commits" | "both" | "none";
  since: string;
  pendingCount: number;
  pendingEntries: { headline: string; emoji: string | null }[];
  commitCount: number;
  commits: string[];
  digest: DigestShape | null;
  complianceFlags: string[];
  emailHtml: string | null;
  skipped: boolean;
  skipReason: string | null;
}> {
  const pending = await getPendingUpdateLogEntries();
  const since = opts.sinceDays != null
    ? new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000)
    : await resolveCommitSince(7);
  const commits = await getRecentCommitSubjects(since);
  const { inputs, source } = buildDigestInputs(pending, commits);

  const base = {
    ok: true,
    source,
    since: since.toISOString(),
    pendingCount: pending.length,
    pendingEntries: pending.map((p) => ({ headline: p.headline, emoji: p.emoji })),
    commitCount: commits.length,
    commits: commits.slice(0, 40),
  };

  if (inputs.length === 0) {
    return { ...base, digest: null, complianceFlags: [], emailHtml: null, skipped: true, skipReason: "nothing user-visible this week" };
  }

  const raw = await synthesizeWeeklyUpdateFromCommits(inputs);
  if (!raw) {
    return { ...base, digest: null, complianceFlags: [], emailHtml: null, skipped: true, skipReason: "AI returned nothing user-visible" };
  }

  const { digest, flags } = enforceCompliance(raw);
  if (digest.items.length === 0) {
    return { ...base, digest: null, complianceFlags: flags, emailHtml: null, skipped: true, skipReason: "all items dropped by compliance gate" };
  }

  const previewRecord = {
    id: 0,
    version: digest.version || null,
    title: digest.title,
    summary: digest.summary,
    items: digest.items as any,
    emailSentAt: null,
    emailRecipientCount: 0,
    createdBy: "preview",
    createdAt: new Date(),
  } as WeeklyUpdate;
  const emailHtml = renderWeeklyUpdateEmail(previewRecord, "preview@clvrquantai.com");

  return { ...base, digest, complianceFlags: flags, emailHtml, skipped: false, skipReason: null };
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
      <div style="font-family:Georgia,serif;font-size:10px;color:#c9a84c;letter-spacing:.06em;margin-bottom:8px;font-style:italic">${TAGLINE}</div>
      <div style="font-family:monospace;font-size:9px;color:#8a96b0;letter-spacing:.04em;margin-bottom:8px;line-height:1.5">${COMPLIANCE_FOOTER}</div>
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
} = {}): Promise<{ sent: number; total: number; updateId: number; alreadySent?: boolean; swept?: number }> {
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
  // Auto-clean: sweep any still-pending update_log_entries into this update so
  // they don't repeat next week. Safe even when the AI flow already stamped
  // its consumed rows — this only touches whatever's still NULL.
  const cleaned = await sweepPendingLogEntries(u.id);
  console.log(`[weekly-update] sent ${sent}/${subs.length} for update id=${u.id}${cleaned ? ` (+swept ${cleaned} pending log entries)` : ""}`);
  return { sent, total: subs.length, updateId: u.id, swept: cleaned };
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

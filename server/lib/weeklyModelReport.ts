// ─────────────────────────────────────────────────────────────────────────────
// Module 3 T06 — Weekly model report (Phase A: build + render only)
//
// Runs Sunday 22:00 ET when PTA_WEEKLY_REPORT_ENABLED is true. Pulls
//   1. archetype_scorecard MV (per-archetype trailing-50 stats)
//   2. model_adjustments (empty in Phase A — Phase B writes there)
//   3. 7d vs prior-7d net WR delta from ai_signal_log
// Returns a plain-data report object; HTML + markdown renderers are pure
// functions so the same report can feed both an email send and the
// /api/reports/weekly-model endpoint.
//
// Email path uses the existing Resend wrapper when configured; if not it
// silently no-ops. We never block the scheduler tick on a send failure.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from "drizzle-orm";
import { db } from "../db";
import { ptaWeeklyReportEnabled } from "./featureFlags";

export interface PerArchetypeRow {
  archetype: string;
  volRegime: string | null;
  trailingN: number;
  effectiveWinRate: number | null;
  topTags: string[];
  medianR: number | null;
}

export interface ModelAdjustmentRow {
  archetype: string;
  parameterName: string;
  oldValue: any;
  newValue: any;
  triggerReason: string;
  source: string;
  adjustedAt: string;
}

export interface WeeklyReport {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  perArchetype: PerArchetypeRow[];
  adjustments: ModelAdjustmentRow[];
  netWrChangePp: number | null;
  totalResolvedLast7d: number;
  totalResolvedPrior7d: number;
  pausedArchetypes: string[];
}

let _lastReport: WeeklyReport | null = null;
let _lastBuildAt = 0;

export function getLastReport(): WeeklyReport | null {
  return _lastReport;
}

async function fetchPerArchetype(): Promise<PerArchetypeRow[]> {
  try {
    const r: any = await db.execute(sql`
      SELECT archetype, vol_regime, trailing_n, effective_win_rate,
             top_tags, median_r
      FROM archetype_scorecard
      ORDER BY archetype, vol_regime NULLS FIRST
    `);
    const rows = (r?.rows || r || []) as any[];
    return rows.map((x: any) => ({
      archetype: String(x.archetype || "UNCLASSIFIED"),
      volRegime: x.vol_regime ?? null,
      trailingN: Number(x.trailing_n || 0),
      effectiveWinRate: x.effective_win_rate != null ? Number(x.effective_win_rate) : null,
      topTags: Array.isArray(x.top_tags) ? x.top_tags.slice(0, 3) : [],
      medianR: x.median_r != null ? Number(x.median_r) : null,
    }));
  } catch (err: any) {
    console.warn("[weeklyReport] scorecard read failed:", err?.message);
    return [];
  }
}

async function fetchRecentAdjustments(sinceDays = 7): Promise<ModelAdjustmentRow[]> {
  try {
    const r: any = await db.execute(sql`
      SELECT archetype, parameter_name, old_value, new_value, trigger_reason,
             source, adjusted_at
      FROM model_adjustments
      WHERE adjusted_at >= NOW() - (${sinceDays} || ' days')::interval
      ORDER BY adjusted_at DESC
      LIMIT 100
    `);
    const rows = (r?.rows || r || []) as any[];
    return rows.map((x: any) => ({
      archetype: String(x.archetype || ""),
      parameterName: String(x.parameter_name || ""),
      oldValue: x.old_value,
      newValue: x.new_value,
      triggerReason: String(x.trigger_reason || ""),
      source: String(x.source || "organic"),
      adjustedAt: x.adjusted_at instanceof Date ? x.adjusted_at.toISOString() : String(x.adjusted_at || ""),
    }));
  } catch (err: any) {
    console.warn("[weeklyReport] adjustments read failed:", err?.message);
    return [];
  }
}

async function fetchWindowWr(daysAgo: number, windowDays: number): Promise<{ wr: number | null; n: number }> {
  try {
    const r: any = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (
          WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','EXPIRED_WIN')
        )::FLOAT AS wins,
        COUNT(*)::FLOAT AS n
      FROM ai_signal_log
      WHERE outcome IS NOT NULL
        AND outcome <> 'PENDING'
        AND resolved_at >= NOW() - (${daysAgo + windowDays} || ' days')::interval
        AND resolved_at <  NOW() - (${daysAgo} || ' days')::interval
    `);
    const row = (r?.rows || r || [])[0] || {};
    const n = Number(row.n || 0);
    const wins = Number(row.wins || 0);
    if (n === 0) return { wr: null, n: 0 };
    return { wr: (wins / n) * 100, n };
  } catch (err: any) {
    console.warn("[weeklyReport] window WR read failed:", err?.message);
    return { wr: null, n: 0 };
  }
}

export async function buildReport(): Promise<WeeklyReport> {
  const generatedAt = new Date();
  const windowEnd = new Date(generatedAt);
  const windowStart = new Date(generatedAt.getTime() - 7 * 24 * 3600 * 1000);

  const [perArchetype, adjustments, last7d, prior7d] = await Promise.all([
    fetchPerArchetype(),
    fetchRecentAdjustments(7),
    fetchWindowWr(0, 7),
    fetchWindowWr(7, 7),
  ]);

  const netWrChangePp =
    last7d.wr != null && prior7d.wr != null
      ? +(last7d.wr - prior7d.wr).toFixed(2)
      : null;

  // Phase A: pausedArchetypes is always empty (no auto-adjust). Phase B
  // populates this from model_adjustments where parameter_name='paused'.
  const pausedArchetypes: string[] = adjustments
    .filter((a) => a.parameterName === "paused" && a.newValue === true)
    .map((a) => a.archetype);

  const report: WeeklyReport = {
    generatedAt: generatedAt.toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    perArchetype,
    adjustments,
    netWrChangePp,
    totalResolvedLast7d: last7d.n,
    totalResolvedPrior7d: prior7d.n,
    pausedArchetypes,
  };
  _lastReport = report;
  _lastBuildAt = Date.now();
  return report;
}

export function formatMarkdown(r: WeeklyReport): string {
  const lines: string[] = [];
  lines.push(`# CLVRQuantAI — Weekly Model Report`);
  lines.push(``);
  lines.push(`Generated: ${r.generatedAt}`);
  lines.push(`Window: ${r.windowStart} → ${r.windowEnd}`);
  lines.push(``);
  lines.push(`## Headline`);
  lines.push(`- Resolved signals (last 7d): **${r.totalResolvedLast7d}** (prior 7d: ${r.totalResolvedPrior7d})`);
  lines.push(
    `- Net WR change vs prior week: ${r.netWrChangePp != null ? `${r.netWrChangePp >= 0 ? "+" : ""}${r.netWrChangePp}pp` : "n/a"}`,
  );
  lines.push(`- Adjustments applied: ${r.adjustments.length} (Phase A — expected 0)`);
  lines.push(`- Paused archetypes: ${r.pausedArchetypes.length ? r.pausedArchetypes.join(", ") : "none"}`);
  lines.push(``);
  lines.push(`## Per-Archetype Scorecard (trailing 50)`);
  if (!r.perArchetype.length) {
    lines.push(`_No scorecard rows yet — wait for the MV to populate._`);
  } else {
    lines.push(`| Archetype | Vol Regime | N | Eff WR | Median R | Top Diagnoses |`);
    lines.push(`|---|---|---:|---:|---:|---|`);
    for (const row of r.perArchetype) {
      const wr = row.effectiveWinRate != null ? `${row.effectiveWinRate.toFixed(1)}%` : "—";
      const med = row.medianR != null ? row.medianR.toFixed(2) : "—";
      lines.push(`| ${row.archetype} | ${row.volRegime || "—"} | ${row.trailingN} | ${wr} | ${med} | ${row.topTags.join(", ") || "—"} |`);
    }
  }
  lines.push(``);
  lines.push(`## Recent Adjustments`);
  if (!r.adjustments.length) {
    lines.push(`_None this week (Phase B not active)._`);
  } else {
    for (const a of r.adjustments) {
      lines.push(`- **${a.archetype}** \`${a.parameterName}\` ${JSON.stringify(a.oldValue)} → ${JSON.stringify(a.newValue)} — ${a.triggerReason} (${a.source})`);
    }
  }
  return lines.join("\n");
}

export function formatHtmlEmail(r: WeeklyReport): string {
  const esc = (s: any) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" } as any)[c]);
  const rowsHtml = r.perArchetype.length
    ? r.perArchetype
        .map(
          (row) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #1a2030;">${esc(row.archetype)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #1a2030;">${esc(row.volRegime || "—")}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #1a2030;text-align:right;">${row.trailingN}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #1a2030;text-align:right;">${row.effectiveWinRate != null ? row.effectiveWinRate.toFixed(1) + "%" : "—"}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #1a2030;text-align:right;">${row.medianR != null ? row.medianR.toFixed(2) : "—"}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #1a2030;color:#b0b8c8;">${esc(row.topTags.join(", ") || "—")}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="6" style="padding:10px;color:#8892a6;">No scorecard rows yet.</td></tr>`;

  const netWr =
    r.netWrChangePp != null
      ? `${r.netWrChangePp >= 0 ? "+" : ""}${r.netWrChangePp}pp`
      : "n/a";

  return `<!DOCTYPE html><html><body style="background:#0b0f17;color:#e7e9ee;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:0;padding:24px;">
  <div style="max-width:720px;margin:0 auto;">
    <h1 style="color:#d4af37;font-family:Georgia,serif;margin:0 0 6px 0;">Weekly Model Report</h1>
    <div style="color:#8892a6;font-size:12px;margin-bottom:16px;">${esc(r.windowStart)} → ${esc(r.windowEnd)}</div>
    <div style="background:#11161f;border:1px solid #1a2030;border-radius:8px;padding:16px;margin-bottom:18px;">
      <div><strong>Resolved (last 7d):</strong> ${r.totalResolvedLast7d} <span style="color:#8892a6;">(prior 7d: ${r.totalResolvedPrior7d})</span></div>
      <div><strong>Net WR change:</strong> ${esc(netWr)}</div>
      <div><strong>Adjustments:</strong> ${r.adjustments.length} <span style="color:#8892a6;">(Phase A — expected 0)</span></div>
      <div><strong>Paused archetypes:</strong> ${r.pausedArchetypes.length ? esc(r.pausedArchetypes.join(", ")) : "<span style='color:#8892a6;'>none</span>"}</div>
    </div>
    <h2 style="color:#d4af37;font-family:Georgia,serif;font-size:16px;margin:18px 0 8px 0;">Per-Archetype (trailing 50)</h2>
    <table style="width:100%;border-collapse:collapse;background:#11161f;border:1px solid #1a2030;border-radius:8px;overflow:hidden;font-size:13px;">
      <thead><tr style="background:#0e1320;color:#8892a6;text-align:left;">
        <th style="padding:8px 10px;">Archetype</th>
        <th style="padding:8px 10px;">Vol</th>
        <th style="padding:8px 10px;text-align:right;">N</th>
        <th style="padding:8px 10px;text-align:right;">Eff WR</th>
        <th style="padding:8px 10px;text-align:right;">Med R</th>
        <th style="padding:8px 10px;">Top Diagnoses</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div></body></html>`;
}

// ── Scheduler ────────────────────────────────────────────────────────────────
// Sunday 22:00 America/New_York. Uses a 1-min tick + dedupe key (yyyy-mm-dd)
// so a restart inside the firing minute can't double-send. Mirrors the
// weeklyUpdate.ts pattern intentionally — different concerns, same shape.

let _schedulerStarted = false;
let _lastFireDateKey = "";

function nowInNyParts(): { dow: number; hour: number; minute: number; dateKey: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = weekdayMap[get("weekday")] ?? -1;
  const hour = parseInt(get("hour"), 10);
  const minute = parseInt(get("minute"), 10);
  const dateKey = `${get("year")}-${get("month")}-${get("day")}`;
  return { dow, hour, minute, dateKey };
}

async function fireOnce(): Promise<void> {
  try {
    const report = await buildReport();
    console.log(
      `[weeklyModelReport] built — ${report.perArchetype.length} archetype rows, ${report.adjustments.length} adjustments, netWrΔ=${report.netWrChangePp ?? "n/a"}pp`,
    );
    // Email is best-effort — only attempt when Resend is configured AND we
    // have a recipient list env. Keeping this minimal in Phase A so we don't
    // accidentally spam Elite before the report is proven.
    if (process.env.RESEND_API_KEY && process.env.WEEKLY_MODEL_REPORT_RECIPIENTS) {
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        const recipients = process.env.WEEKLY_MODEL_REPORT_RECIPIENTS.split(",").map((x) => x.trim()).filter(Boolean);
        if (recipients.length) {
          await resend.emails.send({
            from: process.env.RESEND_FROM || "CLVRQuantAI <no-reply@clvrquant.ai>",
            to: recipients,
            subject: `CLVRQuantAI — Weekly Model Report (${report.windowStart.slice(0, 10)})`,
            html: formatHtmlEmail(report),
          });
          console.log(`[weeklyModelReport] email sent to ${recipients.length} recipient(s)`);
        }
      } catch (err: any) {
        console.warn("[weeklyModelReport] email send failed:", err?.message);
      }
    }
  } catch (err: any) {
    console.error("[weeklyModelReport] build failed:", err?.message);
  }
}

export function startWeeklyModelReportScheduler(): void {
  if (_schedulerStarted) return;
  _schedulerStarted = true;
  console.log("[weeklyModelReport] scheduler started (Sun 22:00 ET, gated by PTA_WEEKLY_REPORT_ENABLED)");
  const tick = async () => {
    try {
      if (!ptaWeeklyReportEnabled()) return;
      const { dow, hour, minute, dateKey } = nowInNyParts();
      if (dow !== 0) return; // Sunday
      if (hour !== 22 || minute !== 0) return;
      if (_lastFireDateKey === dateKey) return; // already fired today
      _lastFireDateKey = dateKey;
      await fireOnce();
    } catch (err: any) {
      console.error("[weeklyModelReport] tick failed:", err?.message);
    }
  };
  const handle = setInterval(tick, 60 * 1000);
  if (typeof handle.unref === "function") handle.unref();
}

/** Admin one-shot, returns the freshly built report. */
export async function generateNow(): Promise<WeeklyReport> {
  await fireOnce();
  return _lastReport!;
}

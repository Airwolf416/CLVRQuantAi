// ============================================================================
// chartRenderer — server-side candlestick chart → PNG, for Claude vision input.
//
// Renders an SVG candlestick chart with:
//   - 48 OHLC candles (1h timeframe)
//   - EMA20 + EMA50 overlay lines
//   - Nearest support / resistance horizontal lines (optional)
//   - Entry zone shaded band (optional)
//   - Compact axes, no chart junk — designed for AI consumption
//
// SVG is converted to PNG via `sharp` (already in deps; no native canvas
// requirement). Returns base64-encoded PNG ready to embed in Claude's vision
// content block.
//
// Designed to fail open: any rendering error returns null and the caller
// continues without a chart.
// ============================================================================

import sharp from "sharp";
import type { Candle } from "../services/ta";

const WIDTH  = 1200;
const HEIGHT = 700;
const PADDING_LEFT   = 70;
const PADDING_RIGHT  = 90;
const PADDING_TOP    = 50;
const PADDING_BOTTOM = 50;

export interface RenderOptions {
  token: string;
  direction?: "LONG" | "SHORT";
  candles: Candle[];           // oldest -> newest
  ema20?: number[];            // aligned to candles, may have NaN at the start
  ema50?: number[];
  support?: number;
  resistance?: number;
  entryZone?: { low: number; high: number };  // shaded entry band
  stopLoss?: number;
  tp1?: number;
  tp2?: number;
  timeframeLabel?: string;     // e.g. "1h"
}

export async function renderChartPng(opts: RenderOptions): Promise<string | null> {
  try {
    const svg = buildSvg(opts);
    const buf = await sharp(Buffer.from(svg))
      .png({ compressionLevel: 9 })
      .toBuffer();
    return buf.toString("base64");
  } catch (err: any) {
    console.warn("[chartRenderer] render failed:", err.message);
    return null;
  }
}

function buildSvg(opts: RenderOptions): string {
  const { candles, token, direction, ema20, ema50, support, resistance, entryZone, stopLoss, tp1, tp2, timeframeLabel } = opts;
  if (!candles || candles.length === 0) throw new Error("no candles");

  // Compute Y-axis bounds with padding for overlays
  const allHighs = candles.map(c => c.h);
  const allLows  = candles.map(c => c.l);
  const extras: number[] = [];
  if (Number.isFinite(support))    extras.push(support!);
  if (Number.isFinite(resistance)) extras.push(resistance!);
  if (entryZone) { extras.push(entryZone.low, entryZone.high); }
  if (Number.isFinite(stopLoss))   extras.push(stopLoss!);
  if (Number.isFinite(tp1))        extras.push(tp1!);
  if (Number.isFinite(tp2))        extras.push(tp2!);

  let yMax = Math.max(...allHighs, ...extras);
  let yMin = Math.min(...allLows,  ...extras);
  const span = yMax - yMin;
  if (span <= 0) { yMax += 1; yMin -= 1; }
  // pad 4% top/bottom for breathing room
  yMax += span * 0.04;
  yMin -= span * 0.04;

  const plotW = WIDTH  - PADDING_LEFT - PADDING_RIGHT;
  const plotH = HEIGHT - PADDING_TOP  - PADDING_BOTTOM;

  const xFor = (i: number) => PADDING_LEFT + (i + 0.5) * (plotW / candles.length);
  const yFor = (price: number) => PADDING_TOP + plotH - ((price - yMin) / (yMax - yMin)) * plotH;

  const candleW = Math.max(2, (plotW / candles.length) * 0.6);

  // Background
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">`);
  parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="#0b1020"/>`);

  // Title
  const dirLabel = direction ? `  ${direction}` : "";
  const tfLabel  = timeframeLabel ? `  ·  ${timeframeLabel}` : "";
  parts.push(`<text x="${PADDING_LEFT}" y="28" fill="#e6edf3" font-size="18" font-weight="700">${escapeXml(token)}${dirLabel}${tfLabel}  ·  last ${candles.length} bars</text>`);

  // Y-axis grid lines (5 horizontal)
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    const price = yMax - (yMax - yMin) * t;
    const y = PADDING_TOP + plotH * t;
    parts.push(`<line x1="${PADDING_LEFT}" y1="${y}" x2="${WIDTH - PADDING_RIGHT}" y2="${y}" stroke="#1c2740" stroke-width="1"/>`);
    parts.push(`<text x="${WIDTH - PADDING_RIGHT + 6}" y="${y + 4}" fill="#7a8aa8" font-size="11">${formatPrice(price)}</text>`);
  }

  // Entry zone (shaded band) — drawn under candles
  if (entryZone && Number.isFinite(entryZone.low) && Number.isFinite(entryZone.high)) {
    const yHigh = yFor(entryZone.high);
    const yLow  = yFor(entryZone.low);
    const top    = Math.min(yHigh, yLow);
    const height = Math.abs(yHigh - yLow);
    parts.push(`<rect x="${PADDING_LEFT}" y="${top}" width="${plotW}" height="${height}" fill="#3b82f6" fill-opacity="0.12"/>`);
    parts.push(`<text x="${WIDTH - PADDING_RIGHT - 4}" y="${top - 4}" fill="#60a5fa" font-size="11" text-anchor="end">ENTRY</text>`);
  }

  // Candles
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const cx = xFor(i);
    const yO = yFor(c.o);
    const yC = yFor(c.c);
    const yH = yFor(c.h);
    const yL = yFor(c.l);
    const isUp = c.c >= c.o;
    const color = isUp ? "#22c55e" : "#ef4444";
    // wick
    parts.push(`<line x1="${cx}" y1="${yH}" x2="${cx}" y2="${yL}" stroke="${color}" stroke-width="1"/>`);
    // body
    const bodyY = Math.min(yO, yC);
    const bodyH = Math.max(1, Math.abs(yC - yO));
    parts.push(`<rect x="${cx - candleW/2}" y="${bodyY}" width="${candleW}" height="${bodyH}" fill="${color}"/>`);
  }

  // EMA lines
  if (ema20 && ema20.length === candles.length) {
    parts.push(buildPolyline(ema20, candles.length, xFor, yFor, "#facc15", 1.5, "EMA20"));
  }
  if (ema50 && ema50.length === candles.length) {
    parts.push(buildPolyline(ema50, candles.length, xFor, yFor, "#a855f7", 1.5, "EMA50"));
  }

  // Support / Resistance / SL / TP lines
  const drawHLine = (price: number | undefined, color: string, label: string, dash = false) => {
    if (price == null || !Number.isFinite(price)) return;
    const y = yFor(price);
    parts.push(`<line x1="${PADDING_LEFT}" y1="${y}" x2="${WIDTH - PADDING_RIGHT}" y2="${y}" stroke="${color}" stroke-width="1.5" ${dash ? 'stroke-dasharray="6,4"' : ''}/>`);
    parts.push(`<text x="${WIDTH - PADDING_RIGHT - 4}" y="${y - 4}" fill="${color}" font-size="11" text-anchor="end">${label} ${formatPrice(price)}</text>`);
  };
  drawHLine(resistance, "#fb923c", "R");
  drawHLine(support,    "#38bdf8", "S");
  drawHLine(stopLoss,   "#ef4444", "SL", true);
  drawHLine(tp1,        "#22c55e", "TP1", true);
  drawHLine(tp2,        "#16a34a", "TP2", true);

  // X-axis: a few time markers (just bar indices to keep it simple)
  for (let i = 0; i < candles.length; i += Math.max(1, Math.floor(candles.length / 6))) {
    const x = xFor(i);
    parts.push(`<text x="${x}" y="${HEIGHT - 18}" fill="#7a8aa8" font-size="10" text-anchor="middle">-${candles.length - 1 - i}h</text>`);
  }

  // Legend (top-right)
  const legendItems: Array<[string, string]> = [];
  if (ema20) legendItems.push(["EMA20", "#facc15"]);
  if (ema50) legendItems.push(["EMA50", "#a855f7"]);
  // Legend rendered in second header row (y=48), well clear of the title at y=28.
  let lx = PADDING_LEFT;
  for (const [label, color] of legendItems) {
    parts.push(`<line x1="${lx}" y1="48" x2="${lx + 18}" y2="48" stroke="${color}" stroke-width="2"/>`);
    parts.push(`<text x="${lx + 24}" y="52" fill="#cbd5e1" font-size="11">${label}</text>`);
    lx += 70;
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}

function buildPolyline(
  values: number[],
  n: number,
  xFor: (i: number) => number,
  yFor: (p: number) => number,
  color: string,
  width: number,
  _label: string,
): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    pts.push(`${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`);
  }
  if (pts.length < 2) return "";
  return `<polyline fill="none" stroke="${color}" stroke-width="${width}" points="${pts.join(" ")}"/>`;
}

function formatPrice(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (Math.abs(p) >= 1000)  return p.toFixed(0);
  if (Math.abs(p) >= 10)    return p.toFixed(2);
  if (Math.abs(p) >= 1)     return p.toFixed(3);
  if (Math.abs(p) >= 0.01)  return p.toFixed(4);
  return p.toFixed(6);
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
}

// Helper: compute simple EMA over a candle close series (for callers that
// don't already have one).
export function computeEmaSeries(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period) return out;
  // seed with SMA of first `period`
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  out[period - 1] = sum / period;
  for (let i = period; i < closes.length; i++) {
    out[i] = closes[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

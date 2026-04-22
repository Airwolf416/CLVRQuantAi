import { useState, useRef, useCallback, useEffect } from "react";
import {
  ScanLine, Upload, X, Zap, Clock, TrendingUp, Calendar,
  Info, Share2, RotateCcw, AlertTriangle, Camera,
} from "lucide-react";

const HORIZONS = [
  { id: "scalp",    label: "Scalp",    sub: "1–15m",         Icon: Zap },
  { id: "intraday", label: "Intraday", sub: "hours",         Icon: Clock },
  { id: "swing",    label: "Swing",    sub: "days–weeks",    Icon: TrendingUp },
  { id: "position", label: "Position", sub: "weeks–months",  Icon: Calendar },
];

const LOADING_MESSAGES = [
  "Reading chart…",
  "Identifying levels…",
  "Checking news…",
  "Calibrating for {horizon}…",
];

const ACCENT = "#9b59ff";       // purple
const ACCENT_DIM = "rgba(155,89,255,0.12)";
const ACCENT_BORDER = "rgba(155,89,255,0.4)";

function fmtPrice(n) {
  if (n == null || isNaN(n)) return "—";
  const num = Number(n);
  if (Math.abs(num) >= 1000) return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(num) >= 1)    return num.toFixed(2);
  return num.toPrecision(4);
}

export default function ChartAITab({ C, MONO, SERIF, SANS, isMobile }) {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [horizon, setHorizon] = useState("intraday");
  const [asset, setAsset] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingIdx, setLoadingIdx] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [usage, setUsage] = useState({ used_today: 0, remaining_today: 5, daily_limit: 5, resets_at: null });
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  // ── Usage counter ─────────────────────────────────────────────────────────
  const refreshUsage = useCallback(async () => {
    try {
      const r = await fetch("/api/chart-ai/usage", { credentials: "include" });
      if (r.ok) setUsage(await r.json());
    } catch {}
  }, []);
  useEffect(() => { refreshUsage(); }, [refreshUsage]);

  // ── Loading-text rotator ──────────────────────────────────────────────────
  useEffect(() => {
    if (!loading) return;
    setLoadingIdx(0);
    const t = setInterval(() => setLoadingIdx(i => (i + 1) % LOADING_MESSAGES.length), 1700);
    return () => clearInterval(t);
  }, [loading]);

  // ── File handling ─────────────────────────────────────────────────────────
  const acceptFile = useCallback((f) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { setError("Image must be ≤ 5 MB"); return; }
    if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) {
      setError("Only PNG, JPG, or WebP are supported"); return;
    }
    setError("");
    setFile(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
  }, [previewUrl]);

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) acceptFile(f);
  }, [acceptFile]);

  const removeImage = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null); setPreviewUrl("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const analyze = async () => {
    if (!file) { setError("Please upload a chart image first."); return; }
    if (!horizon) { setError("Pick a trading horizon."); return; }
    setError(""); setResult(null); setLoading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      fd.append("horizon", horizon);
      if (asset.trim()) fd.append("asset", asset.trim());
      const r = await fetch("/api/chart-ai/analyze", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (data?.error === "daily_limit_reached") {
          setError(`Daily limit reached — resets at ${new Date(data.resets_at).toUTCString().split(" ").slice(1, 5).join(" ")} UTC.`);
          setUsage(u => ({ ...u, used_today: u.daily_limit, remaining_today: 0, resets_at: data.resets_at }));
        } else if (data?.error === "service_temporarily_paused") {
          setError("Chart AI is temporarily paused. Please try again later.");
        } else {
          setError(data?.error || "Analysis failed. Try again.");
        }
        return;
      }
      setResult(data.analysis);
      setUsage(u => ({
        ...u,
        used_today: u.daily_limit - (data.remaining_today ?? 0),
        remaining_today: data.remaining_today ?? Math.max(0, u.remaining_today - 1),
        resets_at: data.resets_at,
      }));
    } catch (e) {
      setError("Network error. Check connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const analyzeAnother = () => {
    setResult(null); removeImage();
  };

  const copySummary = async () => {
    if (!result) return;
    const tps = (result.take_profits || []).map(tp => `TP${tp.level} ${fmtPrice(tp.price)}`).join(" · ");
    const txt = [
      `CLVRQuant Chart AI · ${horizon.toUpperCase()}${asset ? " · " + asset.toUpperCase() : ""}`,
      `Direction: ${String(result.direction).toUpperCase()}  (Conf ${result.confidence ?? "—"})`,
      `Entry: ${fmtPrice(result.entry?.price)} (${result.entry?.type || "market"})`,
      `Stop:  ${fmtPrice(result.stop_loss)}`,
      tps,
      `R:R ${result.risk_reward ?? "—"}`,
      result.reasoning ? `\n${result.reasoning}` : "",
    ].filter(Boolean).join("\n");
    try { await navigator.clipboard.writeText(txt); } catch {}
  };

  // ── Styles (theme-aware) ──────────────────────────────────────────────────
  const card = {
    background: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: 16,
  };
  const labelMono = {
    fontFamily: MONO, fontSize: 9, color: C.muted,
    letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600,
  };
  const btnBase = {
    minHeight: 44, padding: "10px 16px", borderRadius: 4,
    cursor: "pointer", fontFamily: MONO, fontSize: 11,
    letterSpacing: "0.08em", fontWeight: 600,
    transition: "all 0.15s",
  };

  const dirColor = result?.direction === "long"  ? "#00c787"
                 : result?.direction === "short" ? "#ff4060"
                 : "#888";
  const dirLabel = result?.direction === "long"  ? "LONG"
                 : result?.direction === "short" ? "SHORT"
                 : "NO TRADE";

  const remaining = usage.remaining_today ?? 0;
  const usedDay   = usage.used_today ?? 0;
  const limit     = usage.daily_limit ?? 5;

  return (
    <div data-testid="tab-chart-ai" style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 24 }}>
      {/* ─── Top bar ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ScanLine size={20} color={ACCENT} />
          <div>
            <div style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 22, color: C.gold2, letterSpacing: "-0.02em" }}>
              Chart AI
            </div>
            <div style={{ ...labelMono, marginTop: 2, color: C.muted2 }}>
              ELITE · UPLOAD CHART → AI TRADE PLAN
            </div>
          </div>
          <div title="Upload a chart, get AI-analyzed entry, SL, and TP levels" style={{ display: "flex", alignItems: "center", marginLeft: 4, cursor: "help" }}>
            <Info size={14} color={C.muted} />
          </div>
        </div>
        <div data-testid="text-usage-counter" style={{ textAlign: isMobile ? "left" : "right", fontFamily: MONO, fontSize: 10, color: C.muted2, lineHeight: 1.5 }}>
          <div style={{ color: remaining === 0 ? "#ff4060" : C.gold }}>
            <strong style={{ fontSize: 13 }}>{remaining}</strong> of <strong>{limit}</strong> analyses remaining today
          </div>
          <div>Resets at 00:00 UTC</div>
        </div>
      </div>

      {/* ─── Upload area ────────────────────────────────────────── */}
      <div
        data-testid="dropzone-chart"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          background: dragOver ? ACCENT_DIM : C.panel,
          border: `2px dashed ${dragOver ? ACCENT : ACCENT_BORDER}`,
          borderRadius: 8,
          padding: previewUrl ? 12 : 28,
          textAlign: "center",
          transition: "all 0.15s",
          minHeight: previewUrl ? "auto" : 180,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        }}
      >
        {previewUrl ? (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
            <img
              data-testid="img-chart-preview"
              src={previewUrl}
              alt="chart preview"
              style={{ width: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 4, background: "#000" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted }}>
                {file?.name?.slice(0, 40)} · {(file?.size / 1024).toFixed(0)} KB
              </div>
              <button
                data-testid="btn-remove-image"
                onClick={removeImage}
                style={{ ...btnBase, background: "transparent", border: `1px solid ${C.border2 || C.border}`, color: C.muted2, padding: "6px 12px", fontSize: 10, minHeight: 36 }}
              >
                <X size={12} style={{ verticalAlign: "middle", marginRight: 4 }}/>Remove
              </button>
            </div>
          </div>
        ) : (
          <>
            <Upload size={32} color={ACCENT} style={{ marginBottom: 10 }} />
            <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 6 }}>
              Drop a chart here, or
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <button
                data-testid="btn-browse-file"
                onClick={() => fileInputRef.current?.click()}
                style={{ ...btnBase, background: ACCENT, color: "#fff", border: "none" }}
              >
                Browse files
              </button>
              <button
                data-testid="btn-camera-capture"
                onClick={() => cameraInputRef.current?.click()}
                style={{ ...btnBase, background: "transparent", border: `1px solid ${ACCENT_BORDER}`, color: ACCENT }}
              >
                <Camera size={13} style={{ verticalAlign: "middle", marginRight: 5 }}/>Use camera
              </button>
            </div>
            <div style={{ fontFamily: MONO, fontSize: 9, color: C.muted, marginTop: 12, letterSpacing: "0.06em" }}>
              PNG · JPG · WebP · max 5 MB
            </div>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: "none" }}
          onChange={(e) => acceptFile(e.target.files?.[0])}
          data-testid="input-file-chart"
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => acceptFile(e.target.files?.[0])}
          data-testid="input-camera-chart"
        />
      </div>

      {/* hint */}
      <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted2, lineHeight: 1.6 }}>
        💡 Keep the price axis visible on the right side of the chart for best results.
      </div>

      {/* ─── Horizon selector ───────────────────────────────────── */}
      <div>
        <div style={{ ...labelMono, marginBottom: 8 }}>Horizon</div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 8 }}>
          {HORIZONS.map(h => {
            const Icon = h.Icon;
            const active = horizon === h.id;
            return (
              <button
                key={h.id}
                data-testid={`btn-horizon-${h.id}`}
                onClick={() => setHorizon(h.id)}
                style={{
                  ...btnBase,
                  background: active ? ACCENT_DIM : C.panel,
                  border: `1px solid ${active ? ACCENT : C.border}`,
                  color: active ? ACCENT : C.text,
                  borderRadius: 999,
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                  padding: "10px 8px",
                }}
              >
                <Icon size={14} />
                <div style={{ fontWeight: 700, fontSize: 11 }}>{h.label}</div>
                <div style={{ fontFamily: MONO, fontSize: 8, color: C.muted, letterSpacing: "0.06em" }}>{h.sub}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Asset (optional) ───────────────────────────────────── */}
      <div>
        <label style={{ ...labelMono, display: "block", marginBottom: 6 }}>Asset (optional)</label>
        <input
          data-testid="input-asset"
          value={asset}
          onChange={(e) => setAsset(e.target.value)}
          placeholder="e.g., BTC, EUR/USD, AAPL"
          style={{
            width: "100%", padding: "11px 12px", minHeight: 44,
            background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4,
            color: C.text, fontFamily: MONO, fontSize: 12,
            outline: "none",
          }}
        />
      </div>

      {/* ─── Analyze button ─────────────────────────────────────── */}
      <button
        data-testid="btn-analyze-chart"
        onClick={analyze}
        disabled={loading || !file || remaining === 0}
        style={{
          ...btnBase,
          width: isMobile ? "100%" : "auto",
          minWidth: isMobile ? "100%" : 240,
          alignSelf: isMobile ? "stretch" : "flex-start",
          minHeight: 48,
          padding: "14px 24px",
          background: (loading || !file || remaining === 0) ? "rgba(155,89,255,0.25)" : ACCENT,
          color: "#fff",
          border: "none",
          fontSize: 13,
          letterSpacing: "0.12em",
          opacity: (loading || !file || remaining === 0) ? 0.7 : 1,
          cursor: (loading || !file || remaining === 0) ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Analyzing…" : remaining === 0 ? "Daily limit reached" : "Analyze Chart"}
      </button>

      {/* ─── Error banner ───────────────────────────────────────── */}
      {error && (
        <div data-testid="text-chart-error" style={{
          ...card,
          borderColor: "rgba(255,64,96,.4)",
          background: "rgba(255,64,96,.08)",
          color: "#ff4060",
          fontFamily: MONO, fontSize: 11,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <AlertTriangle size={14}/> {error}
        </div>
      )}

      {/* ─── Loading skeleton ───────────────────────────────────── */}
      {loading && (
        <div data-testid="loader-chart-ai" style={{ ...card, padding: "28px 18px", textAlign: "center" }}>
          <div style={{ fontFamily: MONO, fontSize: 11, color: ACCENT, letterSpacing: "0.1em", marginBottom: 14, fontWeight: 600 }}>
            {LOADING_MESSAGES[loadingIdx].replace("{horizon}", horizon)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[80, 95, 60, 88, 70].map((w, i) => (
              <div key={i} style={{
                height: 10,
                width: `${w}%`,
                margin: "0 auto",
                background: `linear-gradient(90deg, ${C.border} 0%, ${ACCENT_DIM} 50%, ${C.border} 100%)`,
                backgroundSize: "200% 100%",
                animation: "chartai-shimmer 1.4s infinite linear",
                borderRadius: 4,
              }}/>
            ))}
          </div>
          <style>{`@keyframes chartai-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }`}</style>
        </div>
      )}

      {/* ─── Results card ───────────────────────────────────────── */}
      {result && !loading && (
        <div data-testid="card-chart-result" style={{ ...card, padding: 0, overflow: "hidden" }}>
          {/* direction + confidence */}
          <div style={{ padding: "16px 18px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div data-testid="badge-direction" style={{
                fontFamily: SERIF, fontWeight: 900, fontSize: 26,
                color: dirColor, letterSpacing: "0.04em",
              }}>
                {dirLabel}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, letterSpacing: "0.12em" }}>
                CONFIDENCE
                <strong data-testid="text-confidence" style={{ marginLeft: 8, color: C.text, fontSize: 13 }}>
                  {result.confidence ?? "—"}
                </strong>
              </div>
            </div>
            <div style={{
              marginTop: 10, height: 6, borderRadius: 3, background: C.bg, overflow: "hidden",
            }}>
              <div style={{
                height: "100%",
                width: `${Math.max(0, Math.min(100, Number(result.confidence) || 0))}%`,
                background: `linear-gradient(90deg, #ff4060 0%, ${ACCENT} 50%, #00c787 100%)`,
                transition: "width 0.4s",
              }}/>
            </div>
          </div>

          {/* key levels table */}
          {result.direction !== "no_trade" && (
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ ...labelMono, marginBottom: 10 }}>Key Levels</div>
              <table data-testid="table-key-levels" style={{ width: "100%", borderCollapse: "collapse", fontFamily: MONO, fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "6px 0", color: C.muted, fontWeight: 600, fontSize: 10, letterSpacing: "0.12em", borderBottom: `1px solid ${C.border}` }}>LEVEL</th>
                    <th style={{ textAlign: "right", padding: "6px 0", color: C.muted, fontWeight: 600, fontSize: 10, letterSpacing: "0.12em", borderBottom: `1px solid ${C.border}` }}>PRICE</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}`, color: C.text }}>
                      Entry <span style={{ color: C.muted, fontSize: 10 }}>({result.entry?.type || "market"})</span>
                    </td>
                    <td data-testid="text-entry-price" style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}`, color: C.text, textAlign: "right", fontWeight: 600 }}>
                      ${fmtPrice(result.entry?.price)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}`, color: "#ff4060" }}>Stop Loss</td>
                    <td data-testid="text-stop-loss" style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}`, color: "#ff4060", textAlign: "right", fontWeight: 600 }}>
                      ${fmtPrice(result.stop_loss)}
                    </td>
                  </tr>
                  {(result.take_profits || []).map(tp => (
                    <tr key={tp.level}>
                      <td style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}`, color: "#00c787" }}>TP{tp.level}</td>
                      <td data-testid={`text-tp-${tp.level}`} style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}`, color: "#00c787", textAlign: "right", fontWeight: 600 }}>
                        ${fmtPrice(tp.price)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ padding: "8px 0", color: C.muted2 }}>R:R</td>
                    <td data-testid="text-rr" style={{ padding: "8px 0", color: C.text, textAlign: "right", fontWeight: 600 }}>
                      {result.risk_reward != null ? Number(result.risk_reward).toFixed(2) : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* reasoning */}
          {result.reasoning && (
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ ...labelMono, marginBottom: 6 }}>Reasoning</div>
              <blockquote data-testid="text-reasoning" style={{
                margin: 0, padding: "10px 14px",
                borderLeft: `3px solid ${ACCENT}`,
                background: ACCENT_DIM,
                color: C.text, fontFamily: SERIF, fontSize: 14, fontStyle: "italic", lineHeight: 1.65,
              }}>
                {result.reasoning}
              </blockquote>
            </div>
          )}

          {/* news context */}
          {result.news_context && (
            <div style={{ padding: "10px 18px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ ...labelMono, marginBottom: 4 }}>News Context</div>
              <div data-testid="text-news-context" style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 12, color: C.muted2, lineHeight: 1.55 }}>
                {result.news_context}
              </div>
            </div>
          )}

          {/* warnings */}
          {Array.isArray(result.warnings) && result.warnings.length > 0 && (
            <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ ...labelMono, marginBottom: 8 }}>Warnings</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {result.warnings.map((w, i) => (
                  <span key={i} data-testid={`chip-warning-${i}`} style={{
                    background: "rgba(255,64,96,.12)",
                    border: "1px solid rgba(255,64,96,.4)",
                    color: "#ff4060",
                    fontFamily: MONO, fontSize: 10, letterSpacing: "0.06em",
                    padding: "4px 9px", borderRadius: 999, fontWeight: 600,
                    textTransform: "uppercase",
                  }}>{w}</span>
                ))}
              </div>
            </div>
          )}

          {/* invalidation */}
          {result.invalidation && (
            <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontFamily: MONO, fontSize: 11, color: C.text, lineHeight: 1.6 }}>
                <strong style={{ color: "#ff4060", letterSpacing: "0.05em" }}>Setup invalid if:</strong>{" "}
                <span data-testid="text-invalidation" style={{ color: C.muted2 }}>{result.invalidation}</span>
              </div>
            </div>
          )}

          {/* actions */}
          <div style={{ padding: "14px 18px", display: "flex", gap: 8, flexWrap: "wrap", background: C.bg }}>
            <button
              data-testid="btn-share-summary"
              onClick={copySummary}
              style={{ ...btnBase, background: "transparent", border: `1px solid ${C.border}`, color: C.text, flex: isMobile ? 1 : "0 0 auto" }}
            >
              <Share2 size={13} style={{ verticalAlign: "middle", marginRight: 6 }}/>Copy summary
            </button>
            <button
              data-testid="btn-analyze-another"
              onClick={analyzeAnother}
              style={{ ...btnBase, background: ACCENT, color: "#fff", border: "none", flex: isMobile ? 1 : "0 0 auto" }}
            >
              <RotateCcw size={13} style={{ verticalAlign: "middle", marginRight: 6 }}/>Analyze another
            </button>
          </div>

          {/* disclaimer */}
          <div style={{ padding: "10px 18px", fontFamily: MONO, fontSize: 9, color: C.muted, lineHeight: 1.6, textAlign: "center" }}>
            AI analysis for informational purposes only. Not financial advice. Past performance does not guarantee future results.
          </div>
        </div>
      )}
    </div>
  );
}

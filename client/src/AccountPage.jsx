import { useState, useEffect } from "react";

const C = {
  bg:"#050709", panel:"#0c1220", border:"#141e35", border2:"#1c2b4a",
  gold:"#c9a84c", gold2:"#e8c96d", gold3:"#f7e0a0",
  text:"#c8d4ee", muted:"#4a5d80", muted2:"#6b7fa8", white:"#f0f4ff",
  green:"#00c787", red:"#ff4060", orange:"#ff8c00", cyan:"#00d4ff",
  purple:"#9b59b6",
};
const SERIF = "'Playfair Display', Georgia, serif";
const MONO  = "'IBM Plex Mono', monospace";
const SANS  = "'Barlow', system-ui, sans-serif";

const PLAN_INFO = {
  free:  { label: "Free",  color: C.muted2,  border: C.border,    price: "$0" },
  pro:   { label: "Pro",   color: C.gold,    border: C.gold,      price: "$29.99/mo" },
  elite: { label: "Elite", color: "#00e5ff", border: "#00a8cc",   price: "$129/mo" },
};

function ConfirmModal({ title, message, warning, confirmLabel, confirmColor, onConfirm, onCancel, children }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.85)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}
      onClick={onCancel}>
      <div style={{ background:C.panel, border:`1px solid ${C.border2}`, borderRadius:6, padding:24, maxWidth:400, width:"100%" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontFamily:SERIF, fontSize:16, fontWeight:700, marginBottom:10, color:C.white }}>{title}</div>
        <div style={{ fontSize:12, color:C.muted2, lineHeight:1.7, marginBottom:14 }}>{message}</div>
        {warning && <div style={{ background:"rgba(255,64,96,.06)", border:`1px solid rgba(255,64,96,.2)`, borderRadius:4, padding:"10px 12px", fontSize:11, color:C.red, marginBottom:16, lineHeight:1.6 }}>{warning}</div>}
        {children}
        <div style={{ display:"flex", gap:10 }}>
          <button data-testid="btn-modal-cancel" onClick={onCancel} style={{ flex:1, background:C.bg, border:`1px solid ${C.border}`, color:C.muted2, borderRadius:4, padding:"10px", cursor:"pointer", fontSize:12, fontFamily:MONO }}>
            Cancel
          </button>
          <button data-testid="btn-modal-confirm" onClick={onConfirm} style={{ flex:1, background:confirmColor || C.gold, border:"none", color:C.bg, borderRadius:4, padding:"10px", cursor:"pointer", fontWeight:700, fontSize:12, fontFamily:MONO }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Toast({ msg, onClose }) {
  return (
    <div style={{ position:"fixed", bottom:90, left:"50%", transform:"translateX(-50%)", background:"rgba(0,199,135,.08)", border:`1px solid rgba(0,199,135,.3)`, borderRadius:4, padding:"10px 18px", fontSize:12, fontFamily:MONO, color:C.green, zIndex:400, whiteSpace:"nowrap", boxShadow:"0 4px 24px rgba(0,0,0,.5)" }}>
      {msg}
      <span onClick={onClose} style={{ marginLeft:14, color:"rgba(0,199,135,.5)", cursor:"pointer" }}>x</span>
    </div>
  );
}

function QRCode({ data, size = 180 }) {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}&bgcolor=0c1220&color=c9a84c&margin=2`;
  return (
    <img src={url} alt={`QR: ${data}`}
      style={{ width:size, height:size, borderRadius:4, border:`1px solid ${C.border2}`, display:"block" }}
    />
  );
}

function OwnerEmailTool({ C, MONO, title, description, endpoint, testId, buttonLabel }) {
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState("");
  const handle = async () => {
    setStatus("sending"); setMsg("");
    try {
      const r = await fetch(endpoint, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } });
      const d = await r.json();
      if (r.ok) {
        setStatus("sent");
        setMsg(d.sent !== undefined ? `Sent to ${d.sent} recipient${d.sent !== 1 ? "s" : ""}.` : "Email queued — subscribers will receive it within ~60 seconds.");
      } else { setStatus("error"); setMsg(d.error || "Failed to send."); }
    } catch { setStatus("error"); setMsg("Network error. Please try again."); }
    setTimeout(() => { setStatus(null); setMsg(""); }, 10000);
  };
  const col = status === "sent" ? C.green : status === "error" ? C.red : C.gold;
  const bg  = status === "sent" ? "rgba(0,199,135,.06)" : status === "error" ? "rgba(255,64,96,.06)" : "rgba(201,168,76,.05)";
  const bd  = status === "sent" ? "rgba(0,199,135,.25)" : status === "error" ? "rgba(255,64,96,.2)" : "rgba(201,168,76,.2)";
  return (
    <div style={{ background:bg, border:`1px solid ${bd}`, borderRadius:8, padding:"14px 16px", marginBottom:10 }}>
      <div style={{ fontSize:13, fontWeight:600, color:C.white, marginBottom:4 }}>{title}</div>
      <div style={{ fontFamily:MONO, fontSize:10, color:C.muted2, marginBottom:10, lineHeight:1.6 }}>{description}</div>
      {msg && <div style={{ fontFamily:MONO, fontSize:10, color:col, marginBottom:8, lineHeight:1.5 }}>{msg}</div>}
      <button data-testid={testId} onClick={handle} disabled={status === "sending"} style={{
        background:bg, border:`1px solid ${bd}`, borderRadius:5, padding:"9px 16px",
        fontFamily:MONO, fontSize:10, color:col, cursor:status === "sending" ? "not-allowed" : "pointer",
        letterSpacing:"0.1em", fontWeight:700, opacity:status === "sending" ? 0.6 : 1,
      }}>
        {status === "sending" ? "Sending…" : status === "sent" ? "✓ Sent" : buttonLabel}
      </button>
    </div>
  );
}

function OwnerResendBrief({ C, MONO }) {
  return (
    <OwnerEmailTool C={C} MONO={MONO}
      title="Morning Market Brief (Resend)"
      description="Manually resend today's market brief + apology note to all active subscribers. Use if the 6AM automated email failed to deliver."
      endpoint="/api/admin/send-apology-brief"
      testId="btn-owner-resend-brief"
      buttonLabel="📤 Resend Brief to All Subscribers"
    />
  );
}

function EmailSystemHealth({ C, MONO }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const check = async () => {
    setLoading(true); setErr(null); setData(null);
    try {
      const r = await fetch("/api/admin/email-health", { credentials: "include" });
      const d = await r.json();
      if (r.ok) setData(d); else setErr(d.error || `HTTP ${r.status}`);
    } catch (e) { setErr(e.message || "Network error"); }
    setLoading(false);
  };
  const ok = data?.credentialOk && data?.subscriberCount > 0;
  const col = err || (data && !data.credentialOk) ? C.red : ok ? C.green : C.gold;
  const bg = err || (data && !data.credentialOk) ? "rgba(255,64,96,.06)" : ok ? "rgba(0,199,135,.06)" : "rgba(201,168,76,.05)";
  const bd = err || (data && !data.credentialOk) ? "rgba(255,64,96,.25)" : ok ? "rgba(0,199,135,.25)" : "rgba(201,168,76,.2)";
  return (
    <div style={{ background:bg, border:`1px solid ${bd}`, borderRadius:8, padding:"14px 16px", marginBottom:10 }}>
      <div style={{ fontSize:13, fontWeight:600, color:C.white, marginBottom:4 }}>Email System Health Check</div>
      <div style={{ fontFamily:MONO, fontSize:10, color:C.muted2, marginBottom:10, lineHeight:1.6 }}>
        Verifies the Resend credential resolves and reports active subscriber count. Run this FIRST if sends aren't arriving — it tells you exactly why.
      </div>
      {data && (
        <div style={{ fontFamily:MONO, fontSize:10, color:col, marginBottom:10, lineHeight:1.7, whiteSpace:"pre-wrap", wordBreak:"break-word" }}>
          <div style={{ fontWeight:700, marginBottom:6 }}>{data.verdict}</div>
          <div>host: {data.env.host}</div>
          <div>RESEND_API_KEY set: {String(data.env.RESEND_API_KEY)}</div>
          <div>REPLIT_CONNECTORS_HOSTNAME set: {String(data.env.REPLIT_CONNECTORS_HOSTNAME)}</div>
          <div>credential resolvable: {String(data.credentialOk)}</div>
          {data.credentialError && <div style={{ color:C.red }}>error: {data.credentialError}</div>}
          <div>fromEmail: {data.fromEmail || "(unresolved)"}</div>
          <div>active subscribers (send list): {data.subscriberCount}{data.subscriberError ? ` — ERROR: ${data.subscriberError}` : ""}</div>
          <div>users opted-in (users.subscribe_to_brief): {data.usersOptInCount}</div>
        </div>
      )}
      {err && <div style={{ fontFamily:MONO, fontSize:10, color:C.red, marginBottom:10 }}>{err}</div>}
      <button data-testid="btn-owner-email-health" onClick={check} disabled={loading} style={{
        background:bg, border:`1px solid ${bd}`, borderRadius:5, padding:"9px 16px",
        fontFamily:MONO, fontSize:10, color:col, cursor:loading ? "not-allowed" : "pointer",
        letterSpacing:"0.1em", fontWeight:700, opacity:loading ? 0.6 : 1,
      }}>
        {loading ? "Checking…" : "🩺 Check Email System"}
      </button>
    </div>
  );
}

const SYSTEM_EMAILS = [
  {
    key: "signup-welcome",
    name: "Welcome Email",
    trigger: "Automatic — on new account creation",
    recipients: "New user (individually)",
    description: "Sent immediately when a user creates an account. Contains a platform overview, feature list, and login link.",
    color: "#00c787",
  },
  {
    key: "morning-brief",
    name: "Morning Market Brief",
    trigger: "Automatic — daily at 6:00 AM ET",
    recipients: "All subscribed users",
    description: "Daily AI-generated brief covering market sentiment, macro outlook, top trades, and price signals.",
    color: "#c9a84c",
  },
  {
    key: "apology-brief",
    name: "Apology Brief (Manual Resend)",
    trigger: "Manual — owner panel → Emails tab",
    recipients: "All subscribed users",
    description: "Re-sends today's brief with an apology note if the automated 6AM send failed or had issues.",
    color: "#ff8c00",
  },
  {
    key: "service-disruption",
    name: "Service Disruption Apology",
    trigger: "Manual — owner panel → Emails tab",
    recipients: "All users (subscribed and unsubscribed)",
    description: "Formal apology email sent during outages or data disruptions. Links users to Support@CLVRQuantAI.com.",
    color: "#ff4060",
  },
  {
    key: "referral-promotion",
    name: "Referral Promotion",
    trigger: "Manual — owner panel → Emails tab",
    recipients: "All users",
    description: "Encourages users to share their referral code. They earn 1 week of free Pro per paid referral.",
    color: "#9b59b6",
  },
  {
    key: "referral-reward",
    name: "Referral Reward",
    trigger: "Automatic — when a referred user subscribes to a paid plan",
    recipients: "Referring user (individually)",
    description: "Notifies the referrer they've earned 1 week of free Pro access for a successful referral.",
    color: "#00d4ff",
  },
  {
    key: "promo-expiry",
    name: "Promo Code Expiry Reminder",
    trigger: "Automatic — 14 days before promo code expiry",
    recipients: "Users with expiring promo codes (individually)",
    description: "Reminds users their promo-based access expires soon and nudges them to subscribe via Stripe.",
    color: "#ff8c00",
  },
  {
    key: "elite-activation",
    name: "Elite Access Activation",
    trigger: "Automatic — when an Elite access code is redeemed",
    recipients: "Newly activated Elite user (individually)",
    description: "Welcome email confirming Elite access is now active, with a full feature breakdown.",
    color: "#00e5ff",
  },
  {
    key: "account-deletion",
    name: "Account Deletion Retention",
    trigger: "Automatic — when a paid user deletes their account",
    recipients: "Deleted user (individually)",
    description: "Sent only if the user had a paid plan (Pro or Elite). Offers 1 free month to return. Not sent to free-plan deletions.",
    color: "#ff4060",
  },
  {
    key: "custom-broadcast",
    name: "Custom Broadcast (Admin Panel)",
    trigger: "Manual — owner panel → Admin tab",
    recipients: "All users or subscribed users (owner's choice)",
    description: "Free-form broadcast email typed by you in the Admin tab. Sent with CLVRQuant HTML branding and your founder signature.",
    color: "#c9a84c",
  },
];

function AdminTab({ C, MONO, SANS, SERIF }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [htmlMode, setHtmlMode] = useState(false);
  const [targetAll, setTargetAll] = useState(false);
  const [testMode, setTestMode] = useState(true);
  const [sendStatus, setSendStatus] = useState(null);
  const [sendMsg, setSendMsg] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState({});
  const [testStatus, setTestStatus] = useState({}); // { [key]: "sending" | "ok" | "err" }
  const [testMsg, setTestMsg] = useState({});
  const [actionStatus, setActionStatus] = useState({});
  const [actionMsg, setActionMsg] = useState({});

  const runAction = async (key, url, opts = {}) => {
    setActionStatus(s => ({ ...s, [key]: "running" }));
    setActionMsg(m => ({ ...m, [key]: "" }));
    try {
      const r = await fetch(url, { method: opts.method || "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: opts.body });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setActionStatus(s => ({ ...s, [key]: "ok" }));
        setActionMsg(m => ({ ...m, [key]: d.message || "Done." }));
      } else {
        setActionStatus(s => ({ ...s, [key]: "err" }));
        setActionMsg(m => ({ ...m, [key]: d.error || `HTTP ${r.status}` }));
      }
    } catch (e) {
      setActionStatus(s => ({ ...s, [key]: "err" }));
      setActionMsg(m => ({ ...m, [key]: e.message || "Network error" }));
    }
    setTimeout(() => { setActionStatus(s => ({ ...s, [key]: null })); setActionMsg(m => ({ ...m, [key]: "" })); }, 12000);
  };

  const sendTestSystemEmail = async (key) => {
    setTestStatus(s => ({ ...s, [key]: "sending" }));
    setTestMsg(m => ({ ...m, [key]: "" }));
    try {
      const r = await fetch("/api/admin/test-system-email", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setTestStatus(s => ({ ...s, [key]: "ok" }));
        setTestMsg(m => ({ ...m, [key]: d.message || "✓ Test email sent to mikeclaver@clvrquantai.com" }));
      } else {
        setTestStatus(s => ({ ...s, [key]: "err" }));
        setTestMsg(m => ({ ...m, [key]: d.error || `HTTP ${r.status}` }));
      }
    } catch (e) {
      setTestStatus(s => ({ ...s, [key]: "err" }));
      setTestMsg(m => ({ ...m, [key]: e.message || "Network error" }));
    }
    setTimeout(() => { setTestStatus(s => ({ ...s, [key]: null })); setTestMsg(m => ({ ...m, [key]: "" })); }, 10000);
  };

  // Auto-detect HTML when pasting
  const handleBodyChange = (val) => {
    setBody(val);
    const trimmed = val.trimStart().toLowerCase();
    if (trimmed.startsWith("<!doctype") || trimmed.startsWith("<html") || trimmed.startsWith("<div") || trimmed.startsWith("<table")) {
      setHtmlMode(true);
    }
  };

  const isRawHtml = htmlMode && (body.trimStart().toLowerCase().startsWith("<!doctype") || body.trimStart().toLowerCase().startsWith("<html"));
  const lineCount = body.split("\n").length;
  const charCount = body.length;

  const sendCustomEmail = async () => {
    if (!subject.trim() || !body.trim()) { setSendMsg("Subject and body are both required."); setSendStatus("error"); return; }
    setSendStatus("sending"); setSendMsg("");
    try {
      const r = await fetch("/api/admin/send-custom-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: subject.trim(), body: body.trim(), targetAll, htmlMode, testMode }),
      });
      const d = await r.json();
      if (r.ok) {
        setSendStatus("sent");
        setSendMsg(`✓ Sent to ${d.sent} recipient${d.sent !== 1 ? "s" : ""}.`);
        setSubject(""); setBody(""); setShowPreview(false);
      } else { setSendStatus("error"); setSendMsg(d.error || "Failed to send."); }
    } catch { setSendStatus("error"); setSendMsg("Network error. Please try again."); }
    setTimeout(() => { setSendStatus(null); setSendMsg(""); }, 12000);
  };

  return (
    <div>
      {/* Email Catalog */}
      <div style={{ background:"#0c1220", border:`1px solid rgba(155,89,182,.3)`, borderRadius:6, padding:18, marginBottom:16 }}>
        <div style={{ fontFamily:MONO, fontSize:9, color:"#9b59b6", letterSpacing:"0.2em", marginBottom:14 }}>📬 SYSTEM EMAIL CATALOG</div>
        <div style={{ fontSize:11, color:"#6b7fa8", fontFamily:MONO, marginBottom:16, lineHeight:1.6 }}>
          All automated and manual emails sent by CLVRQuant on your behalf. Use this as a reference so you know exactly what users receive and when.
        </div>
        <div style={{ fontFamily:MONO, fontSize:9, color:"#4a5d80", marginBottom:10, letterSpacing:"0.06em", lineHeight:1.6 }}>
          Click any row to expand. The <span style={{ color:"#00e57a" }}>TEST</span> button sends a sample of that template to <code style={{ color:"#e8c96d" }}>mikeclaver@clvrquantai.com</code> to verify delivery for that email category.
        </div>
        {SYSTEM_EMAILS.map((em, i) => {
          const open = !!catalogOpen[em.key];
          const ts = testStatus[em.key];
          const tm = testMsg[em.key];
          return (
            <div key={em.key} style={{ borderLeft:`3px solid ${em.color}`, paddingLeft:12, marginBottom:8, paddingBottom: 8, borderBottom: i < SYSTEM_EMAILS.length-1 ? "1px solid #141e35" : "none" }}>
              <div
                data-testid={`row-catalog-${em.key}`}
                onClick={() => setCatalogOpen(s => ({ ...s, [em.key]: !open }))}
                style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, flexWrap:"wrap", cursor:"pointer", padding:"4px 0" }}
              >
                <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:0, flex:1 }}>
                  <span style={{ fontFamily:MONO, fontSize:10, color:"#4a5d80", width:12, display:"inline-block" }}>{open ? "▾" : "▸"}</span>
                  <span style={{ fontFamily:MONO, fontSize:11, fontWeight:700, color:"#f0f4ff" }}>{em.name}</span>
                </div>
                <div style={{ fontFamily:MONO, fontSize:8, color:em.color, border:`1px solid ${em.color}44`, borderRadius:2, padding:"2px 7px", whiteSpace:"nowrap", letterSpacing:"0.08em" }}>
                  {em.recipients.includes("individually") ? "INDIVIDUAL" : "BROADCAST"}
                </div>
              </div>
              {open && (
                <div style={{ paddingTop:8, paddingBottom:4 }}>
                  <div style={{ fontFamily:MONO, fontSize:9, color:"#4a5d80", marginBottom:4, letterSpacing:"0.04em" }}>⚡ {em.trigger}</div>
                  <div style={{ fontFamily:MONO, fontSize:9, color:"#4a5d80", marginBottom:6, letterSpacing:"0.04em" }}>👥 {em.recipients}</div>
                  <div style={{ fontSize:11, color:"#6b7fa8", lineHeight:1.65, marginBottom:10 }}>{em.description}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                    <button
                      data-testid={`btn-test-${em.key}`}
                      onClick={(e) => { e.stopPropagation(); sendTestSystemEmail(em.key); }}
                      disabled={ts === "sending"}
                      style={{
                        background: ts === "ok" ? "rgba(0,229,122,.12)" : ts === "err" ? "rgba(255,100,128,.1)" : "rgba(0,229,122,.08)",
                        border: `1px solid ${ts === "ok" ? "rgba(0,229,122,.5)" : ts === "err" ? "rgba(255,100,128,.4)" : "rgba(0,229,122,.35)"}`,
                        color: ts === "err" ? "#ff6680" : "#00e57a",
                        borderRadius: 4,
                        padding: "6px 12px",
                        fontFamily: MONO,
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        cursor: ts === "sending" ? "not-allowed" : "pointer",
                        opacity: ts === "sending" ? 0.6 : 1,
                      }}
                    >
                      {ts === "sending" ? "SENDING…" : ts === "ok" ? "✓ TEST SENT" : ts === "err" ? "✗ RETRY TEST" : "🧪 SEND TEST"}
                    </button>
                    {tm && (
                      <span
                        data-testid={`text-test-msg-${em.key}`}
                        style={{ fontFamily:MONO, fontSize:9, color: ts === "err" ? "#ff6680" : "#00e57a", lineHeight:1.4 }}
                      >
                        {tm}
                      </span>
                    )}
                    {!tm && (
                      <span style={{ fontFamily:MONO, fontSize:9, color:"#4a5d80" }}>
                        → mikeclaver@clvrquantai.com
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Email Diagnostics — debug "user didn't get email" without Railway logs */}
      <EmailDiagnosticsPanel C={C} MONO={MONO} />

      {/* Weekly Update Controls (moved from Maintenance tab) */}
      <div style={{ background:"#0c1220", border:"1px solid rgba(0,229,255,.2)", borderRadius:6, padding:18, marginBottom:16 }}>
        <div style={{ fontFamily:MONO, fontSize:9, color:"#00e5ff", letterSpacing:"0.2em", marginBottom:14 }}>🆕 WEEKLY UPDATE (WHAT'S NEW)</div>
        <div style={{ fontFamily:MONO, fontSize:10, color:"#6b7fa8", marginBottom:10, lineHeight:1.6 }}>
          Every Saturday 10:00 AM ET the system auto-generates this week's update from your <strong style={{ color:"#00e5ff" }}>improvement log</strong> below
          (and git commits as a fallback), posts it to the About page, and emails all active subscribers — hands-off. Log entries
          throughout the week, then click GENERATE & PUBLISH NOW any time to ship them immediately.
        </div>

        {/* Improvement log — accumulates throughout the week */}
        <UpdateLogManager C={C} MONO={MONO} />

        <div style={{ height:1, background:"rgba(140,160,200,.12)", margin:"14px 0" }} />
        <AIWeeklyUpdateControls C={C} MONO={MONO} />
        <div style={{ height:1, background:"rgba(140,160,200,.12)", margin:"14px 0" }} />
        <div style={{ fontFamily:MONO, fontSize:10, color:"#6b7fa8", marginBottom:10, lineHeight:1.6 }}>
          ✍️ Manual override — fill out the form below to publish a hand-written update instead of letting the AI generate it.
        </div>
        <WeeklyUpdateEditor onSave={async (payload) => {
          const r = await fetch("/api/admin/weekly-update", {
            method:"POST", credentials:"include",
            headers:{ "Content-Type":"application/json" },
            body: JSON.stringify(payload)
          });
          if (!r.ok) { const t = await r.text().catch(()=>""); alert("Save failed: " + t); return; }
          alert("Weekly update saved. It is now live on the About page.");
        }} />
        <div style={{ marginTop:14 }}>
          <AdminActionBtn actionKey="weekly-update-send-now" label="✉ SEND WEEKLY EMAIL NOW (MANUAL)" url="/api/admin/weekly-update/send-now" color="#00e5ff" onRun={runAction} status={actionStatus["weekly-update-send-now"]} msg={actionMsg["weekly-update-send-now"]} MONO={MONO} />
          <div style={{ fontFamily:MONO, fontSize:9, color:"#4a5d80", marginTop:4, lineHeight:1.5 }}>
            Use only if Saturday automation didn't fire. Sends the latest weekly update to all active subscribers immediately.
          </div>
        </div>
      </div>

      {/* Daily Brief Controls (moved from Maintenance tab) */}
      <div style={{ background:"#0c1220", border:"1px solid rgba(232,201,109,.2)", borderRadius:6, padding:18, marginBottom:16 }}>
        <div style={{ fontFamily:MONO, fontSize:9, color:"#e8c96d", letterSpacing:"0.2em", marginBottom:14 }}>📧 DAILY BRIEF CONTROLS</div>
        <div style={{ fontFamily:MONO, fontSize:10, color:"#6b7fa8", marginBottom:12, lineHeight:1.6 }}>
          Scheduler runs every 30s and triggers at 6:00 AM ET. Catch-up runs 10s after server startup if today's brief hasn't been sent yet.
        </div>
        <AdminActionBtn actionKey="test-brief" label="🧪 ENQUEUE TEST BRIEF" url="/api/admin/test-brief" color="#00d4ff" onRun={runAction} status={actionStatus["test-brief"]} msg={actionMsg["test-brief"]} MONO={MONO} />
        <div style={{ fontFamily:MONO, fontSize:9, color:"#4a5d80", marginTop:4, lineHeight:1.5 }}>
          Enqueues a daily brief send. Check server logs for delivery confirmation.
        </div>
      </div>

      {/* Composer */}
      <div style={{ background:"#0c1220", border:`1px solid ${htmlMode ? "rgba(0,212,255,.3)" : "rgba(201,168,76,.25)"}`, borderRadius:6, padding:18 }}>
        {/* Header + mode toggle */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14, flexWrap:"wrap", gap:8 }}>
          <div>
            <div style={{ fontFamily:MONO, fontSize:9, color: htmlMode ? "#00d4ff" : "#c9a84c", letterSpacing:"0.2em", marginBottom:3 }}>
              {htmlMode ? "💻 HTML EMAIL BROADCAST" : "✍️ CUSTOM BROADCAST EMAIL"}
            </div>
            <div style={{ fontSize:10, color:"#4a5d80", fontFamily:MONO, lineHeight:1.5 }}>
              {htmlMode
                ? "Paste full HTML — sent exactly as written, unsubscribe footer auto-injected"
                : "Type a message — auto-formatted with CLVRQuant branding + your signature"}
            </div>
          </div>
          {/* Mode toggle */}
          <div style={{ display:"flex", gap:0, borderRadius:4, overflow:"hidden", border:"1px solid #1c2b4a", flexShrink:0 }}>
            <button data-testid="btn-mode-text" onClick={() => setHtmlMode(false)}
              style={{ padding:"6px 12px", fontFamily:MONO, fontSize:9, fontWeight:700, letterSpacing:"0.08em", border:"none", cursor:"pointer", background:!htmlMode?"rgba(201,168,76,.2)":"transparent", color:!htmlMode?"#e8c96d":"#4a5d80" }}>
              TEXT
            </button>
            <button data-testid="btn-mode-html" onClick={() => setHtmlMode(true)}
              style={{ padding:"6px 12px", fontFamily:MONO, fontSize:9, fontWeight:700, letterSpacing:"0.08em", border:"none", borderLeft:"1px solid #1c2b4a", cursor:"pointer", background:htmlMode?"rgba(0,212,255,.12)":"transparent", color:htmlMode?"#00d4ff":"#4a5d80" }}>
              {"< HTML >"}
            </button>
          </div>
        </div>

        {/* HTML mode info banner */}
        {htmlMode && (
          <div style={{ background:"rgba(0,212,255,.04)", border:"1px solid rgba(0,212,255,.15)", borderRadius:4, padding:"10px 12px", marginBottom:14 }}>
            <div style={{ fontFamily:MONO, fontSize:9, color:"#00a8cc", lineHeight:1.7 }}>
              ✦ Paste any complete HTML email — including <code style={{ color:"#00d4ff" }}>&lt;!DOCTYPE html&gt;</code>, inline styles, images, and QR codes.<br/>
              ✦ CLVRQuant will automatically inject a compliant <strong style={{ color:"#c8d4ee" }}>unsubscribe footer</strong> before <code style={{ color:"#00d4ff" }}>&lt;/body&gt;</code>.<br/>
              ✦ <code style={{ color:"#00d4ff", fontFamily:MONO }}>[First Name]</code> in your HTML is automatically replaced with each recipient's name.
            </div>
          </div>
        )}

        {/* Subject */}
        <div style={{ marginBottom:12 }}>
          <div style={{ fontFamily:MONO, fontSize:9, color:"#4a5d80", letterSpacing:"0.12em", marginBottom:5 }}>SUBJECT LINE</div>
          <input
            data-testid="input-custom-subject"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="e.g. Big upgrades just shipped 🚀"
            maxLength={120}
            style={{ width:"100%", background:"#080d18", border:`1px solid ${htmlMode?"rgba(0,212,255,.2)":"#1c2b4a"}`, borderRadius:4, padding:"10px 12px", fontFamily:MONO, fontSize:11, color:"#c8d4ee", boxSizing:"border-box" }}
          />
        </div>

        {/* Body */}
        <div style={{ marginBottom:12 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
            <div style={{ fontFamily:MONO, fontSize:9, color:"#4a5d80", letterSpacing:"0.12em" }}>
              {htmlMode ? "HTML BODY — PASTE FULL EMAIL HERE" : "MESSAGE BODY"}
            </div>
            {body.length > 0 && (
              <div style={{ fontFamily:MONO, fontSize:8, color:"#2a3650" }}>
                {lineCount} lines · {charCount.toLocaleString()} chars
              </div>
            )}
          </div>
          <textarea
            data-testid="input-custom-body"
            value={body}
            onChange={e => handleBodyChange(e.target.value)}
            placeholder={htmlMode
              ? "<!DOCTYPE html>\n<html lang=\"en\">\n<head>...</head>\n<body>\n  <!-- Paste your full email HTML here -->\n</body>\n</html>"
              : "Dear CLVRQuant community,\n\nYour message here...\n\nWarm regards,\nMike Claver\nFounder, CLVRQuant"}
            rows={htmlMode ? 18 : 9}
            spellCheck={!htmlMode}
            style={{ width:"100%", background:"#06080d", border:`1px solid ${htmlMode?"rgba(0,212,255,.2)":"#1c2b4a"}`, borderRadius:4, padding:"10px 12px", fontFamily:MONO, fontSize: htmlMode ? 10 : 11, color: htmlMode ? "#8fc4e0" : "#c8d4ee", resize:"vertical", boxSizing:"border-box", lineHeight:1.65 }}
          />
        </div>

        {/* HTML Preview toggle */}
        {htmlMode && isRawHtml && body.length > 100 && (
          <div style={{ marginBottom:14 }}>
            <button data-testid="btn-toggle-preview" onClick={() => setShowPreview(v => !v)}
              style={{ background:"rgba(0,212,255,.06)", border:"1px solid rgba(0,212,255,.2)", borderRadius:4, padding:"6px 14px", fontFamily:MONO, fontSize:9, color:"#00d4ff", cursor:"pointer", letterSpacing:"0.1em", fontWeight:700 }}>
              {showPreview ? "▲ HIDE PREVIEW" : "▼ PREVIEW EMAIL"}
            </button>
            {showPreview && (
              <div style={{ marginTop:10, border:"1px solid rgba(0,212,255,.15)", borderRadius:4, overflow:"hidden", background:"#fff" }}>
                <iframe
                  srcDoc={body}
                  sandbox="allow-same-origin"
                  style={{ width:"100%", height:500, border:"none", display:"block" }}
                  title="Email Preview"
                />
              </div>
            )}
          </div>
        )}

        {/* Test mode + Target toggles */}
        <div style={{ background:"#080d18", border:`1px solid ${testMode?"rgba(0,195,100,.25)":"rgba(255,64,96,.18)"}`, borderRadius:5, padding:"12px 14px", marginBottom:14 }}>
          {/* TEST MODE toggle */}
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:testMode?10:0 }}>
            <div data-testid="toggle-test-mode" onClick={() => setTestMode(v => !v)}
              style={{ width:36, height:20, borderRadius:10, background:testMode?"rgba(0,195,100,.4)":"rgba(255,64,96,.25)", border:`1px solid ${testMode?"#00c364":"rgba(255,64,96,.5)"}`, cursor:"pointer", position:"relative", transition:"all .2s", flexShrink:0 }}>
              <div style={{ width:14, height:14, borderRadius:"50%", background:testMode?"#00e57a":"#ff4060", position:"absolute", top:2, left:testMode?18:2, transition:"left .2s" }}/>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:MONO, fontSize:10, fontWeight:700, color:testMode?"#00e57a":"#ff4060", letterSpacing:"0.06em" }}>
                {testMode ? "🧪 TEST MODE — sends to you only" : "🚨 LIVE MODE — sends to all subscribers"}
              </div>
              <div style={{ fontFamily:MONO, fontSize:9, color:"#4a5d80", marginTop:2 }}>
                {testMode ? "Safe: preview before broadcasting. Toggle off to go live." : "Caution: real broadcast to your subscriber list."}
              </div>
            </div>
          </div>
          {/* Target toggle — only when live mode */}
          {!testMode && (
            <div style={{ display:"flex", alignItems:"center", gap:10, borderTop:"1px solid #0e1a30", paddingTop:10 }}>
              <div data-testid="toggle-target-all" onClick={() => setTargetAll(v => !v)}
                style={{ width:36, height:20, borderRadius:10, background:targetAll?"rgba(201,168,76,.35)":"rgba(255,255,255,.08)", border:`1px solid ${targetAll?"#c9a84c":"#1c2b4a"}`, cursor:"pointer", position:"relative", transition:"all .2s", flexShrink:0 }}>
                <div style={{ width:14, height:14, borderRadius:"50%", background:targetAll?"#c9a84c":"#4a5d80", position:"absolute", top:2, left:targetAll?18:2, transition:"left .2s" }}/>
              </div>
              <div style={{ fontFamily:MONO, fontSize:10, color:"#6b7fa8", lineHeight:1.5 }}>
                {targetAll ? "All registered users (incl. non-subscribers)" : "Subscribed users only"}
              </div>
            </div>
          )}
        </div>

        {sendMsg && (
          <div style={{ fontFamily:MONO, fontSize:10, color:sendStatus==="sent"?"#00c787":"#ff4060", marginBottom:10, lineHeight:1.5, padding:"8px 10px", background:sendStatus==="sent"?"rgba(0,199,135,.06)":"rgba(255,64,96,.06)", borderRadius:3 }}>{sendMsg}</div>
        )}

        <button
          data-testid="btn-send-custom-email"
          onClick={sendCustomEmail}
          disabled={sendStatus==="sending"}
          style={{ width:"100%", padding:"12px 0", borderRadius:4, border:`1px solid ${testMode?"rgba(0,195,100,.5)":htmlMode?"rgba(0,212,255,.4)":"rgba(201,168,76,.4)"}`, background:testMode?"rgba(0,195,100,.1)":htmlMode?"rgba(0,212,255,.08)":"rgba(201,168,76,.08)", color:testMode?"#00e57a":htmlMode?"#00e5ff":"#e8c96d", fontFamily:MONO, fontSize:11, fontWeight:700, cursor:sendStatus==="sending"?"not-allowed":"pointer", letterSpacing:"0.1em", opacity:sendStatus==="sending"?0.6:1 }}>
          {sendStatus==="sending" ? "Sending…" : sendStatus==="sent" ? "✓ Sent!" : testMode ? "🧪 Send Test to Me Only" : `📤 Send ${htmlMode?"HTML":"Broadcast"} Email`}
        </button>

        <div style={{ fontFamily:MONO, fontSize:9, color:"#2a3650", marginTop:10, textAlign:"center", lineHeight:1.6 }}>
          {testMode
            ? "Test email delivers only to mikeclaver@gmail.com · No subscribers affected"
            : htmlMode
              ? "HTML sent as-is · Unsubscribe footer auto-injected · [First Name] personalized"
              : "Auto-formatted with CLVRQuant branding · Includes founder signature · Unsubscribe link"}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN 2 — Diagnostics: Track Record, Signal Logs, Resolver, Daily Brief
// ═══════════════════════════════════════════════════════════════════════════════
// ── Weekly Update editor (admin) ────────────────────────────────────────────
// Defined at module scope so React doesn't unmount/remount it on parent
// re-render (which would otherwise wipe input state and lose cursor focus).
// ── Update Log Manager — accumulates "what shipped" entries through the week ──
function UpdateLogManager({ C, MONO }) {
  const [entries, setEntries] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [headline, setHeadline] = useState("");
  const [detail, setDetail] = useState("");
  const [emoji, setEmoji] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [showShipped, setShowShipped] = useState(false);

  const refresh = async () => {
    try {
      const r = await fetch("/api/admin/update-log", { credentials:"include" });
      const j = await r.json();
      if (r.ok) { setEntries(j.entries || []); setPendingCount(j.pendingCount || 0); }
    } catch {}
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  const add = async () => {
    if (!headline.trim()) { setMsg("Headline required"); return; }
    setSaving(true); setMsg("");
    try {
      const r = await fetch("/api/admin/update-log", {
        method:"POST", credentials:"include",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ headline: headline.trim(), detail: detail.trim() || null, emoji: emoji.trim() || null }),
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) { setMsg("✗ " + (j?.error || "Save failed")); return; }
      setHeadline(""); setDetail(""); setEmoji("");
      setMsg("✓ Logged");
      await refresh();
      setTimeout(() => setMsg(""), 2000);
    } catch (e) { setMsg("✗ " + (e?.message || "Network error")); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!confirm("Delete this entry?")) return;
    try {
      const r = await fetch(`/api/admin/update-log/${id}`, { method:"DELETE", credentials:"include" });
      if (r.ok) await refresh();
    } catch {}
  };

  const visible = showShipped ? entries : entries.filter(e => !e.shipped);
  const inp = { background:"#0a1226", border:"1px solid #1c2b4a", color:"#e8e0d0", padding:"7px 10px", fontFamily:MONO, fontSize:11, borderRadius:4, boxSizing:"border-box" };

  return (
    <div style={{ background:"rgba(0,229,255,.04)", border:"1px solid rgba(0,229,255,.18)", borderRadius:6, padding:"12px 14px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <div style={{ fontFamily:MONO, fontSize:9, color:"#00e5ff", letterSpacing:"0.18em" }}>
          📝 IMPROVEMENT LOG · {pendingCount} PENDING THIS WEEK
        </div>
        <button onClick={() => setShowShipped(s => !s)} style={{ background:"transparent", border:"1px solid #1c2b4a", color:"#6b7fa8", borderRadius:3, padding:"3px 8px", fontFamily:MONO, fontSize:8, cursor:"pointer", letterSpacing:"0.08em" }}>
          {showShipped ? "HIDE SHIPPED" : "SHOW ALL"}
        </button>
      </div>

      {/* Add form */}
      <div style={{ display:"grid", gridTemplateColumns:"60px 1fr", gap:6, marginBottom:6 }}>
        <input data-testid="input-log-emoji" placeholder="🚀" maxLength={4} value={emoji} onChange={e=>setEmoji(e.target.value)} style={{...inp, textAlign:"center", fontSize:14}} />
        <input data-testid="input-log-headline" placeholder="What did you ship? (e.g. Added Face ID login)" value={headline} onChange={e=>setHeadline(e.target.value)} maxLength={200} style={inp}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(); } }} />
      </div>
      <textarea data-testid="input-log-detail" placeholder="Optional: why it matters to traders (1-2 sentences)" rows={2} value={detail} onChange={e=>setDetail(e.target.value)} maxLength={500} style={{ ...inp, width:"100%", resize:"vertical", lineHeight:1.5 }} />
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:8 }}>
        <div style={{ fontFamily:MONO, fontSize:9, color: msg.startsWith("✓") ? "#00e57a" : msg.startsWith("✗") ? "#ff6680" : "#6b7fa8" }}>{msg || "Press Enter or click ADD to log"}</div>
        <button data-testid="btn-log-add" disabled={saving || !headline.trim()} onClick={add}
          style={{ background:"rgba(0,229,255,.12)", border:"1px solid rgba(0,229,255,.45)", color:"#00e5ff", borderRadius:4, padding:"6px 14px", fontFamily:MONO, fontSize:10, fontWeight:700, letterSpacing:"0.1em", cursor: saving||!headline.trim()?"not-allowed":"pointer", opacity: saving||!headline.trim()?0.5:1 }}>
          {saving ? "ADDING…" : "+ ADD"}
        </button>
      </div>

      {/* Entries list */}
      <div style={{ marginTop:12, maxHeight:280, overflowY:"auto" }}>
        {loading ? (
          <div style={{ fontFamily:MONO, fontSize:10, color:"#6b7fa8", padding:"6px 0" }}>Loading…</div>
        ) : visible.length === 0 ? (
          <div style={{ fontFamily:MONO, fontSize:10, color:"#6b7fa8", padding:"6px 0", fontStyle:"italic" }}>
            {showShipped ? "No entries yet." : "No pending entries. Add one above as you ship features this week."}
          </div>
        ) : visible.map(e => (
          <div key={e.id} data-testid={`row-log-${e.id}`} style={{ display:"flex", gap:10, alignItems:"flex-start", padding:"8px 0", borderTop:"1px solid rgba(140,160,200,.08)", opacity: e.shipped?0.5:1 }}>
            <div style={{ fontSize:14, width:22, textAlign:"center", flexShrink:0 }}>{e.emoji || "·"}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontFamily:MONO, fontSize:11, color: e.shipped?"#6b7fa8":"#e8e0d0", textDecoration: e.shipped?"line-through":"none" }}>{e.headline}</div>
              {e.detail && <div style={{ fontFamily:MONO, fontSize:9, color:"#6b7fa8", marginTop:3, lineHeight:1.5 }}>{e.detail}</div>}
              <div style={{ fontFamily:MONO, fontSize:8, color:"#4a5d80", marginTop:3 }}>
                {new Date(e.createdAt).toLocaleString()}
                {e.shipped && <span style={{ color:"#00e57a", marginLeft:8 }}>· shipped in update #{e.includedInUpdateId}</span>}
              </div>
            </div>
            {!e.shipped && (
              <button data-testid={`btn-log-del-${e.id}`} onClick={() => del(e.id)} style={{ background:"transparent", border:"1px solid rgba(255,64,96,.3)", color:"#ff6680", borderRadius:3, padding:"3px 8px", fontFamily:MONO, fontSize:8, cursor:"pointer", flexShrink:0 }}>×</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Email Diagnostics — owner debugs "user didn't get email" without Railway logs ──
function EmailDiagnosticsPanel({ C, MONO }) {
  const [email, setEmail] = useState("");
  const [diag, setDiag] = useState(null);
  const [busy, setBusy] = useState(null); // 'diag' | 'resend' | 'mark' | null
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const lookup = async () => {
    if (!email.includes("@")) { setErr("Enter a valid email"); return; }
    setBusy("diag"); setErr(""); setResult(null); setDiag(null);
    try {
      const r = await fetch(`/api/admin/email-diag?email=${encodeURIComponent(email.trim())}`, { credentials:"include" });
      const j = await r.json();
      if (!r.ok) { setErr(j?.error || "Lookup failed"); return; }
      setDiag(j);
    } catch (e) { setErr(e?.message || "Network error"); }
    finally { setBusy(null); }
  };

  const resend = async () => {
    setBusy("resend"); setErr(""); setResult(null);
    try {
      const r = await fetch("/api/admin/resend-verification-by-email", {
        method:"POST", credentials:"include",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const j = await r.json();
      setResult({ kind:"resend", data: j, ok: r.ok && j.ok });
    } catch (e) { setErr(e?.message || "Network error"); }
    finally { setBusy(null); }
  };

  const markVerified = async () => {
    if (!confirm(`Manually mark ${email} as verified? Use only if email delivery is blocked.`)) return;
    setBusy("mark"); setErr(""); setResult(null);
    try {
      const r = await fetch("/api/admin/mark-verified", {
        method:"POST", credentials:"include",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const j = await r.json();
      setResult({ kind:"mark", data: j, ok: r.ok && j.ok });
      if (r.ok) await lookup();
    } catch (e) { setErr(e?.message || "Network error"); }
    finally { setBusy(null); }
  };

  const inp = { background:"#0a1226", border:"1px solid #1c2b4a", color:"#e8e0d0", padding:"7px 10px", fontFamily:MONO, fontSize:11, borderRadius:4, boxSizing:"border-box" };
  const btn = (color, disabled) => ({
    background: `rgba(${color},.08)`, border:`1px solid rgba(${color},.4)`, color:`rgb(${color})`,
    borderRadius:4, padding:"7px 12px", fontFamily:MONO, fontSize:10, fontWeight:700,
    letterSpacing:"0.08em", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
  });

  return (
    <div style={{ background:"#0c1220", border:"1px solid rgba(255,140,0,.25)", borderRadius:6, padding:18, marginBottom:16 }}>
      <div style={{ fontFamily:MONO, fontSize:9, color:"#ff8c00", letterSpacing:"0.2em", marginBottom:10 }}>📧 EMAIL DIAGNOSTICS</div>
      <div style={{ fontFamily:MONO, fontSize:10, color:"#6b7fa8", marginBottom:12, lineHeight:1.6 }}>
        Look up any user by email to check verification status, force-resend the verification email
        (returns the actual Resend response — exposes domain / quota / bounce errors), or manually
        mark them as verified if email delivery is blocked.
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:8, marginBottom:10 }}>
        <input data-testid="input-diag-email" type="email" placeholder="user@example.com" value={email} onChange={e=>setEmail(e.target.value)}
          onKeyDown={e => { if (e.key==="Enter") lookup(); }} style={inp} />
        <button data-testid="btn-diag-lookup" disabled={!!busy} onClick={lookup} style={btn("0,212,255", !!busy)}>
          {busy === "diag" ? "LOOKING UP…" : "🔍 LOOKUP"}
        </button>
      </div>
      {err && <div style={{ fontFamily:MONO, fontSize:10, color:"#ff6680", marginBottom:8 }}>✗ {err}</div>}
      {diag && (
        <div data-testid="panel-diag-result" style={{ background:"rgba(0,212,255,.04)", border:"1px solid rgba(0,212,255,.18)", borderRadius:4, padding:"10px 12px", marginTop:8 }}>
          {!diag.found ? (
            <div style={{ fontFamily:MONO, fontSize:11, color:"#ff6680" }}>No user found with email <strong>{diag.email}</strong></div>
          ) : (
            <>
              <div style={{ fontFamily:MONO, fontSize:11, color:"#e8e0d0", marginBottom:6 }}>
                <strong style={{ color:"#00d4ff" }}>{diag.name}</strong> — {diag.email}
              </div>
              <div style={{ fontFamily:MONO, fontSize:10, color:"#a8b3c8", lineHeight:1.7 }}>
                Tier: <strong style={{ color:"#e8c96d" }}>{diag.tier}</strong> · Verified: <strong style={{ color: diag.emailVerified?"#00e57a":"#ff6680" }}>{diag.emailVerified ? "YES" : "NO"}</strong> · Token: {diag.hasVerificationToken ? "yes" : "none"}
                {diag.promoCode && <> · Promo: <strong style={{ color:"#c9a84c" }}>{diag.promoCode}</strong></>}
              </div>
              <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
                <button data-testid="btn-diag-resend" disabled={!!busy || diag.emailVerified} onClick={resend} style={btn("0,229,255", !!busy || diag.emailVerified)}>
                  {busy === "resend" ? "SENDING…" : "✉ FORCE RESEND"}
                </button>
                <button data-testid="btn-diag-mark" disabled={!!busy || diag.emailVerified} onClick={markVerified} style={btn("232,201,109", !!busy || diag.emailVerified)}>
                  {busy === "mark" ? "MARKING…" : "✓ MARK VERIFIED (escape hatch)"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {result && (
        <div data-testid="panel-diag-action-result" style={{ background: result.ok?"rgba(0,229,122,.05)":"rgba(255,102,128,.06)", border:`1px solid ${result.ok?"rgba(0,229,122,.25)":"rgba(255,102,128,.25)"}`, borderRadius:4, padding:"10px 12px", marginTop:10 }}>
          <div style={{ fontFamily:MONO, fontSize:10, color: result.ok?"#00e57a":"#ff6680", marginBottom:6, fontWeight:700 }}>
            {result.ok ? "✓" : "✗"} {result.kind === "resend" ? "RESEND RESULT" : "MARK VERIFIED RESULT"}
          </div>
          <pre style={{ fontFamily:MONO, fontSize:9, color:"#a8b3c8", margin:0, whiteSpace:"pre-wrap", wordBreak:"break-word", maxHeight:200, overflow:"auto" }}>
            {JSON.stringify(result.data, null, 2)}
          </pre>
          {result.kind === "resend" && result.ok && (
            <div style={{ fontFamily:MONO, fontSize:9, color:"#6b7fa8", marginTop:6, lineHeight:1.5 }}>
              Email left Resend. If the user still doesn't see it: check Promotions tab, whitelist <code style={{color:"#00e5ff"}}>hello@clvrquantai.com</code>, then check Resend dashboard → Emails for delivery status.
            </div>
          )}
          {result.kind === "resend" && !result.ok && result.data?.resend_error && (
            <div style={{ fontFamily:MONO, fontSize:9, color:"#ff8c00", marginTop:6, lineHeight:1.5 }}>
              ⚠ Resend rejected the send. Most common cause: <strong>clvrquantai.com domain not verified</strong> in your Resend dashboard. Add SPF + DKIM DNS records and verify.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AIWeeklyUpdateControls({ C, MONO }) {
  const [busy, setBusy] = useState(null); // 'preview' | 'generate' | null
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState("");

  const runPreview = async () => {
    setBusy("preview"); setMsg(""); setPreview(null);
    try {
      const r = await fetch("/api/admin/weekly-update/ai-preview", { method:"POST", credentials:"include" });
      const j = await r.json();
      if (!r.ok) { setMsg("✗ " + (j?.error || "Preview failed")); return; }
      setPreview(j);
      if (!j.digest) setMsg("AI returned no digest — likely nothing user-visible shipped this week.");
    } catch (e) { setMsg("✗ " + (e?.message || "Network error")); }
    finally { setBusy(null); }
  };

  const [confirmingGen, setConfirmingGen] = useState(false);
  const runGenerate = async () => {
    if (!confirmingGen) { setConfirmingGen(true); setMsg("Click GENERATE again to confirm publishing this week's AI update."); return; }
    setConfirmingGen(false);
    setBusy("generate"); setMsg("");
    try {
      const r = await fetch("/api/admin/weekly-update/ai-generate", { method:"POST", credentials:"include" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg("✗ " + (j?.error || `Generate failed (HTTP ${r.status})`)); return; }
      if (!j.ok) { setMsg("⚠ " + (j.message || "AI produced nothing")); return; }
      setMsg(`✓ Published "${j.update?.title || ''}" with ${(j.update?.items || []).length} items. Reload to see it on the About page.`);
    } catch (e) { setMsg("✗ " + (e?.message || "Network error")); }
    finally { setBusy(null); }
  };

  const btn = (color) => ({
    background: `rgba(${color},.08)`, border:`1px solid rgba(${color},.4)`, color:`rgb(${color})`,
    borderRadius:4, padding:"8px 14px", fontFamily:MONO, fontSize:10, fontWeight:700,
    letterSpacing:"0.08em", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.5 : 1,
    marginRight:8,
  });

  return (
    <div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
        <button data-testid="btn-wu-ai-preview" disabled={!!busy} onClick={runPreview} style={btn("0,229,255")}>
          {busy === "preview" ? "PREVIEWING…" : "🔍 PREVIEW AI DIGEST"}
        </button>
        <button data-testid="btn-wu-ai-generate" disabled={!!busy} onClick={runGenerate} style={btn("232,201,109")}>
          {busy === "generate" ? "GENERATING…" : confirmingGen ? "⚠ CLICK AGAIN TO CONFIRM" : "🤖 GENERATE & PUBLISH NOW"}
        </button>
      </div>
      {msg && <div data-testid="text-wu-ai-msg" style={{ marginTop:10, fontFamily:MONO, fontSize:10, color: msg.startsWith("✓") ? "#00e57a" : msg.startsWith("⚠") ? "#c9a84c" : "#ff6680" }}>{msg}</div>}
      {preview && (
        <div data-testid="panel-wu-ai-preview" style={{ marginTop:12, background:"rgba(0,229,255,.04)", border:"1px solid rgba(0,229,255,.18)", borderRadius:6, padding:"10px 12px" }}>
          <div style={{ fontFamily:MONO, fontSize:9, color:"#00e5ff", letterSpacing:"0.15em", marginBottom:6 }}>
            AI PREVIEW · {preview.commitCount} commits scanned
          </div>
          {preview.digest ? (
            <>
              <div style={{ fontFamily:MONO, fontSize:12, color:"#e8c96d", fontWeight:700 }}>{preview.digest.title}</div>
              <div style={{ fontFamily:MONO, fontSize:10, color:"#a8b3c8", marginTop:4, marginBottom:8, lineHeight:1.6 }}>{preview.digest.summary}</div>
              {(preview.digest.items || []).map((it, i) => (
                <div key={i} style={{ display:"flex", gap:8, padding:"6px 0", borderTop: i > 0 ? "1px solid rgba(140,160,200,.1)" : "none" }}>
                  <div style={{ fontSize:14, width:22, textAlign:"center", flexShrink:0 }}>{it.emoji}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontFamily:MONO, fontSize:10, color:"#e8c96d", fontWeight:700 }}>{it.title}</div>
                    <div style={{ fontFamily:MONO, fontSize:9, color:"#a8b3c8", marginTop:2, lineHeight:1.5 }}>{it.description}</div>
                  </div>
                </div>
              ))}
              <div style={{ fontFamily:MONO, fontSize:8, color:"#5a6a8a", marginTop:8, fontStyle:"italic" }}>
                Preview only — nothing saved. Click GENERATE & PUBLISH to actually post this.
              </div>
            </>
          ) : (
            <div style={{ fontFamily:MONO, fontSize:10, color:"#a8b3c8" }}>Nothing user-visible to summarize this week.</div>
          )}
        </div>
      )}
    </div>
  );
}

function WeeklyUpdateEditor({ onSave }) {
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [items, setItems] = useState([{ emoji: "✨", title: "", description: "" }]);
  const [latest, setLatest] = useState(null);
  const [loadingLatest, setLoadingLatest] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/weekly-update/latest");
        const j = await r.json();
        if (j && j.id) setLatest(j);
      } catch {}
      setLoadingLatest(false);
    })();
  }, []);
  const inp = { width:"100%", background:"#0a1226", border:"1px solid #1c2b4a", color:"#e8e0d0", padding:"7px 10px", fontFamily:MONO, fontSize:11, borderRadius:4, boxSizing:"border-box" };
  const lbl = { fontFamily:MONO, fontSize:9, color:"#6b7fa8", letterSpacing:"0.12em", marginBottom:4, display:"block" };
  return (
    <div>
      {!loadingLatest && latest && (
        <div style={{ background:"rgba(0,229,255,.04)", border:"1px solid rgba(0,229,255,.18)", borderRadius:6, padding:"10px 12px", marginBottom:12 }}>
          <div style={{ fontFamily:MONO, fontSize:9, color:"#00e5ff", letterSpacing:"0.15em", marginBottom:4 }}>CURRENT LIVE UPDATE</div>
          <div style={{ fontFamily:MONO, fontSize:11, color:"#c8d4ee" }}>{latest.version || "(no version)"} — <strong>{latest.title}</strong></div>
          <div style={{ fontFamily:MONO, fontSize:9, color:"#6b7fa8", marginTop:4 }}>
            Posted {new Date(latest.createdAt).toLocaleString()} ·{" "}
            {latest.emailSentAt
              ? <span style={{ color:"#00e57a" }}>Emailed {new Date(latest.emailSentAt).toLocaleString()} to {latest.emailRecipientCount}</span>
              : <span style={{ color:"#c9a84c" }}>Not yet emailed</span>}
          </div>
        </div>
      )}
      <div style={{ display:"grid", gap:10 }}>
        <div>
          <label style={lbl}>VERSION (e.g. "v3 · Apr 21, 2026")</label>
          <input data-testid="input-wu-version" style={inp} value={version} onChange={e => setVersion(e.target.value)} />
        </div>
        <div>
          <label style={lbl}>HEADLINE</label>
          <input data-testid="input-wu-title" style={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="What's New This Week" />
        </div>
        <div>
          <label style={lbl}>SUMMARY (1–2 sentences)</label>
          <textarea data-testid="input-wu-summary" style={{ ...inp, minHeight:60, fontFamily:"system-ui,sans-serif" }} value={summary} onChange={e => setSummary(e.target.value)} />
        </div>
        <div>
          <label style={lbl}>FEATURE ITEMS</label>
          {items.map((it, i) => (
            <div key={i} style={{ display:"grid", gridTemplateColumns:"42px 1fr 28px", gap:6, marginBottom:6 }}>
              <input data-testid={`input-wu-emoji-${i}`} style={{ ...inp, textAlign:"center" }} value={it.emoji} onChange={e => setItems(items.map((x,j) => j===i ? { ...x, emoji:e.target.value } : x))} />
              <div style={{ display:"grid", gap:4 }}>
                <input data-testid={`input-wu-item-title-${i}`} style={inp} placeholder="Feature title" value={it.title} onChange={e => setItems(items.map((x,j) => j===i ? { ...x, title:e.target.value } : x))} />
                <textarea data-testid={`input-wu-item-desc-${i}`} style={{ ...inp, minHeight:40, fontFamily:"system-ui,sans-serif" }} placeholder="What it does in one sentence" value={it.description} onChange={e => setItems(items.map((x,j) => j===i ? { ...x, description:e.target.value } : x))} />
              </div>
              <button data-testid={`btn-wu-remove-${i}`} onClick={() => setItems(items.filter((_,j) => j!==i))} style={{ background:"rgba(255,80,100,.1)", border:"1px solid rgba(255,80,100,.3)", color:"#ff6680", borderRadius:4, cursor:"pointer", fontFamily:MONO, fontSize:14 }}>×</button>
            </div>
          ))}
          <button data-testid="btn-wu-add-item" onClick={() => setItems([...items, { emoji:"✨", title:"", description:"" }])}
            style={{ background:"rgba(201,168,76,.08)", border:"1px solid rgba(201,168,76,.3)", color:"#c9a84c", borderRadius:4, padding:"6px 12px", fontFamily:MONO, fontSize:10, cursor:"pointer", marginTop:4 }}>
            + ADD ITEM
          </button>
        </div>
        <button data-testid="btn-wu-save"
          disabled={saving || !title.trim() || !summary.trim() || items.filter(i => i.title.trim()).length === 0}
          onClick={async () => {
            setSaving(true);
            const cleanItems = items.filter(i => i.title.trim());
            try { await onSave({ version: version.trim() || null, title: title.trim(), summary: summary.trim(), items: cleanItems }); }
            finally { setSaving(false); }
            try { const r = await fetch("/api/weekly-update/latest"); const j = await r.json(); if (j && j.id) setLatest(j); } catch {}
          }}
          style={{ background:"linear-gradient(135deg,#00e5ff,#0099cc)", border:"none", color:"#080d18", borderRadius:4, padding:"10px 18px", fontFamily:MONO, fontSize:11, fontWeight:700, cursor:saving?"not-allowed":"pointer", letterSpacing:"0.08em", opacity:saving?0.6:1 }}>
          {saving ? "SAVING…" : "💾 SAVE & PUBLISH UPDATE"}
        </button>
      </div>
    </div>
  );
}

// ── Module-scope helpers for AdminTab2 (keeps components stable across renders) ──
function AdminSection({ title, color, MONO, children }) {
  return (
    <div style={{ background:"#0c1220", border:`1px solid ${color}33`, borderRadius:6, padding:18, marginBottom:16 }}>
      <div style={{ fontFamily:MONO, fontSize:9, color, letterSpacing:"0.2em", marginBottom:14 }}>{title}</div>
      {children}
    </div>
  );
}

function AdminStat({ label, value, color = "#c8d4ee", sub, MONO, SERIF }) {
  return (
    <div style={{ flex:"1 1 120px", minWidth:110, background:"#080d18", border:"1px solid #1c2b4a", borderRadius:4, padding:"10px 12px" }}>
      <div style={{ fontFamily:MONO, fontSize:8, color:"#4a5d80", letterSpacing:"0.12em", marginBottom:4 }}>{label}</div>
      <div style={{ fontFamily:SERIF, fontSize:20, fontWeight:700, color }}>{value}</div>
      {sub && <div style={{ fontFamily:MONO, fontSize:9, color:"#4a5d80", marginTop:2 }}>{sub}</div>}
    </div>
  );
}

function AdminPill({ ok, label, MONO }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontFamily:MONO, fontSize:9, padding:"3px 9px", borderRadius:3, background: ok ? "rgba(0,195,100,.12)" : "rgba(255,64,96,.12)", color: ok ? "#00e57a" : "#ff6680", border:`1px solid ${ok ? "rgba(0,195,100,.35)" : "rgba(255,64,96,.3)"}`, letterSpacing:"0.06em" }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background: ok ? "#00e57a" : "#ff4060" }}/>
      {label}
    </span>
  );
}

function AdminActionBtn({ actionKey, label, url, body, color = "#c9a84c", onRun, status, msg, MONO }) {
  return (
    <div style={{ marginBottom:10 }}>
      <button
        type="button"
        data-testid={`btn-${actionKey}`}
        onClick={() => onRun(actionKey, url, { body })}
        disabled={status === "running"}
        style={{ background:`${color}15`, border:`1px solid ${color}55`, color, borderRadius:4, padding:"8px 14px", fontFamily:MONO, fontSize:10, fontWeight:700, cursor: status === "running" ? "not-allowed" : "pointer", letterSpacing:"0.08em", opacity: status === "running" ? 0.6 : 1, marginRight:8, position:"relative", zIndex:1 }}>
        {status === "running" ? "Running…" : status === "ok" ? "✓ Done" : label}
      </button>
      {msg && <span style={{ fontFamily:MONO, fontSize:9, color: status === "ok" ? "#00e57a" : "#ff6680" }}>{msg}</span>}
    </div>
  );
}

function AdminTab2({ C, MONO, SANS, SERIF }) {
  const [trackRecord, setTrackRecord] = useState(null);
  const [signalHistory, setSignalHistory] = useState(null);
  const [thresholds, setThresholds] = useState([]);
  const [perfCtx, setPerfCtx] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [actionStatus, setActionStatus] = useState({});
  const [actionMsg, setActionMsg] = useState({});

  const loadData = async () => {
    setLoading(true); setErr(null);
    try {
      const [trRes, shRes, thRes, pcRes] = await Promise.all([
        fetch("/api/track-record", { credentials: "include" }),
        fetch("/api/signal-history?limit=100", { credentials: "include" }),
        fetch("/api/admin/thresholds", { credentials: "include" }),
        fetch("/api/performance-context", { credentials: "include" }),
      ]);
      const tr = trRes.ok ? await trRes.json() : null;
      const sh = shRes.ok ? await shRes.json() : null;
      const th = thRes.ok ? await thRes.json() : { thresholds: [] };
      const pc = pcRes.ok ? await pcRes.text() : "";
      setTrackRecord(tr);
      setSignalHistory(sh);
      setThresholds(th?.thresholds || []);
      setPerfCtx(pc);
    } catch (e) {
      setErr(e.message || "Failed to load diagnostics");
    }
    setLoading(false);
  };

  const updateThreshold = async (id, patch) => {
    try {
      const r = await fetch(`/api/admin/thresholds/${id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (r.ok) loadData();
    } catch {}
  };
  const resetToken = async (token) => {
    if (!window.confirm(`Reset adaptive learning for ${token}?`)) return;
    try {
      const r = await fetch(`/api/admin/thresholds/reset/${token}`, { method: "POST", credentials: "include" });
      if (r.ok) loadData();
    } catch {}
  };

  useEffect(() => { loadData(); }, []);

  const runAction = async (key, url, opts = {}) => {
    setActionStatus(s => ({ ...s, [key]: "running" }));
    setActionMsg(m => ({ ...m, [key]: "" }));
    try {
      const r = await fetch(url, { method: opts.method || "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: opts.body });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setActionStatus(s => ({ ...s, [key]: "ok" }));
        setActionMsg(m => ({ ...m, [key]: d.message || "Done." }));
      } else {
        setActionStatus(s => ({ ...s, [key]: "err" }));
        setActionMsg(m => ({ ...m, [key]: d.error || `HTTP ${r.status}` }));
      }
    } catch (e) {
      setActionStatus(s => ({ ...s, [key]: "err" }));
      setActionMsg(m => ({ ...m, [key]: e.message || "Network error" }));
    }
    setTimeout(() => { setActionStatus(s => ({ ...s, [key]: null })); setActionMsg(m => ({ ...m, [key]: "" })); }, 12000);
  };

  // ── Derived stats from signal history ──────────────────────────────────────
  const signals = signalHistory?.signals || [];
  const byOutcome = signals.reduce((acc, s) => { acc[s.outcome || "PENDING"] = (acc[s.outcome || "PENDING"] || 0) + 1; return acc; }, {});
  const byDirection = signals.reduce((acc, s) => {
    const d = s.direction || "?";
    if (!acc[d]) acc[d] = { total: 0, wins: 0, losses: 0, pending: 0 };
    acc[d].total++;
    if (s.outcome === "WIN") acc[d].wins++;
    else if (s.outcome === "LOSS") acc[d].losses++;
    else acc[d].pending++;
    return acc;
  }, {});
  const lastSignal = signals[0];
  const lastSignalAge = lastSignal ? Math.floor((Date.now() - new Date(lastSignal.ts).getTime()) / 60000) : null;

  // Health status badges
  const dbHealthy = trackRecord && typeof trackRecord.total === "number";
  const signalsHealthy = signalHistory && Array.isArray(signalHistory.signals);
  const workerHealthy = lastSignalAge !== null && lastSignalAge < 240; // signal in last 4h = healthy

  // Bound helper wrappers (use module-scope components so they don't remount every render)
  const Section = ({ title, color, children }) => (
    <AdminSection title={title} color={color} MONO={MONO}>{children}</AdminSection>
  );
  const Stat = ({ label, value, color, sub }) => (
    <AdminStat label={label} value={value} color={color} sub={sub} MONO={MONO} SERIF={SERIF} />
  );
  const Pill = ({ ok, label }) => (
    <AdminPill ok={ok} label={label} MONO={MONO} />
  );
  const ActionBtn = ({ actionKey, label, url, body, color }) => (
    <AdminActionBtn
      actionKey={actionKey}
      label={label}
      url={url}
      body={body}
      color={color}
      onRun={runAction}
      status={actionStatus[actionKey]}
      msg={actionMsg[actionKey]}
      MONO={MONO}
    />
  );

  if (loading) {
    return <div style={{ textAlign:"center", padding:40, fontFamily:MONO, fontSize:10, color:"#4a5d80", letterSpacing:"0.2em" }}>LOADING DIAGNOSTICS…</div>;
  }

  return (
    <div style={{ maxWidth:"100%", overflowX:"hidden", boxSizing:"border-box" }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:8 }}>
        <div>
          <div style={{ fontFamily:MONO, fontSize:9, color:"#9b59b6", letterSpacing:"0.2em", marginBottom:3 }}>📊 SYSTEM DIAGNOSTICS</div>
          <div style={{ fontSize:10, color:"#4a5d80", fontFamily:MONO }}>Track record, signal logs, resolver status & daily brief controls</div>
        </div>
        <button data-testid="btn-refresh-admin2" onClick={loadData}
          style={{ background:"rgba(155,89,182,.1)", border:"1px solid rgba(155,89,182,.35)", color:"#c39bd3", borderRadius:4, padding:"6px 14px", fontFamily:MONO, fontSize:10, fontWeight:700, cursor:"pointer", letterSpacing:"0.08em" }}>
          ↻ REFRESH
        </button>
      </div>

      {err && (
        <div style={{ background:"rgba(255,64,96,.06)", border:"1px solid rgba(255,64,96,.3)", borderRadius:4, padding:"10px 12px", marginBottom:16, fontFamily:MONO, fontSize:10, color:"#ff6680" }}>
          ⚠ {err}
        </div>
      )}

      {/* System Health */}
      <Section title="🩺 SYSTEM HEALTH" color="#00d4ff">
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:12 }}>
          <Pill ok={dbHealthy} label={dbHealthy ? "TRACK-RECORD API OK" : "TRACK-RECORD API DOWN"} />
          <Pill ok={signalsHealthy} label={signalsHealthy ? "SIGNAL-HISTORY API OK" : "SIGNAL-HISTORY API DOWN"} />
          <Pill ok={workerHealthy} label={workerHealthy ? `SIGNAL WORKER ACTIVE (${lastSignalAge}m ago)` : lastSignalAge === null ? "NO SIGNALS YET" : `WORKER STALE (${lastSignalAge}m)`} />
        </div>
        <div style={{ fontFamily:MONO, fontSize:9, color:"#4a5d80", lineHeight:1.6 }}>
          Indicators derived from live API responses. A stale worker in production usually means the signal generator interval isn't running or the DB connection dropped.
        </div>
      </Section>

      {/* Track Record Aggregate */}
      <Section title="🏆 TRACK RECORD (AGGREGATE)" color="#c9a84c">
        {trackRecord ? (
          <>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:10 }}>
              <Stat label="WIN RATE" value={`${trackRecord.winRate ?? 0}%`} color="#00e57a" />
              <Stat label="TOTAL" value={trackRecord.total ?? 0} />
              <Stat label="WINS" value={trackRecord.wins ?? 0} color="#00e57a" />
              <Stat label="LOSSES" value={trackRecord.losses ?? 0} color="#ff6680" />
              <Stat label="PENDING" value={trackRecord.pending ?? 0} color="#c9a84c" />
              <Stat label="AVG PnL" value={`${(trackRecord.avgPnl ?? 0).toFixed?.(2) ?? trackRecord.avgPnl}%`} color={trackRecord.avgPnl >= 0 ? "#00e57a" : "#ff6680"} />
            </div>
            <div style={{ fontFamily:MONO, fontSize:9, color:"#4a5d80" }}>
              Last updated: {trackRecord.lastUpdated ? new Date(trackRecord.lastUpdated).toLocaleString() : "—"}
            </div>
          </>
        ) : (
          <div style={{ fontFamily:MONO, fontSize:10, color:"#ff6680" }}>Track record unavailable. Check DB connection & signal_history table.</div>
        )}
      </Section>

      {/* Outcome Breakdown */}
      <Section title="⚖️ OUTCOME BREAKDOWN (LAST 100)" color="#9b59b6">
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:14 }}>
          {Object.entries(byOutcome).map(([k, v]) => (
            <Stat key={k} label={k} value={v} color={k === "WIN" ? "#00e57a" : k === "LOSS" ? "#ff6680" : "#c9a84c"} />
          ))}
          {Object.keys(byOutcome).length === 0 && (
            <div style={{ fontFamily:MONO, fontSize:10, color:"#4a5d80" }}>No signals in database.</div>
          )}
        </div>
        {Object.keys(byDirection).length > 0 && (
          <>
            <div style={{ fontFamily:MONO, fontSize:9, color:"#4a5d80", letterSpacing:"0.12em", marginBottom:8 }}>BY DIRECTION</div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {Object.entries(byDirection).map(([dir, s]) => {
                const resolved = s.wins + s.losses;
                const wr = resolved > 0 ? Math.round(s.wins / resolved * 100) : 0;
                return (
                  <Stat key={dir} label={dir} value={`${wr}%`} color={dir === "LONG" ? "#00e57a" : "#ff6680"} sub={`${s.wins}W / ${s.losses}L / ${s.pending}P`} />
                );
              })}
            </div>
          </>
        )}
      </Section>

      {/* Recent Signals */}
      <Section title="📝 RECENT SIGNALS (LATEST 20)" color="#00d4ff">
        {signals.length === 0 ? (
          <div style={{ fontFamily:MONO, fontSize:10, color:"#4a5d80" }}>No signals logged yet.</div>
        ) : (
          <div style={{ overflowX:"auto", maxHeight:380, overflowY:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:MONO, fontSize:10, minWidth:560 }}>
              <thead>
                <tr style={{ color:"#4a5d80", letterSpacing:"0.1em", textAlign:"left" }}>
                  <th style={{ padding:"6px 8px", borderBottom:"1px solid #1c2b4a" }}>TIME</th>
                  <th style={{ padding:"6px 8px", borderBottom:"1px solid #1c2b4a" }}>TOKEN</th>
                  <th style={{ padding:"6px 8px", borderBottom:"1px solid #1c2b4a" }}>DIR</th>
                  <th style={{ padding:"6px 8px", borderBottom:"1px solid #1c2b4a" }}>CONF</th>
                  <th style={{ padding:"6px 8px", borderBottom:"1px solid #1c2b4a" }}>OUTCOME</th>
                  <th style={{ padding:"6px 8px", borderBottom:"1px solid #1c2b4a" }}>PnL</th>
                </tr>
              </thead>
              <tbody>
                {signals.slice(0, 20).map(s => (
                  <tr key={s.id} data-testid={`row-signal-${s.id}`} style={{ color:"#c8d4ee" }}>
                    <td style={{ padding:"6px 8px", borderBottom:"1px solid #0e1a30", color:"#6b7fa8", fontSize:9 }}>{new Date(s.ts).toLocaleString([], { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" })}</td>
                    <td style={{ padding:"6px 8px", borderBottom:"1px solid #0e1a30", fontWeight:700 }}>{s.token}</td>
                    <td style={{ padding:"6px 8px", borderBottom:"1px solid #0e1a30", color: s.direction === "LONG" ? "#00e57a" : "#ff6680" }}>{s.direction}</td>
                    <td style={{ padding:"6px 8px", borderBottom:"1px solid #0e1a30", color:"#c9a84c" }}>{s.conf ?? "—"}</td>
                    <td style={{ padding:"6px 8px", borderBottom:"1px solid #0e1a30", color: s.outcome === "WIN" ? "#00e57a" : s.outcome === "LOSS" ? "#ff6680" : "#c9a84c" }}>{s.outcome || "PENDING"}</td>
                    <td style={{ padding:"6px 8px", borderBottom:"1px solid #0e1a30" }}>{s.pnlPct != null ? `${parseFloat(s.pnlPct).toFixed(2)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Note: Weekly Update + Daily Brief Controls moved to the 🛠 Admin tab
          (consolidated with the System Email Catalog + Composer). */}

      {/* Adaptive Thresholds */}
      <Section title="🧠 ADAPTIVE THRESHOLDS (AUTO-TUNING)" color="#00d4ff">
        <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap" }}>
          <AdminActionBtn actionKey="recalc-thresholds" label="↻ RECALCULATE NOW" url="/api/admin/thresholds/recalc" color="#00d4ff" onRun={runAction} status={actionStatus["recalc-thresholds"]} msg={actionMsg["recalc-thresholds"]} MONO={MONO} />
          <div style={{ fontFamily:MONO, fontSize:9, color:"#4a5d80", alignSelf:"center" }}>
            Auto-recalculates hourly. Requires ≥5 resolved signals per (token, direction) combo.
          </div>
        </div>
        {thresholds.length === 0 ? (
          <div style={{ fontFamily:MONO, fontSize:10, color:"#4a5d80" }}>No thresholds calibrated yet. Needs ≥5 resolved signals per combo in last 30 days.</div>
        ) : (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:MONO, fontSize:10 }}>
              <thead>
                <tr style={{ color:"#6b7fa8", borderBottom:"1px solid #1c2b4a" }}>
                  <th style={{ textAlign:"left", padding:"6px 8px" }}>TOKEN</th>
                  <th style={{ textAlign:"left", padding:"6px 8px" }}>DIR</th>
                  <th style={{ textAlign:"right", padding:"6px 8px" }}>WIN RATE 30d</th>
                  <th style={{ textAlign:"right", padding:"6px 8px" }}>N</th>
                  <th style={{ textAlign:"right", padding:"6px 8px" }}>THRESHOLD</th>
                  <th style={{ textAlign:"right", padding:"6px 8px" }}>ADJ</th>
                  <th style={{ textAlign:"center", padding:"6px 8px" }}>SUPPR</th>
                  <th style={{ textAlign:"center", padding:"6px 8px" }}>OVERRIDE</th>
                  <th style={{ textAlign:"right", padding:"6px 8px" }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {thresholds.map(t => {
                  const wr = parseFloat(t.winRate30d || "0");
                  const wrColor = wr >= 65 ? "#00e57a" : wr >= 50 ? "#c9a84c" : "#ff6680";
                  return (
                    <tr key={t.id} style={{ borderBottom:"1px solid #0f1a33", color:"#c8d4ee" }}>
                      <td style={{ padding:"7px 8px", fontWeight:700 }}>{t.token}</td>
                      <td style={{ padding:"7px 8px", color: t.direction === "LONG" ? "#00e57a" : "#ff6680" }}>{t.direction}</td>
                      <td style={{ padding:"7px 8px", textAlign:"right", color: wrColor, fontWeight:700 }}>{wr.toFixed(1)}%</td>
                      <td style={{ padding:"7px 8px", textAlign:"right", color:"#6b7fa8" }}>{t.sampleSize}</td>
                      <td style={{ padding:"7px 8px", textAlign:"right" }}>{t.currentThreshold}%</td>
                      <td style={{ padding:"7px 8px", textAlign:"right", color: t.adjustment > 0 ? "#ff6680" : t.adjustment < 0 ? "#00e57a" : "#4a5d80" }}>
                        {t.adjustment > 0 ? `+${t.adjustment}` : t.adjustment}
                      </td>
                      <td style={{ padding:"7px 8px", textAlign:"center" }}>
                        <input type="checkbox" checked={!!t.suppressed}
                          onChange={(e) => updateThreshold(t.id, { suppressed: e.target.checked })} />
                      </td>
                      <td style={{ padding:"7px 8px", textAlign:"center" }}>
                        <input type="checkbox" checked={!!t.manualOverride}
                          onChange={(e) => updateThreshold(t.id, { manualOverride: e.target.checked })} />
                      </td>
                      <td style={{ padding:"7px 8px", textAlign:"right" }}>
                        <button data-testid={`btn-reset-${t.token}-${t.direction}`}
                          onClick={() => resetToken(t.token)}
                          style={{ background:"rgba(255,64,96,.1)", border:"1px solid rgba(255,64,96,.35)", color:"#ff6680", borderRadius:3, padding:"3px 8px", fontFamily:MONO, fontSize:9, cursor:"pointer", fontWeight:700 }}>
                          RESET
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Performance Context (AI prompt injection preview) */}
      <Section title="🤖 AI PERFORMANCE CONTEXT (INJECTED INTO EVERY PROMPT)" color="#c9a84c">
        <pre style={{ background:"#06080d", border:"1px solid #1c2b4a", borderRadius:3, padding:10, fontFamily:MONO, fontSize:9, color:"#c8d4ee", overflowY:"auto", maxHeight:320, whiteSpace:"pre-wrap", wordBreak:"break-word", margin:0, maxWidth:"100%", boxSizing:"border-box" }}>
          {perfCtx || "(empty)"}
        </pre>
      </Section>

      {/* Raw diagnostic JSON */}
      <Section title="🔬 RAW API RESPONSES" color="#4a5d80">
        <details>
          <summary style={{ fontFamily:MONO, fontSize:10, color:"#6b7fa8", cursor:"pointer", marginBottom:8 }}>/api/track-record</summary>
          <pre style={{ background:"#06080d", border:"1px solid #1c2b4a", borderRadius:3, padding:10, fontFamily:MONO, fontSize:9, color:"#8fc4e0", overflowY:"auto", maxHeight:240, whiteSpace:"pre-wrap", wordBreak:"break-word", maxWidth:"100%", boxSizing:"border-box" }}>{JSON.stringify(trackRecord, null, 2)}</pre>
        </details>
        <details style={{ marginTop:8 }}>
          <summary style={{ fontFamily:MONO, fontSize:10, color:"#6b7fa8", cursor:"pointer", marginBottom:8 }}>/api/signal-history (summary)</summary>
          <pre style={{ background:"#06080d", border:"1px solid #1c2b4a", borderRadius:3, padding:10, fontFamily:MONO, fontSize:9, color:"#8fc4e0", overflowY:"auto", maxHeight:240, whiteSpace:"pre-wrap", wordBreak:"break-word", maxWidth:"100%", boxSizing:"border-box" }}>{JSON.stringify({ count: signals.length, isPaidUser: signalHistory?.isPaidUser, isDelayed: signalHistory?.isDelayed, firstTs: signals[0]?.ts, lastTs: signals[signals.length - 1]?.ts }, null, 2)}</pre>
        </details>
      </Section>
    </div>
  );
}

export default function AccountPage({ user, onSignOut, isPro, setShowUpgrade, onTestBell }) {
  const [tab, setTab] = useState("subscription");
  const [acct, setAcct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [toast, setToast] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [trialCode, setTrialCode] = useState(null);
  const [trialLoading, setTrialLoading] = useState(false);
  const [proCodeDuration, setProCodeDuration] = useState(1);
  const [proCodeResult, setProCodeResult] = useState(null);
  const [proCodeLoading, setProCodeLoading] = useState(false);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  useEffect(() => {
    if (user?.guest) { setLoading(false); return; } // guest users have no server session
    let cancelled = false;
    let attempts = 0;
    const tryLoad = () => {
      if (cancelled) return;
      fetch("/api/account", { credentials: "include" }).then(r => {
        if (cancelled) return null;
        if (r.status === 401) {
          if (attempts++ < 3) setTimeout(tryLoad, 1500); // retry — session may not be ready yet
          else setLoading(false);
          return null;
        }
        return r.json();
      }).then(data => {
        if (cancelled || !data) return;
        if (data.error) { setLoading(false); return; }
        setAcct(data);
        setLoading(false);
      }).catch(() => { if (!cancelled) setLoading(false); });
    };
    tryLoad();
    return () => { cancelled = true; }; // cancel stale retries on unmount
  }, [user?.id]);

  const effectiveTier = acct?.isOwner ? "elite" : (acct?.tier || "free");
  const plan = PLAN_INFO[effectiveTier] || PLAN_INFO.free;

  const handleToggleDailyEmail = async (subscribe) => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/account/toggle-daily-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscribe }),
      });
      const data = await res.json();
      if (data.ok) {
        setAcct(a => ({ ...a, dailyEmail: data.dailyEmail }));
        showToast(subscribe ? "Subscribed to Daily 6AM Brief" : "Unsubscribed from Daily 6AM Brief");
        setModal(null);
      }
    } catch (e) {}
    setActionLoading(false);
  };

  const handleManageStripe = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch (e) {}
    setActionLoading(false);
    setModal(null);
  };

  const handlePauseSubscription = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/stripe/pause", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (data.ok) {
        setAcct(a => ({ ...a, subscription: { ...a.subscription, paused: true } }));
        showToast("Subscription paused — you'll keep access until the current period ends");
        setModal(null);
      } else { showToast(data.error || "Failed to pause"); }
    } catch (e) { showToast("Failed to pause subscription"); }
    setActionLoading(false);
  };

  const handleResumeSubscription = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/stripe/resume", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (data.ok) {
        setAcct(a => ({ ...a, subscription: { ...a.subscription, paused: false } }));
        showToast("Subscription resumed!");
        setModal(null);
      } else { showToast(data.error || "Failed to resume"); }
    } catch (e) { showToast("Failed to resume subscription"); }
    setActionLoading(false);
  };

  const handleCancelSubscription = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/stripe/cancel", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (data.ok) {
        setAcct(a => ({ ...a, subscription: { ...a.subscription, cancelAtPeriodEnd: true } }));
        showToast("Subscription will cancel at period end — you keep access until then");
        setModal(null);
      } else { showToast(data.error || "Failed to cancel"); }
    } catch (e) { showToast("Failed to cancel subscription"); }
    setActionLoading(false);
  };

  const handleDowngradeToFree = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/stripe/downgrade", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (data.ok) {
        setAcct(a => ({ ...a, tier: "free", promoCode: null, promoExpiresAt: null, stripeSubscriptionId: null, subscription: null }));
        showToast("Downgraded to Free plan");
        setModal(null);
        try { localStorage.removeItem("clvr_tier"); localStorage.removeItem("clvr_code"); } catch {}
      } else { showToast(data.error || "Failed to downgrade"); }
    } catch (e) { showToast("Failed to downgrade"); }
    setActionLoading(false);
  };

  const handleDelete = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      const data = await res.json();
      if (data.ok && onSignOut) onSignOut();
    } catch (e) {}
    setActionLoading(false);
    setModal(null);
  };

  const copyReferralCode = () => {
    if (acct?.referralCode) {
      navigator.clipboard.writeText(acct.referralCode).then(() => showToast("Referral code copied!")).catch(() => showToast("Copy failed"));
    }
  };

  const loadTrialCode = async () => {
    setTrialLoading(true);
    try {
      const res = await fetch("/api/admin/current-trial-code");
      const data = await res.json();
      if (data.code) setTrialCode(data);
      else showToast(data.error || "Could not load trial code");
    } catch { showToast("Failed to load trial code"); }
    setTrialLoading(false);
  };

  const generateNewTrialCode = async () => {
    setTrialLoading(true);
    try {
      const res = await fetch("/api/admin/generate-trial-code", { method: "POST" });
      const data = await res.json();
      if (data.code) {
        setTrialCode(data);
        showToast("New trial code generated!");
      } else { showToast(data.error || "Failed to generate"); }
    } catch { showToast("Failed to generate"); }
    setTrialLoading(false);
  };

  const generateProAccessCode = async () => {
    setProCodeLoading(true);
    try {
      const res = await fetch("/api/admin/generate-access-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationMonths: proCodeDuration }),
      });
      const data = await res.json();
      if (data.code) {
        setProCodeResult(data);
        showToast(`${proCodeDuration}-month Pro code generated!`);
      } else { showToast(data.error || "Failed to generate"); }
    } catch { showToast("Failed to generate code"); }
    setProCodeLoading(false);
  };

  useEffect(() => {
    if (tab === "owner" && !trialCode) loadTrialCode();
  }, [tab]);

  const S = {
    card: { background:C.panel, border:`1px solid ${C.border}`, borderRadius:4, padding:18, marginBottom:12 },
    dangerBtn: { background:"rgba(255,64,96,.06)", border:`1px solid rgba(255,64,96,.25)`, color:C.red, borderRadius:4, padding:"8px 16px", cursor:"pointer", fontSize:11, fontWeight:600, fontFamily:MONO },
    ghostBtn: { background:C.bg, border:`1px solid ${C.border}`, color:C.muted2, borderRadius:4, padding:"8px 14px", cursor:"pointer", fontSize:11, fontFamily:MONO },
    goldBtn: { background:`linear-gradient(135deg,${C.gold},${C.gold2})`, border:"none", color:C.bg, borderRadius:4, padding:"8px 16px", cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:MONO },
  };

  const baseTabs = ["subscription", "referral", "emails", "billing", "legal"];
  const tabs = acct?.isOwner ? [...baseTabs, "owner", "admin", "admin2"] : baseTabs;

  if (loading) {
    return (
      <div style={{ textAlign:"center", padding:60 }}>
        <div style={{ fontFamily:MONO, fontSize:11, color:C.muted, letterSpacing:"0.15em" }}>LOADING ACCOUNT...</div>
      </div>
    );
  }

  if (!acct) {
    const isGuest = user?.guest;
    return (
      <div style={{ textAlign:"center", padding:60 }}>
        <div style={{ fontFamily:SERIF, fontSize:18, fontWeight:700, color:C.gold2, marginBottom:12 }}>
          {isGuest ? "Sign In to View Account" : "Account Unavailable"}
        </div>
        <div style={{ fontFamily:MONO, fontSize:11, color:C.muted2, marginBottom:20, lineHeight:1.6 }}>
          {isGuest
            ? "Create a free account or sign in to access your profile, subscription, and settings."
            : "Your session may have expired. Sign out and back in to reload your account."}
        </div>
        {!isGuest && (
          <button
            onClick={() => { setLoading(true); setAcct(null); window.location.reload(); }}
            style={{ background:"rgba(201,168,76,.1)", border:`1px solid rgba(201,168,76,.3)`, borderRadius:4, padding:"10px 20px", fontFamily:MONO, fontSize:10, color:C.gold, cursor:"pointer", letterSpacing:"0.1em" }}
          >
            SIGN OUT & RETRY
          </button>
        )}
        {onSignOut && (
          <div style={{ marginTop:12 }}>
            <button onClick={onSignOut} style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:4, padding:"8px 16px", fontFamily:MONO, fontSize:9, color:C.muted, cursor:"pointer" }}>
              {isGuest ? "SIGN IN / REGISTER" : "SIGN OUT"}
            </button>
          </div>
        )}
      </div>
    );
  }

  const promoExpiry = acct.promoExpiresAt ? new Date(acct.promoExpiresAt) : null;
  const promoDaysLeft = promoExpiry ? Math.max(0, Math.ceil((promoExpiry - Date.now()) / 86400000)) : null;

  return (
    <div style={{ fontFamily:SANS, paddingBottom:20 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
        <div>
          <div style={{ fontFamily:MONO, fontSize:8, color:C.gold, letterSpacing:"0.25em", marginBottom:4 }}>CLVRQUANT</div>
          <div style={{ fontFamily:SERIF, fontSize:18, fontWeight:700, color:C.white }}>Account Settings</div>
        </div>
      </div>

      <div style={{ ...S.card, borderColor:plan.border+"44", display:"flex", alignItems:"center", gap:14, marginBottom:18 }}>
        <div data-testid="avatar-initial" style={{ width:44, height:44, background:`linear-gradient(135deg,${C.gold},${C.gold2})`, borderRadius:4, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, fontWeight:900, color:C.bg, fontFamily:SERIF, flexShrink:0 }}>
          {acct.name?.[0] || "?"}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
            <div style={{ fontWeight:700, fontSize:14, color:C.white }}>{acct.name}</div>
            {acct.isOwner && (
              <div style={{ background:"rgba(201,168,76,.15)", border:`1px solid rgba(201,168,76,.4)`, borderRadius:3, padding:"2px 8px", fontSize:8, fontWeight:700, color:C.gold, fontFamily:MONO, letterSpacing:"0.18em", textShadow:"0 0 8px rgba(201,168,76,.5)" }}>
                FOUNDER
              </div>
            )}
          </div>
          <div style={{ fontSize:11, color:C.muted2, fontFamily:MONO }}>{acct.email}</div>
          <div style={{ fontSize:10, color:C.muted, marginTop:2, fontFamily:MONO }}>Member since {acct.memberSince}</div>
        </div>
        <div data-testid="badge-plan" style={{ background:plan.border+"22", border:`1px solid ${plan.border}55`, borderRadius:4, padding:"4px 10px", fontSize:10, fontWeight:700, color:plan.color, fontFamily:MONO, letterSpacing:"0.1em", textShadow:effectiveTier==="elite"?"0 0 8px rgba(0,229,255,.3)":undefined }}>
          {plan.label.toUpperCase()}
        </div>
      </div>

      <div style={{ display:"flex", gap:4, marginBottom:18, flexWrap:"wrap" }}>
        {tabs.map(t => {
          const isOwnerTab = t === "owner" || t === "admin" || t === "admin2";
          const label = t === "subscription" ? "Plan" : t === "referral" ? "Referral" : t === "emails" ? "Emails" : t === "billing" ? "Billing" : t === "legal" ? "Legal" : t === "owner" ? "⚡ Owner" : t === "admin" ? "🛠 Admin" : "🔧 Maintenance";
          return (
          <button key={t} data-testid={`tab-${t}`} onClick={() => setTab(t)}
            style={{ background:tab === t ? (isOwnerTab ? C.purple : C.gold) : "transparent", border:`1px solid ${tab === t ? (isOwnerTab ? C.purple : C.gold) : C.border}`, color:tab === t ? C.bg : (isOwnerTab ? C.purple : C.muted2), borderRadius:4, padding:"6px 14px", cursor:"pointer", fontSize:10, fontWeight:tab === t ? 700 : 400, fontFamily:MONO, letterSpacing:"0.06em", textTransform:"uppercase" }}>
            {label}
          </button>
          );
        })}
      </div>

      {tab === "subscription" && (
        <div>
          <div style={{ ...S.card, borderColor:plan.border+"44" }}>
            <div style={{ fontFamily:MONO, fontSize:9, color:C.muted, letterSpacing:"0.2em", marginBottom:12 }}>CURRENT PLAN</div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <div style={{ fontFamily:SERIF, fontSize:20, fontWeight:700, color:plan.color }}>{plan.label}</div>
                {acct.tier !== "free" && acct.subscription && (
                  <>
                    <div style={{ fontSize:12, color:C.muted2, marginTop:4, fontFamily:MONO }}>
                      {acct.subscription.interval === "year" ? "Annual" : "Monthly"} {acct.subscription.amount && `· ${acct.subscription.amount}`}
                    </div>
                    <div style={{ fontSize:11, color:C.muted, marginTop:2, fontFamily:MONO }}>
                      {acct.subscription.cancelAtPeriodEnd
                        ? `Cancelled — access until ${acct.subscription.currentPeriodEnd}`
                        : `Next billing: ${acct.subscription.currentPeriodEnd}`}
                    </div>
                  </>
                )}
                {acct.isOwner && <div style={{ fontSize:11, color:"#00e5ff", marginTop:4, fontFamily:MONO }}>Founder — unlimited lifetime access</div>}
                {!acct.isOwner && acct.tier === "free" && <div style={{ fontSize:11, color:C.muted, marginTop:4, fontFamily:MONO }}>Free forever — core tabs available</div>}
              </div>
              {acct.tier !== "free" && !acct.subscription?.cancelAtPeriodEnd && (
                <div style={{ fontSize:18, color:C.green }}>✓</div>
              )}
            </div>
          </div>

          {acct.promoCode && (
            <div style={{ ...S.card, borderColor:"rgba(201,168,76,.25)" }}>
              <div style={{ fontFamily:MONO, fontSize:9, color:C.gold, letterSpacing:"0.2em", marginBottom:10 }}>PROMO / ACCESS CODE</div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontFamily:MONO, fontSize:14, fontWeight:700, color:C.gold2, letterSpacing:"0.1em" }}>{acct.promoCode}</div>
                  {promoExpiry && (
                    <div style={{ fontSize:11, color:promoDaysLeft <= 14 ? C.orange : C.muted2, marginTop:4, fontFamily:MONO }}>
                      {promoDaysLeft > 0
                        ? `Expires ${promoExpiry.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${promoDaysLeft} day${promoDaysLeft !== 1 ? "s" : ""} left`
                        : "Expired"}
                    </div>
                  )}
                  {!promoExpiry && <div style={{ fontSize:11, color:C.green, marginTop:4, fontFamily:MONO }}>No expiration</div>}
                </div>
                <div style={{ fontSize:16, color:promoExpiry && promoDaysLeft <= 0 ? C.red : C.green }}>{promoExpiry && promoDaysLeft <= 0 ? "✕" : "✓"}</div>
              </div>
            </div>
          )}

          {acct.tier === "free" && (
            <div style={S.card}>
              <div style={{ fontFamily:MONO, fontSize:9, color:C.muted, letterSpacing:"0.2em", marginBottom:12 }}>UPGRADE</div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontWeight:700, color:C.gold, fontFamily:SERIF }}>Pro</div>
                  <div style={{ fontSize:11, color:C.muted2, fontFamily:MONO }}>Full AI analysis + all 9 tabs</div>
                </div>
                <button data-testid="btn-upgrade-account" onClick={() => setShowUpgrade && setShowUpgrade(true)} style={S.goldBtn}>View Plans →</button>
              </div>
            </div>
          )}

          {acct.tier !== "free" && acct.stripeSubscriptionId && (
            <div style={S.card}>
              <div style={{ fontFamily:MONO, fontSize:9, color:C.muted, letterSpacing:"0.2em", marginBottom:8 }}>MANAGE SUBSCRIPTION</div>
              {acct.subscription?.paused && (
                <div style={{ background:"rgba(255,140,0,.06)", border:`1px solid rgba(255,140,0,.2)`, borderRadius:4, padding:"10px 12px", fontSize:11, color:C.orange, marginBottom:14, lineHeight:1.6, fontFamily:MONO }}>
                  Your subscription is paused. You won't be billed until you resume.
                </div>
              )}
              {acct.subscription?.cancelAtPeriodEnd && (
                <div style={{ background:"rgba(255,64,96,.06)", border:`1px solid rgba(255,64,96,.2)`, borderRadius:4, padding:"10px 12px", fontSize:11, color:C.red, marginBottom:14, lineHeight:1.6, fontFamily:MONO }}>
                  Cancelled — you keep Pro access until {acct.subscription.currentPeriodEnd}
                </div>
              )}
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {!acct.subscription?.cancelAtPeriodEnd && !acct.subscription?.paused && (
                  <>
                    <button data-testid="btn-pause-subscription" onClick={() => setModal("pause")} disabled={actionLoading}
                      style={{ ...S.ghostBtn, width:"100%", borderColor:"rgba(255,140,0,.25)", color:C.orange }}>
                      Pause Subscription
                    </button>
                    <button data-testid="btn-cancel-subscription" onClick={() => setModal("cancel")} disabled={actionLoading}
                      style={{ ...S.ghostBtn, width:"100%", borderColor:"rgba(255,64,96,.25)", color:C.red }}>
                      Cancel Subscription
                    </button>
                  </>
                )}
                {acct.subscription?.paused && (
                  <button data-testid="btn-resume-subscription" onClick={handleResumeSubscription} disabled={actionLoading}
                    style={{ ...S.ghostBtn, width:"100%", borderColor:"rgba(0,199,135,.25)", color:C.green }}>
                    {actionLoading ? "Resuming..." : "Resume Subscription"}
                  </button>
                )}
                <button data-testid="btn-manage-stripe" onClick={handleManageStripe} disabled={actionLoading}
                  style={{ ...S.ghostBtn, width:"100%" }}>
                  Manage via Stripe →
                </button>
              </div>
            </div>
          )}

          {/* Switch to Free for promo-code Pro users (no Stripe sub) */}
          {acct.tier !== "free" && !acct.stripeSubscriptionId && !acct.isOwner && (
            <div style={S.card}>
              <div style={{ fontFamily:MONO, fontSize:9, color:C.muted, letterSpacing:"0.2em", marginBottom:8 }}>SWITCH PLAN</div>
              <div style={{ fontSize:11, color:C.muted2, lineHeight:1.6, marginBottom:12, fontFamily:MONO }}>
                Your {acct.tier === "elite" ? "Elite" : "Pro"} access is active via a promo code. Switching to Free will remove your {acct.tier === "elite" ? "Elite" : "Pro"} features immediately.
              </div>
              <button data-testid="btn-downgrade-free" onClick={() => setModal("downgrade")} disabled={actionLoading}
                style={{ ...S.ghostBtn, width:"100%", borderColor:"rgba(255,64,96,.25)", color:C.red }}>
                Switch to Free Plan
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "referral" && (
        <div>
          <div style={{ ...S.card, borderColor:"rgba(201,168,76,.25)" }}>
            <div style={{ fontFamily:MONO, fontSize:9, color:C.gold, letterSpacing:"0.2em", marginBottom:14 }}>YOUR REFERRAL CODE</div>
            <div style={{ fontFamily:SANS, fontSize:12, color:C.muted2, lineHeight:1.7, marginBottom:14 }}>
              Share your referral code with friends. When they sign up and subscribe to Pro, you earn <strong style={{ color:C.gold2 }}>1 week of free Pro access</strong>.
            </div>
            {acct.referralCode ? (
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ flex:1, background:C.bg, border:`1px solid ${C.gold}44`, borderRadius:4, padding:"14px 16px", fontFamily:MONO, fontSize:16, fontWeight:700, color:C.gold2, letterSpacing:"0.12em", textAlign:"center" }}>
                  {acct.referralCode}
                </div>
                <button data-testid="btn-copy-referral" onClick={copyReferralCode}
                  style={{ background:"rgba(201,168,76,.1)", border:`1px solid ${C.gold}44`, borderRadius:4, padding:"14px 16px", cursor:"pointer", fontFamily:MONO, fontSize:11, color:C.gold, fontWeight:700, letterSpacing:"0.08em", whiteSpace:"nowrap" }}>
                  COPY
                </button>
              </div>
            ) : (
              <div style={{ fontFamily:MONO, fontSize:11, color:C.muted, textAlign:"center", padding:14 }}>
                No referral code yet. It will be generated automatically.
              </div>
            )}
          </div>

          <div style={{ ...S.card, borderColor:"rgba(0,212,255,.12)" }}>
            <div style={{ fontFamily:MONO, fontSize:9, color:C.cyan, letterSpacing:"0.2em", marginBottom:10 }}>HOW IT WORKS</div>
            {[
              ["1. Share", "Send your referral code to friends or colleagues interested in market intelligence."],
              ["2. They Sign Up", "Your friend creates a CLVRQuant account and enters your referral code during signup."],
              ["3. They Subscribe", "When your referral upgrades to Pro (via Stripe or access code), you get rewarded."],
              ["4. You Earn", "You receive 1 week of free Pro access per successful referral. No limit on referrals."],
            ].map(([title, body]) => (
              <div key={title} style={{ marginBottom:10 }}>
                <div style={{ fontFamily:MONO, fontSize:10, fontWeight:700, color:C.white, marginBottom:2 }}>{title}</div>
                <div style={{ fontFamily:SANS, fontSize:11, color:C.muted2, lineHeight:1.6 }}>{body}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "emails" && (
        <div>
          <div style={S.card}>
            <div style={{ fontFamily:MONO, fontSize:9, color:C.muted, letterSpacing:"0.2em", marginBottom:14 }}>EMAIL PREFERENCES</div>

            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 0", borderBottom:`1px solid ${C.border}` }}>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:C.white }}>Daily 6AM Market Brief</div>
                <div style={{ fontSize:10, color:C.muted2, marginTop:2, fontFamily:MONO }}>Morning market signals + AI insights</div>
                <div style={{ fontSize:10, color:acct.dailyEmail ? C.green : C.red, marginTop:3, fontFamily:MONO }}>
                  {acct.dailyEmail ? "✓ Subscribed" : "✕ Unsubscribed"}
                </div>
              </div>
              {acct.dailyEmail ? (
                <button data-testid="btn-unsub-daily" onClick={() => setModal("unsub_daily")} style={S.dangerBtn}>Unsubscribe</button>
              ) : (
                <button data-testid="btn-sub-daily" onClick={() => handleToggleDailyEmail(true)} style={S.goldBtn}>
                  {actionLoading ? "..." : "Subscribe"}
                </button>
              )}
            </div>
          </div>

          <div style={{ ...S.card, borderColor:"rgba(0,212,255,.12)" }}>
            <div style={{ fontFamily:MONO, fontSize:9, color:C.cyan, letterSpacing:"0.2em", marginBottom:8 }}>YOUR EMAIL RIGHTS (CASL / GDPR)</div>
            <div style={{ fontSize:11, color:C.muted2, lineHeight:1.8 }}>
              Under Canada's Anti-Spam Legislation (CASL) and GDPR you have the right to:<br />
              • Unsubscribe from any email at any time<br />
              • Request deletion of your personal data<br />
              • Know what data we hold about you<br /><br />
              We will <strong style={{ color:C.text }}>never</strong> sell or share your email. All emails include an unsubscribe link.
            </div>
          </div>

          {acct.isOwner && (
            <div style={{ border:`1px solid rgba(201,168,76,0.15)`, borderRadius:8, padding:"16px", marginBottom:12, background:"rgba(201,168,76,0.03)" }}>
              <div style={{ fontFamily:MONO, fontSize:9, color:C.gold, letterSpacing:"0.2em", marginBottom:14 }}>⚡ OWNER — BROADCAST TOOLS</div>

              {/* ── Bell Test Panel ── */}
              <div style={{ border:`1px solid rgba(201,168,76,0.25)`, borderRadius:6, padding:"14px", marginBottom:16, background:"rgba(201,168,76,0.06)" }}>
                <div style={{ fontFamily:MONO, fontSize:9, color:C.gold, letterSpacing:"0.15em", marginBottom:6 }}>🔔 MARKET BELL TEST</div>
                <div style={{ fontSize:11, color:C.muted2, fontFamily:MONO, marginBottom:12, lineHeight:1.6 }}>
                  Fire the NYSE open or close bell immediately. Confirm sound is ON (🔊) in the header first. This tests both the audio and the banner.
                </div>
                <div style={{ display:"flex", gap:10 }}>
                  <button
                    data-testid="btn-test-bell-open"
                    onClick={() => onTestBell?.("open")}
                    style={{ flex:1, padding:"10px 0", borderRadius:4, border:`1px solid ${C.green}`, background:"rgba(0,199,135,.1)", color:C.green, fontFamily:MONO, fontSize:11, fontWeight:700, cursor:"pointer", letterSpacing:"0.08em" }}
                  >
                    🔔 OPEN BELL (9:30)
                  </button>
                  <button
                    data-testid="btn-test-bell-close"
                    onClick={() => onTestBell?.("close")}
                    style={{ flex:1, padding:"10px 0", borderRadius:4, border:`1px solid ${C.red}`, background:"rgba(255,64,96,.1)", color:C.red, fontFamily:MONO, fontSize:11, fontWeight:700, cursor:"pointer", letterSpacing:"0.08em" }}
                  >
                    🔔 CLOSE BELL (4pm)
                  </button>
                </div>
              </div>

              <EmailSystemHealth C={C} MONO={MONO} />
              <OwnerResendBrief C={C} MONO={MONO} />
              <OwnerEmailTool C={C} MONO={MONO}
                title="Service Disruption Apology"
                description="Send a personal apology email to all users about any recent service disruptions. Directs them to Support@CLVRQuantAI.com for questions."
                endpoint="/api/admin/send-service-apology"
                testId="btn-owner-service-apology"
                buttonLabel="📨 Send Apology to All Users"
              />
              <OwnerEmailTool C={C} MONO={MONO}
                title="Referral Promotion Email"
                description="Send a promotion email to all users encouraging them to share CLVRQuant with their referral code. They earn 1 week free Pro when their friend signs up for a paid subscription."
                endpoint="/api/admin/send-promo-email"
                testId="btn-owner-promo-email"
                buttonLabel="🎁 Send Promo to All Users"
              />
            </div>
          )}

          <div style={S.card}>
            <div style={{ fontFamily:MONO, fontSize:9, color:C.red, letterSpacing:"0.2em", marginBottom:8 }}>DANGER ZONE</div>
            <div style={{ fontSize:11, color:C.muted2, lineHeight:1.7, marginBottom:12 }}>
              {acct.isOwner
                ? "As the platform founder, your account is protected and cannot be deleted from here."
                : "Deleting your account permanently removes all your data, cancels your subscription, and unsubscribes you from all emails. This cannot be undone."}
            </div>
            <button
              data-testid="btn-delete-account"
              onClick={() => !acct.isOwner && setModal("delete")}
              disabled={acct.isOwner}
              title={acct.isOwner ? "Founder account is protected" : undefined}
              style={{ ...S.dangerBtn, opacity: acct.isOwner ? 0.35 : 1, cursor: acct.isOwner ? "not-allowed" : "pointer" }}>
              {acct.isOwner ? "🔒 Protected — Cannot Delete" : "Delete My Account"}
            </button>
          </div>
        </div>
      )}

      {tab === "billing" && (
        <div>
          {acct.subscription && acct.tier !== "free" && (
            <div style={{ ...S.card, borderColor: acct.subscription.cancelAtPeriodEnd ? "rgba(255,64,96,.25)" : acct.subscription.paused ? "rgba(255,140,0,.25)" : "rgba(0,199,135,.25)" }}>
              <div style={{ fontFamily:MONO, fontSize:9, color:C.muted, letterSpacing:"0.2em", marginBottom:12 }}>BILLING STATUS</div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontFamily:MONO, fontSize:12, fontWeight:700, color: acct.subscription.cancelAtPeriodEnd ? C.red : acct.subscription.paused ? C.orange : C.green }}>
                    {acct.subscription.cancelAtPeriodEnd ? "Cancelling" : acct.subscription.paused ? "Paused" : "Active"}
                  </div>
                  <div style={{ fontFamily:MONO, fontSize:11, color:C.muted2, marginTop:4 }}>
                    {acct.subscription.cancelAtPeriodEnd
                      ? `Access ends ${acct.subscription.currentPeriodEnd}`
                      : acct.subscription.paused
                        ? "Billing paused — no upcoming charge"
                        : `Next charge: ${acct.subscription.currentPeriodEnd}`}
                  </div>
                  {!acct.subscription.cancelAtPeriodEnd && !acct.subscription.paused && acct.subscription.amount && (
                    <div style={{ fontFamily:MONO, fontSize:10, color:C.muted, marginTop:2 }}>
                      {acct.subscription.amount}/{acct.subscription.interval === "year" ? "yr" : "mo"}
                    </div>
                  )}
                </div>
                <div style={{ fontSize:22, color: acct.subscription.cancelAtPeriodEnd ? C.red : acct.subscription.paused ? C.orange : C.green }}>
                  {acct.subscription.cancelAtPeriodEnd ? "✕" : acct.subscription.paused ? "⏸" : "✓"}
                </div>
              </div>
            </div>
          )}
          <div style={S.card}>
            <div style={{ fontFamily:MONO, fontSize:9, color:C.muted, letterSpacing:"0.2em", marginBottom:14 }}>BILLING HISTORY</div>
            {acct.invoices && acct.invoices.length > 0 ? (
              acct.invoices.map((inv, i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom: i < acct.invoices.length - 1 ? `1px solid ${C.border}` : "none" }}>
                  <div>
                    <div style={{ fontSize:12, color:C.text }}>{inv.description}</div>
                    <div style={{ fontSize:10, color:C.muted, fontFamily:MONO }}>{inv.date}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:12, fontWeight:700, color:C.white, fontFamily:MONO }}>{inv.amount}</div>
                    <div style={{ fontSize:10, color:C.green, fontFamily:MONO }}>{inv.status}</div>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ fontSize:12, color:C.muted, textAlign:"center", padding:20, fontFamily:MONO }}>
                {acct.tier === "free" ? "No billing history — you're on the Free plan." : "No invoices found."}
              </div>
            )}
          </div>

          {acct.stripeCustomerId && (
            <div style={S.card}>
              <div style={{ fontFamily:MONO, fontSize:9, color:C.muted, letterSpacing:"0.2em", marginBottom:14 }}>PAYMENT METHOD</div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontSize:12, color:C.muted2 }}>Managed through Stripe</div>
                <button data-testid="btn-update-payment" onClick={handleManageStripe} style={S.ghostBtn}>Manage →</button>
              </div>
            </div>
          )}

          <div style={{ ...S.card, fontSize:10, color:C.muted, lineHeight:1.8, fontFamily:MONO }}>
            Payments processed securely by <strong style={{ color:C.muted2 }}>Stripe</strong>. CLVRQuant never stores your card details. Statement descriptor: <strong style={{ color:C.muted2 }}>CLVRQUANT AI</strong>
          </div>
        </div>
      )}

      {tab === "legal" && (
        <div>
          {[
            {
              title: "Not Financial Advice",
              color: C.orange,
              body: "CLVRQuant provides market data and AI-generated analysis for informational and educational purposes only. Nothing on this platform constitutes financial advice, investment recommendations, or trading signals. Always do your own research.",
            },
            {
              title: "Risk Disclaimer",
              color: C.red,
              body: "Trading financial instruments involves substantial risk of loss and is not suitable for all investors. Past market data and AI analysis do not guarantee future results. You may lose all of your invested capital. CLVRQuant, Mike Claver, and affiliated entities bear no liability for any financial losses.",
            },
            {
              title: "Limitation of Liability",
              color: C.gold,
              body: "By using CLVRQuant you agree that you are solely responsible for all trading decisions. CLVRQuant Inc., its founder Mike Claver, employees, and partners cannot be held liable for any direct, indirect, incidental, or consequential financial damages arising from your use of this platform.",
            },
            {
              title: "Your Data & Privacy",
              color: C.cyan,
              body: "We collect only the data necessary to operate the platform (email, subscription status). We never sell your data. You can request deletion of all your data at any time. Governed by applicable Canadian privacy law (PIPEDA).",
            },
            {
              title: "CASL Compliance",
              color: C.green,
              body: "All marketing emails are sent in compliance with Canada's Anti-Spam Legislation (CASL). You consented to receive emails at signup. You can withdraw consent and unsubscribe at any time from the Emails tab above or via the unsubscribe link in any email.",
            },
          ].map(({ title, color, body }) => (
            <div key={title} style={{ ...S.card, borderColor:color + "22" }}>
              <div style={{ fontFamily:SERIF, fontSize:13, fontWeight:700, color, marginBottom:8 }}>{title}</div>
              <div style={{ fontSize:11, color:C.muted2, lineHeight:1.8 }}>{body}</div>
            </div>
          ))}
          <div style={{ textAlign:"center", fontFamily:MONO, fontSize:9, color:C.muted, marginTop:8, letterSpacing:"0.1em" }}>
            2025-2026 CLVRQuant · Mike Claver · Not a registered financial advisor
          </div>
        </div>
      )}

      {tab === "owner" && acct.isOwner && (
        <div>
          <div style={{ ...S.card, borderColor:"rgba(155,89,182,.35)" }}>
            <div style={{ fontFamily:MONO, fontSize:9, color:C.purple, letterSpacing:"0.2em", marginBottom:14 }}>OWNER CONTROL CENTER</div>
            <div style={{ fontFamily:SERIF, fontSize:15, fontWeight:700, color:C.white, marginBottom:4 }}>Rotating 7-Day Trial Code</div>
            <div style={{ fontSize:11, color:C.muted2, lineHeight:1.7, marginBottom:16, fontFamily:MONO }}>
              Share this code with potential users to give them 7 days of free Pro access. When redeemed, a new code is auto-generated.
            </div>

            {trialLoading ? (
              <div style={{ textAlign:"center", padding:20, fontFamily:MONO, fontSize:11, color:C.muted }}>Loading trial code...</div>
            ) : trialCode ? (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16 }}>
                <QRCode data={trialCode.code} size={200} />
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontFamily:MONO, fontSize:18, fontWeight:700, color:C.gold2, letterSpacing:"0.12em", marginBottom:6 }}>
                    {trialCode.code}
                  </div>
                  <div style={{ fontSize:11, color:C.muted2, fontFamily:MONO }}>
                    Valid until {new Date(trialCode.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </div>
                </div>
                <div style={{ display:"flex", gap:10, width:"100%" }}>
                  <button data-testid="btn-copy-trial-code" onClick={() => navigator.clipboard.writeText(trialCode.code).then(() => showToast("Trial code copied!")).catch(() => showToast("Copy failed"))}
                    style={{ ...S.goldBtn, flex:1 }}>
                    COPY CODE
                  </button>
                  <button data-testid="btn-generate-new-trial" onClick={generateNewTrialCode} disabled={trialLoading}
                    style={{ ...S.ghostBtn, flex:1 }}>
                    {trialLoading ? "Generating..." : "Generate New"}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:11, color:C.muted, fontFamily:MONO, marginBottom:12 }}>No trial code available</div>
                <button data-testid="btn-generate-trial" onClick={generateNewTrialCode} style={S.goldBtn}>
                  Generate Trial Code
                </button>
              </div>
            )}
          </div>

          {/* ── 1–3 Month Pro Access Code Generator ── */}
          <div style={{ ...S.card, borderColor:"rgba(155,89,182,.35)" }}>
            <div style={{ fontFamily:MONO, fontSize:9, color:C.purple, letterSpacing:"0.2em", marginBottom:14 }}>PRO ACCESS CODES · 1–3 MONTH</div>
            <div style={{ fontFamily:SERIF, fontSize:15, fontWeight:700, color:C.white, marginBottom:4 }}>Single-Use Pro Codes</div>
            <div style={{ fontSize:11, color:C.muted2, lineHeight:1.7, marginBottom:16, fontFamily:MONO }}>
              Generate a single-use code granting full Pro access for 1, 2, or 3 months. Each code can only be redeemed once.
            </div>
            {/* Duration selector */}
            <div style={{ display:"flex", gap:8, marginBottom:16 }}>
              {[1,2,3].map(m => (
                <button key={m} data-testid={`btn-duration-${m}`} onClick={() => { setProCodeDuration(m); setProCodeResult(null); }}
                  style={{ flex:1, padding:"8px 0", borderRadius:3, border:`1px solid ${proCodeDuration===m ? C.gold : C.border}`, background:proCodeDuration===m ? "rgba(218,165,32,.1)" : "transparent", color:proCodeDuration===m ? C.gold : C.muted2, fontFamily:MONO, fontSize:11, fontWeight:proCodeDuration===m ? 700 : 400, cursor:"pointer", letterSpacing:"0.06em" }}>
                  {m} MONTH{m>1?"S":""}
                </button>
              ))}
            </div>
            {proCodeResult ? (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:14 }}>
                <QRCode data={proCodeResult.code} size={190} />
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontFamily:MONO, fontSize:17, fontWeight:700, color:C.gold2, letterSpacing:"0.1em", marginBottom:5 }}>
                    {proCodeResult.code}
                  </div>
                  <div style={{ fontSize:10, color:C.muted2, fontFamily:MONO }}>
                    {proCodeResult.durationMonths}-month Pro · Single use · Expires {new Date(proCodeResult.expiresAt).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })}
                  </div>
                </div>
                <div style={{ display:"flex", gap:10, width:"100%" }}>
                  <button data-testid="btn-copy-pro-code" onClick={() => navigator.clipboard.writeText(proCodeResult.code).then(() => showToast("Pro code copied!")).catch(() => showToast("Copy failed"))}
                    style={{ ...S.goldBtn, flex:1 }}>
                    COPY CODE
                  </button>
                  <button data-testid="btn-generate-another-pro-code" onClick={() => setProCodeResult(null)}
                    style={{ ...S.ghostBtn, flex:1 }}>
                    New Code
                  </button>
                </div>
              </div>
            ) : (
              <button data-testid="btn-generate-pro-code" onClick={generateProAccessCode} disabled={proCodeLoading}
                style={{ ...S.goldBtn, width:"100%", opacity:proCodeLoading ? 0.7 : 1 }}>
                {proCodeLoading ? "Generating..." : `Generate ${proCodeDuration}-Month Pro Code`}
              </button>
            )}
          </div>

          <div style={{ ...S.card, borderColor:"rgba(155,89,182,.2)" }}>
            <div style={{ fontFamily:MONO, fontSize:9, color:C.purple, letterSpacing:"0.2em", marginBottom:12 }}>GROUP ACCESS CODE</div>
            <div style={{ fontFamily:MONO, fontSize:14, fontWeight:700, color:C.gold2, letterSpacing:"0.1em", marginBottom:6 }}>
              CLVR-VIP-GROUP2026
            </div>
            <div style={{ fontSize:11, color:C.muted2, lineHeight:1.6, fontFamily:MONO, marginBottom:12 }}>
              Unlimited-use group code — expires in ~1 month. Share with VIP communities, Discord, or group chats.
            </div>
            <div style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
              <QRCode data="CLVR-VIP-GROUP2026" size={120} />
              <div>
                <button data-testid="btn-copy-group-code" onClick={() => navigator.clipboard.writeText("CLVR-VIP-GROUP2026").then(() => showToast("Group code copied!")).catch(() => showToast("Copy failed"))}
                  style={{ ...S.goldBtn, marginBottom:8, width:"100%" }}>
                  COPY GROUP CODE
                </button>
                <div style={{ fontSize:10, color:C.muted, fontFamily:MONO, lineHeight:1.6 }}>
                  Unlimited uses<br />Multi-user shared code
                </div>
              </div>
            </div>
          </div>

          <div style={{ ...S.card, borderColor:"rgba(155,89,182,.2)" }}>
            <div style={{ fontFamily:MONO, fontSize:9, color:C.purple, letterSpacing:"0.2em", marginBottom:8 }}>CLVRQUANT OWNER CODE</div>
            <div style={{ fontFamily:MONO, fontSize:14, fontWeight:700, color:C.gold2, letterSpacing:"0.1em", marginBottom:6 }}>
              CLVR-OWNER-2026
            </div>
            <div style={{ fontSize:11, color:C.muted2, fontFamily:MONO }}>Your permanent owner access code. Keep private.</div>
          </div>
        </div>
      )}

      {tab === "admin" && acct.isOwner && <AdminTab C={C} MONO={MONO} SANS={SANS} SERIF={SERIF} />}

      {tab === "admin2" && acct.isOwner && <AdminTab2 C={C} MONO={MONO} SANS={SANS} SERIF={SERIF} />}

      {modal === "unsub_daily" && (
        <ConfirmModal
          title="Unsubscribe from Daily Brief?"
          message="You'll no longer receive the 6AM Daily Market Brief. You can resubscribe anytime from your account settings."
          confirmLabel={actionLoading ? "..." : "Unsubscribe"}
          confirmColor={C.red}
          onConfirm={() => handleToggleDailyEmail(false)}
          onCancel={() => setModal(null)} />
      )}

      {modal === "pause" && (
        <ConfirmModal
          title="Pause Subscription?"
          message="Your subscription will be paused. You won't be billed during the pause, but you'll keep Pro access until the current billing period ends. You can resume anytime."
          confirmLabel={actionLoading ? "Pausing..." : "Pause Subscription"}
          confirmColor={C.orange}
          onConfirm={handlePauseSubscription}
          onCancel={() => setModal(null)} />
      )}

      {modal === "cancel" && (
        <ConfirmModal
          title="Cancel Subscription?"
          message="Your subscription will cancel at the end of the current billing period. You'll keep full Pro access until then."
          warning="After cancellation, your account will revert to the Free plan with limited access (3 tabs only)."
          confirmLabel={actionLoading ? "Cancelling..." : "Cancel Subscription"}
          confirmColor={C.red}
          onConfirm={handleCancelSubscription}
          onCancel={() => setModal(null)} />
      )}

      {modal === "downgrade" && (
        <ConfirmModal
          title="Switch to Free Plan?"
          message="This will immediately remove your Pro access. Your promo code will be deactivated and you'll revert to the Free plan with 3 tabs."
          warning="This cannot be undone. Your access code cannot be reused after downgrading."
          confirmLabel={actionLoading ? "Downgrading..." : "Switch to Free"}
          confirmColor={C.red}
          onConfirm={handleDowngradeToFree}
          onCancel={() => setModal(null)} />
      )}

      {modal === "delete" && (
        <ConfirmModal
          title="We'd hate to see you go."
          message="Before you proceed — your account, data, alerts, and subscription will be permanently removed. If there's something we could improve, we'd genuinely love to hear it at Support@CLVRQuantAI.com."
          warning="This action is irreversible. All data will be erased and your subscription cancelled immediately with no refund for unused time."
          confirmLabel={actionLoading ? "Deleting..." : "Yes, delete my account"}
          confirmColor={C.red}
          onConfirm={handleDelete}
          onCancel={() => setModal(null)} />
      )}

      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

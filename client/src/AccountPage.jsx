import { useState, useEffect } from "react";

const C = {
  bg:"#050709", panel:"#0c1220", border:"#141e35", border2:"#1c2b4a",
  gold:"#c9a84c", gold2:"#e8c96d", gold3:"#f7e0a0",
  text:"#c8d4ee", muted:"#4a5d80", muted2:"#6b7fa8", white:"#f0f4ff",
  green:"#00c787", red:"#ff4060", orange:"#ff8c00", cyan:"#00d4ff",
};
const SERIF = "'Playfair Display', Georgia, serif";
const MONO  = "'IBM Plex Mono', monospace";
const SANS  = "'Barlow', system-ui, sans-serif";

const PLAN_INFO = {
  free:  { label: "Free",  color: C.muted2, border: C.border, price: "$0" },
  pro:   { label: "Pro", color: C.gold, border: C.gold, price: "$29/mo" },
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

export default function AccountPage({ user, onSignOut, isPro, setShowUpgrade }) {
  const [tab, setTab] = useState("subscription");
  const [acct, setAcct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [toast, setToast] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  useEffect(() => {
    fetch("/api/account").then(r => {
      if (r.status === 401) { if (onSignOut) onSignOut(); return null; }
      return r.json();
    }).then(data => {
      if (!data) return;
      if (data.error) { setLoading(false); return; }
      setAcct(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const plan = PLAN_INFO[acct?.tier || "free"] || PLAN_INFO.free;

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

  const S = {
    card: { background:C.panel, border:`1px solid ${C.border}`, borderRadius:4, padding:18, marginBottom:12 },
    dangerBtn: { background:"rgba(255,64,96,.06)", border:`1px solid rgba(255,64,96,.25)`, color:C.red, borderRadius:4, padding:"8px 16px", cursor:"pointer", fontSize:11, fontWeight:600, fontFamily:MONO },
    ghostBtn: { background:C.bg, border:`1px solid ${C.border}`, color:C.muted2, borderRadius:4, padding:"8px 14px", cursor:"pointer", fontSize:11, fontFamily:MONO },
    goldBtn: { background:`linear-gradient(135deg,${C.gold},${C.gold2})`, border:"none", color:C.bg, borderRadius:4, padding:"8px 16px", cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:MONO },
  };

  const tabs = ["subscription", "referral", "emails", "billing", "legal"];

  if (loading) {
    return (
      <div style={{ textAlign:"center", padding:60 }}>
        <div style={{ fontFamily:MONO, fontSize:11, color:C.muted, letterSpacing:"0.15em" }}>LOADING ACCOUNT...</div>
      </div>
    );
  }

  if (!acct) {
    return (
      <div style={{ textAlign:"center", padding:60 }}>
        <div style={{ fontFamily:MONO, fontSize:11, color:C.red, letterSpacing:"0.1em" }}>COULD NOT LOAD ACCOUNT DATA</div>
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
          <div style={{ fontWeight:700, fontSize:14, color:C.white }}>{acct.name}</div>
          <div style={{ fontSize:11, color:C.muted2, fontFamily:MONO }}>{acct.email}</div>
          <div style={{ fontSize:10, color:C.muted, marginTop:2, fontFamily:MONO }}>Member since {acct.memberSince}</div>
        </div>
        <div data-testid="badge-plan" style={{ background:plan.border+"18", border:`1px solid ${plan.border}44`, borderRadius:4, padding:"4px 10px", fontSize:10, fontWeight:700, color:plan.color, fontFamily:MONO, letterSpacing:"0.1em" }}>
          {plan.label.toUpperCase()}
        </div>
      </div>

      <div style={{ display:"flex", gap:4, marginBottom:18, flexWrap:"wrap" }}>
        {tabs.map(t => (
          <button key={t} data-testid={`tab-${t}`} onClick={() => setTab(t)}
            style={{ background:tab === t ? C.gold : "transparent", border:`1px solid ${tab === t ? C.gold : C.border}`, color:tab === t ? C.bg : C.muted2, borderRadius:4, padding:"6px 14px", cursor:"pointer", fontSize:10, fontWeight:tab === t ? 700 : 400, fontFamily:MONO, letterSpacing:"0.06em", textTransform:"uppercase" }}>
            {t === "subscription" ? "Plan" : t === "referral" ? "Referral" : t === "emails" ? "Emails" : t === "billing" ? "Billing" : "Legal"}
          </button>
        ))}
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
                {acct.tier === "free" && <div style={{ fontSize:11, color:C.muted, marginTop:4, fontFamily:MONO }}>Free forever — 3 tabs available</div>}
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
                <button data-testid="btn-upgrade-account" onClick={() => setShowUpgrade && setShowUpgrade(true)} style={S.goldBtn}>$29/mo →</button>
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

          <div style={S.card}>
            <div style={{ fontFamily:MONO, fontSize:9, color:C.red, letterSpacing:"0.2em", marginBottom:8 }}>DANGER ZONE</div>
            <div style={{ fontSize:11, color:C.muted2, lineHeight:1.7, marginBottom:12 }}>
              Deleting your account permanently removes all your data, cancels your subscription, and unsubscribes you from all emails. This cannot be undone.
            </div>
            <button data-testid="btn-delete-account" onClick={() => setModal("delete")} style={S.dangerBtn}>
              Delete My Account
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

      {modal === "delete" && (
        <ConfirmModal
          title="Delete Account Permanently?"
          message="This will permanently delete your account, cancel your subscription, remove all your data, and unsubscribe you from all emails. This action cannot be undone."
          warning="All your data will be erased immediately and cannot be recovered. Your subscription will be cancelled with no refund."
          confirmLabel={actionLoading ? "Deleting..." : "Yes, delete everything"}
          confirmColor={C.red}
          onConfirm={handleDelete}
          onCancel={() => setModal(null)} />
      )}

      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

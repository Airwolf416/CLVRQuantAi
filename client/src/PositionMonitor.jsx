import { useState, useEffect, useCallback } from "react";

export default function PositionMonitor({ C, MONO, SANS, SERIF }) {
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [analyses, setAnalyses] = useState({});   // id -> {analysis, disclaimer}
  const [busy, setBusy] = useState({});            // id -> bool
  const [form, setForm] = useState({ symbol:"", assetClass:"equity", side:"long", entryPrice:"", sizeUsd:"", leverage:"1", stopPrice:"", targetPrice:"" });
  const [prices, setPrices] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/positions", { credentials:"include" });
      const d = await r.json();
      const ps = d.positions || [];
      setPositions(ps);
      const syms = [...new Set(ps.map(p => p.symbol))].join(",");
      if (syms) {
        try { const pr = await fetch(`/api/basket-prices?syms=${encodeURIComponent(syms)}`, { credentials:"include" }); setPrices(await pr.json() || {}); } catch {}
      }
    } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const livePrice = (sym) => { const v = prices[sym]; return (v && (v.price ?? v.last ?? v)) || null; };

  async function addPosition() {
    if (!form.symbol.trim()) return;
    const body = { ...form,
      entryPrice: form.entryPrice ? Number(form.entryPrice) : null,
      sizeUsd: form.sizeUsd ? Number(form.sizeUsd) : null,
      leverage: form.leverage ? Number(form.leverage) : 1,
      stopPrice: form.stopPrice ? Number(form.stopPrice) : null,
      targetPrice: form.targetPrice ? Number(form.targetPrice) : null };
    const r = await fetch("/api/positions", { method:"POST", headers:{ "Content-Type":"application/json" }, credentials:"include", body: JSON.stringify(body) });
    if (r.ok) { setForm({ symbol:"", assetClass:"equity", side:"long", entryPrice:"", sizeUsd:"", leverage:"1", stopPrice:"", targetPrice:"" }); load(); }
  }

  async function closePosition(id) {
    await fetch(`/api/positions/${id}`, { method:"PATCH", headers:{ "Content-Type":"application/json" }, credentials:"include", body: JSON.stringify({ status:"closed" }) });
    load();
  }

  async function analyze(p) {
    setBusy(b => ({ ...b, [p.id]: true }));
    try {
      const r = await fetch(`/api/positions/${p.id}/analyze`, { method:"POST", headers:{ "Content-Type":"application/json" }, credentials:"include", body: JSON.stringify({ currentPrice: livePrice(p.symbol) }) });
      const d = await r.json();
      setAnalyses(a => ({ ...a, [p.id]: d }));
    } catch {} finally { setBusy(b => ({ ...b, [p.id]: false })); }
  }

  const field = (label, key, ph="") => (
    <div style={{ flex:"1 1 120px", minWidth:110 }}>
      <div style={{ fontFamily:MONO, fontSize:8, color:C.muted2, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:4 }}>{label}</div>
      <input value={form[key]} placeholder={ph} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        style={{ width:"100%", background:C.inputBg||"#080d18", border:`1px solid ${C.border}`, borderRadius:3, color:"#e8e0d0", padding:"8px 10px", fontFamily:MONO, fontSize:12, boxSizing:"border-box" }}/>
    </div>
  );

  return (
    <div style={{ padding:"4px 0 80px" }}>
      <div style={{ fontFamily:SERIF, fontWeight:900, fontSize:26, color:C.gold, marginBottom:4 }}>Position Monitor</div>
      <div style={{ fontFamily:SANS, fontSize:13, color:C.muted2, marginBottom:18 }}>Log your open positions and your plan. The AI measures price against <i>your</i> stop and target — it never tells you what to do.</div>

      <div style={{ background:"#0A0A0A", border:`1px solid ${C.border}`, borderRadius:6, padding:16, marginBottom:22 }}>
        <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
          {field("Symbol","symbol","NVDA")}
          <div style={{ flex:"1 1 120px", minWidth:110 }}>
            <div style={{ fontFamily:MONO, fontSize:8, color:C.muted2, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:4 }}>Class</div>
            <select value={form.assetClass} onChange={e=>setForm(f=>({...f,assetClass:e.target.value}))} style={{ width:"100%", background:C.inputBg||"#080d18", border:`1px solid ${C.border}`, borderRadius:3, color:"#e8e0d0", padding:"8px 10px", fontFamily:MONO, fontSize:12 }}>
              <option value="equity">equity</option><option value="etf">etf</option><option value="crypto">crypto</option>
            </select>
          </div>
          <div style={{ flex:"1 1 120px", minWidth:110 }}>
            <div style={{ fontFamily:MONO, fontSize:8, color:C.muted2, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:4 }}>Side</div>
            <select value={form.side} onChange={e=>setForm(f=>({...f,side:e.target.value}))} style={{ width:"100%", background:C.inputBg||"#080d18", border:`1px solid ${C.border}`, borderRadius:3, color:"#e8e0d0", padding:"8px 10px", fontFamily:MONO, fontSize:12 }}>
              <option value="long">long</option><option value="short">short</option>
            </select>
          </div>
          {field("Entry","entryPrice")}{field("Stop","stopPrice")}{field("Target","targetPrice")}
          {field("Size USD","sizeUsd")}{field("Leverage","leverage","1")}
        </div>
        <button onClick={addPosition} style={{ marginTop:14, background:"rgba(201,168,76,.14)", border:`1px solid ${C.gold}`, color:C.gold, borderRadius:4, padding:"9px 22px", fontFamily:SERIF, fontStyle:"italic", fontWeight:700, fontSize:13, cursor:"pointer" }}>Add Position</button>
      </div>

      {loading ? <div style={{ fontFamily:MONO, fontSize:12, color:C.muted2 }}>Loading…</div> :
        positions.length === 0 ? <div style={{ fontFamily:MONO, fontSize:12, color:C.muted2 }}>No open positions yet.</div> :
        positions.map(p => {
          const lp = livePrice(p.symbol); const a = analyses[p.id];
          return (
            <div key={p.id} style={{ background:"#0A0A0A", border:`1px solid ${C.border}`, borderRadius:6, padding:16, marginBottom:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
                <div style={{ fontFamily:SERIF, fontWeight:900, fontSize:18, color:"#e8e0d0" }}>{p.symbol} <span style={{ fontFamily:MONO, fontSize:11, color:C.muted2 }}>{p.side} {Number(p.leverage)}x · {p.asset_class}</span></div>
                <div style={{ fontFamily:MONO, fontSize:12, color:C.gold }}>{lp ? `$${Number(lp).toLocaleString()}` : "—"}</div>
              </div>
              <div style={{ fontFamily:MONO, fontSize:11, color:C.muted2, marginTop:8, lineHeight:1.9 }}>
                Entry {p.entry_price ?? "—"} · Stop {p.stop_price ?? "—"} · Target {p.target_price ?? "—"} · Size {p.size_usd ?? "—"}
              </div>
              <div style={{ display:"flex", gap:10, marginTop:12 }}>
                <button onClick={()=>analyze(p)} disabled={busy[p.id]} style={{ background:"rgba(201,168,76,.10)", border:`1px solid ${C.gold}`, color:C.gold, borderRadius:4, padding:"7px 16px", fontFamily:MONO, fontSize:11, letterSpacing:"0.06em", textTransform:"uppercase", cursor:"pointer" }}>{busy[p.id] ? "Analyzing…" : "AI Read"}</button>
                <button onClick={()=>closePosition(p.id)} style={{ background:"transparent", border:`1px solid ${C.border}`, color:C.muted2, borderRadius:4, padding:"7px 16px", fontFamily:MONO, fontSize:11, letterSpacing:"0.06em", textTransform:"uppercase", cursor:"pointer" }}>Close</button>
              </div>
              {a && a.analysis && (
                <div style={{ marginTop:14, borderTop:`1px solid ${C.border}`, paddingTop:14 }}>
                  <div style={{ fontFamily:MONO, fontSize:12, color:"#c5cfe0", lineHeight:1.7 }}>{a.analysis.planDistance}</div>
                  {a.analysis.catalyst && <div style={{ fontFamily:MONO, fontSize:12, color:"#c5cfe0", marginTop:8, lineHeight:1.7 }}>{a.analysis.catalyst}</div>}
                  {Array.isArray(a.analysis.considerations) && (
                    <ul style={{ margin:"10px 0 0", paddingLeft:18, color:C.muted2, fontFamily:SANS, fontSize:12.5, lineHeight:1.7 }}>
                      {a.analysis.considerations.map((c,i)=><li key={i}>{c}</li>)}
                    </ul>
                  )}
                  {a.analysis.neuroNudge && <div style={{ marginTop:10, fontFamily:SERIF, fontStyle:"italic", fontSize:12.5, color:C.gold }}>{a.analysis.neuroNudge}</div>}
                  <div style={{ marginTop:12, fontFamily:MONO, fontSize:9, color:C.muted2, letterSpacing:"0.08em" }}>{a.disclaimer}</div>
                </div>
              )}
            </div>
          );
        })
      }
    </div>
  );
}

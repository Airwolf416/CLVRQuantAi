// ─────────────────────────────────────────────────────────────────────────────
// MarketTab.jsx — CLVRQuant AI · Live Market Intelligence
// 4 sub-views: PRICES | SPREADS | CORRELATIONS | NEWS
// Feeds from MarketDataStore.js — zero independent price fetches
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo } from "react";
import useMarketData, {
  fmtPrice, fmtChange, fmtFunding,
  changeColor, sigColor, computeVolatility, VolatilityBar,
} from "../store/MarketDataStore.jsx";

const mono  = "'IBM Plex Mono', monospace";
const serif = "'Playfair Display', Georgia, serif";

const C = {
  bg:"#060a13", surface:"rgba(255,255,255,0.025)", border:"rgba(255,255,255,0.07)",
  gold:"#d4af37", green:"#00ff88", red:"#ff2d55", neutral:"#f59e0b",
  text:"#e8e8f0", muted:"#3a4560", muted2:"#6b7a99",
  panel:"rgba(255,255,255,0.025)",
};

function clsHex(cls) {
  return cls==="equity" ? "59,130,246" : cls==="commodity" ? "212,175,55" : "153,69,255";
}
function clsCol(cls) {
  return cls==="equity" ? "#3b82f6" : cls==="commodity" ? "#d4af37" : "#9945ff";
}
function clsLabel(cls) {
  return cls==="equity" ? "EQ" : cls==="commodity" ? "COM" : "PERP";
}

// ─── Master Header ───────────────────────────────────────────────────────────
function MasterHeader({ marketMode, sentiment, lastUpdate, loading, totalMarkets, onRefresh }) {
  const score  = marketMode?.score  ?? 50;
  const regime = marketMode?.regime ?? "NEUTRAL";
  const col    = sigColor(regime);
  const hex    = regime==="RISK-ON" ? "0,255,136" : regime==="RISK-OFF" ? "255,45,85" : "245,158,11";

  return (
    <div style={{
      background:`linear-gradient(135deg,rgba(${hex},0.07),rgba(6,10,19,0.98))`,
      border:`1px solid rgba(${hex},0.12)`, borderRadius:12, padding:"14px 14px 11px", marginBottom:10,
      position:"relative", overflow:"hidden",
    }}>
      <div style={{position:"absolute",inset:0,opacity:0.015,
        backgroundImage:"linear-gradient(rgba(212,175,55,1) 1px,transparent 1px),linear-gradient(90deg,rgba(212,175,55,1) 1px,transparent 1px)",
        backgroundSize:"20px 20px"}}/>
      <div style={{position:"relative"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
              <div style={{width:28,height:28,borderRadius:7,
                background:"linear-gradient(135deg,#d4af37,#f5d062)",
                display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:13,fontWeight:900,color:"#060a13",fontFamily:serif}}>C</div>
              <div>
                <div style={{fontSize:8,color:C.muted,letterSpacing:2,fontFamily:mono}}>CLVR AI · MARKET INTELLIGENCE</div>
                <div style={{fontSize:7,color:"rgba(58,69,96,0.7)",fontFamily:mono}}>
                  {totalMarkets} LIVE MARKETS · {lastUpdate ? `↻ ${new Date(lastUpdate).toLocaleTimeString()}` : "connecting…"}
                </div>
              </div>
            </div>
            <div style={{fontSize:22,fontWeight:900,color:col,fontFamily:mono,lineHeight:1}}>
              {loading&&!marketMode ? "LOADING…" : regime}
            </div>
            {marketMode?.vix?.price > 0 && (
              <div style={{fontSize:8,color:C.muted2,fontFamily:mono,marginTop:2}}>
                VIX {marketMode.vix.price.toFixed(1)} · <span style={{color:sigColor(marketMode.vix.regime)}}>{marketMode.vix.regime}</span>
              </div>
            )}
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:7,color:C.muted,fontFamily:mono,marginBottom:1}}>RISK-ON SCORE</div>
            <div style={{fontSize:30,fontWeight:900,color:col,fontFamily:mono,lineHeight:1}}>
              {score}<span style={{fontSize:14}}>%</span>
            </div>
            <button onClick={onRefresh} data-testid="market-refresh" style={{marginTop:5,background:"transparent",
              border:"1px solid rgba(212,175,55,0.2)",borderRadius:5,padding:"2px 9px",
              color:"#d4af37",fontSize:7,cursor:"pointer",fontFamily:mono}}>↻ REFRESH</button>
          </div>
        </div>

        <div style={{height:3,background:"rgba(255,255,255,0.05)",borderRadius:3,marginBottom:8,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${score}%`,background:`linear-gradient(90deg,${col}40,${col})`,
            borderRadius:3,transition:"width 1.5s ease"}}/>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5,marginBottom:6}}>
          {[
            {label:"CRYPTO",    d:marketMode?.crypto,      h:"153,69,255"},
            {label:"EQUITIES",  d:marketMode?.equities,    h:"59,130,246"},
            {label:"COMMODITIES",d:marketMode?.commodities,h:"212,175,55"},
          ].map(({label,d,h})=>{
            const sc=d?.score??50; const rg=d?.regime??"NEUTRAL"; const c=sigColor(rg);
            return (
              <div key={label} style={{background:`rgba(${h},0.05)`,border:`1px solid rgba(${h},0.12)`,borderRadius:7,padding:"6px 8px"}}>
                <div style={{fontSize:6,color:C.muted,letterSpacing:1.5,fontFamily:mono,marginBottom:2}}>{label}</div>
                <div style={{fontSize:13,fontWeight:900,color:c,fontFamily:mono}}>{sc}%</div>
                <div style={{fontSize:7,color:c,fontFamily:mono,marginBottom:2}}>{rg}</div>
                <div style={{height:2,background:"rgba(255,255,255,0.05)",borderRadius:2,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${sc}%`,background:c,borderRadius:2}}/>
                </div>
              </div>
            );
          })}
        </div>

        {marketMode?.correlations?.length > 0 && (
          <div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:4}}>
            {marketMode.correlations.slice(0,2).map((cor,i)=>(
              <div key={i} style={{
                background:`rgba(${sigColor(cor.signal)==="#00ff88"?"0,255,136":sigColor(cor.signal)==="#ff2d55"?"255,45,85":"245,158,11"},0.07)`,
                border:`1px solid ${sigColor(cor.signal)}18`,
                borderRadius:4,padding:"2px 7px",display:"flex",alignItems:"center",gap:3}}>
                <span style={{width:3,height:3,borderRadius:"50%",background:sigColor(cor.signal),flexShrink:0}}/>
                <span style={{fontSize:7,color:sigColor(cor.signal),fontFamily:mono,fontWeight:700}}>{cor.signal}:</span>
                <span style={{fontSize:7,color:C.muted2,fontFamily:mono}}>{cor.msg.slice(0,45)}{cor.msg.length>45?"…":""}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{fontSize:7,color:"rgba(42,53,80,0.8)",fontFamily:mono}}>
          Perps: Hyperliquid (auto-discovers new listings) · Spot: Finnhub · 15s refresh
        </div>
      </div>
    </div>
  );
}

// ─── Asset Row ───────────────────────────────────────────────────────────────
function AssetRow({ ticker, meta, spotData, perpData, spread, isSelected, onSelect }) {
  const cls    = meta?.class || "crypto";
  const color  = clsCol(cls);
  const hex    = clsHex(cls);
  const label  = clsLabel(cls);

  const price  = cls==="crypto" ? (perpData?.price||0) : (spotData?.price||perpData?.price||0);
  const change = cls==="crypto" ? (perpData?.change24h||0) : (spotData?.change24h||perpData?.change24h||0);
  const fund   = perpData?.funding || 0;
  const chCol  = changeColor(change);
  const fundCol= fund>0?"#f87171":fund<0?"#4ade80":"#6b7a99";
  const vol    = computeVolatility(ticker, perpData, cls);

  return (
    <div
      data-testid={`asset-row-${ticker}`}
      onClick={()=>onSelect(ticker)}
      style={{
        padding:"8px 11px",
        background:isSelected?`rgba(${hex},0.07)`:"transparent",
        borderBottom:"1px solid rgba(255,255,255,0.04)",
        borderLeft:`2px solid ${isSelected?color:"transparent"}`,
        cursor:"pointer", transition:"all 0.12s",
      }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:cls!=="crypto"&&(spotData||perpData)?4:0}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <span style={{fontSize:14,lineHeight:1,flexShrink:0}}>{meta?.icon||"◆"}</span>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:11,fontWeight:800,color:C.text,fontFamily:mono}}>{ticker}</span>
              <span style={{fontSize:6,color:color,fontFamily:mono,letterSpacing:1,
                background:`rgba(${hex},0.12)`,padding:"1px 5px",borderRadius:3}}>{label}</span>
              {perpData?.maxLeverage>0&&(
                <span style={{fontSize:6,color:C.muted,fontFamily:mono}}>{perpData.maxLeverage}x</span>
              )}
            </div>
            <div style={{fontSize:7,color:C.muted,fontFamily:mono}}>{meta?.name||ticker}</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <VolatilityBar vol={vol}/>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:12,fontWeight:800,color:C.text,fontFamily:mono}}>
              {price>0?fmtPrice(price):"—"}
            </div>
            <div style={{fontSize:9,fontWeight:700,color:chCol,fontFamily:mono}}>{fmtChange(change)}</div>
          </div>
        </div>
      </div>

      {cls!=="crypto"&&(
        <div style={{display:"flex",gap:4}}>
          {spotData?.price>0&&(
            <div style={{background:"rgba(59,130,246,0.07)",borderRadius:4,padding:"2px 6px",flex:1}}>
              <div style={{fontSize:6,color:C.muted,fontFamily:mono}}>SPOT·{spotData.source||"FH"}</div>
              <div style={{fontSize:8,fontWeight:700,color:"#93c5fd",fontFamily:mono}}>{fmtPrice(spotData.price)}</div>
            </div>
          )}
          {perpData?.price>0&&(
            <div style={{background:"rgba(153,69,255,0.07)",borderRadius:4,padding:"2px 6px",flex:1}}>
              <div style={{fontSize:6,color:C.muted,fontFamily:mono}}>PERP·HL</div>
              <div style={{fontSize:8,fontWeight:700,color:"#c084fc",fontFamily:mono}}>{fmtPrice(perpData.price)}</div>
            </div>
          )}
          {spread&&(
            <div style={{background:`rgba(${spread.spreadPct>0?"0,255,136":"255,45,85"},0.07)`,borderRadius:4,padding:"2px 6px",flex:1}}>
              <div style={{fontSize:6,color:C.muted,fontFamily:mono}}>SPREAD</div>
              <div style={{fontSize:8,fontWeight:700,fontFamily:mono,
                color:spread.spreadPct>0.5?"#00ff88":spread.spreadPct<-0.5?"#ff2d55":"#f59e0b"}}>
                {spread.spreadPct>0?"+":""}{spread.spreadPct.toFixed(2)}%
              </div>
            </div>
          )}
          {fund!==0&&(
            <div style={{background:"rgba(255,255,255,0.03)",borderRadius:4,padding:"2px 6px",flex:1}}>
              <div style={{fontSize:6,color:C.muted,fontFamily:mono}}>FUND/HR</div>
              <div style={{fontSize:8,fontWeight:700,color:fundCol,fontFamily:mono}}>{fmtFunding(fund)}</div>
            </div>
          )}
        </div>
      )}

      {cls==="crypto"&&(fund!==0||(perpData?.openInterest||0)>0)&&(
        <div style={{display:"flex",gap:8,marginTop:2}}>
          {fund!==0&&(
            <span style={{fontSize:7,color:fundCol,fontFamily:mono}}>
              {fund>0?"▲":"▼"} {fmtFunding(fund)}/hr
            </span>
          )}
          {(perpData?.openInterest||0)>0&&(
            <span style={{fontSize:7,color:C.muted,fontFamily:mono}}>
              OI ${perpData.openInterest>=1000?`${(perpData.openInterest/1000).toFixed(1)}B`:`${perpData.openInterest.toFixed(0)}M`}
            </span>
          )}
          {(perpData?.volume24h||0)>0&&(
            <span style={{fontSize:7,color:"rgba(58,69,96,0.7)",fontFamily:mono}}>
              Vol ${perpData.volume24h>=1000?`${(perpData.volume24h/1000).toFixed(1)}B`:`${perpData.volume24h.toFixed(0)}M`}
            </span>
          )}
          <span style={{fontSize:7,color:"rgba(58,69,96,0.5)",fontFamily:mono}}>HL Live</span>
        </div>
      )}
    </div>
  );
}

// ─── Asset Detail Panel ──────────────────────────────────────────────────────
function AssetDetail({ ticker, meta, spot, perp, spread }) {
  if (!ticker) return null;
  const cls    = meta?.class || "crypto";
  const color  = clsCol(cls);
  const price  = cls==="crypto"?(perp?.price||0):(spot?.price||perp?.price||0);
  const change = cls==="crypto"?(perp?.change24h||0):(spot?.change24h||perp?.change24h||0);
  const fund   = perp?.funding||0;
  const fundCol= fund>0?"#f87171":fund<0?"#4ade80":"#6b7a99";

  const spreadExplain = spread
    ? (spread.spreadPct>0.5
        ? `Perp trading ${spread.spreadPct.toFixed(2)}% ABOVE spot — futures market is more bullish. Longs are paying a premium. Funding pressure to the upside.`
        : spread.spreadPct<-0.5
          ? `Perp trading ${Math.abs(spread.spreadPct).toFixed(2)}% BELOW spot — futures market is more bearish than physical. Shorts are aggressive.`
          : `Perp and spot are aligned (${spread.spreadPct.toFixed(2)}% gap). No meaningful futures vs spot divergence.`)
    : null;

  const fundExplain = fund>0
    ? `Longs paying shorts ${fmtFunding(fund)}/hr — market is net long, elevated squeeze risk`
    : fund<0
      ? `Shorts paying longs ${fmtFunding(Math.abs(fund))}/hr — market is net short, potential squeeze up`
      : "Funding is neutral";

  return (
    <div style={{background:C.surface,border:`1px solid ${color}22`,borderRadius:10,padding:"12px",marginBottom:10}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:20}}>{meta?.icon||"◆"}</span>
          <div>
            <div style={{fontSize:14,fontWeight:900,color:C.text,fontFamily:mono}}>{ticker}</div>
            <div style={{fontSize:9,color:C.muted,fontFamily:mono}}>{meta?.name}</div>
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:16,fontWeight:900,color:C.text,fontFamily:mono}}>{price>0?fmtPrice(price):"—"}</div>
          <div style={{fontSize:10,fontWeight:700,color:changeColor(change),fontFamily:mono}}>{fmtChange(change)}</div>
          <div style={{fontSize:7,color:C.muted,fontFamily:mono}}>Source: {spot?.source||perp?.source||"HL"}</div>
        </div>
      </div>

      {spread&&(
        <div style={{background:"rgba(255,255,255,0.03)",border:`1px solid rgba(255,255,255,0.06)`,borderRadius:7,padding:"8px 10px",marginBottom:8}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <span style={{fontSize:7,color:C.muted,fontFamily:mono}}>SPOT ({spot?.source||"FH"})</span>
            <span style={{fontSize:7,color:C.muted,fontFamily:mono}}>PERP (HL)</span>
            <span style={{fontSize:7,color:C.muted,fontFamily:mono}}>SPREAD</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <span style={{fontSize:11,fontWeight:700,color:"#93c5fd",fontFamily:mono}}>{fmtPrice(spread.spotPrice)}</span>
            <span style={{fontSize:11,fontWeight:700,color:"#c084fc",fontFamily:mono}}>{fmtPrice(spread.perpPrice)}</span>
            <span style={{fontSize:11,fontWeight:700,fontFamily:mono,
              color:spread.spreadPct>0.5?"#00ff88":spread.spreadPct<-0.5?"#ff2d55":"#f59e0b"}}>
              {spread.spreadPct>0?"+":""}{spread.spreadPct.toFixed(2)}%
            </span>
          </div>
          <div style={{fontSize:9,color:C.muted2,fontFamily:mono,lineHeight:1.6}}>{spreadExplain}</div>
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:8}}>
        {[
          {l:"24h Change",v:fmtChange(change),c:changeColor(change)},
          {l:"Funding/hr",v:fmtFunding(fund),c:fundCol},
          {l:"Open Interest",v:perp?.openInterest?(perp.openInterest>=1000?`$${(perp.openInterest/1000).toFixed(1)}B`:`$${perp.openInterest.toFixed(0)}M`):"—",c:C.text},
          {l:"24h Volume",v:perp?.volume24h?(perp.volume24h>=1000?`$${(perp.volume24h/1000).toFixed(1)}B`:`$${perp.volume24h.toFixed(0)}M`):"—",c:C.text},
          {l:"Oracle Price",v:perp?.oraclePx>0?fmtPrice(perp.oraclePx):"—",c:C.muted2},
          {l:"Prev Close",v:spot?.prevClose>0?fmtPrice(spot.prevClose):perp?.prevDayPx>0?fmtPrice(perp.prevDayPx):"—",c:C.muted2},
        ].map(({l,v,c})=>(
          <div key={l} style={{background:"rgba(255,255,255,0.02)",borderRadius:5,padding:"5px 7px"}}>
            <div style={{fontSize:6,color:C.muted,fontFamily:mono,marginBottom:1}}>{l}</div>
            <div style={{fontSize:9,fontWeight:700,color:c,fontFamily:mono}}>{v}</div>
          </div>
        ))}
      </div>

      {fund!==0&&(
        <div style={{fontSize:8,color:C.muted2,fontFamily:mono,lineHeight:1.6,background:"rgba(255,255,255,0.02)",borderRadius:5,padding:"5px 8px"}}>
          💡 {fundExplain}
        </div>
      )}
    </div>
  );
}

// ─── PRICES sub-view ─────────────────────────────────────────────────────────
function PricesView({ perps, spot, spreads, discoveredAssets, byClass }) {
  const [classFilter, setClassFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("volume");
  const [sortDir, setSortDir] = useState(-1);
  const [selected, setSelected] = useState(null);

  const filterTabs = [
    {k:"all",l:"ALL"},
    {k:"crypto",l:"CRYPTO"},
    {k:"equity",l:"EQUITIES"},
    {k:"commodity",l:"COMMODITIES"},
  ];

  const rows = useMemo(()=>{
    const tickers = classFilter==="all"
      ? Object.keys(discoveredAssets)
      : (byClass[classFilter]||[]);

    return tickers
      .filter(t=>{
        const meta=discoveredAssets[t];
        const p=perps[t]?.price||spot[t]?.price||0;
        if(!p) return false; // hide assets with no live price
        if(search){
          const q=search.toLowerCase();
          return t.toLowerCase().includes(q)||(meta?.name||"").toLowerCase().includes(q);
        }
        return true;
      })
      .map(t=>({
        ticker:t, meta:discoveredAssets[t],
        perpData:perps[t], spotData:spot[t], spread:spreads[t],
      }))
      .sort((a,b)=>{
        let va=0,vb=0;
        if(sortBy==="volume"){va=a.perpData?.volume24h||0;vb=b.perpData?.volume24h||0;}
        else if(sortBy==="change"){va=Math.abs(a.perpData?.change24h||a.spotData?.change24h||0);vb=Math.abs(b.perpData?.change24h||b.spotData?.change24h||0);}
        else if(sortBy==="funding"){va=Math.abs(a.perpData?.funding||0);vb=Math.abs(b.perpData?.funding||0);}
        else if(sortBy==="oi"){va=a.perpData?.openInterest||0;vb=b.perpData?.openInterest||0;}
        return sortDir*(vb-va);
      });
  }, [classFilter, search, sortBy, sortDir, perps, spot, spreads, discoveredAssets, byClass]);

  const selectedMeta = selected ? discoveredAssets[selected] : null;
  const counts = {
    all: Object.keys(discoveredAssets).filter(t=>(perps[t]?.price||spot[t]?.price||0)>0).length,
    crypto: (byClass.crypto||[]).filter(t=>(perps[t]?.price||0)>0).length,
    equity: (byClass.equity||[]).filter(t=>(perps[t]?.price||spot[t]?.price||0)>0).length,
    commodity: (byClass.commodity||[]).filter(t=>(perps[t]?.price||spot[t]?.price||0)>0).length,
  };

  const toggleSort = (key) => {
    if(sortBy===key) setSortDir(d=>-d);
    else { setSortBy(key); setSortDir(-1); }
  };

  return (
    <div>
      {/* Class filter pills */}
      <div style={{display:"flex",gap:4,marginBottom:8,flexWrap:"wrap"}}>
        {filterTabs.map(({k,l})=>(
          <button key={k} data-testid={`class-filter-${k}`} onClick={()=>{setClassFilter(k);setSelected(null);}}
            style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${classFilter===k?"rgba(212,175,55,0.4)":"rgba(255,255,255,0.07)"}`,
              background:classFilter===k?"rgba(212,175,55,0.08)":"transparent",
              color:classFilter===k?"#d4af37":C.muted2,cursor:"pointer",fontFamily:mono,fontSize:9,letterSpacing:1}}>
            {l} <span style={{opacity:0.5}}>({counts[k]||0})</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        data-testid="market-search"
        placeholder="Search ticker or name…"
        value={search}
        onChange={e=>setSearch(e.target.value)}
        style={{width:"100%",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",
          borderRadius:7,padding:"6px 10px",color:C.text,fontFamily:mono,fontSize:10,
          outline:"none",marginBottom:8,boxSizing:"border-box"}}
      />

      {/* Sort header */}
      <div style={{display:"flex",gap:3,marginBottom:5}}>
        {[
          {k:"volume",l:"VOLUME"},
          {k:"change",l:"24H CHG"},
          {k:"funding",l:"FUNDING"},
          {k:"oi",l:"OI"},
        ].map(({k,l})=>(
          <button key={k} data-testid={`sort-${k}`} onClick={()=>toggleSort(k)}
            style={{padding:"3px 8px",borderRadius:5,border:`1px solid ${sortBy===k?"rgba(212,175,55,0.3)":"rgba(255,255,255,0.05)"}`,
              background:sortBy===k?"rgba(212,175,55,0.07)":"transparent",
              color:sortBy===k?"#d4af37":C.muted,cursor:"pointer",fontFamily:mono,fontSize:7,letterSpacing:1}}>
            {l} {sortBy===k?(sortDir<0?"↓":"↑"):""}
          </button>
        ))}
      </div>

      {/* Detail panel */}
      {selected&&(
        <AssetDetail
          ticker={selected}
          meta={selectedMeta}
          spot={spot[selected]}
          perp={perps[selected]}
          spread={spreads[selected]}
        />
      )}

      {/* Asset list */}
      <div style={{background:C.surface,border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,overflow:"hidden"}}>
        {rows.length===0?(
          <div style={{padding:32,textAlign:"center",color:C.muted,fontFamily:mono,fontSize:10}}>
            {Object.keys(discoveredAssets).length===0?"Connecting to Hyperliquid…":"No assets match your filter"}
          </div>
        ):rows.map(({ticker,meta,perpData,spotData,spread})=>(
          <AssetRow
            key={ticker}
            ticker={ticker}
            meta={meta}
            spotData={spotData}
            perpData={perpData}
            spread={spread}
            isSelected={selected===ticker}
            onSelect={(t)=>setSelected(selected===t?null:t)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── SPREADS sub-view ────────────────────────────────────────────────────────
function SpreadsView({ spreads, discoveredAssets }) {
  const rows = Object.entries(spreads)
    .filter(([,s])=>s.spotPrice>0&&s.perpPrice>0)
    .sort(([,a],[,b])=>Math.abs(b.spreadPct)-Math.abs(a.spreadPct));

  return (
    <div>
      <div style={{background:"rgba(212,175,55,0.04)",border:"1px solid rgba(212,175,55,0.12)",borderRadius:8,
        padding:"10px 12px",marginBottom:10}}>
        <div style={{fontSize:8,color:"#d4af37",fontFamily:mono,letterSpacing:1.5,marginBottom:4}}>WHAT IS SPOT vs PERP SPREAD?</div>
        <div style={{fontSize:10,color:C.muted2,fontFamily:mono,lineHeight:1.7}}>
          Perpetual futures can trade at a premium or discount to the spot price.
          A <span style={{color:"#00ff88"}}>PREMIUM</span> means futures buyers are paying up — bullish bias.
          A <span style={{color:"#ff2d55"}}>DISCOUNT</span> means futures are cheaper — bearish bias or forced liquidations.
          Extreme spreads often precede reversions.
        </div>
      </div>
      <div style={{background:C.surface,border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",gap:0,padding:"6px 10px",
          borderBottom:"1px solid rgba(255,255,255,0.06)",background:"rgba(255,255,255,0.02)"}}>
          {["ASSET","SPOT","PERP","SPREAD"].map(h=>(
            <div key={h} style={{fontFamily:mono,fontSize:7,color:C.muted,letterSpacing:1}}>{h}</div>
          ))}
        </div>
        {rows.length===0?(
          <div style={{padding:24,textAlign:"center",color:C.muted,fontFamily:mono,fontSize:10}}>
            No spread data yet — waiting for spot+perp prices…
          </div>
        ):rows.map(([ticker,s])=>{
          const meta = discoveredAssets[ticker]||{};
          const severityCol = s.severity==="HIGH"?"#ff2d55":s.severity==="MODERATE"?"#f59e0b":"#6b7a99";
          return (
            <div key={ticker} data-testid={`spread-row-${ticker}`}
              style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",gap:0,
                padding:"8px 10px",borderBottom:"1px solid rgba(255,255,255,0.04)",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:13}}>{meta.icon||"◆"}</span>
                <div>
                  <div style={{fontSize:10,fontWeight:800,color:C.text,fontFamily:mono}}>{ticker}</div>
                  <div style={{fontSize:7,color:severityCol,fontFamily:mono}}>{s.severity}</div>
                </div>
              </div>
              <div style={{fontFamily:mono,fontSize:9,color:"#93c5fd",fontWeight:700}}>{fmtPrice(s.spotPrice)}</div>
              <div style={{fontFamily:mono,fontSize:9,color:"#c084fc",fontWeight:700}}>{fmtPrice(s.perpPrice)}</div>
              <div style={{fontFamily:mono,fontSize:10,fontWeight:800,
                color:s.spreadPct>0.5?"#00ff88":s.spreadPct<-0.5?"#ff2d55":"#f59e0b"}}>
                {s.spreadPct>0?"+":""}{s.spreadPct.toFixed(2)}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── CORRELATIONS sub-view ───────────────────────────────────────────────────
function CorrelationsView({ marketMode, byClass, perps, spot, discoveredAssets }) {
  const correlations = marketMode?.correlations || [];
  const classes = [
    {key:"crypto",    label:"CRYPTO",      assets:["BTC","ETH","SOL"], hex:"153,69,255"},
    {key:"equity",    label:"EQUITIES",    assets:["NVDA","TSLA","AAPL"], hex:"59,130,246"},
    {key:"commodity", label:"COMMODITIES", assets:["GOLD","OIL","XAU"], hex:"212,175,55"},
  ];

  return (
    <div>
      {/* Correlation signals */}
      {correlations.length>0?(
        <div style={{marginBottom:10}}>
          <div style={{fontSize:8,color:C.muted,fontFamily:mono,letterSpacing:1.5,marginBottom:6}}>LIVE CROSS-ASSET SIGNALS</div>
          {correlations.map((c,i)=>{
            const col=sigColor(c.signal);
            return (
              <div key={i} data-testid={`correlation-${i}`}
                style={{background:`rgba(${col==="#00ff88"?"0,255,136":col==="#ff2d55"?"255,45,85":"245,158,11"},0.06)`,
                  border:`1px solid ${col}18`,borderRadius:8,padding:"8px 10px",marginBottom:5,
                  display:"flex",alignItems:"flex-start",gap:8}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:col,flexShrink:0,marginTop:3}}/>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:col,fontFamily:mono,letterSpacing:0.5}}>{c.signal}</div>
                  <div style={{fontSize:9,color:C.muted2,fontFamily:mono,marginTop:2,lineHeight:1.5}}>{c.msg}</div>
                  <div style={{fontSize:7,color:C.muted,fontFamily:mono,marginTop:2}}>{c.severity} SEVERITY</div>
                </div>
              </div>
            );
          })}
        </div>
      ):(
        <div style={{background:C.surface,border:"1px solid rgba(255,255,255,0.07)",borderRadius:8,
          padding:"14px",marginBottom:10,textAlign:"center",color:C.muted,fontFamily:mono,fontSize:9}}>
          No significant cross-asset correlations detected right now
        </div>
      )}

      {/* Per-class performance matrix */}
      <div style={{fontSize:8,color:C.muted,fontFamily:mono,letterSpacing:1.5,marginBottom:6}}>CLASS PERFORMANCE MATRIX</div>
      {classes.map(({key,label,assets,hex})=>{
        const topAssets = assets
          .map(ticker=>{
            const p=perps[ticker]||spot[ticker];
            const meta=discoveredAssets[ticker]||{};
            return {ticker,meta,change:p?.change24h||0,price:p?.price||0};
          })
          .filter(a=>a.price>0)
          .sort((a,b)=>Math.abs(b.change)-Math.abs(a.change));
        const classData=marketMode?.[key];
        const col=sigColor(classData?.regime||"NEUTRAL");
        return (
          <div key={key} style={{background:`rgba(${hex},0.04)`,border:`1px solid rgba(${hex},0.12)`,
            borderRadius:8,padding:"9px 10px",marginBottom:6}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div style={{fontSize:9,fontWeight:700,color:`rgb(${hex})`,fontFamily:mono,letterSpacing:1}}>{label}</div>
              <div style={{fontSize:8,color:col,fontFamily:mono,fontWeight:700}}>{classData?.score??50}% · {classData?.regime||"NEUTRAL"}</div>
            </div>
            <div style={{display:"flex",gap:5}}>
              {topAssets.slice(0,3).map(({ticker,meta,change})=>(
                <div key={ticker} style={{flex:1,background:"rgba(255,255,255,0.03)",borderRadius:5,padding:"4px 6px",textAlign:"center"}}>
                  <div style={{fontSize:9}}>{meta.icon||"◆"}</div>
                  <div style={{fontSize:7,fontFamily:mono,color:C.muted2,marginTop:1}}>{ticker}</div>
                  <div style={{fontSize:8,fontWeight:700,color:changeColor(change),fontFamily:mono}}>{fmtChange(change)}</div>
                </div>
              ))}
              {topAssets.length===0&&(
                <div style={{fontSize:8,color:C.muted,fontFamily:mono,padding:"4px 0"}}>No live data</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── NEWS sub-view ───────────────────────────────────────────────────────────
function NewsView({ sentiment }) {
  const headlines = sentiment?.headlines || [];
  const score = sentiment?.score ?? 50;
  const label = sentiment?.label || "NEUTRAL";
  const scoreCol = score>=60?"#00ff88":score<=40?"#ff2d55":"#f59e0b";

  return (
    <div>
      {/* Sentiment score */}
      <div style={{background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.07)",
        borderRadius:10,padding:"12px",marginBottom:10,
        display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:8,color:C.muted,fontFamily:mono,letterSpacing:1.5,marginBottom:3}}>CRYPTO NEWS SENTIMENT</div>
          <div style={{fontSize:22,fontWeight:900,color:scoreCol,fontFamily:mono,lineHeight:1}}>{score}</div>
          <div style={{fontSize:9,color:scoreCol,fontFamily:mono,marginTop:2}}>{label}</div>
        </div>
        <div style={{width:60,height:60,borderRadius:"50%",
          border:`3px solid ${scoreCol}`,
          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
          <div style={{fontSize:13,fontWeight:900,color:scoreCol,fontFamily:mono}}>{score}</div>
          <div style={{fontSize:6,color:C.muted,fontFamily:mono}}>SCORE</div>
        </div>
      </div>

      {/* Headlines */}
      <div style={{background:C.surface,border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,overflow:"hidden"}}>
        {headlines.length===0?(
          <div style={{padding:24,textAlign:"center",color:C.muted,fontFamily:mono,fontSize:9}}>
            Loading news headlines…
          </div>
        ):headlines.map((h,i)=>{
          const sCol=h.sentiment==="bullish"?"#00ff88":h.sentiment==="bearish"?"#ff2d55":"#f59e0b";
          return (
            <div key={i} data-testid={`headline-${i}`}
              style={{padding:"9px 11px",borderBottom:"1px solid rgba(255,255,255,0.04)",display:"flex",gap:8,alignItems:"flex-start"}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:sCol,flexShrink:0,marginTop:4}}/>
              <div style={{flex:1}}>
                <a href={h.url} target="_blank" rel="noopener noreferrer"
                  style={{fontSize:11,color:C.text,textDecoration:"none",lineHeight:1.5,display:"block"}}>{h.title}</a>
                <div style={{display:"flex",gap:8,marginTop:3}}>
                  <span style={{fontSize:7,color:sCol,fontFamily:mono,fontWeight:700}}>{h.sentiment?.toUpperCase()}</span>
                  <span style={{fontSize:7,color:C.muted,fontFamily:mono}}>{h.source}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── MAIN MARKET TAB ─────────────────────────────────────────────────────────
export default function MarketTab() {
  const {
    spot, perps, spreads, marketMode, sentiment, alerts,
    discoveredAssets, byClass,
    loading, lastUpdate, totalMarkets,
    refresh,
  } = useMarketData();

  const [subView, setSubView] = useState("prices");

  const subViews = [
    {k:"prices",     l:"PRICES"},
    {k:"spreads",    l:"SPREADS"},
    {k:"correlations",l:"CORRELATIONS"},
    {k:"news",       l:"NEWS"},
  ];

  return (
    <div>
      {/* Master header */}
      <MasterHeader
        marketMode={marketMode}
        sentiment={sentiment}
        lastUpdate={lastUpdate}
        loading={loading}
        totalMarkets={totalMarkets}
        onRefresh={refresh}
      />

      {/* Sub-view tabs */}
      <div style={{display:"flex",gap:3,marginBottom:10,overflowX:"auto"}}>
        {subViews.map(({k,l})=>(
          <button key={k} data-testid={`market-subview-${k}`} onClick={()=>setSubView(k)}
            style={{padding:"5px 12px",borderRadius:6,border:`1px solid ${subView===k?"rgba(212,175,55,0.35)":"rgba(255,255,255,0.07)"}`,
              background:subView===k?"rgba(212,175,55,0.08)":"transparent",
              color:subView===k?"#d4af37":C.muted2,cursor:"pointer",fontFamily:mono,fontSize:9,letterSpacing:1,
              whiteSpace:"nowrap",flexShrink:0}}>
            {l}
          </button>
        ))}
      </div>

      {subView==="prices"&&(
        <PricesView
          perps={perps} spot={spot} spreads={spreads}
          discoveredAssets={discoveredAssets} byClass={byClass}
        />
      )}
      {subView==="spreads"&&(
        <SpreadsView spreads={spreads} discoveredAssets={discoveredAssets}/>
      )}
      {subView==="correlations"&&(
        <CorrelationsView
          marketMode={marketMode} byClass={byClass}
          perps={perps} spot={spot} discoveredAssets={discoveredAssets}
        />
      )}
      {subView==="news"&&(
        <NewsView sentiment={sentiment}/>
      )}
    </div>
  );
}

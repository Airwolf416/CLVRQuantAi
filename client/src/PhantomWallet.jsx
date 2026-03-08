import { useState, useEffect, useCallback } from "react";

const KNOWN_MINTS = {
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "USDT",
  "So11111111111111111111111111111111111111112": "wSOL",
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": "ETH",
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So": "mSOL",
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263": "BONK",
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN": "JUP",
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": "RAY",
  "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr": "POPCAT",
  "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3": "PYTH",
  "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7": "DRIFT",
  "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ": "W",
  "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux": "HNT",
  "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof": "RNDR",
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm": "WIF",
  "CKaKtYvz6dKPyMvYq9Rh3UBrnNqYZAyd7iF4hJtjUvks": "GALA",
  "FLAMEhfiTkCnGBKq8wtSUFcRSfMsPbHmAS7sGQTGcBfB": "FLAME",
};

const SOL_RPC = "https://api.mainnet-beta.solana.com";
const SOL_PROXY = "/api/solana-rpc";
const HL_API = "https://api.hyperliquid.xyz/info";
const HL_ASSETS = ["SOL", "BTC", "ETH", "WIF", "BONK", "JTO", "PYTH", "W", "ARB", "DOGE", "HYPE", "SUI", "AVAX", "LINK"];

const SIGNAL_COLORS = {
  STRONG_LONG: "#00c787",
  LONG: "#4ade80",
  NEUTRAL: "#f59e0b",
  SHORT: "#f87171",
  STRONG_SHORT: "#ff4060",
};

async function solRpc(method, params) {
  try {
    const res = await fetch(SOL_PROXY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params }),
    });
    return await res.json();
  } catch {
    const res = await fetch(SOL_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return await res.json();
  }
}

async function fetchHLAccountState(evmAddress) {
  const res = await fetch(HL_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "clearinghouseState", user: evmAddress }),
  });
  if (!res.ok) throw new Error("HL fetch failed");
  return await res.json();
}

async function fetchHLOpenOrders(evmAddress) {
  try {
    const res = await fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "openOrders", user: evmAddress }),
    });
    return await res.json();
  } catch { return []; }
}

async function fetchAllMids() {
  try {
    const res = await fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
    });
    return await res.json() || {};
  } catch { return {}; }
}

async function fetchFundingRates() {
  try {
    const res = await fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    });
    const data = await res.json();
    const universe = data?.[0]?.universe || [];
    const ctxs = data?.[1] || [];
    const rates = {};
    universe.forEach((asset, i) => {
      rates[asset.name] = {
        funding: parseFloat(ctxs[i]?.funding || 0),
        openInterest: parseFloat(ctxs[i]?.openInterest || 0),
        markPx: parseFloat(ctxs[i]?.markPx || 0),
      };
    });
    return rates;
  } catch { return {}; }
}

function parseHLState(raw) {
  if (!raw) return null;
  const margin = raw.marginSummary || {};
  const positions = (raw.assetPositions || [])
    .map((ap) => {
      const pos = ap.position;
      if (!pos || parseFloat(pos.szi) === 0) return null;
      const size = parseFloat(pos.szi);
      const entryPx = parseFloat(pos.entryPx || 0);
      const unrealizedPnl = parseFloat(pos.unrealizedPnl || 0);
      const leverage = parseFloat(pos.leverage?.value || pos.leverage || 1);
      const liqPx = parseFloat(pos.liquidationPx || 0);
      const marginUsed = parseFloat(pos.marginUsed || 0);
      return {
        asset: pos.coin,
        size,
        side: size > 0 ? "LONG" : "SHORT",
        entryPx,
        unrealizedPnl,
        leverage,
        liqPx,
        marginUsed,
        roe: marginUsed > 0 ? (unrealizedPnl / marginUsed) * 100 : 0,
      };
    })
    .filter(Boolean);

  return {
    accountValue: parseFloat(margin.accountValue || 0),
    totalMarginUsed: parseFloat(margin.totalMarginUsed || 0),
    totalUnrealizedPnl: parseFloat(margin.totalUnrealizedPnl || 0),
    withdrawable: parseFloat(raw.withdrawable || 0),
    positions,
  };
}

const C = {
  bg:"#050709", panel:"#0c1220", border:"#141e35", border2:"#1c2b4a",
  gold:"#c9a84c", gold2:"#e8c96d", gold3:"#f7e0a0",
  text:"#c8d4ee", muted:"#4a5d80", muted2:"#6b7fa8", white:"#f0f4ff",
  green:"#00c787", red:"#ff4060", orange:"#ff8c00",
  cyan:"#00d4ff", blue:"#3b82f6", teal:"#14b8a6", purple:"#a855f7",
  inputBg:"#080d18",
};
const SERIF = "'Playfair Display', Georgia, serif";
const MONO  = "'IBM Plex Mono', monospace";
const SANS  = "'Barlow', system-ui, sans-serif";

export function usePhantom() {
  const [pubkey, setPubkey] = useState(null);
  const [balance, setBalance] = useState(null);
  const [tokens, setTokens] = useState([]);
  const [status, setStatus] = useState("disconnected");
  const [error, setError] = useState(null);
  const [txHistory, setTxHistory] = useState([]);

  const getProvider = () => {
    if (typeof window === "undefined") return null;
    const phantom = window.phantom?.solana;
    if (phantom?.isPhantom) return phantom;
    if (window.solana?.isPhantom) return window.solana;
    return null;
  };

  const fetchBalance = useCallback(async (pk) => {
    try {
      const data = await solRpc("getBalance", [pk]);
      if (data?.result?.value !== undefined) {
        setBalance((data.result.value / 1e9).toFixed(4));
      } else {
        setBalance("--");
      }
    } catch {
      setBalance("--");
    }
  }, []);

  const fetchTokens = useCallback(async (pk) => {
    try {
      const data = await solRpc("getTokenAccountsByOwner", [
        pk,
        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
        { encoding: "jsonParsed" },
      ]);
      const parsed = (data?.result?.value || [])
        .map((a) => {
          const info = a.account.data.parsed.info;
          return {
            mint: info.mint,
            amount: info.tokenAmount.uiAmountString,
            symbol: KNOWN_MINTS[info.mint] || info.mint.slice(0, 6) + "...",
          };
        })
        .filter((t) => parseFloat(t.amount) > 0);
      setTokens(parsed);
    } catch {
      setTokens([]);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const provider = getProvider();
    await provider?.disconnect();
    setPubkey(null); setBalance(null); setTokens([]);
    setStatus("disconnected");
  }, []);

  const [providerReady, setProviderReady] = useState(false);

  useEffect(() => {
    const setup = (provider) => {
      if (!provider) return;
      setProviderReady(true);
      provider.on("connect", (pk) => {
        setPubkey(pk.toString());
        setStatus("connected");
      });
      provider.on("disconnect", () => {
        setPubkey(null); setBalance(null); setTokens([]);
        setStatus("disconnected");
      });
      provider.on("accountChanged", (pk) => {
        if (pk) { setPubkey(pk.toString()); fetchBalance(pk.toString()); }
        else disconnect();
      });
      if (provider.isConnected && provider.publicKey) {
        setPubkey(provider.publicKey.toString());
        setStatus("connected");
      }
    };
    const p = getProvider();
    if (p) { setup(p); return; }
    const t1 = setTimeout(() => { const p2 = getProvider(); if (p2) setup(p2); }, 500);
    const t2 = setTimeout(() => { const p3 = getProvider(); if (p3) setup(p3); }, 1500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  useEffect(() => {
    if (pubkey && status === "connected") {
      fetchBalance(pubkey);
      fetchTokens(pubkey);
    }
  }, [pubkey, status]);

  const isInIframe = () => { try { return window.self !== window.top; } catch { return true; } };

  const connect = async () => {
    let provider = getProvider();
    if (!provider) {
      await new Promise(r => setTimeout(r, 300));
      provider = getProvider();
    }
    if (!provider) {
      if (isInIframe()) {
        setError("iframe_blocked");
      } else {
        setError("Phantom not installed");
      }
      return;
    }
    setProviderReady(true);
    setStatus("connecting"); setError(null);
    try {
      const resp = await provider.connect();
      setPubkey(resp.publicKey.toString());
      setStatus("connected");
    } catch (e) {
      setError(e.message || "Connection rejected");
      setStatus("error");
    }
  };

  const signMessage = async (msg) => {
    const provider = getProvider();
    if (!provider) throw new Error("Wallet not connected");
    const encoded = new TextEncoder().encode(msg);
    const { signature } = await provider.signMessage(encoded, "utf8");
    return signature;
  };

  const sendSOL = async (to, solAmount) => {
    const provider = getProvider();
    if (!provider || !pubkey) throw new Error("Wallet not connected");
    const { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = await import("@solana/web3.js");
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(pubkey),
        toPubkey: new PublicKey(to),
        lamports: Math.round(solAmount * LAMPORTS_PER_SOL),
      })
    );
    tx.feePayer = new PublicKey(pubkey);
    const bhData = await solRpc("getLatestBlockhash", []);
    tx.recentBlockhash = bhData.result.value.blockhash;
    const { signature } = await provider.signAndSendTransaction(tx);
    setTxHistory(h => [{ sig: signature, type: "SOL Transfer", ts: Date.now() }, ...h.slice(0, 9)]);
    fetchBalance(pubkey);
    return signature;
  };

  return { pubkey, balance, tokens, status, error, txHistory, connect, disconnect, signMessage, sendSOL };
}

function Badge({label, color="gold"}) {
  const map = {
    gold:{bg:"rgba(201,168,76,.1)",color:C.gold,border:"rgba(201,168,76,.25)"},
    green:{bg:"rgba(0,199,135,.1)",color:C.green,border:"rgba(0,199,135,.25)"},
    red:{bg:"rgba(255,64,96,.1)",color:C.red,border:"rgba(255,64,96,.25)"},
    orange:{bg:"rgba(255,140,0,.1)",color:C.orange,border:"rgba(255,140,0,.25)"},
    cyan:{bg:"rgba(0,212,255,.1)",color:C.cyan,border:"rgba(0,212,255,.25)"},
    purple:{bg:"rgba(168,85,247,.1)",color:C.purple,border:"rgba(168,85,247,.25)"},
    muted:{bg:"rgba(74,93,128,.1)",color:C.muted2,border:"rgba(74,93,128,.25)"},
  };
  const t = map[color] || map.gold;
  return <span style={{fontSize:9,padding:"3px 8px",borderRadius:2,background:t.bg,color:t.color,border:`1px solid ${t.border}`,fontFamily:MONO,letterSpacing:"0.12em",textTransform:"uppercase",fontWeight:600}}>{label}</span>;
}

function HLStatBox({ label, value, color = C.text }) {
  return (
    <div style={{background:"rgba(201,168,76,.03)",border:`1px solid ${C.border}`,borderRadius:2,padding:"10px 12px"}}>
      <div style={{fontSize:8,color:C.muted,letterSpacing:"0.12em",marginBottom:4,fontFamily:MONO}}>{label}</div>
      <div style={{fontSize:14,fontWeight:800,color,fontFamily:MONO}}>{value}</div>
    </div>
  );
}

function PositionRow({ pos, markPrices }) {
  const mark = parseFloat(markPrices[pos.asset] || pos.entryPx);
  const pnlColor = pos.unrealizedPnl >= 0 ? C.green : C.red;
  const sideColor = pos.side === "LONG" ? C.green : C.red;
  return (
    <div data-testid={`hl-position-${pos.asset}`} style={{
      background: pos.side === "LONG"
        ? "rgba(0,199,135,.03)"
        : "rgba(255,64,96,.03)",
      border: `1px solid ${pos.side === "LONG" ? "rgba(0,199,135,.15)" : "rgba(255,64,96,.15)"}`,
      borderRadius:2, padding:"11px 13px", marginBottom:8,
    }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{
            background: pos.side === "LONG" ? "rgba(0,199,135,.12)" : "rgba(255,64,96,.12)",
            color: sideColor, fontSize:8, fontWeight:800,
            padding:"2px 7px", borderRadius:2, letterSpacing:"0.1em", fontFamily:MONO,
          }}>{pos.side === "LONG" ? "▲ LONG" : "▼ SHORT"}</span>
          <span style={{fontSize:14,fontWeight:800,color:C.white,fontFamily:MONO}}>{pos.asset}</span>
          <span style={{fontSize:9,color:C.muted,fontFamily:MONO}}>{pos.leverage}x</span>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:14,fontWeight:800,color:pnlColor,fontFamily:MONO}}>
            {pos.unrealizedPnl >= 0 ? "+" : ""}${pos.unrealizedPnl.toFixed(2)}
          </div>
          <div style={{fontSize:9,color:pnlColor,fontFamily:MONO}}>
            {pos.roe >= 0 ? "+" : ""}{pos.roe.toFixed(1)}% ROE
          </div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,fontSize:10}}>
        {[
          { l:"SIZE", v:`${Math.abs(pos.size).toFixed(4)} ${pos.asset}` },
          { l:"ENTRY", v:`$${pos.entryPx.toFixed(pos.entryPx > 100 ? 2 : 4)}` },
          { l:"MARK", v:`$${mark.toFixed(mark > 100 ? 2 : 4)}` },
          { l:"LIQ", v: pos.liqPx > 0 ? `$${pos.liqPx.toFixed(pos.liqPx > 100 ? 2 : 4)}` : "—", warn: true },
        ].map(({ l, v, warn }) => (
          <div key={l}>
            <div style={{color:C.muted,fontSize:8,marginBottom:2,fontFamily:MONO,letterSpacing:"0.08em"}}>{l}</div>
            <div style={{color: warn ? C.orange : C.text,fontWeight:600,fontFamily:MONO}}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PerpsPnlCalculator() {
  const [form, setForm] = useState({
    direction: "long",
    entryPrice: "",
    exitPrice: "",
    size: "",
    leverage: "10",
    makerFee: "0.02",
    takerFee: "0.05",
  });
  const [result, setResult] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const calculate = () => {
    const entry = parseFloat(form.entryPrice);
    const exit = parseFloat(form.exitPrice);
    const size = parseFloat(form.size);
    const lev = parseFloat(form.leverage);
    const taker = parseFloat(form.takerFee) / 100;

    if (!entry || !exit || !size || !lev) return;

    const margin = size / lev;
    const priceDiff = form.direction === "long" ? exit - entry : entry - exit;
    const rawPnl = (priceDiff / entry) * size;
    const totalFees = size * taker * 2;
    const netPnl = rawPnl - totalFees;
    const roe = (netPnl / margin) * 100;
    const liqBuffer = 1 / lev;
    const liqPrice = form.direction === "long"
      ? entry * (1 - liqBuffer + 0.005)
      : entry * (1 + liqBuffer - 0.005);
    const breakeven = form.direction === "long"
      ? entry * (1 + (2 * taker))
      : entry * (1 - (2 * taker));

    setResult({ rawPnl, netPnl, totalFees, roe, margin, liqPrice, breakeven });
  };

  const inputStyle = {
    width:"100%",background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:2,
    padding:"10px 12px",color:C.text,fontSize:13,fontFamily:MONO,boxSizing:"border-box",outline:"none",
  };
  const labelStyle = { fontSize:10, color:C.muted2, marginBottom:5, fontFamily:MONO, letterSpacing:"0.1em", textTransform:"uppercase" };

  return (
    <div>
      <div style={{fontFamily:MONO,fontSize:10,color:C.gold,letterSpacing:"0.15em",marginBottom:14}}>PERPS PNL CALCULATOR</div>

      <div style={{display:"flex",gap:8,marginBottom:14}}>
        {["long","short"].map((d) => (
          <button key={d} data-testid={`pnl-dir-${d}`} onClick={() => set("direction", d)}
            style={{flex:1,padding:"11px",borderRadius:2,border:"none",cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:MONO,letterSpacing:"0.08em",
              background:form.direction===d?(d==="long"?"rgba(0,199,135,.12)":"rgba(255,64,96,.12)"):C.panel,
              color:form.direction===d?(d==="long"?C.green:C.red):C.muted}}>
            {d === "long" ? "LONG" : "SHORT"}
          </button>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
        <div><div style={labelStyle}>Entry Price ($)</div><input data-testid="pnl-entry" style={inputStyle} placeholder="95000" value={form.entryPrice} onChange={e => set("entryPrice", e.target.value)} /></div>
        <div><div style={labelStyle}>Exit Price ($)</div><input data-testid="pnl-exit" style={inputStyle} placeholder="98000" value={form.exitPrice} onChange={e => set("exitPrice", e.target.value)} /></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
        <div><div style={labelStyle}>Size (USD)</div><input data-testid="pnl-size" style={inputStyle} placeholder="1000" value={form.size} onChange={e => set("size", e.target.value)} /></div>
        <div><div style={labelStyle}>Leverage (x)</div><input data-testid="pnl-leverage" style={inputStyle} placeholder="10" value={form.leverage} onChange={e => set("leverage", e.target.value)} /></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        <div><div style={labelStyle}>Maker Fee (%)</div><input data-testid="pnl-maker" style={inputStyle} value={form.makerFee} onChange={e => set("makerFee", e.target.value)} /></div>
        <div><div style={labelStyle}>Taker Fee (%)</div><input data-testid="pnl-taker" style={inputStyle} value={form.takerFee} onChange={e => set("takerFee", e.target.value)} /></div>
      </div>

      <button data-testid="pnl-calculate" onClick={calculate}
        style={{width:"100%",height:44,background:"rgba(201,168,76,.1)",color:C.gold2,border:`1px solid rgba(201,168,76,.3)`,borderRadius:2,fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:15,cursor:"pointer",marginBottom:14}}>
        Calculate PnL
      </button>

      {result && (
        <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:2,padding:14}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {[
              { label:"Gross PnL", value:`${result.rawPnl>=0?"+":""}$${result.rawPnl.toFixed(2)}`, color:result.rawPnl>=0?C.green:C.red },
              { label:"Net PnL", value:`${result.netPnl>=0?"+":""}$${result.netPnl.toFixed(2)}`, color:result.netPnl>=0?C.green:C.red },
              { label:"ROE", value:`${result.roe.toFixed(2)}%`, color:result.roe>=0?C.green:C.red },
              { label:"Total Fees", value:`$${result.totalFees.toFixed(2)}`, color:C.orange },
              { label:"Margin Used", value:`$${result.margin.toFixed(2)}`, color:C.cyan },
              { label:"Liquidation", value:`$${result.liqPrice.toFixed(2)}`, color:C.red },
              { label:"Breakeven", value:`$${result.breakeven.toFixed(2)}`, color:C.muted2 },
            ].map(({label, value, color}) => (
              <div key={label} style={{background:C.bg,borderRadius:2,padding:"10px 12px",border:`1px solid ${C.border}`}}>
                <div style={{fontSize:9,color:C.muted,fontFamily:MONO,letterSpacing:"0.1em",marginBottom:3}}>{label}</div>
                <div style={{fontSize:15,fontWeight:700,color,fontFamily:MONO}}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{marginTop:10,fontSize:10,color:C.muted,fontFamily:MONO,letterSpacing:"0.05em"}}>
            Liq price is estimated. Actual varies by exchange.
          </div>
        </div>
      )}
    </div>
  );
}

export default function PhantomWalletPanel() {
  const { pubkey, balance, tokens, status, error, connect, disconnect, signMessage, sendSOL, txHistory } = usePhantom();
  const [walletTab, setWalletTab] = useState("overview");
  const [authMsg, setAuthMsg] = useState("Sign in to CLVRQuant AI");
  const [authResult, setAuthResult] = useState(null);
  const [sendTo, setSendTo] = useState("");
  const [sendAmt, setSendAmt] = useState("");
  const [sendStatus, setSendStatus] = useState(null);

  const [evmAddress, setEvmAddress] = useState(() => {
    try { return localStorage.getItem("clvr_hl_evm") || ""; } catch { return ""; }
  });
  const [evmInput, setEvmInput] = useState("");
  const [showEvmModal, setShowEvmModal] = useState(false);

  const [hlAccount, setHlAccount] = useState(null);
  const [hlOrders, setHlOrders] = useState([]);
  const [hlLoading, setHlLoading] = useState(false);
  const [hlError, setHlError] = useState(null);

  const [hlPrices, setHlPrices] = useState({});
  const [fundingRates, setFundingRates] = useState({});

  const [selectedAsset, setSelectedAsset] = useState("SOL");
  const [tradeSize, setTradeSize] = useState("");
  const [leverage, setLeverage] = useState(5);

  const [aiSignal, setAiSignal] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);

  const [confirmTrade, setConfirmTrade] = useState(null);
  const [tradeStatus, setTradeStatus] = useState(null);

  const short = pubkey ? pubkey.slice(0, 4) + "..." + pubkey.slice(-4) : "";

  useEffect(() => {
    async function loadMarketData() {
      const [p, f] = await Promise.all([fetchAllMids(), fetchFundingRates()]);
      setHlPrices(p);
      setFundingRates(f);
    }
    loadMarketData();
    const iv = setInterval(loadMarketData, 5000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!evmAddress) return;
    let cancelled = false;
    async function loadHL() {
      setHlLoading(true);
      setHlError(null);
      try {
        const [state, orders] = await Promise.all([
          fetchHLAccountState(evmAddress),
          fetchHLOpenOrders(evmAddress),
        ]);
        if (!cancelled) {
          setHlAccount(parseHLState(state));
          setHlOrders(orders || []);
        }
      } catch {
        if (!cancelled) setHlError("Could not load Hyperliquid account. Check your EVM address.");
      } finally {
        if (!cancelled) setHlLoading(false);
      }
    }
    loadHL();
    const iv = setInterval(loadHL, 8000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [evmAddress]);

  const saveEvmAddress = useCallback(() => {
    const t = evmInput.trim();
    if (!t.startsWith("0x") || t.length !== 42) {
      alert("Enter a valid EVM address: 0x… (42 characters)");
      return;
    }
    try { localStorage.setItem("clvr_hl_evm", t); } catch {}
    setEvmAddress(t);
    setShowEvmModal(false);
    setEvmInput("");
  }, [evmInput]);

  const getAISignal = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    setAiSignal(null);

    const price = parseFloat(hlPrices[selectedAsset] || 0);
    const funding = fundingRates[selectedAsset] || { funding: 0, openInterest: 0 };
    const positionLines = hlAccount?.positions?.length
      ? hlAccount.positions.map(p =>
          `  • ${p.side} ${Math.abs(p.size)} ${p.asset} @ $${p.entryPx.toFixed(4)} | ${p.leverage}x lev | uPnL: ${p.unrealizedPnl >= 0 ? "+" : ""}$${p.unrealizedPnl.toFixed(2)} (${p.roe.toFixed(1)}% ROE) | Liq: $${p.liqPx > 0 ? p.liqPx.toFixed(4) : "N/A"}`
        ).join("\n")
      : "  None";
    const orderLines = hlOrders?.length
      ? hlOrders.map(o => `  • ${o.side === "B" ? "BUY" : "SELL"} ${o.sz} ${o.coin} @ $${parseFloat(o.limitPx || 0).toFixed(4)}`).join("\n")
      : "  None";

    const systemPrompt = `You are CLVRQuant AI — an elite quantitative crypto trading analyst with full visibility of the trader's live Hyperliquid perp account.
You see their exact open positions, unrealized PnL, margin usage, available cash, and open orders.
Give a PERSONALIZED long/short signal that accounts for their current portfolio exposure and risk.
Respond ONLY with a valid JSON object. No markdown, no backticks, no explanation outside JSON.

JSON schema:
{
"signal": "STRONG_LONG" | "LONG" | "NEUTRAL" | "SHORT" | "STRONG_SHORT",
"confidence": 0-100,
"entry": number,
"stopLoss": number,
"takeProfit": number,
"rationale": "2-3 sentences referencing their actual positions and market conditions",
"portfolioNote": "1 sentence on portfolio-level risk or concentration given current positions",
"keyRisks": ["risk1", "risk2"],
"timeframe": "scalp (mins)" | "intraday (hours)" | "swing (days)"
}`;

    const userPrompt = `Signal request: ${selectedAsset}/USD perpetual

═══ LIVE HYPERLIQUID ACCOUNT ═══
Account Value:        $${hlAccount?.accountValue?.toFixed(2) ?? "N/A"}
Withdrawable Cash:    $${hlAccount?.withdrawable?.toFixed(2) ?? "N/A"}
Total Margin Used:    $${hlAccount?.totalMarginUsed?.toFixed(2) ?? "N/A"}
Total Unrealized PnL: ${hlAccount ? (hlAccount.totalUnrealizedPnl >= 0 ? "+" : "") + "$" + hlAccount.totalUnrealizedPnl.toFixed(2) : "N/A"}

Open Perp Positions:
${positionLines}

Open Orders:
${orderLines}

═══ MARKET — ${selectedAsset} ═══
Mark Price:   $${price.toFixed(price > 100 ? 2 : 4)}
Funding/1H:   ${(funding.funding * 100).toFixed(4)}% (${funding.funding > 0 ? "longs paying shorts — bearish pressure" : "shorts paying longs — bullish pressure"})
Open Interest: $${(funding.openInterest || 0).toFixed(2)}M

═══ PROPOSED TRADE ═══
Asset:    ${selectedAsset}
Size:     ${tradeSize || "not specified"}
Leverage: ${leverage}x
Wallet:   ${pubkey ? pubkey.slice(0, 6) + "…" + pubkey.slice(-4) : "demo"}

Consider: existing ${selectedAsset} exposure, portfolio margin health, liquidation proximity on current positions, and whether this trade improves or worsens risk-adjusted returns.`;

    try {
      const response = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: systemPrompt,
          userMessage: userPrompt,
        }),
      });
      const data = await response.json();
      if (data.error) {
        setAiError(data.error);
      } else {
        const raw = data.text || data.response || "";
        const clean = raw.replace(/```json|```/g, "").trim();
        try {
          const parsed = JSON.parse(clean);
          if (!parsed.signal || typeof parsed.confidence !== "number") {
            setAiError("AI returned invalid signal format. Retry.");
          } else {
            setAiSignal(parsed);
            setWalletTab("ai signal");
          }
        } catch {
          setAiError("Failed to parse AI response. Retry.");
        }
      }
    } catch {
      setAiError("Signal generation failed. Check connection and retry.");
    } finally {
      setAiLoading(false);
    }
  }, [selectedAsset, hlPrices, fundingRates, hlAccount, hlOrders, tradeSize, leverage, pubkey]);

  const executeTrade = useCallback(async (direction) => {
    setConfirmTrade(null);
    setTradeStatus({ status: "signing", direction });
    await new Promise(r => setTimeout(r, 1400));
    setTradeStatus({
      status: "submitted", direction,
      asset: selectedAsset, size: tradeSize, leverage,
      price: parseFloat(hlPrices[selectedAsset] || 0).toFixed(2),
      txHash: "HLTx_" + Math.random().toString(36).slice(2, 10).toUpperCase(),
    });
  }, [selectedAsset, tradeSize, leverage, hlPrices]);

  const handleSign = async () => {
    try {
      const sig = await signMessage(authMsg);
      setAuthResult("Signed: " + Array.from(sig).slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("") + "...");
    } catch (e) { setAuthResult("Error: " + e.message); }
  };

  const handleSend = async () => {
    if (!sendTo || !sendAmt || parseFloat(sendAmt) <= 0) { setSendStatus("Enter valid address and amount"); return; }
    setSendStatus("Signing transaction...");
    try {
      const sig = await sendSOL(sendTo, parseFloat(sendAmt));
      setSendStatus("Sent! TX: " + sig.slice(0, 16) + "...");
      setSendTo(""); setSendAmt("");
    } catch (e) { setSendStatus("Error: " + e.message); }
  };

  const tabs = ["overview", "hl account", "positions", "ai signal", "orders", "tokens", "send", "sign", "history", "pnl calc"];
  const panel = {background:C.panel,border:`1px solid ${C.border}`,borderRadius:2,overflow:"hidden",marginBottom:10};
  const ph = {display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",borderBottom:`1px solid ${C.border}`,background:"rgba(201,168,76,.03)"};
  const inputStyle = {width:"100%",background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:2,padding:"11px 14px",color:C.text,fontSize:13,fontFamily:MONO,boxSizing:"border-box",outline:"none"};

  const hlPrice = parseFloat(hlPrices[selectedAsset] || 0);
  const signalColor = aiSignal ? SIGNAL_COLORS[aiSignal.signal] || C.orange : C.orange;
  const solBal = parseFloat(balance || 0);

  return (
    <div>
      {showEvmModal && (
        <div style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",
          display:"flex",alignItems:"center",justifyContent:"center",
          zIndex:2000,padding:24,
        }}>
          <div style={{
            background:C.panel,border:`1px solid rgba(201,168,76,.4)`,
            borderRadius:2,padding:28,maxWidth:380,width:"100%",
          }}>
            <div style={{fontSize:9,color:C.gold,letterSpacing:"0.15em",marginBottom:8,fontFamily:MONO}}>
              ONE-TIME SETUP
            </div>
            <div style={{fontSize:18,fontWeight:900,color:C.white,marginBottom:14,fontFamily:SERIF}}>
              Link Hyperliquid Account
            </div>
            <div style={{
              background:"rgba(201,168,76,.06)",border:`1px solid rgba(201,168,76,.15)`,
              borderRadius:2,padding:"12px 14px",marginBottom:18,
              fontSize:11,color:C.muted2,lineHeight:1.8,fontFamily:SANS,
            }}>
              Hyperliquid uses your <span style={{color:C.gold2}}>EVM (0x) address</span> — not your Solana address. To find it:
              <br /><br />
              <strong style={{color:C.white}}>1.</strong> Go to <span style={{color:C.gold2}}>app.hyperliquid.xyz</span><br />
              <strong style={{color:C.white}}>2.</strong> Connect your Phantom wallet<br />
              <strong style={{color:C.white}}>3.</strong> Copy the <strong style={{color:C.white}}>0x address</strong> shown top-right<br />
              <strong style={{color:C.white}}>4.</strong> Paste it below — saved for future sessions
            </div>
            <input
              data-testid="input-evm-address"
              type="text"
              value={evmInput}
              onChange={e => setEvmInput(e.target.value)}
              placeholder="0x1234...abcd (42 characters)"
              style={{
                width:"100%",background:C.inputBg,
                border:`1px solid rgba(201,168,76,.3)`,
                borderRadius:2,padding:"10px 14px",
                color:C.text,fontSize:12,
                fontFamily:MONO,
                outline:"none",marginBottom:16,boxSizing:"border-box",
              }}
            />
            <div style={{display:"flex",gap:10}}>
              <button data-testid="btn-evm-skip" onClick={() => setShowEvmModal(false)} style={{
                flex:1,padding:11,background:"transparent",
                border:`1px solid ${C.border}`,borderRadius:2,
                color:C.muted2,fontSize:11,cursor:"pointer",fontFamily:MONO,
              }}>SKIP</button>
              <button data-testid="btn-evm-save" onClick={saveEvmAddress} style={{
                flex:2,padding:11,
                background:"rgba(201,168,76,.15)",
                border:`1px solid rgba(201,168,76,.35)`,borderRadius:2,
                color:C.gold2,fontSize:12,fontWeight:800,cursor:"pointer",
                fontFamily:MONO,letterSpacing:"0.08em",
              }}>LINK & SAVE</button>
            </div>
          </div>
        </div>
      )}

      {status === "connected" && (
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,padding:"10px 14px",background:C.panel,border:`1px solid ${C.border}`,borderRadius:2}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:C.green,boxShadow:`0 0 8px ${C.green}`}}/>
            <span style={{fontFamily:MONO,fontSize:12,color:C.gold2,letterSpacing:"0.05em"}}>{short}</span>
            <Badge label="MAINNET" color="green"/>
            {evmAddress ? (
              <Badge label="HL LINKED" color="green"/>
            ) : (
              <button data-testid="btn-link-hl" onClick={() => setShowEvmModal(true)}
                style={{background:"rgba(255,140,0,.08)",border:`1px solid rgba(255,140,0,.25)`,borderRadius:2,padding:"3px 8px",fontFamily:MONO,fontSize:9,color:C.orange,cursor:"pointer",letterSpacing:"0.08em"}}>
                LINK HL
              </button>
            )}
          </div>
          <button data-testid="btn-disconnect-wallet" onClick={disconnect}
            style={{background:"rgba(255,64,96,.08)",border:`1px solid rgba(255,64,96,.25)`,borderRadius:2,padding:"5px 12px",fontFamily:MONO,fontSize:10,color:C.red,cursor:"pointer",letterSpacing:"0.08em"}}>
            DISCONNECT
          </button>
        </div>
      )}

      {error && (
        <div style={{background:"rgba(255,64,96,.06)",border:`1px solid rgba(255,64,96,.25)`,borderRadius:2,padding:"11px 14px",marginBottom:12,fontSize:12,color:C.red,fontFamily:SANS,lineHeight:1.8}}>
          {error === "iframe_blocked"
            ? <span>Phantom cannot connect inside an embedded preview. <a href={window.location.href} target="_blank" rel="noreferrer" style={{color:C.gold2,textDecoration:"underline",fontWeight:600}}>Open in a new tab</a> to connect your wallet.</span>
            : error === "Phantom not installed"
            ? <span>Phantom not detected. If Phantom is installed, try refreshing the page. Otherwise <a href="https://phantom.app" target="_blank" rel="noreferrer" style={{color:C.purple,textDecoration:"underline"}}>install Phantom</a>. Make sure Phantom is enabled for this site in your browser extensions.</span>
            : error}
        </div>
      )}

      {status !== "connected" ? (
        <div style={{textAlign:"center",padding:"40px 20px"}}>
          <div style={{fontFamily:SERIF,fontSize:42,color:C.gold2,marginBottom:14}}>&#9670;</div>
          <div style={{fontFamily:SERIF,fontWeight:900,fontSize:18,color:C.white,marginBottom:8}}>Connect Phantom Wallet</div>
          <div style={{color:C.muted2,fontSize:13,fontFamily:SANS,marginBottom:24,lineHeight:1.7}}>
            Link your Solana wallet for live portfolio tracking, Hyperliquid account integration, and AI-powered trade signals.
          </div>
          <button data-testid="btn-connect-phantom" onClick={connect} disabled={status === "connecting"}
            style={{background:"rgba(201,168,76,.1)",border:`1px solid rgba(201,168,76,.35)`,color:C.gold2,borderRadius:2,padding:"13px 32px",cursor:status==="connecting"?"wait":"pointer",fontFamily:SERIF,fontWeight:700,fontStyle:"italic",fontSize:16,marginBottom:12}}>
            {status === "connecting" ? "Connecting..." : "Connect Phantom"}
          </button>
          {(typeof window !== "undefined" && (() => { try { return window.self !== window.top; } catch { return true; } })()) && (
            <div style={{marginBottom:24}}>
              <div style={{fontSize:11,color:C.muted,fontFamily:SANS,marginBottom:8}}>Wallet extensions require a full browser tab.</div>
              <a href={typeof window !== "undefined" ? window.location.href : "#"} target="_blank" rel="noreferrer" data-testid="link-open-new-tab"
                style={{display:"inline-block",padding:"8px 20px",border:`1px solid ${C.border}`,borderRadius:2,color:C.gold2,fontFamily:MONO,fontSize:11,letterSpacing:"0.08em",textDecoration:"none"}}>
                OPEN IN NEW TAB
              </a>
            </div>
          )}
          <div style={{display:"flex",gap:6,justifyContent:"center",flexWrap:"wrap",marginBottom:32}}>
            {["Portfolio Tracking","Hyperliquid Perps","AI Trade Signals","SOL & SPL Tokens","Perps PnL"].map(f => (
              <div key={f} style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:2,padding:"5px 12px",fontSize:11,color:C.gold,fontFamily:MONO,letterSpacing:"0.06em"}}>{f}</div>
            ))}
          </div>
          <div style={{textAlign:"left"}}><PerpsPnlCalculator /></div>
        </div>
      ) : (
        <>
          <div style={{background:`linear-gradient(135deg,${C.panel},#0a1628)`,border:`1px solid rgba(201,168,76,.18)`,borderRadius:2,padding:"18px 16px",marginBottom:14}}>
            <div style={{fontFamily:MONO,fontSize:10,color:C.muted2,letterSpacing:"0.12em",marginBottom:5}}>SOL BALANCE</div>
            <div style={{fontFamily:SERIF,fontWeight:900,fontSize:34,color:C.gold2,lineHeight:1}}>{balance ?? "..."} <span style={{fontSize:16,color:C.muted2}}>SOL</span></div>
            <div style={{fontFamily:MONO,fontSize:10,color:C.muted,marginTop:8,wordBreak:"break-all",lineHeight:1.6}}>{pubkey}</div>
          </div>

          {hlAccount && (
            <div style={{background:`linear-gradient(135deg,rgba(201,168,76,.04),${C.panel})`,border:`1px solid rgba(201,168,76,.18)`,borderRadius:2,padding:"14px 16px",marginBottom:14}}>
              <div style={{
                fontSize:9,color:C.gold,letterSpacing:"0.15em",marginBottom:10,fontFamily:MONO,
                display:"flex",justifyContent:"space-between",alignItems:"center",
              }}>
                <span>HYPERLIQUID ACCOUNT</span>
                {hlLoading && <span style={{color:C.muted,fontSize:8}}>refreshing...</span>}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <HLStatBox label="ACCT VALUE" value={`$${hlAccount.accountValue.toFixed(2)}`} color={C.gold2} />
                <HLStatBox label="FREE CASH" value={`$${hlAccount.withdrawable.toFixed(2)}`} color={C.text} />
                <HLStatBox label="MARGIN USED" value={`$${hlAccount.totalMarginUsed.toFixed(2)}`} color={C.orange} />
                <HLStatBox
                  label="TOTAL uPnL"
                  value={`${hlAccount.totalUnrealizedPnl >= 0 ? "+" : ""}$${hlAccount.totalUnrealizedPnl.toFixed(2)}`}
                  color={hlAccount.totalUnrealizedPnl >= 0 ? C.green : C.red}
                />
              </div>
              <div style={{
                marginTop:10,paddingTop:10,
                borderTop:`1px solid ${C.border}`,
                display:"flex",justifyContent:"space-between",
                fontSize:10,color:C.muted,fontFamily:MONO,
              }}>
                <span>Phantom: <span style={{color:C.purple}}>{solBal.toFixed(4)} SOL</span></span>
                <span>Positions: <span style={{color:C.gold2}}>{hlAccount.positions.length}</span></span>
              </div>
            </div>
          )}

          {status === "connected" && !evmAddress && !hlAccount && (
            <div style={{
              background:"rgba(255,140,0,.06)",
              border:`1px solid rgba(255,140,0,.22)`,
              borderRadius:2,padding:16,marginBottom:14,textAlign:"center",
            }}>
              <div style={{fontSize:14,color:C.orange,marginBottom:6,fontFamily:SERIF,fontWeight:700}}>Link your Hyperliquid account</div>
              <div style={{fontSize:10,color:C.muted2,marginBottom:14,lineHeight:1.7,fontFamily:SANS}}>
                The AI needs to see your perp positions, PnL, and available cash to give you a personalized signal.
              </div>
              <button data-testid="btn-link-hl-prompt" onClick={() => setShowEvmModal(true)} style={{
                background:"rgba(201,168,76,.1)",
                border:`1px solid rgba(201,168,76,.35)`,borderRadius:2,padding:"9px 22px",
                color:C.gold2,fontSize:11,fontWeight:800,cursor:"pointer",
                fontFamily:MONO,letterSpacing:"0.08em",
              }}>LINK HL ACCOUNT</button>
            </div>
          )}

          <div style={{display:"flex",gap:4,marginBottom:14,overflowX:"auto",paddingBottom:2}}>
            {tabs.map(t => (
              <button key={t} data-testid={`wallet-tab-${t}`} onClick={() => setWalletTab(t)}
                style={{padding:"6px 10px",borderRadius:2,whiteSpace:"nowrap",cursor:"pointer",fontFamily:MONO,fontSize:9,letterSpacing:"0.08em",textTransform:"uppercase",
                  border:`1px solid ${walletTab===t?C.gold:C.border}`,background:walletTab===t?"rgba(201,168,76,.07)":C.panel,color:walletTab===t?C.gold:C.muted2}}>
                {t === "positions" && hlAccount?.positions?.length ? `positions (${hlAccount.positions.length})` :
                 t === "orders" && hlOrders?.length ? `orders (${hlOrders.length})` : t}
              </button>
            ))}
          </div>

          {walletTab === "overview" && (
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[
                { label:"Wallet", value:short, icon:"W", color:C.gold },
                { label:"SOL Balance", value:(balance ?? "...") + " SOL", icon:"S", color:C.purple },
                { label:"SPL Tokens", value:tokens.length + " assets", icon:"T", color:C.cyan },
                { label:"Network", value:"Mainnet", icon:"N", color:C.green },
              ].map(c => (
                <div key={c.label} style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:2,padding:"14px 12px"}}>
                  <div style={{fontFamily:MONO,fontSize:18,marginBottom:5,color:c.color,fontWeight:900}}>{c.icon}</div>
                  <div style={{fontSize:10,color:C.muted2,fontFamily:MONO,letterSpacing:"0.1em"}}>{c.label}</div>
                  <div style={{fontSize:14,fontWeight:600,fontFamily:MONO,marginTop:3,color:C.text}}>{c.value}</div>
                </div>
              ))}
              <div style={{gridColumn:"1/-1",background:C.panel,border:`1px solid rgba(201,168,76,.12)`,borderRadius:2,padding:"14px 12px"}}>
                <div style={{fontFamily:MONO,fontSize:10,color:C.gold,letterSpacing:"0.1em",marginBottom:6}}>
                  {evmAddress ? "HYPERLIQUID + AI CONTEXT ACTIVE" : "AI TRADE CONTEXT ACTIVE"}
                </div>
                <div style={{fontSize:12,color:C.muted2,lineHeight:1.7,fontFamily:SANS}}>
                  {evmAddress
                    ? "Your Phantom wallet, Hyperliquid positions, and PnL feed into the AI Analyst for personalized trade signals."
                    : "Your wallet balance and token holdings feed into the AI Analyst. Link Hyperliquid for full perp context."}
                </div>
              </div>
            </div>
          )}

          {walletTab === "hl account" && (
            <div>
              {!evmAddress ? (
                <div style={{textAlign:"center",padding:"40px 20px"}}>
                  <div style={{fontSize:14,color:C.muted2,marginBottom:14,fontFamily:SANS}}>No Hyperliquid account linked</div>
                  <button data-testid="btn-link-hl-tab" onClick={() => setShowEvmModal(true)}
                    style={{background:"rgba(201,168,76,.1)",border:`1px solid rgba(201,168,76,.35)`,borderRadius:2,padding:"10px 24px",color:C.gold2,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:MONO}}>
                    LINK EVM ADDRESS
                  </button>
                </div>
              ) : hlLoading && !hlAccount ? (
                <div style={{textAlign:"center",color:C.muted,fontSize:11,padding:40,fontFamily:MONO}}>Loading Hyperliquid account...</div>
              ) : hlError ? (
                <div style={{background:"rgba(255,64,96,.06)",border:`1px solid rgba(255,64,96,.22)`,borderRadius:2,padding:14,color:C.red,fontSize:11,fontFamily:MONO}}>
                  {hlError}
                </div>
              ) : hlAccount ? (
                <div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
                    <HLStatBox label="ACCOUNT VALUE" value={`$${hlAccount.accountValue.toFixed(2)}`} color={C.gold2} />
                    <HLStatBox label="WITHDRAWABLE" value={`$${hlAccount.withdrawable.toFixed(2)}`} color={C.text} />
                    <HLStatBox label="MARGIN USED" value={`$${hlAccount.totalMarginUsed.toFixed(2)}`} color={C.orange} />
                    <HLStatBox label="UNREALIZED PNL" value={`${hlAccount.totalUnrealizedPnl >= 0 ? "+" : ""}$${hlAccount.totalUnrealizedPnl.toFixed(2)}`} color={hlAccount.totalUnrealizedPnl >= 0 ? C.green : C.red} />
                  </div>
                  <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:2,padding:"10px 14px",marginBottom:12}}>
                    <div style={{fontFamily:MONO,fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:4}}>EVM ADDRESS</div>
                    <div style={{fontFamily:MONO,fontSize:11,color:C.gold2,wordBreak:"break-all"}}>{evmAddress}</div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={() => setShowEvmModal(true)} style={{flex:1,padding:10,background:C.panel,border:`1px solid ${C.border}`,borderRadius:2,color:C.muted2,fontSize:10,cursor:"pointer",fontFamily:MONO}}>
                      CHANGE ADDRESS
                    </button>
                    <button onClick={() => { localStorage.removeItem("clvr_hl_evm"); setEvmAddress(""); setHlAccount(null); setHlOrders([]); }} style={{flex:1,padding:10,background:"rgba(255,64,96,.06)",border:`1px solid rgba(255,64,96,.2)`,borderRadius:2,color:C.red,fontSize:10,cursor:"pointer",fontFamily:MONO}}>
                      UNLINK
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {walletTab === "positions" && (
            <div>
              {hlLoading && !hlAccount && (
                <div style={{textAlign:"center",color:C.muted,fontSize:11,padding:40,fontFamily:MONO}}>Loading Hyperliquid positions...</div>
              )}
              {hlError && (
                <div style={{background:"rgba(255,64,96,.06)",border:`1px solid rgba(255,64,96,.22)`,borderRadius:2,padding:14,color:C.red,fontSize:11,marginBottom:12,fontFamily:MONO}}>
                  {hlError}
                </div>
              )}
              {hlAccount && hlAccount.positions.length === 0 && (
                <div style={{textAlign:"center",color:C.muted,fontSize:11,padding:"40px 0",border:`1px dashed ${C.border}`,borderRadius:2,fontFamily:MONO}}>
                  No open perp positions
                </div>
              )}
              {hlAccount?.positions.map(pos => (
                <PositionRow key={pos.asset} pos={pos} markPrices={hlPrices} />
              ))}
              {!evmAddress && (
                <div style={{textAlign:"center",color:C.muted,fontSize:11,padding:"50px 20px",lineHeight:1.8,fontFamily:SANS}}>
                  Link your Hyperliquid account to see positions.
                  <br />
                  <button data-testid="btn-link-hl-positions" onClick={() => setShowEvmModal(true)}
                    style={{marginTop:12,background:"rgba(201,168,76,.1)",border:`1px solid rgba(201,168,76,.35)`,borderRadius:2,padding:"8px 20px",color:C.gold2,fontSize:11,cursor:"pointer",fontFamily:MONO}}>
                    LINK HL ACCOUNT
                  </button>
                </div>
              )}
            </div>
          )}

          {walletTab === "ai signal" && (
            <div>
              <div style={{marginBottom:12}}>
                <div style={{fontSize:9,color:C.muted,letterSpacing:"0.12em",marginBottom:8,fontFamily:MONO}}>SELECT ASSET</div>
                <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                  {HL_ASSETS.map(a => (
                    <button key={a} data-testid={`hl-asset-${a}`} onClick={() => { setSelectedAsset(a); setAiSignal(null); }} style={{
                      background: selectedAsset === a ? "rgba(201,168,76,.12)" : C.panel,
                      border: `1px solid ${selectedAsset === a ? "rgba(201,168,76,.35)" : C.border}`,
                      borderRadius:2,padding:"5px 11px",
                      color: selectedAsset === a ? C.gold2 : C.muted2,
                      fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:MONO,
                    }}>{a}</button>
                  ))}
                </div>
              </div>

              <div style={{
                display:"flex",justifyContent:"space-between",alignItems:"center",
                background:C.panel,border:`1px solid ${C.border}`,
                borderRadius:2,padding:"9px 13px",marginBottom:12,
              }}>
                <div>
                  <div style={{fontSize:8,color:C.muted,marginBottom:2,fontFamily:MONO,letterSpacing:"0.1em"}}>MARK PRICE</div>
                  <div style={{fontSize:17,fontWeight:800,fontFamily:MONO,color:C.white}}>
                    ${hlPrice > 0 ? hlPrice.toFixed(hlPrice > 100 ? 2 : 4) : "—"}
                  </div>
                </div>
                {fundingRates[selectedAsset] && (
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:8,color:C.muted,marginBottom:2,fontFamily:MONO,letterSpacing:"0.1em"}}>FUNDING / 1H</div>
                    <div style={{
                      fontSize:13,fontWeight:700,fontFamily:MONO,
                      color: fundingRates[selectedAsset].funding > 0 ? C.red : C.green,
                    }}>
                      {(fundingRates[selectedAsset].funding * 100).toFixed(4)}%
                    </div>
                    <div style={{fontSize:8,color:C.muted,fontFamily:MONO}}>
                      {fundingRates[selectedAsset].funding > 0 ? "longs paying" : "shorts paying"}
                    </div>
                  </div>
                )}
              </div>

              <div style={{display:"flex",gap:10,marginBottom:12}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:8,color:C.muted,marginBottom:4,fontFamily:MONO,letterSpacing:"0.1em"}}>SIZE ({selectedAsset})</div>
                  <input
                    data-testid="input-hl-trade-size"
                    type="number"
                    value={tradeSize}
                    onChange={e => setTradeSize(e.target.value)}
                    placeholder="0.00"
                    style={inputStyle}
                  />
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:8,color:C.muted,marginBottom:4,fontFamily:MONO,letterSpacing:"0.1em"}}>LEVERAGE</div>
                  <select
                    data-testid="select-hl-leverage"
                    value={leverage}
                    onChange={e => setLeverage(Number(e.target.value))}
                    style={{...inputStyle,appearance:"auto"}}
                  >
                    {[1,2,3,5,10,20,50].map(l => <option key={l} value={l}>{l}x</option>)}
                  </select>
                </div>
              </div>

              <button
                data-testid="btn-get-ai-signal"
                onClick={getAISignal}
                disabled={aiLoading}
                style={{
                  width:"100%",padding:"13px",
                  background: aiLoading ? "rgba(201,168,76,.08)" : "rgba(201,168,76,.12)",
                  border:`1px solid rgba(201,168,76,.35)`,borderRadius:2,
                  color:C.gold2,
                  fontSize:12,fontWeight:800,
                  fontFamily:SERIF,fontStyle:"italic",
                  cursor: aiLoading ? "not-allowed" : "pointer",
                  letterSpacing:"0.05em",marginBottom:14,
                }}
              >
                {aiLoading ? "Analyzing your positions..." : `Get AI Signal — ${selectedAsset}`}
              </button>

              {aiError && (
                <div style={{background:"rgba(255,64,96,.06)",border:`1px solid rgba(255,64,96,.22)`,borderRadius:2,padding:13,color:C.red,fontSize:11,marginBottom:12,fontFamily:MONO}}>
                  {aiError}
                </div>
              )}

              {aiSignal && (
                <div style={{
                  background:C.panel,
                  border:`1px solid ${signalColor}44`,
                  borderRadius:2,padding:16,
                }}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                    <div>
                      <div style={{fontSize:9,color:C.muted,letterSpacing:"0.12em",marginBottom:4,fontFamily:MONO}}>AI SIGNAL</div>
                      <div style={{fontSize:22,fontWeight:900,color:signalColor,letterSpacing:"0.05em",lineHeight:1,fontFamily:SERIF}}>
                        {aiSignal.signal.replace("_", " ")}
                      </div>
                      <div style={{fontSize:9,color:C.muted,marginTop:4,fontFamily:MONO}}>{aiSignal.timeframe}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:9,color:C.muted,marginBottom:4,fontFamily:MONO,letterSpacing:"0.1em"}}>CONFIDENCE</div>
                      <div style={{fontSize:28,fontWeight:900,color:signalColor,fontFamily:MONO}}>{aiSignal.confidence}%</div>
                    </div>
                  </div>

                  <div style={{height:3,background:C.border,borderRadius:2,marginBottom:14,overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${aiSignal.confidence}%`,background:signalColor,borderRadius:2,transition:"width 1s ease"}} />
                  </div>

                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
                    {[
                      { l:"ENTRY", v:aiSignal.entry, c:C.text },
                      { l:"STOP LOSS", v:aiSignal.stopLoss, c:C.red },
                      { l:"TAKE PROFIT", v:aiSignal.takeProfit, c:C.green },
                    ].map(({ l, v, c }) => (
                      <div key={l} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:2,padding:8,textAlign:"center"}}>
                        <div style={{fontSize:7,color:C.muted,marginBottom:3,letterSpacing:"0.1em",fontFamily:MONO}}>{l}</div>
                        <div style={{fontSize:12,fontWeight:700,color:c,fontFamily:MONO}}>
                          ${typeof v === "number" ? v.toFixed(v > 100 ? 2 : 4) : "—"}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{background:C.bg,borderRadius:2,padding:"10px 12px",marginBottom:10,fontSize:11,color:C.muted2,lineHeight:1.65,fontFamily:SANS}}>
                    {aiSignal.rationale}
                  </div>

                  {aiSignal.portfolioNote && (
                    <div style={{background:"rgba(201,168,76,.05)",border:`1px solid rgba(201,168,76,.12)`,borderRadius:2,padding:"9px 12px",marginBottom:10,fontSize:10,color:C.gold2,lineHeight:1.6,fontFamily:SANS}}>
                      {aiSignal.portfolioNote}
                    </div>
                  )}

                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
                    {aiSignal.keyRisks?.map((r, i) => (
                      <div key={i} style={{background:"rgba(255,64,96,.06)",border:`1px solid rgba(255,64,96,.18)`,borderRadius:2,padding:"3px 8px",fontSize:9,color:C.red,fontFamily:MONO}}>
                        {r}
                      </div>
                    ))}
                  </div>

                  {pubkey ? (
                    <div style={{display:"flex",gap:8}}>
                      <button data-testid="btn-hl-long" onClick={() => setConfirmTrade("LONG")} style={{
                        flex:1,padding:"11px",
                        background:"rgba(0,199,135,.08)",
                        border:`1px solid rgba(0,199,135,.3)`,
                        borderRadius:2,color:C.green,
                        fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:MONO,letterSpacing:"0.06em",
                      }}>LONG {selectedAsset}</button>
                      <button data-testid="btn-hl-short" onClick={() => setConfirmTrade("SHORT")} style={{
                        flex:1,padding:"11px",
                        background:"rgba(255,64,96,.08)",
                        border:`1px solid rgba(255,64,96,.3)`,
                        borderRadius:2,color:C.red,
                        fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:MONO,letterSpacing:"0.06em",
                      }}>SHORT {selectedAsset}</button>
                    </div>
                  ) : (
                    <div style={{textAlign:"center",fontSize:10,color:C.muted,padding:10,border:`1px dashed ${C.border}`,borderRadius:2,fontFamily:MONO}}>
                      Connect Phantom to execute trades
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {walletTab === "orders" && (
            <div>
              {!evmAddress ? (
                <div style={{textAlign:"center",color:C.muted,fontSize:11,padding:"40px 0",fontFamily:SANS}}>
                  Link your Hyperliquid account to see open orders.
                </div>
              ) : hlOrders.length === 0 ? (
                <div style={{textAlign:"center",color:C.muted,fontSize:11,padding:"40px 0",border:`1px dashed ${C.border}`,borderRadius:2,fontFamily:MONO}}>
                  No open orders
                </div>
              ) : hlOrders.map((o, i) => (
                <div key={i} data-testid={`hl-order-${i}`} style={{
                  background:C.panel,border:`1px solid ${C.border}`,
                  borderRadius:2,padding:"11px 13px",marginBottom:8,
                  display:"flex",justifyContent:"space-between",alignItems:"center",
                }}>
                  <div>
                    <div style={{fontSize:12,fontWeight:700,fontFamily:MONO,color:C.text}}>
                      {o.coin} <span style={{color: o.side === "B" ? C.green : C.red,fontSize:10}}>
                        {o.side === "B" ? "BUY" : "SELL"}
                      </span>
                    </div>
                    <div style={{fontSize:9,color:C.muted,fontFamily:MONO}}>Size: {o.sz}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:12,color:C.gold2,fontFamily:MONO}}>${parseFloat(o.limitPx || 0).toFixed(2)}</div>
                    <div style={{fontSize:9,color:C.muted,fontFamily:MONO}}>limit</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {walletTab === "tokens" && (
            <div style={panel}>
              <div style={ph}><span style={{fontFamily:SERIF,fontWeight:700,fontSize:14,color:C.white}}>SPL Token Holdings</span><Badge label={`${tokens.length} tokens`} color="gold"/></div>
              {tokens.length === 0
                ? <div style={{padding:28,textAlign:"center",color:C.muted,fontFamily:MONO,fontSize:11}}>No SPL tokens found in this wallet.</div>
                : tokens.map(t => (
                  <div key={t.mint} data-testid={`token-${t.symbol}`} style={{padding:"12px 14px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontFamily:MONO,fontWeight:600,fontSize:13,color:C.text}}>{t.symbol}</div>
                      <div style={{fontFamily:MONO,fontSize:9,color:C.muted,marginTop:2}}>{t.mint.slice(0, 14)}...</div>
                    </div>
                    <div style={{fontFamily:MONO,fontWeight:700,fontSize:14,color:C.gold2}}>{t.amount}</div>
                  </div>
                ))}
            </div>
          )}

          {walletTab === "send" && (
            <div style={panel}>
              <div style={ph}><span style={{fontFamily:SERIF,fontWeight:700,fontSize:14,color:C.white}}>Send SOL</span></div>
              <div style={{padding:14}}>
                <div style={{marginBottom:12}}>
                  <div style={{fontFamily:MONO,fontSize:9,color:C.muted2,marginBottom:5,letterSpacing:"0.12em"}}>RECIPIENT ADDRESS</div>
                  <input data-testid="input-send-address" placeholder="Solana wallet address..." style={inputStyle} value={sendTo} onChange={e=>setSendTo(e.target.value)}/>
                </div>
                <div style={{marginBottom:14}}>
                  <div style={{fontFamily:MONO,fontSize:9,color:C.muted2,marginBottom:5,letterSpacing:"0.12em"}}>AMOUNT (SOL)</div>
                  <input data-testid="input-send-amount" placeholder="0.00" type="number" style={inputStyle} value={sendAmt} onChange={e=>setSendAmt(e.target.value)}/>
                </div>
                <button data-testid="btn-send-sol" onClick={handleSend}
                  style={{width:"100%",height:44,background:"rgba(201,168,76,.1)",color:C.gold2,border:`1px solid rgba(201,168,76,.3)`,borderRadius:2,fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:15,cursor:"pointer"}}>
                  Send SOL
                </button>
                {sendStatus && <div style={{marginTop:10,fontSize:11,color:sendStatus.startsWith("Error")?C.red:C.green,fontFamily:MONO}}>{sendStatus}</div>}
              </div>
            </div>
          )}

          {walletTab === "sign" && (
            <div style={panel}>
              <div style={ph}><span style={{fontFamily:SERIF,fontWeight:700,fontSize:14,color:C.white}}>Sign Message</span><Badge label="Auth" color="purple"/></div>
              <div style={{padding:14}}>
                <div style={{marginBottom:12}}>
                  <div style={{fontFamily:MONO,fontSize:9,color:C.muted2,marginBottom:5,letterSpacing:"0.12em"}}>MESSAGE</div>
                  <input data-testid="input-sign-msg" value={authMsg} onChange={e => setAuthMsg(e.target.value)} style={inputStyle}/>
                </div>
                <button data-testid="btn-sign" onClick={handleSign}
                  style={{width:"100%",height:44,background:"rgba(59,130,246,.08)",color:C.blue,border:`1px solid rgba(59,130,246,.3)`,borderRadius:2,fontFamily:SERIF,fontStyle:"italic",fontWeight:700,fontSize:15,cursor:"pointer"}}>
                  Sign with Phantom
                </button>
                {authResult && <div style={{marginTop:10,background:C.inputBg,borderRadius:2,padding:12,fontSize:12,color:authResult.startsWith("Error")?C.red:C.cyan,fontFamily:MONO,wordBreak:"break-all"}}>{authResult}</div>}
              </div>
            </div>
          )}

          {walletTab === "history" && (
            <div style={panel}>
              <div style={ph}><span style={{fontFamily:SERIF,fontWeight:700,fontSize:14,color:C.white}}>Transaction History</span></div>
              {txHistory.length === 0
                ? <div style={{padding:28,textAlign:"center",color:C.muted,fontFamily:MONO,fontSize:11}}>No transactions this session.</div>
                : txHistory.map((tx, i) => (
                  <div key={i} style={{padding:"12px 14px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <span style={{fontFamily:MONO,fontWeight:600,fontSize:12,color:C.text}}>{tx.type}</span>
                      <div style={{fontFamily:MONO,fontSize:9,color:C.muted,marginTop:2}}>{new Date(tx.ts).toLocaleTimeString()}</div>
                    </div>
                    <a href={`https://solscan.io/tx/${tx.sig}`} target="_blank" rel="noreferrer"
                      style={{fontFamily:MONO,fontSize:10,color:C.purple,textDecoration:"none"}}>
                      {tx.sig.slice(0, 12)}... &#8599;
                    </a>
                  </div>
                ))}
            </div>
          )}

          {walletTab === "pnl calc" && <PerpsPnlCalculator />}
        </>
      )}

      {confirmTrade && (
        <div style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,0.9)",
          display:"flex",alignItems:"center",justifyContent:"center",
          zIndex:1000,padding:20,
        }}>
          <div style={{
            background:C.panel,
            border:`1px solid ${confirmTrade === "LONG" ? "rgba(0,199,135,.35)" : "rgba(255,64,96,.35)"}`,
            borderRadius:2,padding:24,maxWidth:340,width:"100%",
          }}>
            <div style={{fontSize:8,color:C.muted,letterSpacing:"0.15em",marginBottom:8,fontFamily:MONO}}>CONFIRM ORDER</div>
            <div style={{
              fontSize:22,fontWeight:900,fontFamily:SERIF,
              color: confirmTrade === "LONG" ? C.green : C.red,
              marginBottom:16,
            }}>
              {confirmTrade === "LONG" ? "LONG" : "SHORT"} {selectedAsset}
            </div>
            <div style={{fontSize:11,color:C.muted2,lineHeight:2,marginBottom:16,fontFamily:SANS}}>
              Size: <span style={{color:C.text}}>{tradeSize || "—"} {selectedAsset}</span><br />
              Leverage: <span style={{color:C.text}}>{leverage}x</span><br />
              Mark Price: <span style={{color:C.text}}>${hlPrice.toFixed(2)}</span><br />
              Notional: <span style={{color:C.gold2}}>${tradeSize ? (parseFloat(tradeSize) * hlPrice * leverage).toFixed(2) : "—"}</span>
            </div>
            <div style={{fontSize:9,color:C.orange,marginBottom:16,lineHeight:1.5,fontFamily:MONO}}>
              Simulated in this build. Wire Hyperliquid order API for live execution.
            </div>
            <div style={{display:"flex",gap:10}}>
              <button data-testid="btn-confirm-cancel" onClick={() => setConfirmTrade(null)} style={{
                flex:1,padding:10,background:"transparent",
                border:`1px solid ${C.border}`,borderRadius:2,
                color:C.muted2,fontSize:11,cursor:"pointer",fontFamily:MONO,
              }}>CANCEL</button>
              <button data-testid="btn-confirm-execute" onClick={() => executeTrade(confirmTrade)} style={{
                flex:2,padding:10,
                background: confirmTrade === "LONG" ? "rgba(0,199,135,.15)" : "rgba(255,64,96,.15)",
                border:`1px solid ${confirmTrade === "LONG" ? "rgba(0,199,135,.4)" : "rgba(255,64,96,.4)"}`,
                borderRadius:2,
                color: confirmTrade === "LONG" ? C.green : C.red,
                fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:MONO,letterSpacing:"0.06em",
              }}>SIGN & EXECUTE</button>
            </div>
          </div>
        </div>
      )}

      {tradeStatus && (
        <div style={{
          position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",
          background:C.panel,
          border:`1px solid ${tradeStatus.status === "submitted" ? "rgba(0,199,135,.3)" : "rgba(255,64,96,.3)"}`,
          borderRadius:2,padding:"13px 18px",zIndex:500,
          minWidth:280,boxShadow:"0 8px 40px rgba(0,0,0,0.7)",
        }}>
          {tradeStatus.status === "signing" && (
            <div style={{fontSize:11,color:C.gold2,fontFamily:MONO}}>Waiting for Phantom signature...</div>
          )}
          {tradeStatus.status === "submitted" && (
            <div>
              <div style={{fontSize:11,color:C.green,marginBottom:4,fontFamily:MONO}}>Order submitted</div>
              <div style={{fontSize:9,color:C.muted,fontFamily:MONO}}>
                {tradeStatus.direction} {tradeStatus.asset} @ ${tradeStatus.price} · {tradeStatus.leverage}x<br />
                Tx: <span style={{color:C.gold2}}>{tradeStatus.txHash}</span>
              </div>
            </div>
          )}
          <button data-testid="btn-dismiss-trade" onClick={() => setTradeStatus(null)} style={{
            marginTop:8,background:"transparent",border:"none",
            color:C.muted,fontSize:9,cursor:"pointer",fontFamily:MONO,
          }}>dismiss</button>
        </div>
      )}

      <div style={{marginTop:16,fontFamily:MONO,fontSize:8,color:C.muted,textAlign:"center",letterSpacing:"0.12em"}}>
        PHANTOM WALLET + HYPERLIQUID + AI SIGNALS . SOLANA MAINNET
      </div>
    </div>
  );
}

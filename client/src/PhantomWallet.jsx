import { useState, useEffect, useCallback } from "react";

const KNOWN_MINTS = {
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "USDT",
  "So11111111111111111111111111111111111111112": "wSOL",
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": "ETH",
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So": "mSOL",
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263": "BONK",
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN": "JUP",
};

const SOL_RPC = "https://api.mainnet-beta.solana.com";

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

  const getProvider = () =>
    typeof window !== "undefined" && window.solana?.isPhantom
      ? window.solana
      : null;

  const fetchBalance = useCallback(async (pk) => {
    try {
      const res = await fetch(SOL_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1,
          method: "getBalance",
          params: [pk],
        }),
      });
      const { result } = await res.json();
      setBalance((result.value / 1e9).toFixed(4));
    } catch {
      setBalance("--");
    }
  }, []);

  const fetchTokens = useCallback(async (pk) => {
    try {
      const res = await fetch(SOL_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1,
          method: "getTokenAccountsByOwner",
          params: [
            pk,
            { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
            { encoding: "jsonParsed" },
          ],
        }),
      });
      const { result } = await res.json();
      const parsed = (result?.value || [])
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

  useEffect(() => {
    const provider = getProvider();
    if (!provider) return;
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
  }, []);

  useEffect(() => {
    if (pubkey && status === "connected") {
      fetchBalance(pubkey);
      fetchTokens(pubkey);
    }
  }, [pubkey, status]);

  const connect = async () => {
    const provider = getProvider();
    if (!provider) { setError("Phantom not installed"); return; }
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
    const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = await import("@solana/web3.js");
    const connection = new Connection(SOL_RPC);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(pubkey),
        toPubkey: new PublicKey(to),
        lamports: Math.round(solAmount * LAMPORTS_PER_SOL),
      })
    );
    tx.feePayer = new PublicKey(pubkey);
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const { signature } = await provider.signAndSendTransaction(tx);
    setTxHistory(h => [{ sig: signature, type: "SOL Transfer", ts: Date.now() }, ...h.slice(0, 9)]);
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

  const short = pubkey ? pubkey.slice(0, 4) + "..." + pubkey.slice(-4) : "";

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

  const tabs = ["overview", "tokens", "send", "sign", "history", "pnl calc"];
  const panel = {background:C.panel,border:`1px solid ${C.border}`,borderRadius:2,overflow:"hidden",marginBottom:10};
  const ph = {display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",borderBottom:`1px solid ${C.border}`,background:"rgba(201,168,76,.03)"};
  const inputStyle = {width:"100%",background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:2,padding:"11px 14px",color:C.text,fontSize:13,fontFamily:MONO,boxSizing:"border-box",outline:"none"};

  return (
    <div>
      {status === "connected" && (
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,padding:"10px 14px",background:C.panel,border:`1px solid ${C.border}`,borderRadius:2}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:C.green,boxShadow:`0 0 8px ${C.green}`}}/>
            <span style={{fontFamily:MONO,fontSize:12,color:C.gold2,letterSpacing:"0.05em"}}>{short}</span>
            <Badge label="MAINNET" color="green"/>
          </div>
          <button data-testid="btn-disconnect-wallet" onClick={disconnect}
            style={{background:"rgba(255,64,96,.08)",border:`1px solid rgba(255,64,96,.25)`,borderRadius:2,padding:"5px 12px",fontFamily:MONO,fontSize:10,color:C.red,cursor:"pointer",letterSpacing:"0.08em"}}>
            DISCONNECT
          </button>
        </div>
      )}

      {error && (
        <div style={{background:"rgba(255,64,96,.06)",border:`1px solid rgba(255,64,96,.25)`,borderRadius:2,padding:"11px 14px",marginBottom:12,fontSize:12,color:C.red,fontFamily:SANS}}>
          {error === "Phantom not installed"
            ? <span>Phantom not detected. <a href="https://phantom.app" target="_blank" rel="noreferrer" style={{color:C.purple,textDecoration:"underline"}}>Install Phantom</a></span>
            : error}
        </div>
      )}

      {status !== "connected" ? (
        <div style={{textAlign:"center",padding:"40px 20px"}}>
          <div style={{fontFamily:SERIF,fontSize:42,color:C.gold2,marginBottom:14}}>&#9670;</div>
          <div style={{fontFamily:SERIF,fontWeight:900,fontSize:18,color:C.white,marginBottom:8}}>Connect Phantom Wallet</div>
          <div style={{color:C.muted2,fontSize:13,fontFamily:SANS,marginBottom:24,lineHeight:1.7}}>
            Link your Solana wallet for live portfolio tracking, trade signing, and AI-powered analysis.
          </div>
          <button data-testid="btn-connect-phantom" onClick={connect} disabled={status === "connecting"}
            style={{background:"rgba(201,168,76,.1)",border:`1px solid rgba(201,168,76,.35)`,color:C.gold2,borderRadius:2,padding:"13px 32px",cursor:status==="connecting"?"wait":"pointer",fontFamily:SERIF,fontWeight:700,fontStyle:"italic",fontSize:16,marginBottom:24}}>
            {status === "connecting" ? "Connecting..." : "Connect Phantom"}
          </button>
          <div style={{display:"flex",gap:6,justifyContent:"center",flexWrap:"wrap",marginBottom:32}}>
            {["Portfolio Tracking","SOL & SPL Tokens","Sign Transactions","AI Trade Context","Perps PnL"].map(f => (
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

          <div style={{display:"flex",gap:4,marginBottom:14,overflowX:"auto",paddingBottom:2}}>
            {tabs.map(t => (
              <button key={t} data-testid={`wallet-tab-${t}`} onClick={() => setWalletTab(t)}
                style={{padding:"6px 12px",borderRadius:2,whiteSpace:"nowrap",cursor:"pointer",fontFamily:MONO,fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",
                  border:`1px solid ${walletTab===t?C.gold:C.border}`,background:walletTab===t?"rgba(201,168,76,.07)":C.panel,color:walletTab===t?C.gold:C.muted2}}>
                {t}
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
                <div style={{fontFamily:MONO,fontSize:10,color:C.gold,letterSpacing:"0.1em",marginBottom:6}}>AI TRADE CONTEXT ACTIVE</div>
                <div style={{fontSize:12,color:C.muted2,lineHeight:1.7,fontFamily:SANS}}>
                  Your wallet balance and token holdings feed into the AI Analyst. Ask "should I hold SOL?" for a context-aware answer.
                </div>
              </div>
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

      <div style={{marginTop:16,fontFamily:MONO,fontSize:8,color:C.muted,textAlign:"center",letterSpacing:"0.12em"}}>
        PHANTOM WALLET + PERPS PNL . SOLANA MAINNET
      </div>
    </div>
  );
}

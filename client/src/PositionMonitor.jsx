import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "./lib/apiClient";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const DISCLAIMER = "Systematic technical reads, not financial advice or predictions.";
const money = value => value == null || !Number.isFinite(Number(value))
  ? "Unavailable" : `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
const qty = value => value == null || !Number.isFinite(Number(value))
  ? "Unavailable" : Number(value).toLocaleString(undefined, { maximumFractionDigits: 8 });
const when = (value, timeZone) => value
  ? new Date(value).toLocaleString(undefined, timeZone ? { timeZone } : undefined)
  : "—";
const pnlMoney = value => value == null || !Number.isFinite(Number(value))
  ? "Unavailable" : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
const pnlPeriods = ["daily", "monthly", "quarterly", "yearly"];

export default function PositionMonitor({ C, MONO, SANS, SERIF }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [pnlPeriod, setPnlPeriod] = useState("daily");
  const [pnlByPeriod, setPnlByPeriod] = useState({});
  const [pnlLoading, setPnlLoading] = useState(false);
  const [pnlRefreshing, setPnlRefreshing] = useState(false);
  const [pnlError, setPnlError] = useState("");
  const [selectedPnlDay, setSelectedPnlDay] = useState(null);
  const pnlCache = useRef({});

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const response = await apiFetch("/api/portfolio-advisor", { credentials: "include", cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Portfolio data unavailable (HTTP ${response.status}).`);
      setData(payload);
      setError("");
    } catch (e) {
      setError(e?.message || "Could not load Portfolio Advisor data. Retry.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadPnl = useCallback(async (period, force = false, timeZone = "") => {
    const cacheKey = `${timeZone}:${period}`;
    const cached = pnlCache.current[cacheKey];
    if (!force && cached && Date.now() - new Date(cached.fetchedAt).getTime() < 15 * 60_000) {
      setPnlError("");
      return;
    }
    if (force) setPnlRefreshing(true);
    else setPnlLoading(true);
    try {
      const query = new URLSearchParams({ period });
      if (force) query.set("refresh", "1");
      const response = await apiFetch(`/api/portfolio-advisor/pnl?${query}`, { credentials: "include", cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `PnL data unavailable (HTTP ${response.status}).`);
      pnlCache.current[cacheKey] = payload;
      setPnlByPeriod(previous => ({ ...previous, [cacheKey]: payload }));
      setPnlError("");
    } catch (e) {
      setPnlError(e?.message || "Could not load live PnL. Retry.");
    } finally {
      setPnlLoading(false);
      setPnlRefreshing(false);
    }
  }, [pnlCache]);

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), 60_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!data || data.requiresSetup) return;
    void loadPnl(pnlPeriod, false, data.timeZone);
    const id = setInterval(() => loadPnl(pnlPeriod, true, data.timeZone), 15 * 60_000);
    return () => clearInterval(id);
  }, [data?.requiresSetup, data?.timeZone, pnlPeriod, loadPnl]);

  const currentPlans = useMemo(() => (data?.plans || []).filter(plan => plan.local_date === data?.localDate), [data]);
  const morning = currentPlans.find(plan => plan.phase === "morning")?.content;
  const evening = currentPlans.find(plan => plan.phase === "evening")?.content;
  const currentPnl = pnlByPeriod[`${data?.timeZone || ""}:${pnlPeriod}`];
  const pnlDays = currentPnl?.dailyBreakdown || [];
  const selectedDay = pnlDays.find(day => day.date === selectedPnlDay) || null;

  const card = { background: "#0A0A0A", border: `1px solid ${C.border}`, borderRadius: 6, padding: 15, marginBottom: 12 };
  const label = { fontFamily: MONO, fontSize: 8, color: C.muted2, letterSpacing: "0.15em", textTransform: "uppercase" };
  const section = title => <div style={{ fontFamily: SERIF, fontSize: 19, color: C.gold, margin: "20px 0 10px" }}>{title}</div>;
  const valueLine = (title, value, tint = C.text) => (
    <div key={title} style={{ fontFamily: MONO, fontSize: 10, color: C.muted2, marginTop: 5, lineHeight: 1.6 }}>
      <span style={{ color: C.muted }}>{title}: </span><span style={{ color: tint }}>{value}</span>
    </div>
  );

  const planCard = (title, plan) => (
    <section key={title} style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.gold, letterSpacing: "0.12em" }}>{title}</div>
        <div style={label}>{plan ? when(plan.generatedAt, data?.timeZone) : "Not generated yet"}</div>
      </div>
      {!plan ? <div style={{ fontFamily: SANS, fontSize: 12, color: C.muted2, marginTop: 10 }}>
        {title.startsWith("MORNING") ? "The daily plan is created after 6:30 AM once the current signal tables are ready." : "The evening plan is created at 9:00 PM local time after a morning plan exists."}
      </div> : (
        <>
          <div style={{ marginTop: 11, fontFamily: MONO, fontSize: 9, color: C.muted2 }}>Signals: {plan.signalTables?.main} · {plan.signalTables?.xyz} (Main {plan.signalTables?.counts?.main ?? 0}, xyz {plan.signalTables?.counts?.xyz ?? 0})</div>
          <div style={{ marginTop: 7, fontFamily: SANS, fontSize: 11, color: C.text }}>
            Combined account value: <b style={{ color: C.gold }}>{money(plan.account?.total)}</b>
            {plan.account && <div style={{ ...label, marginTop: 5 }}>Main perps {money(plan.account.mainPerps)} · xyz perps {money(plan.account.xyzPerps)} · free spot USDC {money(plan.account.spotFreeUsdc)}</div>}
          </div>
          {plan.candidates?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={label}>New candidates · existing signal direction only</div>
              {plan.candidates.map((candidate, index) => (
                <div key={`${candidate.symbol}-${index}`} style={{ marginTop: 8, padding: 10, background: "#080d18", border: `1px solid ${C.border}`, borderRadius: 4 }}>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: candidate.direction === "LONG" ? C.green : C.red }}>{candidate.direction} {candidate.symbol} · {candidate.leverage}x</div>
                  {valueLine("Entry", money(candidate.entry))}
                  {valueLine("Stop / target", `${money(candidate.stop)} / ${money(candidate.target)}`)}
                  {valueLine("Size / notional", `${qty(candidate.size)} units / ${money(candidate.notionalUsd)}`)}
                  {valueLine("Stop risk", `${money(candidate.stopRiskUsd)} (${Number(candidate.riskPctAccount).toFixed(2)}% of combined account)`)}
                </div>
              ))}
            </div>
          )}
          {plan.candidateNote && <div style={{ fontFamily: SANS, fontSize: 10, color: C.muted2, marginTop: 9 }}>{plan.candidateNote}</div>}
          {plan.daySummary && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
              <div style={label}>Day summary</div>
              {valueLine("Realized PnL today", money(plan.daySummary.realizedPnlToday))}
              {valueLine("Account value vs morning", plan.daySummary.accountValueChangeSinceMorning == null ? "Unavailable" : money(plan.daySummary.accountValueChangeSinceMorning))}
              {plan.daySummary.closed?.map((fill, i) => valueLine(`Closed ${fill.coin} ${i + 1}`, `${fill.direction} at ${money(fill.price)} · realized ${money(fill.realizedPnl)}`))}
            </div>
          )}
          <div style={{ fontFamily: MONO, fontSize: 9, color: C.muted2, marginTop: 12, lineHeight: 1.5 }}>{plan.disclaimer || DISCLAIMER}</div>
        </>
      )}
    </section>
  );

  const pnlSection = (
    <>
      {section("PNL TRACKER")}
      <section style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {pnlPeriods.map(period => (
              <button key={period} onClick={() => { setPnlPeriod(period); setSelectedPnlDay(null); }}
                aria-pressed={pnlPeriod === period}
                style={{ background: pnlPeriod === period ? "#242014" : "transparent", border: `1px solid ${pnlPeriod === period ? C.gold : C.border}`, borderRadius: 4, color: pnlPeriod === period ? C.gold : C.muted2, padding: "6px 9px", fontFamily: MONO, fontSize: 9, textTransform: "uppercase" }}>
                {period}
              </button>
            ))}
          </div>
          {!data?.requiresSetup && <button onClick={() => loadPnl(pnlPeriod, true, data?.timeZone)} disabled={pnlRefreshing}
            style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 4, color: C.gold, padding: "6px 9px", fontFamily: MONO, fontSize: 9 }}>
            {pnlRefreshing ? "UPDATING…" : "REFRESH PNL"}
          </button>}
        </div>
        {data?.requiresSetup ? (
          <div style={{ fontFamily: SANS, fontSize: 11, color: C.muted2, marginTop: 12 }}>
            Connect the public wallet and select a time zone in Account settings before PnL can be shown.
          </div>
        ) : pnlError ? (
          <div role="alert" style={{ fontFamily: MONO, fontSize: 10, color: C.red, marginTop: 12 }}>
            {pnlError} <button onClick={() => loadPnl(pnlPeriod, true, data?.timeZone)} style={{ marginLeft: 5 }}>Retry</button>
          </div>
        ) : pnlLoading && !currentPnl ? (
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted2, marginTop: 12 }}>Loading live fills and funding…</div>
        ) : currentPnl ? (
          <>
            <div style={{ ...label, marginTop: 12 }}>{pnlPeriod.toUpperCase()} · {currentPnl.periodKey} · {currentPnl.timeZone}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: "8px 14px", marginTop: 10 }}>
              {valueLine("Realized PnL", pnlMoney(currentPnl.current.realizedPnl), currentPnl.current.realizedPnl >= 0 ? C.green : C.red)}
              {valueLine("Funding PnL", pnlMoney(currentPnl.current.fundingPnl), currentPnl.current.fundingPnl >= 0 ? C.green : C.red)}
              {valueLine("Total PnL · realized + funding", pnlMoney(currentPnl.current.totalPnl), currentPnl.current.totalPnl >= 0 ? C.green : C.red)}
              {valueLine("Open positions — unrealized", pnlMoney(currentPnl.current.unrealizedPnl), currentPnl.current.unrealizedPnl == null ? C.muted2 : currentPnl.current.unrealizedPnl >= 0 ? C.green : C.red)}
              {valueLine(`Previous period total · ${currentPnl.previousStartDate} → ${currentPnl.currentStartDate}`, pnlMoney(currentPnl.previous.totalPnl), currentPnl.previous.totalPnl >= 0 ? C.green : C.red)}
            </div>
            <div style={{ ...label, marginTop: 12 }}>
              {currentPnl.noTrades ? "No trades in this period" : `${currentPnl.current.tradesCount} closed fills · ${currentPnl.current.wins} wins · ${currentPnl.current.losses} losses`}
            </div>
            {currentPnl.current.bestTrade && valueLine("Best trade", `${currentPnl.current.bestTrade.coin} ${currentPnl.current.bestTrade.side} · ${pnlMoney(currentPnl.current.bestTrade.realizedPnl)}`, C.green)}
            {currentPnl.current.worstTrade && valueLine("Worst trade", `${currentPnl.current.worstTrade.coin} ${currentPnl.current.worstTrade.side} · ${pnlMoney(currentPnl.current.worstTrade.realizedPnl)}`, C.red)}
            <div style={{ ...label, marginTop: 9 }}>Period total excludes open-position unrealized PnL. All figures use fills and funding only.</div>
            {pnlPeriod === "daily" ? (
              <div style={{ marginTop: 14 }}>
                <div style={label}>TODAY’S CLOSE FILLS</div>
                {currentPnl.current.fills.length === 0
                  ? <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted2, marginTop: 8 }}>$0.00 realized · no trades</div>
                  : <>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(70px,1fr) minmax(80px,1.2fr) minmax(70px,1fr) minmax(70px,1fr)", gap: 6, padding: "8px 0 4px", color: C.muted2, fontFamily: MONO, fontSize: 8 }}>
                    <span>COIN</span><span>SIDE</span><span>CLOSE · SIZE</span><span>REALIZED</span>
                  </div>
                  {currentPnl.current.fills.map((fill, index) => (
                    <div key={fill.id || `${fill.coin}-${fill.time}-${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(70px,1fr) minmax(80px,1.2fr) minmax(70px,1fr) minmax(70px,1fr)", gap: 6, padding: "8px 0", borderBottom: `1px solid ${C.border}`, fontFamily: MONO, fontSize: 9 }}>
                      <span style={{ color: C.text }}>{fill.coin}</span>
                      <span style={{ color: C.muted2 }}>{fill.side}</span>
                      <span style={{ color: C.text }}>{pnlMoney(fill.closePrice)} · {qty(fill.size)}</span>
                      <span style={{ color: fill.realizedPnl >= 0 ? C.green : C.red }}>{pnlMoney(fill.realizedPnl)}</span>
                    </div>
                  ))}
                  </>}
              </div>
            ) : (
              <div style={{ marginTop: 14 }}>
                <div style={label}>DAILY PNL · TAP A BAR FOR CLOSE FILLS</div>
                {pnlDays.length === 0 ? <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted2, marginTop: 8 }}>No daily data for this period.</div> : (
                  <div style={{ overflowX: "auto", marginTop: 9 }}>
                    <div style={{ width: Math.max(620, pnlDays.length * 13), height: 210 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={pnlDays} margin={{ top: 8, right: 10, left: 4, bottom: 4 }}>
                          <ReferenceLine y={0} stroke={C.border} />
                          <XAxis dataKey="date" tickFormatter={date => date.slice(8)} interval={Math.max(0, Math.floor(pnlDays.length / 12))} tick={{ fill: C.muted2, fontSize: 9 }} />
                          <YAxis width={52} tickFormatter={value => `$${Number(value).toFixed(0)}`} tick={{ fill: C.muted2, fontSize: 9 }} />
                          <Tooltip cursor={{ fill: "#242014" }} content={({ active, payload }) => {
                            const row = payload?.[0]?.payload;
                            return active && row ? <div style={{ background: "#080d18", border: `1px solid ${C.border}`, padding: 8, fontFamily: MONO, fontSize: 9, color: C.text }}>
                              <div>{row.date}</div><div>Realized {pnlMoney(row.realized)}</div><div>Funding {pnlMoney(row.funding)}</div><div>Total {pnlMoney(row.total)}</div>
                            </div> : null;
                          }} />
                          <Bar dataKey="total" isAnimationActive={false} onClick={row => setSelectedPnlDay(row?.payload?.date || row?.date || null)}>
                            {pnlDays.map(day => <Cell key={day.date} cursor="pointer" fill={day.total >= 0 ? "#44986D" : "#D8524F"} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
                {selectedDay && <div style={{ marginTop: 12 }}>
                  <div style={label}>{selectedDay.date} · realized {pnlMoney(selectedDay.realized)} · funding {pnlMoney(selectedDay.funding)}</div>
                  {selectedDay.fills.length === 0 ? <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted2, marginTop: 7 }}>No close fills on this day.</div> :
                    selectedDay.fills.map((fill, index) => <div key={fill.id || `${fill.coin}-${fill.time}-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "7px 0", borderBottom: `1px solid ${C.border}`, fontFamily: MONO, fontSize: 9 }}>
                      <span>{fill.coin} · {fill.side} · {pnlMoney(fill.closePrice)} · {qty(fill.size)}</span>
                      <span style={{ color: fill.realizedPnl >= 0 ? C.green : C.red }}>{pnlMoney(fill.realizedPnl)}</span>
                    </div>)}
                </div>}
              </div>
            )}
            <div style={{ ...label, marginTop: 10 }}>Live API snapshot · {when(currentPnl.fetchedAt, data.timeZone)}{currentPnl.cacheHit ? " · cached" : ""}</div>
          </>
        ) : null}
      </section>
    </>
  );

  if (loading) return <div style={{ padding: 16, fontFamily: MONO, color: C.muted2 }}>Loading Portfolio Advisor…</div>;

  return (
    <div style={{ padding: "4px 0 80px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div style={{ fontFamily: SERIF, fontWeight: 900, fontSize: 26, color: C.gold }}>Portfolio Advisor</div>
          <div style={{ fontFamily: SANS, fontSize: 12, color: C.muted2, marginTop: 4 }}>Read-only Hyperliquid positions · {data?.timeZone || "time zone not selected"}</div>
        </div>
        <button onClick={() => { load(true); if (!data?.requiresSetup) loadPnl(pnlPeriod, true, data?.timeZone); }} disabled={refreshing || pnlRefreshing} style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 4, color: C.gold, padding: "7px 10px", fontFamily: MONO, fontSize: 9 }}>
          {refreshing ? "UPDATING…" : "REFRESH"}
        </button>
      </header>

      {error && <div role="alert" style={{ ...card, borderColor: C.red, color: C.red, fontFamily: MONO, fontSize: 11, marginTop: 14 }}>{error} <button onClick={() => load()} style={{ marginLeft: 8 }}>Retry</button></div>}

      {data?.requiresSetup && (
        <>
        <section style={{ ...card, marginTop: 16 }}>
          <div style={{ fontFamily: SERIF, fontSize: 18, color: C.gold }}>Finish setup in Account settings</div>
          {!data.walletConnected && <p style={{ fontFamily: SANS, fontSize: 12, color: C.text, lineHeight: 1.6 }}>Add one public Hyperliquid wallet address in Account → Emails & preferences → Portfolio Advisor. No wallet login, seed phrase, or private key is needed.</p>}
          {!data.timeZone && <p style={{ fontFamily: SANS, fontSize: 12, color: C.text, lineHeight: 1.6 }}>Select a portfolio time zone in those settings. Scheduling stays disabled until you choose one; device time is never used.</p>}
          <div style={{ fontFamily: MONO, fontSize: 9, color: C.muted2, marginTop: 10 }}>Only read-only public data is queried. CLVRQuant never places, closes, or edits an order.</div>
        </section>
        {pnlSection}
        </>
      )}

      {!data?.requiresSetup && (
        <>
          <div style={{ ...card, marginTop: 14, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div><div style={label}>Connected public wallet</div><div style={{ fontFamily: MONO, fontSize: 10, color: C.text, marginTop: 5, wordBreak: "break-all" }}>{data.walletAddress}</div></div>
            <div style={{ textAlign: "right" }}><div style={label}>Live data as of</div><div style={{ fontFamily: MONO, fontSize: 9, color: C.text, marginTop: 5 }}>{when(data.live?.asOf, data.timeZone)}</div></div>
          </div>

          {section("TODAY'S PLANS")}
          {planCard("MORNING · AFTER 6:30 AM", morning)}
          {planCard("EVENING · 9:00 PM", evening)}

          {pnlSection}

          {section("LIVE POSITIONS")}
          {data.live?.error && <div role="alert" style={{ ...card, borderColor: C.red, fontFamily: MONO, fontSize: 10, color: C.red }}>
            Live Hyperliquid data could not be verified ({data.live.error}). Positions, account value and order states are not substituted with stale values.
          </div>}
          {data.live?.account?.total == null
            ? <div style={{ ...card, fontFamily: MONO, fontSize: 10, color: C.orange }}>Combined account value unavailable. Perps-only totals are not substituted.</div>
            : <div style={{ ...card, fontFamily: MONO, fontSize: 11, color: C.gold }}>Combined account value {money(data.live.account.total)} <span style={{ ...label, display: "block", marginTop: 5 }}>Main perps + xyz perps + free spot USDC only</span></div>}
          {!data.live?.positions?.length ? <div style={{ ...card, fontFamily: MONO, fontSize: 10, color: C.muted2 }}>No open perp positions were returned by the public account endpoint.</div> :
            data.live.positions.map(position => (
              <article key={position.key} style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontFamily: SERIF, fontSize: 17, color: C.text }}>{position.coin} <span style={{ fontFamily: MONO, fontSize: 9, color: position.side === "LONG" ? C.green : C.red }}>{position.side} · {position.dex}</span></div>
                  <div style={{ fontFamily: MONO, fontSize: 9, color: position.instruction === "CLOSE ALL" ? C.red : C.gold }}>{position.instruction}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(132px,1fr))", gap: "3px 10px", marginTop: 10 }}>
                  {valueLine("Size", qty(position.size))}
                  {valueLine("Entry", money(position.entry))}
                  {valueLine("Mark", money(position.mark))}
                  {valueLine("Unrealized PnL", money(position.unrealizedPnl), Number(position.unrealizedPnl) >= 0 ? C.green : C.red)}
                  {valueLine("Margin used", money(position.marginUsed))}
                  {valueLine("Leverage", position.leverage == null ? "Unavailable" : `${position.leverage}x`)}
                  {valueLine("Liquidation", money(position.liquidationPrice))}
                </div>
                <div style={{ marginTop: 10, paddingTop: 9, borderTop: `1px solid ${C.border}` }}>
                  <div style={{ fontFamily: MONO, fontSize: 9, color: position.stopStatus === "LIVE" ? C.green : C.red }}>STOP {position.stopStatus}</div>
                  <div style={{ fontFamily: MONO, fontSize: 9, color: position.riskPctOfAccount != null && position.riskPctOfAccount > 5 ? C.red : C.muted2, marginTop: 4 }}>
                    Stop-at-risk: {money(position.stopRiskUsd)}{position.riskPctOfAccount == null ? " · account risk unavailable" : ` · ${Number(position.riskPctOfAccount).toFixed(2)}% of combined account`}
                  </div>
                  {position.stop?.trigger != null ? <div style={{ fontFamily: MONO, fontSize: 9, color: C.text, marginTop: 4 }}>
                    Trigger {money(position.stop.trigger)} · limit {money(position.stop.limit)} · {position.stop.leverage == null ? "leverage unavailable" : `${position.stop.leverage}x`}
                    {position.stop.correction && <div style={{ color: C.orange, marginTop: 4 }}>Corrected stop order to type: trigger {money(position.stop.correction.trigger)} / limit {money(position.stop.correction.limit)}.</div>}
                    {position.riskPctOfAccount > 5 && !position.stop.correction && <div style={{ color: C.red, marginTop: 4 }}>Risk exceeds the 5% cap; a tighter stop cannot be safely derived from the live mark/liquidation data without moving it farther from entry. Manual review required.</div>}
                  </div> : <div style={{ fontFamily: MONO, fontSize: 9, color: C.orange, marginTop: 4 }}>
                    No verified live stop order found.
                    {position.stop?.correction
                      ? <> Liquidation-based replacement to review: trigger {money(position.stop.correction.trigger)} / limit {money(position.stop.correction.limit)} · current leverage {position.stop.leverage}x.</>
                      : " Required price data was incomplete or a safe stop would move farther from entry; no level was invented."}
                  </div>}
                  {position.target && <div style={{ fontFamily: MONO, fontSize: 9, color: C.text, marginTop: 6 }}>
                    TP {position.target.status}: trigger {money(position.target.trigger)} / limit {money(position.target.limit)} · effective fill {money(position.target.effectiveFill)}
                    {position.target.needsResize && <div style={{ color: C.orange, marginTop: 4 }}>Order size {qty(position.target.size)} exceeds current position size {qty(position.target.correctSize)}; review resize.</div>}
                  </div>}
                  {position.orderStatusUnverified && <div style={{ fontFamily: MONO, fontSize: 9, color: C.orange, marginTop: 5 }}>One or more order statuses could not be confirmed; they are not represented as live.</div>}
                </div>
              </article>
            ))}

          {section("INTRADAY ALERTS")}
          {!data.alerts?.length ? <div style={{ ...card, fontFamily: MONO, fontSize: 10, color: C.muted2 }}>No material change alerts recorded today.</div> :
            data.alerts.map(alert => (
              <div key={alert.id} style={{ ...card, padding: 11 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: C.gold }}>{alert.payload?.symbol || alert.position_key} · {String(alert.alert_type).replaceAll("_", " ").toUpperCase()}</span>
                  <span style={{ ...label, whiteSpace: "nowrap" }}>{when(alert.created_at, data.timeZone)}</span>
                </div>
                <div style={{ fontFamily: SANS, fontSize: 11, color: C.text, marginTop: 5 }}>{alert.payload?.message}</div>
              </div>
            ))}

          {section("PAST PLANS")}
          {!data.plans?.length ? <div style={{ ...card, fontFamily: MONO, fontSize: 10, color: C.muted2 }}>No plan history yet.</div> :
            data.plans.map(plan => (
              <details key={plan.id} style={{ ...card, padding: 11 }}>
                <summary style={{ cursor: "pointer", fontFamily: MONO, fontSize: 10, color: C.text }}>
                  {plan.local_date} · {String(plan.phase).toUpperCase()} · {when(plan.created_at, data.timeZone)}
                </summary>
                <div style={{ fontFamily: SANS, fontSize: 11, color: C.text, marginTop: 10 }}>
                  {plan.content?.positions?.map(position => `${position.coin} ${position.side}: ${position.instruction}`).join(" · ") || "No open positions recorded"}
                  <div style={{ fontFamily: MONO, fontSize: 9, color: C.muted2, marginTop: 8 }}>{plan.content?.disclaimer || DISCLAIMER}</div>
                </div>
              </details>
            ))}
        </>
      )}
      <div style={{ textAlign: "center", fontFamily: MONO, fontSize: 9, color: C.muted, marginTop: 18 }}>{DISCLAIMER}</div>
    </div>
  );
}

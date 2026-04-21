import { useQuery } from "@tanstack/react-query";

export default function QuantStatusCard() {
  const { data: health } = useQuery({
    queryKey: ["/api/quant/health"],
    refetchInterval: 15000,
  });
  const { data: recent = [] } = useQuery({
    queryKey: ["/api/quant/recent"],
    refetchInterval: 30000,
  });
  const { data: stats } = useQuery({
    queryKey: ["/api/quant/stats"],
    refetchInterval: 30000,
  });
  const { data: readiness } = useQuery({
    queryKey: ["/api/quant/readiness"],
    refetchInterval: 60000,
  });

  const ok = health?.ok && health?.ws_alive;
  const coinCount = health?.coins?.length || 0;
  const lastUpd = health?.last_update_ts ? new Date(health.last_update_ts).toLocaleTimeString() : "—";

  // Counters from /api/quant/stats (24h window from ai_signal_log)
  const passed = stats?.passed ?? 0;
  const blocked = (stats?.blocked_scorer ?? 0) + (stats?.blocked_cost ?? 0);
  const vetoed = stats?.vetoed ?? 0;

  const ready = readiness?.recommendation === "READY";
  const readinessLabel = readiness?.recommendation || "—";
  const coverage = readiness?.coverage_pct ?? 0;
  const closed30 = readiness?.closed_signals_30d ?? 0;

  return (
    <div
      data-testid="card-quant-status"
      className="rounded-2xl border border-amber-500/30 bg-slate-900/60 p-4 text-slate-100 shadow-lg"
      style={{ fontFamily: "'IBM Plex Mono', monospace" }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-amber-400 text-sm tracking-wider">QUANT ENGINE</h3>
        <span
          data-testid="status-quant-health"
          className={`px-2 py-0.5 rounded text-xs ${ok ? "bg-emerald-600/30 text-emerald-300" : "bg-rose-600/30 text-rose-300"}`}
        >
          {ok ? "ONLINE" : "OFFLINE"}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <div className="bg-emerald-500/10 rounded px-2 py-1">
          <div className="text-emerald-400 text-lg font-bold" data-testid="text-quant-passed">{passed}</div>
          <div className="text-[9px] text-slate-400 tracking-widest">PASSED</div>
        </div>
        <div className="bg-slate-500/10 rounded px-2 py-1">
          <div className="text-slate-300 text-lg font-bold" data-testid="text-quant-blocked">{blocked}</div>
          <div className="text-[9px] text-slate-400 tracking-widest">BLOCKED</div>
        </div>
        <div className="bg-rose-500/10 rounded px-2 py-1">
          <div className="text-rose-400 text-lg font-bold" data-testid="text-quant-vetoed">{vetoed}</div>
          <div className="text-[9px] text-slate-400 tracking-widest">VETOED</div>
        </div>
      </div>
      <div className="text-xs space-y-1 text-slate-300">
        <div>Streaming: <span data-testid="text-quant-coins" className="text-slate-100">{coinCount} coins</span></div>
        <div>Last tick: <span data-testid="text-quant-lastupd" className="text-slate-100">{lastUpd}</span></div>
        <div className="flex items-center justify-between pt-1">
          <span>Soak readiness:</span>
          <span
            data-testid="badge-quant-readiness"
            className={`px-2 py-0.5 rounded text-[10px] tracking-wider ${ready ? "bg-emerald-600/30 text-emerald-300" : "bg-amber-600/30 text-amber-300"}`}
            title={`Bar coverage ${coverage}% · Closed 30d signals ${closed30}`}
          >
            {readinessLabel}
          </span>
        </div>
        <div className="text-[10px] text-slate-500">
          Bars {coverage}% · Closed-signals(30d) {closed30}
        </div>
      </div>
      {recent.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-700/60 text-xs space-y-1">
          {recent.slice(0, 5).map((r) => (
            <div key={r.id} data-testid={`row-quant-score-${r.id}`} className="flex justify-between">
              <span className="text-slate-400">{r.symbol}</span>
              <span className={r.passes ? "text-emerald-400" : "text-slate-500"}>
                {r.side?.toUpperCase()} z={Number(r.composite_z ?? r.compositeZ ?? 0).toFixed(2)} · {r.regime}
                {r.passes ? " ✓" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

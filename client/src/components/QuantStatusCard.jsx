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

  const ok = health?.ok && health?.ws_alive;
  const coins = health?.coins?.join(", ") || "—";
  const lastUpd = health?.last_update_ts ? new Date(health.last_update_ts).toLocaleTimeString() : "—";

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
      <div className="text-xs space-y-1 text-slate-300">
        <div>Streaming: <span data-testid="text-quant-coins" className="text-slate-100">{coins}</span></div>
        <div>Last tick: <span data-testid="text-quant-lastupd" className="text-slate-100">{lastUpd}</span></div>
        <div>Recent scores: <span data-testid="text-quant-count" className="text-slate-100">{recent.length}</span></div>
      </div>
      {recent.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-700/60 text-xs space-y-1">
          {recent.slice(0, 3).map((r) => (
            <div key={r.id} data-testid={`row-quant-score-${r.id}`} className="flex justify-between">
              <span className="text-slate-400">{r.symbol}</span>
              <span className={r.passes ? "text-emerald-400" : "text-slate-500"}>
                {r.side?.toUpperCase()} z={Number(r.composite_z ?? r.compositeZ ?? 0).toFixed(2)} · {r.regime}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

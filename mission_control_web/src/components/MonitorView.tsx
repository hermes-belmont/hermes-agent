import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Cpu, Database, HardDrive, MemoryStick, Network, RotateCw, Server, Timer, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatBytes, formatNullableMb, formatPercent, progressFillColor, type SystemMetrics } from "@/lib/system-metrics";
import type { AgentRecord, ReactiveSweep, ReactiveSweepStats } from "@/lib/types";

function Skeleton({ className }: { className?: string }) { return <span className={cn("inline-block h-6 animate-pulse rounded-md bg-foreground/10", className)} />; }
function ProgressBar({ percent, color = "var(--warm-glow)" }: { percent: number; color?: string }) {
  const safe = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return <div className="mt-4 h-2 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${safe}%`, background: color }} /></div>;
}
function MetricCard({ title, icon: Icon, children, className }: { title: string; icon: typeof Cpu; children: ReactNode; className?: string }) {
  return <article className={cn("rounded-[28px] border border-foreground/10 bg-background/58 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.18)] backdrop-blur-xl", className)}><div className="mb-4 flex items-center justify-between gap-3"><p className="text-[10px] uppercase tracking-[0.24em] text-foreground/70">{title}</p><span className="flex h-8 w-8 items-center justify-center rounded-full border border-foreground/10 bg-foreground/5 text-[color:var(--warm-glow)]"><Icon className="h-4 w-4" /></span></div>{children}</article>;
}
function Row({ label, value, valueClassName }: { label: string; value: React.ReactNode; valueClassName?: string }) { return <div className="flex items-center justify-between gap-4 border-b border-foreground/8 py-2 last:border-0"><span className="text-[11px] uppercase tracking-[0.18em] text-foreground/70">{label}</span><span className={cn("text-sm text-foreground", valueClassName)}>{value}</span></div>; }
function SummaryCell({ label, value, loading }: { label: string; value: React.ReactNode; loading: boolean }) { return <div className="min-w-0 border-b border-foreground/8 px-4 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"><p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-foreground/70">{label}</p>{loading ? <Skeleton className="h-5 w-24" /> : <p className="truncate text-lg text-foreground">{value}</p>}</div>; }

const emptyStats: ReactiveSweepStats = { total_today: 0, by_agent_today: {}, rate_limited_today: 0, avg_latency_ms: 0, loop_blocked_today: 0, active_in_flight: 0, queue_size: 0 };

type Props = { agents?: AgentRecord[]; initialReactiveStats?: ReactiveSweepStats; initialReactiveSweeps?: ReactiveSweep[]; initialExpandedReactiveId?: string | null };

function statusClass(status: string) {
  if (status === "completed") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300";
  if (status === "failed") return "border-red-400/30 bg-red-400/10 text-red-300";
  if (status === "rate_limited") return "border-[color-mix(in_srgb,var(--warm-glow)_30%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_10%,transparent)] text-[color:var(--warm-glow)]";
  if (status === "running") return "border-sky-400/30 bg-sky-400/10 text-sky-300";
  return "border-foreground/10 bg-foreground/5 text-foreground/70";
}
function truncate(value?: string, max = 60) { return !value ? "No trigger subject" : value.length > max ? `${value.slice(0, max - 1)}…` : value; }
function latency(value: number | null | undefined) { return typeof value === "number" ? `${value}ms` : "—"; }
function agentLabel(agents: AgentRecord[], id: string) { return agents.find((a) => a.id === id)?.name ?? id; }

function ReactiveActivity({ stats, sweeps, expandedId, setExpandedId }: { stats: ReactiveSweepStats; sweeps: ReactiveSweep[]; expandedId: string | null; setExpandedId: (id: string | null) => void }) {
  const cells = [
    ["Today total", stats.total_today], ["Rate-limited", stats.rate_limited_today], ["Loop-blocked", stats.loop_blocked_today],
    ["Avg latency", `${stats.avg_latency_ms}ms`], ["In flight", stats.active_in_flight], ["Queue size", stats.queue_size],
  ];
  return <section className="mb-5 rounded-[28px] border border-[color-mix(in_srgb,var(--warm-glow)_24%,transparent)] bg-background/58 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.18)] backdrop-blur-xl" data-testid="reactive-activity">
    <div className="mb-4 flex items-end justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.28em] text-[color:var(--warm-glow)]">REACTIVE ACTIVITY</p><h2 className="mt-1 text-xl font-light tracking-[-0.03em] text-foreground">Agent-to-agent reactive sweeps today.</h2></div></div>
    <div className="mb-4 grid overflow-hidden rounded-2xl border border-foreground/10 sm:grid-cols-3 lg:grid-cols-6">{cells.map(([label, value]) => <div key={label} className="border-b border-r border-foreground/8 px-3 py-3 last:border-r-0"><p className="text-[9px] uppercase tracking-[0.2em] text-foreground/60">{label}</p><p className="mt-1 text-xl text-foreground">{value}</p></div>)}</div>
    <div className="space-y-2"><p className="text-[10px] uppercase tracking-[0.22em] text-foreground/70">Recent sweeps</p>{sweeps.length === 0 ? <div className="rounded-2xl border border-foreground/8 p-4 text-sm text-foreground/60">No reactive sweeps yet today.</div> : sweeps.slice(0, 10).map((sweep) => {
      const expanded = expandedId === sweep.id;
      return <article key={sweep.id} id={`reactive-${sweep.id}`} className="overflow-hidden rounded-2xl border border-foreground/10 bg-foreground/[0.025]">
        <button type="button" onClick={() => setExpandedId(expanded ? null : sweep.id)} className="grid w-full gap-2 px-4 py-3 text-left md:grid-cols-[1.1fr_2fr_auto_auto_auto] md:items-center">
          <div className="min-w-0"><p className="truncate text-sm text-foreground">{sweep.agent_label ?? sweep.agent_id}</p>{sweep.jumped_from_link ? <p className="mt-1 text-[9px] uppercase tracking-[0.18em] text-[color:var(--warm-glow)]">JUMPED FROM LINK</p> : null}</div>
          <p className="truncate text-sm text-foreground/75">{truncate(sweep.trigger_subject)}</p>
          <span className={cn("w-fit rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]", statusClass(sweep.status))}>{sweep.status}</span>
          <span className="text-xs text-foreground/70">{latency(sweep.latency_ms)}</span>
          <span className="text-xs text-foreground/70">{sweep.outgoing_messages_sent?.length ?? 0} outgoing</span>
        </button>
        <div className={cn("grid transition-[grid-template-rows] duration-300", expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}><div className="min-h-0 overflow-hidden"><div className="border-t border-foreground/8 p-4">
          {sweep.notes_for_david ? <p className="mb-3 rounded-xl border border-[color-mix(in_srgb,var(--warm-glow)_25%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_8%,transparent)] px-3 py-2 text-sm text-[color:var(--warm-glow)]">{sweep.notes_for_david}</p> : null}
          {sweep.outgoing_messages_sent?.length ? <div className="mb-3 space-y-1 text-xs text-foreground/75">{sweep.outgoing_messages_sent.map((m, idx) => <div key={`${m.msg_id ?? idx}`}>→ {m.to_agent_label ?? m.to_agent_id}: {m.subject ?? "(No subject)"}</div>)}</div> : null}
          <pre className="max-h-96 overflow-auto rounded-xl border border-foreground/10 bg-black/30 p-3 text-[11px] text-foreground/80">{JSON.stringify(sweep, null, 2)}</pre>
        </div></div></div>
      </article>;
    })}</div>
  </section>;
}

export function MonitorView({ agents = [], initialReactiveStats, initialReactiveSweeps, initialExpandedReactiveId = null }: Props) {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reactiveStats, setReactiveStats] = useState<ReactiveSweepStats>(initialReactiveStats ?? emptyStats);
  const [reactiveSweeps, setReactiveSweeps] = useState<ReactiveSweep[]>(initialReactiveSweeps ?? []);
  const [expandedReactiveId, setExpandedReactiveId] = useState<string | null>(() => initialExpandedReactiveId ?? new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("reactive"));
  const inFlightRef = useRef(false);
  const reactiveInFlightRef = useRef(false);
  const mountedRef = useRef(false);

  const agentMap = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);

  const enrichSweep = useCallback(async (sweep: ReactiveSweep): Promise<ReactiveSweep> => {
    const label = agentLabel(agents, sweep.agent_id);
    if (sweep.trigger_subject || !sweep.trigger_message_ids?.[0]) return { ...sweep, agent_label: sweep.agent_label ?? label };
    try {
      const msg = await api.getMessage(sweep.trigger_message_ids[0], sweep.agent_id);
      return { ...sweep, agent_label: label, trigger_subject: msg.subject };
    } catch { return { ...sweep, agent_label: label }; }
  }, [agents]);

  const fetchReactive = useCallback(async () => {
    if (reactiveInFlightRef.current) return;
    reactiveInFlightRef.current = true;
    try {
      const [statsPayload, sweepGroups] = await Promise.all([api.getReactiveSweepStats(), Promise.all(agents.filter((a) => !a.deleted_at).map((a) => api.listReactiveSweeps(a.id, 10).catch(() => [])))]);
      const merged = (await Promise.all(sweepGroups.flat().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10).map(enrichSweep)));
      const deepLinkId = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("reactive");
      let finalRows = merged;
      if (deepLinkId && !merged.some((row) => row.id === deepLinkId)) {
        for (const agent of agents) {
          const found = (await api.listReactiveSweeps(agent.id, 200).catch(() => [])).find((row) => row.id === deepLinkId);
          if (found) { finalRows = [{ ...(await enrichSweep(found)), jumped_from_link: true }, ...merged].slice(0, 11); break; }
        }
      }
      if (mountedRef.current) { setReactiveStats(statsPayload); setReactiveSweeps(finalRows); if (deepLinkId) setExpandedReactiveId(deepLinkId); }
    } finally { reactiveInFlightRef.current = false; }
  }, [agents, enrichSweep]);

  const fetchMetrics = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true; setRefreshing(true);
    try { const payload = await api.getSystemMetrics(); if (mountedRef.current) { setMetrics(payload); setError(false); } }
    catch { if (mountedRef.current) setError(true); }
    finally { inFlightRef.current = false; if (mountedRef.current) setRefreshing(false); }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchMetrics(); void fetchReactive();
    const metricsInterval = window.setInterval(() => { if (document.visibilityState === "visible") void fetchMetrics(); }, 5000);
    const reactiveInterval = window.setInterval(() => { if (document.visibilityState === "visible") void fetchReactive(); }, 30000);
    const onVisible = () => { if (document.visibilityState === "visible") { void fetchMetrics(); void fetchReactive(); } };
    window.addEventListener("focus", onVisible); document.addEventListener("visibilitychange", onVisible);
    return () => { mountedRef.current = false; window.clearInterval(metricsInterval); window.clearInterval(reactiveInterval); window.removeEventListener("focus", onVisible); document.removeEventListener("visibilitychange", onVisible); };
  }, [fetchMetrics, fetchReactive]);

  useEffect(() => {
    if (!expandedReactiveId) return;
    window.setTimeout(() => document.getElementById(`reactive-${expandedReactiveId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
  }, [expandedReactiveId, reactiveSweeps]);

  const loading = !metrics;
  const memoryColor = metrics ? progressFillColor(metrics.memory.percent) : "var(--warm-glow)";
  const diskColor = metrics ? progressFillColor(metrics.disk.percent) : "var(--warm-glow)";

  return <section className="flex flex-1 flex-col overflow-y-auto px-4 py-5 sm:px-8 lg:px-12">
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[10px] uppercase tracking-[0.28em] text-foreground/70">Monitor</p><h1 className="mt-2 text-3xl font-light tracking-[-0.04em] text-foreground sm:text-4xl">System Monitor</h1><p className="mt-2 text-sm text-foreground/70">Real-time system resource metrics</p></div><button type="button" onClick={() => { void fetchMetrics(); void fetchReactive(); }} disabled={refreshing} className="inline-flex items-center justify-center gap-2 rounded-full border border-foreground/15 bg-background/60 px-4 py-2 text-xs uppercase tracking-[0.18em] text-foreground/85 transition hover:border-[color:var(--warm-glow)] hover:text-[color:var(--warm-glow)] disabled:cursor-not-allowed disabled:opacity-60"><RotateCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />Refresh</button></div>
    <ReactiveActivity stats={reactiveStats} sweeps={reactiveSweeps.map((row) => ({ ...row, agent_label: row.agent_label ?? agentMap.get(row.agent_id)?.name }))} expandedId={expandedReactiveId} setExpandedId={setExpandedReactiveId} />
    {error ? <div className="mb-4 flex items-center gap-2 rounded-2xl border border-[#ffbd38]/30 bg-[#ffbd38]/10 px-4 py-3 text-sm text-[#ffbd38]"><AlertTriangle className="h-4 w-4" />Could not fetch metrics. Retrying in 5s.</div> : null}
    <div className="mb-5 grid overflow-hidden rounded-[28px] border border-foreground/10 bg-background/58 backdrop-blur-xl sm:grid-cols-5"><SummaryCell label="CPU" loading={loading} value={`${formatPercent(metrics?.cpu.percent ?? 0)}`} /><SummaryCell label="Memory" loading={loading} value={`${metrics?.memory.used_mb}/${metrics?.memory.total_mb}MB (${formatPercent(metrics?.memory.percent ?? 0)})`} /><SummaryCell label="Disk" loading={loading} value={`${metrics?.disk.used_gb}/${metrics?.disk.total_gb}Gi (${formatPercent(metrics?.disk.percent ?? 0)})`} /><SummaryCell label="Processes" loading={loading} value={metrics?.processes.running ?? "—"} /><SummaryCell label="Load" loading={loading} value={`${metrics?.load_average.one_min}, ${metrics?.load_average.five_min}, ${metrics?.load_average.fifteen_min}`} /></div>
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard title="CPU Usage" icon={Cpu}>{loading ? <Skeleton className="h-10 w-28" /> : <p className="text-4xl font-light tracking-[-0.04em] text-foreground">{formatPercent(metrics.cpu.percent)}</p>}<p className="mt-1 text-xs text-foreground/70">{loading ? "Detecting cores" : `${metrics.cpu.cores} logical cores`}</p><ProgressBar percent={metrics?.cpu.percent ?? 0} /></MetricCard>
      <MetricCard title="Memory" icon={MemoryStick}>{loading ? <Skeleton className="h-10 w-36" /> : <p className="text-3xl font-light tracking-[-0.04em] text-foreground">{metrics.memory.used_mb}<span className="text-base text-foreground/70">/{metrics.memory.total_mb} MB</span></p>}<p className="mt-1 text-xs text-foreground/70">{formatPercent(metrics?.memory.percent ?? 0)} allocated</p><ProgressBar percent={metrics?.memory.percent ?? 0} color={memoryColor} /></MetricCard>
      <MetricCard title="Disk" icon={HardDrive}>{loading ? <Skeleton className="h-10 w-36" /> : <p className="text-3xl font-light tracking-[-0.04em] text-foreground">{metrics.disk.used_gb}<span className="text-base text-foreground/70">/{metrics.disk.total_gb} Gi</span></p>}<p className="mt-1 text-xs text-foreground/70">{metrics?.disk.mount ?? "/"} · {formatPercent(metrics?.disk.percent ?? 0)} used</p><ProgressBar percent={metrics?.disk.percent ?? 0} color={diskColor} /></MetricCard>
      <MetricCard title="Processes" icon={Zap}>{loading ? <Skeleton className="h-10 w-24" /> : <p className="text-4xl font-light tracking-[-0.04em] text-foreground">{metrics.processes.running}</p>}<p className="mt-1 text-xs text-foreground/70">running</p><p className="mt-4 text-sm text-foreground/85">{loading ? "—" : `${metrics.processes.total} total processes`}</p></MetricCard>
      <MetricCard title="Load Average" icon={Database}>{loading ? <Skeleton className="h-28 w-full" /> : <div className="space-y-2"><Row label="1m" value={metrics.load_average.one_min.toFixed(2)} valueClassName="text-xl" /><Row label="5m" value={metrics.load_average.five_min.toFixed(2)} valueClassName="text-xl" /><Row label="15m" value={metrics.load_average.fifteen_min.toFixed(2)} valueClassName="text-xl" /></div>}</MetricCard>
      <MetricCard title="Network I/O" icon={Network}>{loading ? <Skeleton className="h-32 w-full" /> : <div><Row label="Interface" value={metrics.network.interface} /><Row label="Bytes" value={`${formatBytes(metrics.network.bytes_recv)} ↓ / ${formatBytes(metrics.network.bytes_sent)} ↑`} /><Row label="Packets" value={`${metrics.network.packets_recv.toLocaleString()} ↓ / ${metrics.network.packets_sent.toLocaleString()} ↑`} /><Row label="Errors" value={(metrics.network.errors ?? 0).toLocaleString()} /></div>}</MetricCard>
      <MetricCard title="Node.js Memory" icon={Server}>{loading ? <Skeleton className="h-28 w-full" /> : <div><Row label="RSS" value={formatNullableMb(metrics.node_memory.rss_mb)} /><Row label="Heap Used" value={formatNullableMb(metrics.node_memory.heap_used_mb)} /><Row label="Heap Total" value={formatNullableMb(metrics.node_memory.heap_total_mb)} /></div>}</MetricCard>
    </div>
    <div className="mt-5 rounded-[28px] border border-foreground/10 bg-background/58 p-5 backdrop-blur-xl"><div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-start"><div><div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-foreground/70"><Timer className="h-3.5 w-3.5 text-[color:var(--warm-glow)]" />Uptime</div>{loading ? <Skeleton className="h-9 w-64" /> : <p className="text-3xl font-light tracking-[-0.04em] text-foreground">{metrics.uptime.formatted}</p>}</div><div className="min-w-[260px] text-left lg:text-right"><p className="mb-3 text-[10px] uppercase tracking-[0.24em] text-foreground/70">Versions</p>{loading ? <Skeleton className="h-28 w-full" /> : <div className="space-y-1 text-sm text-foreground/85"><div className="flex justify-between gap-8 lg:justify-end"><span className="text-foreground/70">HCI</span><span>{metrics.versions.mission_control}</span></div><div className="flex justify-between gap-8 lg:justify-end"><span className="text-foreground/70">Hermes Agent</span><span>{metrics.versions.hermes_agent}</span></div><div className="flex justify-between gap-8 lg:justify-end"><span className="text-foreground/70">Python</span><span>{metrics.versions.python}</span></div><div className="flex justify-between gap-8 lg:justify-end"><span className="text-foreground/70">Node.js</span><span>{metrics.versions.node}</span></div></div>}</div></div><p className="mt-5 border-t border-foreground/8 pt-4 text-xs text-foreground/70">{loading ? "Collecting system profile…" : `${metrics.system.model} · ${metrics.system.os_name} ${metrics.system.os_version} · ${metrics.system.hostname}`}</p></div>
  </section>;
}

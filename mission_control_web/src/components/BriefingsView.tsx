import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, CheckCircle2, Clock, Loader2, Settings2, XCircle } from "lucide-react";
import { CronJobsPanel } from "@/components/briefings/CronJobsPanel";
import { api } from "@/lib/api";
import type { Briefing, BriefingConfig, BriefingListItem, BriefingRunStatus } from "@/lib/types";
import { briefingDateLabel, briefingPriorityTone, formatBriefingTime, summarizeRunProgress } from "@/lib/briefings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const days = [
  ["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"],
] as const;

type BriefingsTab = "daily" | "schedule" | "cron";

function StatusPill({ status }: { status: string }) {
  const tone = status === "ok" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : status === "timeout" ? "border-amber-400/30 bg-amber-400/10 text-amber-200" : "border-red-400/30 bg-red-400/10 text-red-200";
  return <span className={cn("rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]", tone)}>{status}</span>;
}

function ErrorClassPill({ label }: { label: string }) {
  const lower = label.toLowerCase();
  const tone = lower.includes("rate") || lower.includes("timeout")
    ? "border-amber-400/35 bg-amber-400/12 text-amber-200"
    : lower.includes("auth") || lower.includes("invalid") || lower.includes("exited") || lower.includes("unknown")
      ? "border-red-400/35 bg-red-400/12 text-red-200"
      : "border-foreground/15 bg-foreground/8 text-foreground/70";
  return <span className={cn("rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.10em]", tone)}>{label}</span>;
}

function PriorityPill({ priority }: { priority: string }) {
  const tone = briefingPriorityTone(priority);
  const cls = tone === "high" ? "bg-red-400/12 text-red-200 border-red-400/30" : tone === "medium" ? "bg-amber-400/12 text-amber-200 border-amber-400/30" : "bg-foreground/8 text-foreground/70 border-foreground/15";
  return <span className={cn("inline-flex h-6 w-20 shrink-0 items-center justify-center self-center rounded-full border px-3 text-[10px] uppercase tracking-[0.12em]", cls)}>{tone}</span>;
}

function BriefingsTabs({ activeTab, onChange }: { activeTab: BriefingsTab; onChange: (tab: BriefingsTab) => void }) {
  const tabs: Array<{ id: BriefingsTab; label: string }> = [
    { id: "daily", label: "Daily Briefing" },
    { id: "schedule", label: "Schedule" },
    { id: "cron", label: "CRON Jobs" },
  ];
  return (
    <div className="flex flex-wrap gap-2 rounded-2xl border border-foreground/10 bg-foreground/[0.025] p-1" role="tablist" aria-label="Briefings sections">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "rounded-xl px-4 py-2 text-xs uppercase tracking-[0.14em] transition",
            activeTab === tab.id
              ? "bg-[color-mix(in_srgb,var(--warm-glow)_18%,transparent)] text-[var(--warm-glow)] shadow-sm"
              : "text-muted-foreground hover:bg-foreground/8 hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function SchedulePanel({ config, setConfig, saveConfig }: { config: BriefingConfig | null; setConfig: (config: BriefingConfig) => void; saveConfig: () => Promise<void> }) {
  if (!config) {
    return <Card><CardContent className="py-12 text-sm text-muted-foreground">Loading schedule configuration...</CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-expanded uppercase tracking-[0.08em]">Schedule</CardTitle>
        <CardDescription>Configure the recurring Daily Briefing sweep. Schedule mode: {config.schedule_mode}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <label className="flex items-center justify-between rounded-xl border border-foreground/10 p-3">
          <span>Enable scheduled sweeps</span>
          <input type="checkbox" checked={config.enabled} onChange={(event) => setConfig({ ...config, enabled: event.target.checked })} />
        </label>
        <label className="block space-y-2">
          <span className="text-sm text-muted-foreground">Time of day</span>
          <Input type="time" value={config.time_local} onChange={(event) => setConfig({ ...config, time_local: event.target.value })} />
        </label>
        <div>
          <div className="mb-2 text-sm text-muted-foreground">Days of week</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {days.map(([id, label]) => (
              <label key={id} className="flex items-center gap-2 rounded-lg border border-foreground/10 p-2 text-sm">
                <input type="checkbox" checked={config.days_of_week.includes(id)} onChange={(event) => setConfig({ ...config, days_of_week: event.target.checked ? [...config.days_of_week, id] : config.days_of_week.filter((day) => day !== id) })} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm text-muted-foreground">Agents to include</div>
          <div className="space-y-2">
            {config.agent_status.map((agent) => {
              const agentKey = agent.configured_agent_id ?? agent.agent_id;
              return (
                <label key={agentKey} className="flex items-center justify-between gap-3 rounded-xl border border-foreground/10 p-3">
                  <span>
                    <span className="block text-sm">{agent.label}</span>
                    <span className="text-[11px] uppercase tracking-[0.10em] text-muted-foreground">{agent.status}</span>
                  </span>
                  <input type="checkbox" checked={config.agents.includes(agentKey)} onChange={(event) => setConfig({ ...config, agents: event.target.checked ? [...config.agents, agentKey] : config.agents.filter((id) => id !== agentKey) })} />
                </label>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => void saveConfig()}>Save Schedule</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function BriefingsView() {
  const [briefings, setBriefings] = useState<BriefingListItem[]>([]);
  const [active, setActive] = useState<Briefing | null>(null);
  const [config, setConfig] = useState<BriefingConfig | null>(null);
  const [activeTab, setActiveTab] = useState<BriefingsTab>("daily");
  const [running, setRunning] = useState(false);
  const [runStatus, setRunStatus] = useState<BriefingRunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [list, cfg] = await Promise.all([api.listBriefings(), api.getBriefingsConfig()]);
    setBriefings(list);
    setConfig(cfg);
    if (list.length) {
      setActive(await api.getBriefing(list[0].id));
    } else {
      setActive(null);
    }
  }, []);

  useEffect(() => { void load().catch((err) => setError(String(err))); }, [load]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      void api.getBriefingRunStatus().then(setRunStatus).catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const agentLabels = useMemo(() => config?.agent_status?.map((agent) => agent.label) ?? ["Customs Director", "Media Director", "Properties Director", "Financial Analyst", "Holdings Operator"], [config]);
  const progress = summarizeRunProgress(agentLabels, runStatus);

  async function runNow() {
    setError(null);
    setRunning(true);
    setRunStatus({ running: true, agents: agentLabels.map((label) => ({ label, status: "pending" })) });
    try {
      const result = await api.runBriefingSweep();
      setActive(result);
      await load();
      setActiveTab("daily");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function saveConfig() {
    if (!config) return;
    try {
      const saved = await api.updateBriefingsConfig(config);
      setConfig(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="relative min-h-[calc(100vh-120px)] space-y-5" data-testid="briefings-view">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--warm-glow)]"><BellRing className="h-4 w-4" /> Briefings (CRON)</div>
          <h1 className="mt-2 font-expanded text-3xl uppercase tracking-[0.08em] text-foreground">Briefings (CRON)</h1>
          <p className="mt-1 text-sm text-muted-foreground">What your agents want you to know</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void runNow()} disabled={running}>{running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Run Now</Button>
          <Button variant="outline" onClick={() => setActiveTab("schedule")}><Settings2 className="mr-2 h-4 w-4" />Configure</Button>
        </div>
      </div>

      <BriefingsTabs activeTab={activeTab} onChange={setActiveTab} />

      {error && <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">{error}</div>}

      {activeTab === "daily" && (
        !briefings.length ? (
          <Card className="flex min-h-[480px] items-center justify-center text-center">
            <CardContent className="max-w-md space-y-4 pt-6">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--warm-glow)_18%,transparent)] text-[var(--warm-glow)]"><BellRing className="h-8 w-8" /></div>
              <div>
                <h2 className="font-expanded text-xl uppercase tracking-[0.08em]">No briefings yet</h2>
                <p className="mt-2 text-sm text-muted-foreground">Run a sweep now to ask your agents what is coming up</p>
              </div>
              <Button onClick={() => void runNow()} disabled={running}>Run Now</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="space-y-2 lg:sticky lg:top-4 lg:self-start">
              {briefings.map((item) => {
                const selected = active?.id === item.id;
                return (
                  <button key={item.id} onClick={() => void api.getBriefing(item.id).then(setActive)} className={cn("w-full rounded-xl border p-3 text-left transition", selected ? "border-[color-mix(in_srgb,var(--warm-glow)_38%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_12%,transparent)]" : "border-foreground/10 bg-foreground/[0.03] hover:bg-foreground/[0.06]") }>
                    <div className="font-expanded text-sm uppercase tracking-[0.08em]">{briefingDateLabel(item.id)}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground"><span>{Object.keys(item.summary.by_agent ?? {}).length} agents</span><span>{item.summary.total_items} items</span>{item.summary.high_priority_count > 0 && <span className="text-red-200">{item.summary.high_priority_count} high</span>}</div>
                  </button>
                );
              })}
            </aside>
            <Card>
              {active && (
                <>
                  <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div><CardTitle className="font-expanded uppercase tracking-[0.08em]">{briefingDateLabel(active.id)} Briefing</CardTitle><CardDescription>{formatBriefingTime(active.generated_at)} · {active.triggered_by} · {active.duration_ms} ms</CardDescription></div>
                    <Button variant="outline" onClick={() => void runNow()} disabled={running}>Run Now</Button>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {active.agents.map((agent) => (
                      <section key={agent.label} className="rounded-2xl border border-foreground/10 bg-background/35 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-expanded text-sm uppercase tracking-[0.10em]">{agent.label}</h3><div className="flex items-center gap-2"><a href={`#/kanban?agent_id=${encodeURIComponent(agent.agent_id)}`} className="rounded-full border border-foreground/10 px-2 py-1 text-[11px] uppercase tracking-[0.10em] text-muted-foreground hover:text-[var(--warm-glow)]">Kanban {agent.tracked_items_count ?? 0} items</a><StatusPill status={agent.status} /><span className="text-[11px] text-muted-foreground">{agent.latency_ms} ms</span></div></div>
                        {agent.error_class && <div className="mt-3 flex flex-wrap items-center gap-2"><ErrorClassPill label={agent.error_class} /></div>}
                        {agent.error_detail && <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border border-red-400/20 bg-red-400/[0.06] p-3 text-xs leading-relaxed text-red-100/90">{agent.error_detail}</pre>}
                        {!agent.error_detail && agent.error && <p className="mt-3 text-sm text-red-200">{agent.error}</p>}
                        {agent.parsed_items.length ? <div className="mt-3 space-y-2">{agent.parsed_items.map((item, index) => <div key={`${item.title}-${index}`} className="grid gap-2 rounded-xl border border-foreground/8 bg-foreground/[0.025] p-3 md:grid-cols-[1.2fr_0.7fr_0.45fr_1.7fr]"><div><div className="font-medium">{item.title}</div>{item.source && item.source !== "agent_inference" && <a href={`#/kanban?agent_id=${encodeURIComponent(agent.agent_id)}&item_id=${encodeURIComponent(item.source)}`} className="mt-1 inline-flex text-[11px] uppercase tracking-[0.10em] text-[var(--warm-glow)]">Tracked source</a>}</div><div className="text-sm text-muted-foreground">{item.due || "No date"}</div><PriorityPill priority={item.priority} /><div className="text-sm text-muted-foreground">{item.reason}</div></div>)}</div> : <div className="mt-3 rounded-xl border border-foreground/8 bg-foreground/[0.025] p-3 text-sm text-muted-foreground">No items reported.</div>}
                        {agent.notes_for_david && <p className="mt-3 text-sm text-[var(--warm-glow)]">Notes for David: {agent.notes_for_david}</p>}
                      </section>
                    ))}
                  </CardContent>
                </>
              )}
            </Card>
          </div>
        )
      )}

      {activeTab === "schedule" && <SchedulePanel config={config} setConfig={setConfig} saveConfig={saveConfig} />}
      {activeTab === "cron" && <CronJobsPanel />}

      {running && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"><Card className="w-full max-w-lg"><CardHeader><CardTitle className="flex items-center gap-2 font-expanded uppercase tracking-[0.08em]"><Loader2 className="h-5 w-5 animate-spin text-[var(--warm-glow)]" /> Running briefing sweep</CardTitle><CardDescription>Querying each director and operator. This can take up to 8 minutes in the worst case.</CardDescription></CardHeader><CardContent className="space-y-2">{progress.map((item) => <div key={item.label} className="flex items-center justify-between rounded-xl border border-foreground/10 bg-foreground/[0.03] px-3 py-2"><span>{item.label}</span><span className="flex items-center gap-2 text-sm text-muted-foreground">{item.status === "pending" ? <Clock className="h-4 w-4" /> : item.status === "ok" ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <XCircle className="h-4 w-4 text-red-300" />}{item.status}</span></div>)}</CardContent></Card></div>}
    </section>
  );
}

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Archive, CheckCircle2, Download, ExternalLink, FileDown, GitBranch, HeartPulse, Loader2, RefreshCw, ShieldAlert, Stethoscope, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ConfirmActionModal } from "./ConfirmActionModal";
import type { RiskLevel } from "@/lib/confirm-action";
import { formatFileSize, type BackupResult, type DestructiveMaintenanceResult, type DoctorResult, type DumpResult, type GitCommitOption, type HealthCheckResult, type HciStatus, type HermesStatus, type MaintenanceVersion, type UpdateAllJobStatus, type UpdateCheckResult } from "@/lib/maintenance";

type ActionKey = "health" | "updates" | "doctor" | "dump" | "backup";
type DestructiveKey = "restart" | "updateAll" | "rollback" | "autoFix" | "updateHermes" | "restartGateway" | "import";
type ResultState = { health?: HealthCheckResult; updates?: UpdateCheckResult; doctor?: DoctorResult; dump?: DumpResult; backup?: BackupResult };
type ErrorState = Partial<Record<ActionKey | "version", string>>;
type GatewayRestartState = "idle" | "restarting" | "success" | "timeout" | "error";

type ModalState = { key: DestructiveKey; title: string; body: ReactNode; confirmLabel: string; riskLevel: RiskLevel; requirePhrase?: string } | null;

function Card({ title, icon: Icon, body, children, result }: { title: string; icon: typeof HeartPulse; body: ReactNode; children: ReactNode; result?: ReactNode }) {
  return <article className="rounded-[28px] border border-foreground/10 bg-background/58 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.18)] backdrop-blur-xl"><div className="mb-4 flex items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.24em] text-foreground/70">{title}</p><div className="mt-3 text-sm text-foreground/75">{body}</div></div><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-foreground/10 bg-foreground/5 text-[color:var(--warm-glow)]"><Icon className="h-4 w-4" /></span></div><div className="flex flex-wrap gap-2">{children}</div>{result ? <div className="mt-4">{result}</div> : null}</article>;
}

function ActionButton({ children, onClick, loading = false, disabled = false, title, variant = "default" }: { children: ReactNode; onClick?: () => void; loading?: boolean; disabled?: boolean; title?: string; variant?: "default" | "warning" }) {
  const classes = variant === "warning"
    ? "border-[#ffbd38]/45 bg-[#ffbd38]/8 text-[#ffbd38] hover:border-[#ffbd38]/70 hover:bg-[#ffbd38]/14 hover:text-[#ffbd38] disabled:hover:border-[#ffbd38]/45 disabled:hover:text-[#ffbd38]"
    : "border-foreground/15 bg-background/60 text-foreground/85 hover:border-[color:var(--warm-glow)] hover:text-[color:var(--warm-glow)] disabled:hover:border-foreground/15 disabled:hover:text-foreground/85";
  return <button type="button" onClick={onClick} disabled={disabled || loading} title={title} className={cn("inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[11px] uppercase tracking-[0.16em] transition disabled:cursor-not-allowed disabled:opacity-45", classes)}>{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{children}</button>;
}

function ErrorPanel({ message }: { message?: string }) {
  if (!message) return null;
  return <div className="rounded-2xl border border-[#ffbd38]/30 bg-[#ffbd38]/10 px-3 py-2 text-xs text-[#ffbd38]">{message}</div>;
}
function StatusDot({ ok }: { ok: boolean }) { return <span className={cn("h-2 w-2 rounded-full", ok ? "bg-emerald-400" : "bg-red-500")} />; }

function formatClock(value: Date = new Date()): string {
  return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function StatusLine({ status }: { status: HermesStatus | null }) {
  if (!status || status.status === "unknown") return <div className="text-xs text-foreground/55">Status unavailable</div>;
  if (status.status === "up_to_date") return <div><span className="inline-flex rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-emerald-400">Up to date</span></div>;
  if (status.status === "behind") return <div className="text-xs text-[#ffbd38]">{status.commits_behind ?? 0} commits behind upstream</div>;
  if (status.status === "ahead") return <div className="text-xs text-foreground/55">+{status.carried_commits_ahead ?? 0} local commits ahead</div>;
  return <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#ffbd38]"><span>{status.commits_behind ?? 0} behind upstream</span><span>+{status.carried_commits_ahead ?? 0} local commits ahead</span></div>;
}

function HermesStatusBlock({ status }: { status: HermesStatus | null }) {
  return <div className="mt-2 space-y-1"><StatusLine status={status} /><div className="text-[11px] text-foreground/45">upstream {status?.upstream_sha ?? "unknown"} / local {status?.local_sha ?? "unknown"}</div></div>;
}

function HealthResult({ result }: { result: HealthCheckResult }) {
  return <details open className="rounded-2xl border border-foreground/10 bg-background/50 p-3"><summary className="cursor-pointer text-xs uppercase tracking-[0.18em] text-foreground/70">{result.ok ? "All checks passing" : "Checks need attention"}</summary><div className="mt-3 space-y-2">{result.checks.map((check) => <div key={check.endpoint} className="flex items-start justify-between gap-3 rounded-xl bg-foreground/5 px-3 py-2 text-xs text-foreground/80"><span className="flex min-w-0 items-center gap-2"><StatusDot ok={check.status >= 200 && check.status < 300} /><span className="truncate">{check.endpoint}</span></span><span className="shrink-0 text-foreground/70">{check.status || "ERR"} · {check.latency_ms}ms</span>{check.error ? <span className="basis-full text-[#ffbd38]">{check.error}</span> : null}</div>)}</div></details>;
}
function relativeTime(value?: string | null): string {
  if (!value) return "Build time unknown";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Build time unknown";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function HciStatusPill({ status, kind }: { status: "in_sync" | "rebuild_required" | "reinstall_required" | "unknown"; kind: "mission_control" | "hermes_agent" }) {
  if (status === "in_sync") return <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-emerald-400">Up to date</span>;
  if (status === "unknown") return <span className="rounded-full border border-foreground/15 bg-foreground/5 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-foreground/55">Unknown</span>;
  return <span className="rounded-full border border-[#ffbd38]/30 bg-[#ffbd38]/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-[#ffbd38]">{kind === "mission_control" ? "Rebuild required" : "Reinstall required"}</span>;
}

function HciStatusRows({ status }: { status: HciStatus | null }) {
  if (!status) return <div className="rounded-2xl border border-foreground/10 bg-background/50 p-3 text-xs text-foreground/55">Loading update status...</div>;
  const mission = status.mission_control;
  const hermes = status.hermes_agent;
  return <div className="rounded-2xl border border-foreground/10 bg-background/50 p-3 text-xs text-foreground/80">
    <div className="border-b border-foreground/8 py-2">
      <div className="flex items-center justify-between gap-3"><span>Mission Control</span><HciStatusPill status={mission.status} kind="mission_control" /></div>
      <div className="mt-1 font-mono text-foreground/85">{mission.running_sha_short ?? "unknown"}</div>
      <div className="mt-1 text-foreground/55">Built {relativeTime(mission.running_built_at)}</div>
    </div>
    <div className="py-2">
      <div className="flex items-center justify-between gap-3"><span>Hermes Agent</span><HciStatusPill status={hermes.status} kind="hermes_agent" /></div>
      <div className="mt-1 font-mono text-foreground/85">{hermes.installed_version ?? "unknown"} {hermes.installed_sha_short ?? "unknown"}</div>
      <div className="mt-1 text-foreground/55">{hermes.source_label ?? hermes.source}</div>
    </div>
  </div>;
}

const updateAllStepLabels: Record<UpdateAllJobStatus["steps"][number]["name"], string> = {
  rebuild_mc: "Rebuild Mission Control",
  reinstall_ha: "Reinstall Hermes Agent",
  restart_ha: "Restart Hermes Agent",
  restart_mc: "Restart Mission Control",
};

function progressLabel(status: UpdateAllJobStatus["steps"][number]["status"]): string {
  if (status === "ok") return "done";
  if (status === "scheduled") return "scheduled";
  if (status === "running") return "running";
  if (status === "failed") return "failed";
  if (status === "skipped") return "skipped";
  return "pending";
}

function ProgressIcon({ status }: { status: UpdateAllJobStatus["steps"][number]["status"] }) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-400" />;
  if (status === "running") return <span className="h-3 w-3 animate-pulse rounded-full bg-[#ffbd38]" />;
  if (status === "scheduled") return <span className="h-3 w-3 rounded-full border border-[#ffbd38] bg-[#ffbd38]/20" />;
  return <span className="h-3 w-3 rounded-full bg-foreground/20" />;
}

function UpdateAllProgress({ job, error }: { job: UpdateAllJobStatus | null; error?: string }) {
  if (!job && !error) return null;
  const failedStep = job?.steps.find((step) => step.status === "failed");
  const steps = job?.steps ?? (["rebuild_mc", "reinstall_ha", "restart_ha", "restart_mc"] as const).map((name) => ({ name, status: "pending" as const, started_at: null, completed_at: null, log_excerpt: "" }));
  return <div className="mt-3 rounded-2xl border border-foreground/10 bg-background/50 p-3 text-xs text-foreground/80">
    <div className="mb-2 flex items-center justify-between gap-3"><span className="uppercase tracking-[0.16em] text-foreground/60">Update progress</span>{job ? <span className="font-mono text-[10px] text-foreground/45">{job.phase}</span> : null}</div>
    <div className="space-y-2">
      {steps.map((step) => <div key={step.name} className="flex items-center justify-between gap-3 rounded-xl bg-foreground/5 px-3 py-2"><span className="flex items-center gap-2"><ProgressIcon status={step.status} />{updateAllStepLabels[step.name]}</span><span className={cn("uppercase tracking-[0.14em]", step.status === "failed" ? "text-red-400" : step.status === "ok" ? "text-emerald-400" : step.status === "running" || step.status === "scheduled" ? "text-[#ffbd38]" : "text-foreground/45")}>{progressLabel(step.status)}</span></div>)}
    </div>
    {failedStep?.log_excerpt ? <pre className="mt-3 max-h-40 overflow-auto rounded-xl border border-red-400/20 bg-red-950/20 p-3 text-[11px] text-red-100/85">{failedStep.log_excerpt}</pre> : null}
    {error ? <div className="mt-3 rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-2 text-red-300">{error}</div> : null}
  </div>;
}

function DoctorResultPanel({ result }: { result: DoctorResult }) {
  const status = result.ok ? "OK" : result.checks.some((check) => check.status === "fail") ? "FAIL" : "WARN";
  return <div className="rounded-2xl border border-foreground/10 bg-background/50 p-3"><div className="mb-3 flex items-center justify-between gap-3 text-xs"><span className="text-foreground/70">{result.summary}</span><span className={cn("rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em]", status === "OK" ? "border-emerald-400/30 text-emerald-400" : status === "WARN" ? "border-[#ffbd38]/30 text-[#ffbd38]" : "border-red-500/30 text-red-500")}>{status}</span></div><div className="max-h-56 space-y-2 overflow-auto pr-1 text-xs text-foreground/80">{result.checks.map((check) => <div key={check.name} className="rounded-xl bg-foreground/5 px-3 py-2"><div className="flex items-center justify-between gap-3"><span>{check.name}</span><span className="uppercase text-foreground/60">{check.status}</span></div><div className="mt-1 text-foreground/65">{check.detail}</div></div>)}</div></div>;
}
function FileResult({ label, filename, size, href, createdAt }: { label: string; filename: string; size: number; href: string; createdAt?: string }) {
  return <div className="rounded-2xl border border-foreground/10 bg-background/50 p-3 text-xs text-foreground/80"><div className="font-medium text-foreground">{label}</div>{createdAt ? <div className="mt-1 text-foreground/65">Created at {createdAt}</div> : null}<div className="mt-2 break-all text-foreground/70">{filename} · {formatFileSize(size)}</div><a className="mt-3 inline-flex items-center gap-2 rounded-full border border-foreground/15 px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-[color:var(--warm-glow)] hover:bg-foreground/5" href={href} download><Download className="h-3.5 w-3.5" /> Download</a></div>;
}
function OperationResult({ result }: { result?: DestructiveMaintenanceResult }) {
  if (!result) return null;
  return (
    <div className="rounded-2xl border border-foreground/10 bg-background/50 p-3 text-xs text-foreground/80">
      <div className={result.ok ? "text-emerald-400" : "text-red-400"}>{result.message}</div>
      {result.snapshot ? <div className="mt-2 break-all text-foreground/65">Snapshot: {result.snapshot.path}</div> : null}
      {result.error ? <div className="mt-2 text-[#ffbd38]">{result.error}</div> : null}
      {result.log ? <pre className="mt-3 max-h-48 overflow-auto rounded-xl bg-black/30 p-3 text-[11px] text-foreground/70">{result.log}</pre> : null}
    </div>
  );
}
function AutoFixResult({ result }: { result?: DestructiveMaintenanceResult }) {
  if (!result?.steps) return <OperationResult result={result} />;
  return (
    <div className="space-y-2 rounded-2xl border border-foreground/10 bg-background/50 p-3 text-xs">
      {result.steps.map((step) => (
        <div key={step.name} className="flex items-start gap-2 rounded-xl bg-foreground/5 px-3 py-2">
          <span className={step.ok ? "text-emerald-400" : "text-red-400"}>{step.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}</span>
          <div><div className="text-foreground/85">{step.name}</div><div className="text-foreground/60">{step.detail}</div></div>
        </div>
      ))}
    </div>
  );
}
function RestartOverlay({ label }: { label?: string }) {
  if (!label) return null;
  return <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/70 text-foreground backdrop-blur-md"><Loader2 className="mb-4 h-8 w-8 animate-spin text-[color:var(--warm-glow)]" /><div className="text-xl font-light">{label}</div><div className="mt-2 text-sm text-foreground/65">Waiting for Mission Control to return...</div></div>;
}

async function waitForRoot() {
  for (let index = 0; index < 15; index += 1) {
    try { const response = await fetch("/", { cache: "no-store" }); if (response.ok) return; } catch { /* retry */ }
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
}

async function pollGatewayEnv(): Promise<boolean> {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://localhost:9119/env", { cache: "no-store" });
      if (response.ok) return true;
    } catch { /* retry */ }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  return false;
}

export function MaintenanceView() {
  const [version, setVersion] = useState<MaintenanceVersion | null>(null);
  const [commits, setCommits] = useState<GitCommitOption[]>([]);
  const [selectedCommit, setSelectedCommit] = useState("HEAD~1");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [loading, setLoading] = useState<Partial<Record<ActionKey, boolean>>>({});
  const [destructiveLoading, setDestructiveLoading] = useState<DestructiveKey | null>(null);
  const [results, setResults] = useState<ResultState>({});
  const [destructiveResults, setDestructiveResults] = useState<Partial<Record<Exclude<DestructiveKey, "restartGateway">, DestructiveMaintenanceResult>>>({});
  const [errors, setErrors] = useState<ErrorState>({});
  const [modal, setModal] = useState<ModalState>(null);
  const [restartOverlay, setRestartOverlay] = useState<string | undefined>();
  const [hciStatus, setHciStatus] = useState<HciStatus | null>(null);
  const [hciChecking, setHciChecking] = useState(false);
  const [hciLastChecked, setHciLastChecked] = useState<string | null>(null);
  const [hciCheckFailed, setHciCheckFailed] = useState(false);
  const [updateAllJobId, setUpdateAllJobId] = useState<string | null>(null);
  const [updateAllJob, setUpdateAllJob] = useState<UpdateAllJobStatus | null>(null);
  const [updateAllError, setUpdateAllError] = useState<string | undefined>();
  const [updateAllStarting, setUpdateAllStarting] = useState(false);
  const [hermesStatus, setHermesStatus] = useState<HermesStatus | null>(null);
  const [hermesChecking, setHermesChecking] = useState(false);
  const [hermesLastChecked, setHermesLastChecked] = useState<string | null>(null);
  const [hermesCheckFailed, setHermesCheckFailed] = useState(false);
  const [gatewayRestartState, setGatewayRestartState] = useState<GatewayRestartState>("idle");
  const [gatewayRespondedAt, setGatewayRespondedAt] = useState<string | null>(null);

  const checkHciStatus = useCallback(async () => {
    setHciChecking(true);
    setHciCheckFailed(false);
    try {
      const payload = await api.getHciMaintenanceStatus();
      setHciStatus(payload);
      setHciLastChecked(formatClock());
    } catch {
      setHciCheckFailed(true);
    } finally {
      setHciChecking(false);
    }
  }, []);

  const checkHermesStatus = useCallback(async () => {
    setHermesChecking(true);
    setHermesCheckFailed(false);
    try {
      const payload = await api.getHermesMaintenanceStatus();
      setHermesStatus(payload);
      setHermesLastChecked(formatClock());
    } catch {
      setHermesCheckFailed(true);
    } finally {
      setHermesChecking(false);
    }
  }, []);

  useEffect(() => {
    void api.getMaintenanceVersion().then(setVersion).catch((error: unknown) => setErrors((current) => ({ ...current, version: error instanceof Error ? error.message : "Could not load version" })));
    void api.getMissionControlCommits().then((payload) => { setCommits(payload.commits); if (payload.commits[1]) setSelectedCommit(payload.commits[1].hash); }).catch(() => undefined);
  }, []);

  useEffect(() => { void checkHciStatus(); }, [checkHciStatus]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;
    let restartMisses = 0;
    async function poll() {
      if (!updateAllJobId) return;
      try {
        const payload = await api.getUpdateAllMaintenanceStatus(updateAllJobId);
        if (cancelled) return;
        setUpdateAllJob(payload);
        setHciStatus(payload.current_hci_status);
        if (payload.phase === "failed") {
          setUpdateAllError("Update All failed. Review the failed step log.");
          setDestructiveLoading(null);
          return;
        }
        if (payload.phase === "completed") {
          setUpdateAllError(undefined);
          setDestructiveLoading(null);
          await checkHciStatus();
          return;
        }
        timeoutId = window.setTimeout(poll, 1000);
      } catch (error) {
        if (cancelled) return;
        const phase = updateAllJob?.phase;
        if (phase === "mc_restart_scheduled" && restartMisses < 15) {
          restartMisses += 1;
          timeoutId = window.setTimeout(poll, 1000);
          return;
        }
        setUpdateAllError(error instanceof Error ? error.message : "Could not read update status");
        setDestructiveLoading(null);
      }
    }
    timeoutId = window.setTimeout(poll, 250);
    return () => { cancelled = true; if (timeoutId) window.clearTimeout(timeoutId); };
  }, [checkHciStatus, updateAllJob?.phase, updateAllJobId]);

  useEffect(() => {
    void api.getUpdateAllMaintenanceStatus().then((payload) => {
      if (payload.phase !== "completed" && payload.phase !== "failed") {
        setUpdateAllJobId(payload.job_id);
        setUpdateAllJob(payload);
      }
    }).catch(() => undefined);
  }, []);
  useEffect(() => { void checkHermesStatus(); }, [checkHermesStatus]);

  const runAction = useCallback(async <K extends ActionKey>(key: K, fn: () => Promise<NonNullable<ResultState[K]>>) => {
    if (loading[key]) return;
    setLoading((current) => ({ ...current, [key]: true })); setErrors((current) => ({ ...current, [key]: undefined }));
    try { const payload = await fn(); setResults((current) => ({ ...current, [key]: payload })); } catch (error) { setErrors((current) => ({ ...current, [key]: error instanceof Error ? error.message : "Action failed" })); } finally { setLoading((current) => ({ ...current, [key]: false })); }
  }, [loading]);

  const destructiveDisabled = Boolean(destructiveLoading);
  const updateAllActive = updateAllStarting || Boolean(updateAllJob && updateAllJob.phase !== "completed" && updateAllJob.phase !== "failed");
  const hciAllInSync = hciStatus?.mission_control.status === "in_sync" && hciStatus?.hermes_agent.status === "in_sync";
  const hciCardButtonsDisabled = destructiveDisabled || updateAllActive;
  const gatewayBusy = gatewayRestartState === "restarting";
  const hermesButtonsDisabled = destructiveDisabled || gatewayBusy;
  const hciBody = version ? <span>Version {version.mission_control.version} <span className="text-foreground/45">Commit</span> {hciStatus?.worktree.head_sha_short ?? version.mission_control.commit} <span className="text-foreground/45">Branch</span> {hciStatus?.worktree.branch ?? version.mission_control.branch}</span> : <span>{errors.version ? "Version unavailable" : "Loading version..."}</span>;
  const hermesBody = <><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span>{version ? `Version ${version.hermes_agent.version}` : "Loading version..."}</span><a href="https://github.com/NousResearch/hermes-agent/releases" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-foreground/60 underline-offset-4 transition hover:text-[var(--warm-glow)] hover:underline">View releases <ExternalLink className="h-3 w-3" /></a></div><HermesStatusBlock status={hermesStatus} /></>;

  const runGatewayRestart = async () => {
    setGatewayRestartState("restarting");
    setGatewayRespondedAt(null);
    await api.restartGatewayMaintenance();
    const ok = await pollGatewayEnv();
    if (ok) {
      setGatewayRespondedAt(formatClock());
      setGatewayRestartState("success");
    } else {
      setGatewayRestartState("timeout");
    }
  };


  const runUpdateAll = async () => {
    setUpdateAllStarting(true);
    setUpdateAllError(undefined);
    setUpdateAllJob(null);
    try {
      const payload = await api.startUpdateAllMaintenance();
      setUpdateAllJobId(payload.job_id);
    } catch (error) {
      setUpdateAllError(error instanceof Error ? error.message : "Update All failed");
      setDestructiveLoading(null);
    } finally {
      setUpdateAllStarting(false);
    }
  };

  const runDestructive = async (key: DestructiveKey) => {
    setDestructiveLoading(key);
    try {
      if (key === "restartGateway") { await runGatewayRestart(); return; }
      let payload: DestructiveMaintenanceResult;
      if (key === "restart") { setRestartOverlay("Restarting Mission Control..."); payload = await api.restartMissionControl(); await waitForRoot(); setRestartOverlay(undefined); }
      else if (key === "updateAll") { await runUpdateAll(); return; }
      else if (key === "rollback") { payload = await api.rollbackMaintenance(selectedCommit); await waitForRoot(); }
      else if (key === "autoFix") { payload = await api.autoFixMaintenance(); }
      else if (key === "updateHermes") { payload = await api.updateHermesMaintenance(); }
      else {
        if (!importFile) throw new Error("Choose a backup archive before importing.");
        setRestartOverlay("Importing backup and restarting Mission Control..."); payload = await api.importMaintenanceBackup(importFile, "RESTORE FROM BACKUP"); await waitForRoot(); setRestartOverlay(undefined);
      }
      setDestructiveResults((current) => ({ ...current, [key]: payload }));
    } catch (error) {
      setRestartOverlay(undefined);
      if (key === "restartGateway") setGatewayRestartState("error");
      else setDestructiveResults((current) => ({ ...current, [key]: { ok: false, message: "Action failed", error: error instanceof Error ? error.message : "Action failed" } }));
    } finally { setDestructiveLoading(null); setModal(null); }
  };

  const gatewayStatusLine = gatewayRestartState === "restarting"
    ? "Restarting gateway..."
    : gatewayRestartState === "success" && gatewayRespondedAt
      ? `Gateway responded at ${gatewayRespondedAt}`
      : gatewayRestartState === "timeout"
        ? "Gateway did not respond within 12s. Check launchctl manually."
        : gatewayRestartState === "error"
          ? "Gateway restart failed. Check launchctl manually."
          : null;

  const modalFor = (key: DestructiveKey): ModalState => {
    if (key === "restart") return { key, title: "Restart HCI", body: "This will briefly take Mission Control offline (approx 5 seconds). In-flight requests will fail. Continue?", confirmLabel: "Restart HCI", riskLevel: "low" };
    if (key === "updateAll") return { key, title: "Update All", body: <div className="space-y-3"><p>This will run the full HCI update sequence:</p><ul className="list-disc space-y-1 pl-5"><li>Rebuild Mission Control dist from worktree HEAD</li><li>Reinstall Hermes Agent from worktree in editable mode</li><li>Restart both services</li></ul><p>Mission Control will briefly drop while restarting. Hermes Agent will briefly drop during its restart.</p></div>, confirmLabel: "Update All", riskLevel: "high", requirePhrase: "UPDATE ALL" };
    if (key === "rollback") return { key, title: "Rollback Mission Control", body: <><select className="mb-3 w-full rounded-2xl border border-foreground/12 bg-background/80 px-3 py-2 text-foreground" value={selectedCommit} onChange={(event) => setSelectedCommit(event.target.value)}>{commits.map((commit) => <option key={commit.hash} value={commit.hash}>{commit.short} - {commit.subject}</option>)}<option value="HEAD~1">HEAD~1</option></select><p>This will reset Mission Control to commit {selectedCommit}. A snapshot of current state will be taken first.</p></>, confirmLabel: "Rollback", riskLevel: "medium" };
    if (key === "autoFix") return { key, title: "Auto-Fix", body: <span>This will run these repair operations:<br />• Clear stale lock files<br />• Truncate oversized logs<br />• Resync dist directory<br />• Restart down services</span>, confirmLabel: "Auto-Fix", riskLevel: "medium" };
    if (key === "updateHermes") return { key, title: "Hermes Update", body: "This will update Hermes Agent and restart the Hermes Agent service. Mission Control stays online. A snapshot will be taken first.", confirmLabel: "Update Hermes", riskLevel: "high", requirePhrase: "UPDATE HERMES" };
    if (key === "restartGateway") return { key, title: "Restart Hermes Agent Gateway", body: "This restarts the Hermes Agent service on localhost:9119. Open chat sessions on the gateway will be interrupted briefly. Mission Control will not be affected.", confirmLabel: "Restart Gateway", riskLevel: "high", requirePhrase: "RESTART GATEWAY" };
    return { key, title: "Import Backup", body: <><input type="file" accept=".gz,.tgz,.tar.gz" onChange={(event) => setImportFile(event.target.files?.[0] ?? null)} className="mb-3 block w-full text-sm" />{importFile ? <p>This will REPLACE all current Mission Control and Hermes data with the contents of {importFile.name}. A snapshot of current state will be taken first.</p> : <p>Choose a Mission Control backup archive before confirming.</p>}</>, confirmLabel: "Import", riskLevel: "high", requirePhrase: "RESTORE FROM BACKUP" };
  };

  return <section className="flex flex-1 flex-col overflow-y-auto px-4 py-5 sm:px-8 lg:px-12"><RestartOverlay label={restartOverlay} /><ConfirmActionModal open={Boolean(modal)} onClose={() => setModal(null)} onConfirm={() => modal ? runDestructive(modal.key) : undefined} title={modal?.title ?? "Confirm"} body={modal?.body} confirmLabel={modal?.confirmLabel ?? "Confirm"} riskLevel={modal?.riskLevel ?? "low"} requirePhrase={modal?.requirePhrase} />
    <div className="mb-6"><p className="text-[10px] uppercase tracking-[0.28em] text-foreground/70">Maintenance</p><h1 className="mt-2 text-3xl font-light tracking-[-0.04em] text-foreground sm:text-4xl">Maintenance</h1><p className="mt-2 text-sm text-foreground/70">System tools and diagnostics</p></div>
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      <Card title="Health Check" icon={HeartPulse} body="Test all HCI API endpoints" result={<><ErrorPanel message={errors.health} />{results.health ? <HealthResult result={results.health} /> : null}<OperationResult result={destructiveResults.restart} /></>}><ActionButton loading={loading.health} onClick={() => void runAction("health", api.runMaintenanceHealthCheck)}>Check APIs</ActionButton><ActionButton disabled={destructiveDisabled} loading={destructiveLoading === "restart"} onClick={() => setModal(modalFor("restart"))}>Restart HCI</ActionButton></Card>
      <Card title="HCI Update" icon={GitBranch} body={hciBody} result={<><ErrorPanel message={errors.updates} />{hciCheckFailed ? <div className="mb-2 text-[11px] text-foreground/45">Check failed. Retry.</div> : null}<HciStatusRows status={hciStatus} />{hciLastChecked ? <div className="mt-3 text-[11px] text-foreground/45">Last checked {hciLastChecked}</div> : null}<UpdateAllProgress job={updateAllJob} error={updateAllError} /><OperationResult result={destructiveResults.updateAll} /><OperationResult result={destructiveResults.rollback} /></>}><ActionButton disabled={hciCardButtonsDisabled} loading={hciChecking} onClick={() => void checkHciStatus()}>Check Updates</ActionButton><ActionButton variant={hciAllInSync ? "default" : "warning"} disabled={hciAllInSync || hciCardButtonsDisabled} loading={destructiveLoading === "updateAll" || updateAllStarting} onClick={() => setModal(modalFor("updateAll"))}>{hciAllInSync ? "ALL UP TO DATE" : "Update All"}</ActionButton><ActionButton disabled={hciCardButtonsDisabled} loading={destructiveLoading === "rollback"} onClick={() => setModal(modalFor("rollback"))}>Rollback</ActionButton></Card>
      <Card title="Doctor" icon={Stethoscope} body="Run diagnostics" result={<><ErrorPanel message={errors.doctor} />{results.doctor ? <DoctorResultPanel result={results.doctor} /> : null}<AutoFixResult result={destructiveResults.autoFix} /></>}><ActionButton loading={loading.doctor} onClick={() => void runAction("doctor", api.runMaintenanceDoctor)}>Run Diagnose</ActionButton><ActionButton disabled={destructiveDisabled} loading={destructiveLoading === "autoFix"} onClick={() => setModal(modalFor("autoFix"))}>Auto-Fix</ActionButton></Card>
      <Card title="Dump" icon={FileDown} body="Setup summary for debugging" result={<><ErrorPanel message={errors.dump} />{results.dump ? <FileResult label="Dump created" filename={results.dump.filename} size={results.dump.size_bytes} href={results.dump.download_url} /> : null}</>}><ActionButton loading={loading.dump} onClick={() => void runAction("dump", api.generateMaintenanceDump)}>Generate Dump</ActionButton></Card>
      <Card title="Hermes Update" icon={RefreshCw} body={hermesBody} result={<><OperationResult result={destructiveResults.updateHermes} />{hermesLastChecked ? <div className="mt-3 text-[11px] text-foreground/45">Last checked {hermesLastChecked}</div> : null}{hermesCheckFailed ? <div className="mt-2 text-[11px] text-foreground/45">Check failed. Retry.</div> : null}{gatewayStatusLine ? <div className={cn("mt-2 text-[11px]", gatewayRestartState === "success" ? "text-emerald-400" : gatewayRestartState === "timeout" || gatewayRestartState === "error" ? "text-[#ffbd38]" : "text-foreground/55")}>{gatewayStatusLine}</div> : null}</>}><ActionButton disabled={hermesButtonsDisabled} loading={hermesChecking} onClick={() => void checkHermesStatus()}>Check Update</ActionButton><ActionButton disabled={hermesButtonsDisabled} loading={destructiveLoading === "updateHermes"} onClick={() => setModal(modalFor("updateHermes"))}>Update Hermes</ActionButton><ActionButton variant="warning" disabled={hermesButtonsDisabled} loading={destructiveLoading === "restartGateway"} onClick={() => setModal(modalFor("restartGateway"))}>Restart Gateway</ActionButton></Card>
      <Card title="Backup & Import" icon={Archive} body="Create and restore Hermes data backups" result={<><ErrorPanel message={errors.backup} />{results.backup ? <FileResult label="Backup created" filename={results.backup.filename} size={results.backup.size_bytes} href={results.backup.download_url} createdAt={results.backup.created_at} /> : null}<OperationResult result={destructiveResults.import} /></>}><ActionButton loading={loading.backup} onClick={() => void runAction("backup", api.createMaintenanceBackup)}>Create Backup</ActionButton><ActionButton disabled={destructiveDisabled} loading={destructiveLoading === "import"} onClick={() => setModal(modalFor("import"))}>Import</ActionButton></Card>
    </div>
    <div className="mt-5 flex items-center gap-2 rounded-2xl border border-foreground/10 bg-background/40 px-4 py-3 text-xs text-foreground/70 backdrop-blur-xl"><ShieldAlert className="h-4 w-4 text-[#ffbd38]" /> Destructive actions require confirmation; high-risk actions auto-snapshot before execution.</div>
  </section>;
}

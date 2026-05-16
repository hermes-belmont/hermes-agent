import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Archive, CheckCircle2, Download, ExternalLink, FileDown, GitBranch, HeartPulse, Loader2, RefreshCw, ShieldAlert, Stethoscope, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ConfirmActionModal } from "./ConfirmActionModal";
import type { RiskLevel } from "@/lib/confirm-action";
import { formatFileSize, updateSummary, type BackupResult, type DestructiveMaintenanceResult, type DoctorResult, type DumpResult, type GitCommitOption, type HealthCheckResult, type MaintenanceVersion, type UpdateCheckResult } from "@/lib/maintenance";

type ActionKey = "health" | "updates" | "doctor" | "dump" | "backup";
type DestructiveKey = "restart" | "updateAll" | "rollback" | "autoFix" | "updateHermes" | "import";
type ResultState = { health?: HealthCheckResult; updates?: UpdateCheckResult; doctor?: DoctorResult; dump?: DumpResult; backup?: BackupResult };
type ErrorState = Partial<Record<ActionKey | "version", string>>;

type ModalState = { key: DestructiveKey; title: string; body: ReactNode; confirmLabel: string; riskLevel: RiskLevel; requirePhrase?: string } | null;

function Card({ title, icon: Icon, body, children, result }: { title: string; icon: typeof HeartPulse; body: ReactNode; children: ReactNode; result?: ReactNode }) {
  return <article className="rounded-[28px] border border-foreground/10 bg-background/58 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.18)] backdrop-blur-xl"><div className="mb-4 flex items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.24em] text-foreground/70">{title}</p><div className="mt-3 text-sm text-foreground/75">{body}</div></div><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-foreground/10 bg-foreground/5 text-[color:var(--warm-glow)]"><Icon className="h-4 w-4" /></span></div><div className="flex flex-wrap gap-2">{children}</div>{result ? <div className="mt-4">{result}</div> : null}</article>;
}

function ActionButton({ children, onClick, loading = false, disabled = false, title }: { children: ReactNode; onClick?: () => void; loading?: boolean; disabled?: boolean; title?: string }) {
  return <button type="button" onClick={onClick} disabled={disabled || loading} title={title} className="inline-flex items-center gap-2 rounded-full border border-foreground/15 bg-background/60 px-3.5 py-2 text-[11px] uppercase tracking-[0.16em] text-foreground/85 transition hover:border-[color:var(--warm-glow)] hover:text-[color:var(--warm-glow)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-foreground/15 disabled:hover:text-foreground/85">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{children}</button>;
}

function ErrorPanel({ message }: { message?: string }) {
  if (!message) return null;
  return <div className="rounded-2xl border border-[#ffbd38]/30 bg-[#ffbd38]/10 px-3 py-2 text-xs text-[#ffbd38]">{message}</div>;
}
function StatusDot({ ok }: { ok: boolean }) { return <span className={cn("h-2 w-2 rounded-full", ok ? "bg-emerald-400" : "bg-red-500")} />; }

function HealthResult({ result }: { result: HealthCheckResult }) {
  return <details open className="rounded-2xl border border-foreground/10 bg-background/50 p-3"><summary className="cursor-pointer text-xs uppercase tracking-[0.18em] text-foreground/70">{result.ok ? "All checks passing" : "Checks need attention"}</summary><div className="mt-3 space-y-2">{result.checks.map((check) => <div key={check.endpoint} className="flex items-start justify-between gap-3 rounded-xl bg-foreground/5 px-3 py-2 text-xs text-foreground/80"><span className="flex min-w-0 items-center gap-2"><StatusDot ok={check.status >= 200 && check.status < 300} /><span className="truncate">{check.endpoint}</span></span><span className="shrink-0 text-foreground/70">{check.status || "ERR"} · {check.latency_ms}ms</span>{check.error ? <span className="basis-full text-[#ffbd38]">{check.error}</span> : null}</div>)}</div></details>;
}
function UpdatesResult({ result }: { result: UpdateCheckResult }) {
  const rows = [["Mission Control", result.mission_control] as const, ["Hermes Agent", result.hermes_agent] as const];
  return <div className="rounded-2xl border border-foreground/10 bg-background/50 p-3 text-xs text-foreground/80">{rows.map(([label, value]) => <div key={label} className="border-b border-foreground/8 py-2 last:border-0"><div className="flex items-center justify-between gap-3"><span>{label}</span><span className={value.up_to_date ? "text-emerald-400" : "text-[#ffbd38]"}>{updateSummary(value)}</span></div><div className="mt-1 text-foreground/60">Latest commit: {value.latest_commit}</div>{value.error ? <div className="mt-1 text-[#ffbd38]">{value.error}</div> : null}</div>)}</div>;
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
  return <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/70 text-foreground backdrop-blur-md"><Loader2 className="mb-4 h-8 w-8 animate-spin text-[color:var(--warm-glow)]" /><div className="text-xl font-light">{label}</div><div className="mt-2 text-sm text-foreground/65">Waiting for Mission Control to return…</div></div>;
}

async function waitForRoot() {
  for (let index = 0; index < 15; index += 1) {
    try { const response = await fetch("/", { cache: "no-store" }); if (response.ok) return; } catch { /* retry */ }
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
}

export function MaintenanceView() {
  const [version, setVersion] = useState<MaintenanceVersion | null>(null);
  const [commits, setCommits] = useState<GitCommitOption[]>([]);
  const [selectedCommit, setSelectedCommit] = useState("HEAD~1");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [loading, setLoading] = useState<Partial<Record<ActionKey, boolean>>>({});
  const [destructiveLoading, setDestructiveLoading] = useState<DestructiveKey | null>(null);
  const [results, setResults] = useState<ResultState>({});
  const [destructiveResults, setDestructiveResults] = useState<Partial<Record<DestructiveKey, DestructiveMaintenanceResult>>>({});
  const [errors, setErrors] = useState<ErrorState>({});
  const [modal, setModal] = useState<ModalState>(null);
  const [restartOverlay, setRestartOverlay] = useState<string | undefined>();

  useEffect(() => { void api.getMaintenanceVersion().then(setVersion).catch((error: unknown) => setErrors((current) => ({ ...current, version: error instanceof Error ? error.message : "Could not load version" }))); void api.getMissionControlCommits().then((payload) => { setCommits(payload.commits); if (payload.commits[1]) setSelectedCommit(payload.commits[1].hash); }).catch(() => undefined); }, []);

  const runAction = useCallback(async <K extends ActionKey>(key: K, fn: () => Promise<NonNullable<ResultState[K]>>) => {
    if (loading[key]) return;
    setLoading((current) => ({ ...current, [key]: true })); setErrors((current) => ({ ...current, [key]: undefined }));
    try { const payload = await fn(); setResults((current) => ({ ...current, [key]: payload })); } catch (error) { setErrors((current) => ({ ...current, [key]: error instanceof Error ? error.message : "Action failed" })); } finally { setLoading((current) => ({ ...current, [key]: false })); }
  }, [loading]);

  const destructiveDisabled = Boolean(destructiveLoading);
  const updateCount = results.updates?.mission_control.behind_by ?? 0;
  const updateBranch = version?.mission_control.branch ?? "current branch";
  const versionBody = version ? <span>Version {version.mission_control.version} <span className="text-foreground/45">Commit</span> {version.mission_control.commit} <span className="text-foreground/45">Branch</span> {version.mission_control.branch}</span> : <span>{errors.version ? "Version unavailable" : "Loading version…"}</span>;

  const runDestructive = async (key: DestructiveKey) => {
    setDestructiveLoading(key);
    try {
      let payload: DestructiveMaintenanceResult;
      if (key === "restart") { setRestartOverlay("Restarting Mission Control..."); payload = await api.restartMissionControl(); await waitForRoot(); setRestartOverlay(undefined); }
      else if (key === "updateAll") { payload = await api.updateAllMaintenance(); await waitForRoot(); }
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
      setDestructiveResults((current) => ({ ...current, [key]: { ok: false, message: "Action failed", error: error instanceof Error ? error.message : "Action failed" } }));
    } finally { setDestructiveLoading(null); setModal(null); }
  };

  const modalFor = (key: DestructiveKey): ModalState => {
    if (key === "restart") return { key, title: "Restart HCI", body: "This will briefly take Mission Control offline (≈5 seconds). In-flight requests will fail. Continue?", confirmLabel: "Restart HCI", riskLevel: "low" };
    if (key === "updateAll") return { key, title: "Update Mission Control", body: <>This will pull {updateCount} new commits from {updateBranch} and rebuild Mission Control. Mission Control will restart. A snapshot will be taken first.</>, confirmLabel: "Update All", riskLevel: "high", requirePhrase: "UPDATE MISSION CONTROL" };
    if (key === "rollback") return { key, title: "Rollback Mission Control", body: <><select className="mb-3 w-full rounded-2xl border border-foreground/12 bg-background/80 px-3 py-2 text-foreground" value={selectedCommit} onChange={(event) => setSelectedCommit(event.target.value)}>{commits.map((commit) => <option key={commit.hash} value={commit.hash}>{commit.short} — {commit.subject}</option>)}<option value="HEAD~1">HEAD~1</option></select><p>This will reset Mission Control to commit {selectedCommit}. A snapshot of current state will be taken first.</p></>, confirmLabel: "Rollback", riskLevel: "medium" };
    if (key === "autoFix") return { key, title: "Auto-Fix", body: <span>This will run these repair operations:<br />• Clear stale lock files<br />• Truncate oversized logs<br />• Resync dist directory<br />• Restart down services</span>, confirmLabel: "Auto-Fix", riskLevel: "medium" };
    if (key === "updateHermes") return { key, title: "Hermes Update", body: "This will update Hermes Agent and restart the Hermes Agent service. Mission Control stays online. A snapshot will be taken first.", confirmLabel: "Update Hermes", riskLevel: "high", requirePhrase: "UPDATE HERMES" };
    return { key, title: "Import Backup", body: <><input type="file" accept=".gz,.tgz,.tar.gz" onChange={(event) => setImportFile(event.target.files?.[0] ?? null)} className="mb-3 block w-full text-sm" />{importFile ? <p>This will REPLACE all current Mission Control and Hermes data with the contents of {importFile.name}. A snapshot of current state will be taken first.</p> : <p>Choose a Mission Control backup archive before confirming.</p>}</>, confirmLabel: "Import", riskLevel: "high", requirePhrase: "RESTORE FROM BACKUP" };
  };

  return <section className="flex flex-1 flex-col overflow-y-auto px-4 py-5 sm:px-8 lg:px-12"><RestartOverlay label={restartOverlay} /><ConfirmActionModal open={Boolean(modal)} onClose={() => setModal(null)} onConfirm={() => modal ? runDestructive(modal.key) : undefined} title={modal?.title ?? "Confirm"} body={modal?.body} confirmLabel={modal?.confirmLabel ?? "Confirm"} riskLevel={modal?.riskLevel ?? "low"} requirePhrase={modal?.requirePhrase} />
    <div className="mb-6"><p className="text-[10px] uppercase tracking-[0.28em] text-foreground/70">Maintenance</p><h1 className="mt-2 text-3xl font-light tracking-[-0.04em] text-foreground sm:text-4xl">Maintenance</h1><p className="mt-2 text-sm text-foreground/70">System tools and diagnostics</p></div>
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      <Card title="Health Check" icon={HeartPulse} body="Test all HCI API endpoints" result={<><ErrorPanel message={errors.health} />{results.health ? <HealthResult result={results.health} /> : null}<OperationResult result={destructiveResults.restart} /></>}><ActionButton loading={loading.health} onClick={() => void runAction("health", api.runMaintenanceHealthCheck)}>Check APIs</ActionButton><ActionButton disabled={destructiveDisabled} loading={destructiveLoading === "restart"} onClick={() => setModal(modalFor("restart"))}>Restart HCI</ActionButton></Card>
      <Card title="HCI Update" icon={GitBranch} body={versionBody} result={<><ErrorPanel message={errors.updates} />{results.updates ? <UpdatesResult result={results.updates} /> : null}<OperationResult result={destructiveResults.updateAll} /><OperationResult result={destructiveResults.rollback} /></>}><ActionButton loading={loading.updates} onClick={() => void runAction("updates", api.checkMaintenanceUpdates)}>Check Updates</ActionButton><ActionButton disabled={destructiveDisabled} loading={destructiveLoading === "updateAll"} onClick={() => setModal(modalFor("updateAll"))}>Update All</ActionButton><ActionButton disabled={destructiveDisabled} loading={destructiveLoading === "rollback"} onClick={() => setModal(modalFor("rollback"))}>Rollback</ActionButton></Card>
      <Card title="Doctor" icon={Stethoscope} body="Run diagnostics" result={<><ErrorPanel message={errors.doctor} />{results.doctor ? <DoctorResultPanel result={results.doctor} /> : null}<AutoFixResult result={destructiveResults.autoFix} /></>}><ActionButton loading={loading.doctor} onClick={() => void runAction("doctor", api.runMaintenanceDoctor)}>Run Diagnose</ActionButton><ActionButton disabled={destructiveDisabled} loading={destructiveLoading === "autoFix"} onClick={() => setModal(modalFor("autoFix"))}>Auto-Fix</ActionButton></Card>
      <Card title="Dump" icon={FileDown} body="Setup summary for debugging" result={<><ErrorPanel message={errors.dump} />{results.dump ? <FileResult label="Dump created" filename={results.dump.filename} size={results.dump.size_bytes} href={results.dump.download_url} /> : null}</>}><ActionButton loading={loading.dump} onClick={() => void runAction("dump", api.generateMaintenanceDump)}>Generate Dump</ActionButton></Card>
      <Card title="Hermes Update" icon={RefreshCw} body={<><span>{version ? `Version ${version.hermes_agent.version}` : "Loading version…"}</span><a href="https://github.com/NousResearch/hermes-agent/releases" target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] text-foreground/60 underline-offset-4 transition hover:text-[var(--warm-glow)] hover:underline">View releases <ExternalLink className="h-3 w-3" /></a></>} result={<OperationResult result={destructiveResults.updateHermes} />}><ActionButton disabled={destructiveDisabled} loading={destructiveLoading === "updateHermes"} onClick={() => setModal(modalFor("updateHermes"))}>Update Hermes</ActionButton></Card>
      <Card title="Backup & Import" icon={Archive} body="Create and restore Hermes data backups" result={<><ErrorPanel message={errors.backup} />{results.backup ? <FileResult label="Backup created" filename={results.backup.filename} size={results.backup.size_bytes} href={results.backup.download_url} createdAt={results.backup.created_at} /> : null}<OperationResult result={destructiveResults.import} /></>}><ActionButton loading={loading.backup} onClick={() => void runAction("backup", api.createMaintenanceBackup)}>Create Backup</ActionButton><ActionButton disabled={destructiveDisabled} loading={destructiveLoading === "import"} onClick={() => setModal(modalFor("import"))}>Import</ActionButton></Card>
    </div>
    <div className="mt-5 flex items-center gap-2 rounded-2xl border border-foreground/10 bg-background/40 px-4 py-3 text-xs text-foreground/70 backdrop-blur-xl"><ShieldAlert className="h-4 w-4 text-[#ffbd38]" /> Destructive actions require confirmation; high-risk actions auto-snapshot before execution.</div>
  </section>;
}

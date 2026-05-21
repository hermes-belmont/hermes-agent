import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Clock, Loader2, Pause, Play, Plus, Trash2 } from "lucide-react";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { CronJobCreateModal } from "@/components/briefings/CronJobCreateModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { CronJob, HermesProfile } from "@/lib/types";
import { cn } from "@/lib/utils";

function jobProfile(job: CronJob) {
  return job.profile_name || job.profile || "default";
}

function jobTitle(job: CronJob) {
  return job.name || job.id;
}

function scheduleLabel(job: CronJob) {
  if (job.schedule_display) return job.schedule_display;
  if (typeof job.schedule === "string") return job.schedule;
  return job.schedule?.display || job.schedule?.expr || "No schedule";
}

function jobPaused(job: CronJob) {
  return job.enabled === false || job.state === "paused";
}

function formatDate(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const delta = date.getTime() - Date.now();
  const abs = Math.abs(delta);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 60_000) return rtf.format(Math.round(delta / 1000), "second");
  if (abs < 3_600_000) return rtf.format(Math.round(delta / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(delta / 3_600_000), "hour");
  return rtf.format(Math.round(delta / 86_400_000), "day");
}

function StatePill({ paused }: { paused: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.12em]",
      paused ? "border-amber-400/30 bg-amber-400/10 text-amber-200" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    )}>
      {paused ? "Paused" : "Enabled"}
    </span>
  );
}

export function CronJobsPanel() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [profiles, setProfiles] = useState<HermesProfile[]>([]);
  const [profile, setProfile] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CronJob | null>(null);
  const [actionId, setActionId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextJobs, profilePayload] = await Promise.all([
        api.listCronJobs(profile),
        api.getAgentProfiles().catch(() => ({ profiles: [] as HermesProfile[] })),
      ]);
      setJobs(Array.isArray(nextJobs) ? nextJobs : []);
      setProfiles(Array.isArray(profilePayload.profiles) ? profilePayload.profiles : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => { void load(); }, [load]);

  const profileOptions = useMemo(() => [{ name: "all", label: "All profiles" }, ...profiles.map((item) => ({ name: item.name, label: item.name === "default" ? "Default" : item.name }))], [profiles]);

  const runAction = async (job: CronJob, action: "trigger" | "pause" | "resume") => {
    const key = `${action}:${jobProfile(job)}:${job.id}`;
    setActionId(key);
    setError("");
    try {
      const selectedProfile = jobProfile(job);
      if (action === "trigger") await api.triggerCronJob(job.id, selectedProfile);
      if (action === "pause") await api.pauseCronJob(job.id, selectedProfile);
      if (action === "resume") await api.resumeCronJob(job.id, selectedProfile);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionId("");
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setActionId(`delete:${jobProfile(pendingDelete)}:${pendingDelete.id}`);
    try {
      await api.deleteCronJob(pendingDelete.id, jobProfile(pendingDelete));
      setPendingDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setActionId("");
    }
  };

  return (
    <Card data-testid="cron-jobs-panel">
      <ConfirmActionModal
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title="Delete CRON job?"
        body={<span>Delete <strong>{pendingDelete ? jobTitle(pendingDelete) : "this job"}</strong>. This cannot be undone.</span>}
        confirmLabel="Delete"
        riskLevel="medium"
      />
      <CronJobCreateModal
        open={modalOpen}
        profiles={profiles}
        defaultProfile={profile === "all" ? "default" : profile}
        onClose={() => setModalOpen(false)}
        onCreated={() => void load()}
      />

      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 font-expanded uppercase tracking-[0.08em]"><Clock className="h-5 w-5 text-[var(--warm-glow)]" />Scheduled CRON Jobs</CardTitle>
          <CardDescription>Native Mission Control management for scheduled Hermes jobs.</CardDescription>
        </div>
        <Button type="button" onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" />New Job</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 rounded-2xl border border-foreground/10 bg-foreground/[0.025] p-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="text-sm text-muted-foreground" htmlFor="cron-profile-filter">Profile</label>
          <select id="cron-profile-filter" value={profile} onChange={(event) => setProfile(event.target.value)} className="h-10 rounded-2xl border border-border bg-background/50 px-3 text-sm text-foreground">
            {profileOptions.map((item) => <option key={item.name} value={item.name}>{item.label}</option>)}
          </select>
        </div>

        {error && <div className="flex items-center justify-between gap-3 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100"><span>{error}</span><Button type="button" variant="outline" size="sm" onClick={() => void load()}>Retry</Button></div>}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading CRON jobs</div>
        ) : jobs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-foreground/15 bg-foreground/[0.02] p-10 text-center text-sm text-muted-foreground">No CRON jobs yet. Click + New Job to create one.</div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => {
              const paused = jobPaused(job);
              const profileName = jobProfile(job);
              const busyPrefix = `${profileName}:${job.id}`;
              return (
                <article key={`${profileName}:${job.id}`} className="rounded-2xl border border-foreground/10 bg-background/35 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-expanded text-sm uppercase tracking-[0.10em] text-foreground">{jobTitle(job)}</h3>
                        <span className="rounded-full border border-foreground/10 bg-foreground/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{profileName}</span>
                        <StatePill paused={paused} />
                      </div>
                      <p className="text-sm text-muted-foreground">{scheduleLabel(job)}</p>
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        <span>Next run: {formatDate(job.next_run_at)}</span>
                        <span>Last run: {formatDate(job.last_run_at)}</span>
                        {typeof job.run_count === "number" && <span>Runs: {job.run_count}</span>}
                      </div>
                      {job.last_error && <div className="flex items-start gap-2 rounded-xl border border-red-400/20 bg-red-400/[0.06] p-3 text-xs text-red-100"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{job.last_error}</div>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => void runAction(job, "trigger")} disabled={actionId === `trigger:${busyPrefix}`}>
                        {actionId === `trigger:${busyPrefix}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}Trigger now
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => void runAction(job, paused ? "resume" : "pause")} disabled={actionId === `${paused ? "resume" : "pause"}:${busyPrefix}`}>
                        {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}{paused ? "Resume" : "Pause"}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setPendingDelete(job)} className="text-red-200 hover:text-red-100"><Trash2 className="h-3 w-3" />Delete</Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

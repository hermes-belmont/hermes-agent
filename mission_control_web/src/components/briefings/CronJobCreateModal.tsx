import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { CronJob, CronJobCreatePayload, HermesProfile } from "@/lib/types";
import { cn } from "@/lib/utils";

type DeliveryTarget = "local" | "telegram" | "discord";
type RepeatMode = "unlimited" | "count";

const schedulePresets = [
  { label: "Every 15m", value: "*/15 * * * *" },
  { label: "Every 30m", value: "*/30 * * * *" },
  { label: "Every 1h", value: "0 * * * *" },
  { label: "Every 6h", value: "0 */6 * * *" },
  { label: "Daily", value: "0 9 * * *" },
  { label: "Weekly", value: "0 9 * * 1" },
];

function PillButton({ selected, children, onClick }: { selected: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] transition",
        selected
          ? "border-[var(--warm-glow)] bg-[color-mix(in_srgb,var(--warm-glow)_20%,transparent)] text-[var(--warm-glow)]"
          : "border-foreground/10 bg-foreground/[0.03] text-muted-foreground hover:border-foreground/20 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function CronJobCreateModal({
  open,
  profiles,
  defaultProfile,
  onClose,
  onCreated,
}: {
  open: boolean;
  profiles: HermesProfile[];
  defaultProfile: string;
  onClose: () => void;
  onCreated: (job: CronJob) => void;
}) {
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState(schedulePresets[4].value);
  const [prompt, setPrompt] = useState("");
  const [skills, setSkills] = useState("");
  const [deliver, setDeliver] = useState<DeliveryTarget>("local");
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("unlimited");
  const [repeatCount, setRepeatCount] = useState("1");
  const [profile, setProfile] = useState(defaultProfile || "default");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      setProfile(defaultProfile || "default");
      setSubmitError("");
      setErrors({});
    }
  }, [defaultProfile, open]);

  const selectedPreset = useMemo(() => schedulePresets.find((preset) => preset.value === schedule)?.label ?? "", [schedule]);

  if (!open) return null;

  const validate = () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Name is required.";
    if (!schedule.trim()) next.schedule = "Schedule is required.";
    if (!prompt.trim()) next.prompt = "Prompt is required.";
    if (repeatMode === "count" && (!repeatCount || Number(repeatCount) < 1)) next.repeat = "Enter a repeat count of at least 1.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    setSubmitError("");
    if (!validate()) return;
    setCreating(true);
    try {
      const payload: CronJobCreatePayload = {
        name: name.trim(),
        schedule: schedule.trim(),
        prompt: prompt.trim(),
        profile,
        deliver,
        skills: skills.split(",").map((item) => item.trim()).filter(Boolean),
        repeat: repeatMode === "count" ? Number(repeatCount) : null,
      };
      const job = await api.createCronJob(payload);
      onCreated(job);
      setName("");
      setSchedule(schedulePresets[4].value);
      setPrompt("");
      setSkills("");
      setDeliver("local");
      setRepeatMode("unlimited");
      setRepeatCount("1");
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" role="presentation" onMouseDown={() => !creating && onClose()}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[28px] border border-foreground/12 bg-background/95 p-5 shadow-[0_24px_90px_rgba(0,0,0,0.45)]" role="dialog" aria-modal="true" aria-labelledby="cron-create-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-foreground/10 pb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--warm-glow)]">CRON Jobs</p>
            <h2 id="cron-create-title" className="mt-2 font-expanded text-xl uppercase tracking-[0.08em]">Create Job</h2>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={onClose} disabled={creating}><X className="h-4 w-4" /></Button>
        </div>

        <div className="mt-5 grid gap-5">
          {submitError && <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">{submitError}</div>}

          <label className="grid gap-2">
            <span className="text-sm text-muted-foreground">Name</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Daily research summary" autoFocus />
            {errors.name && <span className="text-xs text-red-200">{errors.name}</span>}
          </label>

          <div className="grid gap-2">
            <div>
              <div className="text-sm text-muted-foreground">Schedule</div>
              <p className="text-xs text-muted-foreground/75">Choose a preset or enter a custom schedule string below.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {schedulePresets.map((preset) => <PillButton key={preset.label} selected={selectedPreset === preset.label} onClick={() => setSchedule(preset.value)}>{preset.label}</PillButton>)}
            </div>
          </div>

          <label className="grid gap-2">
            <span className="text-sm text-muted-foreground">Custom schedule</span>
            <Input value={schedule} onChange={(event) => setSchedule(event.target.value)} placeholder="0 9 * * *" />
            <span className="text-xs text-muted-foreground/75">Advanced users can enter cron expressions directly.</span>
            {errors.schedule && <span className="text-xs text-red-200">{errors.schedule}</span>}
          </label>

          <label className="grid gap-2">
            <span className="text-sm text-muted-foreground">Prompt</span>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="What should Hermes Agent do?" rows={5} className="w-full rounded-2xl border border-border bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30" />
            {errors.prompt && <span className="text-xs text-red-200">{errors.prompt}</span>}
          </label>

          <div className="rounded-2xl border border-foreground/10 bg-foreground/[0.025] p-4">
            <div>
              <h3 className="font-expanded text-sm uppercase tracking-[0.10em]">Options</h3>
              <p className="mt-1 text-xs text-muted-foreground">Optional routing and repeat controls.</p>
            </div>
            <div className="mt-4 grid gap-4">
              <label className="grid gap-2">
                <span className="text-sm text-muted-foreground">Profile</span>
                <select value={profile} onChange={(event) => setProfile(event.target.value)} className="h-10 w-full rounded-2xl border border-border bg-background/50 px-3 text-sm text-foreground">
                  {(profiles.length ? profiles : [{ name: "default", path: "", is_default: true, model: null, provider: null, has_env: false, skill_count: 0 }]).map((item) => <option key={item.name} value={item.name}>{item.name === "default" ? "Default" : item.name}</option>)}
                </select>
              </label>

              <label className="grid gap-2">
                <span className="text-sm text-muted-foreground">Skills</span>
                <Input value={skills} onChange={(event) => setSkills(event.target.value)} placeholder="research, writing, synthesis" />
                <span className="text-xs text-muted-foreground/75">Comma-separated for now.</span>
              </label>

              <div className="grid gap-2">
                <span className="text-sm text-muted-foreground">Deliver to</span>
                <div className="flex flex-wrap gap-2">
                  <PillButton selected={deliver === "local"} onClick={() => setDeliver("local")}>Local</PillButton>
                  <PillButton selected={deliver === "telegram"} onClick={() => setDeliver("telegram")}><Zap className="h-3 w-3" />Telegram</PillButton>
                  <PillButton selected={deliver === "discord"} onClick={() => setDeliver("discord")}><Zap className="h-3 w-3" />Discord</PillButton>
                </div>
              </div>

              <div className="grid gap-2">
                <span className="text-sm text-muted-foreground">Repeat</span>
                <div className="flex flex-wrap gap-2">
                  <PillButton selected={repeatMode === "unlimited"} onClick={() => setRepeatMode("unlimited")}>Unlimited</PillButton>
                  <PillButton selected={repeatMode === "count"} onClick={() => setRepeatMode("count")}>Set count</PillButton>
                </div>
                {repeatMode === "count" && <Input type="number" min={1} value={repeatCount} onChange={(event) => setRepeatCount(event.target.value)} className="max-w-[180px]" />}
                {errors.repeat && <span className="text-xs text-red-200">{errors.repeat}</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-foreground/10 pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={creating}>Cancel</Button>
          <Button type="button" onClick={() => void submit()} disabled={creating}>{creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Create</Button>
        </div>
      </div>
    </div>
  );
}

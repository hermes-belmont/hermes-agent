import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { KanbanStatus, KanbanTask } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatStatus, KANBAN_STATUSES, KANBAN_STATUS_TONE } from "@/components/kanban/kanban-style";

const priorities = [
  { label: "Low", value: 0 },
  { label: "Medium", value: 1 },
  { label: "High", value: 2 },
];

export function KanbanTaskCreateModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (task: KanbanTask) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<KanbanStatus>("triage");
  const [priority, setPriority] = useState(1);
  const [assignee, setAssignee] = useState("");
  const [tenant, setTenant] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const resetAndClose = () => {
    setError("");
    onClose();
  };

  const create = async () => {
    if (!title.trim()) { setError("Title is required."); return; }
    setSaving(true);
    setError("");
    try {
      const task = await api.createKanbanTask({ title: title.trim(), body: body || null, status, priority, assignee: assignee || null, tenant: tenant || null, workspace_kind: "scratch" });
      onCreated(task);
      setTitle(""); setBody(""); setStatus("triage"); setPriority(1); setAssignee(""); setTenant("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) resetAndClose(); }}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[28px] border border-foreground/10 bg-background/96 p-6 shadow-2xl" role="dialog" aria-modal="true" aria-label="New Task">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--warm-glow)]">Kanban</p>
            <h2 className="mt-2 font-expanded text-2xl uppercase tracking-[0.08em]">New Task</h2>
            <p className="mt-2 text-sm text-muted-foreground">Create a native Kanban task on the default board.</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={resetAndClose} aria-label="Close new task modal"><X className="h-4 w-4" /></Button>
        </div>
        <div className="mt-6 grid gap-4">
          <label className="text-sm text-foreground/80">Title<Input className="mt-1" required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Form Umbrella Media operating agreement" /></label>
          <label className="text-sm text-foreground/80">Description<textarea className="mt-1 min-h-28 w-full rounded-2xl border border-foreground/10 bg-background px-3 py-2 text-sm outline-none focus:border-[var(--warm-glow)]/60" value={body} onChange={(event) => setBody(event.target.value)} placeholder="What needs to happen?" /></label>
          <div>
            <p className="text-sm text-foreground/80">Status</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{KANBAN_STATUSES.map((item) => <button key={item} type="button" onClick={() => setStatus(item)} className={cn("rounded-full border px-3 py-2 text-xs uppercase tracking-[0.12em] transition", status === item ? KANBAN_STATUS_TONE[item] : "border-foreground/10 bg-foreground/[0.03] text-muted-foreground hover:text-foreground")}>{formatStatus(item)}</button>)}</div>
          </div>
          <div>
            <p className="text-sm text-foreground/80">Priority</p>
            <div className="mt-2 flex flex-wrap gap-2">{priorities.map((item) => <button key={item.value} type="button" onClick={() => setPriority(item.value)} className={cn("rounded-full border px-3 py-2 text-xs uppercase tracking-[0.12em] transition", priority === item.value ? "border-[var(--warm-glow)] bg-[var(--warm-glow)]/15 text-[var(--warm-glow)]" : "border-foreground/10 bg-foreground/[0.03] text-muted-foreground hover:text-foreground")}>{item.label}</button>)}</div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm text-foreground/80">Assignee<Input className="mt-1" value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="Profile name or @worker" /></label>
            <label className="text-sm text-foreground/80">Workspace<Input className="mt-1" value={tenant} onChange={(event) => setTenant(event.target.value)} placeholder="default" /><span className="mt-1 block text-xs text-muted-foreground">Tenant or workspace identifier. Leave blank for default.</span></label>
          </div>
          {error ? <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</div> : null}
          <div className="flex justify-end gap-3 pt-2"><Button type="button" variant="outline" onClick={resetAndClose}>Cancel</Button><Button type="button" onClick={create} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Create</Button></div>
        </div>
      </div>
    </div>
  );
}

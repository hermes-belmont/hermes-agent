import { useEffect, useMemo, useState } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { api } from "@/lib/api";
import type { KanbanStatus, KanbanTask } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatStatus, formatUnix, KANBAN_STATUSES, KANBAN_STATUS_TONE, priorityLabel } from "@/components/kanban/kanban-style";

export function KanbanTaskDrawer({ task, open, onClose, onSaved, onDeleted }: { task: KanbanTask | null; open: boolean; onClose: () => void; onSaved: (task: KanbanTask) => void; onDeleted: (taskId: string) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<KanbanStatus>("triage");
  const [priority, setPriority] = useState(0);
  const [assignee, setAssignee] = useState("");
  const [tenant, setTenant] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setBody(task.body ?? "");
    setStatus(task.status);
    setPriority(task.priority ?? 0);
    setAssignee(task.assignee ?? "");
    setTenant(task.tenant ?? "");
    setError("");
  }, [task]);

  const hasTask = Boolean(task);
  const priorityOptions = useMemo(() => [{ label: "Low", value: 0 }, { label: "Medium", value: 1 }, { label: "High", value: 2 }], []);
  if (!open || !task) return null;

  const save = async () => {
    if (!title.trim()) { setError("Title is required."); return; }
    setSaving(true);
    setError("");
    try {
      const updated = await api.updateKanbanTask(task.id, { title: title.trim(), body: body || null, status, priority, assignee: assignee || null });
      onSaved({ ...updated, tenant: tenant || updated.tenant });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save task");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} />
      <aside className="fixed right-0 top-0 z-50 h-full w-full max-w-xl overflow-y-auto border-l border-foreground/10 bg-background/96 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--warm-glow)]">Kanban Task</p>
            <h2 className="mt-2 font-expanded text-2xl uppercase tracking-[0.08em]">Task Detail</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close task drawer"><X className="h-4 w-4" /></Button>
        </div>

        <div className="mt-6 grid gap-4">
          <label className="text-sm text-foreground/80">Title<Input className="mt-1" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="text-sm text-foreground/80">Description<textarea className="mt-1 min-h-32 w-full rounded-2xl border border-foreground/10 bg-background px-3 py-2 text-sm outline-none focus:border-[var(--warm-glow)]/60" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Markdown supported." /></label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm text-foreground/80">Status<select className="mt-1 w-full rounded-2xl border border-foreground/10 bg-background px-3 py-2" value={status} onChange={(event) => setStatus(event.target.value as KanbanStatus)}>{KANBAN_STATUSES.map((item) => <option key={item} value={item}>{formatStatus(item)}</option>)}</select></label>
            <label className="text-sm text-foreground/80">Priority<select className="mt-1 w-full rounded-2xl border border-foreground/10 bg-background px-3 py-2" value={priority} onChange={(event) => setPriority(Number(event.target.value))}>{priorityOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label className="text-sm text-foreground/80">Assignee<Input className="mt-1" value={assignee} onChange={(event) => setAssignee(event.target.value)} /></label>
            <label className="text-sm text-foreground/80">Tenant / workspace<Input className="mt-1" value={tenant} onChange={(event) => setTenant(event.target.value)} disabled /></label>
          </div>
          <div className="grid gap-2 rounded-2xl border border-foreground/10 bg-foreground/[0.025] p-4 text-xs text-muted-foreground">
            <div className="flex justify-between gap-3"><span>ID</span><span className="font-mono text-foreground/70">{task.id}</span></div>
            <div className="flex justify-between gap-3"><span>Created</span><span>{formatUnix(task.created_at)}</span></div>
            <div className="flex justify-between gap-3"><span>Started</span><span>{formatUnix(task.started_at)}</span></div>
            <div className="flex justify-between gap-3"><span>Completed</span><span>{formatUnix(task.completed_at)}</span></div>
            <div className="flex justify-between gap-3"><span>Status tone</span><span className={cn("rounded-full border px-2 py-0.5", KANBAN_STATUS_TONE[status])}>{formatStatus(status)}</span></div>
            <div className="flex justify-between gap-3"><span>Priority</span><span>{priorityLabel(priority)}</span></div>
          </div>
          {error ? <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</div> : null}
          <div className="flex flex-wrap justify-between gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)} disabled={!hasTask}><Trash2 className="h-4 w-4" />Delete</Button>
            <div className="flex gap-3"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save</Button></div>
          </div>
        </div>
      </aside>
      <ConfirmActionModal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete Kanban task" body={<span>Delete <strong>{task.title}</strong>? This removes the task from the board.</span>} confirmLabel="Delete" riskLevel="medium" onConfirm={async () => { await api.deleteKanbanTask(task.id); setConfirmDelete(false); onDeleted(task.id); onClose(); }} />
    </>
  );
}

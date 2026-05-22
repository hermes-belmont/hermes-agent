import type { KanbanStatus } from "@/lib/types";

export const KANBAN_STATUSES: KanbanStatus[] = ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done"];

export const KANBAN_STATUS_LABEL: Record<KanbanStatus, string> = {
  triage: "Triage",
  todo: "Todo",
  scheduled: "Scheduled",
  ready: "Ready",
  running: "Running",
  blocked: "Blocked",
  review: "Review",
  done: "Done",
};

export const KANBAN_STATUS_TONE: Record<KanbanStatus, string> = {
  triage: "border-slate-400/25 bg-slate-400/10 text-slate-200",
  todo: "border-cyan-400/25 bg-cyan-400/10 text-cyan-100",
  scheduled: "border-sky-400/25 bg-sky-400/10 text-sky-100",
  ready: "border-teal-400/25 bg-teal-400/10 text-teal-100",
  running: "border-amber-400/30 bg-amber-400/12 text-amber-100",
  blocked: "border-orange-400/30 bg-red-500/10 text-orange-100",
  review: "border-violet-400/30 bg-violet-400/10 text-violet-100",
  done: "border-emerald-400/25 bg-emerald-400/10 text-emerald-100",
};

export function formatStatus(status: KanbanStatus | string) {
  return KANBAN_STATUS_LABEL[status as KanbanStatus] ?? status.replace(/_/g, " ");
}

export function priorityLabel(priority?: number | null) {
  if ((priority ?? 0) >= 2) return "High";
  if ((priority ?? 0) === 1) return "Medium";
  return "Low";
}

export function priorityTone(priority?: number | null) {
  if ((priority ?? 0) >= 2) return "border-red-400/30 bg-red-400/10 text-red-100";
  if ((priority ?? 0) === 1) return "border-amber-400/30 bg-amber-400/10 text-amber-100";
  return "border-emerald-400/25 bg-emerald-400/10 text-emerald-100";
}

export function formatUnix(value?: number | null) {
  if (!value) return "None";
  return new Date(value * 1000).toLocaleString();
}

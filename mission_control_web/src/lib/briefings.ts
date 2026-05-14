import type { Briefing, BriefingRunStatus } from "@/lib/types";

export type BriefingPriority = "low" | "medium" | "high";

export function briefingPriorityTone(priority: string | undefined): BriefingPriority {
  return priority === "high" || priority === "medium" || priority === "low" ? priority : "medium";
}

export function briefingDateLabel(id: string, now = new Date()): string {
  const [year, month, day] = id.split("-").map((part) => Number(part));
  if (!year || !month || !day) return id;
  const date = new Date(Date.UTC(year, month - 1, day));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const diffDays = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function formatBriefingTime(value?: string | null): string {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function summarizeRunProgress(labels: string[], status: BriefingRunStatus | null): Array<{ label: string; status: "pending" | "ok" | "timeout" | "error" }> {
  return labels.map((label) => {
    const found = status?.agents?.find((item) => item.label === label);
    const raw = found?.status;
    const normalized = raw === "ok" || raw === "timeout" || raw === "error" ? raw : "pending";
    return { label, status: normalized };
  });
}

export function agentItemCount(briefing: Briefing, label: string): number {
  return briefing.agents.find((agent) => agent.label === label)?.parsed_items.length ?? 0;
}

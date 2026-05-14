import type { AgentRecord, MessageRecord, MessageStatus, MessageViewMode } from "@/lib/types";

export const SELECTED_AGENT_STORAGE_KEY = "mc.inbox.selectedAgentId.v1";
export const VIEW_MODE_STORAGE_KEY = "mc.inbox.viewMode.v1";

export type StatusFilter = "all" | MessageStatus;
export type PriorityFilter = "all" | "high" | "normal" | "low";

export function agentLabel(agentMap: Map<string, AgentRecord>, agentId?: string | null): string {
  if (!agentId) return "Unknown agent";
  return agentMap.get(agentId)?.name ?? agentId;
}

export function entityTag(agent: AgentRecord): string {
  return agent.operating_entity || agent.team_grouping || agent.business_function || "Unassigned entity";
}

export function sortAgentsForInbox(agents: AgentRecord[], unreadCounts: Record<string, number>): AgentRecord[] {
  return [...agents].sort((a, b) => {
    const unreadDelta = (unreadCounts[b.id] ?? 0) - (unreadCounts[a.id] ?? 0);
    if (unreadDelta !== 0) return unreadDelta;
    return a.name.localeCompare(b.name);
  });
}

export function totalUnread(unreadCounts: Record<string, number>): number {
  return Object.values(unreadCounts).reduce((sum, count) => sum + (Number(count) || 0), 0);
}

export function getStoredInboxViewMode(storage: Pick<Storage, "getItem"> = window.localStorage): MessageViewMode {
  const stored = storage.getItem(VIEW_MODE_STORAGE_KEY);
  return stored === "sent" ? "sent" : "inbox";
}

export function getStoredInboxAgentId(agents: AgentRecord[], unreadCounts: Record<string, number>, storage: Pick<Storage, "getItem"> = window.localStorage): string | null {
  const stored = storage.getItem(SELECTED_AGENT_STORAGE_KEY);
  if (stored && agents.some((agent) => agent.id === stored)) return stored;
  return sortAgentsForInbox(agents, unreadCounts)[0]?.id ?? null;
}

export function filterMessages(messages: MessageRecord[], statusFilter: StatusFilter, priorityFilter: PriorityFilter): MessageRecord[] {
  return messages.filter((message) => {
    const statusOk = statusFilter === "all" || message.status === statusFilter;
    const priorityOk = priorityFilter === "all" || message.priority === priorityFilter;
    return statusOk && priorityOk;
  });
}

export function threadCounts(messages: MessageRecord[]): Record<string, number> {
  return messages.reduce<Record<string, number>>((acc, message) => {
    acc[message.thread_id] = (acc[message.thread_id] ?? 0) + 1;
    return acc;
  }, {});
}

export function messageRelativeTime(value?: string | null, now = Date.now()): string {
  if (!value) return "Unknown";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Unknown";
  const delta = now - timestamp;
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days <= 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(timestamp));
}

export function messageAbsoluteTime(value?: string | null): string {
  if (!value) return "Unknown";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}

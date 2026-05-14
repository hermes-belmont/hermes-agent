import type { AgentRecord, TrackedItem, TrackedItemDraft, TrackedItemStatus } from "@/lib/types";

export type TrackingDraft = TrackedItemDraft & { description?: string | null; tagsText?: string; notes?: string | null; entity?: TrackedItem["entity"]; category?: TrackedItem["category"]; due_date?: string | null; recurrence?: TrackedItem["recurrence"]; priority?: TrackedItem["priority"]; status?: TrackedItemStatus };

export const LAST_USED_AGENT_STORAGE_KEY = "mc.tracking.lastUsedAgent.v1";

export function entityForAgent(agent?: Pick<AgentRecord, "name" | "business_function"> | null): TrackedItem["entity"] {
  const text = `${agent?.name ?? ""} ${agent?.business_function ?? ""}`.toLowerCase();
  if (text.includes("custom")) return "customs";
  if (text.includes("media")) return "media";
  if (text.includes("propert")) return "properties";
  if (text.includes("financial") || text.includes("holding")) return "holdings";
  return null;
}

export function resolveDefaultAgentForAdd(agents: Pick<AgentRecord, "id">[], storage: Pick<Storage, "getItem"> | null | undefined = typeof window !== "undefined" ? window.localStorage : null) {
  const stored = storage?.getItem(LAST_USED_AGENT_STORAGE_KEY) ?? "";
  return agents.some((agent) => agent.id === stored) ? stored : "";
}

export function buildEmptyTrackingDraft(agents: Pick<AgentRecord, "id" | "name" | "business_function">[], agentId: string | null | undefined = ""): TrackingDraft {
  const agent = agents.find((a) => a.id === agentId);
  return { agent_id: agent?.id ?? "", title: "", category: "watch", priority: "medium", status: "active", source: "manual", entity: entityForAgent(agent), tagsText: "" };
}

export function isTrackingDraftSavable(draft: Pick<TrackingDraft, "agent_id" | "title">) {
  return Boolean(draft.agent_id && draft.title.trim());
}

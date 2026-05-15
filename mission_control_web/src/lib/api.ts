import type { BackupResult, DestructiveMaintenanceResult, DoctorResult, DumpResult, GitCommitOption, HealthCheckResult, MaintenanceVersion, UpdateCheckResult } from "@/lib/maintenance";
import type { SystemMetrics } from "@/lib/system-metrics";
import type { UserBackground } from "@/lib/backgrounds";
import type { ThemeOption } from "@/lib/themes";
import type { AccountRecord, AgentRecord, TailscaleStatus, BootstrapResponse, HermesProfile, Briefing, BriefingConfig, BriefingListItem, BriefingRunStatus, ConversationMessage, EntityRecord, MessagePage, MessageRecord, ReactiveSweep, ReactiveSweepStats, TrackedItem, TrackedItemDraft, UnreadCounts } from "@/lib/types";

declare global {
  interface Window {
    __HERMES_SESSION_TOKEN__?: string;
  }
}

async function getSessionToken(): Promise<string | undefined> {
  if (window.__HERMES_SESSION_TOKEN__) {
    return window.__HERMES_SESSION_TOKEN__;
  }

  try {
    const response = await fetch("/__hermes/session-token", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return undefined;
    }

    const payload = await response.json() as { token?: string };
    if (payload.token) {
      window.__HERMES_SESSION_TOKEN__ = payload.token;
    }
    return payload.token;
  } catch {
    return undefined;
  }
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = await getSessionToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(url, { ...init, headers });
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`${response.status}: ${text}`);
  }
  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "Unexpected response body");
    throw new Error(`Unexpected content type for ${url}: ${contentType || "unknown"} ${text.slice(0, 160)}`);
  }
  return response.json() as Promise<T>;
}

async function fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = await getSessionToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(url, { ...init, headers });
}

function filenameFromDisposition(disposition: string | null): string {
  const match = /filename="?([^";]+)"?/i.exec(disposition ?? "");
  return match?.[1] ?? `mission-control-export-${new Date().toISOString().slice(0, 10)}.json`;
}

export const api = {
  getBootstrap: () => fetchJSON<BootstrapResponse>("/api/mission-control/bootstrap"),
  getAccount: () => fetchJSON<AccountRecord>("/api/account"),
  getAgentProfiles: () => fetchJSON<{ profiles: HermesProfile[]; error?: string }>("/api/agent-profiles"),
  updateAccount: (patch: Partial<Omit<AccountRecord, "preferences">> & { preferences?: Partial<AccountRecord["preferences"]> }) => fetchJSON<AccountRecord>("/api/account", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }),
  downloadAccountExport: async (expectations?: { accept: "application/json"; disposition: "attachment" }) => {
    void expectations;
    const response = await fetchWithAuth("/api/account/export", { headers: { Accept: "application/json" } });
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`${response.status}: ${text}`);
    }
    const blob = await response.blob();
    const filename = filenameFromDisposition(response.headers.get("content-disposition"));
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return filename;
  },
  listEntities: () => fetchJSON<EntityRecord[]>("/api/entities"),
  getEntityTree: () => fetchJSON<EntityRecord[]>("/api/entities/tree"),
  createEntity: (entity: Partial<EntityRecord>) => fetchJSON<EntityRecord>("/api/entities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entity) }),
  updateEntity: (id: string, patch: Partial<EntityRecord>) => fetchJSON<EntityRecord>(`/api/entities/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }),
  moveEntity: (id: string, parent_id: string | null) => fetchJSON<EntityRecord>(`/api/entities/${encodeURIComponent(id)}/move`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parent_id }) }),
  deleteEntity: (id: string) => fetchJSON<{ ok: boolean; entity: EntityRecord }>(`/api/entities/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listAgents: (includeDeleted = false) => fetchJSON<AgentRecord[]>(`/api/agents${includeDeleted ? "?include_deleted=true" : ""}`),
  createAgentPublic: (agent: Partial<AgentRecord>) => fetchJSON<AgentRecord>("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(agent) }),
  updateAgentPublic: (id: string, patch: Partial<AgentRecord>) => fetchJSON<AgentRecord>(`/api/agents/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }),
  moveAgent: (id: string, entity_id: string) => fetchJSON<AgentRecord>(`/api/agents/${encodeURIComponent(id)}/move`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity_id }) }),
  reorderAgent: (id: string, display_order: number) => fetchJSON<AgentRecord>(`/api/agents/${encodeURIComponent(id)}/reorder`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ display_order }) }),
  duplicateAgent: (id: string) => fetchJSON<AgentRecord>(`/api/agents/${encodeURIComponent(id)}/duplicate`, { method: "POST" }),
  deleteAgentPublic: (id: string) => fetchJSON<{ ok: boolean; agent: AgentRecord & { purges_in_days?: number } }>(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  restoreAgent: (id: string) => fetchJSON<AgentRecord>(`/api/agents/${encodeURIComponent(id)}/restore`, { method: "POST" }),
  listTrashAgents: () => fetchJSON<Array<AgentRecord & { purges_in_days?: number }>>("/api/agents/trash"),
  getSystemMetrics: () => fetchJSON<SystemMetrics>("/api/system/metrics"),
  getTailscaleStatus: () => fetchJSON<TailscaleStatus>("/api/system/tailscale-status"),
  getReactiveSweepStats: () => fetchJSON<ReactiveSweepStats>("/api/reactive-sweeps/stats"),
  listReactiveSweeps: (agentId: string, limit = 50) => fetchJSON<ReactiveSweep[]>(`/api/reactive-sweeps/${encodeURIComponent(agentId)}?limit=${encodeURIComponent(String(limit))}`),
  getMaintenanceVersion: () => fetchJSON<MaintenanceVersion>("/api/maintenance/version"),
  runMaintenanceHealthCheck: () => fetchJSON<HealthCheckResult>("/api/maintenance/health-check", { method: "POST" }),
  checkMaintenanceUpdates: () => fetchJSON<UpdateCheckResult>("/api/maintenance/check-updates", { method: "POST" }),
  runMaintenanceDoctor: () => fetchJSON<DoctorResult>("/api/maintenance/doctor", { method: "POST" }),
  generateMaintenanceDump: () => fetchJSON<DumpResult>("/api/maintenance/dump", { method: "POST" }),
  createMaintenanceBackup: () => fetchJSON<BackupResult>("/api/maintenance/backup", { method: "POST" }),
  restartMissionControl: () => fetchJSON<DestructiveMaintenanceResult>("/api/maintenance/restart-hci", { method: "POST" }),
  updateAllMaintenance: () => fetchJSON<DestructiveMaintenanceResult>("/api/maintenance/update-all", { method: "POST" }),
  rollbackMaintenance: (target_commit?: string) => fetchJSON<DestructiveMaintenanceResult>("/api/maintenance/rollback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_commit }),
  }),
  autoFixMaintenance: () => fetchJSON<DestructiveMaintenanceResult>("/api/maintenance/auto-fix", { method: "POST" }),
  updateHermesMaintenance: () => fetchJSON<DestructiveMaintenanceResult>("/api/maintenance/update-hermes", { method: "POST" }),
  importMaintenanceBackup: (file: File, confirm_phrase: string) => {
    const body = new FormData();
    body.set("file", file);
    body.set("confirm_phrase", confirm_phrase);
    return fetchJSON<DestructiveMaintenanceResult>("/api/maintenance/import", { method: "POST", body });
  },
  getMissionControlCommits: () => fetchJSON<{ ok: boolean; commits: GitCommitOption[]; error?: string }>("/api/mission-control/commits?limit=10"),
  runBriefingSweep: () => fetchJSON<Briefing>("/api/briefings/run", { method: "POST" }),
  getBriefingRunStatus: () => fetchJSON<BriefingRunStatus>("/api/briefings/run/status"),
  listBriefings: () => fetchJSON<BriefingListItem[]>("/api/briefings"),
  getBriefing: (id: string) => fetchJSON<Briefing>(`/api/briefings/${encodeURIComponent(id)}`),
  deleteBriefing: (id: string) => fetchJSON<{ ok: boolean }>(`/api/briefings/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getBriefingsConfig: () => fetchJSON<BriefingConfig>("/api/briefings/config"),
  listTrackedItems: (filters: Record<string, string | undefined> = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value && value !== "all") params.set(key, value); });
    return fetchJSON<TrackedItem[]>(`/api/tracked-items${params.toString() ? `?${params}` : ""}`);
  },
  getTrackedItemsByAgent: (agentId: string) => fetchJSON<TrackedItem[]>(`/api/tracked-items/by-agent/${encodeURIComponent(agentId)}`),
  createTrackedItem: (item: TrackedItemDraft) => fetchJSON<TrackedItem>("/api/tracked-items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) }),
  updateTrackedItem: (id: string, patch: Partial<TrackedItem>) => fetchJSON<TrackedItem>(`/api/tracked-items/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }),
  deleteTrackedItem: (id: string) => fetchJSON<{ ok: boolean }>(`/api/tracked-items/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getUnreadCounts: () => fetchJSON<UnreadCounts>("/api/messages/unread-counts"),
  listInboxMessages: (agentId: string, params: { status?: string; limit?: number; before?: string; thread_id?: string } = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => { if (typeof value !== "undefined" && value !== "") query.set(key, String(value)); });
    return fetchJSON<MessagePage>(`/api/messages/inbox/${encodeURIComponent(agentId)}${query.toString() ? `?${query}` : ""}`);
  },
  listSentMessages: (agentId: string, params: { status?: string; limit?: number; before?: string; thread_id?: string } = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => { if (typeof value !== "undefined" && value !== "") query.set(key, String(value)); });
    return fetchJSON<MessagePage>(`/api/messages/sent/${encodeURIComponent(agentId)}${query.toString() ? `?${query}` : ""}`);
  },
  getMessage: (messageId: string, agentId: string) => fetchJSON<MessageRecord>(`/api/messages/${encodeURIComponent(messageId)}?agent_id=${encodeURIComponent(agentId)}`),
  getMessageThread: (threadId: string, agentId: string) => fetchJSON<MessagePage>(`/api/messages/thread/${encodeURIComponent(threadId)}?agent_id=${encodeURIComponent(agentId)}&status=all&limit=200`),
  markMessageRead: (messageId: string, agentId: string) => fetchJSON<MessageRecord>(`/api/messages/${encodeURIComponent(messageId)}/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: agentId }) }),
  archiveMessage: (messageId: string, agentId: string) => fetchJSON<MessageRecord>(`/api/messages/${encodeURIComponent(messageId)}/archive`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: agentId }) }),
  deleteMessage: (messageId: string, agentId: string) => fetchJSON<{ ok: boolean }>(`/api/messages/${encodeURIComponent(messageId)}?agent_id=${encodeURIComponent(agentId)}`, { method: "DELETE" }),
  actOnTrackedItem: (id: string, action: "snooze" | "done" | "dismiss" | "reactivate") => fetchJSON<TrackedItem>(`/api/tracked-items/${encodeURIComponent(id)}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }),
  updateBriefingsConfig: (config: Partial<BriefingConfig>) => fetchJSON<BriefingConfig>("/api/briefings/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  }),
  getUserBackgrounds: () => fetchJSON<UserBackground[]>("/api/user-content/backgrounds"),
  uploadUserBackground: async (file: File) => {
    const body = new FormData();
    body.set("file", file);
    return fetchJSON<UserBackground>("/api/user-content/backgrounds", { method: "POST", body });
  },
  deleteUserBackground: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/user-content/backgrounds/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getConversationMessages: (conversationId: string) =>
    fetchJSON<{ conversation_id: string; messages: ConversationMessage[] }>(`/api/mission-control/conversations/${encodeURIComponent(conversationId)}/messages`),
  createConversation: (agentId: string, title?: string, projectId?: string | null) =>
    fetchJSON<{ conversation: { id: string; agent_id: string; title: string; project_id?: string | null } }>("/api/mission-control/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId, title, project_id: projectId ?? null }),
    }),
  updateConversation: (conversationId: string, patch: { title?: string; pinned?: boolean; starred?: boolean; agent_id?: string; project_id?: string | null; projectId?: string | null }) =>
    fetchJSON<{ conversation: { id: string; title: string; pinned: boolean; starred?: boolean; project_id?: string | null } }>(`/api/mission-control/conversations/${encodeURIComponent(conversationId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  deleteConversation: (conversationId: string) =>
    fetchJSON<{ ok: boolean }>(`/api/mission-control/conversations/${encodeURIComponent(conversationId)}`, {
      method: "DELETE",
    }),
  sendChatStream: async (
    body: { agent_id: string; conversation_id: string; message: { role: "user"; content: string } },
    handlers: { onDelta?: (text: string) => void; onStatus?: (status: string) => void } = {},
  ): Promise<{
    conversation_id: string;
    session_id: string;
    reply: { role: string; content: string };
    conversation: { id: string; title: string };
    agent: AgentRecord;
    summary: BootstrapResponse["summary"];
  }> => {
    const headers = new Headers({ "Content-Type": "application/json" });
    const token = await getSessionToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch("/api/mission-control/chat/stream", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`${response.status}: ${text}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult: {
      conversation_id: string;
      session_id: string;
      reply: { role: string; content: string };
      conversation: { id: string; title: string };
      agent: AgentRecord;
      summary: BootstrapResponse["summary"];
    } | null = null;

    const flushBlock = (rawBlock: string) => {
      const block = rawBlock.trim();
      if (!block) return;

      const lines = block.split("\n");
      let event = "message";
      const dataLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }

      const rawData = dataLines.join("\n");
      if (!rawData) return;

      let payload: unknown = rawData;
      try {
        payload = JSON.parse(rawData);
      } catch {
        payload = rawData;
      }

      if (event === "delta") {
        const text = typeof payload === "string" ? payload : (payload as { text?: string })?.text ?? "";
        if (text) handlers.onDelta?.(text);
        return;
      }

      if (event === "status") {
        const status = typeof payload === "string" ? payload : (payload as { status?: string })?.status ?? "";
        if (status) handlers.onStatus?.(status);
        return;
      }

      if (event === "done") {
        finalResult = payload as typeof finalResult;
        return;
      }

      if (event === "error") {
        const message = typeof payload === "string"
          ? payload
          : (payload as { detail?: string; message?: string })?.detail
            ?? (payload as { detail?: string; message?: string })?.message
            ?? "stream error";
        throw new Error(message);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx = buffer.indexOf("\n\n");
      while (idx >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        flushBlock(block);
        idx = buffer.indexOf("\n\n");
      }
    }

    if (buffer.trim()) {
      flushBlock(buffer);
    }

    if (!finalResult) {
      throw new Error("Stream ended without completion event");
    }
    return finalResult;
  },
  createAgent: (seed: Partial<AgentRecord>) =>
    fetchJSON<{ agent: AgentRecord }>("/api/mission-control/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed }),
    }),
  getDashboardThemes: () => fetchJSON<{ themes: ThemeOption[]; active: string }>("/api/dashboard/themes"),
  setDashboardTheme: (name: string) =>
    fetchJSON<{ ok?: boolean; active?: string }>("/api/dashboard/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  updateAgent: (agentId: string, agent: Partial<AgentRecord>) =>
    fetchJSON<{ agent: AgentRecord }>(`/api/mission-control/agents/${encodeURIComponent(agentId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent }),
    }),
  deleteAgent: (agentId: string) =>
    fetchJSON<{ ok: boolean }>(`/api/mission-control/agents/${encodeURIComponent(agentId)}`, {
      method: "DELETE",
    }),
};

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArrowLeft, Inbox, MailOpen, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { AgentRecord, MessagePriority, MessageRecord, MessageStatus, MessageViewMode, TrackedItem, UnreadCounts } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn, titleCase } from "@/lib/utils";
import {
  SELECTED_AGENT_STORAGE_KEY,
  VIEW_MODE_STORAGE_KEY,
  agentLabel,
  entityTag,
  filterMessages,
  getStoredInboxAgentId,
  getStoredInboxViewMode,
  messageAbsoluteTime,
  messageRelativeTime,
  sortAgentsForInbox,
  threadCounts,
  totalUnread,
  type PriorityFilter,
  type StatusFilter,
} from "@/lib/messages";

type Props = { agents: AgentRecord[]; initialSelectedAgentId?: string | null; initialSelectedMessage?: MessageRecord | null };
type MobilePane = "agents" | "messages" | "detail";

const statusOptions: Array<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "sent", label: "Sent" },
  { id: "read", label: "Read" },
  { id: "archived", label: "Archived" },
];
const priorityOptions: PriorityFilter[] = ["all", "high", "normal", "low"];

function Pill({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "warm" | "high" | "normal" | "low" | "muted" | "neutral"; className?: string }) {
  const cls = tone === "warm"
    ? "border-[color-mix(in_srgb,var(--warm-glow)_38%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_12%,transparent)] text-[var(--warm-glow)]"
    : tone === "high"
      ? "border-red-400/35 bg-red-400/10 text-red-100"
      : tone === "low"
        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
        : tone === "muted"
          ? "border-foreground/8 bg-foreground/[0.03] text-muted-foreground/70"
          : "border-foreground/10 bg-foreground/[0.04] text-muted-foreground";
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]", cls, className)}>{children}</span>;
}

function priorityTone(priority: MessagePriority): "high" | "normal" | "low" { return priority; }
function statusLabel(status: MessageStatus) { return status === "sent" ? "Unread" : titleCase(status); }
function statusTone(status: MessageStatus): "warm" | "muted" | "neutral" { return status === "sent" ? "warm" : status === "archived" ? "muted" : "neutral"; }

export function InboxView({ agents, initialSelectedAgentId = null, initialSelectedMessage = null }: Props) {
  const [unreadCounts, setUnreadCounts] = useState<UnreadCounts>({});
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(initialSelectedAgentId);
  const [viewMode, setViewMode] = useState<MessageViewMode>(() => getStoredInboxViewMode());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [messages, setMessages] = useState<MessageRecord[]>(initialSelectedMessage ? [initialSelectedMessage] : []);
  const [selectedMessage, setSelectedMessage] = useState<MessageRecord | null>(initialSelectedMessage);
  const [threadMessages, setThreadMessages] = useState<MessageRecord[]>([]);
  const [trackedItems, setTrackedItems] = useState<TrackedItem[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState("");
  const [mobilePane, setMobilePane] = useState<MobilePane>("agents");
  const [deleteTarget, setDeleteTarget] = useState<MessageRecord | null>(null);

  const agentMap = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const selectedAgent = selectedAgentId ? agentMap.get(selectedAgentId) ?? null : null;
  const sortedAgents = useMemo(() => sortAgentsForInbox(agents, unreadCounts), [agents, unreadCounts]);
  const unreadTotal = totalUnread(unreadCounts);
  const visibleMessages = useMemo(() => filterMessages(messages, statusFilter, priorityFilter), [messages, statusFilter, priorityFilter]);
  const countsByThread = useMemo(() => threadCounts(messages), [messages]);
  const trackedMap = useMemo(() => new Map(trackedItems.map((item) => [item.id, item])), [trackedItems]);

  const refreshUnreadCounts = useCallback(async () => {
    const counts = await api.getUnreadCounts();
    setUnreadCounts(counts);
    setSelectedAgentId((current) => current ?? getStoredInboxAgentId(agents, counts));
  }, [agents]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshUnreadCounts(); }, [refreshUnreadCounts]);

  useEffect(() => {
    const onVisibility = () => { if (!document.hidden) void refreshUnreadCounts(); };
    document.addEventListener("visibilitychange", onVisibility);
    const id = window.setInterval(() => { if (!document.hidden) void refreshUnreadCounts(); }, 60000);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVisibility); };
  }, [refreshUnreadCounts]);

  useEffect(() => {
    try { if (selectedAgentId) window.localStorage.setItem(SELECTED_AGENT_STORAGE_KEY, selectedAgentId); } catch { /* ignore */ }
  }, [selectedAgentId]);

  useEffect(() => {
    try { window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode); } catch { /* ignore */ }
  }, [viewMode]);

  useEffect(() => { void api.listTrackedItems().then(setTrackedItems).catch(() => setTrackedItems([])); }, []);

  const loadMessages = useCallback(async (agentId: string, mode: MessageViewMode) => {
    setLoadingMessages(true);
    setError("");
    try {
      const page = mode === "sent"
        ? await api.listSentMessages(agentId, { status: "all", limit: 200 })
        : await api.listInboxMessages(agentId, { status: "all", limit: 200 });
      setMessages(page.messages);
      setSelectedMessage(null);
      setThreadMessages([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load messages");
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedAgentId) void loadMessages(selectedAgentId, viewMode);
  }, [loadMessages, selectedAgentId, viewMode]);

  const openMessage = async (message: MessageRecord, nextPane: MobilePane = "detail") => {
    if (!selectedAgentId) return;
    setMobilePane(nextPane);
    setSelectedMessage(message);
    setError("");
    try {
      const fresh = await api.getMessage(message.id, selectedAgentId);
      setSelectedMessage(fresh);
      const thread = await api.getMessageThread(fresh.thread_id, selectedAgentId);
      setThreadMessages(thread.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load message detail");
    }
  };

  useEffect(() => {
    if (!selectedMessage || selectedMessage.status !== "sent" || selectedMessage.to_agent_id !== selectedAgentId || !selectedAgentId) return;
    const messageId = selectedMessage.id;
    const agentId = selectedAgentId;
    const timer = window.setTimeout(() => {
      const previousCounts = unreadCounts;
      setMessages((rows) => rows.map((row) => row.id === messageId ? { ...row, status: "read", read_at: new Date().toISOString() } : row));
      setSelectedMessage((current) => current?.id === messageId ? { ...current, status: "read", read_at: new Date().toISOString() } : current);
      setUnreadCounts((counts) => ({ ...counts, [agentId]: Math.max(0, (counts[agentId] ?? 0) - 1) }));
      api.markMessageRead(messageId, agentId)
        .then((updated) => {
          setMessages((rows) => rows.map((row) => row.id === messageId ? updated : row));
          setSelectedMessage((current) => current?.id === messageId ? updated : current);
          return refreshUnreadCounts();
        })
        .catch(() => setUnreadCounts(previousCounts));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [refreshUnreadCounts, selectedAgentId, selectedMessage, unreadCounts]);

  const selectAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
    setMobilePane("messages");
  };

  const archiveSelected = async () => {
    if (!selectedMessage || !selectedAgentId) return;
    const before = messages;
    const updated: MessageRecord = { ...selectedMessage, status: "archived", archived_at: new Date().toISOString() };
    setMessages((rows) => rows.map((row) => row.id === updated.id ? updated : row));
    setSelectedMessage(updated);
    try {
      const saved = await api.archiveMessage(updated.id, selectedAgentId);
      setMessages((rows) => rows.map((row) => row.id === saved.id ? saved : row));
      setSelectedMessage(saved);
      await refreshUnreadCounts();
    } catch (err) {
      setMessages(before);
      setError(err instanceof Error ? err.message : "Archive failed");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !selectedAgentId) return;
    const deleting = deleteTarget;
    const before = messages;
    setMessages((rows) => rows.filter((row) => row.id !== deleting.id));
    setSelectedMessage((current) => current?.id === deleting.id ? null : current);
    setDeleteTarget(null);
    try {
      await api.deleteMessage(deleting.id, selectedAgentId);
      await refreshUnreadCounts();
    } catch (err) {
      setMessages(before);
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const referenceIds = selectedMessage?.references?.tracked_item_ids?.filter(Boolean) ?? [];
  const reactiveLink = selectedMessage?.reactive_sweep_id ? `#/monitor?reactive=${encodeURIComponent(selectedMessage.reactive_sweep_id)}` : null;

  const reactiveBadge = (label: string, className: string, clickable: boolean) => {
    const pill = <Pill tone="muted" className={className}>{label}</Pill>;
    return clickable && reactiveLink ? <a href={reactiveLink} className="inline-flex" title={`Open reactive sweep ${selectedMessage?.reactive_sweep_id}`}>{pill}</a> : pill;
  };

  return <section className="flex h-[calc(100vh-6.5rem)] min-h-[640px] flex-col gap-4 overflow-hidden" data-testid="inbox-view">
    <div className="flex items-end justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-[var(--warm-glow)]">Inbox</p>
        <h1 className="mt-2 font-expanded text-3xl uppercase tracking-[0.08em]">Inter-agent messages</h1>
        <p className="mt-2 text-sm text-muted-foreground">Read-only visibility into agent coordination threads.</p>
      </div>
      {unreadTotal > 0 && <Pill tone="warm" className="hidden md:inline-flex">{unreadTotal} unread</Pill>}
    </div>

    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[280px_380px_minmax(0,1fr)]">
      <aside className={cn("min-h-0 rounded-2xl border border-foreground/10 bg-background/40 p-3 backdrop-blur", mobilePane !== "agents" && "hidden lg:block")}>
        <div className="mb-3 flex items-center justify-between px-1"><h2 className="font-expanded text-xs uppercase tracking-[0.16em]">Agents</h2><Pill tone="warm">{unreadTotal}</Pill></div>
        <div className="space-y-2 overflow-y-auto pr-1 lg:max-h-[calc(100%-4rem)]">
          {sortedAgents.map((agent) => {
            const unread = unreadCounts[agent.id] ?? 0;
            const active = agent.id === selectedAgentId;
            return <button key={agent.id} type="button" onClick={() => selectAgent(agent.id)} className={cn("w-full rounded-xl border px-3 py-3 text-left transition", active ? "border-[color-mix(in_srgb,var(--warm-glow)_38%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_10%,transparent)]" : "border-foreground/8 bg-foreground/[0.025] hover:bg-foreground/[0.055]")}>
              <div className="flex items-start justify-between gap-2"><div className="min-w-0 font-expanded text-xs uppercase tracking-[0.08em] text-foreground">{agent.name}</div>{unread > 0 && <Pill tone="warm">{unread}</Pill>}</div>
              <div className="mt-1 truncate text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{entityTag(agent)}</div>
            </button>;
          })}
        </div>
        <div className="mt-3 border-t border-foreground/8 pt-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">Total unread: <span className="text-[var(--warm-glow)]">{unreadTotal}</span></div>
      </aside>

      <aside className={cn("min-h-0 rounded-2xl border border-foreground/10 bg-background/40 p-3 backdrop-blur", mobilePane !== "messages" && "hidden lg:block")}>
        <div className="mb-3 flex items-center gap-2 lg:hidden"><Button variant="ghost" size="sm" onClick={() => setMobilePane("agents")}><ArrowLeft className="h-4 w-4" /> Agents</Button></div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="min-w-0 truncate font-expanded text-xs uppercase tracking-[0.16em]">{selectedAgent?.name ?? "Select agent"}</h2>
          <div className="flex rounded-full border border-foreground/10 bg-foreground/[0.03] p-0.5">
            {(["inbox", "sent"] as MessageViewMode[]).map((mode) => <button key={mode} type="button" onClick={() => setViewMode(mode)} className={cn("rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.12em]", viewMode === mode ? "bg-[var(--warm-glow)] text-background" : "text-muted-foreground")}>{mode}</button>)}
          </div>
        </div>
        <div className="mb-3 space-y-2">
          <div className="flex flex-wrap gap-1">{statusOptions.map((option) => <button key={option.id} type="button" onClick={() => setStatusFilter(option.id)} className={cn("rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.12em]", statusFilter === option.id ? "border-[var(--warm-glow)] text-[var(--warm-glow)]" : "border-foreground/10 text-muted-foreground")}>{option.label}</button>)}</div>
          <select className="w-full rounded-lg border border-foreground/10 bg-background px-3 py-2 text-xs uppercase tracking-[0.12em]" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}>{priorityOptions.map((priority) => <option key={priority} value={priority}>{priority === "all" ? "All priorities" : titleCase(priority)}</option>)}</select>
        </div>
        <div className="min-h-0 space-y-2 overflow-y-auto pr-1 lg:max-h-[calc(100%-9rem)]">
          {error && <div className="rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-sm text-red-100">{error}</div>}
          {loadingMessages ? <div className="p-6 text-sm text-muted-foreground">Loading messages…</div> : visibleMessages.length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">No messages.</div> : visibleMessages.map((message) => {
            const active = selectedMessage?.id === message.id;
            const peer = viewMode === "sent" ? `To ${agentLabel(agentMap, message.to_agent_id)}` : agentLabel(agentMap, message.from_agent_id);
            const threadSize = countsByThread[message.thread_id] ?? 1;
            return <button key={message.id} type="button" onClick={() => void openMessage(message)} className={cn("w-full rounded-xl border p-3 text-left transition", active ? "border-[color-mix(in_srgb,var(--warm-glow)_40%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_10%,transparent)]" : "border-foreground/8 bg-foreground/[0.025] hover:bg-foreground/[0.055]", message.status === "archived" && "opacity-70")}>
              <div className="flex items-start justify-between gap-2"><div className="min-w-0 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{peer}</div><div className="shrink-0 text-[11px] text-muted-foreground">{messageRelativeTime(message.sent_at)}</div></div>
              <div className={cn("mt-1 truncate font-semibold text-foreground", message.status === "archived" && "line-through")}>{message.subject || "(No subject)"}</div>
              <div className="mt-2 flex flex-wrap gap-1.5"><Pill tone={priorityTone(message.priority)}>{message.priority}</Pill><Pill tone={statusTone(message.status)}>{statusLabel(message.status)}</Pill>{threadSize > 1 && <Pill>Thread of {threadSize}</Pill>}</div>
            </button>;
          })}
        </div>
      </aside>

      <main className={cn("min-h-0 overflow-hidden rounded-2xl border border-foreground/10 bg-background/40 p-4 backdrop-blur", mobilePane !== "detail" && "hidden lg:block")}>
        <div className="mb-3 flex items-center gap-2 lg:hidden"><Button variant="ghost" size="sm" onClick={() => setMobilePane("messages")}><ArrowLeft className="h-4 w-4" /> Messages</Button></div>
        {!selectedMessage ? <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground"><Inbox className="mb-3 h-9 w-9" /><div>Select a message.</div></div> : <div className="flex h-full min-h-0 flex-col gap-4">
          <header className="border-b border-foreground/8 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="font-expanded text-xl uppercase tracking-[0.06em] text-foreground">{selectedMessage.subject || "(No subject)"}</h2><p className="mt-2 text-sm text-muted-foreground">From {agentLabel(agentMap, selectedMessage.from_agent_id)} → To {agentLabel(agentMap, selectedMessage.to_agent_id)}</p><p className="mt-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">{messageAbsoluteTime(selectedMessage.sent_at)}</p></div><div className="flex flex-wrap gap-1.5"><Pill tone={priorityTone(selectedMessage.priority)}>{selectedMessage.priority}</Pill>{selectedMessage.related_entity && <Pill>{titleCase(selectedMessage.related_entity)}</Pill>}</div></div>
            {(selectedMessage.triggered_reactive_sweep || selectedMessage.sent_from_reactive_sweep) && <div className="mt-3 flex flex-wrap gap-1.5">
              {selectedMessage.triggered_reactive_sweep && reactiveBadge("REACTIVE TRIGGERED", "border-[color-mix(in_srgb,var(--warm-glow)_32%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_9%,transparent)] text-[var(--warm-glow)]", true)}
              {selectedMessage.sent_from_reactive_sweep && reactiveBadge("SENT FROM REACTIVE SWEEP", "border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]", Boolean(reactiveLink))}
            </div>}
            <div className="mt-4 flex flex-wrap gap-2">
              {selectedMessage.status === "sent" && selectedMessage.to_agent_id === selectedAgentId && <Button variant="outline" size="sm" onClick={() => selectedAgentId && void api.markMessageRead(selectedMessage.id, selectedAgentId).then((updated) => { setSelectedMessage(updated); setMessages((rows) => rows.map((row) => row.id === updated.id ? updated : row)); return refreshUnreadCounts(); })}><MailOpen className="h-3.5 w-3.5" /> Mark read</Button>}
              <Button variant="outline" size="sm" onClick={() => void archiveSelected()}><Archive className="h-3.5 w-3.5" /> Archive</Button>
              <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(selectedMessage)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <pre className="whitespace-pre-wrap break-words rounded-xl border border-foreground/8 bg-foreground/[0.025] p-4 font-sans text-sm leading-6 text-foreground/90">{selectedMessage.body || "No body."}</pre>
            {(referenceIds.length > 0 || selectedMessage.references?.briefing_id) && <section className="mt-4 rounded-xl border border-foreground/8 p-4"><h3 className="mb-3 font-expanded text-xs uppercase tracking-[0.14em]">References</h3><div className="space-y-2 text-sm">{referenceIds.map((id) => <a key={id} className="block text-[var(--warm-glow)] underline-offset-4 hover:underline" href={`#/tracking?item_id=${encodeURIComponent(id)}`}>{trackedMap.get(id)?.title ?? id}</a>)}{selectedMessage.references?.briefing_id && <a className="block text-[var(--warm-glow)] underline-offset-4 hover:underline" href={`#/briefings?briefing_id=${encodeURIComponent(selectedMessage.references.briefing_id)}`}>Briefing {selectedMessage.references.briefing_id}</a>}</div></section>}
            {threadMessages.length > 1 && <section className="mt-4 rounded-xl border border-foreground/8 p-4"><h3 className="mb-3 font-expanded text-xs uppercase tracking-[0.14em]">Thread ({threadMessages.length} messages)</h3><div className="max-h-64 space-y-2 overflow-y-auto pr-1">{threadMessages.map((message) => <button key={message.id} type="button" onClick={() => void openMessage(message, "detail")} className={cn("w-full rounded-lg border p-3 text-left", message.id === selectedMessage.id ? "border-[var(--warm-glow)] bg-[color-mix(in_srgb,var(--warm-glow)_10%,transparent)]" : "border-foreground/8 bg-foreground/[0.02]")}><div className="flex justify-between gap-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground"><span>{agentLabel(agentMap, message.from_agent_id)}</span><span>{messageRelativeTime(message.sent_at)}</span></div><div className="mt-1 text-sm font-medium">{message.subject || message.body.split("\n")[0] || "(No subject)"}</div><div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{message.body}</div></button>)}</div></section>}
          </div>
        </div>}
      </main>
    </div>

    {deleteTarget && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-2xl border border-red-400/25 bg-background p-5 shadow-2xl"><h2 className="font-expanded text-lg uppercase tracking-[0.08em]">Delete message?</h2><p className="mt-3 text-sm text-muted-foreground">Delete this message from {selectedAgent?.name ?? "this agent"}'s inbox? This does not delete it from the other side.</p><div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button onClick={() => void confirmDelete()}>Delete</Button></div></div></div>}
  </section>;
}

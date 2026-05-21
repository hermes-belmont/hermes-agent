import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, Edit3, Plus, Target, Trash2, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import type { AgentRecord, TrackedItem, TrackedItemDraft, TrackedItemStatus } from "@/lib/types";
import { buildEmptyTrackingDraft, entityForAgent, LAST_USED_AGENT_STORAGE_KEY, resolveDefaultAgentForAdd, type TrackingDraft } from "@/lib/tracking";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = { agents: AgentRecord[]; initialAgentId?: string | null; initialItemId?: string | null };
type Draft = TrackingDraft;

const categories = ["deadline", "milestone", "recurring", "issue", "watch"];
const priorities = ["high", "medium", "low"];
const statuses: TrackedItemStatus[] = ["active", "snoozed", "done", "dismissed"];
const entities = ["trust", "holdings", "media", "properties", "customs"];
const recurrences = ["", "daily", "weekly", "monthly", "quarterly", "annual"];

function titleCase(value?: string | null) { return value ? value.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "None"; }
function relDate(item: TrackedItem) {
  if (!item.due_date) return item.recurrence ? `recurs ${item.recurrence}` : "no date";
  const today = new Date(); const due = new Date(`${item.due_date}T12:00:00`);
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return `overdue ${Math.abs(days)} days`;
  if (days === 0) return "today";
  return `in ${days} days`;
}
function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "high" | "medium" | "low" | "active" | "done" }) {
  const cls = tone === "high" ? "border-red-400/30 bg-red-400/10 text-red-100" : tone === "medium" ? "border-amber-400/30 bg-amber-400/10 text-amber-100" : tone === "low" ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100" : tone === "active" ? "border-[color-mix(in_srgb,var(--warm-glow)_35%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_10%,transparent)] text-[var(--warm-glow)]" : tone === "done" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-foreground/10 bg-foreground/[0.04] text-muted-foreground";
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.10em]", cls)}>{children}</span>;
}

export function TrackingView({ agents, initialAgentId, initialItemId }: Props) {
  const [items, setItems] = useState<TrackedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentFilter, setAgentFilter] = useState(initialAgentId ?? "all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [statusFilters, setStatusFilters] = useState<TrackedItemStatus[]>(["active"]);
  const [sort, setSort] = useState("due");
  const [modal, setModal] = useState<{ mode: "add" | "edit"; item?: TrackedItem } | null>(null);
  const [draft, setDraft] = useState<Draft>(buildEmptyTrackingDraft(agents, ""));
  const [agentValidation, setAgentValidation] = useState("");

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const load = async () => { setLoading(true); try { const raw = await api.listTrackedItems(); setItems(raw.map((it) => ({ ...it, tags: Array.isArray(it.tags) ? it.tags : [] }))); } finally { setLoading(false); } };
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (initialAgentId) setAgentFilter(initialAgentId); }, [initialAgentId]);

  const filtered = useMemo(() => items.filter((item) =>
    (agentFilter === "all" || item.agent_id === agentFilter) &&
    (entityFilter === "all" || item.entity === entityFilter) &&
    (categoryFilter === "all" || item.category === categoryFilter) &&
    (priorityFilter === "all" || item.priority === priorityFilter) &&
    statusFilters.includes(item.status)
  ).sort((a, b) => sort === "priority" ? priorities.indexOf(a.priority) - priorities.indexOf(b.priority) : sort === "updated" ? (b.updated_at ?? "").localeCompare(a.updated_at ?? "") : (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31")), [items, agentFilter, entityFilter, categoryFilter, priorityFilter, statusFilters, sort]);

  const openAdd = () => { const selected = agentFilter !== "all" ? agentFilter : resolveDefaultAgentForAdd(agents); setDraft(buildEmptyTrackingDraft(agents, selected)); setAgentValidation(""); setModal({ mode: "add" }); };
  const openEdit = (item: TrackedItem) => { setAgentValidation(""); setDraft({ ...item, tagsText: item.tags.join(", ") }); setModal({ mode: "edit", item }); };
  const save = async () => {
    if (!draft.agent_id) { setAgentValidation("Pick an agent before saving."); return; }
    const payload: TrackedItemDraft = { ...draft, tags: (draft.tagsText ?? "").split(",").map((t) => t.trim()).filter(Boolean), recurrence: draft.recurrence || null, due_date: draft.due_date || null, description: draft.description || null, notes: draft.notes || null, source: "manual" };
    if (modal?.mode === "edit" && modal.item) await api.updateTrackedItem(modal.item.id, payload as Partial<TrackedItem>); else { await api.createTrackedItem(payload); window.localStorage.setItem(LAST_USED_AGENT_STORAGE_KEY, draft.agent_id); }
    setModal(null); await load();
  };
  const act = async (item: TrackedItem, action: "snooze" | "done" | "dismiss" | "reactivate") => { await api.actOnTrackedItem(item.id, action); await load(); };
  const remove = async (item: TrackedItem) => { if (window.confirm(`Delete ${item.title}?`)) { await api.deleteTrackedItem(item.id); await load(); } };

  return <section className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.24em] text-[var(--warm-glow)]">Kanban</p><h1 className="mt-2 font-expanded text-3xl uppercase tracking-[0.08em]">Kanban</h1><p className="mt-2 text-sm text-muted-foreground">What your agents are watching</p></div><Button onClick={openAdd}><Plus className="mr-2 h-4 w-4" /> Add Item</Button></div>
    <Card className="sticky top-3 z-10 backdrop-blur"><CardContent className="flex flex-wrap gap-3 pt-4">
      <select className="rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}><option value="all">All agents</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      <select className="rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm" value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}><option value="all">All entities</option>{entities.map((e) => <option key={e} value={e}>{titleCase(e)}</option>)}</select>
      <div className="flex flex-wrap gap-1">{statuses.map((s) => <button key={s} type="button" onClick={() => setStatusFilters((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])} className={cn("rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.10em]", statusFilters.includes(s) ? "border-[var(--warm-glow)] text-[var(--warm-glow)]" : "border-foreground/10 text-muted-foreground")}>{titleCase(s)}</button>)}</div>
      <select className="rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}><option value="all">All categories</option>{categories.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</select>
      <select className="rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}><option value="all">All priorities</option>{priorities.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}</select>
      <select className="rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm" value={sort} onChange={(e) => setSort(e.target.value)}><option value="due">Due date asc</option><option value="priority">Priority desc</option><option value="updated">Updated desc</option></select>
    </CardContent></Card>
    {loading ? <Card><CardContent className="py-10 text-muted-foreground">Loading tracked items…</CardContent></Card> : filtered.length === 0 ? <Card className="border-dashed"><CardContent className="flex flex-col items-center justify-center py-16 text-center"><Target className="h-10 w-10 text-muted-foreground" /><h2 className="mt-4 font-expanded text-xl uppercase">No items match these filters</h2><Button className="mt-4" onClick={openAdd}>Add Item</Button></CardContent></Card> : <div className="space-y-3">{filtered.map((item) => <Card key={item.id} id={`tracked-${item.id}`} className={cn(initialItemId === item.id && "ring-2 ring-[var(--warm-glow)]")}><CardContent className="pt-5"><div className="flex flex-wrap justify-between gap-4"><div className="min-w-0 flex-1"><h2 className="text-lg font-semibold">{item.title}</h2>{item.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.description}</p>}<div className="mt-3 flex flex-wrap gap-2"><Pill>{agentMap.get(item.agent_id)?.name ?? item.agent_id}</Pill><Pill>{titleCase(item.entity)}</Pill><Pill>{titleCase(item.category)}</Pill><Pill tone={item.priority}>{item.priority}</Pill><Pill tone={item.status === "active" ? "active" : item.status === "done" ? "done" : "neutral"}>{item.status}</Pill><Pill>{relDate(item)}</Pill></div>{item.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{item.tags.map((tag) => <span key={tag} className="rounded-md bg-foreground/[0.05] px-2 py-0.5 text-xs text-muted-foreground">#{tag}</span>)}</div>}</div><div className="flex flex-wrap items-start justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => openEdit(item)}><Edit3 className="mr-1 h-3.5 w-3.5" />Edit</Button>{item.status !== "snoozed" && <Button size="sm" variant="ghost" onClick={() => act(item, "snooze")}><Clock className="mr-1 h-3.5 w-3.5" />Snooze</Button>}<Button size="sm" variant="ghost" onClick={() => act(item, "done")}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Mark Done</Button><Button size="sm" variant="ghost" onClick={() => act(item, "dismiss")}><XCircle className="mr-1 h-3.5 w-3.5" />Dismiss</Button><Button size="sm" variant="ghost" onClick={() => remove(item)}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete</Button></div></div></CardContent></Card>)}</div>}
    {modal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(null); }}><Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto"><CardHeader><CardTitle className="font-expanded uppercase tracking-[0.08em]">{modal.mode === "add" ? "Add Item" : "Edit Item"}</CardTitle><CardDescription>Structured watch item for daily briefing context injection.</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-2"><label className="text-sm">Agent<select className="mt-1 w-full rounded-lg border border-foreground/10 bg-background px-3 py-2" value={draft.agent_id} onChange={(e) => { const agent = agentMap.get(e.target.value); setAgentValidation(""); setDraft({ ...draft, agent_id: e.target.value, entity: draft.entity ?? entityForAgent(agent) }); }}><option value="">Select agent...</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>{agentValidation && <p className="mt-1 text-xs text-red-200">{agentValidation}</p>}</label><label className="text-sm md:col-span-2">Title<Input className="mt-1" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label><label className="text-sm md:col-span-2">Description<textarea className="mt-1 min-h-24 w-full rounded-lg border border-foreground/10 bg-background px-3 py-2" value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label><label className="text-sm">Entity<select className="mt-1 w-full rounded-lg border border-foreground/10 bg-background px-3 py-2" value={draft.entity ?? ""} onChange={(e) => setDraft({ ...draft, entity: (e.target.value || null) as TrackedItem["entity"] })}><option value="">None</option>{entities.map((e) => <option key={e} value={e}>{titleCase(e)}</option>)}</select></label><label className="text-sm">Category<select className="mt-1 w-full rounded-lg border border-foreground/10 bg-background px-3 py-2" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as TrackedItem["category"] })}>{categories.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</select></label><label className="text-sm">Due date<Input className="mt-1" type="date" value={draft.due_date ?? ""} onChange={(e) => setDraft({ ...draft, due_date: e.target.value || null })} /></label><label className="text-sm">Recurrence<select className="mt-1 w-full rounded-lg border border-foreground/10 bg-background px-3 py-2" value={draft.recurrence ?? ""} onChange={(e) => setDraft({ ...draft, recurrence: (e.target.value || null) as TrackedItem["recurrence"] })}>{recurrences.map((r) => <option key={r || "none"} value={r}>{r ? titleCase(r) : "None"}</option>)}</select></label><label className="text-sm">Priority<select className="mt-1 w-full rounded-lg border border-foreground/10 bg-background px-3 py-2" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as TrackedItem["priority"] })}>{priorities.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}</select></label><label className="text-sm">Tags<Input className="mt-1" value={draft.tagsText ?? ""} onChange={(e) => setDraft({ ...draft, tagsText: e.target.value })} placeholder="seed, launch" /></label><label className="text-sm md:col-span-2">Notes<textarea className="mt-1 min-h-20 w-full rounded-lg border border-foreground/10 bg-background px-3 py-2" value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label><div className="flex justify-end gap-2 md:col-span-2"><Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button><span onMouseDown={() => { if (!draft.agent_id) setAgentValidation("Pick an agent before saving."); }}><Button disabled={!draft.agent_id || !draft.title} onClick={save}>Save</Button></span></div></CardContent></Card></div>}
  </section>;
}

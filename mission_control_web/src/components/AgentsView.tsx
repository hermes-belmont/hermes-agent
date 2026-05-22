import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Edit3, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { ENTITY_TYPE_OPTIONS } from "@/lib/types";
import type { AgentRecord, BootstrapResponse, EntityRecord, MessagingPolicy } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const EXPANDED_KEY = "mc.agents.expandedEntities.v1";
const SELECTED_KEY = "mc.agents.selectedAgentId.v1";
const VIEW_MODE_KEY = "mc.agents.viewMode.v1";
const emptyMetadata = { ein: null, state: null, formation_date: null };

type Selection = { kind: "agent"; id: string } | { kind: "entity"; id: string };
type ViewMode = "active" | "trash";
type Modal = "add-agent" | "add-entity" | "move-agent" | "delete-agent" | null;

type TrashAgent = AgentRecord & { purges_in_days?: number };

function Pill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "warm" | "danger" }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]",
        tone === "warm" && "border-[color-mix(in_srgb,var(--warm-glow)_55%,transparent)] text-[var(--warm-glow)]",
        tone === "danger" && "border-red-400/35 text-red-300",
        tone === "muted" && "border-foreground/15 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function flattenEntities(nodes: EntityRecord[], depth = 0): Array<{ entity: EntityRecord; depth: number }> {
  return nodes.flatMap((entity) => [{ entity, depth }, ...flattenEntities(entity.children ?? [], depth + 1)]);
}

function policyAllows(entities: EntityRecord[], agents: AgentRecord[], fromId: string, toId: string) {
  const byEntity = new Map(entities.map((entity) => [entity.id, entity]));
  const byAgent = new Map(agents.map((agent) => [agent.id, agent]));
  const fromEntity = byEntity.get(byAgent.get(fromId)?.entity_id ?? "");
  const toEntity = byEntity.get(byAgent.get(toId)?.entity_id ?? "");
  if (!fromEntity || !toEntity) return false;
  if (fromEntity.id === toEntity.id) return true;
  const rank: Record<MessagingPolicy, number> = { open: 0, restricted: 1, isolated: 2 };
  const policy = rank[fromEntity.messaging_policy] >= rank[toEntity.messaging_policy] ? fromEntity.messaging_policy : toEntity.messaging_policy;
  if (policy === "open") return true;
  if (policy === "isolated") return false;
  const isDescendant = (childId: string, ancestorId: string) => {
    const seen = new Set<string>();
    let cursor = byEntity.get(childId);
    while (cursor?.parent_id) {
      if (cursor.parent_id === ancestorId) return true;
      if (seen.has(cursor.parent_id)) return false;
      seen.add(cursor.parent_id);
      cursor = byEntity.get(cursor.parent_id);
    }
    return false;
  };
  return isDescendant(fromEntity.id, toEntity.id) || isDescendant(toEntity.id, fromEntity.id);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

const inputClass = "w-full rounded-xl border border-foreground/10 bg-background/65 px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--warm-glow)]";
const entityTypeLabel = (type: EntityRecord["type"]) => ENTITY_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;

export function AgentsView({ bootstrap, onRefresh, initialSelection, initialViewMode, initialTrash }: { bootstrap: BootstrapResponse; onRefresh: () => Promise<BootstrapResponse>; initialSelection?: Selection | null; initialViewMode?: ViewMode; initialTrash?: TrashAgent[] }) {
  const [tree, setTree] = useState<EntityRecord[]>(bootstrap.entity_tree ?? []);
  const [agents, setAgents] = useState<AgentRecord[]>(bootstrap.agents ?? []);
  const [trash, setTrash] = useState<TrashAgent[]>(initialTrash ?? []);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) || "[]")));
  const [viewMode, setViewModeState] = useState<ViewMode>(() => initialViewMode ?? (localStorage.getItem(VIEW_MODE_KEY) === "trash" ? "trash" : "active"));
  const [selection, setSelectionState] = useState<Selection | null>(() => {
    if (initialSelection !== undefined) return initialSelection;
    const stored = localStorage.getItem(SELECTED_KEY);
    return stored ? { kind: "agent", id: stored } : null;
  });
  const [modal, setModal] = useState<Modal>(null);
  const [movingAgentId, setMovingAgentId] = useState<string | null>(null);
  const [deleteAgentId, setDeleteAgentId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const flat = useMemo(() => flattenEntities(tree), [tree]);
  const entities = useMemo(() => flat.map((row) => row.entity), [flat]);
  const modelOptions = bootstrap.catalog.models.length ? bootstrap.catalog.models : ["gpt-5.5"];
  const selectedAgent = selection?.kind === "agent" ? agents.find((agent) => agent.id === selection.id) ?? trash.find((agent) => agent.id === selection.id) ?? null : null;
  const selectedEntity = selection?.kind === "entity" ? entities.find((entity) => entity.id === selection.id) ?? null : null;
  const reachable = selectedAgent ? agents.filter((agent) => agent.id !== selectedAgent.id && policyAllows(entities, agents, selectedAgent.id, agent.id)) : [];
  const reachableEntityCount = new Set(reachable.map((agent) => agent.entity_id)).size;

  useEffect(() => {
    if (viewMode === "trash" && !initialTrash) {
      void api.listTrashAgents().then(setTrash);
    }
  }, [viewMode, initialTrash]);

  const setSelection = (next: Selection) => {
    setSelectionState(next);
    if (next.kind === "agent") localStorage.setItem(SELECTED_KEY, next.id);
  };

  const setViewMode = async (next: ViewMode) => {
    setViewModeState(next);
    localStorage.setItem(VIEW_MODE_KEY, next);
    if (next === "trash") setTrash(await api.listTrashAgents());
  };

  const toggleExpanded = (entityId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const refresh = async () => {
    const [nextTree, nextAgents] = await Promise.all([api.getEntityTree(), api.listAgents()]);
    setTree(nextTree);
    setAgents(nextAgents);
    if (viewMode === "trash") setTrash(await api.listTrashAgents());
    await onRefresh();
  };

  const saveAgent = async (patch: Partial<AgentRecord>) => {
    if (!selectedAgent) return;
    await api.updateAgentPublic(selectedAgent.id, patch);
    setNotice("Agent saved.");
    await refresh();
  };

  const saveEntity = async (patch: Partial<EntityRecord>) => {
    if (!selectedEntity) return;
    await api.updateEntity(selectedEntity.id, patch);
    setNotice("Entity saved.");
    await refresh();
  };

  const renderEntity = (entity: EntityRecord, depth = 0): React.ReactNode => {
    const open = expanded.has(entity.id);
    const children = entity.children ?? [];
    const entityAgents = entity.agents ?? [];
    return (
      <div key={entity.id}>
        <div
          className={cn("group flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-foreground/[0.04]", selection?.kind === "entity" && selection.id === entity.id && "bg-foreground/[0.06]")}
          style={{ paddingLeft: 8 + depth * 18 }}
        >
          <button type="button" onClick={() => toggleExpanded(entity.id)}>{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelection({ kind: "entity", id: entity.id })}>
            <span className="font-expanded text-sm uppercase tracking-[0.08em]">{entity.name}</span>
          </button>
          <Pill>{entityTypeLabel(entity.type)}</Pill>
          {entity.messaging_policy !== "open" && <Pill tone={entity.messaging_policy === "isolated" ? "warm" : "muted"}>{entity.messaging_policy}</Pill>}
          <span className="text-xs text-muted-foreground">{entityAgents.length}</span>
          <span className="hidden gap-1 group-hover:flex">
            <button type="button" onClick={() => setSelection({ kind: "entity", id: entity.id })}><Edit3 className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={async () => { await api.deleteEntity(entity.id); await refresh(); }}><Trash2 className="h-3.5 w-3.5" /></button>
          </span>
        </div>
        {open && (
          <div>
            {entityAgents.map((agent) => (
              <div
                key={agent.id}
                className={cn("group flex items-start gap-2 rounded-xl px-3 py-2 hover:bg-foreground/[0.04]", selection?.kind === "agent" && selection.id === agent.id && "bg-[color-mix(in_srgb,var(--warm-glow)_10%,transparent)]")}
                style={{ marginLeft: 28 + depth * 18 }}
              >
                <button className="min-w-0 flex-1 text-left" onClick={() => setSelection({ kind: "agent", id: agent.id })}>
                  <div className="truncate text-sm font-medium">{agent.name}</div>
                  <div className="line-clamp-1 text-xs text-muted-foreground">{agent.role}</div>
                  <div className="mt-1 flex flex-wrap gap-1">{agent.is_briefing_agent && <Pill tone="warm">Briefing</Pill>}<Pill>{agent.preferred_model}</Pill></div>
                </button>
                <span className="hidden gap-1 text-xs group-hover:flex">
                  <button type="button" onClick={async () => { await api.duplicateAgent(agent.id); await refresh(); }}><Copy className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => { setMovingAgentId(agent.id); setModal("move-agent"); }}>Move</button>
                  <button type="button" onClick={async () => { await api.reorderAgent(agent.id, Math.max(0, (agent.display_order ?? 0) - 1)); await refresh(); }}>Up</button>
                  <button type="button" onClick={async () => { await api.reorderAgent(agent.id, (agent.display_order ?? 0) + 1); await refresh(); }}>Down</button>
                  <button type="button" onClick={() => { setDeleteAgentId(agent.id); setModal("delete-agent"); }}><Trash2 className="h-3.5 w-3.5" /></button>
                </span>
              </div>
            ))}
            {children.map((child) => renderEntity(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--warm-glow)]">Agents</p>
          <h1 className="mt-2 font-expanded text-3xl uppercase tracking-[0.08em]">AGENTS</h1>
          <p className="mt-2 text-sm text-muted-foreground">Org structure and agent management.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setModal("add-agent")}><Plus className="h-4 w-4" /> Add Agent</Button>
          <Button variant="outline" onClick={() => setModal("add-entity")}><Plus className="h-4 w-4" /> Add Entity</Button>
          <Button variant="outline" onClick={() => void setViewMode(viewMode === "active" ? "trash" : "active")}>{viewMode === "active" ? "Trash" : "Active"}</Button>
        </div>
      </div>
      {notice && <div className="rounded-xl border border-[color-mix(in_srgb,var(--warm-glow)_30%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_8%,transparent)] px-3 py-2 text-sm text-[var(--warm-glow)]">{notice}</div>}
      {viewMode === "active" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <Card><CardHeader><CardTitle>Entity tree</CardTitle><CardDescription>Click an entity or agent to inspect and manage it.</CardDescription></CardHeader><CardContent className="space-y-1">{tree.map((entity) => renderEntity(entity))}</CardContent></Card>
          <Inspector selectedAgent={selectedAgent} selectedEntity={selectedEntity} entities={entities} models={modelOptions} reachable={reachable} reachableEntityCount={reachableEntityCount} saveAgent={saveAgent} saveEntity={saveEntity} />
        </div>
      ) : (
        <TrashView trash={trash} selectedAgent={selectedAgent} onSelect={(agentId) => setSelection({ kind: "agent", id: agentId })} onRestore={async (agentId) => { await api.restoreAgent(agentId); await refresh(); }} />
      )}
      {modal === "add-agent" && <AgentModal entities={entities} models={modelOptions} onClose={() => setModal(null)} onSave={async (draft) => { await api.createAgentPublic(draft); setModal(null); await refresh(); }} />}
      {modal === "add-entity" && <EntityModal entities={entities} onClose={() => setModal(null)} onSave={async (draft) => { await api.createEntity(draft); setModal(null); await refresh(); }} />}
      {modal === "move-agent" && movingAgentId && <MoveModal entities={entities} onClose={() => setModal(null)} onMove={async (entityId) => { await api.moveAgent(movingAgentId, entityId); setModal(null); await refresh(); }} />}
      {modal === "delete-agent" && deleteAgentId && (
        <ConfirmDelete
          name={agents.find((agent) => agent.id === deleteAgentId)?.name ?? "agent"}
          briefing={Boolean(agents.find((agent) => agent.id === deleteAgentId)?.is_briefing_agent)}
          onClose={() => setModal(null)}
          onConfirm={async () => { await api.deleteAgentPublic(deleteAgentId); setModal(null); await refresh(); }}
        />
      )}
    </div>
  );
}

function TrashView({ trash, selectedAgent, onSelect, onRestore }: { trash: TrashAgent[]; selectedAgent: AgentRecord | null; onSelect: (id: string) => void; onRestore: (id: string) => Promise<void> }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card>
        <CardHeader><CardTitle>Trash</CardTitle><CardDescription>Trashed agents are permanently deleted 30 days after deletion. The purge runs daily at 03:00.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {trash.map((agent) => (
            <div key={agent.id} className="flex items-center justify-between rounded-xl border border-foreground/10 p-3">
              <button className="text-left" onClick={() => onSelect(agent.id)}><div className="font-medium">{agent.name}</div><div className="text-xs text-muted-foreground">Deleted {agent.deleted_at} · Purges in {agent.purges_in_days ?? "?"} days</div></button>
              <Button size="sm" variant="outline" onClick={() => void onRestore(agent.id)}>Restore</Button>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Deleted detail</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground"><div>{selectedAgent?.name ?? "Select a deleted agent."}</div><div>{selectedAgent?.role}</div><div>{selectedAgent?.id}</div></CardContent></Card>
    </div>
  );
}

function Inspector(props: { selectedAgent: AgentRecord | null; selectedEntity: EntityRecord | null; entities: EntityRecord[]; models: string[]; reachable: AgentRecord[]; reachableEntityCount: number; saveAgent: (patch: Partial<AgentRecord>) => Promise<void>; saveEntity: (patch: Partial<EntityRecord>) => Promise<void> }) {
  if (props.selectedAgent) return <AgentInspector key={props.selectedAgent.id} {...props} selectedAgent={props.selectedAgent} />;
  if (props.selectedEntity) return <EntityInspector key={props.selectedEntity.id} {...props} selectedEntity={props.selectedEntity} />;
  return <Card><CardHeader><CardTitle>Inspector</CardTitle><CardDescription>Select an entity or agent.</CardDescription></CardHeader></Card>;
}

function AgentInspector({ selectedAgent, entities, models, reachable, reachableEntityCount, saveAgent }: { selectedAgent: AgentRecord; entities: EntityRecord[]; models: string[]; reachable: AgentRecord[]; reachableEntityCount: number; saveAgent: (patch: Partial<AgentRecord>) => Promise<void> }) {
  const [draft, setDraft] = useState<Partial<AgentRecord>>(selectedAgent);
  return (
    <Card>
      <CardHeader><CardTitle>Agent inspector</CardTitle><CardDescription>{selectedAgent.id}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <Field label="Name"><input className={inputClass} value={draft.name ?? ""} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
        <Field label="Role"><textarea className={inputClass} value={draft.role ?? ""} onChange={(event) => setDraft({ ...draft, role: event.target.value })} /></Field>
        <Field label="Description"><textarea className={inputClass} value={draft.description ?? ""} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Field>
        <Field label="Entity"><select className={inputClass} value={draft.entity_id ?? ""} onChange={(event) => setDraft({ ...draft, entity_id: event.target.value })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></Field>
        <Field label="Preferred model"><select className={inputClass} value={draft.preferred_model ?? ""} onChange={(event) => setDraft({ ...draft, preferred_model: event.target.value })}>{models.map((model) => <option key={model}>{model}</option>)}</select></Field>
        <Field label="Business function"><input className={inputClass} value={draft.business_function ?? ""} onChange={(event) => setDraft({ ...draft, business_function: event.target.value })} /></Field>
        <Field label="Team grouping"><input className={inputClass} value={draft.team_grouping ?? ""} onChange={(event) => setDraft({ ...draft, team_grouping: event.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(draft.is_briefing_agent)} onChange={(event) => setDraft({ ...draft, is_briefing_agent: event.target.checked })} /> Briefing rotation</label>
        <div className="flex gap-2"><Button onClick={() => void saveAgent(draft)}>Save</Button><Button variant="outline" onClick={() => setDraft(selectedAgent)}>Cancel</Button></div>
        <div className="text-xs text-muted-foreground">Can message: {reachable.length} agents across {reachableEntityCount} entities</div>
        <details className="text-xs text-muted-foreground"><summary>Reachable agents</summary>{reachable.map((agent) => <div key={agent.id}>{agent.name}</div>)}</details>
        <div className="flex gap-2 text-xs"><a href={`#/inbox?agent_id=${selectedAgent.id}`}>Inbox filtered</a><a href={`#/kanban?agent_id=${selectedAgent.id}`}>Kanban filtered</a><a href="#/cron">Briefing sections</a></div>
        <div className="text-[11px] text-muted-foreground">Created {selectedAgent.created_at}<br />Updated {selectedAgent.updated_at}</div>
      </CardContent>
    </Card>
  );
}

function EntityInspector({ selectedEntity, entities, saveEntity }: { selectedEntity: EntityRecord; entities: EntityRecord[]; saveEntity: (patch: Partial<EntityRecord>) => Promise<void> }) {
  const [draft, setDraft] = useState<Partial<EntityRecord>>(selectedEntity);
  const metadata = draft.metadata ?? emptyMetadata;
  const pseudoAgents = entities.map((entity, index) => ({ id: `pseudo_${index}`, entity_id: entity.id }) as AgentRecord);
  const blocked = pseudoAgents.filter((from) => pseudoAgents.some((to) => from.id !== to.id && !policyAllows(entities, pseudoAgents, from.id, to.id))).length;
  return (
    <Card>
      <CardHeader><CardTitle>Entity inspector</CardTitle><CardDescription>{selectedEntity.id}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <Field label="Name"><input className={inputClass} value={draft.name ?? ""} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
        <Field label="Type"><select className={inputClass} value={draft.type ?? "other"} onChange={(event) => setDraft({ ...draft, type: event.target.value as EntityRecord["type"] })}>{ENTITY_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
        <Field label="Description"><textarea className={inputClass} value={draft.description ?? ""} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Field>
        <Field label="Parent"><select className={inputClass} value={draft.parent_id ?? ""} onChange={(event) => setDraft({ ...draft, parent_id: event.target.value || null })}><option value="">None</option>{entities.filter((entity) => entity.id !== selectedEntity.id).map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></Field>
        <Field label="Messaging policy"><select className={inputClass} value={draft.messaging_policy ?? "open"} onChange={(event) => setDraft({ ...draft, messaging_policy: event.target.value as MessagingPolicy })}><option value="open">Open: any agent may send to/from this entity</option><option value="restricted">Restricted: only vertical chain (parent/self/child)</option><option value="isolated">Isolated: only same-entity sends</option></select></Field>
        {(draft.messaging_policy === "restricted" || draft.messaging_policy === "isolated") && <div className="rounded-xl border border-[var(--warm-glow)]/30 p-2 text-xs text-[var(--warm-glow)]">{draft.messaging_policy} policy blocks {blocked} current send paths in your registry. Past messages are preserved.</div>}
        <div className="grid grid-cols-3 gap-2"><Field label="EIN"><input className={inputClass} value={metadata.ein ?? ""} onChange={(event) => setDraft({ ...draft, metadata: { ...metadata, ein: event.target.value || null } })} /></Field><Field label="State"><input className={inputClass} value={metadata.state ?? ""} onChange={(event) => setDraft({ ...draft, metadata: { ...metadata, state: event.target.value || null } })} /></Field><Field label="Formation"><input className={inputClass} value={metadata.formation_date ?? ""} onChange={(event) => setDraft({ ...draft, metadata: { ...metadata, formation_date: event.target.value || null } })} /></Field></div>
        <div className="flex gap-2"><Button onClick={() => void saveEntity(draft)}>Save</Button><Button variant="outline" onClick={() => setDraft(selectedEntity)}>Cancel</Button></div>
        <div className="text-xs text-muted-foreground">Agent count {(selectedEntity.agents ?? []).length} · Child entities {(selectedEntity.children ?? []).length}</div>
      </CardContent>
    </Card>
  );
}

function AgentModal({ entities, models, onClose, onSave }: { entities: EntityRecord[]; models: string[]; onClose: () => void; onSave: (draft: Partial<AgentRecord>) => Promise<void> }) {
  const [draft, setDraft] = useState<Partial<AgentRecord>>({ name: "", entity_id: entities[0]?.id, role: "", description: "", is_briefing_agent: false, preferred_model: models[0], business_function: "Operations", team_grouping: "Operations" });
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"><Card className="w-full max-w-2xl"><CardHeader><CardTitle>Add Agent</CardTitle></CardHeader><CardContent className="space-y-3"><Field label="Name"><input className={inputClass} value={draft.name ?? ""} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field><Field label="Entity"><select className={inputClass} value={draft.entity_id} onChange={(event) => setDraft({ ...draft, entity_id: event.target.value })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></Field><Field label="Role"><textarea className={inputClass} value={draft.role ?? ""} onChange={(event) => setDraft({ ...draft, role: event.target.value })} /></Field><Field label="Description"><textarea className={inputClass} value={draft.description ?? ""} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Field><label className="flex gap-2 text-sm"><input type="checkbox" checked={Boolean(draft.is_briefing_agent)} onChange={(event) => setDraft({ ...draft, is_briefing_agent: event.target.checked })} /> Briefing rotation</label><Field label="Model"><select className={inputClass} value={draft.preferred_model} onChange={(event) => setDraft({ ...draft, preferred_model: event.target.value })}>{models.map((model) => <option key={model}>{model}</option>)}</select></Field><div className="grid grid-cols-2 gap-2"><Field label="Business function"><input className={inputClass} value={draft.business_function ?? ""} onChange={(event) => setDraft({ ...draft, business_function: event.target.value })} /></Field><Field label="Team grouping"><input className={inputClass} value={draft.team_grouping ?? ""} onChange={(event) => setDraft({ ...draft, team_grouping: event.target.value })} /></Field></div><div className="flex gap-2"><Button onClick={() => void onSave(draft)}>Save</Button><Button variant="outline" onClick={onClose}>Cancel</Button></div></CardContent></Card></div>;
}

function EntityModal({ entities, onClose, onSave }: { entities: EntityRecord[]; onClose: () => void; onSave: (draft: Partial<EntityRecord>) => Promise<void> }) {
  const [draft, setDraft] = useState<Partial<EntityRecord>>({ name: "", type: "llc", parent_id: null, description: "", messaging_policy: "open", metadata: emptyMetadata });
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"><Card className="w-full max-w-xl"><CardHeader><CardTitle>Add Entity</CardTitle></CardHeader><CardContent className="space-y-3"><Field label="Name"><input className={inputClass} value={draft.name ?? ""} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field><Field label="Type"><select className={inputClass} value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as EntityRecord["type"] })}>{ENTITY_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field><Field label="Parent"><select className={inputClass} value={draft.parent_id ?? ""} onChange={(event) => setDraft({ ...draft, parent_id: event.target.value || null })}><option value="">None</option>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></Field><Field label="Description"><textarea className={inputClass} value={draft.description ?? ""} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Field><Field label="Messaging policy"><select className={inputClass} value={draft.messaging_policy} onChange={(event) => setDraft({ ...draft, messaging_policy: event.target.value as MessagingPolicy })}><option value="open">Open</option><option value="restricted">Restricted</option><option value="isolated">Isolated</option></select></Field><div className="flex gap-2"><Button onClick={() => void onSave(draft)}>Save</Button><Button variant="outline" onClick={onClose}>Cancel</Button></div></CardContent></Card></div>;
}

function MoveModal({ entities, onClose, onMove }: { entities: EntityRecord[]; onClose: () => void; onMove: (id: string) => Promise<void> }) {
  const [id, setId] = useState(entities[0]?.id ?? "");
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"><Card className="w-full max-w-md"><CardHeader><CardTitle>Move Agent</CardTitle></CardHeader><CardContent className="space-y-3"><Field label="Entity"><select className={inputClass} value={id} onChange={(event) => setId(event.target.value)}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></Field><div className="flex gap-2"><Button onClick={() => void onMove(id)}>Move</Button><Button variant="outline" onClick={onClose}>Cancel</Button></div></CardContent></Card></div>;
}

function ConfirmDelete({ name, briefing, onClose, onConfirm }: { name: string; briefing: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"><Card className="w-full max-w-md"><CardHeader><CardTitle>Move {name} to trash?</CardTitle><CardDescription>Permanently deleted in 30 days. You can restore from Trash. {briefing ? "This agent will not run tomorrow's briefing." : ""}</CardDescription></CardHeader><CardContent className="flex gap-2"><Button onClick={() => void onConfirm()}>Delete</Button><Button variant="outline" onClick={onClose}>Cancel</Button></CardContent></Card></div>;
}

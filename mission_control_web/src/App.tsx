import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUp,
  Bot,
  BrainCircuit,
  Check,
  Copy,
  ChevronDown,
  Folder,
  Lock,
  Loader2,
  Mic,
  Paperclip,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  Ellipsis,
  Trash2,
  Archive,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import type { AccountRecord, AgentRecord, BootstrapResponse, ConversationMessage, ConversationRecord, EntityRecord, ChatAttachment } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { mockBootstrap } from "@/lib/mock";
import { applyBackground, getStoredBackground, setStoredBackground, type BackgroundId } from "@/lib/backgrounds";
import { applyCuratedTheme, applyTheme, CURATED_THEMES, DEFAULT_THEME, getThemeDefinition, setStoredTheme, THEME_STORAGE_KEY, THEME_STORAGE_KEY_V1, type ThemeName } from "@/lib/themes";
import { NavigationRail, type ActiveView, type ProjectRecord } from "@/components/NavigationRail";
import { MonitorView } from "@/components/MonitorView";
import { MaintenanceView } from "@/components/MaintenanceView";
import { BriefingsView } from "@/components/BriefingsView";
import { InboxView } from "@/components/InboxView";
import { AgentsView } from "@/components/AgentsView";
import { TrackingView } from "@/components/TrackingView";
import { SettingsView, type SettingsSection } from "@/components/SettingsView";
import { InstallModal } from "@/components/InstallModal";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { useChatStream } from "@/hooks/useChatStream";
import { getDefaultModel, getRecentsPadded, promoteOnSend, RECENTS_STORAGE_KEY, DEFAULT_MODEL_STORAGE_KEY } from "@/lib/model-recents";
import { navigateToSettingsSection, resolveHashView } from "@/lib/hash-routing";
import { DEFAULT_ACCOUNT } from "@/lib/account-defaults";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";

const ACTIVE_VIEW_STORAGE_KEY = "mission-control-active-view";
const RAIL_COLLAPSED_STORAGE_KEY = "mission-control-rail-collapsed";
const MODEL_PREFERENCE_STORAGE_KEY = "mission-control-model-preference";
const PROJECTS_STORAGE_KEY = "mission-control-projects-v1";
const ACTIVE_PROJECT_STORAGE_KEY = "mission-control-active-project-v1";
const PROJECT_DETAIL_RIGHT_PANEL_ENABLED = true;
const SIDEBAR_NEW_CHAT_DEFAULT_AGENT_ID = "agent_9afe71830d";
const SIDEBAR_NEW_CHAT_DEFAULT_AGENT_NAME = "Hermes (Direct)";

type LoadState = "idle" | "loading" | "error";
type NoticeTone = "info" | "success" | "warning" | "error";
type ReasoningLevel = "Low" | "Medium" | "High";

type PendingProjectDelete = ProjectRecord | null;
type PendingProjectEdit = ProjectRecord | null;
type PendingConversationDelete = ConversationRecord | null;
type PendingChangeProject = ConversationRecord | null;

const seedProjects: ProjectRecord[] = [
  {
    id: "project-new",
    name: "new",
    starred: true,
    archived: false,
    createdAt: "2026-05-15T00:00:00.000Z",
    updatedAt: "2026-05-15T00:00:00.000Z",
    description: "Default project for new Mission Control threads and experiments.",
  },
  {
    id: "project-mission-control",
    name: "Mission Control",
    starred: true,
    archived: false,
    createdAt: "2026-05-15T00:01:00.000Z",
    updatedAt: "2026-05-15T00:01:00.000Z",
    description: "Sidebar, routing, and operational workspace improvements for the standalone app.",
  },
  {
    id: "project-workspace",
    name: "Hermes Workspace",
    starred: false,
    archived: false,
    createdAt: "2026-05-15T00:02:00.000Z",
    updatedAt: "2026-05-15T00:02:00.000Z",
    description: "Hermes Workspace parity references, previews, and chat UX research.",
  },
];

function loadStoredProjects(): ProjectRecord[] {
  if (typeof window === "undefined") return seedProjects;
  try {
    const raw = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (!raw) return seedProjects;
    const parsed = JSON.parse(raw) as ProjectRecord[];
    if (!Array.isArray(parsed) || parsed.length === 0) return seedProjects;
    return parsed.map((project) => ({ ...project, starred: Boolean(project.starred), archived: Boolean(project.archived) }));
  } catch {
    return seedProjects;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function formatRelativeTime(value?: string | null): string {
  if (!value) return "just now";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "just now";
  const seconds = Math.max(1, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function conversationProjectId(conversation: ConversationRecord): string | null {
  return conversation.project_id ?? conversation.projectId ?? null;
}

function projectIdFromHash(hash: string): string | null {
  const match = /^#\/projects\/([^/?#]+)/.exec(hash || "");
  return match ? decodeURIComponent(match[1]) : null;
}

function buildConversationTitle(agent: AgentRecord, count: number): string {
  const base = agent.name || "Hermes";
  return count === 0 ? `${base} · New session` : `${base} · Session ${count + 1}`;
}

function providerLabel(agent?: AgentRecord | null): string {
  return agent?.provider_capabilities?.effective_provider_label
    ?? agent?.provider_capabilities?.requested_provider_label
    ?? "openai-codex";
}

function modelForAgent(agent?: AgentRecord | null, fallback = "gpt-5.5"): string {
  return agent?.provider_capabilities?.effective_model
    ?? agent?.provider_capabilities?.requested_model
    ?? agent?.preferred_model
    ?? fallback;
}

function reasoningLevelForAgent(agent?: AgentRecord | null): ReasoningLevel | null {
  const effort = agent?.advanced?.reasoning_effort?.toLowerCase();
  if (effort === "low") return "Low";
  if (effort === "medium") return "Medium";
  if (effort === "high") return "High";
  return null;
}

function findSidebarNewChatDefaultAgent(agents: AgentRecord[], entityTree: EntityRecord[]): AgentRecord | null {
  const personalEntityIds = new Set(entityTree.filter((entity) => entity.name.toLowerCase() === "personal" || entity.type === "personal").map((entity) => entity.id));
  return agents.find((agent) => agent.id === SIDEBAR_NEW_CHAT_DEFAULT_AGENT_ID)
    ?? agents.find((agent) => agent.name === SIDEBAR_NEW_CHAT_DEFAULT_AGENT_NAME && (agent.operating_entity === "Personal" || (agent.entity_id ? personalEntityIds.has(agent.entity_id) : false)))
    ?? agents.find((agent) => agent.name === SIDEBAR_NEW_CHAT_DEFAULT_AGENT_NAME)
    ?? null;
}

function resolveDefaultChatModel(settingsDefaultModel: string | null, agent: AgentRecord | null, previousModel: string): string {
  if (settingsDefaultModel) return settingsDefaultModel;
  if (agent?.preferred_model) return agent.preferred_model;
  if (previousModel) {
    console.warn(`Settings default model and agent preferred_model not found, falling back to ${previousModel}`);
    return previousModel;
  }
  return "gpt-5.5";
}

function InlineNotice({ tone, title, detail, icon, action }: { tone: NoticeTone; title: string; detail?: string; icon?: ReactNode; action?: ReactNode }) {
  const toneClass = {
    info: "border-sky-300/20 bg-sky-300/8 text-sky-100",
    success: "border-emerald-300/20 bg-emerald-300/8 text-emerald-100",
    warning: "border-amber-300/25 bg-amber-300/10 text-amber-100",
    error: "border-red-400/25 bg-red-400/10 text-red-100",
  }[tone];
  return (
    <div className={cn("flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm", toneClass)}>
      <div className="flex min-w-0 gap-3">
        <div className="mt-0.5 shrink-0">{icon ?? <AlertTriangle className="h-4 w-4" />}</div>
        <div className="min-w-0">
          <div className="font-medium">{title}</div>
          {detail && <div className="mt-1 text-xs opacity-75">{detail}</div>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function ProjectDeleteModal({ project, onCancel, onConfirm }: { project: PendingProjectDelete; onCancel: () => void; onConfirm: () => void }) {
  if (!project) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="delete-project-title">
      <div className="w-full max-w-md rounded-[28px] border border-red-400/25 bg-background/95 p-5 shadow-2xl">
        <div id="delete-project-title" className="font-expanded text-sm uppercase tracking-[0.18em] text-red-200">Delete project?</div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          This will permanently delete '{project.name}' and cannot be undone. Conversations tagged to this project will be detached, not deleted.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button className="border border-red-400/35 bg-red-500/15 text-red-100 hover:bg-red-500/25" onClick={onConfirm}>Delete project</Button>
        </div>
      </div>
    </div>
  );
}

function ProjectEditModal({ project, onCancel, onSave }: { project: PendingProjectEdit; onCancel: () => void; onSave: (project: ProjectRecord, values: { name: string; description: string }) => void }) {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");

  useEffect(() => {
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
  }, [project]);

  useEffect(() => {
    if (!project) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, project]);

  if (!project) return null;
  const trimmedName = name.trim();
  const saveDisabled = trimmedName.length === 0;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="edit-project-title">
      <div className="w-full max-w-lg rounded-[28px] border border-foreground/12 bg-background/95 p-5 shadow-2xl">
        <div id="edit-project-title" className="font-expanded text-sm uppercase tracking-[0.18em] text-foreground">Edit project</div>
        <div className="mt-5 space-y-4">
          <label className="block text-sm text-foreground/84">
            <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-muted-foreground">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
              className="h-11 w-full rounded-2xl border border-foreground/10 bg-card/50 px-3 text-sm text-foreground outline-none focus:border-[var(--warm-glow)]/45"
            />
            {saveDisabled && <span className="mt-2 block text-xs text-red-300">Name cannot be empty</span>}
          </label>
          <label className="block text-sm text-foreground/84">
            <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-muted-foreground">Description</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Add a description for this project"
              className="min-h-[120px] w-full resize-none rounded-2xl border border-foreground/10 bg-card/50 px-3 py-3 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:border-[var(--warm-glow)]/45"
            />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button disabled={saveDisabled} onClick={() => onSave(project, { name: trimmedName, description: description.trim() })}>Save</Button>
        </div>
      </div>
    </div>
  );
}

function DeleteConversationModal({ conversation, onCancel, onConfirm }: { conversation: PendingConversationDelete; onCancel: () => void; onConfirm: () => void }) {
  return (
    <ConfirmActionModal
      open={Boolean(conversation)}
      onClose={onCancel}
      onConfirm={onConfirm}
      title="Delete Conversation"
      body="This permanently deletes the conversation and all its messages. This cannot be undone."
      confirmLabel="Delete"
      riskLevel="high"
    />
  );
}

function ChangeProjectModal({ conversation, projects, onCancel, onSelect }: { conversation: PendingChangeProject; projects: ProjectRecord[]; onCancel: () => void; onSelect: (projectId: string | null) => void }) {
  if (!conversation) return null;
  const activeProjectId = conversationProjectId(conversation);
  const activeProjects = projects.filter((project) => !project.archived);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="change-project-title">
      <div className="w-full max-w-lg rounded-[28px] border border-foreground/12 bg-background/95 p-5 shadow-2xl">
        <div id="change-project-title" className="font-expanded text-sm uppercase tracking-[0.18em] text-foreground">Change project</div>
        <p className="mt-2 text-sm text-muted-foreground">Move “{conversation.title}” to a project.</p>
        <div className="mt-4 max-h-[340px] space-y-2 overflow-y-auto">
          <button type="button" onClick={() => onSelect(null)} className={cn("flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-left text-sm hover:bg-foreground/6", !activeProjectId ? "border-[var(--warm-glow)] bg-[color-mix(in_srgb,var(--warm-glow)_10%,transparent)]" : "border-foreground/10")}>No project{!activeProjectId && <Check className="h-4 w-4 text-[var(--warm-glow)]" />}</button>
          {activeProjects.map((project) => (
            <button key={project.id} type="button" onClick={() => onSelect(project.id)} className={cn("flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-left text-sm hover:bg-foreground/6", activeProjectId === project.id ? "border-[var(--warm-glow)] bg-[color-mix(in_srgb,var(--warm-glow)_10%,transparent)]" : "border-foreground/10")}>
              <span className="flex min-w-0 items-center gap-2"><Folder className="h-4 w-4 shrink-0 opacity-70" /><span className="truncate">{project.name}</span></span>
              {activeProjectId === project.id && <Check className="h-4 w-4 text-[var(--warm-glow)]" />}
            </button>
          ))}
        </div>
        <div className="mt-5 flex justify-end"><Button variant="outline" onClick={onCancel}>Cancel</Button></div>
      </div>
    </div>
  );
}

function ProjectsView({ projects, activeProjectId, onSelectProject, onCreateProject, onToggleProjectStar, onEditProject, onArchiveProject, onDeleteProject, onRestoreProject }: {
  projects: ProjectRecord[];
  activeProjectId: string | null;
  onSelectProject: (project: ProjectRecord) => void;
  onCreateProject: () => void;
  onToggleProjectStar: (project: ProjectRecord) => void;
  onEditProject: (project: ProjectRecord) => void;
  onArchiveProject: (project: ProjectRecord) => void;
  onDeleteProject: (project: ProjectRecord) => void;
  onRestoreProject: (project: ProjectRecord) => void;
}) {
  const [query, setQuery] = useState("");
  const [showArchive, setShowArchive] = useState(false);
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const filtered = projects
    .filter((project) => !project.archived)
    .filter((project) => `${project.name} ${project.description ?? ""}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const archived = projects.filter((project) => project.archived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const runProjectAction = (project: ProjectRecord, action: (project: ProjectRecord) => void) => {
    setOpenProjectMenuId(null);
    action(project);
  };

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-2 py-3 sm:px-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-expanded text-3xl tracking-[-0.04em] text-foreground">Projects</h1>
        <div className="flex items-center gap-2">
          <select className="h-10 rounded-xl border border-foreground/10 bg-card/50 px-3 text-sm text-foreground outline-none">
            <option>Sort by Activity</option>
          </select>
          <Button onClick={onCreateProject}>New project</Button>
        </div>
      </div>
      <div className="relative mt-6">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects..." className="h-11 w-full rounded-2xl border border-foreground/10 bg-card/50 pl-10 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground" />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {filtered.map((project) => {
          const menuOpen = openProjectMenuId === project.id;
          return (
            <div
              key={project.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectProject(project)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectProject(project);
                }
              }}
              className={cn("group relative flex min-h-[150px] cursor-pointer flex-col rounded-[26px] border bg-card/42 p-5 text-left shadow-[0_18px_60px_rgba(0,0,0,0.18)] transition hover:-translate-y-0.5 hover:bg-card/58 focus:outline-none focus:ring-1 focus:ring-[var(--warm-glow)]/45", activeProjectId === project.id ? "border-[color-mix(in_srgb,var(--warm-glow)_36%,transparent)]" : "border-foreground/10")}
              data-testid="project-card"
              data-project-id={project.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 text-base font-semibold text-foreground">{project.name}</div>
                <div className="relative z-20 shrink-0" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    aria-label={`Project actions for ${project.name}`}
                    aria-expanded={menuOpen}
                    onClick={() => setOpenProjectMenuId((current) => current === project.id ? null : project.id)}
                    className={cn("flex h-8 w-8 items-center justify-center rounded-full border border-foreground/10 bg-background/45 text-muted-foreground transition hover:bg-foreground/8 hover:text-foreground focus:opacity-100 focus:outline-none sm:opacity-0 sm:group-hover:opacity-100", menuOpen && "opacity-100 sm:opacity-100")}
                  >
                    <Ellipsis className="h-4 w-4" />
                  </button>
                  {menuOpen && (
                    <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-foreground/10 bg-background/95 p-1 shadow-2xl backdrop-blur-xl" data-testid="projects-card-action-menu">
                      <button type="button" data-project-action="star" onClick={() => runProjectAction(project, onToggleProjectStar)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-foreground/6"><Star className={cn("h-3.5 w-3.5", project.starred && "fill-current text-[var(--warm-glow)]")} />{project.starred ? "Unstar" : "Star"}</button>
                      <button type="button" data-project-action="edit" onClick={() => runProjectAction(project, onEditProject)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-foreground/6"><Pencil className="h-3.5 w-3.5" />Edit details</button>
                      <button type="button" data-project-action="archive" onClick={() => runProjectAction(project, onArchiveProject)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-foreground/6"><Archive className="h-3.5 w-3.5" />Archive</button>
                      <div className="my-1 border-t border-foreground/10" />
                      <button type="button" data-project-action="delete" onClick={() => runProjectAction(project, onDeleteProject)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-red-300 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" />Delete</button>
                    </div>
                  )}
                </div>
              </div>
              {project.starred && <Star className="absolute bottom-5 right-5 h-4 w-4 fill-current text-[var(--warm-glow)]" />}
              <p className="mt-3 overflow-hidden pr-7 text-sm leading-6 text-muted-foreground" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{project.description || "No description yet."}</p>
              <div className="mt-auto pt-5 text-xs text-muted-foreground">Updated {formatRelativeTime(project.updatedAt)}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-8 rounded-[24px] border border-foreground/10 bg-card/32 p-4">
        <button type="button" onClick={() => setShowArchive((value) => !value)} className="flex w-full items-center justify-between text-left font-expanded text-xs uppercase tracking-[0.16em] text-foreground/75">
          Archive <span className="text-muted-foreground">{archived.length}</span>
        </button>
        {showArchive && (
          <div className="mt-4 space-y-2">
            {archived.length === 0 ? <div className="text-sm text-muted-foreground">Archive is empty.</div> : archived.map((project) => (
              <div key={project.id} className="flex items-center justify-between rounded-2xl border border-foreground/10 px-3 py-2 text-sm">
                <span>{project.name}</span>
                <Button variant="outline" onClick={() => onRestoreProject(project)}>Restore</Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ProjectConversationRow({ conversation, editing, onSelect, onToggleStar, onStartRename, onCommitRename, onCancelRename, onOpenChangeProject, onRemoveFromProject, onDelete }: {
  conversation: ConversationRecord;
  editing: boolean;
  onSelect: (conversation: ConversationRecord) => void;
  onToggleStar: (conversation: ConversationRecord) => void;
  onStartRename: (conversation: ConversationRecord) => void;
  onCommitRename: (conversation: ConversationRecord, title: string) => void;
  onCancelRename: () => void;
  onOpenChangeProject: (conversation: ConversationRecord) => void;
  onRemoveFromProject: (conversation: ConversationRecord) => void;
  onDelete: (conversation: ConversationRecord) => void;
}) {
  return (
    <div className="group/detail-row relative rounded-2xl border border-transparent transition hover:border-foreground/10 hover:bg-foreground/5" data-testid="project-detail-conversation-row" data-conversation-id={conversation.id}>
      {editing ? (
        <input
          autoFocus
          defaultValue={conversation.title || "Untitled conversation"}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") onCommitRename(conversation, event.currentTarget.value);
            if (event.key === "Escape") onCancelRename();
          }}
          onBlur={(event) => onCommitRename(conversation, event.currentTarget.value)}
          className="m-3 h-10 w-[calc(100%-1.5rem)] rounded-xl border border-[var(--warm-glow)] bg-background/80 px-3 text-sm text-foreground outline-none"
        />
      ) : (
        <button type="button" onClick={() => onSelect(conversation)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground/88">{conversation.title || "Untitled conversation"}</div>
            <div className="mt-1 text-xs text-muted-foreground">Last message {formatRelativeTime(conversation.last_message_at ?? conversation.updated_at)}</div>
          </div>
          {(conversation.starred ?? conversation.pinned) && <Star className="mt-0.5 h-4 w-4 shrink-0 fill-current text-[var(--warm-glow)]" />}
        </button>
      )}
      {!editing && (
        <div className="absolute right-3 top-1/2 z-20 -translate-y-1/2 opacity-0 transition group-hover/detail-row:opacity-100 group-focus-within/detail-row:opacity-100">
          <button type="button" aria-label={`Conversation actions for ${conversation.title}`} onClick={(event) => event.stopPropagation()} className="peer flex h-8 w-8 items-center justify-center rounded-lg hover:bg-foreground/8">
            <Ellipsis className="h-4 w-4" />
          </button>
          <div className="pointer-events-none absolute right-0 top-full z-50 mt-1 w-52 rounded-xl border border-foreground/10 bg-background/95 p-1 opacity-0 shadow-2xl backdrop-blur-xl transition peer-hover:pointer-events-auto peer-hover:opacity-100 hover:pointer-events-auto hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100" data-testid="project-detail-conversation-menu">
            <button type="button" data-conversation-action="star" onClick={() => onToggleStar(conversation)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-foreground/6"><Star className="h-3.5 w-3.5" />Star</button>
            <button type="button" data-conversation-action="rename" onClick={() => onStartRename(conversation)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-foreground/6"><Pencil className="h-3.5 w-3.5" />Rename</button>
            <button type="button" data-conversation-action="change-project" onClick={() => onOpenChangeProject(conversation)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-foreground/6"><Folder className="h-3.5 w-3.5" />Change project</button>
            <button type="button" data-conversation-action="remove-project" onClick={() => onRemoveFromProject(conversation)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-foreground/6"><Archive className="h-3.5 w-3.5" />Remove from project</button>
            <div className="my-1 border-t border-foreground/10" />
            <button type="button" data-conversation-action="delete" onClick={() => onDelete(conversation)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-red-300 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" />Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectDetailView({ project, conversations, activeModel, sending, editingConversationId, onBack, onToggleProjectStar, onEditProject, onArchiveProject, onDeleteProject, onCreateConversation, onSelectConversation, onToggleConversationStar, onStartRenameConversation, onCommitRenameConversation, onCancelRenameConversation, onOpenChangeProject, onRemoveConversationFromProject, onDeleteConversation }: {
  project: ProjectRecord;
  conversations: ConversationRecord[];
  activeModel: string;
  sending: boolean;
  editingConversationId: string | null;
  onBack: () => void;
  onToggleProjectStar: (project: ProjectRecord) => void;
  onEditProject: (project: ProjectRecord) => void;
  onArchiveProject: (project: ProjectRecord) => void;
  onDeleteProject: (project: ProjectRecord) => void;
  onCreateConversation: (text: string) => void;
  onSelectConversation: (conversation: ConversationRecord) => void;
  onToggleConversationStar: (conversation: ConversationRecord) => void;
  onStartRenameConversation: (conversation: ConversationRecord) => void;
  onCommitRenameConversation: (conversation: ConversationRecord, title: string) => void;
  onCancelRenameConversation: () => void;
  onOpenChangeProject: (conversation: ConversationRecord) => void;
  onRemoveConversationFromProject: (conversation: ConversationRecord) => void;
  onDeleteConversation: (conversation: ConversationRecord) => void;
}) {
  const [draft, setDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const projectConversations = conversations
    .filter((conversation) => conversationProjectId(conversation) === project.id)
    .sort((a, b) => {
      const aStarred = Boolean(a.starred ?? a.pinned);
      const bStarred = Boolean(b.starred ?? b.pinned);
      if (aStarred !== bStarred) return aStarred ? -1 : 1;
      return String(b.last_message_at ?? b.updated_at ?? "").localeCompare(String(a.last_message_at ?? a.updated_at ?? ""));
    });

  const submit = () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    onCreateConversation(text);
  };

  return (
    <section className="grid w-full flex-1 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="mx-auto flex w-full max-w-5xl flex-col px-1 py-2">
        <button type="button" onClick={onBack} className="mb-5 inline-flex w-fit items-center gap-2 rounded-full px-2 py-1 text-sm text-muted-foreground transition hover:bg-foreground/6 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All projects
        </button>

        <div className="rounded-[32px] border border-foreground/8 bg-card/30 p-5 shadow-[0_22px_80px_rgba(0,0,0,0.18)]" data-testid="project-detail-header">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-serif text-4xl tracking-[-0.04em] text-[color-mix(in_srgb,var(--foreground)_90%,#f4dfbc)] sm:text-5xl">{project.name}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{project.description || "No description yet."}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" title={project.starred ? "Unstar" : "Star"} aria-label={project.starred ? "Unstar project" : "Star project"} onClick={() => onToggleProjectStar(project)} className="flex h-10 w-10 items-center justify-center rounded-full border border-foreground/10 bg-foreground/5 text-[var(--warm-glow)] hover:bg-foreground/8">
                <Star className={cn("h-5 w-5", project.starred && "fill-current")} />
              </button>
              <div className="relative">
                <button type="button" aria-label={`Project actions for ${project.name}`} className="peer flex h-10 w-10 items-center justify-center rounded-full border border-foreground/10 bg-foreground/5 hover:bg-foreground/8"><Ellipsis className="h-5 w-5" /></button>
                <div className="pointer-events-none absolute right-0 top-full z-50 mt-1 w-44 rounded-xl border border-foreground/10 bg-background/95 p-1 opacity-0 shadow-2xl backdrop-blur-xl transition peer-hover:pointer-events-auto peer-hover:opacity-100 hover:pointer-events-auto hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
                  <button type="button" onClick={() => onToggleProjectStar(project)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-foreground/6"><Star className="h-3.5 w-3.5" />{project.starred ? "Unstar" : "Star"}</button>
                  <button type="button" onClick={() => onEditProject(project)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-foreground/6"><Pencil className="h-3.5 w-3.5" />Edit details</button>
                  <button type="button" onClick={() => onArchiveProject(project)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-foreground/6"><Archive className="h-3.5 w-3.5" />Archive</button>
                  <div className="my-1 border-t border-foreground/10" />
                  <button type="button" onClick={() => onDeleteProject(project)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-red-300 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" />Delete</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-6 w-full max-w-3xl rounded-[28px] border border-foreground/10 bg-background/72 p-4 shadow-[0_24px_90px_rgba(0,0,0,0.34)] backdrop-blur-xl">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }}
            placeholder="How can I help you today?"
            disabled={sending}
            className="min-h-[88px] w-full resize-none border-none bg-transparent text-sm leading-6 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <input ref={fileInputRef} type="file" multiple className="hidden" />
            <button type="button" aria-label="Attach files" onClick={() => fileInputRef.current?.click()} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-foreground/7 hover:text-foreground"><Plus className="h-4 w-4" /></button>
            <div className="flex items-center gap-2">
              <span>{activeModel}</span>
              <Mic className="h-4 w-4" />
              <button type="button" aria-label="Send message" disabled={!draft.trim() || sending} onClick={submit} className="ml-1 flex h-9 w-9 items-center justify-center rounded-full border border-[var(--warm-glow)]/35 bg-[var(--warm-glow)]/12 text-[var(--warm-glow)] transition hover:bg-[var(--warm-glow)]/20 disabled:cursor-not-allowed disabled:opacity-45">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-7 space-y-1" data-testid="project-detail-conversation-list">
          {projectConversations.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-foreground/10 px-4 py-8 text-center text-sm text-muted-foreground">No conversations in this project yet.</div>
          ) : projectConversations.map((conversation) => (
            <ProjectConversationRow
              key={conversation.id}
              conversation={conversation}
              editing={editingConversationId === conversation.id}
              onSelect={onSelectConversation}
              onToggleStar={onToggleConversationStar}
              onStartRename={onStartRenameConversation}
              onCommitRename={onCommitRenameConversation}
              onCancelRename={onCancelRenameConversation}
              onOpenChangeProject={onOpenChangeProject}
              onRemoveFromProject={onRemoveConversationFromProject}
              onDelete={onDeleteConversation}
            />
          ))}
        </div>
      </div>

      {PROJECT_DETAIL_RIGHT_PANEL_ENABLED && (
        <aside className="space-y-4 py-2 xl:sticky xl:top-5 xl:h-fit" data-testid="project-detail-right-panel">
          <div className="rounded-[24px] border border-foreground/10 bg-card/38 p-4">
            <div className="flex items-center justify-between"><h2 className="font-expanded text-xs uppercase tracking-[0.16em] text-foreground/78">Memory</h2><span className="inline-flex items-center gap-1 rounded-full border border-foreground/10 px-2 py-1 text-[10px] text-muted-foreground"><Lock className="h-3 w-3" />Only you</span></div>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">Project memory will show here after a few chats.</p>
          </div>
          <div className="rounded-[24px] border border-foreground/10 bg-card/38 p-4">
            <div className="flex items-center justify-between"><h2 className="font-expanded text-xs uppercase tracking-[0.16em] text-foreground/78">Instructions</h2><Pencil className="h-4 w-4 text-muted-foreground" /></div>
            <p className="relative mt-4 overflow-hidden text-sm leading-6 text-muted-foreground" style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>No project instructions yet.</p>
          </div>
          <div className="rounded-[24px] border border-foreground/10 bg-card/38 p-4">
            <div className="flex items-center justify-between"><h2 className="font-expanded text-xs uppercase tracking-[0.16em] text-foreground/78">Files</h2><Plus className="h-4 w-4 text-muted-foreground" /></div>
            <div className="mt-4 rounded-[18px] border border-dashed border-foreground/14 bg-background/24 px-4 py-8 text-center text-sm leading-6 text-muted-foreground">Add PDFs, documents, or other text to reference in this project.</div>
          </div>
        </aside>
      )}
    </section>
  );
}

function Popover({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("absolute bottom-full left-0 z-50 mb-2 w-[320px] rounded-[22px] border border-foreground/10 bg-background/95 p-2 shadow-2xl shadow-black/40 backdrop-blur-xl", className)}>
      {children}
    </div>
  );
}

type LoadingPhrase = { face: string; verb: string };

type PendingAttachment = { id: string; file: File; url: string; status: "ready" | "uploading" | "error"; error?: string };
const MAX_CHAT_ATTACHMENTS = 10;
const MAX_CHAT_ATTACHMENT_BYTES = 50 * 1024 * 1024;
function isMediaFile(file: File): boolean { return file.type.startsWith("image/") || file.type.startsWith("video/"); }
function formatBytes(size: number): string { return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`; }
function shortModelName(model: string): string { return model.includes("/") ? model.split("/").pop() || model : model; }
function providerFromModel(model: string): string { return model.includes("/") ? model.split("/")[0] : "OpenAI Codex"; }
function modelGroups(models: string[]): Array<{ provider: string; models: string[] }> {
  const map = new Map<string, string[]>();
  models.forEach((model) => { const provider = providerFromModel(model); map.set(provider, [...(map.get(provider) ?? []), model]); });
  return Array.from(map.entries()).map(([provider, values]) => ({ provider, models: values.sort((a, b) => shortModelName(a).localeCompare(shortModelName(b))) }));
}

type AgentEntityTag = {
  label: "TRUST" | "HOLDINGS" | "MEDIA" | "PROPERTIES" | "CUSTOMS" | "PERSONAL";
  group: string;
  order: number;
  className: string;
};

const AGENT_ENTITY_TAGS: AgentEntityTag[] = [
  { label: "TRUST", group: "UMBRELLA CORPORATION TRUST", order: 0, className: "border-cyan-300/65 bg-cyan-300/10 text-cyan-200" },
  { label: "HOLDINGS", group: "UMBRELLA HOLDINGS", order: 1, className: "border-emerald-300/65 bg-emerald-300/10 text-emerald-200" },
  { label: "MEDIA", group: "UMBRELLA MEDIA", order: 2, className: "border-blue-300/65 bg-blue-300/10 text-blue-200" },
  { label: "PROPERTIES", group: "UMBRELLA PROPERTIES", order: 3, className: "border-slate-300/65 bg-slate-300/10 text-slate-200" },
  { label: "CUSTOMS", group: "UMBRELLA CUSTOMS", order: 4, className: "border-orange-300/70 bg-orange-300/10 text-orange-200" },
  { label: "PERSONAL", group: "PERSONAL", order: 5, className: "border-muted-foreground/45 bg-muted-foreground/10 text-muted-foreground" },
];

function flattenEntityTree(entities: EntityRecord[]): EntityRecord[] {
  return entities.flatMap((entity) => [entity, ...flattenEntityTree(entity.children ?? [])]);
}

function entityTagFromName(name?: string | null): AgentEntityTag {
  const normalized = (name ?? "").toLowerCase();
  if (normalized.includes("trust")) return AGENT_ENTITY_TAGS[0];
  if (normalized.includes("holdings")) return AGENT_ENTITY_TAGS[1];
  if (normalized.includes("media")) return AGENT_ENTITY_TAGS[2];
  if (normalized.includes("properties")) return AGENT_ENTITY_TAGS[3];
  if (normalized.includes("customs")) return AGENT_ENTITY_TAGS[4];
  if (normalized.includes("personal")) return AGENT_ENTITY_TAGS[5];
  return AGENT_ENTITY_TAGS[5];
}

function agentEntityTag(agent: AgentRecord, entityTree: EntityRecord[]): AgentEntityTag {
  const entities = flattenEntityTree(entityTree);
  const directEntity = entities.find((entity) => entity.id === agent.entity_id);
  if (directEntity) return entityTagFromName(directEntity.name);
  const treeEntity = entities.find((entity) => (entity.agents ?? []).some((treeAgent) => treeAgent.id === agent.id));
  if (treeEntity) return entityTagFromName(treeEntity.name);
  return entityTagFromName(agent.operating_entity);
}

function sortedAgentsForSelector(agents: AgentRecord[], entityTree: EntityRecord[]): Array<{ agent: AgentRecord; tag: AgentEntityTag; showHeader: boolean }> {
  const sorted = agents
    .map((agent) => ({ agent, tag: agentEntityTag(agent, entityTree) }))
    .sort((a, b) => a.tag.order - b.tag.order || a.agent.name.localeCompare(b.agent.name) || a.agent.id.localeCompare(b.agent.id));
  return sorted.map((item, index) => ({ ...item, showHeader: index === 0 || sorted[index - 1].tag.label !== item.tag.label }));
}


function formatLoadingElapsed(startedAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m`;
}

function renderToolText(message: ConversationMessage): string {
  return (message.tool_events ?? []).map((tool) => `${tool.name} · ${tool.status}`).join("\n");
}

function AttachmentThumbGrid({ attachments }: { attachments: ChatAttachment[] }) {
  const [lightbox, setLightbox] = useState<ChatAttachment | null>(null);
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="message-attachments">
      {attachments.map((item) => (
        <button key={item.id} type="button" onClick={() => setLightbox(item)} className="group overflow-hidden rounded-xl border border-foreground/10 bg-black/20 text-left">
          <div className="flex aspect-video items-center justify-center bg-black/30">
            {item.kind === "video" ? <video src={item.url} className="h-full w-full object-cover" muted preload="metadata" /> : <img src={item.url} alt={item.filename} className="h-full w-full object-cover" />}
          </div>
          <div className="truncate px-2 py-1 text-[10px] text-muted-foreground">{item.filename}</div>
        </button>
      ))}
      {lightbox && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-6" onClick={() => setLightbox(null)}>
          <div className="max-h-full max-w-5xl overflow-hidden rounded-2xl border border-foreground/10 bg-background p-3">
            {lightbox.kind === "video" ? <video src={lightbox.url} controls className="max-h-[78vh] max-w-full" /> : <img src={lightbox.url} alt={lightbox.filename} className="max-h-[78vh] max-w-full" />}
            <div className="mt-2 text-xs text-muted-foreground">{lightbox.filename}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function AttachmentChip({ item, onRemove }: { item: PendingAttachment; onRemove: () => void }) {
  return <div data-testid="attachment-chip" className={cn("flex max-w-[220px] items-center gap-2 rounded-xl border bg-foreground/5 p-1.5 pr-2", item.status === "error" ? "border-red-400/50 text-red-100" : "border-foreground/10")}>
    <div className="flex h-10 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/30">{item.file.type.startsWith("video/") ? <video src={item.url} className="h-full w-full object-cover" muted preload="metadata" /> : <img src={item.url} alt="" className="h-full w-full object-cover" />}</div>
    <div className="min-w-0 flex-1"><div className="truncate text-[11px] text-foreground/85">{item.file.name}</div><div className="text-[10px] text-muted-foreground">{formatBytes(item.file.size)}</div>{item.error && <div className="truncate text-[10px] text-red-200" title={item.error}>{item.error}</div>}</div>
    <button type="button" aria-label={`Remove ${item.file.name}`} onClick={onRemove} className="rounded-full p-1 hover:bg-foreground/10"><X className="h-3 w-3" /></button>
  </div>;
}

function ChatMessageRow({ message, loadingPhrases }: { message: ConversationMessage; loadingPhrases: LoadingPhrase[] }) {
  const isUser = message.role === "user";
  const isWaiting = message.client_status === "thinking" && !message.content;
  const copyText = [message.content, renderToolText(message)].filter(Boolean).join("\n\n");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [elapsed, setElapsed] = useState("0s");
  const loadingStartedRef = useRef<number>(0);

  useEffect(() => {
    if (!isWaiting) {
      loadingStartedRef.current = Date.now();
      setElapsed("0s");
      setPhraseIndex(0);
      return undefined;
    }
    loadingStartedRef.current = Date.now();
    const tick = () => setElapsed(formatLoadingElapsed(loadingStartedRef.current));
    tick();
    const elapsedTimer = window.setInterval(tick, 1000);
    const phraseTimer = window.setInterval(() => {
      setPhraseIndex((current) => (loadingPhrases.length ? (current + 1) % loadingPhrases.length : 0));
    }, 5000);
    return () => {
      window.clearInterval(elapsedTimer);
      window.clearInterval(phraseTimer);
    };
  }, [isWaiting, loadingPhrases.length]);

  useEffect(() => {
    if (copyState === "idle") return undefined;
    const timer = window.setTimeout(() => setCopyState("idle"), 1500);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const activePhrase = loadingPhrases[phraseIndex] ?? { face: "(◉_◉)", verb: "musing" };
  const handleCopy = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div className={cn(
        "group/message relative max-w-[760px] rounded-[26px] border px-4 py-3 text-sm leading-6 shadow-[0_18px_50px_rgba(0,0,0,0.20)]",
        isUser
          ? "border-[color-mix(in_srgb,var(--warm-glow)_28%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_11%,transparent)] text-foreground"
          : "border-foreground/10 bg-card/62 text-foreground/92",
      )} data-testid={isUser ? "chat-message-user" : "chat-message-assistant"}>
        {copyText && (
          <div className="absolute -right-2 -top-2 z-10 flex items-center gap-2 opacity-0 transition group-hover/message:opacity-100 group-focus-within/message:opacity-100">
            {copyState === "copied" && <span className="rounded-full border border-emerald-300/20 bg-background/90 px-2 py-1 text-[10px] text-emerald-200 shadow-lg">Copied</span>}
            {copyState === "failed" && <span className="rounded-full border border-red-300/20 bg-background/90 px-2 py-1 text-[10px] text-red-200 shadow-lg">Copy failed</span>}
            <button
              type="button"
              aria-label="Copy message"
              onClick={handleCopy}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-foreground/10 bg-background/90 text-muted-foreground shadow-lg transition hover:text-foreground"
            >
              {copyState === "copied" ? <Check className="h-3.5 w-3.5 text-emerald-200" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
        <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {isUser ? "You" : "Hermes"}
        </div>
        {message.client_status === "error" ? (
          <div className="text-red-200">{message.error_message || "The assistant response failed."}</div>
        ) : message.content ? (
          <MarkdownRenderer content={message.content} />
        ) : isWaiting ? (
          <div className="inline-flex items-center gap-2 font-mono text-[var(--warm-glow)]" data-testid="chat-loading-phrase">
            <span>{activePhrase.face}</span>
            <span>{activePhrase.verb}...</span>
            <span className="text-muted-foreground">· {elapsed}</span>
          </div>
        ) : null}
        {message.attachments?.length ? <AttachmentThumbGrid attachments={message.attachments} /> : null}
        {message.tool_events && message.tool_events.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.tool_events.map((tool) => (
              <span key={tool.id} className="rounded-full border border-foreground/10 bg-background/55 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {tool.name} · {tool.status}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HermesChatView({
  account,
  agents,
  entityTree,
  conversations,
  messages,
  composerText,
  sendingMessage,
  chatError,
  activeAgent,
  activeModel,
  activeProject,
  reasoningLevel,
  attachments,
  attachmentToast,
  modelOpen,
  availableModels,
  profilesOpen,
  reasoningOpen,
  onComposerChange,
  onSend,
  onSelectAgent,
  onToggleProfiles,
  onToggleReasoning,
  onSelectReasoning,
  onToggleModel,
  onSelectModel,
  onRemoveAttachment,
  onDropFiles,
  onPasteFiles,
  onRejectAttachment,
  onOpenSettings,
  onAttachFiles,
  onStartVoice,
}: {
  account: AccountRecord;
  agents: AgentRecord[];
  entityTree: EntityRecord[];
  conversations: BootstrapResponse["conversations"];
  messages: ConversationMessage[];
  composerText: string;
  sendingMessage: boolean;
  chatError: string;
  activeAgent: AgentRecord | null;
  activeModel: string;
  activeProject: ProjectRecord | null;
  reasoningLevel: ReasoningLevel;
  attachments: PendingAttachment[];
  attachmentToast: string;
  modelOpen: boolean;
  availableModels: string[];
  profilesOpen: boolean;
  reasoningOpen: boolean;
  onComposerChange: (value: string) => void;
  onSend: () => void;
  onSelectAgent: (agent: AgentRecord) => void;
  onToggleProfiles: () => void;
  onToggleReasoning: () => void;
  onSelectReasoning: (level: ReasoningLevel) => void;
  onToggleModel: () => void;
  onSelectModel: (model: string) => void;
  onRemoveAttachment: (id: string) => void;
  onDropFiles: (files: FileList | File[]) => void;
  onPasteFiles: (files: File[]) => void;
  onRejectAttachment: (message: string) => void;
  onOpenSettings: () => void;
  onAttachFiles: (files: FileList | null) => void;
  onStartVoice: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasThread = messages.length > 0;
  const displayProfile = activeAgent?.name ?? "default";
  const profileModel = activeModel;
  const selectorAgents = sortedAgentsForSelector(agents, entityTree);
  const [loadingPhrases, setLoadingPhrases] = useState<LoadingPhrase[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputAccept = "image/*,video/*";

  useEffect(() => {
    let cancelled = false;
    api.getLoadingPhrases()
      .then(({ faces, verbs }) => {
        if (cancelled) return;
        const phrases = verbs.flatMap((verb, verbIndex) => faces.map((face, faceIndex) => ({ face, verb, order: (verbIndex * 7 + faceIndex * 3) % 997 })))
          .sort((a, b) => a.order - b.order)
          .map(({ face, verb }) => ({ face, verb }));
        setLoadingPhrases(phrases);
      })
      .catch(() => setLoadingPhrases([]));
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="relative flex min-h-[calc(100vh-2rem)] flex-1 flex-col overflow-hidden rounded-[32px] border border-foreground/6 bg-[radial-gradient(circle_at_50%_32%,color-mix(in_srgb,var(--warm-glow)_10%,transparent),transparent_27%),linear-gradient(180deg,rgba(0,0,0,0.08),rgba(0,0,0,0.18))] px-5 py-4 sm:px-7">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        {activeProject && (
          <div className="inline-flex items-center gap-2" data-testid="chat-project-label">
            <Folder className="h-4 w-4" />
            <span className="text-foreground/78">{activeProject.name}</span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col pb-[150px]">
        {!hasThread && (
          <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center pt-12 text-center">
            <div className="mb-6 flex h-[78px] w-[78px] items-center justify-center overflow-hidden rounded-[18px] border border-foreground/12 bg-foreground/8 shadow-[0_0_45px_color-mix(in_srgb,var(--warm-glow)_18%,transparent)]">
              {account.avatar_image ? <img src={account.avatar_image} alt="" className="h-full w-full object-cover" /> : <Bot className="h-10 w-10 text-foreground/72" />}
            </div>
            <div className="font-expanded text-[11px] uppercase tracking-[0.44em] text-muted-foreground">Hermes Workspace</div>
            <h1 className="mt-3 font-serif text-4xl text-[color-mix(in_srgb,var(--foreground)_88%,#f4dfbc)] sm:text-5xl">Begin a session</h1>
            <div className="mt-3 text-sm text-[var(--warm-glow)]">{displayProfile} · {profileModel}</div>
            <div className="mt-5 text-sm text-muted-foreground">Agent chat · live tools · memory · full observability</div>
          </div>
        )}

        {hasThread && (
          <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 overflow-y-auto px-1 pb-8 pt-8">
            {messages.map((message) => <ChatMessageRow key={message.id} message={message} loadingPhrases={loadingPhrases} />)}
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-5 pb-5 sm:px-7">
        <div
          className={cn("pointer-events-auto relative mx-auto max-w-4xl rounded-[26px] border bg-background/80 p-4 shadow-[0_20px_80px_rgba(0,0,0,0.42)] backdrop-blur-xl", dragActive ? "border-[var(--warm-glow)]" : "border-foreground/10")}
          onDragEnter={(event) => { if (Array.from(event.dataTransfer.items ?? []).some((item) => item.kind === "file")) { event.preventDefault(); setDragActive(true); } }}
          onDragOver={(event) => { if (Array.from(event.dataTransfer.items ?? []).some((item) => item.kind === "file")) { event.preventDefault(); setDragActive(true); } }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }}
          onDrop={(event) => { event.preventDefault(); setDragActive(false); const files = Array.from(event.dataTransfer.files); if (files.length && !files.some(isMediaFile)) onRejectAttachment("Only images and videos can be attached"); onDropFiles(files); }}
        >
          {dragActive && <div data-testid="drop-overlay" className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-[22px] border border-dashed border-[var(--warm-glow)] bg-background/80 text-sm text-[var(--warm-glow)] backdrop-blur-sm">Drop image or video to attach</div>}
          {chatError && <div className="mb-2 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-100">{chatError}</div>}
          {attachmentToast && <div className="mb-2 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">{attachmentToast}</div>}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              {attachments.map((item) => <AttachmentChip key={item.id} item={item} onRemove={() => onRemoveAttachment(item.id)} />)}
            </div>
          )}
          <textarea
            value={composerText}
            onChange={(event) => onComposerChange(event.target.value)}
            onPaste={(event) => { const files = Array.from(event.clipboardData.items).filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter((file): file is File => Boolean(file)); const media = files.filter(isMediaFile); if (media.length) { event.preventDefault(); onPasteFiles(media); } else if (files.length) onRejectAttachment("Only images and videos can be attached"); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder="Ask anything..."
            disabled={sendingMessage}
            className="min-h-[58px] w-full resize-none border-none bg-transparent text-sm leading-6 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <button type="button" onClick={onToggleProfiles} className="inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/5 px-3 py-1.5 text-foreground/82 hover:border-foreground/18 hover:bg-foreground/8">
                {displayProfile}<ChevronDown className="h-3.5 w-3.5" />
              </button>
              {profilesOpen && (
                <Popover>
                  <div className="px-2 py-1 font-expanded text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Agent Selector</div>
                  <div className="mt-1 max-h-[520px] overflow-y-auto" data-testid="agent-selector-list">
                    {selectorAgents.map(({ agent, tag, showHeader }) => {
                      const active = agent.id === activeAgent?.id;
                      return (
                        <div key={agent.id}>
                          {showHeader && <div className="px-3 pb-1 pt-2 text-[9px] uppercase tracking-[0.2em] text-muted-foreground/75">{tag.group}</div>}
                          <button type="button" onClick={() => onSelectAgent(agent)} className="flex w-full items-start gap-3 rounded-2xl px-3 py-2 text-left transition hover:bg-foreground/6">
                            <BrainCircuit className={cn("mt-0.5 h-4 w-4 shrink-0", active ? "text-[var(--warm-glow)]" : "text-muted-foreground")} />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2 text-sm text-foreground/86">
                                <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                                {active && <span className="rounded-full border border-[var(--warm-glow)]/30 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[var(--warm-glow)]">active</span>}
                                <span data-testid="agent-entity-pill" className={cn("rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em]", tag.className)}>{tag.label}</span>
                              </span>
                              <span className="mt-0.5 block text-[11px] text-muted-foreground">{modelForAgent(agent)} · {providerLabel(agent)}</span>
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </Popover>
              )}

              <button type="button" onClick={onToggleReasoning} className="inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/5 px-3 py-1.5 text-foreground/82 hover:border-foreground/18 hover:bg-foreground/8">
                {reasoningLevel}<ChevronDown className="h-3.5 w-3.5" />
              </button>
              {reasoningOpen && (
                <Popover className="left-[120px] w-[210px]">
                  <div className="px-2 py-1 font-expanded text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Reasoning</div>
                  {(["Low", "Medium", "High"] as ReasoningLevel[]).map((level) => (
                    <button key={level} type="button" onClick={() => onSelectReasoning(level)} className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-foreground/6">
                      {level}{level === reasoningLevel && <Check className="h-4 w-4 text-[var(--warm-glow)]" />}
                    </button>
                  ))}
                </Popover>
              )}
              <button type="button" onClick={onToggleModel} className="inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/5 px-3 py-1.5 text-foreground/82 hover:border-foreground/18 hover:bg-foreground/8" data-testid="model-chip">
                {activeModel}<ChevronDown className="h-3.5 w-3.5" />
              </button>
              {modelOpen && (
                <Popover className="left-[220px] bottom-12 w-[330px]">
                  <div className="px-2 py-1 font-expanded text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Model</div>
                  <div className="mt-1 max-h-[360px] overflow-y-auto" data-testid="model-selector-list">
                    {modelGroups(availableModels).map((group) => <div key={group.provider}>
                      <div className="px-3 pb-1 pt-2 text-[9px] uppercase tracking-[0.2em] text-muted-foreground/75">{group.provider}</div>
                      {group.models.map((model) => <button key={model} type="button" onClick={() => onSelectModel(model)} className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left transition hover:bg-foreground/6">
                        <span className="min-w-0"><span className="block truncate text-sm text-foreground/86">{shortModelName(model)}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{providerFromModel(model)} / {model}</span></span>
                        {model === activeModel && <span className="rounded-full border border-[var(--warm-glow)]/30 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[var(--warm-glow)]">active</span>}
                      </button>)}
                    </div>)}
                  </div>
                </Popover>
              )}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <input ref={fileInputRef} type="file" accept={fileInputAccept} multiple className="hidden" onChange={(event) => onAttachFiles(event.target.files)} />
              <button type="button" aria-label="Attach files" onClick={() => fileInputRef.current?.click()} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-foreground/7 hover:text-foreground"><Paperclip className="h-4 w-4" /></button>
              <button type="button" aria-label="Tuning settings" onClick={onOpenSettings} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-foreground/7 hover:text-foreground"><SlidersHorizontal className="h-4 w-4" /></button>
              <button type="button" aria-label="Voice input" onClick={onStartVoice} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-foreground/7 hover:text-foreground"><Mic className="h-4 w-4" /></button>
              <button type="button" aria-label="Send message" disabled={(!composerText.trim() && attachments.length === 0) || sendingMessage} onClick={onSend} className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--warm-glow)]/35 bg-[var(--warm-glow)]/12 text-[var(--warm-glow)] transition hover:bg-[var(--warm-glow)]/20 disabled:cursor-not-allowed disabled:opacity-45">
                {sendingMessage ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <span>↵ to send · ⇧↵ new line</span>
            <span>{conversations.length} sessions</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [composerText, setComposerText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [chatError, setChatError] = useState("");
  const [mutationNotice, setMutationNotice] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [activeView, setActiveView] = useState<ActiveView>(() => {
    if (typeof window === "undefined") return "new-chat";
    const resolved = resolveHashView(window.location.hash);
    if (!resolved.fallback && window.location.hash !== "") return resolved.view;
    const stored = window.localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY);
    return stored === "monitor" || stored === "maintenance" || stored === "new-chat" || stored === "settings" || stored === "briefings" || stored === "inbox" || stored === "agents" || stored === "projects" || stored === "tracking" ? stored : "new-chat";
  });
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(() => {
    if (typeof window === "undefined") return "models";
    return resolveHashView(window.location.hash).settingsSection;
  });
  const [recentsTick, setRecentsTick] = useState(0);
  const [defaultModel, setDefaultModelState] = useState<string | null>(() => getDefaultModel());
  const [railCollapsed, setRailCollapsed] = useState(() => typeof window !== "undefined" && window.localStorage.getItem(RAIL_COLLAPSED_STORAGE_KEY) === "true");
  const [modelPreference, setModelPreference] = useState(() => typeof window === "undefined" ? "" : window.localStorage.getItem(MODEL_PREFERENCE_STORAGE_KEY) ?? "");
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [navUnreadTotal, setNavUnreadTotal] = useState(0);
  const [account, setAccount] = useState<AccountRecord>(DEFAULT_ACCOUNT);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [activeTheme, setActiveTheme] = useState<ThemeName>(() => {
    if (typeof window === "undefined") return DEFAULT_THEME.name;
    try {
      const curated = window.localStorage.getItem(THEME_STORAGE_KEY_V1);
      if (curated) {
        const def = getThemeDefinition(curated);
        applyTheme(def.name);
        applyBackground(getStoredBackground(), def.name);
        document.documentElement.setAttribute("data-theme", def.name);
        return def.name;
      }
      const legacy = getThemeDefinition(window.localStorage.getItem(THEME_STORAGE_KEY)).name;
      applyTheme(legacy);
      applyBackground(getStoredBackground(), legacy);
      return legacy;
    } catch {
      return DEFAULT_THEME.name;
    }
  });
  const [activeBackground, setActiveBackground] = useState<BackgroundId>(() => getStoredBackground());
  const [projects, setProjects] = useState<ProjectRecord[]>(loadStoredProjects);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => typeof window === "undefined" ? seedProjects[0]?.id ?? null : window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY) ?? seedProjects[0]?.id ?? null);
  const [projectDetailId, setProjectDetailId] = useState<string | null>(() => typeof window === "undefined" ? null : projectIdFromHash(window.location.hash));
  const [pendingDeleteProject, setPendingDeleteProject] = useState<PendingProjectDelete>(null);
  const [editingProject, setEditingProject] = useState<PendingProjectEdit>(null);
  const [pendingDeleteConversation, setPendingDeleteConversation] = useState<PendingConversationDelete>(null);
  const [pendingChangeProject, setPendingChangeProject] = useState<PendingChangeProject>(null);
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>("Low");
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentToast, setAttachmentToast] = useState("");
  const tempMessageIdRef = useRef(-1);
  const { send: sendChatStream } = useChatStream();
  const loadBootstrap = useCallback(async (nextAgentId?: string | null, nextConversationId?: string | null, applyDefaultChat = false) => {
    const applyDefaultChatResolution = (response: BootstrapResponse) => {
      const defaultAgent = findSidebarNewChatDefaultAgent(response.agents, response.entity_tree ?? []);
      const fallbackAgent = response.agents[0] ?? null;
      const nextAgent = defaultAgent ?? fallbackAgent;
      if (!defaultAgent && fallbackAgent) console.warn(`Default agent 'Hermes (Direct)' not found, falling back to ${fallbackAgent.name}`);
      if (nextAgent) {
        setSelectedAgentId(nextAgent.id);
        const defaultReasoning = reasoningLevelForAgent(nextAgent);
        if (defaultReasoning) setReasoningLevel(defaultReasoning);
      }
      const settingsDefault = getDefaultModel();
      setDefaultModelState(settingsDefault);
      setModelPreference(resolveDefaultChatModel(settingsDefault, nextAgent, window.localStorage.getItem(MODEL_PREFERENCE_STORAGE_KEY) ?? ""));
      setActiveProjectId(null);
      try { window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY); } catch { /* ignore */ }
    };

    setState("loading");
    setError("");
    try {
      const response = await api.getBootstrap();
      setBootstrap(response);
      const fallbackAgentId = response.agents.find((agent) => /app developer|hermes/i.test(agent.name))?.id ?? response.agents[0]?.id ?? null;
      if (applyDefaultChat && typeof nextAgentId === "undefined" && typeof nextConversationId === "undefined") {
        applyDefaultChatResolution(response);
      } else {
        setSelectedAgentId((current) => nextAgentId ?? current ?? fallbackAgentId);
      }
      if (typeof nextConversationId !== "undefined") setSelectedConversationId(nextConversationId);
      setState("idle");
      return response;
    } catch (err) {
      setBootstrap(mockBootstrap);
      if (applyDefaultChat && typeof nextAgentId === "undefined" && typeof nextConversationId === "undefined") {
        applyDefaultChatResolution(mockBootstrap);
      } else {
        setSelectedAgentId((current) => nextAgentId ?? current ?? mockBootstrap.agents[0]?.id ?? null);
      }
      if (typeof nextConversationId !== "undefined") setSelectedConversationId(nextConversationId);
      setState("idle");
      setError(err instanceof Error ? err.message : "Failed to load Mission Control");
      return mockBootstrap;
    }
  }, []);

  useEffect(() => {
    void loadBootstrap(undefined, undefined, true);
    void api.getAccount().then(setAccount).catch(() => undefined);
  }, [loadBootstrap]);

  useEffect(() => {
    const loadUnread = () => void api.getUnreadCounts().then((counts) => setNavUnreadTotal(Object.values(counts).reduce((sum, count) => sum + (Number(count) || 0), 0))).catch(() => undefined);
    loadUnread();
    const id = window.setInterval(loadUnread, 60000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    try {
      applyTheme(activeTheme);
      applyBackground(activeBackground, activeTheme);
      setStoredBackground(activeBackground);
      window.localStorage.setItem(THEME_STORAGE_KEY, activeTheme);
      const curatedIds = CURATED_THEMES.map((theme) => theme.id) as string[];
      if (curatedIds.includes(activeTheme)) {
        window.localStorage.setItem(THEME_STORAGE_KEY_V1, activeTheme);
        document.documentElement.setAttribute("data-theme", activeTheme);
      }
    } catch {
      // ignore theme persistence failures
    }
  }, [activeTheme, activeBackground]);

  useEffect(() => {
    try { window.localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, activeView); } catch { /* ignore */ }
    const target = activeView === "settings" ? `#/settings/${settingsSection}`
      : activeView === "briefings" ? "#/briefings"
      : activeView === "inbox" ? "#/inbox"
      : activeView === "agents" ? "#/agents"
      : activeView === "projects" ? (projectDetailId ? `#/projects/${encodeURIComponent(projectDetailId)}` : "#/projects")
      : activeView === "tracking" ? (window.location.hash.startsWith("#/tracking?") ? window.location.hash : "#/tracking")
      : activeView === "monitor" ? "#/monitor"
      : activeView === "maintenance" ? "#/maintenance"
      : "#/";
    if (typeof window !== "undefined" && window.location.hash !== target) window.history.replaceState(null, "", target);
  }, [activeView, settingsSection, projectDetailId]);

  useEffect(() => {
    const applyFromHash = () => {
      const resolved = resolveHashView(window.location.hash);
      setActiveView((current) => current === resolved.view ? current : resolved.view);
      setProjectDetailId(resolved.view === "projects" ? projectIdFromHash(window.location.hash) : null);
      if (resolved.view === "settings") setSettingsSection(resolved.settingsSection);
      if (resolved.redirectToModels && window.location.hash !== "#/settings/models") window.history.replaceState(null, "", "#/settings/models");
    };
    window.addEventListener("hashchange", applyFromHash);
    applyFromHash();
    return () => window.removeEventListener("hashchange", applyFromHash);
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === RECENTS_STORAGE_KEY) setRecentsTick((n) => n + 1);
      if (event.key === DEFAULT_MODEL_STORAGE_KEY) setDefaultModelState(getDefaultModel());
      if (event.key === PROJECTS_STORAGE_KEY) setProjects(loadStoredProjects());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(RAIL_COLLAPSED_STORAGE_KEY, String(railCollapsed)); } catch { /* ignore */ }
  }, [railCollapsed]);

  useEffect(() => {
    try { window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects)); } catch { /* ignore */ }
  }, [projects]);

  useEffect(() => {
    try {
      if (activeProjectId) window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, activeProjectId);
      else window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
    } catch { /* ignore */ }
  }, [activeProjectId]);

  useEffect(() => {
    if (!modelPreference) return;
    try { window.localStorage.setItem(MODEL_PREFERENCE_STORAGE_KEY, modelPreference); } catch { /* ignore */ }
  }, [modelPreference]);

  const selectedAgent = bootstrap?.agents.find((agent) => agent.id === selectedAgentId) ?? null;
  const catalogModels = bootstrap?.catalog.models ?? [];
  const selectedConversation = bootstrap?.conversations.find((conversation) => conversation.id === selectedConversationId) ?? null;
  const activeModelPreference = selectedConversation?.preferred_model || modelPreference || defaultModel || selectedAgent?.preferred_model || catalogModels[0] || "gpt-5.5";
  void recentsTick;
  const recentsForPicker = getRecentsPadded(catalogModels, defaultModel ?? activeModelPreference);
  const activeProject = activeProjectId ? projects.find((project) => project.id === activeProjectId && !project.archived) ?? null : null;
  const detailProject = projects.find((project) => project.id === projectDetailId && !project.archived) ?? null;

  const openSettingsModels = useCallback(() => {
    setActiveView("settings");
    setSettingsSection("models");
    if (window.location.hash !== "#/settings/models") window.history.pushState(null, "", "#/settings/models");
  }, []);

  const openSettingsSection = useCallback((section: SettingsSection) => {
    setActiveView("settings");
    setSettingsSection(section);
    navigateToSettingsSection(section);
  }, []);

  const handleSelectView = (view: ActiveView) => {
    setActiveView(view);
    if (view === "projects") setProjectDetailId(null);
    if (view !== "projects") setProjectDetailId(null);
    if (view === "new-chat") {
      const defaultAgent = bootstrap ? findSidebarNewChatDefaultAgent(bootstrap.agents, bootstrap.entity_tree ?? []) : null;
      const fallbackAgent = selectedAgent ?? bootstrap?.agents[0] ?? null;
      const nextAgent = defaultAgent ?? fallbackAgent;
      if (!defaultAgent && fallbackAgent) console.warn(`Default agent 'Hermes (Direct)' not found, falling back to ${fallbackAgent.name}`);
      if (nextAgent) {
        setSelectedAgentId(nextAgent.id);
        const defaultReasoning = reasoningLevelForAgent(nextAgent);
        if (defaultReasoning) setReasoningLevel(defaultReasoning);
      }
      const settingsDefault = getDefaultModel();
      setDefaultModelState(settingsDefault);
      setModelPreference(resolveDefaultChatModel(settingsDefault, nextAgent, modelPreference));
      setMessages([]);
      setSelectedConversationId(null);
      setComposerText("");
      setChatError("");
      setAttachments([]);
      setActiveProjectId(null);
      setProfilesOpen(false);
      setReasoningOpen(false);
      setModelOpen(false);
      try {
        window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
      } catch { /* ignore */ }
    }
  };

  const upsertProjects = (updater: (current: ProjectRecord[]) => ProjectRecord[]) => {
    setProjects((current) => updater(current).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  };

  const handleSelectProject = (project: ProjectRecord) => {
    setActiveProjectId(project.id);
    setProjectDetailId(project.id);
    setActiveView("projects");
    if (typeof window !== "undefined") window.history.pushState(null, "", `#/projects/${encodeURIComponent(project.id)}`);
  };

  const handleBackToProjects = () => {
    setProjectDetailId(null);
    setActiveView("projects");
    if (typeof window !== "undefined") window.history.pushState(null, "", "#/projects");
  };

  const handleToggleProjectStar = (project: ProjectRecord) => {
    upsertProjects((current) => current.map((item) => item.id === project.id ? { ...item, starred: !item.starred, updatedAt: nowIso() } : item));
  };

  const handleEditProject = (project: ProjectRecord) => {
    setEditingProject(project);
  };

  const handleSaveProjectDetails = (project: ProjectRecord, values: { name: string; description: string }) => {
    upsertProjects((current) => current.map((item) => item.id === project.id ? { ...item, name: values.name, description: values.description, updatedAt: nowIso() } : item));
    setEditingProject(null);
  };

  const handleArchiveProject = (project: ProjectRecord) => {
    upsertProjects((current) => current.map((item) => item.id === project.id ? { ...item, archived: true, updatedAt: nowIso() } : item));
    if (activeProjectId === project.id) setActiveProjectId(projects.find((item) => item.id !== project.id && !item.archived)?.id ?? null);
  };

  const handleRestoreProject = (project: ProjectRecord) => {
    upsertProjects((current) => current.map((item) => item.id === project.id ? { ...item, archived: false, updatedAt: nowIso() } : item));
    setActiveProjectId(project.id);
  };

  const handleDeleteProject = (project: ProjectRecord) => setPendingDeleteProject(project);

  const confirmDeleteProject = async () => {
    if (!pendingDeleteProject) return;
    const deletingId = pendingDeleteProject.id;
    upsertProjects((current) => current.filter((item) => item.id !== deletingId));
    await Promise.all((bootstrap?.conversations ?? [])
      .filter((conversation) => conversationProjectId(conversation) === deletingId)
      .map((conversation) => api.updateConversation(conversation.id, { project_id: null })));
    if (activeProjectId === deletingId) setActiveProjectId(projects.find((item) => item.id !== deletingId && !item.archived)?.id ?? null);
    if (projectDetailId === deletingId) handleBackToProjects();
    setPendingDeleteProject(null);
    await refreshAfterConversationUpdate();
  };

  const handleCreateProject = () => {
    const name = window.prompt("Project name", "New project")?.trim();
    if (!name) return;
    const now = nowIso();
    const project: ProjectRecord = {
      id: `project-${crypto.randomUUID?.() ?? Date.now()}`,
      name,
      description: "New Mission Control project.",
      starred: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    upsertProjects((current) => [...current, project]);
    setActiveProjectId(project.id);
  };

  const handleSelectConversation = async (conversation: ConversationRecord) => {
    setSelectedConversationId(conversation.id);
    setSelectedAgentId(conversation.agent_id);
    setActiveProjectId(conversationProjectId(conversation));
    setActiveView("new-chat");
    setChatError("");
    try {
      const response = await api.getConversationMessages(conversation.id);
      setMessages(response.messages);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to load conversation.");
    }
  };

  const refreshAfterConversationUpdate = async () => {
    await loadBootstrap(selectedAgentId, selectedConversationId);
  };

  const handleToggleConversationStar = async (conversation: ConversationRecord) => {
    const next = !(conversation.starred ?? conversation.pinned);
    await api.updateConversation(conversation.id, { starred: next, pinned: next });
    await refreshAfterConversationUpdate();
  };

  const handleCommitRenameConversation = async (conversation: ConversationRecord, title: string) => {
    const cleanTitle = title.trim();
    setEditingConversationId(null);
    if (!cleanTitle || cleanTitle === conversation.title) return;
    await api.updateConversation(conversation.id, { name: cleanTitle });
    await refreshAfterConversationUpdate();
  };

  const handleChangeConversationProject = async (projectId: string | null) => {
    if (!pendingChangeProject) return;
    await api.updateConversation(pendingChangeProject.id, { project_id: projectId });
    setPendingChangeProject(null);
    await refreshAfterConversationUpdate();
  };

  const handleRemoveConversationFromProject = async (conversation: ConversationRecord) => {
    if (!conversationProjectId(conversation)) return;
    await api.updateConversation(conversation.id, { project_id: null });
    await refreshAfterConversationUpdate();
  };

  const confirmDeleteConversation = async () => {
    if (!pendingDeleteConversation) return;
    const deletingId = pendingDeleteConversation.id;
    await api.deleteConversation(deletingId);
    if (selectedConversationId === deletingId) {
      setSelectedConversationId(null);
      setMessages([]);
      setComposerText("");
      setChatError("");
      setActiveProjectId(null);
      setProjectDetailId(null);
      setActiveView("new-chat");
      if (typeof window !== "undefined") window.history.pushState(null, "", "/");
    }
    setPendingDeleteConversation(null);
    await loadBootstrap(selectedAgentId, selectedConversationId === deletingId ? null : selectedConversationId);
  };

  const showAttachmentToast = (message: string) => {
    setAttachmentToast(message);
    window.setTimeout(() => setAttachmentToast((current) => current === message ? "" : current), 2500);
  };

  const addAttachments = (input: FileList | File[] | null) => {
    if (!input) return;
    const incoming = Array.from(input);
    const media = incoming.filter(isMediaFile);
    if (incoming.length && media.length !== incoming.length) showAttachmentToast("Only images and videos can be attached");
    if (!media.length) return;
    setAttachments((current) => {
      const availableSlots = MAX_CHAT_ATTACHMENTS - current.length;
      if (availableSlots <= 0) { showAttachmentToast("Maximum 10 attachments per message"); return current; }
      const accepted = media.slice(0, availableSlots);
      if (accepted.length < media.length) showAttachmentToast("Maximum 10 attachments per message");
      const totalSize = current.reduce((sum, item) => sum + item.file.size, 0) + accepted.reduce((sum, file) => sum + file.size, 0);
      if (totalSize > MAX_CHAT_ATTACHMENT_BYTES) { showAttachmentToast("Total attachment size exceeds 50 MB"); return current; }
      return [...current, ...accepted.map((file) => ({ id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`, file, url: URL.createObjectURL(file), status: "ready" as const }))];
    });
  };

  const handleAttachFiles = (files: FileList | null) => {
    addAttachments(files);
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((current) => {
      const removing = current.find((item) => item.id === id);
      if (removing) URL.revokeObjectURL(removing.url);
      return current.filter((item) => item.id !== id);
    });
  };

  const handleSelectModel = async (model: string) => {
    setModelPreference(model);
    setModelOpen(false);
    try { window.localStorage.setItem(MODEL_PREFERENCE_STORAGE_KEY, model); } catch { /* ignore */ }
    if (selectedConversationId) {
      await api.updateConversation(selectedConversationId, { preferred_model: model });
      await loadBootstrap(selectedAgentId, selectedConversationId);
    }
  };

  const handleStartVoice = () => {
    const SpeechRecognition = (window as unknown as { SpeechRecognition?: typeof window.webkitSpeechRecognition; webkitSpeechRecognition?: typeof window.webkitSpeechRecognition }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: typeof window.webkitSpeechRecognition }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setChatError("Voice input is not available in this browser.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const text = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" ").trim();
      if (text) setComposerText((current) => `${current}${current ? " " : ""}${text}`);
    };
    recognition.onerror = () => setChatError("Voice input failed.");
    recognition.start();
  };

  const ensureConversation = async (agent: AgentRecord, projectId: string | null = null) => {
    const count = bootstrap?.conversations.filter((conversation) => conversation.agent_id === agent.id).length ?? 0;
    const response = await api.createConversation(agent.id, buildConversationTitle(agent, count), projectId);
    if (activeModelPreference) await api.updateConversation(response.conversation.id, { preferred_model: activeModelPreference });
    return response.conversation.id;
  };

  const handleProjectDetailSend = async (content: string) => {
    if (!content.trim() || sendingMessage || !selectedAgent || !detailProject) return;
    setSendingMessage(true);
    setChatError("");
    try {
      const count = bootstrap?.conversations.filter((conversation) => conversation.agent_id === selectedAgent.id).length ?? 0;
      const response = await api.createConversation(selectedAgent.id, content.trim().slice(0, 80) || buildConversationTitle(selectedAgent, count), detailProject.id);
      const conversationId = response.conversation.id;
      setSelectedConversationId(conversationId);
      setActiveProjectId(detailProject.id);
      promoteOnSend(activeModelPreference);
      await sendChatStream(
        { agent_id: selectedAgent.id, conversation_id: conversationId, message: { role: "user", content: content.trim() } },
        { onStatus: (status) => { if (status === "error") setChatError("Assistant stream reported an error."); } },
      );
      await loadBootstrap(selectedAgent.id, conversationId);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to start project conversation.");
      await loadBootstrap(selectedAgent?.id, selectedConversationId);
    } finally {
      setSendingMessage(false);
    }
  };

  const handleSendMessage = async () => {
    const content = composerText.trim();
    if ((!content && attachments.length === 0) || sendingMessage || !selectedAgent) return;

    setSendingMessage(true);
    setChatError("");
    setMutationError("");
    setMutationNotice("");
    const optimisticUserId = tempMessageIdRef.current--;
    const optimisticAssistantId = tempMessageIdRef.current--;
    const optimisticAttachments: ChatAttachment[] = attachments.map((item) => ({ id: item.id, filename: item.file.name, content_type: item.file.type, size: item.file.size, url: item.url, kind: item.file.type.startsWith("video/") ? "video" : "image" }));
    const pendingFiles = attachments.map((item) => item.file);
    const optimisticUser: ConversationMessage = { id: optimisticUserId, role: "user", content, attachments: optimisticAttachments, client_status: "complete" };
    const optimisticAssistant: ConversationMessage = { id: optimisticAssistantId, role: "assistant", content: "", client_status: "thinking", tool_events: [] };
    setComposerText("");
    setMessages((current) => [...current, optimisticUser, optimisticAssistant]);
    promoteOnSend(activeModelPreference);
    setRecentsTick((n) => n + 1);

    try {
      const conversationId = selectedConversation?.id ?? await ensureConversation(selectedAgent, null);
      setSelectedConversationId(conversationId);
      if (activeModelPreference) await api.updateConversation(conversationId, { preferred_model: activeModelPreference });
      const uploadedAttachments = pendingFiles.length ? (await api.uploadChatAttachments(pendingFiles, conversationId)).attachments : [];
      const result = await sendChatStream(
        { agent_id: selectedAgent.id, conversation_id: conversationId, message: { role: "user", content }, attachments: uploadedAttachments, model: activeModelPreference },
        {
          onDelta: (text) => {
            setMessages((current) => current.map((message) => message.id === optimisticAssistantId ? { ...message, content: `${message.content}${text}`, client_status: "streaming" } : message));
          },
          onTool: (tool) => {
            setMessages((current) => current.map((message) => message.id === optimisticAssistantId ? { ...message, tool_events: [...(message.tool_events ?? []).filter((item) => item.id !== tool.id), tool] } : message));
          },
          onStatus: (status) => {
            if (status === "error") setChatError("Assistant stream reported an error.");
          },
        },
      );
      if (uploadedAttachments.length) setMessages((current) => current.map((message) => message.id === optimisticUserId ? { ...message, attachments: uploadedAttachments } : message));
      const finalContent = result.reply.content.trim();
      setMessages((current) => current.map((message) => message.id === optimisticAssistantId
        ? finalContent || message.content
          ? { ...message, content: message.content || finalContent, client_status: "complete" }
          : { ...message, content: "", client_status: "error", error_message: "Stream completed without assistant content." }
        : message));
      await loadBootstrap(selectedAgent.id, conversationId);
      attachments.forEach((item) => URL.revokeObjectURL(item.url));
      setAttachments([]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send message.";
      setMessages((current) => current.map((item) => item.id === optimisticAssistantId ? { ...item, content: "", client_status: "error", error_message: message } : item));
      setChatError(message);
    } finally {
      setSendingMessage(false);
    }
  };

  const mutationNoticeTone: NoticeTone | null = mutationError ? "error" : mutationNotice ? "success" : null;
  const isInitialLoading = state === "loading" && !bootstrap;
  const isRefreshingBootstrap = state === "loading" && Boolean(bootstrap);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="theme-background" />
      <div className="noise-overlay" />
      <div className="warm-glow" />
      <NavigationRail
        activeView={activeView}
        collapsed={railCollapsed}
        onToggleCollapsed={() => setRailCollapsed((current) => !current)}
        onSelectView={handleSelectView}
        onOpenSettingsSection={openSettingsSection}
        unreadTotal={navUnreadTotal}
        account={account}
        onOpenInstall={() => setShowInstallModal(true)}
        mobileOpen={showMobileNav}
        onCloseMobile={() => setShowMobileNav(false)}
        projects={projects}
        conversations={bootstrap?.conversations ?? []}
        activeProjectId={activeProject?.id ?? null}
        activeConversationId={selectedConversationId}
        editingConversationId={editingConversationId}
        onSelectProject={handleSelectProject}
        onToggleProjectStar={handleToggleProjectStar}
        onEditProject={handleEditProject}
        onArchiveProject={handleArchiveProject}
        onDeleteProject={handleDeleteProject}
        onRestoreProject={handleRestoreProject}
        onSelectConversation={(conversation) => void handleSelectConversation(conversation)}
        onToggleConversationStar={(conversation) => void handleToggleConversationStar(conversation)}
        onStartRenameConversation={(conversation) => setEditingConversationId(conversation.id)}
        onCommitRenameConversation={(conversation, title) => void handleCommitRenameConversation(conversation, title)}
        onCancelRenameConversation={() => setEditingConversationId(null)}
        onOpenChangeProject={setPendingChangeProject}
        onRemoveConversationFromProject={(conversation) => void handleRemoveConversationFromProject(conversation)}
        onDeleteConversation={setPendingDeleteConversation}
      />

      <main className={cn("relative z-10 flex min-h-screen flex-col px-4 py-4 transition-[margin] sm:px-6 lg:px-8 lg:py-6", railCollapsed ? "md:ml-16" : "md:ml-[220px]")}> 
        {isInitialLoading && (
          <div className="flex flex-1 items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading Mission Control…
          </div>
        )}

        {state === "error" && !bootstrap && (
          <Card className="flex-1">
            <CardContent className="flex h-full min-h-[320px] flex-col items-center justify-center gap-4 text-center">
              <AlertTriangle className="h-10 w-10 text-warning" />
              <div>
                <div className="font-expanded text-lg uppercase tracking-[0.1em]">Mission Control failed to load</div>
                <p className="mt-2 max-w-xl text-sm text-muted-foreground">{error}</p>
              </div>
              <Button onClick={() => void loadBootstrap(selectedAgentId, selectedConversationId)}>Retry</Button>
            </CardContent>
          </Card>
        )}

        {bootstrap && (
          <>
            <div className="mb-3 space-y-2">
              {isRefreshingBootstrap && <InlineNotice tone="info" title="Refreshing Mission Control" detail="Updating agents, conversations, and usage summaries." icon={<Loader2 className="h-4 w-4 animate-spin" />} />}
              {state === "error" && <InlineNotice tone="error" title="Refresh failed" detail={error || "Mission Control could not refresh. Existing data remains available."} />}
              {mutationNoticeTone && <InlineNotice tone={mutationNoticeTone} title={mutationError ? "Action failed" : "Update applied"} detail={mutationError || mutationNotice} />}
            </div>

            {activeView === "briefings" ? (
              <BriefingsView />
            ) : activeView === "inbox" ? (
              <InboxView agents={bootstrap.agents} />
            ) : activeView === "agents" ? (
              <AgentsView bootstrap={bootstrap} onRefresh={loadBootstrap} />
            ) : activeView === "projects" && detailProject ? (
              <ProjectDetailView
                project={detailProject}
                conversations={bootstrap.conversations}
                activeModel={activeModelPreference}
                sending={sendingMessage}
                editingConversationId={editingConversationId}
                onBack={handleBackToProjects}
                onToggleProjectStar={handleToggleProjectStar}
                onEditProject={handleEditProject}
                onArchiveProject={handleArchiveProject}
                onDeleteProject={handleDeleteProject}
                onCreateConversation={(text) => void handleProjectDetailSend(text)}
                onSelectConversation={(conversation) => void handleSelectConversation(conversation)}
                onToggleConversationStar={(conversation) => void handleToggleConversationStar(conversation)}
                onStartRenameConversation={(conversation) => setEditingConversationId(conversation.id)}
                onCommitRenameConversation={(conversation, title) => void handleCommitRenameConversation(conversation, title)}
                onCancelRenameConversation={() => setEditingConversationId(null)}
                onOpenChangeProject={setPendingChangeProject}
                onRemoveConversationFromProject={(conversation) => void handleRemoveConversationFromProject(conversation)}
                onDeleteConversation={setPendingDeleteConversation}
              />
            ) : activeView === "projects" ? (
              <ProjectsView
                projects={projects}
                activeProjectId={activeProject?.id ?? null}
                onSelectProject={handleSelectProject}
                onCreateProject={handleCreateProject}
                onToggleProjectStar={handleToggleProjectStar}
                onEditProject={handleEditProject}
                onArchiveProject={handleArchiveProject}
                onDeleteProject={handleDeleteProject}
                onRestoreProject={handleRestoreProject}
              />
            ) : activeView === "tracking" ? (
              <TrackingView agents={bootstrap.agents} initialAgentId={new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("agent_id")} initialItemId={new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("item_id")} />
            ) : activeView === "monitor" ? (
              <MonitorView agents={bootstrap.agents} />
            ) : activeView === "maintenance" ? (
              <MaintenanceView />
            ) : activeView === "settings" ? (
              <SettingsView
                section={settingsSection}
                catalog={recentsForPicker}
                onSelectSection={setSettingsSection}
                activeTheme={activeTheme}
                onSelectTheme={(id) => {
                  setActiveTheme(id);
                  setStoredTheme(id);
                  applyCuratedTheme(id);
                  applyBackground(activeBackground, id);
                }}
                activeBackground={activeBackground}
                onSelectBackground={(id) => {
                  setActiveBackground(id);
                  setStoredBackground(id);
                  applyBackground(id, activeTheme);
                }}
                account={account}
                onAccountChange={setAccount}
                onOpenInstall={() => setShowInstallModal(true)}
              />
            ) : (
              <HermesChatView
                account={account}
                agents={bootstrap.agents}
                entityTree={bootstrap.entity_tree ?? []}
                conversations={bootstrap.conversations}
                messages={messages}
                composerText={composerText}
                sendingMessage={sendingMessage}
                chatError={chatError}
                activeAgent={selectedAgent}
                activeModel={activeModelPreference}
                activeProject={activeProject}
                reasoningLevel={reasoningLevel}
                attachments={attachments}
                attachmentToast={attachmentToast}
                modelOpen={modelOpen}
                availableModels={catalogModels}
                profilesOpen={profilesOpen}
                reasoningOpen={reasoningOpen}
                onComposerChange={setComposerText}
                onSend={() => void handleSendMessage()}
                onSelectAgent={(agent) => {
                  setSelectedAgentId(agent.id);
                  setSelectedConversationId(null);
                  setMessages([]);
                  setProfilesOpen(false);
                  setComposerText("");
                  setActiveView("new-chat");
                }}
                onToggleProfiles={() => { setProfilesOpen((value) => !value); setReasoningOpen(false); setModelOpen(false); }}
                onToggleReasoning={() => { setReasoningOpen((value) => !value); setProfilesOpen(false); setModelOpen(false); }}
                onSelectReasoning={(level) => { setReasoningLevel(level); setReasoningOpen(false); }}
                onToggleModel={() => { setModelOpen((value) => !value); setProfilesOpen(false); setReasoningOpen(false); }}
                onSelectModel={(model) => void handleSelectModel(model)}
                onRemoveAttachment={handleRemoveAttachment}
                onDropFiles={addAttachments}
                onPasteFiles={addAttachments}
                onRejectAttachment={showAttachmentToast}
                onOpenSettings={openSettingsModels}
                onAttachFiles={handleAttachFiles}
                onStartVoice={handleStartVoice}
              />
            )}
          </>
        )}
      </main>

      <ProjectDeleteModal project={pendingDeleteProject} onCancel={() => setPendingDeleteProject(null)} onConfirm={() => void confirmDeleteProject()} />
      <ProjectEditModal project={editingProject} onCancel={() => setEditingProject(null)} onSave={handleSaveProjectDetails} />
      <ChangeProjectModal conversation={pendingChangeProject} projects={projects} onCancel={() => setPendingChangeProject(null)} onSelect={(projectId) => void handleChangeConversationProject(projectId)} />
      <DeleteConversationModal conversation={pendingDeleteConversation} onCancel={() => setPendingDeleteConversation(null)} onConfirm={() => void confirmDeleteConversation()} />
      <InstallModal open={showInstallModal} onClose={() => setShowInstallModal(false)} />
    </div>
  );
}

declare global {
  interface Window {
    webkitSpeechRecognition?: {
      new(): {
        continuous: boolean;
        interimResults: boolean;
        onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onerror: (() => void) | null;
        start: () => void;
      };
    };
  }
}

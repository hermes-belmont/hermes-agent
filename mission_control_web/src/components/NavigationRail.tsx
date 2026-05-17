import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Activity, Archive, BellRing, Download, Ellipsis, Folder, Inbox, ListTodo, Menu, MessageSquarePlus, Pencil, RotateCcw, Settings, Settings2, Star, Sun, Trash2, Users, Wrench } from "lucide-react";
import type { SettingsSection } from "@/components/SettingsView";
import { navigateToSettingsSection } from "@/lib/hash-routing";
import type { AccountRecord, ConversationRecord } from "@/lib/types";
import { DEFAULT_ACCOUNT } from "@/lib/account-defaults";
import { cn } from "@/lib/utils";

export type ActiveView = "new-chat" | "briefings" | "inbox" | "agents" | "projects" | "tracking" | "monitor" | "maintenance" | "settings";

export type ProjectRecord = {
  id: string;
  name: string;
  description?: string;
  starred: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

const items = [
  { id: "new-chat" as const, label: "New Chat", icon: MessageSquarePlus },
  { id: "briefings" as const, label: "Briefings", icon: BellRing },
  { id: "inbox" as const, label: "Inbox", icon: Inbox },
  { id: "agents" as const, label: "Agents", icon: Users },
  { id: "projects" as const, label: "Projects", icon: Folder },
  { id: "tracking" as const, label: "Tracking", icon: ListTodo },
  { id: "monitor" as const, label: "Monitor", icon: Activity },
  { id: "maintenance" as const, label: "Maintenance", icon: Wrench },
  { id: "settings" as const, label: "Settings", icon: Settings },
];

type RailContentProps = {
  activeView: ActiveView;
  collapsed?: boolean;
  onSelectView: (view: ActiveView) => void;
  onOpenSettingsSection?: (section: SettingsSection) => void;
  onOpenInstall?: () => void;
  unreadTotal?: number;
  account?: AccountRecord;
  projects?: ProjectRecord[];
  conversations?: ConversationRecord[];
  activeProjectId?: string | null;
  activeConversationId?: string | null;
  editingConversationId?: string | null;
  onSelectProject?: (project: ProjectRecord) => void;
  onToggleProjectStar?: (project: ProjectRecord) => void;
  onEditProject?: (project: ProjectRecord) => void;
  onArchiveProject?: (project: ProjectRecord) => void;
  onDeleteProject?: (project: ProjectRecord) => void;
  onRestoreProject?: (project: ProjectRecord) => void;
  onSelectConversation?: (conversation: ConversationRecord) => void;
  onToggleConversationStar?: (conversation: ConversationRecord) => void;
  onStartRenameConversation?: (conversation: ConversationRecord) => void;
  onCommitRenameConversation?: (conversation: ConversationRecord, title: string) => void;
  onCancelRenameConversation?: () => void;
  onOpenChangeProject?: (conversation: ConversationRecord) => void;
  onRemoveConversationFromProject?: (conversation: ConversationRecord) => void;
  onDeleteConversation?: (conversation: ConversationRecord) => void;
};

type MenuAction = "rename" | "move" | "delete";

function ProjectRow({ project, active, collapsed, onSelect, onToggleStar, onEdit, onArchive, onDelete, onRestore }: {
  project: ProjectRecord;
  active: boolean;
  collapsed: boolean;
  onSelect?: (project: ProjectRecord) => void;
  onToggleStar?: (project: ProjectRecord) => void;
  onEdit?: (project: ProjectRecord) => void;
  onArchive?: (project: ProjectRecord) => void;
  onDelete?: (project: ProjectRecord) => void;
  onRestore?: (project: ProjectRecord) => void;
}) {
  return (
    <div className="group/project relative" data-testid="project-row" data-project-id={project.id}>
      <button
        type="button"
        title={collapsed ? project.name : undefined}
        onClick={() => onSelect?.(project)}
        className={cn(
          "flex w-full items-center rounded-lg border border-transparent px-2 py-1.5 text-left text-foreground/72 transition hover:bg-foreground/5 hover:text-foreground",
          collapsed ? "justify-center" : "gap-2 pr-8",
          active && "border-[color-mix(in_srgb,var(--warm-glow)_25%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_8%,transparent)] text-foreground",
        )}
      >
        <Folder className={cn("h-3.5 w-3.5 shrink-0", active ? "text-[var(--warm-glow)]" : "opacity-70")} />
        {!collapsed && <span className="min-w-0 flex-1 truncate text-[11px]">{project.name}</span>}
      </button>
      {!collapsed && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition group-hover/project:opacity-100 group-focus-within/project:opacity-100">
          <button type="button" aria-label={`Project actions for ${project.name}`} className="peer flex h-6 w-6 items-center justify-center rounded-md hover:bg-foreground/8">
            <Ellipsis className="h-3.5 w-3.5" />
          </button>
          <div className="pointer-events-none absolute left-full top-0 z-50 ml-1 w-44 rounded-xl border border-foreground/10 bg-background/95 p-1 opacity-0 shadow-2xl backdrop-blur-xl transition peer-hover:pointer-events-auto peer-hover:opacity-100 hover:pointer-events-auto hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
            {!project.archived ? (
              <>
                <button type="button" data-project-action="toggle-star" onClick={() => onToggleStar?.(project)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-foreground/6"><Star className="h-3.5 w-3.5" />{project.starred ? "Unstar" : "Star"}</button>
                <button type="button" data-project-action="edit" onClick={() => onEdit?.(project)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-foreground/6"><Pencil className="h-3.5 w-3.5" />Edit details</button>
                <button type="button" data-project-action="archive" onClick={() => onArchive?.(project)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-foreground/6"><Archive className="h-3.5 w-3.5" />Archive</button>
                <button type="button" data-project-action="delete" onClick={() => onDelete?.(project)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-red-300 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" />Delete</button>
              </>
            ) : (
              <>
                <button type="button" data-project-action="restore" onClick={() => onRestore?.(project)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-foreground/6"><RotateCcw className="h-3.5 w-3.5" />Restore</button>
                <button type="button" data-project-action="delete" onClick={() => onDelete?.(project)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-red-300 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" />Delete</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ConversationRow({ conversation, active, editing, onSelect, onStartRename, onCommitRename, onCancelRename, onOpenChangeProject, onDelete }: {
  conversation: ConversationRecord;
  active: boolean;
  editing: boolean;
  onSelect?: (conversation: ConversationRecord) => void;
  onStartRename?: (conversation: ConversationRecord) => void;
  onCommitRename?: (conversation: ConversationRecord, title: string) => void;
  onCancelRename?: () => void;
  onOpenChangeProject?: (conversation: ConversationRecord) => void;
  onDelete?: (conversation: ConversationRecord) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const cancelRenameRef = useRef(false);
  const renameCommittedRef = useRef(false);
  const title = conversation.title || "Untitled conversation";

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!rowRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    window.setTimeout(() => itemRefs.current[0]?.focus(), 0);
  }, [menuOpen]);

  const runAction = (action: MenuAction) => {
    setMenuOpen(false);
    if (action === "rename") onStartRename?.(conversation);
    if (action === "move") onOpenChangeProject?.(conversation);
    if (action === "delete") onDelete?.(conversation);
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
    const index = items.findIndex((item) => item === document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(index + 1 + items.length) % items.length]?.focus();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    }
    if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    }
    if (event.key === "End") {
      event.preventDefault();
      items.at(-1)?.focus();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setMenuOpen(false);
    }
  };

  const commitRename = (value: string) => {
    if (cancelRenameRef.current || renameCommittedRef.current) {
      cancelRenameRef.current = false;
      return;
    }
    renameCommittedRef.current = true;
    onCommitRename?.(conversation, value);
  };

  return (
    <div ref={rowRef} className="group/recent relative" data-testid="recent-row" data-conversation-id={conversation.id}>
      {editing ? (
        <input
          autoFocus
          data-testid="recents-rename-input"
          defaultValue={title}
          onFocus={(event) => event.currentTarget.select()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitRename(event.currentTarget.value);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancelRenameRef.current = true;
              onCancelRename?.();
            }
          }}
          onBlur={(event) => commitRename(event.currentTarget.value)}
          className="h-8 w-full rounded-lg border border-[var(--warm-glow)] bg-background/80 px-2 text-[11px] text-foreground outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => onSelect?.(conversation)}
          className={cn(
            "flex h-8 w-full items-center rounded-lg border border-transparent px-2 pr-8 text-left text-foreground/70 transition hover:bg-foreground/5 hover:text-foreground",
            active && "border-[color-mix(in_srgb,var(--warm-glow)_25%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_8%,transparent)] text-foreground",
          )}
        >
          <span className="min-w-0 flex-1 truncate text-[11px]">{title}</span>
        </button>
      )}
      {!editing && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition group-hover/recent:opacity-100 group-focus-within/recent:opacity-100">
          <button
            type="button"
            aria-label={`Conversation actions for ${title}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((open) => !open);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-foreground/8 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--warm-glow)]"
          >
            <Ellipsis className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              aria-label={`Conversation actions for ${title}`}
              data-testid="recents-action-menu"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={onMenuKeyDown}
              className="absolute left-full top-0 z-50 ml-1 w-48 rounded-xl border border-foreground/10 bg-background/95 p-1 shadow-2xl backdrop-blur-xl"
            >
              <button ref={(node) => { itemRefs.current[0] = node; }} type="button" role="menuitem" data-conversation-action="rename" onClick={() => runAction("rename")} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-foreground/6 focus:bg-foreground/6 focus:outline-none"><Pencil className="h-3.5 w-3.5" />Rename</button>
              <button ref={(node) => { itemRefs.current[1] = node; }} type="button" role="menuitem" data-conversation-action="move-project" onClick={() => runAction("move")} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-foreground/6 focus:bg-foreground/6 focus:outline-none"><Folder className="h-3.5 w-3.5" />Move to project</button>
              <button ref={(node) => { itemRefs.current[2] = node; }} type="button" role="menuitem" data-conversation-action="delete" onClick={() => runAction("delete")} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-red-300 hover:bg-red-500/10 focus:bg-red-500/10 focus:outline-none"><Trash2 className="h-3.5 w-3.5" />Delete</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RailContent({ activeView, collapsed = false, onSelectView, onOpenSettingsSection, onOpenInstall, unreadTotal = 0, account = DEFAULT_ACCOUNT, projects = [], conversations = [], activeProjectId = null, activeConversationId = null, editingConversationId = null, ...handlers }: RailContentProps) {
  const openSettingsSection = (section: SettingsSection) => {
    onOpenSettingsSection?.(section);
    navigateToSettingsSection(section);
  };
  const starredProjects = projects.filter((project) => project.starred && !project.archived);
  const recentConversations = [...conversations].sort((a, b) => {
    const aStarred = Boolean(a.starred ?? a.pinned);
    const bStarred = Boolean(b.starred ?? b.pinned);
    if (aStarred !== bStarred) return aStarred ? -1 : 1;
    return String(b.last_message_at ?? b.updated_at ?? "").localeCompare(String(a.last_message_at ?? a.updated_at ?? ""));
  });

  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex items-center gap-2 px-1", collapsed && "justify-center px-0")}>
        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-[linear-gradient(135deg,var(--warm-glow),var(--warm-glow-deep))] font-expanded text-sm font-medium text-[var(--background-base)]">U</div>
        {!collapsed && (
          <div className="font-expanded uppercase leading-none tracking-[0.10em] text-foreground">
            <div className="text-[11px]">Umbrella</div>
            <div className="mt-1 text-[9px] opacity-55">Holdings Group</div>
          </div>
        )}
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col pr-0.5">
        {!collapsed && <div className="px-2 pb-1.5 pt-3.5 text-[9px] uppercase tracking-[0.16em] text-foreground/70">MAIN</div>}
        <div className="space-y-1.5">
          {items.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                title={collapsed ? item.label : undefined}
                onClick={() => onSelectView(item.id)}
                className={cn(
                  "relative flex w-full items-center rounded-lg border border-transparent px-2.5 py-2 text-left transition",
                  collapsed ? "justify-center" : "gap-[9px]",
                  active ? "border-[color-mix(in_srgb,var(--warm-glow)_30%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_10%,transparent)]" : "text-foreground/85 hover:bg-foreground/5 hover:text-foreground",
                )}
              >
                <Icon className={cn("h-4 w-4 shrink-0", active ? "text-[var(--warm-glow)]" : "opacity-62")} />
                {!collapsed && <span className={cn("min-w-0 flex-1 text-[11px] uppercase tracking-[0.10em]", active ? "font-medium text-foreground" : "opacity-62")}>{item.label}</span>}
                {!collapsed && item.id === "inbox" && unreadTotal > 0 && <span className="ml-auto rounded-full border border-[color-mix(in_srgb,var(--warm-glow)_35%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_14%,transparent)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--warm-glow)]">{unreadTotal}</span>}
                {collapsed && item.id === "inbox" && unreadTotal > 0 && <span className="absolute ml-5 mt-[-14px] h-2 w-2 rounded-full bg-[var(--warm-glow)] shadow-[0_0_10px_var(--warm-glow)]" />}
              </button>
            );
          })}
        </div>

        {!collapsed && (
          <>
            <div className="px-2 pb-1.5 pt-5 text-foreground/70" aria-label="Starred projects">
              <span className="sr-only">Starred projects</span>
              <Star className="h-3.5 w-3.5 opacity-80" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              {starredProjects.length === 0 ? <div className="px-2 py-1 text-[10px] text-muted-foreground/70">No starred projects</div> : starredProjects.map((project) => (
                <ProjectRow key={project.id} project={project} active={activeProjectId === project.id} collapsed={collapsed} onSelect={handlers.onSelectProject} onToggleStar={handlers.onToggleProjectStar} onEdit={handlers.onEditProject} onArchive={handlers.onArchiveProject} onDelete={handlers.onDeleteProject} onRestore={handlers.onRestoreProject} />
              ))}
            </div>

            <div className="px-2 pb-1.5 pt-5 text-[9px] uppercase tracking-[0.16em] text-foreground/70">RECENTS</div>
            <div className="max-h-[245px] min-h-[110px] overflow-y-auto pr-1" data-testid="recents-scroll-region">
              <div className="space-y-1">
                {recentConversations.length === 0 ? <div className="px-2 py-1 text-[10px] text-muted-foreground/70">No recent conversations</div> : recentConversations.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    active={activeConversationId === conversation.id}
                    editing={editingConversationId === conversation.id}
                    onSelect={handlers.onSelectConversation}
                    onStartRename={handlers.onStartRenameConversation}
                    onCommitRename={handlers.onCommitRenameConversation}
                    onCancelRename={handlers.onCancelRenameConversation}
                    onOpenChangeProject={handlers.onOpenChangeProject}
                    onDelete={handlers.onDeleteConversation}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className={cn("border-t border-foreground/8 pt-3.5", collapsed && "flex flex-col items-center gap-2")}>
        <div className={cn("flex items-center", collapsed ? "flex-col gap-2" : "gap-2")}>
          <button
            type="button"
            role="button"
            aria-label="Account settings"
            title={collapsed ? "Account settings" : undefined}
            onClick={() => openSettingsSection("account")}
            className={cn(
              "flex cursor-pointer items-center rounded-lg text-left transition hover:bg-foreground/6 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--warm-glow)]",
              collapsed ? "h-7 w-7 justify-center" : "min-w-0 flex-1 gap-2 px-1 py-1",
            )}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full font-expanded text-[10px] font-medium text-background-base" style={account.avatar_image ? undefined : { background: account.avatar_color }}>{account.avatar_image ? <img src={account.avatar_image} alt="" className="h-full w-full object-cover" /> : (account.display_name.trim()[0] || "D").toUpperCase()}</span>
            {!collapsed && <span className="min-w-0 flex-1 text-[11px] text-foreground">{account.display_name}</span>}
          </button>
          <button type="button" role="button" aria-label="Models settings" title="Models settings" onClick={() => openSettingsSection("models")} className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-foreground/60 transition hover:bg-foreground/6 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--warm-glow)]"><Settings2 className="h-3.5 w-3.5" /></button>
          <button type="button" role="button" aria-label="Theme settings" title="Theme settings" onClick={() => openSettingsSection("themes")} className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-foreground/60 transition hover:bg-foreground/6 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--warm-glow)]"><Sun className="h-3.5 w-3.5" /></button>
          <button type="button" role="button" aria-label="Install desktop app" title="Install desktop app" onClick={onOpenInstall} className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-foreground/60 transition hover:bg-foreground/6 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--warm-glow)]"><Download className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    </div>
  );
}

type Props = RailContentProps & {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
};

export function NavigationRail({ collapsed, onToggleCollapsed, mobileOpen, onCloseMobile, ...contentProps }: Props) {
  return (
    <>
      <aside className={cn("fixed left-0 top-0 z-30 hidden h-screen border-r border-foreground/10 bg-background/25 px-2.5 py-3.5 backdrop-blur-sm md:block", collapsed ? "w-16" : "w-[220px]")}>
        <button type="button" aria-label="Toggle navigation rail" onClick={onToggleCollapsed} className="absolute right-2 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-foreground/55 hover:bg-foreground/6 hover:text-foreground"><Menu className="h-3.5 w-3.5" /></button>
        <RailContent {...contentProps} collapsed={collapsed} />
      </aside>
      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden" onClick={onCloseMobile} />
          <aside className="fixed inset-y-0 left-0 z-50 w-[260px] border-r border-foreground/10 bg-background px-2.5 py-3.5 md:hidden">
            <RailContent {...contentProps} onSelectView={(view) => { contentProps.onSelectView(view); onCloseMobile(); }} />
          </aside>
        </>
      )}
    </>
  );
}

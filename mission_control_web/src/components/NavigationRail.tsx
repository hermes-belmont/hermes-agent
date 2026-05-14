import { Activity, BellRing, Download, Inbox, ListTodo, Menu, MessageSquarePlus, Settings, Settings2, Sun, Users, Wrench } from "lucide-react";
import type { SettingsSection } from "@/components/SettingsView";
import { navigateToSettingsSection } from "@/lib/hash-routing";
import type { AccountRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

export type ActiveView = "new-chat" | "briefings" | "inbox" | "agents" | "tracking" | "monitor" | "maintenance" | "settings";

const items = [
  { id: "new-chat" as const, label: "New Chat", icon: MessageSquarePlus },
  { id: "briefings" as const, label: "Briefings", icon: BellRing },
  { id: "inbox" as const, label: "Inbox", icon: Inbox },
  { id: "agents" as const, label: "Agents", icon: Users },
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
};

const DEFAULT_ACCOUNT: AccountRecord = { display_name: "David", avatar_color: "#ffbd38", preferences: { timezone: "America/New_York" } };

function RailContent({ activeView, collapsed = false, onSelectView, onOpenSettingsSection, onOpenInstall, unreadTotal = 0, account = DEFAULT_ACCOUNT }: RailContentProps) {
  const openSettingsSection = (section: SettingsSection) => {
    onOpenSettingsSection?.(section);
    navigateToSettingsSection(section);
  };

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
      <div className="mt-4 flex-1">
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

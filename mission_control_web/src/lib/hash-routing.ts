/**
 * Hash → view resolver.
 *
 * Pure helper kept separate from App.tsx so it can be unit-tested. The
 * companion view→hash projection lives inline in App.tsx as a useEffect; we
 * only need the inbound direction here.
 */

import type { SettingsSection } from "@/components/SettingsView";

export type AppView = "new-chat" | "briefings" | "inbox" | "agents" | "projects" | "tracking" | "monitor" | "maintenance" | "settings";

export type ResolvedHashView = {
  view: AppView;
  /** Always non-null so callers don't need a null check; defaults to "models". */
  settingsSection: SettingsSection;
  /** True when the hash was unrecognized and we fell back to "new-chat". */
  fallback: boolean;
  /** True when the hash was the bare "#/settings" redirect target. */
  redirectToModels: boolean;
};

export function settingsSectionHash(section: SettingsSection): string {
  return `#/settings/${section}`;
}

export function navigateToSettingsSection(section: SettingsSection): void {
  if (typeof window === "undefined") return;
  const target = settingsSectionHash(section);
  if (window.location.hash === target) return;
  window.location.hash = target;
}

export function legacyHashRedirect(rawHash: string): string | null {
  const hash = (rawHash || "").trim();
  if (hash === "#/briefings") return "#/cron";
  if (hash.startsWith("#/briefings/")) return `#/cron/${hash.slice("#/briefings/".length)}`;
  if (hash.startsWith("#/briefings?")) return `#/cron?${hash.slice("#/briefings?".length)}`;
  if (hash === "#/tracking") return "#/kanban";
  if (hash.startsWith("#/tracking/")) return `#/kanban/${hash.slice("#/tracking/".length)}`;
  if (hash.startsWith("#/tracking?")) return `#/kanban?${hash.slice("#/tracking?".length)}`;
  return null;
}

/**
 * Map a raw `window.location.hash` value to the canonical view + settings
 * section. Recognizes:
 *   "", "#", "#/", "#/new-chat"          → new-chat
 *   "#/cron"                             → briefings
 *   "#/kanban"                           → tracking
 *   "#/monitor"                          → monitor
 *   "#/maintenance"                      → maintenance
 *   "#/settings"                         → settings/models (redirect target)
 *   "#/settings/models|themes|desktop-remote|keys|config|skills|account"   → settings/<section>
 * Anything else falls back to new-chat with `fallback=true`.
 *
 * The handler is idempotent by construction: callers compare the result to the
 * current state and only setState on a real change.
 */
export function resolveHashView(rawHash: string): ResolvedHashView {
  const hash = (rawHash || "").trim();

  if (hash === "" || hash === "#" || hash === "#/" || hash === "#/new-chat") {
    return { view: "new-chat", settingsSection: "models", fallback: false, redirectToModels: false };
  }

  if (hash === "#/cron" || hash.startsWith("#/cron/") || hash.startsWith("#/cron?")) {
    return { view: "briefings", settingsSection: "models", fallback: false, redirectToModels: false };
  }

  if (hash === "#/inbox") {
    return { view: "inbox", settingsSection: "models", fallback: false, redirectToModels: false };
  }

  if (hash === "#/agents") {
    return { view: "agents", settingsSection: "models", fallback: false, redirectToModels: false };
  }

  if (hash === "#/projects" || hash.startsWith("#/projects/")) {
    return { view: "projects", settingsSection: "models", fallback: false, redirectToModels: false };
  }

  if (hash === "#/kanban" || hash.startsWith("#/kanban/") || hash.startsWith("#/kanban?")) {
    return { view: "tracking", settingsSection: "models", fallback: false, redirectToModels: false };
  }

  if (hash === "#/monitor" || hash.startsWith("#/monitor?")) {
    return { view: "monitor", settingsSection: "models", fallback: false, redirectToModels: false };
  }

  if (hash === "#/maintenance") {
    return { view: "maintenance", settingsSection: "models", fallback: false, redirectToModels: false };
  }

  if (hash === "#/settings" || hash === "#/settings/") {
    return { view: "settings", settingsSection: "models", fallback: false, redirectToModels: true };
  }

  if (hash === "#/settings/models") {
    return { view: "settings", settingsSection: "models", fallback: false, redirectToModels: false };
  }

  if (hash === "#/settings/themes") {
    return { view: "settings", settingsSection: "themes", fallback: false, redirectToModels: false };
  }

  if (hash === "#/settings/desktop-remote") {
    return { view: "settings", settingsSection: "desktop-remote", fallback: false, redirectToModels: false };
  }

  if (hash === "#/settings/keys") {
    return { view: "settings", settingsSection: "keys", fallback: false, redirectToModels: false };
  }

  if (hash === "#/settings/config") {
    return { view: "settings", settingsSection: "config", fallback: false, redirectToModels: false };
  }

  if (hash === "#/settings/skills") {
    return { view: "settings", settingsSection: "skills", fallback: false, redirectToModels: false };
  }

  if (hash === "#/settings/account") {
    return { view: "settings", settingsSection: "account", fallback: false, redirectToModels: false };
  }

  return { view: "new-chat", settingsSection: "models", fallback: true, redirectToModels: false };
}

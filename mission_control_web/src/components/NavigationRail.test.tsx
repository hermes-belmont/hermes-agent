/** @vitest-environment jsdom */

import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallModal } from "./InstallModal";
import { NavigationRail, type ProjectRecord } from "./NavigationRail";
import type { ConversationRecord } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const conversations: ConversationRecord[] = [
  {
    id: "conversation-1",
    agent_id: "agent-1",
    title: "Original conversation",
    project_id: null,
    updated_at: "2026-05-16T00:00:00.000Z",
    last_message_at: "2026-05-16T00:01:00.000Z",
    pinned: false,
    starred: false,
  },
];

const projects: ProjectRecord[] = [
  {
    id: "project-1",
    name: "Project One",
    starred: false,
    archived: false,
    createdAt: "2026-05-16T00:00:00.000Z",
    updatedAt: "2026-05-16T00:00:00.000Z",
  },
];

function renderRail(
  onOpenInstall = () => undefined,
  overrides: Partial<React.ComponentProps<typeof NavigationRail>> = {},
) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => {
    root.render(
      <NavigationRail
        activeView="new-chat"
        collapsed={false}
        onToggleCollapsed={() => undefined}
        onSelectView={() => undefined}
        onOpenInstall={onOpenInstall}
        mobileOpen={false}
        onCloseMobile={() => undefined}
        {...overrides}
      />,
    );
  });
}

function clickButton(selector: string) {
  const button = host.querySelector<HTMLButtonElement>(selector);
  expect(button).toBeTruthy();
  flushSync(() => {
    button?.click();
  });
}

function lastButtonText() {
  const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>("button"));
  return buttons.at(-1)?.textContent ?? "";
}

describe("NavigationRail footer settings links", () => {
  beforeEach(() => {
    window.location.hash = "#/";
    renderRail();
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    host.remove();
    window.location.hash = "#/";
  });

  it("changes the hash to account settings when David is clicked", () => {
    clickButton('[aria-label="Account settings"]');

    expect(window.location.hash).toBe("#/settings/account");
  });

  it("changes the hash to models settings when the slider icon is clicked", () => {
    clickButton('[aria-label="Models settings"]');

    expect(window.location.hash).toBe("#/settings/models");
  });

  it("changes the hash to theme settings when the sun icon is clicked", () => {
    clickButton('[aria-label="Theme settings"]');

    expect(window.location.hash).toBe("#/settings/themes");
  });

  it("renders the install desktop app download icon and invokes the install handler", () => {
    flushSync(() => root.unmount());
    host.remove();
    const onOpenInstall = vi.fn();
    renderRail(onOpenInstall);

    clickButton('[aria-label="Install desktop app"]');

    expect(onOpenInstall).toHaveBeenCalledTimes(1);
  });
});

describe("NavigationRail RECENTS conversation actions", () => {
  afterEach(() => {
    flushSync(() => root.unmount());
    host.remove();
  });

  it("opens a click-driven sidebar menu with Rename, Move to project, and Delete in order", () => {
    renderRail(undefined, { conversations, projects });

    clickButton('[aria-label="Conversation actions for Original conversation"]');

    const menu = host.querySelector('[data-testid="recents-action-menu"]');
    expect(menu).toBeTruthy();
    const labels = Array.from(menu?.querySelectorAll("button") ?? []).map((button) => button.textContent?.trim());
    expect(labels).toEqual(["Rename", "Move to project", "Delete"]);
  });

  it("starts inline rename and selects the existing title", () => {
    const onStartRenameConversation = vi.fn();
    renderRail(undefined, {
      conversations,
      projects,
      editingConversationId: "conversation-1",
      onStartRenameConversation,
    });

    const input = host.querySelector<HTMLInputElement>('[data-testid="recents-rename-input"]');
    expect(input).toBeTruthy();
    flushSync(() => input?.focus());

    expect(input?.value).toBe("Original conversation");
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe("Original conversation".length);
  });
});

describe("InstallModal states", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    host.remove();
  });

  function renderModal(stateOverride: "native" | "safari" | "unsupported" | "installed") {
    flushSync(() => {
      root.render(<InstallModal open onClose={() => undefined} stateOverride={stateOverride} />);
    });
  }

  it("renders native install copy", () => {
    renderModal("native");
    expect(host.textContent).toContain("Install Mission Control");
    expect(host.textContent).toContain("Get one-click access from your dock or taskbar");
    expect(lastButtonText()).toContain("Install");
  });

  it("renders Safari Add to Dock instructions", () => {
    renderModal("safari");
    expect(host.textContent).toContain("Install Mission Control on macOS");
    expect(host.textContent).toContain("Click the Share button in Safari");
    expect(host.textContent).toContain("Add to Dock");
    expect(lastButtonText()).toContain("Got it");
  });

  it("renders unsupported-browser copy", () => {
    renderModal("unsupported");
    expect(host.textContent).toContain("PWA install not supported");
    expect(host.textContent).toContain("Use Chrome or Edge on desktop");
    expect(lastButtonText()).toContain("Close");
  });

  it("renders already-installed copy", () => {
    renderModal("installed");
    expect(host.textContent).toContain("Mission Control is installed");
    expect(host.textContent).toContain("already running in app mode");
    expect(lastButtonText()).toContain("Close");
  });
});

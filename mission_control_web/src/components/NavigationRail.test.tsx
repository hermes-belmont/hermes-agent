/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallModal } from "./InstallModal";
import { NavigationRail } from "./NavigationRail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function renderRail(onOpenInstall = () => undefined) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NavigationRail
        activeView="new-chat"
        collapsed={false}
        onToggleCollapsed={() => undefined}
        onSelectView={() => undefined}
        onOpenInstall={onOpenInstall}
        mobileOpen={false}
        onCloseMobile={() => undefined}
      />,
    );
  });
}

function clickButton(selector: string) {
  const button = host.querySelector<HTMLButtonElement>(selector);
  expect(button).toBeTruthy();
  act(() => {
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
    act(() => root.unmount());
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
    act(() => root.unmount());
    host.remove();
    const onOpenInstall = vi.fn();
    renderRail(onOpenInstall);

    clickButton('[aria-label="Install desktop app"]');

    expect(onOpenInstall).toHaveBeenCalledTimes(1);
  });
});

describe("InstallModal states", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function renderModal(stateOverride: "native" | "safari" | "unsupported" | "installed") {
    act(() => {
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

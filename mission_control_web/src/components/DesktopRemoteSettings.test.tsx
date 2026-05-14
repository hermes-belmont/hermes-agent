/** @vitest-environment jsdom */
import React, { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopRemoteSettings } from "@/components/DesktopRemoteSettings";
import { InstallModal } from "@/components/InstallModal";
import { api } from "@/lib/api";
import type { TailscaleStatus } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  api: {
    getTailscaleStatus: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const notInstalled: TailscaleStatus = {
  installed: false,
  signed_in: false,
  version: null,
  hostname: null,
  tailscale_ip: null,
  exit_code: null,
  error_summary: "tailscale command not found",
};

const signedOut: TailscaleStatus = {
  installed: true,
  signed_in: false,
  version: "1.78.3",
  hostname: null,
  tailscale_ip: null,
  exit_code: 1,
  error_summary: "Logged out",
};

const connected: TailscaleStatus = {
  installed: true,
  signed_in: true,
  version: "1.78.3",
  hostname: "machine-name.tailnet.ts.net",
  tailscale_ip: "100.64.0.10",
  self_name: "machine-name",
  exit_code: 0,
};

function setStandaloneMatch(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === "(display-mode: standalone)" ? matches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function renderDesktopRemote(statusOverride: TailscaleStatus | null = null, onOpenInstall = vi.fn()) {
  act(() => {
    root.render(<DesktopRemoteSettings onOpenInstall={onOpenInstall} statusOverride={statusOverride} />);
  });
  return onOpenInstall;
}

function renderWithInstallModal() {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <DesktopRemoteSettings onOpenInstall={() => setOpen(true)} />
        <InstallModal open={open} onClose={() => setOpen(false)} stateOverride="unsupported" />
      </>
    );
  }
  act(() => {
    root.render(<Harness />);
  });
}

beforeEach(() => {
  setStandaloneMatch(false);
  vi.mocked(api.getTailscaleStatus).mockResolvedValue(notInstalled);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("DesktopRemoteSettings", () => {
  it("renders Desktop App and Remote Access sub-sections", () => {
    renderDesktopRemote();

    expect(host.textContent).toContain("Desktop App");
    expect(host.textContent).toContain("Remote Access");
  });

  it("shows an install button when display-mode is not standalone", () => {
    renderDesktopRemote();

    expect(host.textContent).toContain("Not installed");
    expect(Array.from(host.querySelectorAll("button")).some((button) => button.textContent?.includes("Install Desktop App"))).toBe(true);
  });

  it("shows installed status when standalone matchMedia returns true", () => {
    setStandaloneMatch(true);
    renderDesktopRemote();

    expect(host.textContent).toContain("Installed");
  });

  it("clicking install button opens the InstallModal", async () => {
    renderWithInstallModal();
    const install = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Install Desktop App"));

    await act(async () => {
      install?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.textContent).toContain("Desktop app install");
  });

  it("renders Tailscale setup steps and Check status button", () => {
    renderDesktopRemote();

    expect(host.textContent).toContain("Set up Tailscale");
    expect(host.textContent).toContain("Install Tailscale on this Mac");
    expect(host.textContent).toContain("Sign in to your Tailscale account");
    expect(Array.from(host.querySelectorAll("button")).some((button) => button.textContent?.includes("Check status"))).toBe(true);
  });

  it("clicking Check status calls getTailscaleStatus and updates status", async () => {
    vi.mocked(api.getTailscaleStatus).mockResolvedValue(connected);
    renderDesktopRemote(notInstalled);
    const check = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Check status"));

    await act(async () => {
      check?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(api.getTailscaleStatus).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Connected as machine-name.tailnet.ts.net");
    expect(host.textContent).toContain("http://machine-name.tailnet.ts.net:9120");
  });

  it("renders status indicators for not installed, signed out, and connected shapes", () => {
    renderDesktopRemote(notInstalled);
    expect(host.textContent).toContain("Not installed");

    act(() => root.render(<DesktopRemoteSettings onOpenInstall={vi.fn()} statusOverride={signedOut} />));
    expect(host.textContent).toContain("Installed, signed out");

    act(() => root.render(<DesktopRemoteSettings onOpenInstall={vi.fn()} statusOverride={connected} />));
    expect(host.textContent).toContain("Connected as machine-name.tailnet.ts.net");
  });
});

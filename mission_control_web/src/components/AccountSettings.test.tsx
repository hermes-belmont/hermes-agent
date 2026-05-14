/** @vitest-environment jsdom */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { SettingsView } from "@/components/SettingsView";
import { resizeAvatarFileToDataUri } from "@/lib/avatar";
import { NavigationRail } from "@/components/NavigationRail";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    getAccount: vi.fn(),
    updateAccount: vi.fn(),
    downloadAccountExport: vi.fn(),
    getAgentProfiles: vi.fn(),
    getUserBackgrounds: vi.fn(async () => []),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Account = {
  display_name: string;
  avatar_color: string;
  avatar_image?: string | null;
  preferences: { timezone: string };
};

let host: HTMLDivElement;
let root: Root;

function mockAvatarBrowser(dataUri = "data:image/png;base64,cmVzaXplZA==") {
  class MockFileReader {
    result: string | ArrayBuffer | null = null;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    readAsDataURL() {
      this.result = "data:image/png;base64,c291cmNl";
      this.onload?.();
    }
  }
  class MockImage {
    naturalWidth = 512;
    naturalHeight = 256;
    width = 512;
    height = 256;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    set src(_value: string) { this.onload?.(); }
  }
  vi.stubGlobal("FileReader", MockFileReader);
  vi.stubGlobal("Image", MockImage);
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tagName: string, options?: ElementCreationOptions) => {
    if (tagName === "canvas") {
      return {
        width: 0,
        height: 0,
        getContext: () => ({ clearRect: vi.fn(), drawImage: vi.fn() }),
        toDataURL: () => dataUri,
      } as unknown as HTMLCanvasElement;
    }
    return originalCreateElement(tagName, options);
  });
}

const account: Account = {
  display_name: "David",
  avatar_color: "#ffbd38",
  preferences: { timezone: "America/New_York" },
};

function renderAccount(onAccountChange = vi.fn()) {
  act(() => {
    root.render(
      <SettingsView
        section="account"
        catalog={[]}
        onSelectSection={vi.fn()}
        activeTheme="default"
        onSelectTheme={vi.fn()}
        activeBackground="theme-default"
        onSelectBackground={vi.fn()}
        account={account}
        onAccountChange={onAccountChange}
        onOpenInstall={vi.fn()}
      />,
    );
  });
}

beforeEach(() => {
  vi.mocked(api.getAccount).mockResolvedValue(account);
  vi.mocked(api.updateAccount).mockResolvedValue(account);
  vi.mocked(api.downloadAccountExport).mockResolvedValue("mission-control-export-2026-05-13.json");
  vi.mocked(api.getAgentProfiles).mockResolvedValue({ profiles: [] });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Account settings page", () => {
  it("renders all four sections", () => {
    renderAccount();

    expect(host.textContent).toContain("Profiles");
    expect(host.textContent).toContain("Time Zone");
    expect(host.textContent).toContain("Data Export");
    expect(host.textContent).toContain("Authentication");
  });

  it("uploading a file produces a PNG base64 data URI", async () => {
    mockAvatarBrowser();

    const result = await resizeAvatarFileToDataUri(new File(["x"], "avatar.png", { type: "image/png" }));

    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(result).toBe("data:image/png;base64,cmVzaXplZA==");
  });

  it("saves identity changes with the correct PATCH payload", async () => {
    const onAccountChange = vi.fn();
    renderAccount(onAccountChange);

    const input = host.querySelector('input[aria-label="Display name"]') as HTMLInputElement;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(input, "David Umbrella");
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "David Umbrella" }));
    });

    const save = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Save"));
    expect(save).toBeTruthy();
    await act(async () => {
      save?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(api.updateAccount).toHaveBeenCalledWith({ display_name: "David Umbrella", avatar_color: "#ffbd38" });
    expect(onAccountChange).toHaveBeenCalled();
  });

  it("saving identity sends avatar_image in the PATCH payload", async () => {
    mockAvatarBrowser("data:image/png;base64,YXZhdGFy");
    vi.mocked(api.updateAccount).mockResolvedValue({ ...account, avatar_image: "data:image/png;base64,YXZhdGFy" });
    renderAccount();

    const fileInput = host.querySelector('input[aria-label="Upload Avatar"]') as HTMLInputElement;
    Object.defineProperty(fileInput, "files", { configurable: true, value: [new File(["x"], "avatar.png", { type: "image/png" })] });
    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const save = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Save"));
    await act(async () => {
      save?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(api.updateAccount).toHaveBeenCalledWith({ display_name: "David", avatar_color: "#ffbd38", avatar_image: "data:image/png;base64,YXZhdGFy" });
  });

  it("remove custom avatar sends avatar_image null", async () => {
    const accountWithAvatar = { ...account, avatar_image: "data:image/png;base64,YXZhdGFy" };
    vi.mocked(api.updateAccount).mockResolvedValue({ ...account, avatar_image: null });
    act(() => {
      root.render(
        <SettingsView
          section="account"
          catalog={[]}
          onSelectSection={vi.fn()}
          activeTheme="default"
          onSelectTheme={vi.fn()}
          activeBackground="theme-default"
          onSelectBackground={vi.fn()}
          account={accountWithAvatar}
          onAccountChange={vi.fn()}
          onOpenInstall={vi.fn()}
        />,
      );
    });

    const remove = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Remove custom avatar"));
    await act(async () => {
      remove?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const save = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Save"));
    await act(async () => {
      save?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(api.updateAccount).toHaveBeenCalledWith({ display_name: "David", avatar_color: "#ffbd38", avatar_image: null });
  });

  it("persists a time zone override on change", async () => {
    renderAccount();

    const select = host.querySelector('select[aria-label="Override time zone"]') as HTMLSelectElement;
    await act(async () => {
      select.value = "America/Los_Angeles";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(api.updateAccount).toHaveBeenCalledWith({ preferences: { timezone: "America/Los_Angeles" } });
  });

  it("data export triggers a download request with JSON attachment headers", async () => {
    renderAccount();

    const button = Array.from(host.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes("Download State Backup"));
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(api.downloadAccountExport).toHaveBeenCalledWith({ accept: "application/json", disposition: "attachment" });
    expect(host.textContent).toContain("Downloaded mission-control-export-2026-05-13.json");
  });

  it("renders the authentication placeholder without action buttons", () => {
    renderAccount();

    expect(host.textContent).toContain("Public preview mode");
    expect(host.textContent).toContain("Authentication is currently disabled. This instance is accessible without credentials.");
    expect(Array.from(host.querySelectorAll("button")).some((button) => /sign|login|enable/i.test(button.textContent ?? ""))).toBe(false);
  });

  it("sidebar footer renders account identity from shared source", () => {
    act(() => {
      root.render(
        <NavigationRail
          activeView="settings"
          collapsed={false}
          mobileOpen={false}
          onCloseMobile={vi.fn()}
          onToggleCollapsed={vi.fn()}
          onSelectView={vi.fn()}
          account={account}
        />,
      );
    });

    expect(host.textContent).toContain("David");
    expect(host.querySelector('[aria-label="Account settings"] span')?.textContent).toBe("D");
  });

  it("sidebar footer renders uploaded avatar image when set", () => {
    act(() => {
      root.render(
        <NavigationRail
          activeView="settings"
          collapsed={false}
          mobileOpen={false}
          onCloseMobile={vi.fn()}
          onToggleCollapsed={vi.fn()}
          onSelectView={vi.fn()}
          account={{ ...account, avatar_image: "data:image/png;base64,YXZhdGFy" }}
        />,
      );
    });

    const image = host.querySelector('[aria-label="Account settings"] img') as HTMLImageElement;
    expect(image).toBeTruthy();
    expect(image.src).toContain("data:image/png;base64,YXZhdGFy");
  });

  it("dims the color palette when a custom avatar is active", () => {
    act(() => {
      root.render(
        <SettingsView
          section="account"
          catalog={[]}
          onSelectSection={vi.fn()}
          activeTheme="default"
          onSelectTheme={vi.fn()}
          activeBackground="theme-default"
          onSelectBackground={vi.fn()}
          account={{ ...account, avatar_image: "data:image/png;base64,YXZhdGFy" }}
          onAccountChange={vi.fn()}
          onOpenInstall={vi.fn()}
        />,
      );
    });

    expect(host.textContent).toContain("Custom avatar active. Remove to use color.");
    expect(host.textContent).toContain("Remove custom avatar");
    expect(host.querySelector('[aria-label="Avatar color #ffbd38"]')?.parentElement?.className).toContain("opacity-35");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  applyBackground,
  BACKGROUND_STORAGE_KEY_V1,
  getStoredBackground,
  setStoredBackground,
} from "./backgrounds";

class MemoryStorage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
}

class StubElement {
  style = {
    _vars: new Map<string, string>(),
    setProperty(name: string, value: string) {
      (this._vars as Map<string, string>).set(name, value);
    },
  } as { setProperty: (n: string, v: string) => void; _vars: Map<string, string> };
}

function installDom() {
  const root = new StubElement();
  (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window = {
    localStorage: new MemoryStorage(),
  };
  (globalThis as unknown as { document: { documentElement: StubElement } }).document = {
    documentElement: root,
  };
  return root;
}

beforeEach(() => {
  installDom();
});

describe("background storage", () => {
  it("defaults to theme-default when storage is empty", () => {
    expect(getStoredBackground()).toBe("theme-default");
  });

  it("persists and reads supported background ids", () => {
    setStoredBackground("none");
    expect(getStoredBackground()).toBe("none");
    expect(window.localStorage.getItem(BACKGROUND_STORAGE_KEY_V1)).toBe("none");

    setStoredBackground("hermes-4");
    expect(getStoredBackground()).toBe("hermes-4");

    setStoredBackground("custom-abc123.png");
    expect(getStoredBackground()).toBe("custom-abc123.png");
  });

  it("migrates invalid ids back to theme-default", () => {
    window.localStorage.setItem(BACKGROUND_STORAGE_KEY_V1, "http://example.com/image.png");
    expect(getStoredBackground()).toBe("theme-default");
    expect(window.localStorage.getItem(BACKGROUND_STORAGE_KEY_V1)).toBe("theme-default");
  });
});

describe("applyBackground", () => {
  it("uses the active theme background for theme-default", () => {
    const root = installDom();
    applyBackground("theme-default", "default");
    expect(root.style._vars.get("--theme-background-image")).toBe("url('/theme-backgrounds/theme-1.png')");
    expect(root.style._vars.get("--theme-background-opacity")).toBe("0.22");
  });

  it("clears image vars for none", () => {
    const root = installDom();
    applyBackground("none", "slate");
    expect(root.style._vars.get("--theme-background-image")).toBe("none");
    expect(root.style._vars.get("--theme-background-opacity")).toBe("0");
    expect(root.style._vars.get("--theme-background-filter")).toBe("none");
  });

  it("writes bundled Hermes background vars", () => {
    const root = installDom();
    applyBackground("hermes-3", "rose");
    expect(root.style._vars.get("--theme-background-image")).toBe("url('/theme-backgrounds/theme-3.png')");
    expect(root.style._vars.get("--theme-background-position")).toBe("center center");
    expect(root.style._vars.get("--theme-background-size")).toBe("cover");
  });

  it("writes custom upload background vars and enables the contrast scrim", () => {
    const root = installDom();
    applyBackground("custom-uploaded.png", "cyberpunk");
    expect(root.style._vars.get("--theme-background-image")).toBe("url('/user-content/backgrounds/uploaded.png')");
    expect(root.style._vars.get("--theme-background-opacity")).toBe("0.32");
    expect(root.style._vars.get("--custom-background-scrim")).toContain("var(--background-base) 55%");
  });

  it("clears the contrast scrim for non-custom backgrounds", () => {
    const root = installDom();
    applyBackground("hermes-5", "cyberpunk");
    expect(root.style._vars.get("--custom-background-scrim")).toBe("none");
  });
});

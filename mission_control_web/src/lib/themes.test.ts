import { beforeEach, describe, expect, it } from "vitest";
import {
  applyCuratedTheme,
  CURATED_THEMES,
  CURATED_THEME_IDS,
  DEFAULT_THEME,
  getStoredTheme,
  getThemeDefinition,
  getThemeOptions,
  setStoredTheme,
  THEME_STORAGE_KEY_V1,
} from "./themes";

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
  attrs = new Map<string, string>();
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
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

describe("canonical Hermes CLI theme catalog", () => {
  it("exposes the nine CLI skins followed by Mission Control extensions", () => {
    expect(CURATED_THEME_IDS).toEqual([
      "default",
      "ares",
      "mono",
      "slate",
      "daylight",
      "warm-lightmode",
      "poseidon",
      "sisyphus",
      "charizard",
      "midnight",
      "cyberpunk",
      "rose",
    ]);
    expect(CURATED_THEMES).toHaveLength(12);
    expect(getThemeOptions().map((theme) => theme.name)).toEqual(CURATED_THEME_IDS);
  });

  it("each theme exposes label, description, three swatches, and a real definition", () => {
    for (const theme of CURATED_THEMES) {
      expect(theme.label.length).toBeGreaterThan(0);
      expect(theme.description.length).toBeGreaterThan(0);
      expect(theme.swatches).toHaveLength(3);
      expect(theme.swatches.every((swatch) => /^#[0-9a-f]{6}$/i.test(swatch))).toBe(true);
      expect(getThemeDefinition(theme.id).name).toBe(theme.id);
    }
  });

  it("default is the classic Hermes gold/kawaii look and remains the web default", () => {
    expect(DEFAULT_THEME.name).toBe("default");
    expect(DEFAULT_THEME.label).toBe("Classic Hermes");
    expect(DEFAULT_THEME.description).toContain("gold and kawaii");
    expect(DEFAULT_THEME.palette.background.hex).toBe("#041c1c");
    expect(DEFAULT_THEME.palette.midground.hex).toBe("#FFF8DC");
    expect(DEFAULT_THEME.palette.warmGlow).toBe("#ffbd38");
    expect(DEFAULT_THEME.palette.warmGlowDeep).toBe("#d49a2e");
  });
});

describe("storage round-trip and migration", () => {
  it("returns default when storage is empty", () => {
    expect(getStoredTheme()).toBe("default");
  });

  it("persists and reads canonical theme ids", () => {
    setStoredTheme("slate");
    expect(getStoredTheme()).toBe("slate");
    const raw = (globalThis as unknown as { window: { localStorage: Storage } })
      .window.localStorage.getItem(THEME_STORAGE_KEY_V1);
    expect(raw).toBe("slate");
  });

  it("migrates Slice 3 deprecated ids to default on read", () => {
    const storage = (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage;
    for (const stale of ["umbrella-amber", "noir", "command-green"] as const) {
      storage.setItem(THEME_STORAGE_KEY_V1, stale);
      expect(getStoredTheme()).toBe("default");
      expect(storage.getItem(THEME_STORAGE_KEY_V1)).toBe("default");
    }
  });

  it("migrates arbitrary invalid ids to default on read", () => {
    const storage = (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage;
    storage.setItem(THEME_STORAGE_KEY_V1, "totally-bogus");
    expect(getStoredTheme()).toBe("default");
    expect(storage.getItem(THEME_STORAGE_KEY_V1)).toBe("default");
  });
});

describe("applyCuratedTheme", () => {
  it("writes CSS vars and the data-theme attribute", () => {
    const root = installDom();
    applyCuratedTheme("charizard");
    expect(root.attrs.get("data-theme")).toBe("charizard");
    expect(root.style._vars.get("--background-base")).toBe("#2B160E");
    expect(root.style._vars.get("--midground-base")).toBe("#FFF0D4");
    expect(root.style._vars.get("--warm-glow")).toBe("#F29C38");
    expect(root.style._vars.get("--warm-glow-deep")).toBe("#FFD39A");
  });

  it("keeps the default rail-logo gradient tokens pixel-aligned with production", () => {
    const root = installDom();
    applyCuratedTheme("default");
    const gradient = `linear-gradient(135deg, ${root.style._vars.get("--warm-glow")}, ${root.style._vars.get("--warm-glow-deep")})`;
    expect(root.style._vars.get("--warm-glow")).toBe("#ffbd38");
    expect(root.style._vars.get("--warm-glow-deep")).toBe("#d49a2e");
    expect(gradient).toBe("linear-gradient(135deg, #ffbd38, #d49a2e)");
  });
});


describe("Mission Control extension themes", () => {
  it("three extension ids resolve and apply", () => {
    const root = installDom();
    applyCuratedTheme("midnight");
    expect(root.attrs.get("data-theme")).toBe("midnight");
    expect(root.style._vars.get("--background-base")).toBe("#0a0a1f");
    expect(root.style._vars.get("--warm-glow")).toBe("#a78bfa");

    applyCuratedTheme("cyberpunk");
    expect(root.attrs.get("data-theme")).toBe("cyberpunk");
    expect(root.style._vars.get("--foreground-base")).toBe("#33ff88");
    expect(root.style._vars.get("--readable-foreground-base")).toBe("#33ff88");

    applyCuratedTheme("rose");
    expect(root.attrs.get("data-theme")).toBe("rose");
    expect(root.style._vars.get("--warm-glow-deep")).toBe("#c97a9d");
  });
});

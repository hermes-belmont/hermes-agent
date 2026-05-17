import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL_STORAGE_KEY,
  RECENTS_CAP,
  RECENTS_STORAGE_KEY,
  _resetRecentsForTests,
  getDefaultModel,
  getRecents,
  getRecentsPadded,
  promoteOnSend,
  promoteRecent,
} from "./model-recents";

// Minimal localStorage shim for the Node test runner.
class MemoryStorage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
}

beforeEach(() => {
  vi.unstubAllGlobals();
  // Install fresh window/localStorage for each test.
  (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window = {
    localStorage: new MemoryStorage(),
  };
  _resetRecentsForTests();
});

describe("promoteRecent", () => {
  it("adds a new id to position 0", () => {
    expect(promoteRecent([], "a")).toEqual(["a"]);
    expect(promoteRecent(["a", "b"], "c")).toEqual(["c", "a", "b"]);
  });

  it("deduplicates by promoting existing id to front", () => {
    expect(promoteRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(promoteRecent(["a", "b"], "a")).toEqual(["a", "b"]);
  });

  it("caps the list at RECENTS_CAP", () => {
    const result = promoteRecent(["a", "b", "c"], "d");
    expect(result).toHaveLength(RECENTS_CAP);
    expect(result).toEqual(["d", "a", "b"]);
  });

  it("ignores empty modelId", () => {
    expect(promoteRecent(["a"], "")).toEqual(["a"]);
  });
});

describe("promoteOnSend", () => {
  it("writes through to storage and trims", () => {
    promoteOnSend("a");
    promoteOnSend("b");
    promoteOnSend("c");
    promoteOnSend("d");
    expect(getRecents()).toEqual(["d", "c", "b"]);
    const raw = (globalThis as unknown as { window: { localStorage: Storage } })
      .window.localStorage.getItem(RECENTS_STORAGE_KEY);
    expect(JSON.parse(raw!)).toEqual(["d", "c", "b"]);
  });

  it("dedupes on repeat sends", () => {
    promoteOnSend("a");
    promoteOnSend("b");
    promoteOnSend("a");
    expect(getRecents()).toEqual(["a", "b"]);
  });
});

describe("getRecentsPadded", () => {
  const catalog = ["m1", "m2", "m3", "m4", "m5"];

  it("returns exactly RECENTS_CAP entries when storage is empty", () => {
    const padded = getRecentsPadded(catalog, "m2");
    expect(padded).toHaveLength(RECENTS_CAP);
    expect(padded[0]).toBe("m2");
  });

  it("places recents first, then default, then catalog", () => {
    promoteOnSend("m4");
    const padded = getRecentsPadded(catalog, "m2");
    expect(padded[0]).toBe("m4");
    expect(padded).toContain("m2");
    expect(padded).toHaveLength(RECENTS_CAP);
    expect(new Set(padded).size).toBe(RECENTS_CAP);
  });

  it("never duplicates across recents/default/catalog", () => {
    promoteOnSend("m1");
    promoteOnSend("m2");
    const padded = getRecentsPadded(catalog, "m1");
    expect(new Set(padded).size).toBe(padded.length);
  });

  it("handles null default and empty catalog", () => {
    expect(getRecentsPadded([], null)).toEqual([]);
    promoteOnSend("only");
    expect(getRecentsPadded([], null)).toEqual(["only"]);
  });
});

describe("default model source", () => {
  it("reads Hermes Agent main model and clears legacy storage", async () => {
    const storage = (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage;
    storage.setItem(DEFAULT_MODEL_STORAGE_KEY, "stale-local-default");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ model: "gpt-5.4" }), {
      headers: { "Content-Type": "application/json" },
    })));

    await expect(getDefaultModel({ force: true })).resolves.toBe("gpt-5.4");
    expect(storage.getItem(DEFAULT_MODEL_STORAGE_KEY)).toBeNull();
  });

  it("returns null when Hermes Agent main-model API is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));

    await expect(getDefaultModel({ force: true })).resolves.toBeNull();
  });
});

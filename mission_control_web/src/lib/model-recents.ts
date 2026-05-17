/**
 * Client-side recents store for the chat composer's model picker.
 *
 * Slice 2c contract:
 *  - MRU-ordered list of model IDs.
 *  - Cap of 3 entries.
 *  - ``promoteOnSend(modelId)`` is the ONLY mutation point; selecting a model
 *    in the picker without sending does NOT change recents.
 *  - ``getRecentsPadded(catalog, defaultModel)`` always returns exactly 3
 *    entries by padding with system defaults so the dropdown is never sparse.
 */

declare global {
  interface Window {
    __HERMES_SESSION_TOKEN__?: string;
  }
}

export const RECENTS_STORAGE_KEY = "mc.modelRecents.v1";
export const DEFAULT_MODEL_STORAGE_KEY = "mc.defaultModel.v1";
export const RECENTS_CAP = 3;

const HERMES_MODEL_INFO_URL = "http://localhost:9119/api/model/info";
const DEFAULT_MODEL_CACHE_TTL_MS = 7_500;

let cachedDefaultModel: { value: string | null; expiresAt: number } | null = null;
let defaultModelRequest: Promise<string | null> | null = null;

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function getSessionToken(): string | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.__HERMES_SESSION_TOKEN__;
  } catch {
    return undefined;
  }
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  } catch {
    return [];
  }
}

/** Read the raw recents list (uncapped padding) from storage. */
export function getRecents(): string[] {
  const storage = safeStorage();
  if (!storage) return [];
  return parseList(storage.getItem(RECENTS_STORAGE_KEY)).slice(0, RECENTS_CAP);
}

/** Persist a recents list (dedup + cap applied defensively). */
function writeRecents(list: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const id of list) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push(id);
    if (deduped.length >= RECENTS_CAP) break;
  }
  const storage = safeStorage();
  if (storage) {
    try {
      storage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(deduped));
    } catch {
      // ignore quota / disabled storage
    }
  }
  return deduped;
}

/**
 * Pure helper exported for tests. Promotes ``modelId`` to position 0 of
 * ``current``, removes duplicates, and caps at {@link RECENTS_CAP}.
 */
export function promoteRecent(current: string[], modelId: string): string[] {
  if (!modelId) return current.slice(0, RECENTS_CAP);
  const next = [modelId, ...current.filter((entry) => entry !== modelId)];
  return next.slice(0, RECENTS_CAP);
}

/**
 * Update recents because the user just SENT a message with ``modelId``.
 * Returns the new list. Safe to call from React render-adjacent code.
 */
export function promoteOnSend(modelId: string): string[] {
  if (!modelId) return getRecents();
  const next = promoteRecent(getRecents(), modelId);
  return writeRecents(next);
}

/**
 * Build the display list shown in the chat-chip dropdown. Always returns
 * exactly {@link RECENTS_CAP} entries: stored recents first, then
 * ``defaultModel`` (if any), then catalog entries to fill any remaining
 * slots. Duplicates are removed across all sources.
 */
export function getRecentsPadded(
  catalog: readonly string[],
  defaultModel: string | null | undefined,
): string[] {
  const recents = getRecents();
  const sources = [
    ...recents,
    ...(defaultModel ? [defaultModel] : []),
    ...catalog,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of sources) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= RECENTS_CAP) break;
  }
  return out;
}

function clearStoredDefaultModel(): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(DEFAULT_MODEL_STORAGE_KEY);
  } catch {
    // ignore quota / disabled storage
  }
}

/** One-time migration cleanup for the retired Mission Control default key. */
export function clearLegacyDefaultModelStorage(): void {
  clearStoredDefaultModel();
}

export function invalidateDefaultModelCache(): void {
  cachedDefaultModel = null;
  defaultModelRequest = null;
}

/**
 * Hermes Agent main model is the single source of truth for new-chat defaults.
 * The retired Mission Control localStorage key is cleared on each read so stale
 * browser state cannot shadow the API-backed setting.
 */
export async function getDefaultModel(options: { force?: boolean } = {}): Promise<string | null> {
  clearStoredDefaultModel();

  const now = Date.now();
  if (!options.force && cachedDefaultModel && cachedDefaultModel.expiresAt > now) {
    return cachedDefaultModel.value;
  }

  if (!options.force && defaultModelRequest) {
    return defaultModelRequest;
  }

  defaultModelRequest = (async () => {
    try {
      const headers = new Headers({ Accept: "application/json" });
      const token = getSessionToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const response = await fetch(HERMES_MODEL_INFO_URL, { headers });
      if (!response.ok) return null;
      const data = await response.json() as { model?: unknown; model_slug?: unknown };
      const model = typeof data.model_slug === "string" ? data.model_slug : typeof data.model === "string" ? data.model : null;
      cachedDefaultModel = { value: model, expiresAt: Date.now() + DEFAULT_MODEL_CACHE_TTL_MS };
      return model;
    } catch {
      cachedDefaultModel = { value: null, expiresAt: Date.now() + DEFAULT_MODEL_CACHE_TTL_MS };
      return null;
    } finally {
      defaultModelRequest = null;
    }
  })();

  return defaultModelRequest;
}

/** Retained as a no-op compatibility shim while callers migrate. */
export function setDefaultModel(modelId: string): void {
  void modelId;
  clearStoredDefaultModel();
  invalidateDefaultModelCache();
}

/** Test-only reset hook. */
export function _resetRecentsForTests(): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(RECENTS_STORAGE_KEY);
    storage.removeItem(DEFAULT_MODEL_STORAGE_KEY);
  } catch {
    // ignore
  }
  invalidateDefaultModelCache();
}

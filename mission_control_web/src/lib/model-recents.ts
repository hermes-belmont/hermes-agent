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
 *
 * Storage is localStorage-only — server-side persistence is deferred to a
 * later slice.
 */

export const RECENTS_STORAGE_KEY = "mc.modelRecents.v1";
export const DEFAULT_MODEL_STORAGE_KEY = "mc.defaultModel.v1";
export const RECENTS_CAP = 3;

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
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

/** Default-model persistence (Settings → Models). */
export function getDefaultModel(): string | null {
  const storage = safeStorage();
  if (!storage) return null;
  const value = storage.getItem(DEFAULT_MODEL_STORAGE_KEY);
  return value && value.length > 0 ? value : null;
}

export function setDefaultModel(modelId: string): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    if (modelId) storage.setItem(DEFAULT_MODEL_STORAGE_KEY, modelId);
    else storage.removeItem(DEFAULT_MODEL_STORAGE_KEY);
  } catch {
    // ignore quota / disabled storage
  }
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
}

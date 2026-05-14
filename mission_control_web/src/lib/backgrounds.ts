import { getThemeDefinition, type ThemeName } from "./themes";

export type BackgroundId =
  | "theme-default"
  | "none"
  | "hermes-1"
  | "hermes-2"
  | "hermes-3"
  | "hermes-4"
  | "hermes-5"
  | `custom-${string}`;

export type UserBackground = {
  id: BackgroundId;
  filename: string;
  size: number;
  width: number;
  height: number;
  uploadedAt: string;
};

export const BACKGROUND_STORAGE_KEY_V1 = "mc.background.v1";

const BUNDLED_BACKGROUND_IDS = new Set(["hermes-1", "hermes-2", "hermes-3", "hermes-4", "hermes-5"]);
const DEFAULT_BACKGROUND_ID: BackgroundId = "theme-default";

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isBackgroundId(value: unknown): value is BackgroundId {
  return typeof value === "string" && (
    value === "theme-default" ||
    value === "none" ||
    BUNDLED_BACKGROUND_IDS.has(value) ||
    /^custom-[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g)$/i.test(value)
  );
}

export function getStoredBackground(): BackgroundId {
  const storage = safeStorage();
  if (!storage) return DEFAULT_BACKGROUND_ID;
  const raw = storage.getItem(BACKGROUND_STORAGE_KEY_V1);
  if (isBackgroundId(raw)) return raw;
  try {
    storage.setItem(BACKGROUND_STORAGE_KEY_V1, DEFAULT_BACKGROUND_ID);
  } catch {
    // ignore quota / disabled storage
  }
  return DEFAULT_BACKGROUND_ID;
}

export function setStoredBackground(id: BackgroundId): void {
  if (!isBackgroundId(id)) return;
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(BACKGROUND_STORAGE_KEY_V1, id);
  } catch {
    // ignore quota / disabled storage
  }
}

function setVariable(name: string, value: string) {
  document.documentElement.style.setProperty(name, value);
}

function applyImageVars(image: string, options: { position?: string; size?: string; opacity?: number; filter?: string } = {}) {
  setVariable("--theme-background-image", image);
  setVariable("--theme-background-position", options.position ?? "center center");
  setVariable("--theme-background-size", options.size ?? "cover");
  setVariable("--theme-background-opacity", String(options.opacity ?? 0.32));
  setVariable("--theme-background-filter", options.filter ?? "none");
}

function setCustomScrim(enabled: boolean) {
  setVariable(
    "--custom-background-scrim",
    enabled
      ? "linear-gradient(to bottom, color-mix(in srgb, var(--background-base) 55%, transparent) 0%, color-mix(in srgb, var(--background-base) 70%, transparent) 100%)"
      : "none",
  );
}

export function applyBackground(id: BackgroundId, activeTheme: ThemeName): void {
  setCustomScrim(id.startsWith("custom-"));

  if (id === "none") {
    applyImageVars("none", { opacity: 0, filter: "none" });
    return;
  }

  if (id === "theme-default") {
    const art = getThemeDefinition(activeTheme).backgroundArt;
    if (!art?.image) {
      applyImageVars("none", { opacity: 0, filter: "none" });
      return;
    }
    applyImageVars(`url('${art.image}')`, art);
    return;
  }

  if (id.startsWith("hermes-")) {
    const number = id.split("-")[1];
    applyImageVars(`url('/theme-backgrounds/theme-${number}.png')`);
    return;
  }

  const filename = id.slice("custom-".length);
  applyImageVars(`url('/user-content/backgrounds/${filename}')`);
}

import { HERMES_CLI_THEMES } from "./hermes-cli-themes.generated";
import { MISSION_CONTROL_EXTENSIONS } from "./themes-extensions";

const ALL_THEMES = [...HERMES_CLI_THEMES, ...MISSION_CONTROL_EXTENSIONS] as const;

export type ThemeDefinition = {
  name: ThemeName;
  label: string;
  description: string;
  swatches: readonly [string, string, string];
  palette: {
    background: { hex: string; alpha: number };
    midground: { hex: string; alpha: number };
    foreground: { hex: string; alpha: number };
    warmGlow: string;
    warmGlowDeep: string;
    noiseOpacity: number;
  };
  backgroundArt?: {
    image: string;
    position?: string;
    size?: string;
    opacity?: number;
    filter?: string;
  };
};

export type ThemeName = typeof ALL_THEMES[number]["name"];
export type ThemeOption = Pick<ThemeDefinition, "name" | "label" | "description">;
export type CuratedThemeId = ThemeName;
export type CuratedTheme = {
  id: CuratedThemeId;
  label: string;
  description: string;
  /** [primary, surface, accent] for the swatch row on Settings → Themes. */
  swatches: readonly [string, string, string];
};

export const THEME_STORAGE_KEY = "mission-control-theme";
export const THEME_STORAGE_KEY_V1 = "mc.theme.v1";

const DEFAULT_THEME_ID: ThemeName = "default";
const DEPRECATED_SLICE3_THEME_IDS = new Set(["umbrella-amber", "noir", "command-green"]);

export const DASHBOARD_THEMES: Record<ThemeName, ThemeDefinition> = ALL_THEMES.reduce((acc, theme) => {
  acc[theme.name] = theme as ThemeDefinition;
  return acc;
}, {} as Record<ThemeName, ThemeDefinition>);

export const DEFAULT_THEME = DASHBOARD_THEMES[DEFAULT_THEME_ID];

export const CURATED_THEMES: CuratedTheme[] = ALL_THEMES.map((theme) => ({
  id: theme.name,
  label: theme.label,
  description: theme.description,
  swatches: theme.swatches,
}));

export const CURATED_THEME_IDS: CuratedThemeId[] = CURATED_THEMES.map((theme) => theme.id);

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DASHBOARD_THEMES, value);
}

export function getThemeDefinition(name?: string | null): ThemeDefinition {
  if (!name) return DEFAULT_THEME;
  return isThemeName(name) ? DASHBOARD_THEMES[name] : DEFAULT_THEME;
}

export function getThemeOptions(): ThemeOption[] {
  return ALL_THEMES.map(({ name, label, description }) => ({ name, label, description }));
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function migrateStoredTheme(storage: Storage | null): ThemeName {
  if (!storage) return DEFAULT_THEME_ID;
  const raw = storage.getItem(THEME_STORAGE_KEY_V1);
  if (isThemeName(raw)) return raw;

  // Slice 3 shipped these temporary curated ids. Slice 3b canonicalizes the
  // catalog to the Hermes CLI ids, so all stale/non-canonical values collapse to
  // the CLI default without throwing.
  if (raw === null || DEPRECATED_SLICE3_THEME_IDS.has(raw) || raw.length > 0) {
    try {
      storage.setItem(THEME_STORAGE_KEY_V1, DEFAULT_THEME_ID);
    } catch {
      // ignore quota / disabled storage
    }
  }
  return DEFAULT_THEME_ID;
}

/** Read the user's theme from localStorage, migrating stale Slice 3 ids to default. */
export function getStoredTheme(): ThemeName {
  return migrateStoredTheme(safeStorage());
}

/** Persist a canonical Hermes CLI theme id. Invalid ids are ignored. */
export function setStoredTheme(id: ThemeName): void {
  if (!isThemeName(id)) return;
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY_V1, id);
  } catch {
    // ignore quota / disabled storage
  }
}

function setVariable(name: string, value: string) {
  document.documentElement.style.setProperty(name, value);
}

function colorMix(hex: string, alpha: number) {
  const percent = Math.round(alpha * 100);
  return `color-mix(in srgb, ${hex} ${percent}%, transparent)`;
}

export function applyTheme(themeName: string) {
  const theme = getThemeDefinition(themeName);
  const { background, midground, foreground, warmGlow, warmGlowDeep, noiseOpacity } = theme.palette;


  setVariable("--background", colorMix(background.hex, background.alpha));
  setVariable("--background-base", background.hex);
  setVariable("--background-alpha", String(background.alpha));
  setVariable("--midground", colorMix(midground.hex, midground.alpha));
  setVariable("--midground-base", midground.hex);
  setVariable("--readable-foreground-base", foreground.alpha > 0 ? foreground.hex : midground.hex);
  setVariable("--midground-alpha", String(midground.alpha));
  setVariable("--foreground", colorMix(foreground.hex, foreground.alpha));
  setVariable("--foreground-base", foreground.hex);
  setVariable("--foreground-alpha", String(foreground.alpha));
  setVariable("--warm-glow", warmGlow);
  setVariable("--warm-glow-deep", warmGlowDeep);
  setVariable("--noise-opacity-mul", String(noiseOpacity));
  document.documentElement.setAttribute("data-theme-name", theme.name);
}

export function applyCuratedTheme(id: CuratedThemeId): void {
  applyTheme(id);
  try {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", id);
    }
  } catch {
    // ignore (jsdom-less test env)
  }
}

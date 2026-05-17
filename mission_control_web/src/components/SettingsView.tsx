import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Download, FileCode, ImageIcon, KeyRound, Loader2, Lock, Monitor, Package, Palette, RefreshCw, Server, Upload, UserCircle, X } from "lucide-react";
import { api } from "@/lib/api";
import { resizeAvatarFileToDataUri } from "@/lib/avatar";
import { DesktopRemoteSettings } from "@/components/DesktopRemoteSettings";
import { applyBackground, setStoredBackground, type BackgroundId, type UserBackground } from "@/lib/backgrounds";
import type { AccountRecord, HermesProfile } from "@/lib/types";
import { CURATED_THEMES, getThemeDefinition, type CuratedThemeId } from "@/lib/themes";
import { navigateToSettingsSection } from "@/lib/hash-routing";
import { cn } from "@/lib/utils";

export type SettingsSection = "models" | "themes" | "desktop-remote" | "keys" | "config" | "skills" | "account";

const SECTIONS: Array<{ id: SettingsSection; label: string; icon: typeof Server }> = [
  { id: "models", label: "Models", icon: Server },
  { id: "themes", label: "Themes", icon: Palette },
  { id: "desktop-remote", label: "Desktop & Remote", icon: Monitor },
  { id: "keys", label: "Keys", icon: KeyRound },
  { id: "config", label: "Config", icon: FileCode },
  { id: "skills", label: "Skills", icon: Package },
  { id: "account", label: "Account", icon: UserCircle },
];

type Props = {
  section: SettingsSection;
  catalog: readonly string[];
  onSelectSection: (section: SettingsSection) => void;
  activeTheme: string;
  onSelectTheme: (id: CuratedThemeId) => void;
  activeBackground: BackgroundId;
  onSelectBackground: (id: BackgroundId) => void;
  account: AccountRecord;
  onAccountChange: (account: AccountRecord) => void;
  onOpenInstall: () => void;
};

function ModelsPage() {
  return (
    <div className="flex min-h-[calc(100vh-3rem)] flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background/40">
      <iframe
        title="Hermes Agent Models"
        src="http://localhost:9119/models?embed=1"
        className="min-h-0 w-full flex-1 border-0 bg-transparent"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  );
}

const BUNDLED_BACKGROUNDS: Array<{ id: BackgroundId; label: string; image: string }> = [
  { id: "hermes-1", label: "Hermes 01", image: "/theme-backgrounds/theme-1.png" },
  { id: "hermes-2", label: "Hermes 02", image: "/theme-backgrounds/theme-2.png" },
  { id: "hermes-3", label: "Hermes 03", image: "/theme-backgrounds/theme-3.png" },
  { id: "hermes-4", label: "Hermes 04", image: "/theme-backgrounds/theme-4.png" },
  { id: "hermes-5", label: "Hermes 05", image: "/theme-backgrounds/theme-5.png" },
];

function BackgroundTile({
  id,
  label,
  selected,
  onSelect,
  image,
  solid,
  children,
  onDelete,
}: {
  id: BackgroundId;
  label: string;
  selected: boolean;
  onSelect: (id: BackgroundId) => void;
  image?: string;
  solid?: string;
  children?: ReactNode;
  onDelete?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border/70 bg-background/45 p-2 text-left transition hover:border-[color-mix(in_srgb,var(--warm-glow)_38%,transparent)]",
        selected && "border-[color-mix(in_srgb,var(--warm-glow)_70%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_8%,transparent)]",
      )}
    >
      <div
        className="h-24 rounded-lg border border-foreground/10 bg-background/65"
        style={image ? { backgroundImage: `url('${image}')`, backgroundPosition: "center", backgroundSize: "cover" } : solid ? { background: solid } : undefined}
      >
        {children}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-foreground">{label}</span>
        {selected && (
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--warm-glow)] text-background-base">
            <Check className="h-3 w-3" />
          </span>
        )}
      </div>
      {onDelete && (
        <span
          role="button"
          tabIndex={0}
          onClick={(event) => { event.stopPropagation(); onDelete(); }}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onDelete(); } }}
          className="absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full border border-foreground/20 bg-background/85 text-foreground/75 opacity-0 transition hover:text-foreground group-hover:opacity-100"
          aria-label={`Delete ${label}`}
        >
          <X className="h-3.5 w-3.5" />
        </span>
      )}
    </button>
  );
}

function ThemesPage({ activeTheme, onSelectTheme, activeBackground, onSelectBackground }: { activeTheme: string; onSelectTheme: (id: CuratedThemeId) => void; activeBackground: BackgroundId; onSelectBackground: (id: BackgroundId) => void }) {
  const [uploads, setUploads] = useState<UserBackground[]>([]);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeThemeDefinition = getThemeDefinition(activeTheme);

  const refreshUploads = async () => {
    try {
      setUploads(await api.getUserBackgrounds());
    } catch {
      setUploads([]);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshUploads();
  }, []);

  const selectBackground = (id: BackgroundId) => {
    onSelectBackground(id);
    setStoredBackground(id);
    applyBackground(id, activeThemeDefinition.name);
  };

  const handleUpload = async (file: File | null | undefined) => {
    if (!file) return;
    setUploadError("");
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setUploadError("PNG or JPG only.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setUploadError("Maximum upload size is 4 MB.");
      return;
    }
    setUploading(true);
    try {
      const uploaded = await api.uploadUserBackground(file);
      await refreshUploads();
      selectBackground(uploaded.id);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const deleteUpload = async (id: BackgroundId) => {
    try {
      await api.deleteUserBackground(id);
      if (activeBackground === id) selectBackground("theme-default");
      await refreshUploads();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  const themeDefaultImage = activeThemeDefinition.backgroundArt?.image;

  return (
    <section className="flex flex-1 flex-col gap-5">
      <header>
        <h1 className="font-expanded text-xl font-medium text-foreground">Themes</h1>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Themes apply across the whole app. Your choice is saved in this browser.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        {CURATED_THEMES.map((theme) => {
          const isActive = activeTheme === theme.id;
          return (
            <div
              key={theme.id}
              className={cn(
                "flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-background/40 px-4 py-3 transition",
                isActive && "border-foreground/45 bg-foreground/[0.06]",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium text-foreground">{theme.label}</div>
                  <span className="font-mono text-[10px] text-muted-foreground">{theme.id}</span>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">{theme.description}</div>
                <div className="mt-2 flex items-center gap-1.5" aria-label={`${theme.label} preview`}>
                  {theme.swatches.map((color, idx) => (
                    <span
                      key={`${theme.id}-${idx}`}
                      className="inline-block h-4 w-7 rounded border border-foreground/15"
                      style={{ background: color }}
                    />
                  ))}
                </div>
              </div>
              {isActive ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-foreground/40 bg-foreground/10 px-2.5 py-[3px] text-[9px] uppercase tracking-[0.14em] text-foreground">
                  <Check className="h-3 w-3" />
                  Active
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelectTheme(theme.id)}
                  className="shrink-0 rounded-lg border border-border/70 bg-background/55 px-3 py-1.5 text-[11px] uppercase tracking-[0.10em] text-foreground transition hover:border-foreground/35 hover:bg-foreground/[0.04]"
                >
                  Set theme
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-2 border-t border-foreground/10 pt-5">
        <header>
          <h2 className="font-expanded text-base font-medium text-foreground">Background</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Override the theme's background image or upload your own. Backgrounds are stored locally on this Mission Control instance.
          </p>
        </header>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <BackgroundTile
            id="theme-default"
            label="Theme default"
            selected={activeBackground === "theme-default"}
            onSelect={selectBackground}
            image={themeDefaultImage}
            solid={!themeDefaultImage ? activeThemeDefinition.palette.background.hex : undefined}
          />
          <BackgroundTile id="none" label="None" selected={activeBackground === "none"} onSelect={selectBackground}>
            <div className="flex h-full items-center justify-center rounded-lg bg-[repeating-linear-gradient(45deg,color-mix(in_srgb,var(--foreground-base)_10%,transparent)_0_8px,transparent_8px_16px)] text-foreground/45">
              <ImageIcon className="h-5 w-5" />
            </div>
          </BackgroundTile>
          {BUNDLED_BACKGROUNDS.map((background) => (
            <BackgroundTile key={background.id} {...background} selected={activeBackground === background.id} onSelect={selectBackground} />
          ))}
          {uploads.map((background) => (
            <BackgroundTile
              key={background.id}
              id={background.id}
              label={background.filename}
              selected={activeBackground === background.id}
              onSelect={selectBackground}
              image={`/user-content/backgrounds/${background.filename}`}
              onDelete={() => void deleteUpload(background.id)}
            />
          ))}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex min-h-[142px] flex-col items-center justify-center rounded-xl border border-dashed border-[color-mix(in_srgb,var(--warm-glow)_60%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_6%,transparent)] p-4 text-center text-[var(--warm-glow)] transition hover:bg-[color-mix(in_srgb,var(--warm-glow)_10%,transparent)]"
          >
            <Upload className="mb-2 h-5 w-5" />
            <span className="text-[11px] uppercase tracking-[0.12em]">{uploading ? "Uploading" : "Upload"}</span>
            <span className="mt-1 text-[10px] text-foreground/70">PNG/JPG · 4 MB max</span>
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(event) => void handleUpload(event.target.files?.[0])} />
        {uploadError && <div className="mt-2 text-[11px] text-[#fb2c36]">{uploadError}</div>}
      </div>
    </section>
  );
}

const AVATAR_COLORS = ["#ffbd38", "#74b0ff", "#6bf199", "#fb7185", "#c084fc", "#f97316", "#22d3ee", "#e5e7eb"];

const TIME_ZONES = [
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Puerto_Rico",
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
].sort((a, b) => a.localeCompare(b));

function initials(name: string) {
  return (name.trim()[0] || "D").toUpperCase();
}

function AccountPage({ account, onAccountChange }: { account: AccountRecord; onAccountChange: (account: AccountRecord) => void }) {
  const [name, setName] = useState(account.display_name);
  const [color, setColor] = useState(account.avatar_color);
  const [avatarImage, setAvatarImage] = useState<string | null>(account.avatar_image ?? null);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [identityMessage, setIdentityMessage] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [exporting, setExporting] = useState(false);
  const [agentProfiles, setAgentProfiles] = useState<HermesProfile[]>([]);
  const [agentProfilesLoading, setAgentProfilesLoading] = useState(false);
  const [agentProfilesError, setAgentProfilesError] = useState("");
  const [timezoneMessage, setTimezoneMessage] = useState("");
  const [detectedZone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  });

  const dirty = name.trim() !== account.display_name || color.toLowerCase() !== account.avatar_color.toLowerCase() || avatarChanged;
  const timezone = account.preferences.timezone || detectedZone;

  const handleAvatarUpload = async (file: File | null | undefined) => {
    if (!file) return;
    setAvatarError("");
    try {
      const dataUri = await resizeAvatarFileToDataUri(file);
      setAvatarImage(dataUri);
      setAvatarChanged(true);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Avatar upload failed.");
    } finally {
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  const removeAvatar = () => {
    setAvatarImage(null);
    setAvatarChanged(true);
    setAvatarError("");
  };

  const saveIdentity = async () => {
    const displayName = name.trim();
    if (!displayName) {
      setIdentityMessage("Display name is required.");
      return;
    }
    setSavingIdentity(true);
    setIdentityMessage("");
    try {
      const payload: Partial<Omit<AccountRecord, "preferences">> = { display_name: displayName, avatar_color: color };
      if (avatarChanged) payload.avatar_image = avatarImage;
      const next = await api.updateAccount(payload);
      onAccountChange(next);
      setAvatarImage(next.avatar_image ?? null);
      setAvatarChanged(false);
      setIdentityMessage("Identity saved.");
    } catch (err) {
      setIdentityMessage(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSavingIdentity(false);
    }
  };

  const saveTimezone = async (nextZone: string) => {
    setTimezoneMessage("");
    try {
      const next = await api.updateAccount({ preferences: { timezone: nextZone } });
      onAccountChange(next);
      setTimezoneMessage(`Saved ${nextZone}.`);
    } catch (err) {
      setTimezoneMessage(err instanceof Error ? err.message : "Time zone save failed.");
    }
  };

  const downloadExport = async () => {
    setExporting(true);
    setExportMessage("");
    try {
      const filename = await api.downloadAccountExport({ accept: "application/json", disposition: "attachment" });
      setExportMessage(`Downloaded ${filename}.`);
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setExporting(false);
    }
  };

  const refreshAgentProfiles = async () => {
    setAgentProfilesLoading(true);
    setAgentProfilesError("");
    try {
      const payload = await api.getAgentProfiles();
      const profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
      setAgentProfiles(profiles);
      setAgentProfilesError(typeof payload.error === "string" ? payload.error : "");
    } catch (err) {
      setAgentProfiles([]);
      setAgentProfilesError(err instanceof Error ? err.message : "Unable to load agent profiles.");
    } finally {
      setAgentProfilesLoading(false);
    }
  };

  useEffect(() => {
    void refreshAgentProfiles();
  }, []);

  return (
    <section className="flex flex-1 flex-col gap-4">
      <header>
        <h1 className="font-expanded text-xl font-medium text-foreground">Account</h1>
        <p className="mt-1 text-[11px] text-muted-foreground">Identity, time zone, data export, and authentication status for this Mission Control instance.</p>
      </header>

      <section className="rounded-2xl border border-border/70 bg-background/40 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-expanded text-base font-medium text-foreground">Profiles</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">Update your display name and avatar. Changes apply across Mission Control in real time.</p>
          </div>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full font-expanded text-lg font-medium text-background-base shadow-[0_0_24px_color-mix(in_srgb,var(--warm-glow)_25%,transparent)]" style={avatarImage ? undefined : { background: color }}>{avatarImage ? <img src={avatarImage} alt="Avatar preview" className="h-full w-full object-cover" /> : initials(name)}</div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <label className="text-[11px] text-foreground/75">
            Display name
            <input aria-label="Display name" value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-lg border border-border/70 bg-background/65 px-3 py-2 text-sm text-foreground outline-none transition focus:border-[var(--warm-glow)]" />
          </label>
          <div>
            <div className="flex items-center justify-between gap-2 text-[11px] text-foreground/75">
              <span>Avatar color</span>
              <button type="button" onClick={() => avatarInputRef.current?.click()} className="inline-flex items-center gap-1 rounded-md border border-foreground/12 px-2 py-1 text-[10px] uppercase tracking-[0.10em] text-foreground/75 transition hover:bg-foreground/6 hover:text-foreground"><Upload className="h-3 w-3" />Upload Avatar</button>
            </div>
            <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="Upload Avatar" onChange={(event) => void handleAvatarUpload(event.target.files?.[0])} />
            <div className={cn("mt-1 flex flex-wrap gap-1.5 transition", avatarImage && "opacity-35 grayscale") }>
              {AVATAR_COLORS.map((candidate) => (
                <button key={candidate} type="button" aria-label={`Avatar color ${candidate}`} onClick={() => setColor(candidate)} className={cn("h-8 w-8 rounded-full border transition", color.toLowerCase() === candidate ? "border-foreground shadow-[0_0_0_2px_color-mix(in_srgb,var(--warm-glow)_40%,transparent)]" : "border-foreground/20")} style={{ background: candidate }} />
              ))}
            </div>
            {avatarImage && <p className="mt-2 text-[10px] text-foreground/55">Custom avatar active. Remove to use color.</p>}
            {avatarImage && <button type="button" onClick={removeAvatar} className="mt-2 rounded-md border border-foreground/12 px-2 py-1 text-[10px] uppercase tracking-[0.10em] text-foreground/75 transition hover:bg-foreground/6 hover:text-foreground">Remove custom avatar</button>}
            {avatarError && <p className="mt-2 text-[10px] text-red-300">{avatarError}</p>}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={() => void saveIdentity()} disabled={!dirty || savingIdentity} className="rounded-lg border border-[color-mix(in_srgb,var(--warm-glow)_45%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_10%,transparent)] px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-[var(--warm-glow)] transition disabled:cursor-not-allowed disabled:opacity-45">{savingIdentity ? "Saving" : "Save"}</button>
          {identityMessage && <span className="text-[11px] text-foreground/70">{identityMessage}</span>}
        </div>
      </section>

      <section className="rounded-2xl border border-border/70 bg-background/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-expanded text-base font-medium text-foreground">Agent Profile</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">Read-only Hermes agent profiles mirrored from the local Dashboard gateway.</p>
          </div>
          <button type="button" onClick={() => void refreshAgentProfiles()} disabled={agentProfilesLoading} className="inline-flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-foreground/80 transition hover:bg-foreground/6 disabled:opacity-55">
            {agentProfilesLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Refresh
          </button>
        </div>
        {agentProfilesLoading && agentProfiles.length === 0 ? (
          <div className="mt-3 text-[11px] text-muted-foreground">Loading Hermes profiles…</div>
        ) : agentProfilesError ? (
          <div className="mt-3 rounded-xl border border-[#ffbd38]/25 bg-[#ffbd38]/8 p-3 text-[11px] leading-5 text-[#ffbd38]">{agentProfilesError}</div>
        ) : agentProfiles.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-foreground/18 p-3 text-[11px] text-muted-foreground">No Hermes profiles reported by the gateway.</div>
        ) : (
          <div className="mt-3 grid gap-2">
            {agentProfiles.map((profile, index) => {
              const name = typeof profile?.name === "string" && profile.name.trim() ? profile.name : `Profile ${index + 1}`;
              const path = typeof profile?.path === "string" ? profile.path : "";
              const model = typeof profile?.model === "string" && profile.model.trim() ? profile.model : "No model configured";
              const provider = typeof profile?.provider === "string" && profile.provider.trim() ? profile.provider : "No provider configured";
              const skillCount = Number.isFinite(Number(profile?.skill_count)) ? Number(profile.skill_count) : 0;
              return (
                <div key={`${name}-${path || index}`} className="rounded-xl border border-foreground/10 bg-background/45 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-expanded text-sm font-medium text-foreground">{name}</div>
                    {Boolean(profile?.is_default) && <span className="rounded-full border border-[color-mix(in_srgb,var(--warm-glow)_45%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_10%,transparent)] px-2 py-[2px] text-[9px] uppercase tracking-[0.14em] text-[var(--warm-glow)]">Default</span>}
                    {Boolean(profile?.has_env) && <span className="rounded-full border border-[#66e5a7]/35 bg-[#66e5a7]/10 px-2 py-[2px] text-[9px] uppercase tracking-[0.14em] text-[#66e5a7]">Env</span>}
                  </div>
                  <div className="mt-2 grid gap-1 text-[11px] text-muted-foreground md:grid-cols-3">
                    <div>Model: <span className="text-foreground/85">{model}</span></div>
                    <div>Provider: <span className="text-foreground/85">{provider}</span></div>
                    <div>Skills: <span className="text-foreground/85">{skillCount}</span></div>
                  </div>
                  <div className="mt-2 truncate font-mono text-[10px] text-foreground/65">{path || "Path unavailable"}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border/70 bg-background/40 p-4">
        <h2 className="font-expanded text-base font-medium text-foreground">Time Zone</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">Detected zone: <span className="font-mono text-foreground/85">{detectedZone}</span></p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <select aria-label="Override time zone" value={timezone} onChange={(event) => void saveTimezone(event.target.value)} className="min-w-64 rounded-lg border border-border/70 bg-background/65 px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--warm-glow)]">
            {Array.from(new Set([detectedZone, ...TIME_ZONES])).map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
          <button type="button" onClick={() => void saveTimezone(detectedZone)} className="rounded-lg border border-border/70 px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-foreground/80 transition hover:bg-foreground/6">Use detected</button>
          {timezoneMessage && <span className="text-[11px] text-foreground/70">{timezoneMessage}</span>}
        </div>
      </section>

      <section className="rounded-2xl border border-border/70 bg-background/40 p-4">
        <h2 className="font-expanded text-base font-medium text-foreground">Data Export</h2>
        <p className="mt-1 max-w-3xl text-[11px] leading-5 text-muted-foreground">Download a JSON state backup containing entities, full agent state, tracked items, inter-agent messages, historical briefings, reactive sweep audit records, account settings, and export metadata.</p>
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={() => void downloadExport()} disabled={exporting} className="inline-flex items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--warm-glow)_45%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_10%,transparent)] px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-[var(--warm-glow)] transition disabled:opacity-55"><Download className="h-3.5 w-3.5" />{exporting ? "Downloading" : "Download State Backup"}</button>
          {exportMessage && <span className="text-[11px] text-foreground/70">{exportMessage}</span>}
        </div>
      </section>

      <section className="rounded-2xl border border-[#74b0ff]/30 bg-[#74b0ff]/8 p-4">
        <div className="flex gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#74b0ff]/35 bg-[#74b0ff]/10 text-[#74b0ff]"><Lock className="h-4 w-4" /></div>
          <div>
            <h2 className="font-expanded text-base font-medium text-foreground">Authentication</h2>
            <div className="mt-1 text-sm text-foreground">Public preview mode</div>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Authentication is currently disabled. This instance is accessible without credentials.</p>
          </div>
        </div>
      </section>
    </section>
  );
}

function KeysPage() {
  return (
    <div className="flex min-h-[calc(100vh-3rem)] flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background/40">
      <iframe
        title="Hermes Agent Keys"
        src="http://localhost:9119/env?embed=1"
        className="min-h-0 w-full flex-1 border-0 bg-transparent"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  );
}

function ConfigPage() {
  return (
    <div className="flex min-h-[calc(100vh-3rem)] flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background/40">
      <iframe
        title="Hermes Agent Config"
        src="http://localhost:9119/config?embed=1"
        className="min-h-0 w-full flex-1 border-0 bg-transparent"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  );
}

function SkillsPage() {
  return (
    <div className="flex min-h-[calc(100vh-3rem)] flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background/40">
      <iframe
        title="Hermes Agent Skills"
        src="http://localhost:9119/skills?embed=1"
        className="min-h-0 w-full flex-1 border-0 bg-transparent"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  );
}

export function SettingsView({ section, onSelectSection, activeTheme, onSelectTheme, activeBackground, onSelectBackground, account, onAccountChange, onOpenInstall }: Props) {
  return (
    <section className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-1 lg:sticky lg:top-6 lg:self-start">
        <div className="px-2 pb-1.5 text-[9px] uppercase tracking-[0.16em] text-foreground/70">Settings</div>
        {SECTIONS.map((item) => {
          const Icon = item.icon;
          const active = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectSection(item.id);
                navigateToSettingsSection(item.id);
              }}
              className={cn(
                "flex w-full items-center gap-[9px] rounded-lg border border-transparent px-2.5 py-2 text-left transition",
                active
                  ? "border-[color-mix(in_srgb,var(--warm-glow)_30%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_10%,transparent)]"
                  : "text-foreground/85 hover:bg-foreground/5 hover:text-foreground",
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", active ? "text-[var(--warm-glow)]" : "opacity-62")} />
              <span className={cn("text-[11px] uppercase tracking-[0.10em]", active ? "font-medium text-foreground" : "opacity-62")}>{item.label}</span>
            </button>
          );
        })}
      </aside>

      <div className="min-h-0 max-h-[calc(100vh-3rem)] overflow-y-auto pr-1">
        {section === "models" ? (
          <ModelsPage />
        ) : section === "themes" ? (
          <ThemesPage activeTheme={activeTheme} onSelectTheme={onSelectTheme} activeBackground={activeBackground} onSelectBackground={onSelectBackground} />
        ) : section === "desktop-remote" ? (
          <DesktopRemoteSettings onOpenInstall={onOpenInstall} />
        ) : section === "keys" ? (
          <KeysPage />
        ) : section === "config" ? (
          <ConfigPage />
        ) : section === "skills" ? (
          <SkillsPage />
        ) : (
          <AccountPage key={`${account.display_name}-${account.avatar_color}-${account.avatar_image ?? "none"}-${account.preferences.timezone}`} account={account} onAccountChange={onAccountChange} />
        )}
      </div>
    </section>
  );
}

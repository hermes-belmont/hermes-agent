import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  BrainCircuit,
  Building2,
  Check,
  Coins,
  Ellipsis,
  FolderPlus,
  Loader2,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Save,
  Search,
  Send,
  Settings2,
  Shield,
  Sparkles,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import type { AccountRecord, AgentRecord, BootstrapResponse, ConversationMessage, ConversationRecord, MemoryRecord, ProviderCapabilities, UsageDiagnostics } from "@/lib/types";
import { cn, formatCurrency, formatNumber, formatRelativeTime, titleCase } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { mockBootstrap, mockConversationMessages } from "@/lib/mock";
import { applyBackground, getStoredBackground, setStoredBackground, type BackgroundId } from "@/lib/backgrounds";
import { applyTheme, applyCuratedTheme, CURATED_THEMES, DEFAULT_THEME, getThemeDefinition, getThemeOptions, setStoredTheme, THEME_STORAGE_KEY, THEME_STORAGE_KEY_V1, type ThemeName } from "@/lib/themes";
import { AgentSelectionPopover } from "@/components/AgentSelectionPopover";
import { AssistantMessage } from "@/components/AssistantMessage";
import { GreetingHero } from "@/components/GreetingHero";
import { NavigationRail, type ActiveView } from "@/components/NavigationRail";
import { MonitorView } from "@/components/MonitorView";
import { MaintenanceView } from "@/components/MaintenanceView";
import { BriefingsView } from "@/components/BriefingsView";
import { InboxView } from "@/components/InboxView";
import { AgentsView } from "@/components/AgentsView";
import { TrackingView } from "@/components/TrackingView";
import { SettingsView, type SettingsSection } from "@/components/SettingsView";
import { InstallModal } from "@/components/InstallModal";
import { TopContextBar } from "@/components/TopContextBar";
import { UserMessage } from "@/components/UserMessage";
import { useChatStream } from "@/hooks/useChatStream";
import {
  getDefaultModel,
  getRecentsPadded,
  promoteOnSend,
  RECENTS_STORAGE_KEY,
  DEFAULT_MODEL_STORAGE_KEY,
} from "@/lib/model-recents";
import { navigateToSettingsSection, resolveHashView } from "@/lib/hash-routing";
import { DEFAULT_ACCOUNT } from "@/lib/account-defaults";

type NoticeTone = "info" | "success" | "warning" | "error";
type LoadState = "idle" | "loading" | "error";

const ACTIVE_VIEW_STORAGE_KEY = "mission-control-active-view";
const RAIL_COLLAPSED_STORAGE_KEY = "mission-control-rail-collapsed";
const MODEL_PREFERENCE_STORAGE_KEY = "mission-control-model-preference";


type AgentDraft = {
  name: string;
  role: string;
  business_function: string;
  operating_entity: string;
  system_prompt: string;
  pinned: boolean;
  preferred_model: string;
  fallback_model: string;
  token_controls: {
    max_input_tokens: number;
    max_output_tokens: number;
    max_total_tokens: number;
    max_context_messages: number;
  };
  budget_controls: {
    daily_usd: number;
    monthly_usd: number;
    alert_threshold_pct: number;
    hard_stop: boolean;
  };
  tool_permissions: {
    enabled: string[];
  };
  memory: {
    enabled: boolean;
    injection_limit: number;
    records: MemoryRecord[];
  };
  observability: {
    logging_level: string;
    store_transcripts: boolean;
    status: string;
    last_error: string;
  };
};

const emptyCreateDraft: AgentDraft = {
  name: "",
  role: "",
  business_function: "",
  operating_entity: "Umbrella Holdings Group, LLC",
  system_prompt: "",
  pinned: false,
  preferred_model: "",
  fallback_model: "",
  token_controls: {
    max_input_tokens: 30000,
    max_output_tokens: 4000,
    max_total_tokens: 120000,
    max_context_messages: 18,
  },
  budget_controls: {
    daily_usd: 25,
    monthly_usd: 300,
    alert_threshold_pct: 80,
    hard_stop: false,
  },
  tool_permissions: {
    enabled: [],
  },
  memory: {
    enabled: true,
    injection_limit: 4,
    records: [],
  },
  observability: {
    logging_level: "standard",
    store_transcripts: true,
    status: "active",
    last_error: "",
  },
};

type HealthTone = "healthy" | "warning" | "error" | "unknown";

function StatusDot({
  state,
  label,
  className,
}: {
  state: "healthy" | "warning" | "critical" | "processing" | "unknown";
  label?: string;
  className?: string;
}) {
  const tone = state === "critical"
    ? { color: "rgb(255,99,109)", halo: "rgba(251,44,54,0.22)", animate: true }
    : state === "warning"
      ? { color: "var(--warm-glow)", halo: "color-mix(in srgb, var(--warm-glow) 20%, transparent)", animate: true }
      : state === "processing"
        ? { color: "rgb(151,197,255)", halo: "rgba(116,176,255,0.18)", animate: true }
        : state === "unknown"
          ? { color: "rgba(148,163,184,0.78)", halo: "rgba(148,163,184,0.12)", animate: false }
          : { color: "rgb(107,241,153)", halo: "rgba(74,222,128,0.22)", animate: true };
  const style = {
    "--status-dot-color": tone.color,
    "--status-dot-halo": tone.halo,
  } as CSSProperties;
  return (
    <span
      className={cn("status-dot relative inline-flex h-2.5 w-2.5 shrink-0 rounded-full", tone.animate ? "status-dot--animated" : "status-dot--static", className)}
      style={style}
      aria-label={label ?? titleCase(state)}
      title={label ?? titleCase(state)}
    >
      <span className="status-dot__halo absolute inset-0 rounded-full" />
      <span className="status-dot__core relative h-2.5 w-2.5 rounded-full border border-black/15" />
    </span>
  );
}

function StatusInline({
  state,
  label,
  className,
}: {
  state: "healthy" | "warning" | "critical" | "processing" | "unknown";
  label?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground", className)}>
      <StatusDot state={state} label={label} />
      {label && <span className="truncate">{label}</span>}
    </span>
  );
}

function HealthInline({ tone, label }: { tone: HealthTone; label: string }) {
  const state = tone === "error" ? "critical" : tone === "warning" ? "warning" : tone === "unknown" ? "unknown" : "healthy";
  return <StatusInline state={state} label={label} />;
}

function toAgentDraft(agent: AgentRecord | null): AgentDraft {
  if (!agent) return emptyCreateDraft;
  return {
    name: agent.name,
    role: agent.role,
    business_function: agent.business_function,
    operating_entity: agent.operating_entity,
    system_prompt: agent.system_prompt,
    pinned: agent.pinned,
    preferred_model: agent.preferred_model,
    fallback_model: agent.fallback_model,
    token_controls: { ...agent.token_controls },
    budget_controls: { ...agent.budget_controls },
    tool_permissions: {
      enabled: [...agent.tool_permissions.enabled],
    },
    memory: {
      enabled: agent.memory.enabled,
      injection_limit: agent.memory.injection_limit,
      records: agent.memory.records.map((record) => ({ ...record })),
    },
    observability: { ...agent.observability },
  };
}

const loggingLevelOptions = ["standard", "verbose", "debug"];

function numberOrZero(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasUsageData(summary?: ConversationRecord["usage_summary"] | AgentRecord["usage_summary"] | null): boolean {
  if (!summary) return false;
  return [
    summary.input_tokens,
    summary.output_tokens,
    summary.total_tokens,
    summary.estimated_cost,
    summary.actual_cost,
  ].some((value) => (value ?? 0) > 0);
}

function usageDiagnosticsTone(diagnostics?: UsageDiagnostics): NoticeTone {
  if (diagnostics?.connection_state === "issue") return "error";
  if (diagnostics?.metrics_state === "measured") return "success";
  if (diagnostics?.metrics_state === "unavailable") return "warning";
  return "info";
}

function usageAvailabilityLabel(diagnostics?: UsageDiagnostics): string {
  if (!diagnostics) return "Usage pending";
  if (diagnostics.metrics_state === "measured") return "Measured usage";
  if (diagnostics.connection_state === "issue") return "Connection issue";
  if (diagnostics.connection_state === "connected") return "Connected · no metrics";
  return diagnostics.status_label;
}

function capabilityTone(state: ProviderCapabilities["usage_support"]): NoticeTone {
  if (state === "supported") return "success";
  if (state === "unavailable") return "warning";
  return "info";
}

function buildConversationTitle(agent: AgentRecord, conversationCount: number): string {
  const base = agent.business_function?.trim() || agent.name.trim() || "Agent";
  return `${base} · Session ${conversationCount + 1}`;
}

function getStarterPrompts(agent: AgentRecord): string[] {
  const agentName = agent.name.trim();
  const functionLabel = agent.business_function?.trim() || "operations";
  return [
    `Give me a concise operating brief for ${agentName} focused on current priorities, risks, and next actions.`,
    `Create a 30-day execution plan for ${functionLabel.toLowerCase()} under ${agent.operating_entity}.`,
    "Review this agent's mandate and tell me the highest-leverage first task to run right now.",
  ];
}

function activityStateForRun(status?: string): "healthy" | "warning" | "critical" | "processing" {
  if (status === "error") return "critical";
  if (status === "running") return "processing";
  if (status === "idle") return "warning";
  return "healthy";
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string>("");
  const [query, setQuery] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [messagesState, setMessagesState] = useState<LoadState>("idle");
  const [editorDraft, setEditorDraft] = useState<AgentDraft>(emptyCreateDraft);
  const [createDraft, setCreateDraft] = useState<AgentDraft>(emptyCreateDraft);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [savingAgent, setSavingAgent] = useState(false);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [deletingAgent, setDeletingAgent] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editingConversationTitle, setEditingConversationTitle] = useState("");
  const [conversationActionId, setConversationActionId] = useState<string | null>(null);
  const [composerText, setComposerText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatStatus, setChatStatus] = useState<"idle" | "processing" | "error">("idle");
  const { send: sendChatStream } = useChatStream();
  const tempMessageIdRef = useRef(-1);
  const lastUserMessageRef = useRef<{ agentId: string; conversationId: string; content: string } | null>(null);
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const [mutationError, setMutationError] = useState("");
  const [mutationNotice, setMutationNotice] = useState("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const shouldFocusComposerRef = useRef(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAgentDrawer, setShowAgentDrawer] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>(() => {
    if (typeof window === "undefined") return "new-chat";
    const resolved = resolveHashView(window.location.hash);
    if (!resolved.fallback && window.location.hash !== "") return resolved.view;
    // No hash present: fall back to the last-used view from storage.
    const stored = window.localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY);
    return stored === "monitor" || stored === "maintenance" || stored === "new-chat" || stored === "settings" || stored === "briefings" || stored === "inbox" || stored === "agents" || stored === "tracking" ? stored : "new-chat";
  });
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(() => {
    if (typeof window === "undefined") return "models";
    return resolveHashView(window.location.hash).settingsSection;
  });
  const [recentsTick, setRecentsTick] = useState(0);
  const [defaultModel, setDefaultModelState] = useState<string | null>(() => getDefaultModel());
  const [railCollapsed, setRailCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(RAIL_COLLAPSED_STORAGE_KEY) === "true";
  });
  const [modelPreference, setModelPreference] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(MODEL_PREFERENCE_STORAGE_KEY) ?? "";
  });
  const [showAgentRoutePicker, setShowAgentRoutePicker] = useState(false);
  const [hermesDirectHint, setHermesDirectHint] = useState(false);
  const [activeTheme, setActiveTheme] = useState<ThemeName>(() => {
    if (typeof window === "undefined") return DEFAULT_THEME.name;
    try {
      // Slice 3: curated key wins if present, else legacy key for back-compat.
      const curated = window.localStorage.getItem(THEME_STORAGE_KEY_V1);
      if (curated) {
        const def = getThemeDefinition(curated);
        applyTheme(def.name);
        applyBackground(getStoredBackground(), def.name);
        try { document.documentElement.setAttribute("data-theme", def.name); } catch { /* ignore */ }
        return def.name;
      }
      const legacy = getThemeDefinition(window.localStorage.getItem(THEME_STORAGE_KEY)).name;
      applyTheme(legacy);
      applyBackground(getStoredBackground(), legacy);
      return legacy;
    } catch {
      return DEFAULT_THEME.name;
    }
  });
  const [activeBackground, setActiveBackground] = useState<BackgroundId>(() => getStoredBackground());
  const [navUnreadTotal, setNavUnreadTotal] = useState(0);
  const [account, setAccount] = useState<AccountRecord>(DEFAULT_ACCOUNT);
  const [showInstallModal, setShowInstallModal] = useState(false);

  const loadBootstrap = useCallback(async (nextAgentId?: string | null, nextConversationId?: string | null) => {
    setState("loading");
    setError("");
    try {
      const response = await api.getBootstrap();
      setBootstrap(response);
      setSelectedAgentId((current) => nextAgentId ?? current ?? null);
      if (typeof nextConversationId !== "undefined") {
        setSelectedConversationId(nextConversationId);
      }
      setState("idle");
      return response;
    } catch (err) {
      setBootstrap(mockBootstrap);
      setSelectedAgentId((current) => nextAgentId ?? current ?? null);
      if (typeof nextConversationId !== "undefined") {
        setSelectedConversationId(nextConversationId ?? mockBootstrap.conversations[0]?.id ?? null);
      }
      setMutationNotice("Preview mode keeps the interface available while upstream API work continues.");
      setState("idle");
      setError(err instanceof Error ? err.message : "Failed to load Mission Control");
      return mockBootstrap;
    }
  }, []);

  const loadConversationMessages = useCallback(async (conversationId: string) => {
    setMessagesState("loading");
    try {
      const response = await api.getConversationMessages(conversationId);
      setMessages(response.messages);
      setMessagesState("idle");
    } catch {
      setMessages(mockConversationMessages[conversationId] ?? []);
      setMessagesState("idle");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBootstrap();
    void api.getAccount().then(setAccount).catch(() => undefined);
  }, [loadBootstrap]);

  useEffect(() => {
    const loadUnread = () => {
      void api.getUnreadCounts()
        .then((counts) => setNavUnreadTotal(Object.values(counts).reduce((sum, count) => sum + (Number(count) || 0), 0)))
        .catch(() => undefined);
    };
    loadUnread();
    const onVisibility = () => { if (!document.hidden) loadUnread(); };
    document.addEventListener("visibilitychange", onVisibility);
    const id = window.setInterval(() => { if (!document.hidden) loadUnread(); }, 60000);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  useEffect(() => {
    try {
      applyTheme(activeTheme);
      applyBackground(activeBackground, activeTheme);
      setStoredBackground(activeBackground);
      window.localStorage.setItem(THEME_STORAGE_KEY, activeTheme);
      // Slice 3: mirror curated ids into the v1 key + data-theme attribute so
      // reloads in a fresh browser pick up the spec-mandated contract.
      const curatedIds = CURATED_THEMES.map((t) => t.id) as string[];
      if (curatedIds.includes(activeTheme)) {
        window.localStorage.setItem(THEME_STORAGE_KEY_V1, activeTheme);
        try { document.documentElement.setAttribute("data-theme", activeTheme); } catch { /* ignore */ }
      }
    } catch {
      // ignore local theme persistence failures
    }
  }, [activeTheme, activeBackground]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, activeView);
    } catch {
      // ignore local view persistence failures
    }
  }, [activeView]);

  // View → hash projection. Idempotent: only writes when the target hash
  // differs from the current one. Uses replaceState so we don't pollute history
  // on every internal view transition (Back must skip these). The chip's
  // "More models" pushState lives in `openSettingsModels` and is a deliberate
  // separate code path.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let target: string;
    if (activeView === "settings") {
      target = `#/settings/${settingsSection}`;
    } else if (activeView === "briefings") {
      target = "#/briefings";
    } else if (activeView === "inbox") {
      target = "#/inbox";
    } else if (activeView === "agents") {
      target = "#/agents";
    } else if (activeView === "tracking") {
      target = window.location.hash.startsWith("#/tracking?") ? window.location.hash : "#/tracking";
    } else if (activeView === "monitor") {
      target = "#/monitor";
    } else if (activeView === "maintenance") {
      target = "#/maintenance";
    } else {
      target = "#/";
    }
    if (window.location.hash === target) return;
    try {
      window.history.replaceState(null, "", target);
    } catch {
      window.location.hash = target;
    }
  }, [activeView, settingsSection]);

  // Hash → view propagation. Fires on mount AND on `hashchange` (manual URL
  // edits + browser Back/Forward). Idempotent: only setState when the resolved
  // view differs from current state. Also normalizes the bare "#/settings"
  // redirect target to "#/settings/models" via replaceState (no extra history
  // entry — Back must skip the redirect).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const applyFromHash = () => {
      const resolved = resolveHashView(window.location.hash);
      if (resolved.view !== activeView) setActiveView(resolved.view);
      if (resolved.view === "settings" && resolved.settingsSection !== settingsSection) {
        setSettingsSection(resolved.settingsSection);
      }
      if (resolved.redirectToModels && window.location.hash !== "#/settings/models") {
        try {
          window.history.replaceState(null, "", "#/settings/models");
        } catch {
          window.location.hash = "#/settings/models";
        }
      }
    };
    window.addEventListener("hashchange", applyFromHash);
    applyFromHash();
    return () => window.removeEventListener("hashchange", applyFromHash);
  }, [activeView, settingsSection]);

  // Cross-tab sync for recents + default model.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === RECENTS_STORAGE_KEY) setRecentsTick((n) => n + 1);
      if (event.key === DEFAULT_MODEL_STORAGE_KEY) setDefaultModelState(getDefaultModel());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(RAIL_COLLAPSED_STORAGE_KEY, String(railCollapsed));
    } catch {
      // ignore local rail persistence failures
    }
  }, [railCollapsed]);

  useEffect(() => {
    if (!modelPreference) return;
    try {
      window.localStorage.setItem(MODEL_PREFERENCE_STORAGE_KEY, modelPreference);
    } catch {
      // ignore local model persistence failures
    }
  }, [modelPreference]);

  const selectedAgent = bootstrap?.agents.find((agent) => agent.id === selectedAgentId) ?? null;
  const catalogModels = bootstrap?.catalog.models ?? [];
  const activeModelPreference = modelPreference || selectedAgent?.preferred_model || defaultModel || catalogModels[0] || "openai/gpt-5.5";
  const recentsForPicker = useMemo(
    () => getRecentsPadded(catalogModels, defaultModel ?? activeModelPreference),
    // recentsTick increments on cross-tab storage updates so this list stays fresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalogModels, defaultModel, activeModelPreference, recentsTick],
  );
  const openSettingsModels = useCallback(() => {
    setActiveView("settings");
    setSettingsSection("models");
    if (typeof window !== "undefined") {
      const target = "#/settings/models";
      if (window.location.hash !== target) {
        try {
          window.history.pushState(null, "", target);
        } catch {
          window.location.hash = target;
        }
      }
    }
  }, []);
  const openSettingsSection = useCallback((section: SettingsSection) => {
    setActiveView("settings");
    setSettingsSection(section);
    navigateToSettingsSection(section);
  }, []);
  const firstTimeUser = (bootstrap?.conversations.length ?? 0) === 0;
  const hermesDirectAgent = useMemo(() => {
    const agents = bootstrap?.agents ?? [];
    return agents.find((agent) => /hermes/i.test(agent.name)) ?? agents[0] ?? null;
  }, [bootstrap]);
  const conversationsForSelectedAgent = useMemo(
    () => bootstrap?.conversations.filter((conversation) => conversation.agent_id === selectedAgentId) ?? [],
    [bootstrap, selectedAgentId],
  );
  const selectedConversation = conversationsForSelectedAgent.find((conversation) => conversation.id === selectedConversationId)
    ?? bootstrap?.conversations.find((conversation) => conversation.id === selectedConversationId)
    ?? null;
  const isInitialLoading = state === "loading" && !bootstrap;
  const isRefreshingBootstrap = state === "loading" && Boolean(bootstrap);
  const noAgents = (bootstrap?.agents.length ?? 0) === 0;
  const hasUsage = hasUsageData(selectedConversation?.usage_summary);
  const hasAgentUsage = hasUsageData(selectedAgent?.usage_summary);
  const selectedConversationDiagnostics = selectedConversation?.usage_diagnostics;
  const selectedProviderCapabilities = selectedConversation?.provider_capabilities ?? selectedAgent?.provider_capabilities;
  const activeMemoryRecords = editorDraft.memory.records.filter((record) => record.active);
  const memoryStatusLabel = editorDraft.memory.enabled ? `${activeMemoryRecords.length} active • ${editorDraft.memory.injection_limit} injected/run` : "Disabled";
  const routingSummary = editorDraft.fallback_model
    ? `${editorDraft.preferred_model || "Unassigned"} → ${editorDraft.fallback_model}`
    : editorDraft.preferred_model || "Unassigned";
  const latestAssistantId = [...messages].reverse().find((message) => message.role === "assistant")?.id;
  const latestUserId = [...messages].reverse().find((message) => message.role === "user")?.id;

  useEffect(() => {
    const element = threadScrollRef.current;
    if (!element || !shouldAutoScrollRef.current) return;
    element.scrollTo({ top: element.scrollHeight, behavior: sendingMessage ? "smooth" : "auto" });
  }, [messages, sendingMessage]);

  const handleThreadScroll = () => {
    const element = threadScrollRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 80;
  };

  const conversationsByAgent = useMemo(() => {
    const map = new Map<string, ConversationRecord[]>();
    for (const conversation of bootstrap?.conversations ?? []) {
      map.set(conversation.agent_id, [...(map.get(conversation.agent_id) ?? []), conversation]);
    }
    for (const [agentId, list] of map.entries()) {
      list.sort((a, b) => {
        const pinDelta = Number(b.pinned) - Number(a.pinned);
        if (pinDelta !== 0) return pinDelta;
        const aKey = a.last_message_at ?? a.updated_at;
        const bKey = b.last_message_at ?? b.updated_at;
        return bKey.localeCompare(aKey);
      });
      map.set(agentId, list);
    }
    return map;
  }, [bootstrap]);

  const filteredAgents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!bootstrap) return [];
    return bootstrap.agents.filter((agent) => {
      if (!normalized) return true;
      const conversationTitles = (conversationsByAgent.get(agent.id) ?? []).map((conversation) => conversation.title);
      const haystack = [agent.name, agent.business_function, agent.operating_entity, ...conversationTitles].join(" ").toLowerCase();
      return haystack.includes(normalized);
    });
  }, [bootstrap, conversationsByAgent, query]);

  useEffect(() => {
    if (!selectedAgent) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditorDraft(toAgentDraft(selectedAgent));
    setMutationError("");
    setMutationNotice("");
  }, [selectedAgent]);

  useEffect(() => {
    if (!bootstrap || !selectedAgentId) return;
    const relevant = conversationsByAgent.get(selectedAgentId) ?? [];
    if (selectedConversationId && relevant.some((conversation) => conversation.id === selectedConversationId)) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedConversationId(relevant[0]?.id ?? null);
  }, [bootstrap, conversationsByAgent, selectedAgentId, selectedConversationId]);

  useEffect(() => {
    if (!selectedConversationId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages([]);
      setMessagesState("idle");
      setComposerText("");
      setChatError("");
      setChatStatus("idle");
      return;
    }
    setChatError("");
    setChatStatus("idle");
    void loadConversationMessages(selectedConversationId);
  }, [loadConversationMessages, selectedConversationId]);

  const enabledToolsetDetails = (() => {
    if (!bootstrap || !selectedAgent) return [];
    const catalog = new Map(bootstrap.catalog.toolsets.map((toolset) => [toolset.name, toolset]));
    return selectedAgent.tool_permissions.enabled.map((name) => catalog.get(name)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  })();

  const integrationHealthSummary = (() => {
    if (!selectedAgent || !selectedConversation) {
      return {
        overall: "unknown" as HealthTone,
        items: [] as Array<{ label: string; tone: HealthTone; detail: string }>,
      };
    }

    const items: Array<{ label: string; tone: HealthTone; detail: string }> = [];
    const toolsetCount = selectedAgent.tool_permissions.enabled.length;
    items.push({
      label: "Toolsets",
      tone: toolsetCount > 0 ? "healthy" : "warning",
      detail: toolsetCount > 0 ? `${toolsetCount} enabled for this agent` : "No enabled toolsets",
    });
    items.push({
      label: "Last run",
      tone: selectedConversation.last_run_status === "error"
        ? "error"
        : selectedConversation.last_run_status === "success"
          ? "healthy"
          : selectedConversation.last_run_status === "running"
            ? "warning"
            : "unknown",
      detail: selectedConversation.last_run_status === "error"
        ? (selectedConversation.last_error || "Conversation encountered an error")
        : `Status: ${selectedConversation.last_run_status}`,
    });
    items.push({
      label: "Transcripts",
      tone: editorDraft.observability.store_transcripts ? "healthy" : "warning",
      detail: editorDraft.observability.store_transcripts ? "Transcript storage enabled" : "Transcript storage disabled",
    });
    items.push({
      label: "Logging",
      tone: editorDraft.observability.logging_level === "debug"
        ? "warning"
        : editorDraft.observability.logging_level === "verbose"
          ? "healthy"
          : "healthy",
      detail: `Level: ${editorDraft.observability.logging_level}`,
    });
    items.push({
      label: "Agent status",
      tone: editorDraft.observability.status === "active"
        ? "healthy"
        : editorDraft.observability.status === "paused"
          ? "warning"
          : editorDraft.observability.status === "archived"
            ? "unknown"
            : "warning",
      detail: `Agent is ${editorDraft.observability.status}`,
    });
    if (editorDraft.observability.last_error) {
      items.push({
        label: "Last error",
        tone: "error",
        detail: editorDraft.observability.last_error,
      });
    }

    const overall: HealthTone = items.some((item) => item.tone === "error")
      ? "error"
      : items.some((item) => item.tone === "warning")
        ? "warning"
        : items.some((item) => item.tone === "healthy")
          ? "healthy"
          : "unknown";

    return { overall, items };
  })();

  const groupedAgents = useMemo(() => {
    const groups = new Map<string, AgentRecord[]>();
    for (const agent of filteredAgents) {
      const groupKey = `${agent.operating_entity} · ${agent.business_function}`;
      groups.set(groupKey, [...(groups.get(groupKey) ?? []), agent]);
    }
    return Array.from(groups.entries());
  }, [filteredAgents]);

  const hasDraftChanges = selectedAgent
    ? JSON.stringify(editorDraft) !== JSON.stringify(toAgentDraft(selectedAgent))
    : false;
  const starterPrompts = selectedAgent ? getStarterPrompts(selectedAgent) : [];
  const themeOptions = useMemo(() => getThemeOptions(), []);
  const activeThemeDefinition = getThemeDefinition(activeTheme);
  const selectedAgentRecentConversations = [...(selectedAgent?.recent_conversations ?? [])].sort((a, b) => {
    const aKey = a.last_message_at ?? a.updated_at ?? "";
    const bKey = b.last_message_at ?? b.updated_at ?? "";
    return bKey.localeCompare(aKey);
  });

  const composerHint = !selectedAgent
    ? firstTimeUser && hermesDirectHint
      ? "Chatting with Hermes (your build agent)"
      : "Type a message, then choose an agent route."
    : !selectedConversation
      ? "Create or select a conversation to begin chatting."
      : sendingMessage
        ? "Sending and waiting for assistant response…"
        : "Enter to send. Shift+Enter for newline.";

  const mutationNoticeTone: NoticeTone | null = mutationError
    ? "error"
    : mutationNotice
      ? "success"
      : null;

  useEffect(() => {
    if (!selectedConversation || !shouldFocusComposerRef.current) return;
    const focusComposer = () => composerRef.current?.focus();
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(focusComposer);
    } else {
      focusComposer();
    }
    shouldFocusComposerRef.current = false;
  }, [selectedConversation]);

  const handleApplyStarterPrompt = (prompt: string) => {
    setComposerText(prompt);
    if (selectedConversation) {
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => composerRef.current?.focus());
      } else {
        composerRef.current?.focus();
      }
    }
  };

  const handleCreateConversation = async (agentOverride?: AgentRecord) => {
    const targetAgent = agentOverride ?? selectedAgent;
    if (!targetAgent) return;
    setCreatingConversation(true);
    setMutationError("");
    setMutationNotice("");
    try {
      const response = await api.createConversation(
        targetAgent.id,
        buildConversationTitle(targetAgent, (conversationsByAgent.get(targetAgent.id) ?? []).length),
      );
      shouldFocusComposerRef.current = true;
      await loadBootstrap(targetAgent.id, response.conversation.id);
      setMutationNotice(`Created ${response.conversation.title}. Send the first message to start a persisted transcript.`);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Failed to create conversation.");
    } finally {
      setCreatingConversation(false);
    }
  };

  const handleStartRenameConversation = (conversation: ConversationRecord) => {
    setEditingConversationId(conversation.id);
    setEditingConversationTitle(conversation.title);
    setMutationError("");
    setMutationNotice("");
  };

  const handleRenameConversation = async (conversation: ConversationRecord) => {
    const title = editingConversationTitle.trim();
    if (!title) {
      setMutationError("Conversation title is required.");
      return;
    }
    setConversationActionId(conversation.id);
    setMutationError("");
    setMutationNotice("");
    try {
      await api.updateConversation(conversation.id, { title });
      await loadBootstrap(selectedAgentId, conversation.id);
      setEditingConversationId(null);
      setEditingConversationTitle("");
      setMutationNotice("Conversation renamed.");
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Failed to rename conversation.");
    } finally {
      setConversationActionId(null);
    }
  };

  const handleToggleConversationPin = async (conversation: ConversationRecord) => {
    setConversationActionId(conversation.id);
    setMutationError("");
    setMutationNotice("");
    try {
      await api.updateConversation(conversation.id, { pinned: !conversation.pinned });
      await loadBootstrap(selectedAgentId, conversation.id);
      setMutationNotice(conversation.pinned ? "Conversation unpinned." : "Conversation pinned.");
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Failed to update conversation.");
    } finally {
      setConversationActionId(null);
    }
  };

  const handleDeleteConversation = async (conversation: ConversationRecord) => {
    const confirmed = window.confirm(`Delete conversation "${conversation.title}"?`);
    if (!confirmed) return;
    setConversationActionId(conversation.id);
    setMutationError("");
    setMutationNotice("");
    try {
      await api.deleteConversation(conversation.id);
      const remainingForAgent = (conversationsByAgent.get(conversation.agent_id) ?? []).filter((item) => item.id !== conversation.id);
      const nextConversationId = selectedConversationId === conversation.id ? (remainingForAgent[0]?.id ?? null) : selectedConversationId;
      await loadBootstrap(selectedAgentId, nextConversationId);
      if (editingConversationId === conversation.id) {
        setEditingConversationId(null);
        setEditingConversationTitle("");
      }
      setMutationNotice("Conversation deleted.");
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Failed to delete conversation.");
    } finally {
      setConversationActionId(null);
    }
  };

  const handleCreateAgent = async () => {
    const name = createDraft.name.trim();
    if (!name) {
      setMutationError("Agent name is required.");
      return;
    }
    setCreatingAgent(true);
    setMutationError("");
    setMutationNotice("");
    try {
      const payload = {
        name,
        role: createDraft.role.trim() || "Define operating behavior.",
        business_function: createDraft.business_function.trim() || "Operations",
        operating_entity: createDraft.operating_entity.trim() || "Umbrella Holdings Group, LLC",
        system_prompt: createDraft.system_prompt.trim() || createDraft.role.trim() || "Define operating behavior.",
        pinned: createDraft.pinned,
        team_grouping: createDraft.business_function.trim() || "Operations",
      };
      const response = await api.createAgent(payload);
      await loadBootstrap(response.agent.id, null);
      setShowCreateForm(false);
      setCreateDraft(emptyCreateDraft);
      setMutationNotice(`Created ${response.agent.name}.`);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Failed to create agent.");
    } finally {
      setCreatingAgent(false);
    }
  };

  const handleSaveAgent = async () => {
    if (!selectedAgent) return;
    setSavingAgent(true);
    setMutationError("");
    setMutationNotice("");
    try {
      const response = await api.updateAgent(selectedAgent.id, {
        name: editorDraft.name.trim(),
        role: editorDraft.role,
        business_function: editorDraft.business_function,
        operating_entity: editorDraft.operating_entity,
        system_prompt: editorDraft.system_prompt,
        pinned: editorDraft.pinned,
        preferred_model: editorDraft.preferred_model,
        fallback_model: editorDraft.fallback_model,
        token_controls: editorDraft.token_controls,
        budget_controls: editorDraft.budget_controls,
        tool_permissions: editorDraft.tool_permissions,
        memory: editorDraft.memory,
        observability: editorDraft.observability,
      });
      await loadBootstrap(response.agent.id, selectedConversationId);
      setMutationNotice(`Saved changes to ${response.agent.name}.`);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Failed to save agent.");
    } finally {
      setSavingAgent(false);
    }
  };

  const handleDeleteAgent = async () => {
    if (!selectedAgent) return;
    const confirmed = window.confirm(`Delete ${selectedAgent.name}? This also removes its Mission Control conversations.`);
    if (!confirmed) return;
    setDeletingAgent(true);
    setMutationError("");
    setMutationNotice("");
    try {
      await api.deleteAgent(selectedAgent.id);
      const currentAgents = bootstrap?.agents ?? [];
      const remaining = currentAgents.filter((agent) => agent.id !== selectedAgent.id);
      await loadBootstrap(remaining[0]?.id ?? null, null);
      setMutationNotice(`Deleted ${selectedAgent.name}.`);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Failed to delete agent.");
    } finally {
      setDeletingAgent(false);
    }
  };

  const handleSelectView = (view: ActiveView) => {
    setActiveView(view);
    if (view === "new-chat") {
      setSelectedAgentId(null);
      setSelectedConversationId(null);
      setComposerText("");
      setMessages([]);
      setShowAgentRoutePicker(false);
      setHermesDirectHint(false);
    }
  };

  const selectAgentForDraft = async (agent: AgentRecord, hermesDirect = false) => {
    setShowAgentRoutePicker(false);
    setHermesDirectHint(hermesDirect);
    setSelectedAgentId(agent.id);
    setActiveView("new-chat");
    setMutationError("");
    try {
      const existingConversation = (conversationsByAgent.get(agent.id) ?? [])[0];
      if (existingConversation) {
        setSelectedConversationId(existingConversation.id);
      } else {
        setCreatingConversation(true);
        const response = await api.createConversation(agent.id, buildConversationTitle(agent, 0));
        await loadBootstrap(agent.id, response.conversation.id);
      }
      shouldFocusComposerRef.current = true;
      window.requestAnimationFrame(() => composerRef.current?.focus());
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Failed to route message.");
    } finally {
      setCreatingConversation(false);
    }
  };

  const handleSelectHermesDirect = () => {
    if (hermesDirectAgent) {
      setHermesDirectHint(true);
      void selectAgentForDraft(hermesDirectAgent, true);
    }
  };

  const handleComposerChange = (value: string) => {
    setComposerText(value);
    if (activeView === "new-chat" && !selectedAgent && value.length > 0) {
      if (firstTimeUser) {
        setHermesDirectHint(true);
        setShowAgentRoutePicker(false);
        if (hermesDirectAgent) void selectAgentForDraft(hermesDirectAgent, true);
      } else {
        setShowAgentRoutePicker(true);
      }
    }
    if (!value.trim()) {
      setShowAgentRoutePicker(false);
    }
  };

  const handleSendMessage = async (overrideContent?: string) => {
    const content = (overrideContent ?? composerText).trim();
    if (!selectedAgent || !selectedConversation || !content || sendingMessage) {
      return;
    }

    shouldAutoScrollRef.current = true;
    lastUserMessageRef.current = { agentId: selectedAgent.id, conversationId: selectedConversation.id, content };
    const optimisticUserId = tempMessageIdRef.current;
    tempMessageIdRef.current -= 1;
    const optimisticAssistantId = tempMessageIdRef.current;
    tempMessageIdRef.current -= 1;
    const optimisticUser: ConversationMessage = {
      id: optimisticUserId,
      role: "user",
      content,
      client_status: "complete",
    };
    const optimisticAssistant: ConversationMessage = {
      id: optimisticAssistantId,
      role: "assistant",
      content: "",
      client_status: "thinking",
      tool_events: [],
    };

    setComposerText("");
    setChatError("");
    setChatStatus("processing");
    setSendingMessage(true);
    setMessagesState("idle");
    setMessages((current) => [...current, optimisticUser, optimisticAssistant]);

    // Promote on send — the user's intent was to use this model, so update
    // recents the moment we kick off the stream. We deliberately do NOT wait
    // for stream completion: a network error doesn't undo the intent.
    promoteOnSend(activeModelPreference);
    setRecentsTick((n) => n + 1);

    try {
      const result = await sendChatStream(
        {
          agent_id: selectedAgent.id,
          conversation_id: selectedConversation.id,
          message: { role: "user", content },
        },
        {
          onDelta: (text) => {
            setMessages((current) => current.map((message) => (
              message.id === optimisticAssistantId
                ? { ...message, content: `${message.content}${text}`, client_status: "streaming" }
                : message
            )));
          },
          onTool: (tool) => {
            setMessages((current) => current.map((message) => (
              message.id === optimisticAssistantId
                ? { ...message, tool_events: [...(message.tool_events ?? []).filter((item) => item.id !== tool.id), tool] }
                : message
            )));
          },
          onStatus: (status) => {
            setChatStatus(status === "running" || status === "started" ? "processing" : status === "completed" ? "idle" : "error");
          },
        },
      );
      const finalContent = result.reply.content.trim();
      setMessages((current) => current.map((message) => (
        message.id === optimisticAssistantId
          ? finalContent || message.content
            ? { ...message, content: message.content || finalContent, client_status: "complete" }
            : { ...message, content: "", client_status: "error", error_message: "Stream completed without assistant content." }
          : message.id === optimisticUserId
            ? { ...message, client_status: "complete" }
            : message
      )));
      if (!finalContent) {
        setChatError("Stream completed without assistant content.");
        setChatStatus("error");
      }
      await loadBootstrap(selectedAgent.id, selectedConversation.id);
      if (finalContent) setChatStatus("idle");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send message.";
      setMessages((current) => current.map((item) => (
        item.id === optimisticAssistantId
          ? { ...item, content: "", client_status: "error", error_message: message }
          : item
      )));
      setChatError(message);
      setChatStatus("error");
      await loadBootstrap(selectedAgent.id, selectedConversation.id);
    } finally {
      setSendingMessage(false);
    }
  };

  const handleRetryLastMessage = () => {
    const last = lastUserMessageRef.current;
    if (!last || !selectedAgent || !selectedConversation || sendingMessage) return;
    setMessages((current) => current.filter((message) => message.client_status !== "error"));
    void handleSendMessage(last.content);
  };

  const handleRegenerateLatest = () => {
    const latestUser = [...messages].reverse().find((message) => message.role === "user");
    if (!latestUser || sendingMessage) return;
    setMessages((current) => {
      const latestAssistantIndex = current.findLastIndex((message) => message.role === "assistant");
      return latestAssistantIndex >= 0 ? current.slice(0, latestAssistantIndex) : current;
    });
    void handleSendMessage(latestUser.content);
  };

  const handleEditLatestUser = (message: ConversationMessage) => {
    if (sendingMessage) return;
    const index = messages.findIndex((item) => item.id === message.id);
    if (index < 0) return;
    setComposerText(message.content);
    setMessages((current) => current.slice(0, index));
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="theme-background" />
      <div className="noise-overlay" />
      <div className="warm-glow" />
      <NavigationRail
        activeView={activeView}
        collapsed={railCollapsed}
        onToggleCollapsed={() => setRailCollapsed((current) => !current)}
        onSelectView={handleSelectView}
        onOpenSettingsSection={openSettingsSection}
        unreadTotal={navUnreadTotal}
        account={account}
        onOpenInstall={() => setShowInstallModal(true)}
        mobileOpen={showMobileNav}
        onCloseMobile={() => setShowMobileNav(false)}
      />

      <div className={cn("relative z-10 flex min-h-screen flex-col px-4 py-4 transition-[margin] sm:px-6 lg:px-8 lg:py-6", railCollapsed ? "md:ml-16" : "md:ml-[220px]")}> 
        <TopContextBar
          healthyLabel={bootstrap?.summary.alerting_agents ? `${bootstrap.summary.alerting_agents} alerting` : "Healthy"}
          onOpenMobileNav={() => setShowMobileNav(true)}
          onOpenAgentDrawer={() => setShowAgentDrawer(true)}
        />

        {isInitialLoading && (
          <div className="flex flex-1 items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading Mission Control…
          </div>
        )}

        {state === "error" && !bootstrap && (
          <Card className="flex-1">
            <CardContent className="flex h-full min-h-[320px] flex-col items-center justify-center gap-4 text-center">
              <AlertTriangle className="h-10 w-10 text-warning" />
              <div>
                <div className="font-expanded text-lg uppercase tracking-[0.1em]">Mission Control failed to load</div>
                <p className="mt-2 max-w-xl text-sm text-muted-foreground">{error}</p>
              </div>
              <Button onClick={() => void loadBootstrap(selectedAgentId, selectedConversationId)}>Retry</Button>
            </CardContent>
          </Card>
        )}

        {bootstrap && (
          <>
            <div className="mb-4 space-y-3">
              {isRefreshingBootstrap && (
                <InlineNotice
                  tone="info"
                  title="Refreshing Mission Control"
                  detail="Updating agents, conversations, and usage summaries without leaving the current workspace."
                  icon={<Loader2 className="h-4 w-4 animate-spin" />}
                />
              )}
              {state === "error" && bootstrap && (
                <InlineNotice
                  tone="error"
                  title="Refresh failed"
                  detail={error || "Mission Control could not refresh. Existing data remains available."}
                  action={(
                    <Button variant="outline" size="sm" onClick={() => void loadBootstrap(selectedAgentId, selectedConversationId)}>
                      Retry refresh
                    </Button>
                  )}
                />
              )}
              {mutationNoticeTone && (
                <InlineNotice
                  tone={mutationNoticeTone}
                  title={mutationError ? "Action failed" : "Update applied"}
                  detail={mutationError || mutationNotice}
                />
              )}
            </div>

            <MobileAgentDrawer
              open={showAgentDrawer}
              onClose={() => setShowAgentDrawer(false)}
              groupedAgents={groupedAgents}
              conversationsByAgent={conversationsByAgent}
              selectedAgentId={selectedAgentId}
              selectedConversationId={selectedConversationId}
              creatingConversation={creatingConversation}
              onSelectAgent={(agentId) => {
                setActiveView("new-chat");
                setSelectedAgentId(agentId);
                setShowAgentDrawer(false);
              }}
              onSelectConversation={(agentId, conversationId) => {
                setActiveView("new-chat");
                setSelectedAgentId(agentId);
                setSelectedConversationId(conversationId);
                setShowAgentDrawer(false);
              }}
              onCreateAgent={() => {
                setShowCreateForm(true);
                setShowAgentDrawer(false);
              }}
              onCreateConversation={(agent) => {
                void handleCreateConversation(agent);
                setShowAgentDrawer(false);
              }}
            />

            {activeView === "briefings" ? (
              <BriefingsView />
            ) : activeView === "inbox" ? (
              <InboxView agents={bootstrap.agents} />
            ) : activeView === "agents" ? (
              <AgentsView bootstrap={bootstrap} onRefresh={loadBootstrap} />
            ) : activeView === "tracking" ? (
              <TrackingView agents={bootstrap.agents} initialAgentId={new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("agent_id")} initialItemId={new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("item_id")} />
            ) : activeView === "monitor" ? (
              <MonitorView agents={bootstrap.agents} />
            ) : activeView === "maintenance" ? (
              <MaintenanceView />
            ) : activeView === "settings" ? (
              <SettingsView
                section={settingsSection}
                catalog={catalogModels}
                onSelectSection={setSettingsSection}
                activeTheme={activeTheme}
                onSelectTheme={(id) => {
                  setActiveTheme(id);
                  setStoredTheme(id);
                  applyCuratedTheme(id);
                  applyBackground(activeBackground, id);
                }}
                activeBackground={activeBackground}
                onSelectBackground={(id) => {
                  setActiveBackground(id);
                  setStoredBackground(id);
                  applyBackground(id, activeTheme);
                }}
                account={account}
                onAccountChange={setAccount}
                onOpenInstall={() => setShowInstallModal(true)}
              />
            ) : !selectedAgent && !selectedConversation ? (
              <div className="flex flex-1 flex-col">
                                <GreetingHero
                  displayName={account.display_name}
                  avatarColor={account.avatar_color}
                  avatarImage={account.avatar_image ?? null}
                  models={recentsForPicker}
                  activeModel={activeModelPreference}
                  onSelectModel={setModelPreference}
                  onOpenSettings={openSettingsModels}
                />
                <div className="relative mt-auto rounded-[28px] border border-border bg-card/70 p-4 sm:p-5">
                  {hermesDirectHint && <div className="mb-2 text-xs text-foreground/85">Chatting with Hermes (your build agent)</div>}
                  <AgentSelectionPopover open={showAgentRoutePicker} agents={bootstrap.agents} onSelectAgent={(agent) => void selectAgentForDraft(agent)} onSelectHermesDirect={handleSelectHermesDirect} />
                  <div className="flex flex-col gap-3">
                    <textarea
                      ref={composerRef}
                      value={composerText}
                      onChange={(event) => handleComposerChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void handleSendMessage();
                        }
                      }}
                      placeholder="Message Mission Control…"
                      disabled={sendingMessage}
                      className="min-h-[92px] w-full rounded-[22px] border border-border bg-background/55 px-4 py-3 text-sm leading-6 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs leading-5 text-muted-foreground">{composerHint}</div>
                      <Button className="border border-[color-mix(in_srgb,var(--warm-glow)_45%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_12%,transparent)] text-[var(--warm-glow)] hover:bg-[color-mix(in_srgb,var(--warm-glow)_18%,transparent)]" onClick={() => void handleSendMessage()} disabled={sendingMessage || !selectedConversation || !composerText.trim()}>
                        {sendingMessage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {sendingMessage ? "Sending..." : "Send"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
            <div className="grid flex-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
              <Card className="hidden min-h-[720px] overflow-hidden lg:block">
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle>Agents</CardTitle>
                      <CardDescription>Grouped by entity and function with persisted conversations nested under each agent.</CardDescription>
                    </div>
                    <div className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                      {filteredAgents.length}
                    </div>
                  </div>
                  <div className="relative mt-3">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents or conversations" className="pl-9" />
                  </div>
                  <div className="mt-3 grid gap-2 xl:grid-cols-2">
                    <Button variant="outline" className="w-full" onClick={() => setShowCreateForm((current) => !current)}>
                      <FolderPlus className="h-4 w-4" />
                      {showCreateForm ? "Close create" : "Create agent"}
                    </Button>
                    <Button variant="outline" className="w-full" onClick={() => void handleCreateConversation()} disabled={!selectedAgent || creatingConversation}>
                      {creatingConversation ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      {selectedAgent && conversationsForSelectedAgent.length === 0 ? "Start first chat" : "New chat"}
                    </Button>
                  </div>
                  {showCreateForm && (
                    <div className="mt-3 space-y-3 rounded-[24px] border border-border bg-background/45 p-4">
                      <div className="font-expanded text-xs uppercase tracking-[0.12em] text-foreground">New agent</div>
                      <Input value={createDraft.name} onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Agent name" />
                      <Input value={createDraft.business_function} onChange={(event) => setCreateDraft((current) => ({ ...current, business_function: event.target.value }))} placeholder="Business function" />
                      <Input value={createDraft.operating_entity} onChange={(event) => setCreateDraft((current) => ({ ...current, operating_entity: event.target.value }))} placeholder="Operating entity" />
                      <textarea
                        value={createDraft.role}
                        onChange={(event) => setCreateDraft((current) => ({ ...current, role: event.target.value }))}
                        placeholder="Role / mission"
                        className="min-h-[96px] w-full rounded-2xl border border-border bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30"
                      />
                      <div className="flex items-center justify-between gap-3">
                        <label className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={createDraft.pinned}
                            onChange={(event) => setCreateDraft((current) => ({ ...current, pinned: event.target.checked }))}
                            className="h-4 w-4 rounded border-border bg-background"
                          />
                          Pin on create
                        </label>
                        <Button onClick={() => void handleCreateAgent()} disabled={creatingAgent}>
                          {creatingAgent ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
                          Create
                        </Button>
                      </div>
                    </div>
                  )}
                </CardHeader>
                <CardContent className="h-[calc(100%-210px)] overflow-y-auto space-y-4">
                  {noAgents && (
                    <EmptyStateCard
                      icon={<FolderPlus className="h-8 w-8" />}
                      title="No agents created"
                      description="Start by creating an agent so Mission Control can persist configuration, conversations, and governance settings."
                      action={(
                        <Button variant="outline" onClick={() => setShowCreateForm(true)}>
                          <FolderPlus className="h-4 w-4" />
                          Create first agent
                        </Button>
                      )}
                    />
                  )}
                  {!noAgents && groupedAgents.length === 0 && (
                    <EmptyStateCard
                      icon={<Search className="h-8 w-8" />}
                      title="No matches found"
                      description="Adjust your search or clear the filter to see the full agent roster and recent conversations."
                      action={query ? <Button variant="outline" onClick={() => setQuery("")}>Clear search</Button> : undefined}
                    />
                  )}
                  {groupedAgents.map(([group, agents]) => (
                    <div key={group} className="space-y-2">
                      <div className="px-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{group}</div>
                      {agents.map((agent) => {
                        const isSelected = agent.id === selectedAgentId;
                        const agentConversations = conversationsByAgent.get(agent.id) ?? [];
                        return (
                          <div
                            key={agent.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => { setActiveView("new-chat"); setSelectedAgentId(agent.id); }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedAgentId(agent.id);
                              }
                            }}
                            className={cn(
                              "w-full rounded-[24px] border px-3.5 py-3 text-left transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30",
                              isSelected ? "border-foreground/40 bg-foreground/10 shadow-[0_18px_45px_rgba(0,0,0,0.22)]" : "border-border bg-background/35 hover:border-foreground/18 hover:bg-background/55",
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="truncate font-expanded text-sm uppercase tracking-[0.08em]">{agent.name}</span>
                                  {agent.pinned && <Sparkles className="h-3.5 w-3.5 text-warning" />}
                                </div>
                                <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                                  <StatusDot state={agent.alert_summary.state} label={titleCase(agent.alert_summary.state)} />
                                  <span className="truncate">{agent.business_function || "No function"}</span>
                                  <span className="shrink-0">·</span>
                                  <span className="truncate">{titleCase(agent.observability.status)}</span>
                                </div>
                              </div>
                              <div className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                                {formatRelativeTime(agent.last_active_at ?? agent.updated_at)}
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                              <span>{formatCurrency(agent.usage_summary.monthly_spend ?? 0)} month</span>
                              <span>{formatNumber(agent.usage_summary.total_tokens)} tokens</span>
                            </div>
                            <div className="mt-3 space-y-1.5">
                              {agentConversations.slice(0, isSelected ? agentConversations.length : 3).map((conversation) => (
                                <div
                                  key={conversation.id}
                                  className={cn(
                                    "group rounded-2xl border px-3 py-2 text-xs",
                                    selectedConversationId === conversation.id ? "border-foreground/35 bg-foreground/10" : "border-border/60 bg-background/45",
                                  )}
                                >
                                  {editingConversationId === conversation.id ? (
                                    <div className="space-y-2">
                                      <Input
                                        value={editingConversationTitle}
                                        disabled={conversationActionId === conversation.id}
                                        onChange={(event) => setEditingConversationTitle(event.target.value)}
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter") {
                                            event.preventDefault();
                                            void handleRenameConversation(conversation);
                                          }
                                          if (event.key === "Escape") {
                                            setEditingConversationId(null);
                                            setEditingConversationTitle("");
                                          }
                                        }}
                                        className="h-8 rounded-xl px-2 text-xs"
                                        autoFocus
                                      />
                                      <div className="flex items-center justify-end gap-1">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 px-2"
                                          disabled={conversationActionId === conversation.id}
                                          onClick={() => {
                                            setEditingConversationId(null);
                                            setEditingConversationTitle("");
                                          }}
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                          size="sm"
                                          className="h-7 px-2"
                                          disabled={conversationActionId === conversation.id}
                                          onClick={() => void handleRenameConversation(conversation)}
                                        >
                                          {conversationActionId === conversation.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex items-center justify-between gap-2">
                                      <button
                                        type="button"
                                        className="flex min-w-0 flex-1 items-center gap-2 pr-2 text-left"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setSelectedAgentId(agent.id);
                                          setSelectedConversationId(conversation.id);
                                        }}
                                      >
                                        {conversation.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-warning" />}
                                        <div className="min-w-0">
                                          <div className="truncate text-foreground">{conversation.title}</div>
                                          <div className="mt-1 truncate text-muted-foreground">{formatRelativeTime(conversation.last_message_at ?? conversation.updated_at)}</div>
                                        </div>
                                      </button>
                                      <div className="relative shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                                        <ConversationActionsMenu
                                          pinned={conversation.pinned}
                                          busy={conversationActionId === conversation.id}
                                          onRename={() => handleStartRenameConversation(conversation)}
                                          onPinToggle={() => void handleToggleConversationPin(conversation)}
                                          onDelete={() => void handleDeleteConversation(conversation)}
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                              {agentConversations.length === 0 && (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedAgentId(agent.id);
                                    void handleCreateConversation(agent);
                                  }}
                                  className="w-full rounded-2xl border border-dashed border-border/80 px-3 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:border-foreground/22 hover:bg-background/55"
                                >
                                  <div className="font-expanded text-[11px] uppercase tracking-[0.12em] text-foreground">No conversations yet</div>
                                  <div className="mt-1 leading-5">Start the first persisted thread.</div>
                                  <div className="mt-2 inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-foreground">
                                    <Plus className="h-3.5 w-3.5" />
                                    Start first chat
                                  </div>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="flex min-h-[720px] flex-col overflow-hidden">
                <CardHeader className="gap-3 px-4 py-3 sm:gap-4 sm:px-5 sm:py-4">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        <span className="rounded-full border border-border/70 bg-background/40 px-2.5 py-1">Workspace</span>
                        {selectedAgent && <span className="truncate">{selectedAgent.name}</span>}
                        {selectedConversation && (
                          <StatusInline
                            state={sendingMessage ? "processing" : chatStatus === "error" ? "critical" : selectedConversation.last_run_status === "error" ? "critical" : selectedConversation.last_run_status === "running" ? "processing" : "healthy"}
                            label={sendingMessage ? "Processing" : chatStatus === "error" ? "Error" : titleCase(selectedConversation.last_run_status === "success" ? "healthy" : selectedConversation.last_run_status)}
                            className="min-w-0"
                          />
                        )}
                      </div>
                      <CardTitle className="text-base normal-case tracking-[0.02em] sm:text-lg">
                        {selectedConversation ? selectedConversation.title : "Conversation workspace"}
                      </CardTitle>
                      <CardDescription className="mt-1.5 max-w-3xl text-xs leading-[1.15rem] sm:mt-2 sm:text-sm sm:leading-5">
                        {selectedConversation && selectedAgent
                          ? `${selectedAgent.name} · Updated ${formatRelativeTime(selectedConversation.last_message_at ?? selectedConversation.updated_at)}.`
                          : selectedAgent
                            ? `${selectedAgent.name} conversation surface with transcript continuity and usage context.`
                            : "Select an agent to inspect its conversations."}
                      </CardDescription>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[260px] sm:items-end">
                      <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
                        <div className="flex items-center gap-2">
                          {selectedAgent && (
                            <Button variant="outline" size="sm" onClick={() => setShowSettings(true)}>
                              <Settings2 className="h-3.5 w-3.5" />
                              Settings
                            </Button>
                          )}
                          {selectedConversation && (
                            <ConversationActionsMenu
                              pinned={selectedConversation.pinned}
                              busy={conversationActionId === selectedConversation.id}
                              onRename={() => handleStartRenameConversation(selectedConversation)}
                              onPinToggle={() => void handleToggleConversationPin(selectedConversation)}
                              onDelete={() => void handleDeleteConversation(selectedConversation)}
                            />
                          )}
                        </div>
                        <Button size="sm" className="sm:hidden" onClick={() => void handleCreateConversation()} disabled={!selectedAgent || creatingConversation}>
                          {creatingConversation ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                          New chat
                        </Button>
                      </div>
                      <Button size="sm" className="hidden sm:inline-flex" onClick={() => void handleCreateConversation()} disabled={!selectedAgent || creatingConversation}>
                        {creatingConversation ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                        New chat
                      </Button>
                    </div>
                  </div>
                  {selectedAgent && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground sm:gap-2 sm:text-[11px]">
                      <WorkspaceMetaPill label="Function" value={selectedAgent.business_function} />
                      <WorkspaceMetaPill label="Model" value={selectedConversation?.usage_summary.model || selectedAgent.preferred_model || "Unassigned"} />
                      <WorkspaceMetaPill label="Conversations" value={String(conversationsForSelectedAgent.length)} className="hidden sm:inline-flex" />
                      <WorkspaceMetaPill label="Entity" value={selectedAgent.operating_entity} className="hidden max-w-full sm:inline-flex sm:max-w-[260px]" />
                    </div>
                  )}
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-4 overflow-hidden">
                  {!selectedAgent ? (
                    <EmptyStateCard
                      icon={<Bot className="h-10 w-10" />}
                      title="No agent selected"
                      description="Choose an agent from the left sidebar to view transcripts, usage drilldown, and operational controls."
                      action={(
                        <Button variant="outline" onClick={() => setShowCreateForm(true)}>
                          <FolderPlus className="h-4 w-4" />
                          Create agent
                        </Button>
                      )}
                    />
                  ) : selectedConversation ? (
                    <>
                      <div className="rounded-[22px] border border-border bg-background/34 px-3 py-2.5 sm:rounded-[24px] sm:px-5 sm:py-3">
                        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                              <StatusInline
                                state={selectedConversation.last_run_status === "error" ? "critical" : selectedConversation.last_run_status === "running" ? "processing" : selectedConversation.last_run_status === "idle" ? "warning" : "healthy"}
                                label={titleCase(selectedConversation.last_run_status === "success" ? "healthy" : selectedConversation.last_run_status)}
                              />
                              {selectedConversation.pinned && <WorkspaceMetaPill label="Pinned" value="Priority" />}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5 sm:mt-3 sm:gap-2">
                              <WorkspaceMetaPill label="Messages" value={formatNumber(selectedConversation.usage_summary.message_count ?? 0)} />
                              <WorkspaceMetaPill
                                label="Spend"
                                value={hasUsage ? formatCurrency(selectedConversation.usage_summary.estimated_cost) : usageAvailabilityLabel(selectedConversationDiagnostics)}
                              />
                              <WorkspaceMetaPill label="Tools" value={formatNumber(selectedConversation.usage_summary.tool_call_count ?? 0)} className="hidden sm:inline-flex" />
                              <WorkspaceMetaPill
                                label="Tokens"
                                value={hasUsage ? formatNumber(selectedConversation.usage_summary.total_tokens) : usageAvailabilityLabel(selectedConversationDiagnostics)}
                                className="hidden sm:inline-flex"
                              />
                              <WorkspaceMetaPill
                                label="Model"
                                value={selectedConversation.usage_summary.model || selectedAgent?.preferred_model || "Unknown"}
                                className="hidden max-w-full sm:inline-flex sm:max-w-[220px]"
                              />
                            </div>
                          </div>
                          <div className="min-w-0 max-w-xl text-[11px] leading-4 text-muted-foreground lg:text-right sm:text-xs sm:leading-5">
                            {selectedConversation.last_message_at
                              ? `Latest activity ${formatRelativeTime(selectedConversation.last_message_at)}.`
                              : `Created ${formatRelativeTime(selectedConversation.updated_at)}.`}
                          </div>
                        </div>
                        {!hasUsage && selectedConversationDiagnostics && (
                          <UsageDiagnosticNote diagnostics={selectedConversationDiagnostics} className="mt-3" compact />
                        )}
                        {selectedConversation.last_error && (
                          <div className="mt-3 rounded-[20px] border border-[rgba(251,44,54,0.35)] bg-[rgba(251,44,54,0.08)] px-3 py-3 text-xs leading-5 text-[rgb(255,180,184)]">
                            <div className="mb-1 font-expanded uppercase tracking-[0.12em]">Conversation error</div>
                            {selectedConversation.last_error}
                          </div>
                        )}
                      </div>
                      <RecentActivityPanel
                        className="order-4 lg:order-2"
                        compact
                        agent={selectedAgent}
                        conversations={selectedAgentRecentConversations}
                        selectedConversationId={selectedConversationId}
                        onSelectConversation={(conversationId) => {
                          setSelectedAgentId(selectedAgent.id);
                          setSelectedConversationId(conversationId);
                        }}
                      />
                      <div ref={threadScrollRef} onScroll={handleThreadScroll} className="order-2 flex-1 overflow-y-auto rounded-[28px] border border-border bg-background/28 p-4 sm:p-5 lg:order-3">
                        {messagesState === "loading" && (
                          <EmptyStateCard
                            compact
                            icon={<Loader2 className="h-8 w-8 animate-spin" />}
                            title="Loading transcript"
                            description="Pulling the latest persisted messages and execution results for this conversation."
                          />
                        )}
                        {messagesState === "error" && (
                          <EmptyStateCard
                            compact
                            icon={<AlertTriangle className="h-8 w-8 text-warning" />}
                            title="Transcript unavailable"
                            description="Mission Control could not load this conversation history right now. Retry the transcript fetch or refresh bootstrap data."
                            action={<Button variant="outline" onClick={() => void loadConversationMessages(selectedConversation.id)}>Retry transcript</Button>}
                          />
                        )}
                        {messagesState === "idle" && messages.length === 0 && (
                          <>
                            <EmptyStateCard
                              compact
                              icon={<MessageSquare className="h-8 w-8" />}
                              title="No messages yet"
                              description="Send the first prompt to create the persisted transcript, usage trail, and execution history for this conversation."
                              action={<Button variant="outline" onClick={() => composerRef.current?.focus()}>Send first message</Button>}
                            />
                            {starterPrompts.length > 0 && (
                              <div className="mt-4 grid gap-2 lg:grid-cols-3">
                                {starterPrompts.map((prompt) => (
                                  <button
                                    key={prompt}
                                    type="button"
                                    onClick={() => handleApplyStarterPrompt(prompt)}
                                    className="rounded-2xl border border-border/70 bg-background/55 px-3 py-3 text-left text-xs leading-5 text-foreground transition-colors hover:border-foreground/20 hover:bg-background/68"
                                  >
                                    {prompt}
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                        {messagesState === "idle" && messages.length > 0 && (
                          <div className="space-y-4">
                            {messages.map((message) => {
                              if (message.role === "user") {
                                return (
                                  <UserMessage
                                    key={message.id}
                                    message={message}
                                    canEdit={message.id === latestUserId}
                                    onEdit={() => handleEditLatestUser(message)}
                                  />
                                );
                              }
                              if (message.role === "assistant") {
                                return (
                                  <AssistantMessage
                                    key={message.id}
                                    message={message}
                                    isLatestAssistant={message.id === latestAssistantId}
                                    onRegenerate={handleRegenerateLatest}
                                    onRetry={handleRetryLastMessage}
                                  />
                                );
                              }
                              return (
                                <div key={message.id} className="flex justify-start">
                                  <div className="max-w-[88%] rounded-[24px] border border-border bg-background/45 px-4 py-3">
                                    <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                                      <TerminalSquare className="h-3.5 w-3.5" />
                                      {message.tool_name ? `${titleCase(message.role)} · ${message.tool_name}` : titleCase(message.role)}
                                    </div>
                                    <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">{message.content || "(empty message)"}</div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className="order-3 rounded-[28px] border border-border bg-card/70 p-4 sm:p-5 lg:order-4">
                        {chatError && (
                          <InlineNotice
                            tone="error"
                            title="Message failed to send"
                            detail={`${chatError} The interrupted assistant bubble can be tapped to retry.`}
                            action={<Button variant="outline" size="sm" onClick={handleRetryLastMessage} disabled={sendingMessage}>Retry stream</Button>}
                          />
                        )}
                        <div className="flex flex-col gap-3">
                          <textarea
                            ref={composerRef}
                            value={composerText}
                            onChange={(event) => handleComposerChange(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                void handleSendMessage();
                              }
                            }}
                            placeholder={selectedConversation ? "Message the selected agent…" : selectedAgent ? "Create a conversation to begin chatting…" : "Create or select an agent to begin…"}
                            disabled={sendingMessage || !selectedConversation}
                            className="min-h-[92px] w-full rounded-[22px] border border-border bg-background/55 px-4 py-3 text-sm leading-6 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30 disabled:cursor-not-allowed disabled:opacity-60"
                          />
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="max-w-2xl text-xs leading-5 text-muted-foreground">
                              {composerHint}
                            </div>
                            <Button className="self-end border border-[color-mix(in_srgb,var(--warm-glow)_45%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_12%,transparent)] text-[var(--warm-glow)] hover:bg-[color-mix(in_srgb,var(--warm-glow)_18%,transparent)] sm:self-auto" onClick={() => void handleSendMessage()} disabled={sendingMessage || !selectedConversation || !composerText.trim()}>
                              {sendingMessage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                              {sendingMessage ? "Sending..." : "Send"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-1 flex-col gap-4">
                      <EmptyStateCard
                        compact
                        icon={<MessageSquare className="h-10 w-10" />}
                        title={conversationsForSelectedAgent.length === 0 ? "No conversation yet" : "No conversation selected"}
                        description={conversationsForSelectedAgent.length === 0
                          ? `Create the first conversation for ${selectedAgent.name} to start a persisted chat history.`
                          : "Choose an existing conversation from the left sidebar or create a new one for the selected agent."}
                        action={(
                          <Button onClick={() => void handleCreateConversation()} disabled={!selectedAgent || creatingConversation}>
                            {creatingConversation ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            {conversationsForSelectedAgent.length === 0 ? "Create first conversation" : "Create conversation"}
                          </Button>
                        )}
                      />
                      {conversationsForSelectedAgent.length === 0 && selectedAgent && (
                        <>
                          <div className="rounded-[22px] border border-border bg-background/34 p-3 sm:hidden">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="font-expanded text-xs uppercase tracking-[0.08em]">Ready to start with {selectedAgent.name}</div>
                                <div className="mt-1 text-[11px] leading-4 text-muted-foreground">Create the first thread, then send the opening prompt.</div>
                              </div>
                              <StatusDot state={selectedAgent.alert_summary.state} label={titleCase(selectedAgent.alert_summary.state)} className="mt-0.5" />
                            </div>
                          </div>
                          <div className="hidden gap-4 lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                            <div className="rounded-[24px] border border-border bg-background/34 p-4">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                  <div className="font-expanded text-sm uppercase tracking-[0.08em]">Ready to start with {selectedAgent.name}</div>
                                  <div className="mt-1 text-xs text-muted-foreground">The first conversation becomes the operating thread for this agent.</div>
                                </div>
                                <StatusDot state={selectedAgent.alert_summary.state} label={titleCase(selectedAgent.alert_summary.state)} className="mt-1" />
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <Metric label="Function" value={selectedAgent.business_function} />
                                <Metric label="Entity" value={selectedAgent.operating_entity} />
                                <Metric label="Model" value={selectedAgent.preferred_model || "Unassigned"} />
                                <Metric label="Toolsets" value={`${selectedAgent.tool_permissions.enabled.length} enabled`} />
                              </div>
                              <div className="mt-3 rounded-2xl border border-border/70 bg-background/55 px-3 py-3 text-xs leading-6 text-muted-foreground">
                                Next: create the conversation, review the default title, then send the first prompt to begin transcript, usage, and cost tracking.
                              </div>
                            </div>
                            <div className="rounded-[24px] border border-border bg-background/34 p-4">
                              <div className="mb-3 font-expanded text-sm uppercase tracking-[0.08em]">Starter prompts</div>
                              <div className="space-y-2">
                                {starterPrompts.map((prompt) => (
                                  <button
                                    key={prompt}
                                    type="button"
                                    onClick={() => handleApplyStarterPrompt(prompt)}
                                    className="w-full rounded-2xl border border-border/70 bg-background/55 px-3 py-3 text-left text-sm leading-6 text-foreground transition-colors hover:border-foreground/20 hover:bg-background/68"
                                  >
                                    {prompt}
                                  </button>
                                ))}
                              </div>
                              <div className="mt-3 text-xs text-muted-foreground">
                                Choose one now and it will be ready in the composer as soon as the first conversation is created.
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                      {conversationsForSelectedAgent.length > 0 && selectedAgent && (
                        <>
                          <RecentActivityPanel
                            compact
                            className="sm:hidden"
                            agent={selectedAgent}
                            conversations={selectedAgentRecentConversations}
                            selectedConversationId={selectedConversationId}
                            onSelectConversation={(conversationId) => {
                              setSelectedAgentId(selectedAgent.id);
                              setSelectedConversationId(conversationId);
                            }}
                          />
                          <RecentActivityPanel
                            className="hidden sm:block"
                            agent={selectedAgent}
                            conversations={selectedAgentRecentConversations}
                            selectedConversationId={selectedConversationId}
                            onSelectConversation={(conversationId) => {
                              setSelectedAgentId(selectedAgent.id);
                              setSelectedConversationId(conversationId);
                            }}
                          />
                        </>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {showSettings && (
                <>
                  <div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" onClick={() => setShowSettings(false)} />
                  <div className="fixed inset-y-0 right-0 z-50 w-full sm:max-w-[620px]">
                    <Card className="flex h-full flex-col overflow-hidden rounded-none border-y-0 border-r-0 sm:rounded-l-[32px] sm:border">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>Settings</CardTitle>
                      <CardDescription>Manage each Agent as a durable business operator with identity, routing, memory, permissions, reliability, and lifecycle controls.</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedAgent && <StatusDot state={selectedAgent.observability.status === "active" ? "healthy" : "warning"} label={selectedAgent.observability.status === "active" ? "Active" : titleCase(selectedAgent.observability.status)} />}
              <Button variant="outline" size="icon" aria-label="Close settings" onClick={() => setShowSettings(false)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="h-[calc(100%-104px)] space-y-3 overflow-y-auto px-4 pb-5 pt-3 sm:space-y-4 sm:px-5">
                  {selectedAgent ? (
                    <>
                      <section className="rounded-[24px] border border-border bg-background/34 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 font-expanded text-sm uppercase tracking-[0.1em]"><Sparkles className="h-4 w-4" />Themes</div>
                            <div className="mt-1 text-xs text-muted-foreground">Restore the richer Mission Control backgrounds without sacrificing transcript readability.</div>
                          </div>
                          <div className="rounded-full border border-border/70 bg-background/55 px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            {activeThemeDefinition.label}
                          </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {themeOptions.map((theme) => {
                            const definition = getThemeDefinition(theme.name);
                            const art = definition.backgroundArt;
                            const active = definition.name === activeTheme;
                            return (
                              <button
                                key={theme.name}
                                type="button"
                                onClick={() => setActiveTheme(definition.name)}
                                className={cn(
                                  "rounded-[20px] border px-3 py-3 text-left transition-colors",
                                  active ? "border-foreground/35 bg-foreground/10 shadow-[0_18px_45px_rgba(0,0,0,0.18)]" : "border-border/70 bg-background/55 hover:border-foreground/20 hover:bg-background/68",
                                )}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-sm text-foreground">{definition.label}</div>
                                    <div className="mt-1 text-xs leading-5 text-muted-foreground">{definition.description}</div>
                                  </div>
                                  <span
                                    className="theme-swatch shrink-0 rounded-full"
                                    style={{
                                      backgroundColor: definition.palette.background.hex,
                                      backgroundImage: art?.image ? `linear-gradient(135deg, ${definition.palette.background.hex} 0%, color-mix(in srgb, ${definition.palette.background.hex} 70%, black) 100%), url('${art.image}')` : undefined,
                                      backgroundPosition: art?.image ? `center center, ${art.position ?? "center center"}` : undefined,
                                      backgroundSize: art?.image ? `cover, ${art.size ?? "cover"}` : undefined,
                                      backgroundBlendMode: "screen, normal",
                                      filter: art?.filter,
                                      opacity: art?.opacity ?? 0.2,
                                    }}
                                  />
                                </div>
                                {active && <div className="mt-3 text-[10px] uppercase tracking-[0.14em] text-foreground">Active theme</div>}
                              </button>
                            );
                          })}
                        </div>
                      </section>
                      <section className="rounded-[24px] border border-border bg-background/28 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="font-expanded text-sm uppercase tracking-[0.1em]">Agent architecture</div>
                            <div className="mt-1 text-xs leading-5 text-muted-foreground">Position each Agent as a durable operator inside the holdings-company system with a clear entity, function, permissions, and long-term memory.</div>
                          </div>
                          <HealthInline tone={selectedAgent.observability.status === "active" ? "healthy" : selectedAgent.observability.status === "paused" ? "warning" : "unknown"} label={titleCase(selectedAgent.observability.status)} />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <WorkspaceMetaPill label="Parent org" value="Umbrella Holdings Group, LLC" className="max-w-full sm:max-w-[260px]" />
                          <WorkspaceMetaPill label="Entity" value={selectedAgent.operating_entity || "Unassigned"} className="max-w-full sm:max-w-[240px]" />
                          <WorkspaceMetaPill label="Function" value={selectedAgent.business_function || "Unassigned"} />
                          <WorkspaceMetaPill label="Persistent memory" value={memoryStatusLabel} />
                          <WorkspaceMetaPill label="Model route" value={routingSummary} className="max-w-full sm:max-w-[280px]" />
                          <WorkspaceMetaPill label="Permissions" value={`${editorDraft.tool_permissions.enabled.length} toolsets`} />
                        </div>
                      </section>
                      <SettingsGroupLabel eyebrow="Operator architecture" detail="Define the business role, model routing, and memory continuity that let this Agent act as a real operator over time." />
                      <section className="rounded-[24px] border border-border bg-background/34 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <div className="font-expanded text-sm uppercase tracking-[0.1em]">Agent identity</div>
                            <div className="mt-1 text-xs text-muted-foreground">Define the operator name, business role, parent entity placement, and mission context.</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => setEditorDraft(toAgentDraft(selectedAgent))} disabled={!hasDraftChanges || savingAgent}>
                              <Pencil className="h-3.5 w-3.5" />
                              Reset
                            </Button>
                            <Button size="sm" onClick={() => void handleSaveAgent()} disabled={!hasDraftChanges || savingAgent}>
                              {savingAgent ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                              Save
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-3 text-sm">
                          <div>
                            <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Agent name</div>
                            <Input value={editorDraft.name} disabled={savingAgent} onChange={(event) => setEditorDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Agent name" />
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Business function</div>
                              <Input value={editorDraft.business_function} disabled={savingAgent} onChange={(event) => setEditorDraft((current) => ({ ...current, business_function: event.target.value }))} placeholder="Business function" />
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Operating entity</div>
                              <Input value={editorDraft.operating_entity} disabled={savingAgent} onChange={(event) => setEditorDraft((current) => ({ ...current, operating_entity: event.target.value }))} placeholder="Operating entity" />
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Role</div>
                            <textarea
                              value={editorDraft.role}
                              disabled={savingAgent}
                              onChange={(event) => setEditorDraft((current) => ({ ...current, role: event.target.value }))}
                              className="min-h-[96px] w-full rounded-2xl border border-border bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30 disabled:cursor-not-allowed disabled:opacity-60"
                            />
                          </div>
                          <div>
                            <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">System prompt</div>
                            <textarea
                              value={editorDraft.system_prompt}
                              disabled={savingAgent}
                              onChange={(event) => setEditorDraft((current) => ({ ...current, system_prompt: event.target.value }))}
                              className="min-h-[136px] w-full rounded-2xl border border-border bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30 disabled:cursor-not-allowed disabled:opacity-60"
                            />
                          </div>
                          <label className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/55 px-3 py-3 text-sm text-foreground">
                            <span className="flex items-center gap-2">
                              <Pin className="h-4 w-4 text-warning" />
                              Pin agent in navigation
                            </span>
                            <input
                              type="checkbox"
                              disabled={savingAgent}
                              checked={editorDraft.pinned}
                              onChange={(event) => setEditorDraft((current) => ({ ...current, pinned: event.target.checked }))}
                              className="h-4 w-4 rounded border-border bg-background"
                            />
                          </label>
                        </div>
                      </section>

                      <section className="rounded-[24px] border border-border bg-background/34 p-4">
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 font-expanded text-sm uppercase tracking-[0.1em]"><Bot className="h-4 w-4" />Model routing</div>
                            <div className="mt-1 text-xs text-muted-foreground">Assign the primary and fallback models that power this Agent in production workflows.</div>
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="space-y-1 text-sm">
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Preferred model</div>
                            <select
                              value={editorDraft.preferred_model}
                              disabled={savingAgent}
                              onChange={(event) => setEditorDraft((current) => ({ ...current, preferred_model: event.target.value }))}
                              className="h-10 w-full rounded-2xl border border-border bg-background/50 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {bootstrap.catalog.models.map((model) => (
                                <option key={model} value={model}>{model}</option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-1 text-sm">
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Fallback model</div>
                            <select
                              value={editorDraft.fallback_model}
                              disabled={savingAgent}
                              onChange={(event) => setEditorDraft((current) => ({ ...current, fallback_model: event.target.value }))}
                              className="h-10 w-full rounded-2xl border border-border bg-background/50 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <option value="">No fallback</option>
                              {bootstrap.catalog.models.map((model) => (
                                <option key={model} value={model}>{model}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </section>

                      <section className="rounded-[24px] border border-border bg-background/34 p-4">
                        <div className="mb-3 flex items-center gap-2 font-expanded text-sm uppercase tracking-[0.1em]"><Coins className="h-4 w-4" />Token controls</div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="space-y-1 text-sm">
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Max input tokens</div>
                            <Input type="number" disabled={savingAgent} value={String(editorDraft.token_controls.max_input_tokens)} onChange={(event) => setEditorDraft((current) => ({ ...current, token_controls: { ...current.token_controls, max_input_tokens: numberOrZero(event.target.value) } }))} />
                          </label>
                          <label className="space-y-1 text-sm">
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Max output tokens</div>
                            <Input type="number" disabled={savingAgent} value={String(editorDraft.token_controls.max_output_tokens)} onChange={(event) => setEditorDraft((current) => ({ ...current, token_controls: { ...current.token_controls, max_output_tokens: numberOrZero(event.target.value) } }))} />
                          </label>
                          <label className="space-y-1 text-sm">
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Max total tokens</div>
                            <Input type="number" disabled={savingAgent} value={String(editorDraft.token_controls.max_total_tokens)} onChange={(event) => setEditorDraft((current) => ({ ...current, token_controls: { ...current.token_controls, max_total_tokens: numberOrZero(event.target.value) } }))} />
                          </label>
                          <label className="space-y-1 text-sm">
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Context message limit</div>
                            <Input type="number" disabled={savingAgent} value={String(editorDraft.token_controls.max_context_messages)} onChange={(event) => setEditorDraft((current) => ({ ...current, token_controls: { ...current.token_controls, max_context_messages: numberOrZero(event.target.value) } }))} />
                          </label>
                        </div>
                      </section>

                      <section className="rounded-[24px] border border-border bg-background/34 p-4">
                        <div className="mb-3 flex items-center gap-2 font-expanded text-sm uppercase tracking-[0.1em]"><Coins className="h-4 w-4" />Budget controls</div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="space-y-1 text-sm">
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Daily budget (USD)</div>
                            <Input type="number" step="0.01" disabled={savingAgent} value={String(editorDraft.budget_controls.daily_usd)} onChange={(event) => setEditorDraft((current) => ({ ...current, budget_controls: { ...current.budget_controls, daily_usd: numberOrZero(event.target.value) } }))} />
                          </label>
                          <label className="space-y-1 text-sm">
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Monthly budget (USD)</div>
                            <Input type="number" step="0.01" disabled={savingAgent} value={String(editorDraft.budget_controls.monthly_usd)} onChange={(event) => setEditorDraft((current) => ({ ...current, budget_controls: { ...current.budget_controls, monthly_usd: numberOrZero(event.target.value) } }))} />
                          </label>
                          <label className="space-y-1 text-sm">
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Alert threshold (%)</div>
                            <Input type="number" step="1" disabled={savingAgent} value={String(editorDraft.budget_controls.alert_threshold_pct)} onChange={(event) => setEditorDraft((current) => ({ ...current, budget_controls: { ...current.budget_controls, alert_threshold_pct: numberOrZero(event.target.value) } }))} />
                          </label>
                          <label className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/55 px-3 py-3 text-sm text-foreground self-end">
                            <span>Hard stop when cap is reached</span>
                            <input
                              type="checkbox"
                              disabled={savingAgent}
                              checked={editorDraft.budget_controls.hard_stop}
                              onChange={(event) => setEditorDraft((current) => ({ ...current, budget_controls: { ...current.budget_controls, hard_stop: event.target.checked } }))}
                              className="h-4 w-4 rounded border-border bg-background"
                            />
                          </label>
                        </div>
                      </section>

                      <SettingsGroupLabel eyebrow="Execution continuity" detail="Keep every Agent durable by pairing the right permissions, persistent memory, and reliability controls with its business role." />
                      <section className="rounded-[24px] border border-border bg-background/34 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 font-expanded text-sm uppercase tracking-[0.1em]"><Shield className="h-4 w-4" />Tools / permissions</div>
                            <div className="mt-1 text-xs text-muted-foreground">Authorize the capabilities this Agent can use while operating across entities, functions, and workflows.</div>
                          </div>
                          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{editorDraft.tool_permissions.enabled.length} enabled</div>
                        </div>
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          {editorDraft.tool_permissions.enabled.length > 0 ? (
                            editorDraft.tool_permissions.enabled.map((toolset) => (
                              <span key={toolset} className="rounded-full border border-border/80 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-foreground">
                                {toolset}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">No toolsets enabled for this agent.</span>
                          )}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {bootstrap.catalog.toolsets.map((toolset) => {
                            const enabled = editorDraft.tool_permissions.enabled.includes(toolset.name);
                            return (
                              <button
                                key={toolset.name}
                                type="button"
                                disabled={savingAgent}
                                onClick={() => setEditorDraft((current) => ({
                                  ...current,
                                  tool_permissions: {
                                    enabled: enabled
                                      ? current.tool_permissions.enabled.filter((name) => name !== toolset.name)
                                      : [...current.tool_permissions.enabled, toolset.name].sort(),
                                  },
                                }))}
                                className={cn(
                                  "rounded-2xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                                  enabled ? "border-foreground/35 bg-foreground/10" : "border-border bg-background/45 hover:bg-background/60",
                                )}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-sm text-foreground">{toolset.name}</div>
                                    <div className="mt-1 overflow-hidden text-xs leading-5 text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">{toolset.description}</div>
                                  </div>
                                  <div className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{toolset.tool_count} tools</div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </section>

                      <section className="rounded-[24px] border border-border bg-background/34 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 font-expanded text-sm uppercase tracking-[0.1em]"><Building2 className="h-4 w-4" />Tools health</div>
                            <div className="mt-1 text-xs text-muted-foreground">Read the current reliability signals for tools, transcripts, and connected execution surfaces.</div>
                          </div>
                          <HealthInline tone={integrationHealthSummary.overall} label={titleCase(integrationHealthSummary.overall)} />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {integrationHealthSummary.items.length > 0 ? integrationHealthSummary.items.map((item) => (
                            <div key={item.label} className="rounded-2xl border border-border/70 bg-background/55 px-3 py-3">
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{item.label}</div>
                                <HealthInline tone={item.tone} label={titleCase(item.tone)} />
                              </div>
                              <div className="text-sm leading-5 text-foreground">{item.detail}</div>
                            </div>
                          )) : (
                            <div className="sm:col-span-2 rounded-2xl border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                              No activity signals are available for this agent yet. Run a conversation or save configuration changes to establish health context.
                            </div>
                          )}
                        </div>
                        <div className="mt-3 space-y-2">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Enabled toolsets in scope</div>
                          {enabledToolsetDetails.length > 0 ? (
                            enabledToolsetDetails.map((toolset) => (
                              <div key={toolset.name} className="flex items-start justify-between gap-3 rounded-2xl border border-border/70 bg-background/55 px-3 py-3">
                                <div className="min-w-0">
                                  <div className="text-sm text-foreground">{toolset.name}</div>
                                  <div className="mt-1 text-xs leading-5 text-muted-foreground">{toolset.description}</div>
                                </div>
                                <div className="rounded-full border border-border/70 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                                  {toolset.tool_count} tools
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-2xl border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                              No enabled toolsets are currently configured for this agent.
                            </div>
                          )}
                        </div>
                      </section>

                      <section className="rounded-[24px] border border-border bg-background/34 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 font-expanded text-sm uppercase tracking-[0.1em]"><BrainCircuit className="h-4 w-4" />Persistent memory / context</div>
                            <div className="mt-1 text-xs text-muted-foreground">Keep long-term operating continuity attached to this Agent so each run inherits durable business knowledge, entity context, and operator judgment beyond the current conversation.</div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={savingAgent}
                            onClick={() => setEditorDraft((current) => ({
                              ...current,
                              memory: {
                                ...current.memory,
                                records: [
                                  ...current.memory.records,
                                  {
                                    id: `mem_draft_${current.memory.records.length + 1}`,
                                    title: "New operating record",
                                    category: "general",
                                    content: "",
                                    active: true,
                                    updated_at: new Date().toISOString(),
                                  },
                                ],
                              },
                            }))}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add operating record
                          </Button>
                        </div>
                        <div className="space-y-3">
                          <div className="memory-centrality-card rounded-[22px] p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="font-expanded text-sm uppercase tracking-[0.1em]">Operating continuity ledger</div>
                                <div className="mt-1 text-xs leading-5 text-muted-foreground">Persistent memory carries the durable operating record for this Agent across localhost sessions, manual oversight, and Tailscale-accessed work without relying on any single chat window.</div>
                              </div>
                              <HealthInline tone={editorDraft.memory.enabled ? "healthy" : "warning"} label={editorDraft.memory.enabled ? "Memory active" : "Memory paused"} />
                            </div>
                            <div className="memory-centrality-grid mt-3 grid gap-2 md:grid-cols-3">
                              <Metric label="Agent identity" value={editorDraft.name || selectedAgent.name || "Unassigned"} />
                              <Metric label="Operating entity" value={editorDraft.operating_entity || "Unassigned"} />
                              <Metric label="Business function" value={editorDraft.business_function || "Unassigned"} />
                              <Metric label="Model routing" value={routingSummary} />
                              <Metric label="Tools / permissions" value={`${editorDraft.tool_permissions.enabled.length} toolsets enabled`} />
                              <Metric label="Memory records in scope" value={`${activeMemoryRecords.length} active of ${editorDraft.memory.records.length}`} />
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <WorkspaceMetaPill label="Persistent memory" value={editorDraft.memory.enabled ? "Enabled" : "Paused"} />
                              <WorkspaceMetaPill label="Injected into each run" value={String(editorDraft.memory.injection_limit)} />
                              <WorkspaceMetaPill label="Execution posture" value={editorDraft.observability.store_transcripts ? "Transcripts retained" : "Live-only context"} />
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <WorkspaceMetaPill label="Memory" value={editorDraft.memory.enabled ? "Active" : "Disabled"} />
                            <WorkspaceMetaPill label="Active records" value={String(activeMemoryRecords.length)} />
                            <WorkspaceMetaPill label="Injected per run" value={String(editorDraft.memory.injection_limit)} />
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/55 px-3 py-3 text-sm text-foreground">
                              <span>Persistent memory active</span>
                              <input
                                type="checkbox"
                                disabled={savingAgent}
                                checked={editorDraft.memory.enabled}
                                onChange={(event) => setEditorDraft((current) => ({ ...current, memory: { ...current.memory, enabled: event.target.checked } }))}
                                className="h-4 w-4 rounded border-border bg-background"
                              />
                            </label>
                            <label className="space-y-1 text-sm">
                              <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Records injected per run</div>
                              <Input type="number" disabled={savingAgent} value={String(editorDraft.memory.injection_limit)} onChange={(event) => setEditorDraft((current) => ({ ...current, memory: { ...current.memory, injection_limit: numberOrZero(event.target.value) } }))} />
                            </label>
                          </div>
                          <div className="space-y-3">
                            {editorDraft.memory.records.map((record, index) => (
                              <div key={record.id} className="rounded-2xl border border-border/70 bg-background/55 p-3">
                                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                                  <div>
                                    <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Operating record {index + 1}</div>
                                    <div className="mt-1 flex flex-wrap gap-2">
                                      <WorkspaceMetaPill label="Category" value={record.category || "general"} />
                                      <WorkspaceMetaPill label="Last updated" value={record.updated_at ? formatRelativeTime(record.updated_at) : "Not saved yet"} />
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                                      <input
                                        type="checkbox"
                                        disabled={savingAgent}
                                        checked={record.active}
                                        onChange={(event) => setEditorDraft((current) => ({
                                          ...current,
                                          memory: {
                                            ...current.memory,
                                            records: current.memory.records.map((item) => item.id === record.id ? { ...item, active: event.target.checked } : item),
                                          },
                                        }))}
                                        className="h-4 w-4 rounded border-border bg-background"
                                      />
                                      Active
                                    </label>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled={savingAgent}
                                      onClick={() => setEditorDraft((current) => ({
                                        ...current,
                                        memory: {
                                          ...current.memory,
                                          records: current.memory.records.filter((item) => item.id !== record.id),
                                        },
                                      }))}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      Remove
                                    </Button>
                                  </div>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <label className="space-y-1 text-sm">
                                    <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Record title</div>
                                    <Input value={record.title} disabled={savingAgent} onChange={(event) => setEditorDraft((current) => ({
                                      ...current,
                                      memory: {
                                        ...current.memory,
                                        records: current.memory.records.map((item) => item.id === record.id ? { ...item, title: event.target.value, updated_at: new Date().toISOString() } : item),
                                      },
                                    }))} />
                                  </label>
                                  <label className="space-y-1 text-sm">
                                    <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Record category</div>
                                    <Input value={record.category} disabled={savingAgent} onChange={(event) => setEditorDraft((current) => ({
                                      ...current,
                                      memory: {
                                        ...current.memory,
                                        records: current.memory.records.map((item) => item.id === record.id ? { ...item, category: event.target.value, updated_at: new Date().toISOString() } : item),
                                      },
                                    }))} />
                                  </label>
                                </div>
                                <label className="mt-3 block space-y-1 text-sm">
                                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Durable context</div>
                                  <textarea
                                    value={record.content}
                                    disabled={savingAgent}
                                    onChange={(event) => setEditorDraft((current) => ({
                                      ...current,
                                      memory: {
                                        ...current.memory,
                                        records: current.memory.records.map((item) => item.id === record.id ? { ...item, content: event.target.value, updated_at: new Date().toISOString() } : item),
                                      },
                                    }))}
                                    className="min-h-[88px] w-full rounded-2xl border border-border bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30 disabled:cursor-not-allowed disabled:opacity-60"
                                  />
                                </label>
                              </div>
                            ))}
                            {editorDraft.memory.records.length === 0 && (
                              <div className="rounded-2xl border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">No persistent operating records configured yet. Add durable entity context, operator rules, or business memory so this Agent carries continuity into future runs.</div>
                            )}
                          </div>
                        </div>
                      </section>

                      <section className="rounded-[24px] border border-border bg-background/34 p-4">
                        <div className="mb-3 flex items-start gap-2">
                          <Building2 className="mt-0.5 h-4 w-4" />
                          <div>
                            <div className="font-expanded text-sm uppercase tracking-[0.1em]">Status / reliability</div>
                            <div className="mt-1 text-xs text-muted-foreground">Track operating readiness, transcript retention, and the latest reliability signals for this Agent.</div>
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="space-y-1 text-sm">
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Status</div>
                            <select
                              value={editorDraft.observability.status}
                              disabled={savingAgent}
                              onChange={(event) => setEditorDraft((current) => ({ ...current, observability: { ...current.observability, status: event.target.value } }))}
                              className="h-10 w-full rounded-2xl border border-border bg-background/50 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {bootstrap.catalog.status_options.map((status) => (
                                <option key={status} value={status}>{titleCase(status)}</option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-1 text-sm">
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Logging level</div>
                            <select
                              value={editorDraft.observability.logging_level}
                              disabled={savingAgent}
                              onChange={(event) => setEditorDraft((current) => ({ ...current, observability: { ...current.observability, logging_level: event.target.value } }))}
                              className="h-10 w-full rounded-2xl border border-border bg-background/50 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {loggingLevelOptions.map((level) => (
                                <option key={level} value={level}>{titleCase(level)}</option>
                              ))}
                            </select>
                          </label>
                          <label className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/55 px-3 py-3 text-sm text-foreground">
                            <span>Store transcripts</span>
                            <input
                              type="checkbox"
                              disabled={savingAgent}
                              checked={editorDraft.observability.store_transcripts}
                              onChange={(event) => setEditorDraft((current) => ({ ...current, observability: { ...current.observability, store_transcripts: event.target.checked } }))}
                              className="h-4 w-4 rounded border-border bg-background"
                            />
                          </label>
                          <Metric label="Last active" value={selectedAgent.last_active_at ? formatRelativeTime(selectedAgent.last_active_at) : "No recent activity"} />
                          <Metric label="Last error" value={editorDraft.observability.last_error || "None recorded"} />
                          <Metric label="Current spend" value={hasAgentUsage ? formatCurrency(selectedAgent.usage_summary.monthly_spend ?? 0) : "Awaiting usage"} />
                        </div>
                        {selectedAgent.alert_summary.reasons.length > 0 && (
                          <div className="mt-4 rounded-[20px] border border-[color-mix(in_srgb,var(--warm-glow)_30%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_8%,transparent)] px-3 py-3 text-xs text-foreground/82">
                            <div className="mb-2 font-expanded uppercase tracking-[0.12em]">Active alerts</div>
                            <ul className="list-disc space-y-1 pl-5">
                              {selectedAgent.alert_summary.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                            </ul>
                          </div>
                        )}
                      </section>

                      <SettingsGroupLabel eyebrow="Infrastructure clarity" detail="Keep provider transparency, tool health, and lifecycle controls easy to audit without making the settings sheet feel fragmented." />
                      {selectedProviderCapabilities && <ProviderCapabilityPanel capabilities={selectedProviderCapabilities} />}
                      {selectedConversationDiagnostics && <UsageDiagnosticNote diagnostics={selectedConversationDiagnostics} compact />}
                      <section className="rounded-[24px] border border-border bg-background/34 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <div className="font-expanded text-sm uppercase tracking-[0.1em]">Lifecycle</div>
                            <div className="mt-1 text-xs text-muted-foreground">Delete the selected agent and its Mission Control conversations.</div>
                          </div>
                          <Button variant="outline" size="sm" onClick={() => void handleDeleteAgent()} disabled={deletingAgent || savingAgent}>
                            {deletingAgent ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            Delete
                          </Button>
                        </div>
                        <div className="rounded-2xl border border-[color-mix(in_srgb,var(--warm-glow)_24%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_6%,transparent)] px-3 py-3 text-xs leading-5 text-foreground/84">
                          Deletion removes the agent from Mission Control state and deletes any conversations currently attached to that agent in Mission Control storage.
                        </div>
                      </section>
                    </>
                  ) : (
                    <EmptyStateCard
                      icon={<Shield className="h-10 w-10" />}
                      title="Configuration panel idle"
                      description="Select an Agent to review operator identity, model routing, persistent memory, permissions, and reliability settings."
                      action={(
                        <Button variant="outline" onClick={() => setShowCreateForm(true)}>
                          <FolderPlus className="h-4 w-4" />
                          Create agent
                        </Button>
                      )}
                    />
                  )}
                </CardContent>
                    </Card>
                  </div>
                </>
              )}
            </div>
            )}
          </>
        )}
      </div>
      <InstallModal open={showInstallModal} onClose={() => setShowInstallModal(false)} />
    </div>
  );
}

function MobileAgentDrawer({
  open,
  onClose,
  groupedAgents,
  conversationsByAgent,
  selectedAgentId,
  selectedConversationId,
  creatingConversation,
  onSelectAgent,
  onSelectConversation,
  onCreateAgent,
  onCreateConversation,
}: {
  open: boolean;
  onClose: () => void;
  groupedAgents: Array<[string, AgentRecord[]]>;
  conversationsByAgent: Map<string, ConversationRecord[]>;
  selectedAgentId: string | null;
  selectedConversationId: string | null;
  creatingConversation: boolean;
  onSelectAgent: (agentId: string) => void;
  onSelectConversation: (agentId: string, conversationId: string) => void;
  onCreateAgent: () => void;
  onCreateConversation: (agent: AgentRecord) => void;
}) {
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm lg:hidden" onClick={onClose} />
      <div className="fixed inset-y-0 left-0 z-50 w-[82vw] max-w-[340px] lg:hidden" role="dialog" aria-modal="true" aria-label="Agents drawer">
        <Card className="flex h-full flex-col overflow-hidden rounded-none border-y-0 border-l-0 sm:rounded-r-[32px] sm:border">
          <CardHeader className="gap-2 px-4 py-3 sm:pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Agents</CardTitle>
                <CardDescription className="text-[11px] leading-4 sm:text-xs sm:leading-5">Switch agents and conversations without crowding the workspace.</CardDescription>
              </div>
              <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Close agents navigation" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-2 flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={onCreateAgent}>
                <FolderPlus className="h-3.5 w-3.5" />
                Create
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto space-y-3 px-4 py-3">
            {groupedAgents.map(([group, agents]) => (
              <div key={group} className="space-y-2">
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{group}</div>
                {agents.map((agent) => {
                  const agentConversations = conversationsByAgent.get(agent.id) ?? [];
                  const isSelected = selectedAgentId === agent.id;
                  return (
                    <div key={agent.id} className={cn("rounded-[20px] border p-2.5", isSelected ? "border-foreground/35 bg-foreground/10" : "border-border bg-background/45")}>
                      <button type="button" onClick={() => onSelectAgent(agent.id)} className="w-full text-left">
                        <div className="flex items-center justify-between gap-2.5">
                          <div className="min-w-0">
                            <div className="truncate font-expanded text-[13px] uppercase tracking-[0.07em]">{agent.name}</div>
                            <div className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">{agent.business_function}</div>
                          </div>
                          <StatusDot state={agent.alert_summary.state} label={titleCase(agent.alert_summary.state)} className="mt-0.5" />
                        </div>
                      </button>
                      <div className="mt-2.5 flex items-center gap-2">
                        <Button variant="outline" size="sm" className="h-8 flex-1" onClick={() => onCreateConversation(agent)} disabled={creatingConversation}>
                          {creatingConversation ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                          Chat
                        </Button>
                      </div>
                      <div className="mt-2.5 space-y-1.5">
                        {agentConversations.slice(0, 2).map((conversation) => (
                          <button
                            key={conversation.id}
                            type="button"
                            onClick={() => onSelectConversation(agent.id, conversation.id)}
                            className={cn(
                              "w-full rounded-2xl border px-2.5 py-2 text-left text-[11px] leading-4",
                              selectedConversationId === conversation.id ? "border-foreground/35 bg-foreground/10" : "border-border/60 bg-background/55",
                            )}
                          >
                            <div className="truncate text-foreground">{conversation.title}</div>
                            <div className="mt-1 text-muted-foreground">{formatRelativeTime(conversation.last_message_at ?? conversation.updated_at)}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function ConversationActionsMenu({
  pinned,
  busy,
  onRename,
  onPinToggle,
  onDelete,
}: {
  pinned: boolean;
  busy: boolean;
  onRename: () => void;
  onPinToggle: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Conversation actions"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 bg-background/60 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ellipsis className="h-3.5 w-3.5" />}
      </button>
      {open && !busy && (
        <div className="absolute right-0 top-8 z-20 min-w-[150px] rounded-2xl border border-border bg-card/96 p-1 shadow-[0_18px_45px_rgba(0,0,0,0.28)] backdrop-blur-sm">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-foreground hover:bg-background/60"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              onRename();
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-foreground hover:bg-background/60"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              onPinToggle();
            }}
          >
            {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            {pinned ? "Unpin" : "Pin"}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-[rgb(255,180,184)] hover:bg-[rgba(251,44,54,0.08)]"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function WorkspaceMetaPill({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-border/70 bg-background/45 px-3 py-1.5 text-[11px] leading-none text-muted-foreground", className)}>
      <span className="shrink-0 uppercase tracking-[0.14em]">{label}</span>
      <span className="min-w-0 text-foreground [overflow-wrap:anywhere]">{value}</span>
    </div>
  );
}

function SettingsGroupLabel({
  eyebrow,
  detail,
}: {
  eyebrow: string;
  detail: string;
}) {
  return (
    <div className="px-1 pt-1">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</div>
      <div className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{detail}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/55 px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm leading-5 text-foreground [overflow-wrap:anywhere]">{value}</div>
    </div>
  );
}

function RecentActivityPanel({
  agent,
  conversations,
  selectedConversationId,
  onSelectConversation,
  className,
  compact = false,
}: {
  agent: AgentRecord;
  conversations: ConversationRecord[];
  selectedConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("rounded-[24px] border border-border bg-background/34 p-4", compact && "p-3 sm:p-4", className)}>
      <div className={cn("mb-3 flex flex-wrap items-start justify-between gap-3", compact && "mb-2 gap-2")}>
        <div className="min-w-0 flex-1">
          <div className="font-expanded text-sm uppercase tracking-[0.08em]">Recent activity</div>
          <div className={cn("mt-1 text-xs leading-5 text-muted-foreground", compact && "leading-4 sm:leading-5")}>
            {agent.last_active_at
              ? compact
                ? `Active ${formatRelativeTime(agent.last_active_at)}`
                : `${agent.name} was active ${formatRelativeTime(agent.last_active_at)}`
              : compact
                ? "No recent activity yet."
                : `No recent activity recorded for ${agent.name}.`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot state={activityStateForRun(agent.usage_summary.last_run_status)} label={titleCase(agent.usage_summary.last_run_status || "healthy")} />
          <span className="rounded-full border border-border/70 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {conversations.length} tracked
          </span>
        </div>
      </div>
      {agent.usage_diagnostics && !hasUsageData(agent.usage_summary) && !compact && (
        <UsageDiagnosticNote diagnostics={agent.usage_diagnostics} className="mb-3" compact />
      )}
      {conversations.length > 0 ? (
        <div className="space-y-2">
          {conversations.slice(0, compact ? 1 : 4).map((conversation) => {
            const hasConversationUsage = hasUsageData(conversation.usage_summary);
            return (
              <button
                key={conversation.id}
                type="button"
                onClick={() => onSelectConversation(conversation.id)}
                className={cn(
                  "w-full rounded-2xl border px-3 py-3 text-left transition-colors",
                  compact && "px-3 py-2.5",
                  selectedConversationId === conversation.id
                    ? "border-foreground/35 bg-foreground/10"
                    : "border-border/70 bg-background/55 hover:border-foreground/20 hover:bg-background/68",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-foreground">{conversation.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatRelativeTime(conversation.last_message_at ?? conversation.updated_at)}
                    </div>
                  </div>
                  <StatusDot state={activityStateForRun(conversation.last_run_status)} label={titleCase(conversation.last_run_status)} className="mt-1" />
                </div>
                <div className={cn("mt-3 grid gap-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground sm:grid-cols-2 xl:grid-cols-4", compact && "mt-2 grid-cols-2 text-[10px] tracking-[0.1em]")}>
                  <div className="rounded-xl border border-border/70 px-2.5 py-1.5">{formatNumber(conversation.usage_summary.message_count ?? 0)} messages</div>
                  {compact ? (
                    <div className="rounded-xl border border-border/70 px-2.5 py-1.5">{hasConversationUsage ? formatCurrency(conversation.usage_summary.estimated_cost) : usageAvailabilityLabel(conversation.usage_diagnostics)}</div>
                  ) : (
                    <>
                      <div className="rounded-xl border border-border/70 px-2.5 py-1.5">{formatNumber(conversation.usage_summary.tool_call_count ?? 0)} tools</div>
                      {hasConversationUsage ? (
                        <>
                          <div className="rounded-xl border border-border/70 px-2.5 py-1.5">{formatNumber(conversation.usage_summary.total_tokens)} tokens</div>
                          <div className="rounded-xl border border-border/70 px-2.5 py-1.5">{formatCurrency(conversation.usage_summary.estimated_cost)} spend</div>
                        </>
                      ) : (
                        <div className="rounded-xl border border-border/70 px-2.5 py-1.5 sm:col-span-2 xl:col-span-2">{usageAvailabilityLabel(conversation.usage_diagnostics)}</div>
                      )}
                    </>
                  )}
                </div>
                {!compact && !hasConversationUsage && conversation.usage_diagnostics && (
                  <UsageDiagnosticNote diagnostics={conversation.usage_diagnostics} className="mt-3" compact />
                )}
                {!compact && conversation.last_error && (
                  <div className="mt-3 rounded-[18px] border border-[rgba(251,44,54,0.35)] bg-[rgba(251,44,54,0.08)] px-3 py-2 text-xs leading-5 text-[rgb(255,180,184)]">
                    {conversation.last_error}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className={cn("rounded-2xl border border-dashed border-border px-3 py-3 text-xs text-muted-foreground", compact && "py-2.5")}>
          {compact ? "No recent conversations yet." : "No recent conversations are available for this agent yet."}
        </div>
      )}
    </div>
  );
}

function ProviderCapabilityPanel({ capabilities }: { capabilities: ProviderCapabilities }) {
  const connectionState = capabilities.connection_label === "Healthy"
    ? "healthy"
    : capabilities.connection_label === "Needs attention"
      ? "warning"
      : "critical";

  return (
    <div className="rounded-[24px] border border-border bg-background/34 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-expanded text-sm uppercase tracking-[0.08em]">Route / provider transparency</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{capabilities.detail}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border/70 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground [overflow-wrap:anywhere]">
            {capabilities.active_provider_label}
          </span>
          <StatusInline state={connectionState} label={capabilities.connection_label} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CapabilityMetric label="Usage telemetry" value={capabilities.usage_support} />
        <CapabilityMetric label="Cost telemetry" value={capabilities.cost_support} />
        <CapabilityMetric label="Cache telemetry" value={capabilities.cache_support} />
        <CapabilityMetric label="Remaining limits" value={capabilities.limit_support} />
      </div>
      <div className="mt-3 rounded-[20px] border border-border/70 bg-background/55 px-3 py-3 text-xs leading-5 text-muted-foreground">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="font-expanded uppercase tracking-[0.12em] text-foreground">Route transparency</div>
          <StatusInline state={capabilities.fallback_active ? "warning" : "healthy"} label={capabilities.fallback_active ? "Rerouted" : "Direct"} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="min-w-0 rounded-2xl border border-border/70 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-[0.14em]">Requested</div>
            <div className="mt-1 text-foreground [overflow-wrap:anywhere]">{capabilities.requested_model || "Unknown model"}</div>
            <div className="mt-1 [overflow-wrap:anywhere]">{capabilities.requested_route_label || capabilities.requested_provider_label || "Unknown route"}</div>
          </div>
          <div className="min-w-0 rounded-2xl border border-border/70 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-[0.14em]">Effective</div>
            <div className="mt-1 text-foreground [overflow-wrap:anywhere]">{capabilities.effective_model || "Unknown model"}</div>
            <div className="mt-1 [overflow-wrap:anywhere]">{capabilities.effective_route_label || capabilities.effective_provider_label || "Unknown route"}</div>
          </div>
        </div>
        {(capabilities.fallback_detail || capabilities.route_type_label) && (
          <div className="mt-2 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
            {capabilities.fallback_detail || capabilities.route_type_label}
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="rounded-full border border-border/70 px-2.5 py-1 uppercase tracking-[0.12em]">{capabilities.route_type_label}</span>
        {capabilities.docs_url && capabilities.docs_label && (
          <a href={capabilities.docs_url} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:opacity-85">
            {capabilities.docs_label}
          </a>
        )}
      </div>
      {capabilities.alternate_route_label && capabilities.alternate_route_detail && (
        <div className="mt-3 rounded-[20px] border border-[rgba(74,222,128,0.2)] bg-[rgba(74,222,128,0.05)] px-3 py-3 text-xs leading-5 text-[rgb(175,248,196)]">
          <div className="font-expanded uppercase tracking-[0.12em]">Potential telemetry upgrade</div>
          <div className="mt-1 [overflow-wrap:anywhere]">{capabilities.alternate_route_label}</div>
          <div className="mt-1">{capabilities.alternate_route_detail}</div>
        </div>
      )}
    </div>
  );
}

function CapabilityMetric({ label, value }: { label: string; value: ProviderCapabilities["usage_support"] }) {
  const tone = capabilityTone(value);
  const classes = tone === "success"
    ? "border-[rgba(74,222,128,0.28)] bg-[rgba(74,222,128,0.12)] text-[rgb(152,246,180)]"
    : tone === "warning"
      ? "border-[color-mix(in_srgb,var(--warm-glow)_30%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_12%,transparent)] text-[color-mix(in_srgb,var(--warm-glow)_80%,var(--foreground-base)_20%)]"
      : "border-border/70 bg-background/55 text-muted-foreground";
  return (
    <div className={cn("rounded-2xl border px-3 py-3", classes)}>
      <div className="text-[10px] uppercase tracking-[0.14em]">{label}</div>
      <div className="mt-1 font-expanded text-xs uppercase tracking-[0.08em]">{value}</div>
    </div>
  );
}

function UsageDiagnosticNote({
  diagnostics,
  className,
  compact = false,
}: {
  diagnostics: UsageDiagnostics;
  className?: string;
  compact?: boolean;
}) {
  const tone = usageDiagnosticsTone(diagnostics);
  const classes = tone === "error"
    ? "border-[rgba(251,44,54,0.35)] bg-[rgba(251,44,54,0.08)] text-[rgb(255,180,184)]"
    : tone === "success"
      ? "border-[rgba(74,222,128,0.28)] bg-[rgba(74,222,128,0.08)] text-[rgb(175,248,196)]"
      : tone === "warning"
        ? "border-[color-mix(in_srgb,var(--warm-glow)_30%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_8%,transparent)] text-foreground/82"
        : "border-border/70 bg-background/45 text-muted-foreground";
  return (
    <div className={cn("rounded-[20px] border px-3 py-3 text-xs leading-5", classes, className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot state={tone === "error" ? "critical" : tone === "warning" ? "warning" : tone === "success" ? "healthy" : "unknown"} label={diagnostics.status_label} />
          <span className="font-expanded uppercase tracking-[0.12em]">{diagnostics.status_label}</span>
        </div>
        <span className="rounded-full border border-current/25 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]">{diagnostics.route_label}</span>
      </div>
      {compact ? (
        <details className="mt-1 group">
          <summary className="cursor-pointer list-none text-[11px] uppercase tracking-[0.12em] opacity-90 marker:hidden">
            View detail
          </summary>
          <div className="mt-2 [overflow-wrap:anywhere]">{diagnostics.detail}</div>
          {(diagnostics.fix_url || diagnostics.command_hint) && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
              {diagnostics.fix_url && diagnostics.fix_label && (
                <a href={diagnostics.fix_url} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:opacity-85">
                  {diagnostics.fix_label}
                </a>
              )}
              {diagnostics.command_hint && <span>{diagnostics.command_hint}</span>}
            </div>
          )}
        </details>
      ) : (
        <>
          <div className="mt-1 [overflow-wrap:anywhere]">{diagnostics.detail}</div>
          {(diagnostics.fix_url || diagnostics.command_hint) && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
              {diagnostics.fix_url && diagnostics.fix_label && (
                <a href={diagnostics.fix_url} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:opacity-85">
                  {diagnostics.fix_label}
                </a>
              )}
              {diagnostics.command_hint && <span>{diagnostics.command_hint}</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EmptyStateCard({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn(
      "flex h-full min-h-[220px] flex-col items-center justify-center gap-3 rounded-[28px] border border-dashed border-border bg-background/24 p-6 text-center text-muted-foreground",
      compact && "min-h-[180px] p-5",
    )}>
      <div className="text-muted-foreground">{icon}</div>
      <div className="font-expanded text-lg uppercase tracking-[0.1em] text-foreground">{title}</div>
      <p className="max-w-md text-sm leading-6">{description}</p>
      {action}
    </div>
  );
}

function InlineNotice({
  tone,
  title,
  detail,
  action,
  icon,
}: {
  tone: NoticeTone;
  title: string;
  detail: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  const classes = tone === "error"
    ? "border-[rgba(251,44,54,0.35)] bg-[rgba(251,44,54,0.08)] text-[rgb(255,180,184)]"
    : tone === "success"
      ? "border-[rgba(74,222,128,0.28)] bg-[rgba(74,222,128,0.08)] text-[rgb(175,248,196)]"
      : tone === "warning"
        ? "border-[color-mix(in_srgb,var(--warm-glow)_30%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_8%,transparent)] text-foreground/82"
        : "border-border/70 bg-background/45 text-muted-foreground";

  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 rounded-[22px] border px-4 py-3 text-sm", classes)}>
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 shrink-0">{icon ?? (tone === "error" ? <AlertTriangle className="h-4 w-4" /> : tone === "success" ? <Check className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />)}</div>
        <div className="min-w-0">
          <div className="font-expanded text-xs uppercase tracking-[0.12em]">{title}</div>
          <div className="mt-1 leading-6">{detail}</div>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

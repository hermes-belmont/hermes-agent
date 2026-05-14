export interface TailscaleStatus {
  installed: boolean | null;
  signed_in: boolean;
  version: string | null;
  hostname: string | null;
  tailscale_ip: string | null;
  self_name?: string | null;
  exit_code: number | null;
  error_summary?: string;
}

export interface AccountRecord {
  display_name: string;
  avatar_color: string;
  avatar_image?: string | null;
  preferences: { timezone: string };
}

export interface UsageSummary {
  conversation_count?: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost: number;
  actual_cost: number;
  daily_spend?: number;
  monthly_spend?: number;
  estimated_monthly_spend?: number;
  last_run_status?: string;
  message_count?: number;
  tool_call_count?: number;
  model?: string;
}

export interface UsageDiagnostics {
  connection_state: "connected" | "issue" | "unknown";
  metrics_state: "measured" | "unavailable" | "partial";
  raw_usage_found: boolean;
  route_label: string;
  provider_label?: string;
  api_mode?: string;
  base_url?: string;
  status_label: string;
  detail: string;
  fix_label?: string;
  fix_url?: string;
  command_hint?: string;
}

export interface ProviderCapabilities {
  active_provider_label: string;
  route_type_label: string;
  connection_label: string;
  usage_support: "supported" | "unavailable" | "unknown";
  cost_support: "supported" | "unavailable" | "unknown";
  cache_support: "supported" | "unavailable" | "unknown";
  limit_support: "supported" | "unavailable" | "unknown";
  detail: string;
  docs_label?: string;
  docs_url?: string;
  alternate_route_label?: string;
  alternate_route_detail?: string;
  requested_model?: string;
  requested_provider_label?: string;
  requested_route_label?: string;
  effective_model?: string;
  effective_provider_label?: string;
  effective_route_label?: string;
  fallback_active?: boolean;
  fallback_detail?: string;
}

export interface AlertSummary {
  state: "healthy" | "warning" | "critical";
  reasons: string[];
}

export interface MemoryRecord {
  id: string;
  title: string;
  category: string;
  content: string;
  active: boolean;
  updated_at: string;
}

export type EntityType = "trust" | "llc" | "corp" | "personal" | "other";
export type MessagingPolicy = "open" | "restricted" | "isolated";

export interface EntityRecord {
  id: string;
  name: string;
  type: EntityType;
  parent_id: string | null;
  display_order: number;
  description: string;
  messaging_policy: MessagingPolicy;
  metadata: { ein: string | null; state: string | null; formation_date: string | null };
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  purge_at?: string | null;
  children?: EntityRecord[];
  agents?: AgentRecord[];
}

export interface AgentRecord {
  id: string;
  name: string;
  role: string;
  business_function: string;
  operating_entity: string;
  entity_id?: string;
  description?: string;
  display_order?: number;
  is_briefing_agent?: boolean;
  deleted_at?: string | null;
  purge_at?: string | null;
  deleted_by?: string | null;
  team_grouping: string;
  system_prompt: string;
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
  tool_permissions: { enabled: string[] };
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
  advanced: {
    reasoning_effort: string;
    temperature: number;
    notes: string;
    metadata: Record<string, unknown>;
  };
  pinned: boolean;
  created_at: string;
  updated_at: string;
  last_active_at?: string | null;
  usage_summary: UsageSummary;
  usage_diagnostics?: UsageDiagnostics;
  provider_capabilities?: ProviderCapabilities;
  alert_summary: AlertSummary;
  recent_conversations: ConversationRecord[];
}

export interface ConversationRecord {
  id: string;
  agent_id: string;
  title: string;
  session_id?: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  last_message_at?: string | null;
  last_run_status: string;
  last_error: string;
  usage_summary: UsageSummary;
  usage_diagnostics?: UsageDiagnostics;
  provider_capabilities?: ProviderCapabilities;
}

export interface BootstrapResponse {
  generated_at: string;
  summary: {
    agent_count: number;
    conversation_count: number;
    active_agents: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_tokens: number;
    total_estimated_cost: number;
    total_actual_cost: number;
    daily_spend: number;
    monthly_spend: number;
    alerting_agents: number;
  };
  catalog: {
    models: string[];
    toolsets: Array<{ name: string; description: string; tool_count: number }>;
    status_options: string[];
    entity_options: string[];
    function_options: string[];
  };
  entities: EntityRecord[];
  entity_tree: EntityRecord[];
  agents: AgentRecord[];
  conversations: ConversationRecord[];
  audit_log: Array<{ id: string; event: string; detail: Record<string, unknown>; created_at: string }>;
}

export type InlineToolStatus = "running" | "done" | "error";

export interface InlineToolEvent {
  id: string;
  name: string;
  status: InlineToolStatus;
  input?: unknown;
  output?: unknown;
  duration_ms?: number;
  error?: string;
}

export interface BriefingItem {
  title: string;
  due: string;
  priority: "low" | "medium" | "high" | string;
  reason: string;
  source?: string;
}

export interface BriefingAgentResult {
  agent_id: string;
  label: string;
  status: "ok" | "timeout" | "error";
  latency_ms: number;
  raw_response_preview: string;
  parsed_items: BriefingItem[];
  notes_for_david: string | null;
  error: string | null;
  error_class?: string | null;
  error_detail?: string | null;
  stdout?: string;
  stderr?: string;
  exit_code?: number | null;
  tracked_items_count?: number;
  briefed_items_count?: number;
  inferred_items_count?: number;
}

export type TrackedItemEntity = "trust" | "holdings" | "media" | "properties" | "customs" | null;
export type TrackedItemCategory = "deadline" | "milestone" | "recurring" | "issue" | "watch";
export type TrackedItemRecurrence = "daily" | "weekly" | "monthly" | "quarterly" | "annual" | null;
export type TrackedItemPriority = "low" | "medium" | "high";
export type TrackedItemStatus = "active" | "snoozed" | "done" | "dismissed";

export interface TrackedItem {
  id: string;
  agent_id: string;
  entity: TrackedItemEntity;
  title: string;
  description: string | null;
  category: TrackedItemCategory;
  due_date: string | null;
  recurrence: TrackedItemRecurrence;
  priority: TrackedItemPriority;
  status: TrackedItemStatus;
  tags: string[];
  notes: string | null;
  source: "manual" | "chat" | "import";
  created_at: string;
  updated_at: string;
  last_briefed_at: string | null;
}

export type TrackedItemDraft = Partial<Omit<TrackedItem, "id" | "created_at" | "updated_at" | "last_briefed_at">> & { agent_id: string; title: string };

export interface BriefingSummary {
  total_items: number;
  high_priority_count: number;
  by_agent: Record<string, number>;
}

export interface Briefing {
  id: string;
  generated_at: string;
  triggered_by: "scheduled" | "manual";
  duration_ms: number;
  agents: BriefingAgentResult[];
  summary: BriefingSummary;
}

export interface BriefingListItem {
  id: string;
  generated_at: string;
  triggered_by?: "scheduled" | "manual";
  summary: BriefingSummary;
}

export interface BriefingConfigAgent {
  label: string;
  agent_id: string;
  configured_agent_id?: string;
  status: "ok" | "fallback_id" | "missing" | string;
}

export interface BriefingConfig {
  enabled: boolean;
  time_local: string;
  days_of_week: string[];
  agents: string[];
  agent_status: BriefingConfigAgent[];
  schedule_mode: string;
}

export interface BriefingRunStatus {
  running: boolean;
  triggered_by?: "scheduled" | "manual";
  last_briefing_id?: string;
  agents?: Array<{ label: string; status: "pending" | "ok" | "timeout" | "error" | string }>;
}

export type MessagePriority = "low" | "normal" | "high";
export type MessageStatus = "sent" | "read" | "archived";
export type MessageRelatedEntity = "trust" | "holdings" | "media" | "properties" | "customs" | null;
export type MessageViewMode = "inbox" | "sent";

export interface MessageReferences {
  tracked_item_ids: string[];
  briefing_id: string | null;
  reactive_sweep_id?: string | null;
}

export interface MessageRecord {
  id: string;
  thread_id: string;
  from_agent_id: string;
  to_agent_id: string;
  subject: string;
  body: string;
  priority: MessagePriority;
  related_entity: MessageRelatedEntity;
  references: MessageReferences;
  in_reply_to: string | null;
  status: MessageStatus;
  sent_at: string;
  read_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  sent_from_reactive_sweep?: boolean;
  triggered_reactive_sweep?: boolean;
  queued_for_reactive?: boolean;
  reactive_sweep_id?: string | null;
}

export interface MessagePage {
  messages: MessageRecord[];
  total: number;
  unread_count: number;
}

export type UnreadCounts = Record<string, number>;

export type ReactiveSweepStatus = "pending" | "running" | "completed" | "failed" | "rate_limited";

export interface ReactiveSweep {
  id: string;
  agent_id: string;
  status: ReactiveSweepStatus | string;
  trigger_message_ids: string[];
  started_at: string | null;
  completed_at: string | null;
  latency_ms: number | null;
  outgoing_messages_sent: Array<{ msg_id?: string; to_agent_id?: string; to_agent_label?: string; subject?: string; priority?: string; in_reply_to?: string | null }>;
  outgoing_messages_rejected: Array<Record<string, unknown>>;
  notes_for_david: string | null;
  error: string | null;
  error_class: string | null;
  created_at: string;
  trigger_subject?: string;
  agent_label?: string;
  jumped_from_link?: boolean;
}

export interface ReactiveSweepStats {
  total_today: number;
  by_agent_today: Record<string, number>;
  rate_limited_today: number;
  avg_latency_ms: number;
  loop_blocked_today: number;
  active_in_flight: number;
  queue_size: number;
}

export interface ConversationMessage {
  id: number;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: number;
  tool_name?: string | null;
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
  finish_reason?: string | null;
  client_status?: "thinking" | "streaming" | "complete" | "error";
  error_message?: string;
  tool_events?: InlineToolEvent[];
}

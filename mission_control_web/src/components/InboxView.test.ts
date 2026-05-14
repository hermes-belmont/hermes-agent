import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { InboxView } from "@/components/InboxView";
import type { AgentRecord, MessageRecord } from "@/lib/types";

const storage = new Map<string, string>();
const windowStub = {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
  setInterval: () => 0,
  clearInterval: () => undefined,
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};
Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true });
Object.defineProperty(globalThis, "document", { value: { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }, configurable: true });

const agent = (id: string, name: string): AgentRecord => ({
  id,
  name,
  role: "Role",
  business_function: "Function",
  operating_entity: "Umbrella Holdings Group, LLC",
  entity_id: "ent_holdings",
  team_grouping: "Team",
  system_prompt: "Prompt",
  preferred_model: "gpt-5.5",
  fallback_model: "gpt-5.4-mini",
  token_controls: { max_input_tokens: 1, max_output_tokens: 1, max_total_tokens: 1, max_context_messages: 1 },
  budget_controls: { daily_usd: 1, monthly_usd: 1, alert_threshold_pct: 80, hard_stop: false },
  tool_permissions: { enabled: [] },
  memory: { enabled: false, injection_limit: 0, records: [] },
  observability: { logging_level: "standard", store_transcripts: true, status: "active", last_error: "" },
  advanced: { reasoning_effort: "medium", temperature: 0, notes: "", metadata: {} },
  pinned: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  usage_summary: { input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost: 0, actual_cost: 0 },
  alert_summary: { state: "healthy", reasons: [] },
  recent_conversations: [],
});

const message = (patch: Partial<MessageRecord>): MessageRecord => ({
  id: "msg_trigger",
  thread_id: "thread_1",
  from_agent_id: "agent_a",
  to_agent_id: "agent_b",
  subject: "Reactive test",
  body: "Body",
  priority: "high",
  related_entity: "holdings",
  references: { tracked_item_ids: [], briefing_id: null },
  in_reply_to: null,
  status: "sent",
  sent_at: "2026-01-01T00:00:00Z",
  read_at: null,
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  sent_from_reactive_sweep: false,
  triggered_reactive_sweep: false,
  queued_for_reactive: false,
  reactive_sweep_id: null,
  ...patch,
});

const agents = [agent("agent_a", "Agent A"), agent("agent_b", "Agent B")];
const render = (props: Partial<ComponentProps<typeof InboxView>>) => renderToStaticMarkup(createElement(InboxView, { agents, ...props }));

describe("InboxView reactive badges", () => {
  it("renders a clickable REACTIVE TRIGGERED badge when a trigger has a sweep id", () => {
    const html = render({ initialSelectedAgentId: "agent_b", initialSelectedMessage: message({ triggered_reactive_sweep: true, reactive_sweep_id: "rsw_1234" }) });
    expect(html).toContain("REACTIVE TRIGGERED");
    expect(html).toContain("#/monitor?reactive=rsw_1234");
  });

  it("renders SENT FROM REACTIVE SWEEP as static when no sweep id is present", () => {
    const html = render({ initialSelectedAgentId: "agent_a", initialSelectedMessage: message({ id: "msg_reply", from_agent_id: "agent_b", to_agent_id: "agent_a", sent_from_reactive_sweep: true }) });
    expect(html).toContain("SENT FROM REACTIVE SWEEP");
    expect(html).not.toContain("#/monitor?reactive=");
  });
});

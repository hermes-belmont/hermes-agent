import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsView } from "@/components/AgentsView";
import { entitySaveErrorMessage } from "@/lib/entity-errors";
import type { AgentRecord, BootstrapResponse, EntityRecord } from "@/lib/types";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
});

const entity = (id: string, name: string, type: EntityRecord["type"], parent_id: string | null): EntityRecord => ({
  id,
  name,
  type,
  parent_id,
  display_order: 0,
  description: `${name} description`,
  messaging_policy: "open",
  metadata: { ein: null, state: null, formation_date: null },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
  purge_at: null,
  children: [],
  agents: [],
});

const agent = (): AgentRecord => ({
  id: "agent_media",
  name: "MEDIA DIRECTOR",
  role: "Runs media operations",
  operating_entity: "Umbrella Media, LLC",
  entity_id: "ent_media",
  description: "Primary media agent",
  display_order: 0,
  is_briefing_agent: true,
  business_function: "Media Operations",
  team_grouping: "Media",
  system_prompt: "Runs media operations",
  preferred_model: "gpt-5.5",
  fallback_model: "gpt-5.4-mini",
  token_controls: { max_input_tokens: 30000, max_output_tokens: 4000, max_total_tokens: 120000, max_context_messages: 18 },
  budget_controls: { daily_usd: 25, monthly_usd: 300, alert_threshold_pct: 80, hard_stop: false },
  tool_permissions: { enabled: [] },
  memory: { enabled: true, injection_limit: 4, records: [] },
  observability: { logging_level: "standard", store_transcripts: true, status: "active", last_error: "" },
  advanced: { reasoning_effort: "medium", temperature: 0.2, notes: "", metadata: {} },
  pinned: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  last_active_at: null,
  deleted_at: null,
  purge_at: null,
  deleted_by: null,
});

const bootstrap = (): BootstrapResponse => {
  const mediaAgent = agent();
  const trust = entity("ent_trust", "Umbrella Corporation Trust", "trust", null);
  const media = entity("ent_media", "Umbrella Media, LLC", "llc", "ent_trust");
  media.agents = [mediaAgent];
  trust.children = [media];
  return {
    generated_at: "2026-01-01T00:00:00Z",
    summary: {},
    catalog: { models: ["gpt-5.5"] } as BootstrapResponse["catalog"],
    entities: [trust, media],
    entity_tree: [trust],
    agents: [mediaAgent],
    conversations: [],
    audit_log: [],
  };
};

const render = (props: Partial<ComponentProps<typeof AgentsView>> = {}) => renderToStaticMarkup(
  createElement(AgentsView, { bootstrap: bootstrap(), onRefresh: vi.fn(async () => bootstrap()), ...props }),
);

describe("AgentsView", () => {
  beforeEach(() => storage.clear());

  it("renders with the mock entity tree", () => {
    storage.set("mc.agents.expandedEntities.v1", JSON.stringify(["ent_trust"]));
    const html = render();
    expect(html).toContain("Entity tree");
    expect(html).toContain("Umbrella Corporation Trust");
    expect(html).toContain("Umbrella Media, LLC");
  });

  it("selecting an agent populates the inspector", () => {
    const html = render({ initialSelection: { kind: "agent", id: "agent_media" } });
    expect(html).toContain("Agent inspector");
    expect(html).toContain("MEDIA DIRECTOR");
    expect(html).toContain("Can message:");
  });

  it("selecting an entity populates the entity inspector with the policy dropdown", () => {
    const html = render({ initialSelection: { kind: "entity", id: "ent_media" } });
    expect(html).toContain("Entity inspector");
    expect(html).toContain("Messaging policy");
    expect(html).toContain("Open: any agent may send to/from this entity");
    expect(html).toContain("Restricted: only vertical chain");
    expect(html).toContain("Isolated: only same-entity sends");
  });

  it("extracts entity update validation details from API errors", () => {
    expect(entitySaveErrorMessage(new Error('400: {"detail":"Entity update would create a cycle"}'))).toBe("Entity update would create a cycle");
  });

  it("switching to trash view changes the displayed list", () => {
    const deleted = { ...agent(), deleted_at: "2026-01-02T00:00:00Z", purge_at: "2026-02-01T00:00:00Z", purges_in_days: 30 };
    const html = render({ initialViewMode: "trash", initialTrash: [deleted], initialSelection: { kind: "agent", id: "agent_media" } });
    expect(html).toContain("Trash");
    expect(html).toContain("Purges in 30 days");
    expect(html).toContain("Deleted detail");
  });
});

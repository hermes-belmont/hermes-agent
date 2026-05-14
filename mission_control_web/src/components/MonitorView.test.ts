import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MonitorView } from "@/components/MonitorView";
import type { ReactiveSweep, ReactiveSweepStats } from "@/lib/types";

Object.defineProperty(globalThis, "window", {
  value: { setInterval: () => 0, clearInterval: () => undefined, addEventListener: vi.fn(), removeEventListener: vi.fn(), location: { hash: "#/monitor" } },
  configurable: true,
});
Object.defineProperty(globalThis, "document", {
  value: { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn(), getElementById: () => null },
  configurable: true,
});

const stats: ReactiveSweepStats = {
  total_today: 7,
  by_agent_today: { agent_a: 4, agent_b: 3 },
  rate_limited_today: 1,
  avg_latency_ms: 250,
  loop_blocked_today: 2,
  active_in_flight: 1,
  queue_size: 3,
};

const sweep = (patch: Partial<ReactiveSweep> = {}): ReactiveSweep => ({
  id: "rsw_1234",
  agent_id: "agent_a",
  status: "completed",
  trigger_message_ids: ["msg_1"],
  started_at: "2026-01-01T00:00:00Z",
  completed_at: "2026-01-01T00:00:01Z",
  latency_ms: 250,
  outgoing_messages_sent: [{ msg_id: "msg_2", to_agent_id: "agent_b", to_agent_label: "Agent B", subject: "Reply", priority: "normal", in_reply_to: "msg_1" }],
  outgoing_messages_rejected: [],
  notes_for_david: "Watch this",
  error: null,
  error_class: null,
  created_at: "2026-01-01T00:00:00Z",
  trigger_subject: "A very important reactive trigger subject that should be truncated in the list",
  agent_label: "Agent A",
  jumped_from_link: false,
  ...patch,
});

const render = (props: Partial<ComponentProps<typeof MonitorView>> = {}) => renderToStaticMarkup(createElement(MonitorView, {
  initialReactiveStats: stats,
  initialReactiveSweeps: [sweep()],
  ...props,
}));

describe("MonitorView reactive activity", () => {
  it("renders the reactive activity stats section", () => {
    const html = render();
    expect(html).toContain("REACTIVE ACTIVITY");
    expect(html).toContain("Agent-to-agent reactive sweeps today.");
    expect(html).toContain("Today total");
    expect(html).toContain("7");
    expect(html).toContain("Loop-blocked");
  });

  it("renders recent sweeps with status, latency, and outgoing count", () => {
    const html = render();
    expect(html).toContain("Agent A");
    expect(html).toContain("completed");
    expect(html).toContain("250ms");
    expect(html).toContain("1 outgoing");
  });

  it("expands a deep-linked reactive sweep", () => {
    const html = render({ initialExpandedReactiveId: "rsw_1234" });
    expect(html).toContain("Watch this");
    expect(html).toContain("&quot;id&quot;: &quot;rsw_1234&quot;");
    expect(html).toContain("Reply");
  });
});

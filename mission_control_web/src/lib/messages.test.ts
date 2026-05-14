import { describe, expect, it, vi } from "vitest";
import type { AgentRecord, MessageRecord } from "@/lib/types";
import { filterMessages, getStoredInboxAgentId, getStoredInboxViewMode, messageRelativeTime, sortAgentsForInbox, threadCounts, totalUnread } from "@/lib/messages";

const agents = [
  { id: "agent_b", name: "Beta", operating_entity: "Media", team_grouping: "", business_function: "" },
  { id: "agent_a", name: "Alpha", operating_entity: "Holdings", team_grouping: "", business_function: "" },
  { id: "agent_c", name: "Gamma", operating_entity: "Trust", team_grouping: "", business_function: "" },
] as AgentRecord[];

const baseMessage: MessageRecord = {
  id: "msg_1",
  thread_id: "thread_1",
  from_agent_id: "agent_a",
  to_agent_id: "agent_b",
  subject: "Subject",
  body: "Body",
  priority: "normal",
  related_entity: null,
  references: { tracked_item_ids: [], briefing_id: null },
  in_reply_to: null,
  status: "sent",
  sent_at: "2026-05-13T10:00:00Z",
  read_at: null,
  archived_at: null,
  created_at: "2026-05-13T10:00:00Z",
  updated_at: "2026-05-13T10:00:00Z",
};

describe("Inbox helpers", () => {
  it("sorts agents with unread first, then alphabetically", () => {
    expect(sortAgentsForInbox(agents, { agent_b: 1, agent_c: 3, agent_a: 1 }).map((agent) => agent.id)).toEqual(["agent_c", "agent_a", "agent_b"]);
  });

  it("filters by status and priority", () => {
    const messages = [
      baseMessage,
      { ...baseMessage, id: "msg_2", status: "read", priority: "high" },
      { ...baseMessage, id: "msg_3", status: "archived", priority: "low" },
    ] as MessageRecord[];
    expect(filterMessages(messages, "read", "all").map((message) => message.id)).toEqual(["msg_2"]);
    expect(filterMessages(messages, "all", "low").map((message) => message.id)).toEqual(["msg_3"]);
  });

  it("counts threads and unread totals", () => {
    expect(threadCounts([baseMessage, { ...baseMessage, id: "msg_2" }, { ...baseMessage, id: "msg_3", thread_id: "thread_2" }])).toEqual({ thread_1: 2, thread_2: 1 });
    expect(totalUnread({ agent_a: 0, agent_b: 3, agent_c: 1 })).toBe(4);
  });

  it("uses persisted view mode and selected agent when valid", () => {
    const storage = { getItem: vi.fn((key: string) => key.includes("viewMode") ? "sent" : "agent_a") };
    expect(getStoredInboxViewMode(storage as unknown as Storage)).toBe("sent");
    expect(getStoredInboxAgentId(agents, {}, storage as unknown as Storage)).toBe("agent_a");
  });

  it("formats relative timestamps for inbox cards", () => {
    const now = new Date("2026-05-13T12:00:00Z").getTime();
    expect(messageRelativeTime("2026-05-13T10:00:00Z", now)).toBe("2h ago");
    expect(messageRelativeTime("2026-05-12T10:00:00Z", now)).toBe("Yesterday");
  });
});

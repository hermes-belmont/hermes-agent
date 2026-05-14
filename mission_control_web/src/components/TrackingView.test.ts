import { describe, expect, it, vi } from "vitest";
import { buildEmptyTrackingDraft, isTrackingDraftSavable, LAST_USED_AGENT_STORAGE_KEY, resolveDefaultAgentForAdd } from "@/lib/tracking";

const agents = [
  { id: "agent_app", name: "App Developer" },
  { id: "agent_ab9825e9ca", name: "Holdings Operator" },
];

describe("TrackingView add-item defaults", () => {
  it("starts with the select-agent sentinel and is not savable", () => {
    const draft = buildEmptyTrackingDraft(agents as never[], null);
    expect(draft.agent_id).toBe("");
    expect(isTrackingDraftSavable(draft)).toBe(false);
  });

  it("preselects the last-used agent on the next add-item open", () => {
    const getItem = vi.fn((key: string) => key === LAST_USED_AGENT_STORAGE_KEY ? "agent_ab9825e9ca" : null);
    expect(resolveDefaultAgentForAdd(agents as never[], { getItem } as unknown as Storage)).toBe("agent_ab9825e9ca");

    const draft = buildEmptyTrackingDraft(agents as never[], "agent_ab9825e9ca");
    expect(draft.agent_id).toBe("agent_ab9825e9ca");
    expect(isTrackingDraftSavable({ ...draft, title: "Test item" })).toBe(true);
  });
});

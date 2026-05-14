import { describe, expect, it } from "vitest";
import { briefingDateLabel, briefingPriorityTone, summarizeRunProgress } from "@/lib/briefings";

describe("briefing helpers", () => {
  it("labels today and yesterday briefings", () => {
    expect(briefingDateLabel("2026-05-12", new Date("2026-05-12T12:00:00Z"))).toBe("Today");
    expect(briefingDateLabel("2026-05-11", new Date("2026-05-12T12:00:00Z"))).toBe("Yesterday");
  });

  it("normalizes priority tone", () => {
    expect(briefingPriorityTone("high")).toBe("high");
    expect(briefingPriorityTone("urgent")).toBe("medium");
  });

  it("summarizes pending run progress per agent", () => {
    expect(summarizeRunProgress(["Customs Director", "Media Director"], null)).toEqual([
      { label: "Customs Director", status: "pending" },
      { label: "Media Director", status: "pending" },
    ]);
  });
});

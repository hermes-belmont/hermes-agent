import { describe, expect, it } from "vitest";
import { formatFileSize, updateSummary } from "./maintenance";

describe("maintenance helpers", () => {
  it("formats generated dump and backup sizes", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });

  it("summarizes update status", () => {
    expect(updateSummary({ up_to_date: true, behind_by: 0 })).toBe("Up to date");
    expect(updateSummary({ up_to_date: false, behind_by: 3 })).toBe("3 commits behind");
  });
});

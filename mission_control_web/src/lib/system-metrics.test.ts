import { describe, expect, it } from "vitest";
import { formatBytes, formatNullableMb, progressFillColor, usageTone } from "./system-metrics";

describe("system metrics formatting", () => {
  it("formats byte counts for monitor network rows", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024 * 1024 * 42)).toBe("42.0 MB");
    expect(formatBytes(1024 * 1024 * 1024 * 2.5)).toBe("2.5 GB");
  });

  it("formats nullable Node.js memory fields", () => {
    expect(formatNullableMb(null)).toBe("—");
    expect(formatNullableMb(128)).toBe("128 MB");
  });

  it("maps usage thresholds to expected fill colors", () => {
    expect(usageTone(69.9)).toBe("normal");
    expect(progressFillColor(69.9)).toBe("var(--warm-glow)");
    expect(usageTone(70)).toBe("warning");
    expect(progressFillColor(70)).toBe("#ffbd38");
    expect(usageTone(91)).toBe("danger");
    expect(progressFillColor(91)).toBe("#fb2c36");
  });
});

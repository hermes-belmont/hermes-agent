import { describe, expect, it } from "vitest";
import { canConfirmAction } from "@/lib/confirm-action";

describe("ConfirmActionModal phrase gate", () => {
  it("allows low and medium risk actions without a typed phrase", () => {
    expect(canConfirmAction({ riskLevel: "low", typedPhrase: "" })).toBe(true);
    expect(canConfirmAction({ riskLevel: "medium", typedPhrase: "" })).toBe(true);
  });

  it("requires an exact phrase for high risk actions", () => {
    expect(canConfirmAction({ riskLevel: "high", requirePhrase: "UPDATE HERMES", typedPhrase: "" })).toBe(false);
    expect(canConfirmAction({ riskLevel: "high", requirePhrase: "UPDATE HERMES", typedPhrase: "update hermes" })).toBe(false);
    expect(canConfirmAction({ riskLevel: "high", requirePhrase: "UPDATE HERMES", typedPhrase: "UPDATE HERMES" })).toBe(true);
  });
});

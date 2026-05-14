import { describe, expect, it } from "vitest";
import { resolveHashView } from "./hash-routing";

describe("resolveHashView", () => {
  it("treats empty/root hash as new-chat (no fallback)", () => {
    for (const h of ["", "#", "#/", "#/new-chat"]) {
      const r = resolveHashView(h);
      expect(r.view).toBe("new-chat");
      expect(r.fallback).toBe(false);
      expect(r.redirectToModels).toBe(false);
    }
  });

  it("maps monitor / maintenance", () => {
    expect(resolveHashView("#/briefings").view).toBe("briefings");
    expect(resolveHashView("#/tracking").view).toBe("tracking");
    expect(resolveHashView("#/tracking?agent_id=agent_a").view).toBe("tracking");
    expect(resolveHashView("#/monitor").view).toBe("monitor");
    expect(resolveHashView("#/maintenance").view).toBe("maintenance");
  });

  it("maps the bare #/settings to settings/models with redirect flag", () => {
    const r = resolveHashView("#/settings");
    expect(r.view).toBe("settings");
    expect(r.settingsSection).toBe("models");
    expect(r.redirectToModels).toBe(true);
  });

  it("maps each settings subsection", () => {
    expect(resolveHashView("#/settings/models").settingsSection).toBe("models");
    expect(resolveHashView("#/settings/themes").settingsSection).toBe("themes");
    expect(resolveHashView("#/settings/account").settingsSection).toBe("account");
    expect(resolveHashView("#/settings/models").redirectToModels).toBe(false);
  });

  it("falls back to new-chat on unrecognized hash", () => {
    const r = resolveHashView("#/wat");
    expect(r.view).toBe("new-chat");
    expect(r.fallback).toBe(true);
  });

  it("does not match partial settings paths", () => {
    expect(resolveHashView("#/settings/garbage").fallback).toBe(true);
    expect(resolveHashView("#/settings/garbage").view).toBe("new-chat");
  });
});

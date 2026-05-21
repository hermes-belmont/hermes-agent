import { describe, expect, it } from "vitest";
import { legacyHashRedirect, resolveHashView } from "./hash-routing";

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
    expect(resolveHashView("#/cron").view).toBe("briefings");
    expect(resolveHashView("#/cron/123").view).toBe("briefings");
    expect(resolveHashView("#/cron?briefing_id=123").view).toBe("briefings");
    expect(resolveHashView("#/kanban").view).toBe("tracking");
    expect(resolveHashView("#/kanban/task-1").view).toBe("tracking");
    expect(resolveHashView("#/kanban?agent_id=agent_a").view).toBe("tracking");
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
    expect(resolveHashView("#/settings/desktop-remote").settingsSection).toBe("desktop-remote");
    expect(resolveHashView("#/settings/keys").settingsSection).toBe("keys");
    expect(resolveHashView("#/settings/config").settingsSection).toBe("config");
    expect(resolveHashView("#/settings/skills").settingsSection).toBe("skills");
    expect(resolveHashView("#/settings/account").settingsSection).toBe("account");
    expect(resolveHashView("#/settings/models").redirectToModels).toBe(false);
  });

  it("redirects legacy briefings and tracking routes to canonical routes", () => {
    expect(legacyHashRedirect("#/briefings")).toBe("#/cron");
    expect(legacyHashRedirect("#/briefings/123")).toBe("#/cron/123");
    expect(legacyHashRedirect("#/briefings?date=today")).toBe("#/cron?date=today");
    expect(legacyHashRedirect("#/tracking")).toBe("#/kanban");
    expect(legacyHashRedirect("#/tracking?agent_id=agent_a")).toBe("#/kanban?agent_id=agent_a");
    expect(legacyHashRedirect("#/tracking/task-1")).toBe("#/kanban/task-1");
    expect(legacyHashRedirect("#/kanban")).toBeNull();
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

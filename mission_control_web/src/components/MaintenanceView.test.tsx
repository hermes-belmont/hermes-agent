/** @vitest-environment jsdom */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { MaintenanceView } from "@/components/MaintenanceView";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    getMaintenanceVersion: vi.fn(),
    getHermesMaintenanceStatus: vi.fn(),
    getHciMaintenanceStatus: vi.fn(),
    restartGatewayMaintenance: vi.fn(),
    getMissionControlCommits: vi.fn(),
    runMaintenanceHealthCheck: vi.fn(),
    checkMaintenanceUpdates: vi.fn(),
    runMaintenanceDoctor: vi.fn(),
    generateMaintenanceDump: vi.fn(),
    createMaintenanceBackup: vi.fn(),
    restartMissionControl: vi.fn(),
    updateAllMaintenance: vi.fn(),
    startUpdateAllMaintenance: vi.fn(),
    getUpdateAllMaintenanceStatus: vi.fn(),
    rollbackMaintenance: vi.fn(),
    autoFixMaintenance: vi.fn(),
    updateHermesMaintenance: vi.fn(),
    importMaintenanceBackup: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.mocked(api.getMaintenanceVersion).mockResolvedValue({
    mission_control: { version: "0.13.0", branch: "main", commit: "abc1234" },
    hermes_agent: { version: "0.13.0" },
  });
  vi.mocked(api.getMissionControlCommits).mockResolvedValue({ ok: true, commits: [] });
  vi.mocked(api.getHciMaintenanceStatus).mockResolvedValue({
    worktree: { branch: "mission-control-work", head_sha: "abc123456789", head_sha_short: "abc12345" },
    mission_control: { running_sha: "abc123456789", running_sha_short: "abc12345", running_built_at: "2026-05-16T17:00:00Z", status: "in_sync", source: "dist_manifest" },
    hermes_agent: { installed_version: "0.14.0", installed_sha: "def987654321", installed_sha_short: "def98765", status: "reinstall_required", source: "uv_pip_show", source_label: "uv pip" },
    checked_at: "2026-05-16T17:00:00Z",
  });
  vi.mocked(api.getHermesMaintenanceStatus).mockResolvedValue({
    current_version: "0.14.0",
    latest_version: "0.14.0",
    commits_behind: 0,
    carried_commits_ahead: 31,
    upstream_sha: "f3a4af9c",
    local_sha: "bc769694",
    branch: "mission-control-work",
    checked_at: "2026-05-16T12:00:00Z",
    status: "ahead",
  });
  vi.mocked(api.restartGatewayMaintenance).mockResolvedValue({ ok: true, method: "launchctl_kickstart", label: "ai.hermes.gateway", initiated_at: "2026-05-16T12:00:00Z" });
  vi.mocked(api.getUpdateAllMaintenanceStatus).mockRejectedValue(new Error("no active update job"));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("Maintenance Hermes Update releases link", () => {
  it("renders View releases link with correct target attributes", async () => {
    await act(async () => {
      root.render(<MaintenanceView />);
    });

    const link = Array.from(host.querySelectorAll("a")).find((candidate) => candidate.textContent?.includes("View releases"));
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toBe("https://github.com/NousResearch/hermes-agent/releases");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders maintenance confirmation modal titles as uppercase tracked headings", async () => {
    await act(async () => {
      root.render(<MaintenanceView />);
    });

    const expectations = [
      ["Restart HCI", "RESTART HCI"],
      ["Update All", "UPDATE ALL"],
      ["Rollback", "ROLLBACK MISSION CONTROL"],
      ["Auto-Fix", "AUTO-FIX"],
      ["Update Hermes", "HERMES UPDATE"],
      ["Restart Gateway", "RESTART HERMES AGENT GATEWAY"],
      ["Import", "IMPORT BACKUP"],
    ] as const;

    for (const [buttonLabel, expectedTitle] of expectations) {
      const button = Array.from(host.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === buttonLabel) as HTMLButtonElement | undefined;
      expect(button, `${buttonLabel} button`).toBeTruthy();

      await act(async () => {
        button?.click();
      });

      const title = host.querySelector("#confirm-action-title");
      expect(title?.textContent).toBe(expectedTitle);
      expect(title?.className).toContain("uppercase");
      expect(title?.className).toContain("tracking-[0.24em]");

      const cancel = Array.from(host.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === "Cancel") as HTMLButtonElement | undefined;
      await act(async () => {
        cancel?.click();
      });
    }
  });
});

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
    getMissionControlCommits: vi.fn(),
    runMaintenanceHealthCheck: vi.fn(),
    checkMaintenanceUpdates: vi.fn(),
    runMaintenanceDoctor: vi.fn(),
    generateMaintenanceDump: vi.fn(),
    createMaintenanceBackup: vi.fn(),
    restartMissionControl: vi.fn(),
    updateAllMaintenance: vi.fn(),
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
});

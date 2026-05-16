export type MaintenanceVersion = {
  mission_control: { version: string; commit: string; branch: string };
  hermes_agent: { version: string };
};

export type HermesStatus = {
  current_version: string | null;
  latest_version: string | null;
  commits_behind: number | null;
  carried_commits_ahead: number | null;
  upstream_sha: string | null;
  local_sha: string | null;
  branch: string | null;
  checked_at: string;
  status: "up_to_date" | "behind" | "ahead" | "diverged" | "unknown";
};

export type RestartGatewayResult = {
  ok: boolean;
  method?: "launchctl_kickstart" | "launchctl_reload" | "hermes_cli";
  label?: string | null;
  initiated_at?: string;
  reason?: string;
};

export type HealthCheckResult = {
  ok: boolean;
  checks: { endpoint: string; status: number; latency_ms: number; error?: string }[];
  ran_at: string;
};

export type UpdateCheckResult = {
  mission_control: { up_to_date: boolean; behind_by: number; latest_commit: string; error?: string };
  hermes_agent: { up_to_date: boolean; behind_by: number; latest_commit: string; error?: string };
  checked_at: string;
};

export type DoctorResult = {
  ok: boolean;
  checks: { name: string; status: "ok" | "warn" | "fail" | string; detail: string }[];
  summary: string;
  ran_at: string;
};

export type DumpResult = {
  filename: string;
  size_bytes: number;
  path: string;
  download_url: string;
};

export type BackupResult = {
  filename: string;
  size_bytes: number;
  created_at: string;
  download_url: string;
};

export type SnapshotResult = {
  filename: string;
  path: string;
  size_bytes: number;
  created_at: string;
  reason: string;
};

export type DestructiveMaintenanceResult = {
  ok: boolean;
  message: string;
  snapshot?: SnapshotResult;
  log?: string;
  error?: string;
  commit?: string;
  steps?: { name: string; ok: boolean; detail: string }[];
};

export type GitCommitOption = { short: string; hash: string; subject: string };

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function updateSummary(component: { up_to_date: boolean; behind_by: number }): string {
  if (component.up_to_date) return "Up to date";
  return `${component.behind_by} commits behind`;
}

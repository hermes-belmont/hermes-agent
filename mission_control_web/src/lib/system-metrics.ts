export type SystemMetrics = {
  cpu: { percent: number; cores: number };
  memory: { used_mb: number; total_mb: number; percent: number };
  disk: { used_gb: number; total_gb: number; percent: number; mount: string };
  processes: { running: number; total: number };
  load_average: { one_min: number; five_min: number; fifteen_min: number };
  network: {
    interface: string;
    bytes_sent: number;
    bytes_recv: number;
    packets_sent: number;
    packets_recv: number;
    errors?: number;
  };
  node_memory: { rss_mb: number | null; heap_used_mb: number | null; heap_total_mb: number | null };
  uptime: { seconds: number; formatted: string };
  system: { model: string; os_name: string; os_version: string; hostname: string };
  versions: { mission_control: string; hermes_agent: string; python: string; node: string };
  fetched_at: string;
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const decimals = unit <= 1 ? 0 : value >= 100 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unit]}`;
}

export function formatNullableMb(value: number | null): string {
  return value === null || value === undefined ? "—" : `${value} MB`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function usageTone(percent: number): "normal" | "warning" | "danger" {
  if (percent > 90) return "danger";
  if (percent >= 70) return "warning";
  return "normal";
}

export function progressFillColor(percent: number): string {
  const tone = usageTone(percent);
  if (tone === "danger") return "#fb2c36";
  if (tone === "warning") return "#ffbd38";
  return "var(--warm-glow)";
}

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Clock,
  Cpu,
  Database,
  Radio,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Cell, Grid } from "@nous-research/ui";
import { api } from "@/lib/api";
import type { PlatformStatus, SessionInfo, StatusSummaryResponse } from "@/lib/api";
import { timeAgo, isoTimeAgo } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";

export default function StatusPage() {
  const [status, setStatus] = useState<StatusSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [restartingGateway, setRestartingGateway] = useState(false);
  const [metrics, setMetrics] = useState<{
    durationMs: number;
    responseBytes: number;
    contentEncoding: string | null;
    contentLength: number | null;
    loadedAt: number;
  } | null>(null);
  const { t } = useI18n();

  const load = useCallback(async () => {
    try {
      const summary = await api.getStatusSummaryDetailed();
      setStatus(summary.data);
      setMetrics({
        durationMs: summary.durationMs,
        responseBytes: summary.responseBytes,
        contentEncoding: summary.contentEncoding,
        contentLength: summary.contentLength,
        loadedAt: Date.now(),
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard status");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRestartGateway = useCallback(async () => {
    try {
      setRestartingGateway(true);
      await api.restartGateway();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restart gateway");
    } finally {
      setRestartingGateway(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => {
      void load();
    }, 10000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!status) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <CardTitle className="text-base">Dashboard status unavailable</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {error ?? "The dashboard could not load status data."}
          </p>
          <div>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center rounded border border-border px-3 py-1.5 text-sm hover:bg-secondary/30"
            >
              Retry
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const PLATFORM_STATE_BADGE: Record<
    string,
    { variant: "success" | "warning" | "destructive"; label: string }
  > = {
    connected: { variant: "success", label: t.status.connected },
    disconnected: { variant: "warning", label: t.status.disconnected },
    fatal: { variant: "destructive", label: t.status.error },
  };

  const GATEWAY_STATE_DISPLAY: Record<
    string,
    { badge: "success" | "warning" | "destructive" | "outline"; label: string }
  > = {
    running: { badge: "success", label: t.status.running },
    starting: { badge: "warning", label: t.status.starting },
    startup_failed: { badge: "destructive", label: t.status.failed },
    stopped: { badge: "outline", label: t.status.stopped },
  };

  function gatewayValue(): string {
    if (status!.gateway_running && status!.gateway_health_url)
      return status!.gateway_health_url;
    if (status!.gateway_running && status!.gateway_pid)
      return `${t.status.pid} ${status!.gateway_pid}`;
    if (status!.gateway_running) return t.status.runningRemote;
    if (status!.gateway_state === "startup_failed") return t.status.startFailed;
    return t.status.notRunning;
  }

  function gatewayBadge() {
    const info = status!.gateway_state
      ? GATEWAY_STATE_DISPLAY[status!.gateway_state]
      : null;
    if (info) return info;
    return status!.gateway_running
      ? { badge: "success" as const, label: t.status.running }
      : { badge: "outline" as const, label: t.common.off };
  }

  const gwBadge = gatewayBadge();

  function formatBytes(bytes: number | null): string {
    if (!bytes || bytes <= 0) return "0 B";
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  }

  const items = [
    {
      icon: Cpu,
      label: t.status.agent,
      value: `v${status.version}`,
      badgeText: t.common.live,
      badgeVariant: "success" as const,
    },
    {
      icon: Radio,
      label: t.status.gateway,
      value: gatewayValue(),
      badgeText: gwBadge.label,
      badgeVariant: gwBadge.badge,
    },
    {
      icon: Activity,
      label: t.status.activeSessions,
      value:
        status.active_sessions > 0
          ? `${status.active_sessions} ${t.status.running.toLowerCase()}`
          : t.status.noneRunning,
      badgeText: status.active_sessions > 0 ? t.common.live : t.common.off,
      badgeVariant: (status.active_sessions > 0 ? "success" : "outline") as
        | "success"
        | "outline",
    },
  ];

  const platforms = Object.entries(status.gateway_platforms ?? {});
  const activeSessions: SessionInfo[] = status.active_session_details ?? [];
  const recentSessions: SessionInfo[] = status.recent_sessions ?? [];

  // Collect alerts that need attention
  const alerts: { message: string; detail?: string }[] = [];
  if (status.config_is_outdated) {
    alerts.push({
      message: `Config schema is behind (${status.current_config_version ?? status.config_version} < ${status.latest_config_version})`,
      detail: "Open Config and save/reload to migrate onto the latest schema.",
    });
  }
  if (status.gateway_state === "startup_failed") {
    alerts.push({
      message: t.status.gatewayFailedToStart,
      detail: status.gateway_exit_reason ?? undefined,
    });
  }
  const failedPlatforms = platforms.filter(
    ([, info]) => info.state === "fatal" || info.state === "disconnected",
  );
  for (const [name, info] of failedPlatforms) {
    const stateLabel =
      info.state === "fatal"
        ? t.status.platformError
        : t.status.platformDisconnected;
    alerts.push({
      message: `${name.charAt(0).toUpperCase() + name.slice(1)} ${stateLabel}`,
      detail: info.error_message ?? undefined,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="border border-warning/30 bg-warning/[0.06] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-warning">Status auto-refresh degraded</p>
              <p className="text-xs text-warning/80 mt-0.5 break-all">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="shrink-0 rounded border border-warning/30 px-2 py-1 text-xs hover:bg-warning/10"
            >
              Retry
            </button>
          </div>
        </div>
      )}
      {alerts.length > 0 && (
        <div className="border border-destructive/30 bg-destructive/[0.06] p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex flex-col gap-2 min-w-0">
              {alerts.map((alert, i) => (
                <div key={i}>
                  <p className="text-sm font-medium text-destructive">
                    {alert.message}
                  </p>
                  {alert.detail && (
                    <p className="text-xs text-destructive/70 mt-0.5">
                      {alert.detail}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <Grid className="border-b lg:!grid-cols-2">
        <Cell className="flex min-w-0 flex-col gap-3 overflow-hidden">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm font-medium">Gateway controls</CardTitle>
            <Radio className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Refresh status
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleRestartGateway()}
              disabled={restartingGateway}
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${restartingGateway ? "animate-spin" : ""}`} />
              {restartingGateway ? "Restarting…" : "Restart gateway"}
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            Restarts the Hermes gateway service in-place, then refreshes the dashboard summary.
          </div>
        </Cell>

        <Cell className="flex min-w-0 flex-col gap-3 overflow-hidden">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm font-medium">Observability</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Latency</div>
              <div className="font-medium">{metrics ? `${Math.round(metrics.durationMs)} ms` : "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Payload</div>
              <div className="font-medium">{metrics ? formatBytes(metrics.responseBytes) : "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Encoding</div>
              <div className="font-medium uppercase">{metrics?.contentEncoding ?? "none"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Refresh</div>
              <div className="font-medium">10s poll</div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Last sample {metrics ? timeAgo(Math.floor(metrics.loadedAt / 1000)) : "—"}
            {metrics?.contentLength ? ` · header ${formatBytes(metrics.contentLength)}` : ""}
          </div>
        </Cell>
      </Grid>

      <Grid className="border-b lg:!grid-cols-3">
        {items.map(({ icon: Icon, label, value, badgeText, badgeVariant }) => (
          <Cell
            key={label}
            className="flex min-w-0 flex-col gap-2 overflow-hidden"
          >
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>

            <div
              className="truncate text-2xl font-bold font-mondwest"
              title={value}
            >
              {value}
            </div>

            {badgeText && (
              <Badge variant={badgeVariant} className="self-start">
                {badgeVariant === "success" && (
                  <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                )}
                {badgeText}
              </Badge>
            )}
          </Cell>
        ))}
      </Grid>

      {platforms.length > 0 && (
        <PlatformsCard
          platforms={platforms}
          platformStateBadge={PLATFORM_STATE_BADGE}
        />
      )}

      {activeSessions.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-success" />
              <CardTitle className="text-base">
                {t.status.activeSessions}
              </CardTitle>
            </div>
          </CardHeader>

          <CardContent className="grid gap-3">
            {activeSessions.map((s) => (
              <div
                key={s.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border border-border p-3 w-full"
              >
                <div className="flex flex-col gap-1 min-w-0 w-full">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">
                      {s.title ?? t.common.untitled}
                    </span>

                    <Badge variant="success" className="text-[10px] shrink-0">
                      <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                      {t.common.live}
                    </Badge>
                  </div>

                  <span className="text-xs text-muted-foreground truncate">
                    <span className="font-mono-ui">
                      {(s.model ?? t.common.unknown).split("/").pop()}
                    </span>{" "}
                    · {s.message_count} {t.common.msgs} ·{" "}
                    {timeAgo(s.last_active)}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {recentSessions.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">
                {t.status.recentSessions}
              </CardTitle>
            </div>
          </CardHeader>

          <CardContent className="grid gap-3">
            {recentSessions.map((s) => (
              <div
                key={s.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border border-border p-3 w-full"
              >
                <div className="flex flex-col gap-1 min-w-0 w-full">
                  <span className="font-medium text-sm truncate">
                    {s.title ?? t.common.untitled}
                  </span>

                  <span className="text-xs text-muted-foreground truncate">
                    <span className="font-mono-ui">
                      {(s.model ?? t.common.unknown).split("/").pop()}
                    </span>{" "}
                    · {s.message_count} {t.common.msgs} ·{" "}
                    {timeAgo(s.last_active)}
                  </span>

                  {s.preview && (
                    <span className="text-xs text-muted-foreground/70 truncate">
                      {s.preview}
                    </span>
                  )}
                </div>

                <Badge
                  variant="outline"
                  className="text-[10px] shrink-0 self-start sm:self-center"
                >
                  <Database className="mr-1 h-3 w-3" />
                  {s.source ?? "local"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PlatformsCard({ platforms, platformStateBadge }: PlatformsCardProps) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">
            {t.status.connectedPlatforms}
          </CardTitle>
        </div>
      </CardHeader>

      <CardContent className="grid gap-3">
        {platforms.map(([name, info]) => {
          const display = platformStateBadge[info.state] ?? {
            variant: "outline" as const,
            label: info.state,
          };
          const IconComponent =
            info.state === "connected"
              ? Wifi
              : info.state === "fatal"
                ? AlertTriangle
                : WifiOff;

          return (
            <div
              key={name}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border border-border p-3 w-full"
            >
              <div className="flex items-center gap-3 min-w-0 w-full">
                <IconComponent
                  className={`h-4 w-4 shrink-0 ${
                    info.state === "connected"
                      ? "text-success"
                      : info.state === "fatal"
                        ? "text-destructive"
                        : "text-warning"
                  }`}
                />

                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-sm font-medium capitalize truncate">
                    {name}
                  </span>

                  {info.error_message && (
                    <span className="text-xs text-destructive">
                      {info.error_message}
                    </span>
                  )}

                  {info.updated_at && (
                    <span className="text-xs text-muted-foreground">
                      {t.status.lastUpdate}: {isoTimeAgo(info.updated_at)}
                    </span>
                  )}
                </div>
              </div>

              <Badge
                variant={display.variant}
                className="shrink-0 self-start sm:self-center"
              >
                {display.variant === "success" && (
                  <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                )}
                {display.label}
              </Badge>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

interface PlatformsCardProps {
  platforms: [string, PlatformStatus][];
  platformStateBadge: Record<
    string,
    { variant: "success" | "warning" | "destructive"; label: string }
  >;
}

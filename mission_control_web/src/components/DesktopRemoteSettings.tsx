import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Loader2, MonitorDown, Wifi } from "lucide-react";

import { api } from "@/lib/api";
import type { TailscaleStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  onOpenInstall: () => void;
  statusOverride?: TailscaleStatus | null;
};

type StatusTone = "muted" | "warning" | "success";

const LOCAL_URL = "http://127.0.0.1:9120";
const PUBLIC_URL = "https://app.umbrellacorporation.co";

function isStandalone(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(display-mode: standalone)").matches;
}

function StatusPill({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  const toneClass = {
    muted: "border-foreground/14 bg-foreground/5 text-foreground/65",
    warning: "border-[#ffbd38]/35 bg-[#ffbd38]/10 text-[#ffbd38]",
    success: "border-[#66e5a7]/35 bg-[#66e5a7]/10 text-[#66e5a7]",
  }[tone];
  const dotClass = {
    muted: "bg-foreground/45",
    warning: "bg-[#ffbd38]",
    success: "bg-[#66e5a7]",
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.12em]", toneClass)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} />
      {children}
    </span>
  );
}

function describeTailscale(status: TailscaleStatus | null): { tone: StatusTone; label: string } {
  if (!status || status.installed === false) return { tone: "muted", label: "Not installed" };
  if (status.installed === null) return { tone: "warning", label: status.error_summary || "Status unavailable" };
  if (!status.signed_in) return { tone: "warning", label: "Installed, signed out" };
  return { tone: "success", label: `Connected as ${status.hostname || status.self_name || "Tailnet device"}` };
}

export function DesktopRemoteSettings({ onOpenInstall, statusOverride = null }: Props) {
  const [installedStandalone] = useState(() => isStandalone());
  const [tailscaleStatus, setTailscaleStatus] = useState<TailscaleStatus | null>(statusOverride);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTailscaleStatus(statusOverride);
  }, [statusOverride]);

  const status = useMemo(() => describeTailscale(tailscaleStatus), [tailscaleStatus]);
  const tailnetUrl = tailscaleStatus?.signed_in && tailscaleStatus.hostname ? `http://${tailscaleStatus.hostname}:9120` : null;
  const setupHost = tailscaleStatus?.hostname || "your-mac.tailnet.ts.net";

  const checkStatus = async () => {
    setLoading(true);
    setError("");
    try {
      const next = await api.getTailscaleStatus();
      setTailscaleStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to check Tailscale status.");
      setTailscaleStatus({ installed: null, signed_in: false, version: null, hostname: null, tailscale_ip: null, exit_code: null, error_summary: "Status unavailable" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="flex flex-1 flex-col gap-4">
      <header>
        <h1 className="font-expanded text-xl font-medium text-foreground">Desktop & Remote</h1>
        <p className="mt-1 text-[11px] text-muted-foreground">Install Mission Control locally and reach it securely from trusted devices.</p>
      </header>

      <section className="rounded-2xl border border-border/70 bg-background/40 p-4" data-slice10e="desktop-app">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <h2 className="font-expanded text-base font-medium text-foreground">Desktop App</h2>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Install Mission Control as a desktop app for one-click access from your dock or taskbar.</p>
          </div>
          {installedStandalone ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-[#66e5a7]/35 bg-[#66e5a7]/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[#66e5a7]"><Check className="h-3 w-3" />Installed</span>
          ) : (
            <StatusPill tone="muted">Not installed</StatusPill>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={onOpenInstall} className="inline-flex items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--warm-glow)_45%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_10%,transparent)] px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-[var(--warm-glow)] transition hover:bg-[color-mix(in_srgb,var(--warm-glow)_16%,transparent)]">
            <MonitorDown className="h-3.5 w-3.5" />Install Desktop App
          </button>
          <span className="text-[11px] text-muted-foreground">Best experience: Chrome, Edge, or Safari 17+ on macOS.</span>
        </div>
      </section>

      <section className="rounded-2xl border border-border/70 bg-background/40 p-4" data-slice10e="remote-access">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <h2 className="font-expanded text-base font-medium text-foreground">Remote Access</h2>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Reach Mission Control from outside your local network using Tailscale or the existing public tunnel.</p>
          </div>
          <Wifi className="h-5 w-5 text-[var(--warm-glow)]" />
        </div>

        <div className="mt-4 rounded-xl border border-foreground/10 bg-background/45 p-3">
          <h3 className="text-[10px] uppercase tracking-[0.16em] text-foreground/70">Access URLs</h3>
          <dl className="mt-3 grid gap-2 text-[11px] md:grid-cols-[120px_minmax(0,1fr)]">
            <dt className="text-muted-foreground">Local</dt><dd className="font-mono text-foreground">{LOCAL_URL}</dd>
            <dt className="text-muted-foreground">Public</dt><dd className="font-mono text-foreground">{PUBLIC_URL}</dd>
            <dt className="text-muted-foreground">Tailnet</dt><dd className="font-mono text-foreground">{tailnetUrl ?? "Connect Tailscale to show Tailnet URL"}</dd>
          </dl>
        </div>

        <div className="mt-4 rounded-xl border border-foreground/10 bg-background/45 p-3" data-slice10e="tailscale-setup">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-expanded text-sm font-medium text-foreground">Set up Tailscale</h3>
              {tailscaleStatus?.version && <p className="mt-1 text-[10px] text-muted-foreground">Tailscale {tailscaleStatus.version}{tailscaleStatus.tailscale_ip ? ` · ${tailscaleStatus.tailscale_ip}` : ""}</p>}
            </div>
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
          </div>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-[11px] leading-5 text-muted-foreground">
            <li>Install Tailscale on this Mac. <a href="https://tailscale.com/download" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--warm-glow)] hover:underline">Download Tailscale <ExternalLink className="h-3 w-3" /></a></li>
            <li>Sign in to your Tailscale account.</li>
            <li>Install Tailscale on the devices you want to use to reach Mission Control.</li>
            <li>From a Tailnet-connected device, open <span className="font-mono text-foreground">http://{setupHost}:9120</span></li>
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void checkStatus()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-foreground/80 transition hover:bg-foreground/6 disabled:opacity-55">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}Check status
            </button>
            {error && <span className="text-[11px] text-[#ff8c8c]">{error}</span>}
          </div>
        </div>
      </section>
    </section>
  );
}

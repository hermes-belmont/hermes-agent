import { Download, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { clearDeferredInstallPrompt, getDeferredInstallPrompt, subscribeToInstallPrompt } from "@/lib/installPrompt";
import { getInstallModalState, type InstallModalState } from "@/lib/installModalState";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  stateOverride?: InstallModalState;
};

const copy: Record<InstallModalState, { title: string; primary: string; body: ReactNode }> = {
  native: {
    title: "Install Mission Control",
    primary: "Install",
    body: <p>Get one-click access from your dock or taskbar. Mission Control will open in its own window.</p>,
  },
  safari: {
    title: "Install Mission Control on macOS",
    primary: "Got it",
    body: (
      <ol className="list-decimal space-y-2 pl-5">
        <li>Click the Share button in Safari&apos;s toolbar</li>
        <li>Select “Add to Dock”</li>
        <li>Confirm the app name and click Add</li>
      </ol>
    ),
  },
  unsupported: {
    title: "PWA install not supported",
    primary: "Close",
    body: <p>Your current browser doesn&apos;t support installing Mission Control as a desktop app. Use Chrome or Edge on desktop, or Safari 17+ on macOS.</p>,
  },
  installed: {
    title: "Mission Control is installed",
    primary: "Close",
    body: <p>You&apos;re already running in app mode. Look for Mission Control in your Applications folder or dock.</p>,
  },
};

export function InstallModal({ open, onClose, stateOverride }: Props) {
  const [promptVersion, setPromptVersion] = useState(0);
  useEffect(() => subscribeToInstallPrompt(() => setPromptVersion((value) => value + 1)), []);
  void promptVersion;
  const state = stateOverride ?? getInstallModalState();
  if (!open) return null;

  const content = copy[state];
  const handlePrimary = async () => {
    if (state === "native") {
      const prompt = getDeferredInstallPrompt();
      if (prompt) {
        await prompt.prompt();
        await prompt.userChoice.catch(() => ({ outcome: "dismissed" as const, platform: "" }));
        clearDeferredInstallPrompt();
      }
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/62 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="install-modal-title">
      <div className="w-full max-w-lg rounded-2xl border border-foreground/12 bg-background/95 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--warm-glow)_30%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_12%,transparent)] text-[var(--warm-glow)]">
              <Download className="h-5 w-5" />
            </div>
            <div>
              <h2 id="install-modal-title" className="font-expanded text-base uppercase tracking-[0.12em] text-foreground">{content.title}</h2>
              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">Desktop app install</p>
            </div>
          </div>
          <button type="button" aria-label="Close install modal" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/60 transition hover:bg-foreground/6 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--warm-glow)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className={cn("mt-5 rounded-xl border border-foreground/10 bg-foreground/[0.035] p-4 text-sm leading-6 text-foreground/82", state === "safari" && "text-foreground/86")}>{content.body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={() => void handlePrimary()}>{content.primary}</Button>
        </div>
      </div>
    </div>
  );
}

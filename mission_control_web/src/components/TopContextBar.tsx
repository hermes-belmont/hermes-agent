import { Folder } from "lucide-react";

export function TopContextBar({ healthyLabel = "Healthy", onOpenMobileNav, onOpenAgentDrawer }: { healthyLabel?: string; onOpenMobileNav: () => void; onOpenAgentDrawer: () => void }) {
  return (
    <div className="mb-4 space-y-2">
      <div className="rounded-lg border border-[color-mix(in_srgb,var(--warm-glow)_22%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_7%,transparent)] px-3 py-1.5 text-[9px] uppercase tracking-[0.16em] text-[color-mix(in_srgb,var(--warm-glow)_82%,transparent)]">
        Public preview, no auth
      </div>
      <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onOpenMobileNav} className="flex h-8 w-8 items-center justify-center rounded-lg border border-foreground/12 bg-background/60 text-foreground md:hidden">☰</button>
        <button type="button" onClick={onOpenAgentDrawer} className="flex h-8 items-center justify-center rounded-lg border border-foreground/12 bg-background/60 px-2 text-[10px] uppercase tracking-[0.12em] text-foreground/70 lg:hidden">Agents</button>
        <div className="inline-flex items-center gap-2 rounded-full border border-foreground/12 bg-background/60 px-[11px] py-[5px] text-[11px] lowercase text-foreground/72">
          <Folder className="h-3.5 w-3.5" />
          new session
        </div>
      </div>
      <div className="inline-flex items-center gap-2 rounded-full border border-foreground/12 bg-background/60 px-[11px] py-[5px] text-[11px] text-foreground/75">
        <span className="h-2 w-2 rounded-full bg-[rgb(107,241,153)] shadow-[0_0_12px_rgba(74,222,128,0.45)]" />
        {healthyLabel}
      </div>
      </div>
    </div>
  );
}

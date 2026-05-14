import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { providerKeyForModel } from "@/lib/model-tiers";
import { cn } from "@/lib/utils";

type Props = {
  /**
   * Display list — already padded to exactly {@link RECENTS_CAP} entries by
   * the caller via ``getRecentsPadded()``.
   */
  models: string[];
  activeModel: string;
  /**
   * Sets the active model for the current chat. MUST NOT mutate the recents
   * list — recents only update on send (see {@link promoteOnSend}).
   */
  onSelectModel: (model: string) => void;
  /** Navigate to the Settings → Models page. */
  onOpenSettings: () => void;
};

/**
 * Slim, recents-only chat-chip model picker (Slice 2c). The full catalog now
 * lives in Settings → Models; this dropdown shows the three most-recently
 * used models plus a "More models in Settings →" link.
 */
export function RecentsModelPicker({ models, activeModel, onSelectModel, onOpenSettings }: Props) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"below" | "above">("below");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const display = activeModel || models[0] || "unassigned";

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const dropdownHeight = Math.min(280, window.innerHeight * 0.5);
    setPlacement(rect.bottom + dropdownHeight + 16 > window.innerHeight ? "above" : "below");
  }, [open, models.length]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex justify-center">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--warm-glow)_32%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_8%,transparent)] px-[11px] py-[5px] font-mono text-xs text-[var(--warm-glow)] transition hover:bg-[color-mix(in_srgb,var(--warm-glow)_12%,transparent)]"
      >
        <span>{providerKeyForModel(display)} · {display}</span>
        <ChevronDown className="h-[11px] w-[11px]" />
      </button>
      {open && (
        <div
          className={cn(
            "absolute left-1/2 z-[60] min-w-[280px] -translate-x-1/2 rounded-xl border border-foreground/18 bg-background p-1.5 text-left shadow-[0_16px_48px_rgba(0,0,0,0.4)]",
            placement === "above" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
          )}
        >
          <div className="px-2.5 pb-1 pt-1.5 text-[9px] uppercase tracking-[0.16em] text-foreground/70">Recent</div>
          {models.map((model) => {
            const active = model === activeModel;
            return (
              <button
                key={model}
                type="button"
                onClick={() => {
                  onSelectModel(model);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-[7px] font-mono text-[11px] text-foreground/80 transition hover:bg-foreground/6",
                  active && "bg-[color-mix(in_srgb,var(--warm-glow)_10%,transparent)] text-foreground",
                )}
              >
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">{active && <Check className="h-3.5 w-3.5 text-[var(--warm-glow)]" />}</span>
                <span className="min-w-0 flex-1 truncate">{model}</span>
                {active && <span className="text-[9px] uppercase tracking-[0.08em] text-[color-mix(in_srgb,var(--warm-glow)_80%,transparent)]">Active</span>}
              </button>
            );
          })}
          <div className="my-1 border-t border-foreground/10" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
            className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-[7px] text-[11px] text-[var(--warm-glow)] transition hover:bg-foreground/6"
          >
            <span>More models in Settings</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

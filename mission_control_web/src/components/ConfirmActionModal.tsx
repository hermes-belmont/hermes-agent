import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { canConfirmAction, type RiskLevel } from "@/lib/confirm-action";

export function ConfirmActionModal({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  riskLevel,
  requirePhrase,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  riskLevel: RiskLevel;
  requirePhrase?: string;
}) {
  const [typedPhrase, setTypedPhrase] = useState("");
  const [inFlight, setInFlight] = useState(false);
  const highRisk = riskLevel === "high";
  const canConfirm = useMemo(() => canConfirmAction({ riskLevel, requirePhrase, typedPhrase }), [riskLevel, requirePhrase, typedPhrase]);

  useEffect(() => {
    if (!open || highRisk || inFlight) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [highRisk, inFlight, onClose, open]);

  if (!open) return null;

  const closeIfAllowed = () => {
    if (!inFlight && !highRisk) onClose();
  };

  const confirmClasses = riskLevel === "low"
    ? "border-[color:var(--warm-glow)] bg-[color:var(--warm-glow)]/20 text-[color:var(--warm-glow)] hover:bg-[color:var(--warm-glow)]/28"
    : riskLevel === "medium"
      ? "border-[#ffbd38]/60 bg-[#ffbd38]/18 text-[#ffbd38] hover:bg-[#ffbd38]/25"
      : "border-red-500/70 bg-red-500/18 text-red-300 hover:bg-red-500/25";
  const displayTitle = title.toLocaleUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onMouseDown={closeIfAllowed} role="presentation">
      <div
        className="w-full max-w-lg rounded-[28px] border border-foreground/12 bg-background/95 p-5 text-foreground shadow-[0_24px_90px_rgba(0,0,0,0.45)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-action-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-action-title" className="text-left text-[10px] uppercase tracking-[0.24em] text-foreground/70">{displayTitle}</h2>
        <div className="mt-4 text-sm leading-6 text-foreground/78">{body}</div>
        {requirePhrase ? (
          <label className="mt-5 block text-xs text-foreground/70">
            Type <span className="font-mono text-foreground">{requirePhrase}</span> to confirm.
            <input
              className="mt-2 w-full rounded-2xl border border-foreground/12 bg-foreground/5 px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-red-400/60"
              value={typedPhrase}
              onChange={(event) => setTypedPhrase(event.target.value)}
              disabled={inFlight}
              autoFocus
            />
          </label>
        ) : null}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={inFlight} className="rounded-full border border-foreground/15 px-4 py-2 text-xs uppercase tracking-[0.16em] text-foreground/75 disabled:opacity-45">
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!canConfirm || inFlight) return;
              setInFlight(true);
              try {
                await onConfirm();
              } finally {
                setInFlight(false);
                setTypedPhrase("");
              }
            }}
            disabled={!canConfirm || inFlight}
            className={cn("inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs uppercase tracking-[0.16em] disabled:cursor-not-allowed disabled:opacity-45", confirmClasses)}
          >
            {inFlight ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

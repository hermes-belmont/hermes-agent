import { useState } from "react";
import { Wrench } from "lucide-react";
import type { InlineToolEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen((current) => !current)} className="text-[9px] uppercase tracking-[0.14em] text-[color-mix(in_srgb,var(--warm-glow)_75%,transparent)] hover:text-[var(--warm-glow)]">
        {open ? "Hide" : "Show"} {label}
      </button>
      {open && <pre className="mt-1 max-h-44 overflow-auto rounded-xl bg-background p-2 text-[10px] leading-4 text-foreground/72">{JSON.stringify(value, null, 2)}</pre>}
    </div>
  );
}

export function InlineToolChip({ tool }: { tool: InlineToolEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em] transition-colors",
          tool.status === "error"
            ? "border-[rgba(251,44,54,0.35)] bg-[rgba(251,44,54,0.08)] text-[rgb(255,180,184)]"
            : tool.status === "done"
              ? "border-[rgba(107,241,153,0.22)] bg-[rgba(107,241,153,0.07)] text-[rgba(107,241,153,0.82)]"
              : "border-[color-mix(in_srgb,var(--warm-glow)_22%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_7%,transparent)] text-[var(--warm-glow)]",
        )}
      >
        <Wrench className="h-3 w-3" />
        {tool.name}
        <span className="text-current/65">{tool.status}</span>
      </button>
      {open && (
        <div className="mt-2 rounded-2xl border border-foreground/10 bg-background/72 p-3 text-[11px] text-foreground/72">
          <div className="font-mono text-foreground">{tool.name}</div>
          {typeof tool.duration_ms === "number" && <div className="mt-1 text-foreground/70">Duration: {tool.duration_ms}ms</div>}
          {tool.error && <div className="mt-2 text-[rgb(255,180,184)]">{tool.error}</div>}
          <JsonBlock label="input" value={tool.input} />
          <JsonBlock label="output" value={tool.output} />
        </div>
      )}
    </div>
  );
}

export function ToolEmptyState() {
  return <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-foreground/35">No tools used</div>;
}

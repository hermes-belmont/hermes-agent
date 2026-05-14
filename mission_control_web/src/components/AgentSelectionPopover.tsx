import { Bot, Terminal } from "lucide-react";
import type { AgentRecord } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";

type Props = {
  open: boolean;
  agents: AgentRecord[];
  onSelectAgent: (agent: AgentRecord) => void;
  onSelectHermesDirect: () => void;
};

export function AgentSelectionPopover({ open, agents, onSelectAgent, onSelectHermesDirect }: Props) {
  if (!open) return null;
  const recent = [...agents].sort((a, b) => (b.last_active_at ?? b.updated_at ?? "").localeCompare(a.last_active_at ?? a.updated_at ?? "")).slice(0, 3);
  return (
    <div className="absolute bottom-[calc(100%+10px)] left-0 right-0 z-40 mx-auto max-h-[320px] max-w-3xl overflow-y-auto rounded-xl border border-foreground/18 bg-background p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.4)]">
      <div className="px-2.5 pb-1 pt-2 text-[9px] uppercase tracking-[0.16em] text-foreground/70">ROUTE THIS MESSAGE TO</div>
      {recent.length > 0 && <Section label="Recent agents" agents={recent} onSelectAgent={onSelectAgent} />}
      <Section label="All agents" agents={agents} onSelectAgent={onSelectAgent} />
      <div className="my-1 border-t border-foreground/8" />
      <button type="button" onClick={onSelectHermesDirect} className="flex w-full items-start gap-3 rounded-lg border border-[color-mix(in_srgb,var(--warm-glow)_18%,transparent)] bg-[color-mix(in_srgb,var(--warm-glow)_6%,transparent)] px-2.5 py-2.5 text-left hover:bg-[color-mix(in_srgb,var(--warm-glow)_10%,transparent)]">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--warm-glow)_12%,transparent)] text-[var(--warm-glow)]"><Terminal className="h-4 w-4" /></div>
        <div className="min-w-0">
          <div className="text-xs text-foreground">Chat with Hermes (direct)</div>
          <div className="mt-1 text-[11px] leading-4 text-foreground/52">Route to the build agent without choosing a custom operator.</div>
        </div>
      </button>
    </div>
  );
}

function Section({ label, agents, onSelectAgent }: { label: string; agents: AgentRecord[]; onSelectAgent: (agent: AgentRecord) => void }) {
  return (
    <div>
      <div className="px-2.5 pb-1 pt-2 text-[9px] uppercase tracking-[0.16em] text-foreground/70">{label}</div>
      {agents.map((agent) => (
        <button key={`${label}-${agent.id}`} type="button" onClick={() => onSelectAgent(agent)} className={cn("flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-foreground/6")}>
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground/8 text-foreground/70"><Bot className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-xs text-foreground">{agent.name}</span>
              <span className="shrink-0 rounded-full border border-foreground/12 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-foreground/70">{agent.business_function || "Customs"}</span>
            </div>
            <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-foreground/52">{agent.role || agent.operating_entity || `Active ${formatRelativeTime(agent.last_active_at ?? agent.updated_at)}`}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

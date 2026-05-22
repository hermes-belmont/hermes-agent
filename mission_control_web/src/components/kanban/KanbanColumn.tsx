import { useDroppable } from "@dnd-kit/core";
import type { KanbanStatus, KanbanTask } from "@/lib/types";
import { cn } from "@/lib/utils";
import { KanbanTaskCard } from "@/components/kanban/KanbanTaskCard";
import { formatStatus, KANBAN_STATUS_TONE } from "@/components/kanban/kanban-style";

export function KanbanColumn({ status, tasks, onOpenTask }: { status: KanbanStatus; tasks: KanbanTask[]; onOpenTask: (task: KanbanTask) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section ref={setNodeRef} className={cn("flex min-h-[360px] min-w-[260px] flex-col rounded-[24px] border bg-foreground/[0.025] p-3 transition", KANBAN_STATUS_TONE[status], isOver && "ring-2 ring-[var(--warm-glow)]/60")}>
      <header className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground">{formatStatus(status)}</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">{tasks.length} task{tasks.length === 1 ? "" : "s"}</p>
        </div>
        <span className="rounded-full border border-foreground/10 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground">{tasks.length}</span>
      </header>
      <div className="flex flex-1 flex-col gap-3">
        {tasks.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-foreground/10 p-6 text-center text-xs text-muted-foreground">Drop tasks here</div>
        ) : tasks.map((task) => <KanbanTaskCard key={task.id} task={task} onOpen={onOpenTask} />)}
      </div>
    </section>
  );
}

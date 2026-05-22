import { useDraggable } from "@dnd-kit/core";
import { GripVertical, UserRound } from "lucide-react";
import type { KanbanTask } from "@/lib/types";
import { cn } from "@/lib/utils";
import { priorityLabel, priorityTone } from "@/components/kanban/kanban-style";

export function KanbanTaskCard({ task, onOpen }: { task: KanbanTask; onOpen: (task: KanbanTask) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <article
      ref={setNodeRef}
      style={style}
      className={cn("group rounded-2xl border border-foreground/10 bg-background/88 p-3 shadow-sm transition hover:border-[var(--warm-glow)]/35", isDragging && "z-50 opacity-70 shadow-2xl")}
    >
      <div className="flex items-start gap-2">
        <button type="button" className="mt-0.5 cursor-grab text-muted-foreground active:cursor-grabbing" aria-label="Drag task" {...attributes} {...listeners}>
          <GripVertical className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => onOpen(task)} className="min-w-0 flex-1 text-left">
          <h3 className="truncate text-sm font-semibold text-foreground" title={task.title}>{task.title}</h3>
          {task.body ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{task.body}</p> : null}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 pl-6">
        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]", priorityTone(task.priority))}>{priorityLabel(task.priority)}</span>
        {task.assignee ? <span className="inline-flex items-center gap-1 rounded-full border border-foreground/10 bg-foreground/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.10em] text-muted-foreground"><UserRound className="h-3 w-3" />{task.assignee}</span> : null}
      </div>
    </article>
  );
}

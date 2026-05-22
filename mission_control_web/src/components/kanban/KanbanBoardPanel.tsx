import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Plus, RefreshCw } from "lucide-react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { KanbanBoard, KanbanStatus, KanbanTask } from "@/lib/types";
import { KanbanColumn } from "@/components/kanban/KanbanColumn";
import { KanbanTaskCreateModal } from "@/components/kanban/KanbanTaskCreateModal";
import { KanbanTaskDrawer } from "@/components/kanban/KanbanTaskDrawer";
import { KANBAN_STATUSES } from "@/components/kanban/kanban-style";

function normaliseBoard(board: KanbanBoard): KanbanBoard {
  const byStatus = new Map(board.columns.map((column) => [column.status, column.tasks]));
  return {
    ...board,
    columns: KANBAN_STATUSES.map((status) => {
      const tasks = byStatus.get(status) ?? [];
      return { id: status, name: status, status, tasks, taskIds: tasks.map((task) => task.id) };
    }),
  };
}

function moveTask(board: KanbanBoard, taskId: string, status: KanbanStatus): KanbanBoard {
  let moving: KanbanTask | null = null;
  const stripped = board.columns.map((column) => {
    const tasks = column.tasks.filter((task) => {
      if (task.id === taskId) { moving = { ...task, status }; return false; }
      return true;
    });
    return { ...column, tasks, taskIds: tasks.map((task) => task.id) };
  });
  if (!moving) return board;
  return { ...board, columns: stripped.map((column) => column.status === status ? { ...column, tasks: [moving as KanbanTask, ...column.tasks], taskIds: [taskId, ...column.taskIds] } : column) };
}

export function KanbanBoardPanel() {
  const [board, setBoard] = useState<KanbanBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<KanbanTask | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setBoard(normaliseBoard(await api.getKanbanBoard("default")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Kanban board");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const taskById = useMemo(() => {
    const map = new Map<string, KanbanTask>();
    board?.columns.forEach((column) => column.tasks.forEach((task) => map.set(task.id, task)));
    return map;
  }, [board]);

  const onDragEnd = async (event: DragEndEvent) => {
    const taskId = String(event.active.id);
    const newStatus = event.over?.id as KanbanStatus | undefined;
    if (!board || !newStatus || !KANBAN_STATUSES.includes(newStatus)) return;
    const task = taskById.get(taskId);
    if (!task || task.status === newStatus) return;
    const previous = board;
    setBoard(moveTask(board, taskId, newStatus));
    try {
      const updated = await api.updateKanbanTask(taskId, { status: newStatus });
      setBoard((current) => current ? moveTask(current, updated.id, updated.status) : current);
    } catch (err) {
      setBoard(previous);
      setError(err instanceof Error ? err.message : "Failed to move task");
    }
  };

  const onCreated = (task: KanbanTask) => {
    setBoard((current) => current ? normaliseBoard(moveTask(current, task.id, task.status)) : current);
    void load();
  };
  const onSaved = (task: KanbanTask) => { setBoard((current) => current ? moveTask(current, task.id, task.status) : current); void load(); };
  const onDeleted = (taskId: string) => { setBoard((current) => current ? { ...current, columns: current.columns.map((column) => ({ ...column, tasks: column.tasks.filter((task) => task.id !== taskId), taskIds: column.taskIds.filter((id) => id !== taskId) })) } : current); };

  if (loading) return <div className="flex min-h-[360px] items-center justify-center rounded-[28px] border border-foreground/10"><Loader2 className="mr-2 h-5 w-5 animate-spin text-[var(--warm-glow)]" />Loading Kanban board...</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--warm-glow)]">Default board</p>
          <h2 className="mt-2 font-expanded text-2xl uppercase tracking-[0.08em]">Board</h2>
          <p className="mt-1 text-sm text-muted-foreground">Native Kanban task management powered by /api/plugins/kanban.</p>
        </div>
        <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" />Retry</Button><Button type="button" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" />New Task</Button></div>
      </div>
      {error ? <div className="flex items-center gap-2 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100"><AlertCircle className="h-4 w-4" />{error}</div> : null}
      <DndContext onDragEnd={onDragEnd}>
        <div className="grid gap-3 overflow-x-auto pb-2 lg:grid-cols-4 xl:grid-cols-8">
          {(board?.columns ?? []).map((column) => <KanbanColumn key={column.status} status={column.status} tasks={column.tasks} onOpenTask={setSelectedTask} />)}
        </div>
      </DndContext>
      <KanbanTaskCreateModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={onCreated} />
      <KanbanTaskDrawer task={selectedTask} open={Boolean(selectedTask)} onClose={() => setSelectedTask(null)} onSaved={onSaved} onDeleted={onDeleted} />
    </div>
  );
}

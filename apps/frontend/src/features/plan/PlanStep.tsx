import { useEffect, useState } from "react";
import type { ApiClient, Plan, ScheduleBlock, Task } from "../../api/client.js";
import { BlockEditor } from "./BlockEditor.js";
import { useUndoHistory } from "./useUndoHistory.js";
import { WeekTimeline } from "./WeekTimeline.js";

type PlanStepProps = {
  plan: Plan;
  tasks: readonly Task[];
  api: Pick<ApiClient, "patchScheduleBlock" | "exportPlanIcs" | "splitScheduleBlock" | "mergeScheduleBlock">;
  onTasksChanged?: (tasks: readonly Task[]) => void;
};

function toUtc(value: string): string { return new Date(value).toISOString(); }

export function PlanStep({ plan, tasks, api, onTasksChanged = () => undefined }: PlanStepProps) {
  const [currentPlan, setCurrentPlan] = useState(plan);
  const [currentTasks, setCurrentTasks] = useState<readonly Task[]>(tasks);
  const [selected, setSelected] = useState<ScheduleBlock | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  useEffect(() => setCurrentPlan(plan), [plan]);
  useEffect(() => setCurrentTasks(tasks), [tasks]);

  const history = useUndoHistory();
  useEffect(() => { history.clear(); }, [currentPlan.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) void history.redo();
      else void history.undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [history]);

  const updateBlock = (block: ScheduleBlock, task?: Task) => {
    setCurrentPlan((current) => ({ ...current, blocks: current.blocks.map((item) => item.id === block.id ? block : item) }));
    if (task) setCurrentTasks((current) => {
      const next = current.map((item) => item.id === task.id ? task : item);
      onTasksChanged(next);
      return next;
    });
    setSelected((current) => current?.id === block.id ? block : current);
  };
  const updateBlocks = (blocks: ScheduleBlock[]) => {
    setCurrentPlan((current) => ({ ...current, blocks }));
    setSelected(null);
  };

  const move = async (block: ScheduleBlock, start: string, end: string): Promise<boolean> => {
    setError(""); setMessage("");
    try {
      const response = await api.patchScheduleBlock(block.id, { startAt: toUtc(start), endAt: toUtc(end) });
      history.push({
        label: "移动",
        undo: async () => { const r = await api.patchScheduleBlock(block.id, { startAt: block.startAt, endAt: block.endAt }); updateBlock(r.block); },
        redo: async () => { const r = await api.patchScheduleBlock(block.id, { startAt: response.block.startAt, endAt: response.block.endAt }); updateBlock(r.block); },
      });
      updateBlock(response.block);
      return true;
    } catch (reason) {
      const failure = reason as Error & { code?: string; details?: { conflictingBlockId?: string } };
      const conflictId = failure.details?.conflictingBlockId;
      const conflicting = conflictId ? currentPlan.blocks.find((item) => item.id === conflictId) : undefined;
      const conflictingTask = conflicting ? currentTasks.find((task) => task.id === conflicting.taskId) : undefined;
      setError(conflictingTask ? `与 ${conflictingTask.title} 冲突：${failure.message}` : failure.message);
      return false;
    }
  };
  const lock = async (block: ScheduleBlock) => {
    setError("");
    try {
      const response = await api.patchScheduleBlock(block.id, { locked: !block.locked });
      history.push({
        label: "锁定",
        undo: async () => { const r = await api.patchScheduleBlock(block.id, { locked: block.locked }); updateBlock(r.block); },
        redo: async () => { const r = await api.patchScheduleBlock(block.id, { locked: !block.locked }); updateBlock(r.block); },
      });
      updateBlock(response.block);
    } catch (reason) { setError((reason as Error).message); }
  };
  const setStatus = async (block: ScheduleBlock, status: ScheduleBlock["status"]) => {
    setError("");
    try {
      const prevStatus = block.status;
      const response = await api.patchScheduleBlock(block.id, { status });
      history.push({
        label: "状态",
        undo: async () => { const r = await api.patchScheduleBlock(block.id, { status: prevStatus }); updateBlock(r.block); },
        redo: async () => { const r = await api.patchScheduleBlock(block.id, { status }); updateBlock(r.block); },
      });
      updateBlock(response.block);
    } catch (reason) { setError((reason as Error).message); }
  };
  const complete = async (block: ScheduleBlock) => {
    setSaving(true); setError("");
    try {
      const prevStatus = block.status;
      const response = await api.patchScheduleBlock(block.id, { completedMinutes: 60 });
      history.push({
        label: "完成",
        undo: async () => { const r = await api.patchScheduleBlock(block.id, { status: prevStatus }); updateBlock(r.block); },
        redo: async () => { const r = await api.patchScheduleBlock(block.id, { completedMinutes: 60 }); updateBlock(r.block, r.task); },
      });
      updateBlock(response.block, response.task);
      const progress = response.progress;
      setMessage(progress ? `已记录 ${progress.appliedMinutes} 分钟${progress.overflowMinutes > 0 ? `；超出 ${progress.overflowMinutes} 分钟将保留为待处理` : ""}` : "已更新进度");
    } catch (reason) { setError((reason as Error).message); } finally { setSaving(false); }
  };
  const split = async (block: ScheduleBlock) => {
    setError("");
    try {
      const response = await api.splitScheduleBlock(block.id);
      const [left, right] = response.blocks;
      history.push({
        label: "拆分",
        undo: async () => { const r = await api.mergeScheduleBlock(left.id, "next"); updateBlocks([...currentPlan.blocks.filter((b) => b.id !== left.id && b.id !== right.id), r.block]); },
        redo: async () => { const r = await api.splitScheduleBlock(block.id, right.startAt); updateBlocks([...currentPlan.blocks.filter((b) => b.id !== block.id), ...r.blocks]); },
      });
      updateBlocks([...currentPlan.blocks.filter((item) => item.id !== block.id), ...response.blocks]);
      setMessage("已拆分该时间块");
    } catch (reason) { setError((reason as Error).message); }
  };
  const merge = async (block: ScheduleBlock) => {
    setError("");
    try {
      const response = await api.mergeScheduleBlock(block.id);
      const merged = response.block;
      const boundary = block.endAt;
      const removed = currentPlan.blocks.find((b) => b.startAt === block.endAt && b.taskId === block.taskId) ?? currentPlan.blocks.find((b) => b.endAt === block.startAt && b.taskId === block.taskId);
      history.push({
        label: "合并",
        undo: async () => { const r = await api.splitScheduleBlock(merged.id, boundary); updateBlocks([...currentPlan.blocks.filter((b) => b.id !== merged.id), ...r.blocks]); },
        redo: async () => { const r = await api.mergeScheduleBlock(block.id); updateBlocks([...currentPlan.blocks.filter((b) => b.id !== removed?.id), r.block]); },
      });
      const next = currentPlan.blocks.filter((item) => item.id !== block.id && item.id !== removed?.id);
      updateBlocks([...next, merged]);
      setMessage("已合并相邻时间块");
    } catch (reason) { setError((reason as Error).message); }
  };
  const exportIcs = async () => {
    setExporting(true); setError("");
    try {
      const { blob, filename } = await api.exportPlanIcs(currentPlan.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = filename; anchor.click();
      URL.revokeObjectURL(url);
      setMessage(`已下载 ${filename}`);
    } catch (reason) { setError((reason as Error).message); } finally { setExporting(false); }
  };

  const selectedTask = selected ? currentTasks.find((task) => task.id === selected.taskId) : undefined;
  const adjacentSameTask = selected
    ? currentPlan.blocks.find((block) => block.id !== selected.id && block.taskId === selected.taskId && (block.startAt === selected.endAt || block.endAt === selected.startAt))
    : undefined;

  return (
    <section className="plan-step panel" aria-labelledby="plan-title">
      <p className="section-label">Step 04 / Plan</p>
      <div className="plan-step__heading">
        <div><h2 id="plan-title">本周执行计划</h2><p>点击时间块查看操作；方向键微调时间，拖拽移动到新时段。</p></div>
        <div className="plan-step__tools">
          <button type="button" disabled={!history.canUndo} onClick={() => void history.undo()}>撤销</button>
          <button type="button" disabled={!history.canRedo} onClick={() => void history.redo()}>重做</button>
          <button type="button" className="entry-submit" disabled={exporting} onClick={() => void exportIcs()}>{exporting ? "导出中…" : "导出 ICS"}</button>
        </div>
      </div>
      {currentPlan.unscheduledMinutes > 0 && <aside className="plan-warning">仍有 {currentPlan.unscheduledMinutes} 分钟未排入计划，请优先调整可用时间或缩小任务范围。</aside>}
      {message && <p className="plan-message" role="status">{message}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <WeekTimeline blocks={currentPlan.blocks} tasks={currentTasks} selectedId={selected?.id ?? null} onSelect={setSelected} onMove={move} />
      {selected && (
        <BlockEditor
          block={selected}
          task={selectedTask}
          canSplit={Boolean(selectedTask?.splittable) && (new Date(selected.endAt).getTime() - new Date(selected.startAt).getTime()) / 60_000 >= (selectedTask?.minimumBlockMinutes ?? 30) * 2}
          canMerge={Boolean(adjacentSameTask)}
          saving={saving}
          onMove={move}
          onLock={lock}
          onSetStatus={setStatus}
          onComplete={complete}
          onSplit={split}
          onMerge={merge}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
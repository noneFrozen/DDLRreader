import { useEffect, useState } from "react";
import type { ApiClient, Plan, ScheduleBlock, Task } from "../../api/client.js";
import { ProgressDialog } from "./ProgressDialog.js";
import { WeekTimeline } from "./WeekTimeline.js";

type PlanStepProps = {
  plan: Plan;
  tasks: readonly Task[];
  api: Pick<ApiClient, "patchScheduleBlock" | "exportPlanIcs">;
  onTasksChanged?: (tasks: readonly Task[]) => void;
};

function toUtc(value: string): string { return new Date(value).toISOString(); }

export function PlanStep({ plan, tasks, api, onTasksChanged = () => undefined }: PlanStepProps) {
  const [currentPlan, setCurrentPlan] = useState(plan);
  const [currentTasks, setCurrentTasks] = useState<readonly Task[]>(tasks);
  const [selected, setSelected] = useState<ScheduleBlock | null>(null);
  const [progressSaving, setProgressSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  useEffect(() => setCurrentPlan(plan), [plan]);
  useEffect(() => setCurrentTasks(tasks), [tasks]);

  const updateBlock = (block: ScheduleBlock, task?: Task) => {
    setCurrentPlan((current) => ({ ...current, blocks: current.blocks.map((item) => item.id === block.id ? block : item) }));
    if (task) setCurrentTasks((current) => {
      const next = current.map((item) => item.id === task.id ? task : item); onTasksChanged(next); return next;
    });
    setSelected((current) => current?.id === block.id ? block : current);
  };
  const lock = async (block: ScheduleBlock) => {
    setError("");
    try { const response = await api.patchScheduleBlock(block.id, { locked: !block.locked }); updateBlock(response.block); } catch (reason) { setError((reason as Error).message); }
  };
  const move = async (block: ScheduleBlock, start: string, end: string): Promise<boolean> => {
    setError(""); setMessage("");
    try { const response = await api.patchScheduleBlock(block.id, { startAt: toUtc(start), endAt: toUtc(end) }); updateBlock(response.block); return true; } catch (reason) {
      const failure = reason as Error & { code?: string; details?: { conflictingBlockId?: string } };
      const conflictId = failure.details?.conflictingBlockId;
      const conflicting = conflictId ? currentPlan.blocks.find((item) => item.id === conflictId) : undefined;
      const conflictingTask = conflicting ? currentTasks.find((task) => task.id === conflicting.taskId) : undefined;
      setError(conflictingTask ? `与 ${conflictingTask.title} 冲突：${failure.message}` : failure.message);
      return false;
    }
  };
  const complete = async () => {
    if (!selected) return;
    setProgressSaving(true); setError("");
    try {
      const response = await api.patchScheduleBlock(selected.id, { completedMinutes: 60 });
      updateBlock(response.block, response.task);
      const progress = response.progress;
      setMessage(progress ? `已记录 ${progress.appliedMinutes} 分钟${progress.overflowMinutes > 0 ? `；超出 ${progress.overflowMinutes} 分钟将保留为待处理` : ""}` : "已更新进度");
    } catch (reason) { setError((reason as Error).message); } finally { setProgressSaving(false); }
  };
  const exportIcs = async () => {
    setExporting(true); setError("");
    try {
      const { blob, filename } = await api.exportPlanIcs(currentPlan.id);
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
      setMessage(`已下载 ${filename}`);
    } catch (reason) { setError((reason as Error).message); } finally { setExporting(false); }
  };

  return <section className="plan-step panel" aria-labelledby="plan-title"><p className="section-label">Step 04 / Plan</p><div className="plan-step__heading"><div><h2 id="plan-title">本周执行计划</h2><p>按日期安排，使用键盘即可移动或更新时间块。</p></div><button type="button" className="entry-submit" disabled={exporting} onClick={() => void exportIcs()}>{exporting ? "导出中…" : "导出 ICS"}</button></div>
    {currentPlan.unscheduledMinutes > 0 && <aside className="plan-warning">仍有 {currentPlan.unscheduledMinutes} 分钟未排入计划，请优先调整可用时间或缩小任务范围。</aside>}
    {message && <p className="plan-message" role="status">{message}</p>}{error && <p className="field-error" role="alert">{error}</p>}
    <WeekTimeline blocks={currentPlan.blocks} tasks={currentTasks} onSelect={setSelected} onLock={(block) => void lock(block)} onMove={move} />
    {selected && <ProgressDialog block={selected} task={currentTasks.find((task) => task.id === selected.taskId)} saving={progressSaving} onClose={() => setSelected(null)} onComplete={() => void complete()} />}
  </section>;
}

import type { ScheduleBlock, Task } from "../../api/client.js";

type ProgressDialogProps = {
  block: ScheduleBlock;
  task: Task | undefined;
  saving: boolean;
  onClose: () => void;
  onComplete: () => void;
};

export function ProgressDialog({ block, task, saving, onClose, onComplete }: ProgressDialogProps) {
  return <section className="confirm-dialog" aria-labelledby="progress-dialog-title">
    <h3 id="progress-dialog-title">更新进度</h3>
    <p>{task?.title ?? block.taskId} · 本时间块已安排 {Math.round((new Date(block.endAt).getTime() - new Date(block.startAt).getTime()) / 60000)} 分钟。</p>
    <div><button type="button" onClick={onClose}>取消</button><button type="button" className="entry-submit" disabled={saving} onClick={onComplete}>{saving ? "记录中…" : "完成 60 分钟"}</button></div>
  </section>;
}

import { useEffect, useState } from "react";
import type { ScheduleBlock, Task } from "../../api/client.js";

const statusLabels = { planned: "已计划", started: "进行中", completed: "已完成", skipped: "已跳过" } as const;

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type BlockEditorProps = {
  block: ScheduleBlock;
  task: Task | undefined;
  canSplit: boolean;
  canMerge: boolean;
  saving: boolean;
  onMove: (block: ScheduleBlock, startAt: string, endAt: string) => Promise<boolean>;
  onLock: (block: ScheduleBlock) => Promise<void>;
  onSetStatus: (block: ScheduleBlock, status: ScheduleBlock["status"]) => Promise<void>;
  onComplete: (block: ScheduleBlock) => Promise<void>;
  onSplit: (block: ScheduleBlock) => Promise<void>;
  onMerge: (block: ScheduleBlock) => Promise<void>;
  onClose: () => void;
};

export function BlockEditor(props: BlockEditorProps) {
  const { block, task, canSplit, canMerge, saving, onMove, onLock, onSetStatus, onComplete, onSplit, onMerge, onClose } = props;
  const [draft, setDraft] = useState({ startAt: toLocalInput(block.startAt), endAt: toLocalInput(block.endAt) });
  useEffect(() => setDraft({ startAt: toLocalInput(block.startAt), endAt: toLocalInput(block.endAt) }), [block]);
  const title = task?.title ?? block.taskId;

  return (
    <section className="block-editor confirm-dialog" aria-labelledby="block-editor-title">
      <h3 id="block-editor-title">编辑：{title}</h3>
      <p>{statusLabels[block.status]} · {block.locked ? "已锁定" : "未锁定"}</p>
      <div className="block-editor__status">
        {block.status !== "started" && block.status !== "completed" && block.status !== "skipped" && (
          <button type="button" onClick={() => void onSetStatus(block, "started")}>开始</button>
        )}
        {block.status !== "completed" && (
          <button type="button" disabled={saving} onClick={() => void onComplete(block)}>完成 60 分钟</button>
        )}
        {block.status === "planned" && <button type="button" onClick={() => void onSetStatus(block, "skipped")}>跳过</button>}
        {block.status === "skipped" && <button type="button" onClick={() => void onSetStatus(block, "planned")}>恢复</button>}
        <button type="button" onClick={() => void onLock(block)}>{block.locked ? "解锁" : "锁定"}</button>
      </div>
      <fieldset className="block-editor__move">
        <legend>移动时间</legend>
        <label>开始时间<input type="datetime-local" value={draft.startAt} onChange={(event) => setDraft((current) => ({ ...current, startAt: event.target.value }))} /></label>
        <label>结束时间<input type="datetime-local" value={draft.endAt} onChange={(event) => setDraft((current) => ({ ...current, endAt: event.target.value }))} /></label>
        <button type="button" onClick={() => void onMove(block, draft.startAt, draft.endAt).then((moved) => { if (!moved) setDraft({ startAt: toLocalInput(block.startAt), endAt: toLocalInput(block.endAt) }); })}>移动</button>
      </fieldset>
      <div className="block-editor__actions">
        {canSplit && <button type="button" onClick={() => void onSplit(block)}>拆分</button>}
        {canMerge && <button type="button" onClick={() => void onMerge(block)}>合并相邻</button>}
        <button type="button" onClick={onClose}>关闭</button>
      </div>
    </section>
  );
}
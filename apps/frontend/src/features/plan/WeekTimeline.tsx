import { useEffect, useMemo, useState } from "react";
import type { ScheduleBlock, Task } from "../../api/client.js";

type WeekTimelineProps = {
  blocks: readonly ScheduleBlock[];
  tasks: readonly Task[];
  onSelect: (block: ScheduleBlock) => void;
  onLock: (block: ScheduleBlock) => void;
  onMove: (block: ScheduleBlock, startAt: string, endAt: string) => Promise<boolean>;
};

const statusLabels = { planned: "已计划", started: "进行中", completed: "已完成", skipped: "已跳过" } as const;

function inputDateTime(iso: string): string {
  const date = new Date(iso); const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function labelTime(iso: string): string { return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }); }
function dayHeading(iso: string): string { return new Date(iso).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" }); }

export function WeekTimeline({ blocks, tasks, onSelect, onLock, onMove }: WeekTimelineProps) {
  const [drafts, setDrafts] = useState<Record<string, { startAt: string; endAt: string }>>({});
  useEffect(() => setDrafts(Object.fromEntries(blocks.map((block) => [block.id, { startAt: inputDateTime(block.startAt), endAt: inputDateTime(block.endAt) }]))), [blocks]);
  const taskMap = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const days = useMemo(() => Object.entries(blocks.reduce<Record<string, ScheduleBlock[]>>((grouped, block) => {
    const day = dayHeading(block.startAt); (grouped[day] ??= []).push(block); return grouped;
  }, {})), [blocks]);
  const draftFor = (block: ScheduleBlock) => drafts[block.id] ?? { startAt: inputDateTime(block.startAt), endAt: inputDateTime(block.endAt) };
  const changeDraft = (blockId: string, field: "startAt" | "endAt", value: string) => setDrafts((current) => ({ ...current, [blockId]: { ...current[blockId], [field]: value } }));

  return <div className="week-timeline">{days.map(([day, dayBlocks]) => <section className="week-timeline__day" key={day}><h3>{day}</h3>{dayBlocks.map((block) => {
    const task = taskMap.get(block.taskId); const draft = draftFor(block); const title = task?.title ?? block.taskId;
    const state = `${statusLabels[block.status]}，${block.locked ? "已锁定" : "未锁定"}`;
    return <article className="schedule-block" key={block.id}>
      <button type="button" className="schedule-block__summary" aria-label={`${title}，${labelTime(block.startAt)} 至 ${labelTime(block.endAt)}，${state}`} onClick={() => onSelect(block)}><strong>{title}</strong><span>{labelTime(block.startAt)}–{labelTime(block.endAt)} · {state}</span></button>
      <button type="button" className="schedule-block__lock" onClick={() => onLock(block)}>{block.locked ? `解锁 ${title}` : `锁定 ${title}`}</button>
      <fieldset className="schedule-block__move"><legend>移动时间（{title}）</legend><label>开始时间（{title}）<input type="datetime-local" value={draft.startAt} onChange={(event) => changeDraft(block.id, "startAt", event.target.value)} /></label><label>结束时间（{title}）<input type="datetime-local" value={draft.endAt} onChange={(event) => changeDraft(block.id, "endAt", event.target.value)} /></label><button type="button" onClick={() => void onMove(block, draft.startAt, draft.endAt).then((moved) => { if (!moved) setDrafts((current) => ({ ...current, [block.id]: { startAt: inputDateTime(block.startAt), endAt: inputDateTime(block.endAt) } })); })}>移动 {title}</button></fieldset>
    </article>;
  })}</section>)}</div>;
}

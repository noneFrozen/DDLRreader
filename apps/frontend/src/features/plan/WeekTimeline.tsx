import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ScheduleBlock, Task } from "../../api/client.js";

const DAY_START_MINUTES = 6 * 60;
const DAY_END_MINUTES = 24 * 60;
const RANGE_MINUTES = DAY_END_MINUTES - DAY_START_MINUTES;
const TIMELINE_HEIGHT = 720;

const statusLabels = { planned: "已计划", started: "进行中", completed: "已完成", skipped: "已跳过" } as const;

function labelTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function dayHeading(iso: string): string {
  const date = new Date(iso);
  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  return `${date.getMonth() + 1}月${date.getDate()}日${weekdays[date.getDay()]}`;
}
function minutesOfDay(iso: string): number {
  const date = new Date(iso);
  return date.getHours() * 60 + date.getMinutes();
}
function topFor(iso: string): number {
  const minutes = minutesOfDay(iso);
  return ((Math.min(DAY_END_MINUTES, Math.max(DAY_START_MINUTES, minutes)) - DAY_START_MINUTES) / RANGE_MINUTES) * TIMELINE_HEIGHT;
}
function heightFor(startAt: string, endAt: string): number {
  return Math.max(12, ((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000 / RANGE_MINUTES) * TIMELINE_HEIGHT);
}

type WeekTimelineProps = {
  blocks: readonly ScheduleBlock[];
  tasks: readonly Task[];
  selectedId: string | null;
  onSelect: (block: ScheduleBlock) => void;
  onMove: (block: ScheduleBlock, startAt: string, endAt: string) => Promise<boolean>;
};

export function WeekTimeline({ blocks, tasks, selectedId, onSelect, onMove }: WeekTimelineProps) {
  const taskMap = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const days = useMemo(() => Object.entries(
    blocks.reduce<Record<string, ScheduleBlock[]>>((grouped, block) => {
      const day = dayHeading(block.startAt);
      (grouped[day] ??= []).push(block);
      return grouped;
    }, {}),
  ), [blocks]);

  const [drag, setDrag] = useState<{ blockId: string; startY: number; baseStart: number; previewTop: number } | null>(null);
  const dragBlockRef = useRef<ScheduleBlock | null>(null);

  const nudge = (block: ScheduleBlock, deltaMinutes: number) => {
    const start = new Date(block.startAt).getTime() + deltaMinutes * 60_000;
    const duration = new Date(block.endAt).getTime() - new Date(block.startAt).getTime();
    const startIso = new Date(start).toISOString();
    const endIso = new Date(start + duration).toISOString();
    void onMove(block, startIso, endIso);
  };

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, block: ScheduleBlock) => {
    if (block.locked) return;
    const canvas = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const scale = TIMELINE_HEIGHT / canvas.height;
    const pointerY = (event.clientY - canvas.top) * scale;
    if (isNaN(pointerY)) return;
    dragBlockRef.current = block;
    setDrag({ blockId: block.id, startY: pointerY, baseStart: new Date(block.startAt).getTime(), previewTop: topFor(block.startAt) });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || drag.blockId !== event.currentTarget.dataset.blockId) return;
    const canvas = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const scale = TIMELINE_HEIGHT / canvas.height;
    const pointerY = (event.clientY - canvas.top) * scale;
    if (isNaN(pointerY)) return;
    const deltaMinutes = Math.round((pointerY - drag.startY) / (TIMELINE_HEIGHT / RANGE_MINUTES) / 30) * 30;
    setDrag({ ...drag, previewTop: topFor(new Date(drag.baseStart + deltaMinutes * 60_000).toISOString()) });
  };
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || !dragBlockRef.current) return;
    const block = dragBlockRef.current;
    const canvas = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const scale = TIMELINE_HEIGHT / canvas.height;
    const pointerY = (event.clientY - canvas.top) * scale;
    if (isNaN(pointerY)) return;
    const deltaMinutes = Math.round((pointerY - drag.startY) / (TIMELINE_HEIGHT / RANGE_MINUTES) / 30) * 30;
    const duration = new Date(block.endAt).getTime() - new Date(block.startAt).getTime();
    const newStart = new Date(drag.baseStart + deltaMinutes * 60_000).toISOString();
    const newEnd = new Date(drag.baseStart + deltaMinutes * 60_000 + duration).toISOString();
    dragBlockRef.current = null;
    setDrag(null);
    if (deltaMinutes !== 0) void onMove(block, newStart, newEnd);
  };

  return (
    <div className="week-timeline">
      {days.map(([day, dayBlocks]) => (
        <section className="week-timeline__day" key={day}>
          <h3>{day}</h3>
          <div className="week-timeline__canvas" style={{ height: `${TIMELINE_HEIGHT}px` }}>
            {dayBlocks.map((block) => {
              const task = taskMap.get(block.taskId);
              const title = task?.title ?? block.taskId;
              const selected = selectedId === block.id;
              const state = `${statusLabels[block.status]}，${block.locked ? "已锁定" : "未锁定"}`;
              return (
                <button
                  key={block.id}
                  type="button"
                  data-block-id={block.id}
                  className={`week-timeline__block${selected ? " week-timeline__block--selected" : ""}`}
                  style={{ top: `${drag?.blockId === block.id ? drag.previewTop : topFor(block.startAt)}px`, height: `${heightFor(block.startAt, block.endAt)}px` }}
                  aria-label={`${title}，${labelTime(block.startAt)} 至 ${labelTime(block.endAt)}，${state}`}
                  aria-pressed={selected}
                  onClick={() => onSelect(block)}
                  onPointerDown={(event) => startDrag(event, block)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp" && event.shiftKey) { event.preventDefault(); nudge(block, -60); }
                    else if (event.key === "ArrowDown" && event.shiftKey) { event.preventDefault(); nudge(block, 60); }
                    else if (event.key === "ArrowUp") { event.preventDefault(); nudge(block, -30); }
                    else if (event.key === "ArrowDown") { event.preventDefault(); nudge(block, 30); }
                  }}
                >
                  <strong>{title}</strong>
                  <span>{labelTime(block.startAt)}–{labelTime(block.endAt)}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
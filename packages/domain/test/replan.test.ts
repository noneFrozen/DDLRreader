import { expect, it } from "vitest";
import { applyProgress, replan } from "../src/replan.js";
import type { ReplanInput, ScheduleBlock, Task } from "../src/types.js";

const at = (hour: number, minute = 0) => `2026-08-12T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;

function task(id: string, remainingMinutes: number): Task {
  return {
    id,
    courseId: null,
    title: id,
    deadline: at(14),
    remainingMinutes,
    priority: "medium",
    splittable: true,
    minimumBlockMinutes: 30,
    status: "active",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
  };
}

function replanFixture(): ReplanInput {
  const previousBlocks: ScheduleBlock[] = [
    { id: "done", taskId: "history", startAt: at(9), endAt: at(10), status: "completed", locked: false },
    { id: "started", taskId: "started-task", startAt: at(10), endAt: at(10, 30), status: "started", locked: false },
    { id: "locked", taskId: "locked-task", startAt: at(10, 30), endAt: at(11), status: "planned", locked: true },
  ];

  return {
    now: "2026-08-11T00:00:00.000Z",
    rangeEnd: at(15),
    timezone: "Asia/Shanghai",
    bufferRatio: 0,
    tasks: [task("history", 30), task("started-task", 60), task("locked-task", 60)],
    dependencies: [],
    availability: [{ id: "availability", startAt: at(9), endAt: at(12, 30) }],
    frozenBlocks: [],
    previousBlocks,
  };
}

function minutes(block: Pick<ScheduleBlock, "startAt" | "endAt">): number {
  return (new Date(block.endAt).getTime() - new Date(block.startAt).getTime()) / 60_000;
}

function overlaps(left: Pick<ScheduleBlock, "startAt" | "endAt">, right: Pick<ScheduleBlock, "startAt" | "endAt">): boolean {
  return new Date(left.startAt).getTime() < new Date(right.endAt).getTime()
    && new Date(right.startAt).getTime() < new Date(left.endAt).getTime();
}

it("preserves frozen decisions, does not resubtract completed history, and reallocates remaining work", () => {
  const input = replanFixture();
  const result = replan(input);
  const frozen = input.previousBlocks.filter((block) => block.status === "completed" || block.status === "started" || block.locked);
  const generated = result.blocks.filter((block) => !frozen.some((frozenBlock) => frozenBlock.id === block.id));

  expect(result.blocks.filter((block) => ["done", "started", "locked"].includes(block.id))).toEqual(frozen);
  expect(generated.every((block) => frozen.every((frozenBlock) => !overlaps(block, frozenBlock)))).toBe(true);
  expect(generated.filter((block) => block.taskId === "history").reduce((total, block) => total + minutes(block), 0)
    + result.unscheduled.filter((work) => work.taskId === "history").reduce((total, work) => total + work.minutes, 0)).toBe(30);
  expect(generated.filter((block) => block.taskId === "started-task").reduce((total, block) => total + minutes(block), 0)).toBe(30);
  expect(generated.filter((block) => block.taskId === "locked-task").reduce((total, block) => total + minutes(block), 0)).toBe(30);
});

it("caps newly reported progress at the task's current remaining work", () => {
  expect(applyProgress(task("progress", 90), 120)).toEqual({ remainingMinutes: 0, appliedMinutes: 90, overflowMinutes: 30 });
});

it("rejects negative newly reported progress", () => {
  expect(() => applyProgress(task("progress", 90), -30)).toThrow("completedMinutes must be non-negative");
});

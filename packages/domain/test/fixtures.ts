import type { AvailabilityBlock, PlanningInput, Task } from "../src/types.js";

const NOW = "2026-08-11T00:00:00.000Z";
const BLOCK_MS = 30 * 60 * 1000;

export function task(id: string, deadline: string, remainingMinutes: number): Task {
  return {
    id,
    courseId: null,
    title: id,
    deadline,
    remainingMinutes,
    priority: "medium",
    splittable: true,
    minimumBlockMinutes: 30,
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

export function blocksBefore(deadline: string, count: number): AvailabilityBlock[] {
  const deadlineMs = new Date(deadline).getTime();
  return Array.from({ length: count }, (_, index) => {
    const startMs = deadlineMs - (count - index) * BLOCK_MS;
    return {
      id: `block-${index}`,
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(startMs + BLOCK_MS).toISOString(),
    };
  });
}

export function makeInput({
  tasks,
  availability,
  bufferRatio = 0.1,
}: Pick<PlanningInput, "tasks" | "availability"> & { bufferRatio?: number }): PlanningInput {
  return {
    now: NOW,
    rangeEnd: "2026-08-25T00:00:00.000Z",
    timezone: "Asia/Shanghai",
    bufferRatio,
    tasks,
    dependencies: [],
    availability,
    frozenBlocks: [],
  };
}

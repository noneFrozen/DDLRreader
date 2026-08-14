import { describe, expect, it } from "vitest";
import { analyzeConflicts } from "../src/conflict.js";
import { generatePlan } from "../src/planner.js";
import type { AvailabilityBlock, PlanningInput, Task } from "../src/types.js";

const NOW = "2026-08-11T00:00:00.000Z";
const BLOCK_MS = 30 * 60 * 1000;
const DAY_COUNT = 14;
const TASK_COUNT = 200;

function task(id: string, deadline: string, remainingMinutes: number): Task {
  return {
    id, courseId: null, title: id, deadline, remainingMinutes, priority: "medium",
    splittable: true, minimumBlockMinutes: 30, status: "active", createdAt: NOW, updatedAt: NOW,
  };
}

function availabilityForDays(days: number): AvailabilityBlock[] {
  const blocks: AvailabilityBlock[] = [];
  const startMs = new Date("2026-08-12T08:00:00.000Z").getTime();
  const blocksPerDay = 16; // 8 hours per day
  for (let day = 0; day < days; day++) {
    for (let block = 0; block < blocksPerDay; block++) {
      const blockStart = startMs + day * 24 * 60 * 60 * 1000 + block * BLOCK_MS;
      blocks.push({
        id: `block-${day}-${block}`,
        startAt: new Date(blockStart).toISOString(),
        endAt: new Date(blockStart + BLOCK_MS).toISOString(),
      });
    }
  }
  return blocks;
}

function buildInput(): PlanningInput {
  const tasks = Array.from({ length: TASK_COUNT }, (_, index) => {
    const dayOffset = Math.floor(index / 15); // ~15 tasks per day
    const deadlineDay = 12 + dayOffset; // start from day 12
    const deadline = new Date(`2026-08-${String(deadlineDay).padStart(2, "0")}T${String(12 + (index % 12)).padStart(2, "0")}:00:00.000Z`);
    return task(`task-${index}`, deadline.toISOString(), 60 + (index % 4) * 30); // 60-150 minutes
  });

  return {
    now: NOW,
    rangeEnd: "2026-08-25T00:00:00.000Z",
    timezone: "Asia/Shanghai",
    bufferRatio: 0.1,
    tasks,
    dependencies: [],
    availability: availabilityForDays(DAY_COUNT),
    frozenBlocks: [],
  };
}

function measureMs(fn: () => unknown): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

describe("200-task performance", () => {
  const input = buildInput();

  it("analyzes 200 tasks within 500ms", () => {
    // warm-up
    analyzeConflicts(input);
    const ms = measureMs(() => analyzeConflicts(input));
    expect(ms).toBeLessThan(500);
  });

  it("generates a plan for 200 tasks within 500ms", () => {
    // warm-up
    generatePlan(input);
    const ms = measureMs(() => generatePlan(input));
    expect(ms).toBeLessThan(500);
  });
});
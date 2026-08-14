import { expect, it } from "vitest";
import { generatePlan } from "../src/planner.js";
import type { PlanningInput, Task } from "../src/types.js";

const at = (hour: number, minute = 0) => `2026-08-12T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;

function plannerTask(id: string, deadline: string, priority: Task["priority"]): Task {
  return {
    id,
    courseId: null,
    title: id,
    deadline,
    remainingMinutes: 30,
    priority,
    splittable: true,
    minimumBlockMinutes: 30,
    status: "active",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
  };
}

function tiedPlanningInput(): PlanningInput {
  return {
    now: "2026-08-11T00:00:00.000Z",
    rangeEnd: at(13),
    timezone: "Asia/Shanghai",
    bufferRatio: 0,
    tasks: [
      plannerTask("later", at(13), "high"),
      plannerTask("urgent-low", at(12), "low"),
      plannerTask("urgent-high", at(12), "high"),
    ],
    dependencies: [],
    availability: [9, 10, 11].map((hour) => ({ id: `availability-${hour}`, startAt: at(hour), endAt: at(hour, 30) })),
    frozenBlocks: [],
  };
}

function planningInput(overrides: Pick<PlanningInput, "tasks" | "dependencies" | "availability">): PlanningInput {
  return { ...tiedPlanningInput(), ...overrides };
}

function availabilityAt(hour: number, minute = 0) {
  return {
    id: `availability-${hour}-${minute}`,
    startAt: at(hour, minute),
    endAt: minute === 30 ? at(hour + 1) : at(hour, 30),
  };
}

function blocksFor(result: ReturnType<typeof generatePlan>, taskId: string) {
  return result.blocks.filter((block) => block.taskId === taskId);
}

function minutesFor(block: { startAt: string; endAt: string }) {
  return (new Date(block.endAt).getTime() - new Date(block.startAt).getTime()) / 60_000;
}

function scheduledMinutes(result: ReturnType<typeof generatePlan>, taskId: string) {
  return blocksFor(result, taskId).reduce((total, block) => total + minutesFor(block), 0);
}

function unscheduledMinutes(result: ReturnType<typeof generatePlan>, taskId: string) {
  return result.unscheduled
    .filter((work) => work.taskId === taskId)
    .reduce((total, work) => total + work.minutes, 0);
}

it("uses slack, deadline, priority, then creation time as stable tie breakers", () => {
  const input = tiedPlanningInput();
  const first = generatePlan(input);
  const second = generatePlan(input);

  expect(first).toEqual(second);
  expect(first.blocks.map((block) => block.taskId)).toEqual(["urgent-high", "urgent-low", "later"]);
});

it("uses creation time and task ID to resolve otherwise equal candidates", () => {
  const result = generatePlan(planningInput({
    tasks: [
      { ...plannerTask("created-later", at(13), "high"), createdAt: "2026-08-11T02:00:00.000Z" },
      { ...plannerTask("created-earlier", at(13), "high"), createdAt: "2026-08-11T01:00:00.000Z" },
      plannerTask("id-b", at(13), "high"),
      plannerTask("id-a", at(13), "high"),
    ],
    dependencies: [],
    availability: [availabilityAt(9), availabilityAt(9, 30), availabilityAt(10), availabilityAt(10, 30)],
  }));

  expect(result.blocks.map((block) => block.taskId)).toEqual(["id-a", "id-b", "created-earlier", "created-later"]);
});

it("does not start a successor before its predecessor is fully allocated", () => {
  const result = generatePlan(planningInput({
    tasks: [
      { ...plannerTask("research", at(14), "low"), remainingMinutes: 60 },
      { ...plannerTask("presentation", at(13), "high"), remainingMinutes: 60, splittable: false },
    ],
    dependencies: [{ predecessorTaskId: "research", successorTaskId: "presentation" }],
    availability: [availabilityAt(9), availabilityAt(9, 30), availabilityAt(10), availabilityAt(10, 30)],
  }));

  expect(blocksFor(result, "presentation")[0].startAt >= blocksFor(result, "research").at(-1)!.endAt).toBe(true);
});

it("places a non-splittable task in one consecutive block", () => {
  const result = generatePlan(planningInput({
    tasks: [{ ...plannerTask("exam", at(13), "high"), remainingMinutes: 120, splittable: false }],
    dependencies: [],
    availability: [availabilityAt(9), availabilityAt(9, 30), availabilityAt(10), availabilityAt(10, 30)],
  }));

  expect(blocksFor(result, "exam")).toHaveLength(1);
  expect(minutesFor(blocksFor(result, "exam")[0])).toBe(120);
});

it("reports a non-splittable task with separated windows as unscheduled", () => {
  const result = generatePlan(planningInput({
    tasks: [{ ...plannerTask("exam", at(13), "high"), remainingMinutes: 120, splittable: false }],
    dependencies: [],
    availability: [availabilityAt(9), availabilityAt(9, 30), availabilityAt(11), availabilityAt(11, 30)],
  }));

  expect(result.unscheduled).toContainEqual({ taskId: "exam", reason: "NO_CONSECUTIVE_WINDOW", minutes: 120 });
});

it("reports capacity contention when another task consumes a consecutive window", () => {
  const result = generatePlan(planningInput({
    tasks: [
      { ...plannerTask("first", at(13), "high"), remainingMinutes: 120, splittable: false },
      { ...plannerTask("second", at(13), "low"), remainingMinutes: 120, splittable: false },
    ],
    dependencies: [],
    availability: [availabilityAt(9), availabilityAt(9, 30), availabilityAt(10), availabilityAt(10, 30)],
  }));

  expect(result.unscheduled).toContainEqual({ taskId: "second", reason: "NO_CAPACITY", minutes: 120 });
});

it("rejects cyclic dependencies with their sorted task IDs", () => {
  const input = planningInput({
    tasks: [plannerTask("beta", at(13), "high"), plannerTask("alpha", at(13), "high")],
    dependencies: [
      { predecessorTaskId: "alpha", successorTaskId: "beta" },
      { predecessorTaskId: "beta", successorTaskId: "alpha" },
    ],
    availability: [availabilityAt(9), availabilityAt(9, 30)],
  });

  expect(() => generatePlan(input)).toThrowError("task dependencies contain a cycle");
  try {
    generatePlan(input);
  } catch (error) {
    expect(error).toMatchObject({ code: "DEPENDENCY_CYCLE", taskIds: ["alpha", "beta"] });
  }
});

it("conserves every normalized task minute between scheduled and unscheduled work", () => {
  const input = planningInput({
    tasks: [{ ...plannerTask("shortfall", at(13), "high"), remainingMinutes: 60 }],
    dependencies: [],
    availability: [availabilityAt(9)],
  });
  const result = generatePlan(input);

  for (const task of input.tasks) {
    expect(scheduledMinutes(result, task.id) + unscheduledMinutes(result, task.id)).toBe(task.remainingMinutes);
  }
  expect(result.unscheduled).toContainEqual({ taskId: "shortfall", reason: "NO_CAPACITY", minutes: 30 });
});

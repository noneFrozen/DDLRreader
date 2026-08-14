import { expect, it } from "vitest";
import { analyzeConflicts } from "../src/conflict.js";
import { blocksBefore, makeInput, task } from "./fixtures.js";

it("reports the earliest deadline capacity shortage", () => {
  const result = analyzeConflicts(makeInput({
    tasks: [task("math", "2026-08-13T12:00:00.000Z", 240)],
    availability: blocksBefore("2026-08-13T12:00:00.000Z", 6),
    bufferRatio: 0,
  }));

  expect(result).toMatchObject({
    status: "ready",
    risk: "red",
    firstConflict: { deadline: "2026-08-13T12:00:00.000Z", shortageMinutes: 60, taskIds: ["math"] },
  });
});

it("lists every cumulative contributor at the first conflict", () => {
  const currentDeadline = "2026-08-13T12:00:00.000Z";
  const result = analyzeConflicts(makeInput({
    tasks: [
      task("earlier", "2026-08-13T11:30:00.000Z", 30),
      task("current", currentDeadline, 60),
    ],
    availability: blocksBefore(currentDeadline, 2),
    bufferRatio: 0,
  }));

  expect(result).toMatchObject({
    status: "ready",
    firstConflict: { deadline: currentDeadline, shortageMinutes: 30, taskIds: ["earlier", "current"] },
  });
});

it("marks an exact buffered fit yellow", () => {
  const result = analyzeConflicts(makeInput({
    tasks: [task("essay", "2026-08-13T12:00:00.000Z", 270)],
    availability: blocksBefore("2026-08-13T12:00:00.000Z", 10),
  }));

  expect(result.status === "ready" && result.risk).toBe("yellow");
});

it("marks more than ten percent raw capacity slack green", () => {
  const result = analyzeConflicts(makeInput({
    tasks: [task("reading", "2026-08-13T12:00:00.000Z", 360)],
    availability: blocksBefore("2026-08-13T12:00:00.000Z", 20),
  }));

  expect(result.status === "ready" && result.risk).toBe("green");
});

it("marks unfinished overdue work red", () => {
  const deadline = "2026-08-10T12:00:00.000Z";
  const result = analyzeConflicts(makeInput({
    tasks: [task("overdue", deadline, 30)],
    availability: blocksBefore(deadline, 10),
    bufferRatio: 0,
  }));

  expect(result.status === "ready" && result.risk).toBe("red");
});

it("returns incomplete when an active task deadline is blank", () => {
  const result = analyzeConflicts(makeInput({
    tasks: [task("draft", "", 30)],
    availability: [],
  }));

  expect(result).toEqual({
    status: "incomplete",
    issues: [{ code: "TASK_DEADLINE_MISSING", taskId: "draft" }],
  });
});

it("warns when a non-splittable task has no long enough consecutive window", () => {
  const deadline = "2026-08-13T12:00:00.000Z";
  const result = analyzeConflicts(makeInput({
    tasks: [{ ...task("presentation", deadline, 60), splittable: false }],
    availability: [
      ...blocksBefore("2026-08-13T09:30:00.000Z", 1).map((block) => ({ ...block, id: "early" })),
      ...blocksBefore("2026-08-13T10:30:00.000Z", 1).map((block) => ({ ...block, id: "middle" })),
      ...blocksBefore(deadline, 1).map((block) => ({ ...block, id: "late" })),
    ],
    bufferRatio: 0,
  }));

  expect(result).toMatchObject({
    status: "ready",
    risk: "yellow",
    warnings: [{ code: "NO_CONSECUTIVE_WINDOW", taskId: "presentation" }],
  });
});

const riskRank = { green: 0, yellow: 1, red: 2 } as const;

it("never improves risk when thirty minutes of work is added", () => {
  for (const bufferRatio of [0, 0.1]) {
    const deadline = "2026-08-13T12:00:00.000Z";
    const baseline = analyzeConflicts(makeInput({
      tasks: [task("baseline", deadline, 60)],
      availability: blocksBefore(deadline, 4),
      bufferRatio,
    }));
    const withExtraWork = analyzeConflicts(makeInput({
      tasks: [task("baseline", deadline, 90)],
      availability: blocksBefore(deadline, 4),
      bufferRatio,
    }));

    expect(baseline.status).toBe("ready");
    expect(withExtraWork.status).toBe("ready");
    if (baseline.status === "ready" && withExtraWork.status === "ready") {
      expect(riskRank[withExtraWork.risk]).toBeGreaterThanOrEqual(riskRank[baseline.risk]);
    }
  }
});

it("never improves risk when one availability block is removed", () => {
  for (const bufferRatio of [0, 0.1]) {
    const deadline = "2026-08-13T12:00:00.000Z";
    const availability = blocksBefore(deadline, 4);
    const withAllBlocks = analyzeConflicts(makeInput({
      tasks: [task("baseline", deadline, 60)],
      availability,
      bufferRatio,
    }));
    const withOneBlockRemoved = analyzeConflicts(makeInput({
      tasks: [task("baseline", deadline, 60)],
      availability: availability.slice(1),
      bufferRatio,
    }));

    expect(withAllBlocks.status).toBe("ready");
    expect(withOneBlockRemoved.status).toBe("ready");
    if (withAllBlocks.status === "ready" && withOneBlockRemoved.status === "ready") {
      expect(riskRank[withOneBlockRemoved.risk]).toBeGreaterThanOrEqual(riskRank[withAllBlocks.risk]);
    }
  }
});

it("orders cumulative contributors independently of task input order", () => {
  const deadline = "2026-08-13T12:00:00.000Z";
  const result = analyzeConflicts(makeInput({
    tasks: [
      { ...task("low", deadline, 30), priority: "low" },
      { ...task("high", deadline, 30), priority: "high" },
    ],
    availability: blocksBefore(deadline, 1),
    bufferRatio: 0,
  }));

  expect(result).toMatchObject({
    status: "ready",
    firstConflict: { taskIds: ["high", "low"] },
  });
});

it("returns deeply equal analysis for the same input", () => {
  const input = makeInput({
    tasks: [task("math", "2026-08-13T12:00:00.000Z", 240)],
    availability: blocksBefore("2026-08-13T12:00:00.000Z", 6),
    bufferRatio: 0,
  });

  expect(analyzeConflicts(input)).toEqual(analyzeConflicts(input));
});

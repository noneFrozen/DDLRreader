import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { buildStats } from "../src/services/stats.js";
import { seedSession } from "./helpers.js";
import type { AvailabilityBlock, ScheduleBlock, StoredPlan, Task } from "../../../packages/domain/src/types.js";

function task(id: string, deadline: string, overrides: Partial<Task> = {}): Task {
  return {
    id, courseId: null, title: id, deadline, remainingMinutes: 60, priority: "medium",
    splittable: true, minimumBlockMinutes: 30, status: "active",
    createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildStats", () => {
  it("aggregates tasks, priorities, and daily workload in the plan timezone", () => {
    const tasks = [
      task("t1", "2026-08-19T12:00:00.000Z", { priority: "high", remainingMinutes: 90 }),
      task("t2", "2026-08-21T12:00:00.000Z", { status: "completed" }),
      task("t3", "2026-08-15T12:00:00.000Z", { priority: "high" }),
    ];
    const availability: AvailabilityBlock[] = [
      { id: "a1", startAt: "2026-08-17T02:00:00.000Z", endAt: "2026-08-17T02:30:00.000Z" },
      { id: "a2", startAt: "2026-08-18T02:00:00.000Z", endAt: "2026-08-18T02:30:00.000Z" },
      { id: "a3", startAt: "2026-08-18T02:30:00.000Z", endAt: "2026-08-18T03:00:00.000Z" },
    ];
    const blocks: ScheduleBlock[] = [
      { id: "b1", taskId: "t1", startAt: "2026-08-18T02:00:00.000Z", endAt: "2026-08-18T03:00:00.000Z", status: "planned", locked: false },
    ];
    const plan: StoredPlan = {
      id: "plan-1", rangeStart: "2026-08-17T00:00:00.000Z", rangeEnd: "2026-08-19T00:00:00.000Z",
      version: 1, riskLevel: "green", unscheduledMinutes: 0, createdAt: "2026-08-17T00:00:00.000Z", blocks,
    };
    const result = buildStats({ tasks, plan, availability, now: "2026-08-16T00:00:00.000Z", timezone: "Asia/Shanghai" });

    expect(result.taskSummary).toMatchObject({ activeCount: 2, completedCount: 1, totalRemainingMinutes: 150, dueThisWeekCount: 1 });
    expect(result.priorityDistribution).toEqual([
      { priority: "high", count: 2, remainingMinutes: 150 },
      { priority: "medium", count: 0, remainingMinutes: 0 },
      { priority: "low", count: 0, remainingMinutes: 0 },
    ]);
    expect(result.dailyWorkload).toEqual([
      { date: "2026-08-17", scheduledMinutes: 0, capacityMinutes: 30 },
      { date: "2026-08-18", scheduledMinutes: 60, capacityMinutes: 60 },
    ]);
  });

  it("returns zeroed statistics when there are no tasks and no plan", () => {
    const result = buildStats({ tasks: [], plan: null, availability: [], now: "2026-08-16T00:00:00.000Z", timezone: "UTC" });
    expect(result.taskSummary.completionRate).toBe(0);
    expect(result.dailyWorkload).toHaveLength(7);
  });
});

describe("stats REST API", () => {
  const databases: Database.Database[] = [];
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    databases.splice(0).forEach((database) => database.close());
  });

  it("serves aggregated stats with zeroed data before any input", async () => {
    const database = new Database(":memory:");
    databases.push(database);
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") } });
    apps.push(app);
    const cookie = seedSession(database);
    const response = await app.inject({ method: "GET", url: "/api/stats", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      taskSummary: { activeCount: 0, completedCount: 0, overdueCount: 0, totalRemainingMinutes: 0, completionRate: 0 },
    });
  });

  it("returns 401 without a session", async () => {
    const database = new Database(":memory:");
    databases.push(database);
    const app = await buildApp({ database });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/stats" });
    expect(response.statusCode).toBe(401);
  });
});

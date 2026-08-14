import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { SqlitePlanRepository } from "../src/repositories/plan-repository.js";

describe("plans REST API", () => {
  const databases: Database.Database[] = [];
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    databases.splice(0).forEach((database) => database.close());
  });

  it("requires risk confirmation before persisting a red plan and stores its unscheduled work", async () => {
    const database = new Database(":memory:");
    databases.push(database);
    const ids = ["task-1", "plan-1"];
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => ids.shift()! });
    apps.push(app);
    await app.inject({ method: "PUT", url: "/api/availability", payload: {
      timezone: "UTC", weeklyRules: [{ id: "monday", weekday: 1, startLocalTime: "09:00", endLocalTime: "12:00", timezone: "UTC" }], exceptions: [],
    } });
    await app.inject({ method: "POST", url: "/api/tasks", payload: { title: "Large task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 300 } });

    const confirmation = await app.inject({ method: "POST", url: "/api/plans", payload: { planningDays: 7, allowRisk: false } });
    expect(confirmation.statusCode).toBe(409);
    expect(confirmation.json()).toEqual({ code: "RISK_CONFIRMATION_REQUIRED", message: "当前风险较高，请确认后生成计划" });

    const created = await app.inject({ method: "POST", url: "/api/plans", payload: { planningDays: 7, allowRisk: true } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      plan: { id: "plan-1", version: 1, riskLevel: "red", unscheduledMinutes: 120 },
      analysis: { status: "ready", risk: "red" },
    });
    expect(created.json().unscheduled).toEqual([{ taskId: "task-1", minutes: 120, reason: "NO_CAPACITY" }]);
  });

  it("replans from the requested version while preserving its frozen block identity", async () => {
    const database = new Database(":memory:");
    databases.push(database);
    const ids = ["task-1", "plan-1", "plan-2"];
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => ids.shift()! });
    apps.push(app);
    await app.inject({ method: "PUT", url: "/api/availability", payload: {
      timezone: "UTC", weeklyRules: [{ id: "monday", weekday: 1, startLocalTime: "09:00", endLocalTime: "12:00", timezone: "UTC" }], exceptions: [],
    } });
    await app.inject({ method: "POST", url: "/api/tasks", payload: { title: "Task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 60 } });
    const created = await app.inject({ method: "POST", url: "/api/plans", payload: { planningDays: 7, allowRisk: false } });
    const frozenBlock = created.json().plan.blocks[0];
    database.prepare("UPDATE schedule_blocks SET locked = 1 WHERE plan_id = ? AND id = ?").run("plan-1", frozenBlock.id);

    const replanned = await app.inject({ method: "POST", url: "/api/plans/plan-1/replan" });

    expect(replanned.statusCode).toBe(201);
    expect(replanned.json()).toMatchObject({ plan: { id: "plan-2", version: 2 } });
    expect(replanned.json().plan.blocks).toContainEqual({ ...frozenBlock, locked: true });
  });

  it("rejects a move over a locked sibling without changing the stored block", async () => {
    const database = new Database(":memory:");
    databases.push(database);
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => "task-1" });
    apps.push(app);
    await app.inject({ method: "PUT", url: "/api/availability", payload: {
      timezone: "UTC", weeklyRules: [{ id: "monday", weekday: 1, startLocalTime: "09:00", endLocalTime: "12:00", timezone: "UTC" }], exceptions: [],
    } });
    await app.inject({ method: "POST", url: "/api/tasks", payload: { title: "Task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 120 } });
    new SqlitePlanRepository(database).savePlan({
      id: "plan-1", rangeStart: "2026-08-10T00:00:00.000Z", rangeEnd: "2026-08-17T00:00:00.000Z", version: 1, riskLevel: "green", unscheduledMinutes: 0, createdAt: "2026-08-10T00:00:00.000Z",
      blocks: [
        { id: "block-1", taskId: "task-1", startAt: "2026-08-10T09:00:00.000Z", endAt: "2026-08-10T09:30:00.000Z", status: "planned", locked: false },
        { id: "locked-1", taskId: "task-1", startAt: "2026-08-10T09:30:00.000Z", endAt: "2026-08-10T10:00:00.000Z", status: "planned", locked: true },
      ],
    });

    const response = await app.inject({ method: "PATCH", url: "/api/schedule-blocks/block-1", payload: { startAt: "2026-08-10T09:30:00.000Z", endAt: "2026-08-10T10:00:00.000Z" } });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: "SCHEDULE_CONFLICT", message: "该时间与已锁定安排冲突", details: { conflictingBlockId: "locked-1" } });
    expect(new SqlitePlanRepository(database).getLatest()?.blocks[0]).toEqual({ id: "block-1", taskId: "task-1", startAt: "2026-08-10T09:00:00.000Z", endAt: "2026-08-10T09:30:00.000Z", status: "planned", locked: false });
  });
});

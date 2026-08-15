import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { SqlitePlanRepository } from "../src/repositories/plan-repository.js";
import { seedSession } from "./helpers.js";

const USER = "user-1";

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
    const cookie = seedSession(database);
    await app.inject({ method: "PUT", url: "/api/availability", headers: { cookie }, payload: {
      timezone: "UTC", weeklyRules: [{ id: "monday", weekday: 1, startLocalTime: "09:00", endLocalTime: "12:00", timezone: "UTC" }], exceptions: [],
    } });
    await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title: "Large task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 300 } });

    const confirmation = await app.inject({ method: "POST", url: "/api/plans", headers: { cookie }, payload: { planningDays: 7, allowRisk: false } });
    expect(confirmation.statusCode).toBe(409);
    expect(confirmation.json()).toEqual({ code: "RISK_CONFIRMATION_REQUIRED", message: "当前风险较高，请确认后生成计划" });

    const created = await app.inject({ method: "POST", url: "/api/plans", headers: { cookie }, payload: { planningDays: 7, allowRisk: true } });
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
    const cookie = seedSession(database);
    await app.inject({ method: "PUT", url: "/api/availability", headers: { cookie }, payload: {
      timezone: "UTC", weeklyRules: [{ id: "monday", weekday: 1, startLocalTime: "09:00", endLocalTime: "12:00", timezone: "UTC" }], exceptions: [],
    } });
    await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title: "Task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 60 } });
    const created = await app.inject({ method: "POST", url: "/api/plans", headers: { cookie }, payload: { planningDays: 7, allowRisk: false } });
    const frozenBlock = created.json().plan.blocks[0];
    database.prepare("UPDATE schedule_blocks SET locked = 1 WHERE plan_id = ? AND id = ?").run("plan-1", frozenBlock.id);

    const replanned = await app.inject({ method: "POST", url: "/api/plans/plan-1/replan", headers: { cookie } });

    expect(replanned.statusCode).toBe(201);
    expect(replanned.json()).toMatchObject({ plan: { id: "plan-2", version: 2 } });
    expect(replanned.json().plan.blocks).toContainEqual({ ...frozenBlock, locked: true });
  });

  it("rejects a move over a locked sibling without changing the stored block", async () => {
    const database = new Database(":memory:");
    databases.push(database);
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => "task-1" });
    apps.push(app);
    const cookie = seedSession(database);
    await app.inject({ method: "PUT", url: "/api/availability", headers: { cookie }, payload: {
      timezone: "UTC", weeklyRules: [{ id: "monday", weekday: 1, startLocalTime: "09:00", endLocalTime: "12:00", timezone: "UTC" }], exceptions: [],
    } });
    await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title: "Task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 120 } });
    new SqlitePlanRepository(database).savePlan(USER, {
      id: "plan-1", rangeStart: "2026-08-10T00:00:00.000Z", rangeEnd: "2026-08-17T00:00:00.000Z", version: 1, riskLevel: "green", unscheduledMinutes: 0, createdAt: "2026-08-10T00:00:00.000Z",
      blocks: [
        { id: "block-1", taskId: "task-1", startAt: "2026-08-10T09:00:00.000Z", endAt: "2026-08-10T09:30:00.000Z", status: "planned", locked: false },
        { id: "locked-1", taskId: "task-1", startAt: "2026-08-10T09:30:00.000Z", endAt: "2026-08-10T10:00:00.000Z", status: "planned", locked: true },
      ],
    });

    const response = await app.inject({ method: "PATCH", url: "/api/schedule-blocks/block-1", headers: { cookie }, payload: { startAt: "2026-08-10T09:30:00.000Z", endAt: "2026-08-10T10:00:00.000Z" } });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: "SCHEDULE_CONFLICT", message: "该时间与已锁定安排冲突", details: { conflictingBlockId: "locked-1" } });
    expect(new SqlitePlanRepository(database).getLatest(USER)?.blocks[0]).toEqual({ id: "block-1", taskId: "task-1", startAt: "2026-08-10T09:00:00.000Z", endAt: "2026-08-10T09:30:00.000Z", status: "planned", locked: false });
  });

  it("prefers a later locked sibling over an earlier unlocked overlap", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => "task-1" }); apps.push(app);
    const cookie = seedSession(database);
    await app.inject({ method: "PUT", url: "/api/availability", headers: { cookie }, payload: { timezone: "UTC", weeklyRules: [{ id: "monday", weekday: 1, startLocalTime: "09:00", endLocalTime: "12:00", timezone: "UTC" }], exceptions: [] } });
    await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title: "Task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 120 } });
    new SqlitePlanRepository(database).savePlan(USER, { id: "plan-1", rangeStart: "2026-08-10T00:00:00.000Z", rangeEnd: "2026-08-17T00:00:00.000Z", version: 1, riskLevel: "green", unscheduledMinutes: 0, createdAt: "2026-08-10T00:00:00.000Z", blocks: [
      { id: "block-1", taskId: "task-1", startAt: "2026-08-10T09:00:00.000Z", endAt: "2026-08-10T09:30:00.000Z", status: "planned", locked: false },
      { id: "unlocked-1", taskId: "task-1", startAt: "2026-08-10T09:30:00.000Z", endAt: "2026-08-10T10:00:00.000Z", status: "planned", locked: false },
      { id: "locked-1", taskId: "task-1", startAt: "2026-08-10T10:00:00.000Z", endAt: "2026-08-10T10:30:00.000Z", status: "planned", locked: true },
    ] });

    const response = await app.inject({ method: "PATCH", url: "/api/schedule-blocks/block-1", headers: { cookie }, payload: { startAt: "2026-08-10T09:30:00.000Z", endAt: "2026-08-10T10:30:00.000Z" } });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: "SCHEDULE_CONFLICT", message: "该时间与已锁定安排冲突", details: { conflictingBlockId: "locked-1" } });
  });

  it("rejects semantically invalid UTC timestamps instead of normalizing them", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => "task-1" }); apps.push(app);
    const cookie = seedSession(database);
    await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title: "Task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 30 } });
    new SqlitePlanRepository(database).savePlan(USER, { id: "plan-1", rangeStart: "2026-08-10T00:00:00.000Z", rangeEnd: "2026-08-17T00:00:00.000Z", version: 1, riskLevel: "green", unscheduledMinutes: 0, createdAt: "2026-08-10T00:00:00.000Z", blocks: [{ id: "block-1", taskId: "task-1", startAt: "2026-08-10T09:00:00.000Z", endAt: "2026-08-10T09:30:00.000Z", status: "planned", locked: false }] });

    const response = await app.inject({ method: "PATCH", url: "/api/schedule-blocks/block-1", headers: { cookie }, payload: { startAt: "2026-02-30T09:00:00.000Z" } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("refuses an allowed-risk plan when resolved availability is empty", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => "task-1" }); apps.push(app);
    const cookie = seedSession(database);
    await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title: "Task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 30 } });
    const response = await app.inject({ method: "POST", url: "/api/plans", headers: { cookie }, payload: { planningDays: 7, allowRisk: true } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: "NO_AVAILABILITY", message: "没有可用时间，无法生成计划" });
  });

  it("returns structured missing and expired replan errors", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => "unused" }); apps.push(app);
    const cookie = seedSession(database);
    new SqlitePlanRepository(database).savePlan(USER, { id: "expired", rangeStart: "2026-08-01T00:00:00.000Z", rangeEnd: "2026-08-09T00:00:00.000Z", version: 1, riskLevel: "green", unscheduledMinutes: 0, createdAt: "2026-08-01T00:00:00.000Z", blocks: [] });
    expect((await app.inject({ method: "POST", url: "/api/plans/missing/replan", headers: { cookie } })).json()).toEqual({ code: "PLAN_NOT_FOUND", message: "计划不存在" });
    const expired = await app.inject({ method: "POST", url: "/api/plans/expired/replan", headers: { cookie } });
    expect(expired.statusCode).toBe(409);
    expect(expired.json()).toEqual({ code: "PLAN_RANGE_EXPIRED", message: "计划范围已过期" });
  });

  it("returns 404 for block mutation without a latest plan or without that block", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const app = await buildApp({ database, idFactory: () => "unused" }); apps.push(app);
    const cookie = seedSession(database);
    expect((await app.inject({ method: "PATCH", url: "/api/schedule-blocks/missing", headers: { cookie }, payload: { locked: true } })).json()).toEqual({ code: "PLAN_NOT_FOUND", message: "计划不存在" });
    new SqlitePlanRepository(database).savePlan(USER, { id: "plan-1", rangeStart: "2026-08-10T00:00:00.000Z", rangeEnd: "2026-08-17T00:00:00.000Z", version: 1, riskLevel: "green", unscheduledMinutes: 0, createdAt: "2026-08-10T00:00:00.000Z", blocks: [] });
    const missingBlock = await app.inject({ method: "PATCH", url: "/api/schedule-blocks/missing", headers: { cookie }, payload: { locked: true } });
    expect(missingBlock.statusCode).toBe(404);
    expect(missingBlock.json()).toEqual({ code: "SCHEDULE_BLOCK_NOT_FOUND", message: "安排不存在" });
  });

  it("applies progress with overflow and rolls task progress back when the block write fails", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => "task-1" }); apps.push(app);
    const cookie = seedSession(database);
    await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title: "Task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 60 } });
    const repository = new SqlitePlanRepository(database);
    repository.savePlan(USER, { id: "plan-1", rangeStart: "2026-08-10T00:00:00.000Z", rangeEnd: "2026-08-17T00:00:00.000Z", version: 1, riskLevel: "green", unscheduledMinutes: 0, createdAt: "2026-08-10T00:00:00.000Z", blocks: [{ id: "block-1", taskId: "task-1", startAt: "2026-08-10T09:00:00.000Z", endAt: "2026-08-10T09:30:00.000Z", status: "planned", locked: false }] });
    const applied = await app.inject({ method: "PATCH", url: "/api/schedule-blocks/block-1", headers: { cookie }, payload: { completedMinutes: 90 } });
    expect(applied.json()).toMatchObject({ block: { status: "completed" }, task: { remainingMinutes: 0, status: "completed" }, progress: { appliedMinutes: 60, overflowMinutes: 30 } });
    database.prepare("UPDATE tasks SET remaining_minutes = 60, status = 'active' WHERE id = 'task-1'").run();
    database.prepare("UPDATE schedule_blocks SET status = 'planned' WHERE plan_id = 'plan-1' AND id = 'block-1'").run();
    database.exec("CREATE TRIGGER fail_block_update BEFORE UPDATE ON schedule_blocks BEGIN SELECT RAISE(ABORT, 'forced'); END");
    const failed = await app.inject({ method: "PATCH", url: "/api/schedule-blocks/block-1", headers: { cookie }, payload: { completedMinutes: 30 } });
    expect(failed.statusCode).toBe(500);
    expect(database.prepare("SELECT remaining_minutes FROM tasks WHERE id = 'task-1'").get()).toEqual({ remaining_minutes: 60 });
    expect(repository.getById(USER, "plan-1")?.blocks[0].status).toBe("planned");
  });

  it("mutates only the latest plan when block IDs are retained across versions", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const app = await buildApp({ database, idFactory: () => "task-1" }); apps.push(app);
    const cookie = seedSession(database);
    await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title: "Task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 30 } });
    const repository = new SqlitePlanRepository(database);
    const base = { rangeStart: "2026-08-10T00:00:00.000Z", rangeEnd: "2026-08-17T00:00:00.000Z", riskLevel: "green" as const, unscheduledMinutes: 0, createdAt: "2026-08-10T00:00:00.000Z", blocks: [{ id: "same", taskId: "task-1", startAt: "2026-08-10T09:00:00.000Z", endAt: "2026-08-10T09:30:00.000Z", status: "planned" as const, locked: false }] };
    repository.savePlan(USER, { ...base, id: "old", version: 1 }); repository.savePlan(USER, { ...base, id: "latest", version: 2 });
    expect((await app.inject({ method: "PATCH", url: "/api/schedule-blocks/same", headers: { cookie }, payload: { locked: true } })).statusCode).toBe(200);
    expect(repository.getById(USER, "old")?.blocks).toEqual(base.blocks);
    expect(repository.getById(USER, "latest")?.blocks).toEqual([{ ...base.blocks[0], locked: true }]);
  });

  it("returns ordinary overlap, unavailable-move, deadline-confirmation, and schema errors structurally", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => "task-1" }); apps.push(app);
    const cookie = seedSession(database);
    await app.inject({ method: "PUT", url: "/api/availability", headers: { cookie }, payload: { timezone: "UTC", weeklyRules: [{ id: "m", weekday: 1, startLocalTime: "09:00", endLocalTime: "12:00", timezone: "UTC" }], exceptions: [] } });
    await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title: "Task", deadline: "2026-08-10T09:45:00.000Z", remainingMinutes: 120 } });
    new SqlitePlanRepository(database).savePlan(USER, { id: "plan", rangeStart: "2026-08-10T00:00:00.000Z", rangeEnd: "2026-08-17T00:00:00.000Z", version: 1, riskLevel: "green", unscheduledMinutes: 0, createdAt: "2026-08-10T00:00:00.000Z", blocks: [
      { id: "one", taskId: "task-1", startAt: "2026-08-10T09:00:00.000Z", endAt: "2026-08-10T09:30:00.000Z", status: "planned", locked: false }, { id: "two", taskId: "task-1", startAt: "2026-08-10T09:30:00.000Z", endAt: "2026-08-10T10:00:00.000Z", status: "planned", locked: false },
    ] });
    expect((await app.inject({ method: "PATCH", url: "/api/schedule-blocks/one", headers: { cookie }, payload: { startAt: "2026-08-10T09:30:00.000Z", endAt: "2026-08-10T10:00:00.000Z" } })).json()).toEqual({ code: "SCHEDULE_CONFLICT", message: "该时间与已有安排冲突", details: { conflictingBlockId: "two" } });
    expect((await app.inject({ method: "PATCH", url: "/api/schedule-blocks/one", headers: { cookie }, payload: { startAt: "2026-08-10T12:00:00.000Z", endAt: "2026-08-10T12:30:00.000Z" } })).json()).toMatchObject({ code: "SCHEDULE_UNAVAILABLE" });
    const deadline = await app.inject({ method: "PATCH", url: "/api/schedule-blocks/one", headers: { cookie }, payload: { startAt: "2026-08-10T10:00:00.000Z", endAt: "2026-08-10T10:30:00.000Z" } }); expect(deadline.json()).toMatchObject({ code: "DEADLINE_CONFIRMATION_REQUIRED" });
    expect((await app.inject({ method: "PATCH", url: "/api/schedule-blocks/one", headers: { cookie }, payload: { startAt: "2026-08-10T10:00:00.000Z", endAt: "2026-08-10T10:30:00.000Z", allowAfterDeadline: true } })).statusCode).toBe(200);
    const invalidResponses = [] as number[];
    for (const payload of [{ locked: "yes" }, { extra: true }, { startAt: "2026-08-10T10:00:00+00:00" }, { startAt: "2026-08-10T10:00:00.000Z", endAt: "2026-08-10T10:00:00.000Z" }]) invalidResponses.push((await app.inject({ method: "PATCH", url: "/api/schedule-blocks/one", headers: { cookie }, payload })).statusCode);
    expect(invalidResponses).toEqual([400, 400, 400, 400]);
  });

  it("adds planning days on the availability timezone's local calendar across spring-forward", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const app = await buildApp({ database, clock: { now: () => new Date("2026-03-07T17:00:00.000Z") }, idFactory: () => "plan-1" }); apps.push(app);
    const cookie = seedSession(database);
    await app.inject({ method: "PUT", url: "/api/availability", headers: { cookie }, payload: { timezone: "America/New_York", weeklyRules: [{ id: "s", weekday: 6, startLocalTime: "13:00", endLocalTime: "14:00", timezone: "America/New_York" }], exceptions: [] } });
    const response = await app.inject({ method: "POST", url: "/api/plans", headers: { cookie }, payload: { planningDays: 7, allowRisk: false } });
    expect(response.statusCode).toBe(201);
    expect(response.json().plan.rangeEnd).toBe("2026-03-14T16:00:00Z");
  });

  it("keeps completed predecessors for planning and filters archived dependency endpoints", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const ids = ["completed", "successor", "archived", "active", "plan-1"];
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => ids.shift()! }); apps.push(app);
    const cookie = seedSession(database);
    await app.inject({ method: "PUT", url: "/api/availability", headers: { cookie }, payload: { timezone: "UTC", weeklyRules: [{ id: "m", weekday: 1, startLocalTime: "09:00", endLocalTime: "12:00", timezone: "UTC" }], exceptions: [] } });
    await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title: "done", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 0 } });
    await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title: "successor", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 30, predecessorTaskIds: ["completed"] } });
    await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title: "archived", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 30 } });
    await app.inject({ method: "PATCH", url: "/api/tasks/archived", headers: { cookie }, payload: { status: "archived" } });
    await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title: "active", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 30, predecessorTaskIds: ["archived"] } });
    const plan = await app.inject({ method: "POST", url: "/api/plans", headers: { cookie }, payload: { planningDays: 7, allowRisk: false } });
    expect(plan.statusCode).toBe(201);
    expect(plan.json().plan.blocks.map((block: { taskId: string }) => block.taskId)).toEqual(expect.arrayContaining(["successor", "active"]));
    expect(plan.json().plan.blocks.map((block: { taskId: string }) => block.taskId)).not.toContain("archived");
  });

  it("replans a requested older version, preserves its frozen block exactly, and versions after latest", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const ids = ["task-1", "plan-3"]; const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => ids.shift()! }); apps.push(app);
    const cookie = seedSession(database);
    await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title: "Task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 30 } });
    const repository = new SqlitePlanRepository(database); const base = { rangeStart: "2026-08-10T00:00:00.000Z", rangeEnd: "2026-08-17T00:00:00.000Z", riskLevel: "green" as const, unscheduledMinutes: 0, createdAt: "2026-08-10T00:00:00.000Z" };
    const frozen = { id: "frozen", taskId: "task-1", startAt: "2026-08-10T09:00:00.000Z", endAt: "2026-08-10T09:30:00.000Z", status: "started" as const, locked: true };
    repository.savePlan(USER, { ...base, id: "old", version: 1, blocks: [frozen] }); repository.savePlan(USER, { ...base, id: "latest", version: 2, blocks: [] });
    const response = await app.inject({ method: "POST", url: "/api/plans/old/replan", headers: { cookie } });
    expect(response.json().plan).toMatchObject({ id: "plan-3", version: 3, blocks: [frozen] });
  });
});

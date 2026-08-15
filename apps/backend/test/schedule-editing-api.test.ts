import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { SqlitePlanRepository } from "../src/repositories/plan-repository.js";
import { seedSession } from "./helpers.js";

const USER = "user-1";

const BASE_AVAILABILITY = {
  timezone: "UTC",
  weeklyRules: [{ id: "monday", weekday: 1, startLocalTime: "09:00", endLocalTime: "12:00", timezone: "UTC" }],
  exceptions: [],
};

describe("schedule editing REST API", () => {
  const databases: Database.Database[] = [];
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    databases.splice(0).forEach((database) => database.close());
  });

  function seedPlan(database: Database.Database): void {
    new SqlitePlanRepository(database).savePlan(USER, {
      id: "plan-1", rangeStart: "2026-08-10T00:00:00.000Z", rangeEnd: "2026-08-17T00:00:00.000Z",
      version: 1, riskLevel: "green", unscheduledMinutes: 0, createdAt: "2026-08-10T00:00:00.000Z",
      blocks: [
        { id: "block-1", taskId: "task-1", startAt: "2026-08-10T09:00:00.000Z", endAt: "2026-08-10T10:00:00.000Z", status: "planned", locked: false },
        { id: "block-2", taskId: "task-1", startAt: "2026-08-10T10:00:00.000Z", endAt: "2026-08-10T11:00:00.000Z", status: "planned", locked: false },
      ],
    });
  }

  it("splits a splittable block into two 30-minute-aligned segments", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => "task-1" });
    apps.push(app);
    const cookie = seedSession(database);
    await app.inject({ method: "PUT", url: "/api/availability", headers: { cookie }, payload: BASE_AVAILABILITY });
    await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title: "Task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 120, splittable: true } });
    seedPlan(database);

    const response = await app.inject({ method: "POST", url: "/api/schedule-blocks/block-1/split", headers: { cookie }, payload: { at: "2026-08-10T09:30:00.000Z" } });

    expect(response.statusCode).toBe(201);
    const { blocks } = response.json();
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ id: "block-1", startAt: "2026-08-10T09:00:00.000Z", endAt: "2026-08-10T09:30:00.000Z" });
    expect(blocks[1]).toMatchObject({ startAt: "2026-08-10T09:30:00.000Z", endAt: "2026-08-10T10:00:00.000Z" });
  });

  it("rejects splitting a non-splittable task", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => "task-1" });
    apps.push(app);
    const cookie = seedSession(database);
    await app.inject({ method: "PUT", url: "/api/availability", headers: { cookie }, payload: BASE_AVAILABILITY });
    await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title: "Task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 120, splittable: false } });
    seedPlan(database);

    const response = await app.inject({ method: "POST", url: "/api/schedule-blocks/block-1/split", headers: { cookie }, payload: {} });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: "SPLIT_NOT_ALLOWED", message: "该任务不可拆分" });
  });

  it("merges two adjacent same-task blocks", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => "task-1" });
    apps.push(app);
    const cookie = seedSession(database);
    await app.inject({ method: "PUT", url: "/api/availability", headers: { cookie }, payload: BASE_AVAILABILITY });
    await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title: "Task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 120, splittable: true } });
    seedPlan(database);

    const response = await app.inject({ method: "POST", url: "/api/schedule-blocks/block-1/merge", headers: { cookie }, payload: {} });

    expect(response.statusCode).toBe(201);
    expect(response.json().block).toMatchObject({ id: "block-1", startAt: "2026-08-10T09:00:00.000Z", endAt: "2026-08-10T11:00:00.000Z" });
  });

  it("rejects merging when there is no adjacent block", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => "task-1" });
    apps.push(app);
    const cookie = seedSession(database);
    await app.inject({ method: "PUT", url: "/api/availability", headers: { cookie }, payload: BASE_AVAILABILITY });
    await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title: "Task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 120 } });
    new SqlitePlanRepository(database).savePlan(USER, {
      id: "plan-1", rangeStart: "2026-08-10T00:00:00.000Z", rangeEnd: "2026-08-17T00:00:00.000Z", version: 1,
      riskLevel: "green", unscheduledMinutes: 0, createdAt: "2026-08-10T00:00:00.000Z",
      blocks: [{ id: "block-1", taskId: "task-1", startAt: "2026-08-10T09:00:00.000Z", endAt: "2026-08-10T10:00:00.000Z", status: "planned", locked: false }],
    });

    const response = await app.inject({ method: "POST", url: "/api/schedule-blocks/block-1/merge", headers: { cookie }, payload: {} });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: "MERGE_NOT_ADJACENT", message: "没有相邻的同任务时间块" });
  });
});

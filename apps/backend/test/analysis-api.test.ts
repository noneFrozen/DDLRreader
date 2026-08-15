import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { seedSession } from "./helpers.js";

describe("analysis REST API", () => {
  const databases: Database.Database[] = [];
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    databases.splice(0).forEach((database) => database.close());
  });

  it("reports the course example's Thursday 150-minute shortage", async () => {
    const database = new Database(":memory:");
    databases.push(database);
    const ids = ["task-a", "task-b", "task-c"];
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => ids.shift()! });
    apps.push(app);
    const cookie = seedSession(database);
    await app.inject({ method: "PUT", url: "/api/availability", headers: { cookie }, payload: {
      timezone: "Asia/Shanghai",
      weeklyRules: [{ id: "wed", weekday: 3, startLocalTime: "09:00", endLocalTime: "12:00", timezone: "Asia/Shanghai" }],
      exceptions: [],
    } });
    for (const [title, remainingMinutes] of [["软件工程", 120], ["算法", 150], ["数据库", 30]] as const) {
      await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title, deadline: "2026-08-13T23:00:00.000Z", remainingMinutes } });
    }

    const response = await app.inject({ method: "POST", url: "/api/analysis", headers: { cookie }, payload: { planningDays: 7 } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ready",
      risk: "red",
      firstConflict: { shortageMinutes: 150 },
    });
  });

  it("enforces the seven-to-fourteen-day planning range", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const app = await buildApp({ database }); apps.push(app);
    const cookie = seedSession(database);
    for (const planningDays of [6, 15]) {
      const response = await app.inject({ method: "POST", url: "/api/analysis", headers: { cookie }, payload: { planningDays } });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    }
  });

  it("uses the default buffer and honors an explicit buffer override", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => "task-1" }); apps.push(app);
    const cookie = seedSession(database);
    await app.inject({ method: "PUT", url: "/api/availability", headers: { cookie }, payload: { timezone: "UTC", weeklyRules: [{ id: "m", weekday: 1, startLocalTime: "09:00", endLocalTime: "12:00", timezone: "UTC" }], exceptions: [] } });
    await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title: "Task", deadline: "2026-08-10T12:00:00.000Z", remainingMinutes: 180 } });
    expect((await app.inject({ method: "POST", url: "/api/analysis", headers: { cookie }, payload: { planningDays: 7 } })).json()).toMatchObject({ risk: "red", firstConflict: { shortageMinutes: 30 } });
    expect((await app.inject({ method: "POST", url: "/api/analysis", headers: { cookie }, payload: { planningDays: 7, bufferRatio: 0 } })).json()).toMatchObject({ risk: "yellow" });
  });
});

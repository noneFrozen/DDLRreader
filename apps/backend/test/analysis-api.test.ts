import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

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
    await app.inject({ method: "PUT", url: "/api/availability", payload: {
      timezone: "Asia/Shanghai",
      weeklyRules: [{ id: "wed", weekday: 3, startLocalTime: "09:00", endLocalTime: "12:00", timezone: "Asia/Shanghai" }],
      exceptions: [],
    } });
    for (const [title, remainingMinutes] of [["软件工程", 120], ["算法", 150], ["数据库", 30]] as const) {
      await app.inject({ method: "POST", url: "/api/tasks", payload: { title, deadline: "2026-08-13T23:00:00.000Z", remainingMinutes } });
    }

    const response = await app.inject({ method: "POST", url: "/api/analysis", payload: { planningDays: 7 } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ready",
      risk: "red",
      firstConflict: { shortageMinutes: 150 },
    });
  });
});

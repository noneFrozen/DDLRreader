import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("ICS export", () => {
  const databases: Database.Database[] = [];
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    databases.splice(0).forEach((database) => database.close());
  });

  it("escapes task titles and keeps block UIDs stable across exports", async () => {
    const database = new Database(":memory:");
    databases.push(database);
    const ids = ["task-1", "plan-1"];
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => ids.shift()! });
    apps.push(app);
    await app.inject({ method: "PUT", url: "/api/availability", payload: {
      timezone: "Asia/Shanghai", weeklyRules: [{ id: "monday", weekday: 1, startLocalTime: "09:00", endLocalTime: "10:00", timezone: "Asia/Shanghai" }], exceptions: [],
    } });
    await app.inject({ method: "POST", url: "/api/tasks", payload: { title: `软件工程\\,大;作业\r\n下一行${"界".repeat(30)}`, deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 30 } });
    await app.inject({ method: "POST", url: "/api/plans", payload: { planningDays: 7, allowRisk: false } });

    const exported = await app.inject({ method: "GET", url: "/api/plans/plan-1/export.ics" });
    const exportAgain = await app.inject({ method: "GET", url: "/api/plans/plan-1/export.ics" });

    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toContain("text/calendar; charset=utf-8");
    expect(exported.headers["content-disposition"]).toContain('filename="ddl-radar-plan.ics"');
    expect(exported.body.replace(/\r\n /g, "")).toContain(`SUMMARY:软件工程\\\\\\,大\\;作业\\n下一行${"界".repeat(30)}`);
    expect(exported.body.replace(/\r\n /g, "")).toContain("UID:schedule-task-1-2026-08-10T01:00:00.000Z-2026-08-10T01:30:00.000Z@ddl-radar.local");
    expect(exported.body).toContain("TZID=Asia/Shanghai");
    expect(exportAgain.body).toBe(exported.body);
    expect(exported.body).toContain("\r\n");
    expect(exported.body).not.toMatch(/(?<!\r)\n/);
    expect(exported.body.split("\r\n").filter(Boolean).every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    expect(exported.body.split("\r\n").some((line) => line.startsWith(" "))).toBe(true);
  });
});

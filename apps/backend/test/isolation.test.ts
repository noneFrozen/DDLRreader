import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("user isolation", () => {
  const databases: Database.Database[] = [];
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    databases.splice(0).forEach((database) => database.close());
  });

  it("keeps tasks, availability, and plans private between two users", async () => {
    const database = new Database(":memory:");
    databases.push(database);
    let next = 0;
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => `id-${++next}` });
    apps.push(app);

    const regA = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "a@example.com", password: "password123" } });
    const cookieA = (regA.headers["set-cookie"] as string).split(";")[0];

    await app.inject({ method: "PUT", url: "/api/availability", headers: { cookie: cookieA }, payload: { timezone: "UTC", weeklyRules: [{ id: "mon", weekday: 1, startLocalTime: "09:00", endLocalTime: "12:00", timezone: "UTC" }], exceptions: [] } });
    await app.inject({ method: "POST", url: "/api/tasks", headers: { cookie: cookieA }, payload: { title: "Private task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 60 } });

    const regB = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "b@example.com", password: "password123" } });
    const cookieB = (regB.headers["set-cookie"] as string).split(";")[0];

    const tasksB = await app.inject({ method: "GET", url: "/api/tasks", headers: { cookie: cookieB } });
    expect(tasksB.json()).toEqual([]);

    const availabilityB = await app.inject({ method: "GET", url: "/api/availability", headers: { cookie: cookieB } });
    expect(availabilityB.json().weeklyRules).toEqual([]);

    const planB = await app.inject({ method: "POST", url: "/api/plans", headers: { cookie: cookieB }, payload: { planningDays: 7, allowRisk: true } });
    expect(planB.statusCode).toBe(409);

    const tasksA = await app.inject({ method: "GET", url: "/api/tasks", headers: { cookie: cookieA } });
    expect(tasksA.json()).toHaveLength(1);
  });
});

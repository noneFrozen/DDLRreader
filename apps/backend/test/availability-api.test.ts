import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("availability REST API", () => {
  const databases: Database.Database[] = [];
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    databases.splice(0).forEach((database) => database.close());
  });

  async function app() {
    const database = new Database(":memory:");
    databases.push(database);
    const instance = await buildApp({ database });
    apps.push(instance);
    return instance;
  }

  it("merges overlapping and adjacent weekly ranges into a normalized definition", async () => {
    const instance = await app();
    const saved = await instance.inject({
      method: "PUT", url: "/api/availability",
      payload: {
        timezone: "America/New_York",
        weeklyRules: [
          { id: "first", weekday: 1, startLocalTime: "09:00", endLocalTime: "10:30", timezone: "UTC" },
          { id: "second", weekday: 1, startLocalTime: "10:30", endLocalTime: "12:00", timezone: "UTC" },
        ],
        exceptions: [{ id: "late-wins", date: "2026-03-09", startLocalTime: "14:00", endLocalTime: "15:00", kind: "available" }],
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      timezone: "America/New_York",
      weeklyRules: [{ weekday: 1, startLocalTime: "09:00", endLocalTime: "12:00", timezone: "America/New_York" }],
      exceptions: [{ date: "2026-03-09", startLocalTime: "14:00", endLocalTime: "15:00", kind: "available" }],
    });
    expect((await instance.inject({ method: "GET", url: "/api/availability" })).json()).toEqual(saved.json());
  });

  it("rejects equal local-time endpoints and invalid IANA timezones", async () => {
    const response = await (await app()).inject({
      method: "PUT", url: "/api/availability",
      payload: { timezone: "Mars/Olympus", weeklyRules: [{ id: "equal", weekday: 1, startLocalTime: "09:00", endLocalTime: "09:00", timezone: "Mars/Olympus" }], exceptions: [] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "VALIDATION_ERROR", message: "可用时间信息不完整",
      fieldErrors: { timezone: "请输入有效时区", endLocalTime: "结束时间必须晚于开始时间" },
    });
  });
});

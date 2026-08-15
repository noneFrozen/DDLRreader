import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { seedSession } from "./helpers.js";

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
    const cookie = seedSession(database);
    return { instance, cookie };
  }

  it("merges overlapping and adjacent weekly ranges into a normalized definition", async () => {
    const { instance, cookie } = await app();
    const saved = await instance.inject({
      method: "PUT", url: "/api/availability", headers: { cookie },
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
    expect((await instance.inject({ method: "GET", url: "/api/availability", headers: { cookie } })).json()).toEqual(saved.json());
  });

  it("rejects equal local-time endpoints and invalid IANA timezones", async () => {
    const { instance, cookie } = await app();
    const response = await instance.inject({
      method: "PUT", url: "/api/availability", headers: { cookie },
      payload: { timezone: "Mars/Olympus", weeklyRules: [{ id: "equal", weekday: 1, startLocalTime: "09:00", endLocalTime: "09:00", timezone: "Mars/Olympus" }], exceptions: [] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "VALIDATION_ERROR", message: "可用时间信息不完整",
      fieldErrors: { timezone: "请输入有效时区", endLocalTime: "结束时间必须晚于开始时间" },
    });
  });

  it("round-trips normalized overnight definitions through GET and PUT", async () => {
    const { instance, cookie } = await app();
    const saved = await instance.inject({
      method: "PUT", url: "/api/availability", headers: { cookie },
      payload: { timezone: "Asia/Shanghai", weeklyRules: [{ id: "overnight", weekday: 1, startLocalTime: "22:00", endLocalTime: "02:00", timezone: "Asia/Shanghai" }], exceptions: [] },
    });
    const stored = await instance.inject({ method: "GET", url: "/api/availability", headers: { cookie } });
    const replaced = await instance.inject({ method: "PUT", url: "/api/availability", headers: { cookie }, payload: stored.json() });
    expect(saved.statusCode).toBe(200);
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json()).toEqual(stored.json());
  });

  it("returns Chinese field errors for semantic dates and local-time endpoints", async () => {
    const { instance, cookie } = await app();
    const response = await instance.inject({
      method: "PUT", url: "/api/availability", headers: { cookie },
      payload: {
        timezone: "UTC",
        weeklyRules: [{ id: "bad-rule", weekday: 1, startLocalTime: "25:00", endLocalTime: "10:60", timezone: "UTC" }],
        exceptions: [{ id: "bad-date", date: "2026-02-30", startLocalTime: "09:00", endLocalTime: "10:00", kind: "available" }],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "VALIDATION_ERROR", message: "可用时间信息不完整",
      fieldErrors: { startLocalTime: "请输入有效时间", endLocalTime: "请输入有效时间", date: "请输入有效日期" },
    });
  });

  it("accepts named IANA zones and rejects fixed offsets", async () => {
    const { instance, cookie } = await app();
    for (const timezone of ["UTC", "GMT", "CET", "Asia/Shanghai", "Asia/Kathmandu"]) {
      expect((await instance.inject({ method: "PUT", url: "/api/availability", headers: { cookie }, payload: { timezone, weeklyRules: [], exceptions: [] } })).statusCode).toBe(200);
    }
    for (const timezone of ["+08:00", "-05:30", "+0800", "-0800"]) {
      const offset = await instance.inject({ method: "PUT", url: "/api/availability", headers: { cookie }, payload: { timezone, weeklyRules: [], exceptions: [] } });
      expect(offset.statusCode).toBe(400);
      expect(offset.json()).toEqual({ code: "VALIDATION_ERROR", message: "可用时间信息不完整", fieldErrors: { timezone: "请输入有效时区" } });
    }
  });

  it("validates every incoming weekly-rule timezone before normalizing it", async () => {
    const { instance, cookie } = await app();
    for (const timezone of ["+08:00", "-05:30", "+0800", "-0800"]) {
      const response = await instance.inject({
        method: "PUT", url: "/api/availability", headers: { cookie },
        payload: { timezone: "UTC", weeklyRules: [{ id: "bad-zone", weekday: 1, startLocalTime: "09:00", endLocalTime: "10:00", timezone }], exceptions: [] },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ code: "VALIDATION_ERROR", message: "可用时间信息不完整", fieldErrors: { timezone: "请输入有效时区" } });
    }
  });

  it("preserves duplicate exceptions with distinct stable normalized IDs", async () => {
    const { instance, cookie } = await app();
    const payload = {
      timezone: "UTC", weeklyRules: [],
      exceptions: [
        { id: "first", date: "2026-03-09", startLocalTime: "09:00", endLocalTime: "10:00", kind: "available" },
        { id: "second", date: "2026-03-09", startLocalTime: "09:00", endLocalTime: "10:00", kind: "available" },
      ],
    };
    const saved = await instance.inject({ method: "PUT", url: "/api/availability", headers: { cookie }, payload });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().exceptions.map((exception: { id: string }) => exception.id)).toEqual([
      "exception:available:2026-03-09:09:00:10:00:0",
      "exception:available:2026-03-09:09:00:10:00:1",
    ]);
    const stored = await instance.inject({ method: "GET", url: "/api/availability", headers: { cookie } });
    expect((await instance.inject({ method: "PUT", url: "/api/availability", headers: { cookie }, payload: stored.json() })).json()).toEqual(stored.json());
  });

  it("maps Fastify JSON-schema shape errors to form field errors", async () => {
    const { instance, cookie } = await app();
    const response = await instance.inject({ method: "PUT", url: "/api/availability", headers: { cookie }, payload: { weeklyRules: [], exceptions: [] } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "VALIDATION_ERROR", message: "请求格式不正确", fieldErrors: { timezone: "请输入有效字段" } });
  });
});

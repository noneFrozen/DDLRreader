import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("auth REST API", () => {
  const databases: Database.Database[] = [];
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    databases.splice(0).forEach((database) => database.close());
  });

  async function appWith(ids: string[] = []) {
    const database = new Database(":memory:");
    databases.push(database);
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => ids.shift() ?? "generated" });
    apps.push(app);
    return app;
  }

  it("registers a user, sets a session cookie, and reports the current user", async () => {
    const app = await appWith(["user-1"]);
    const register = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "a@example.com", password: "password123" } });
    expect(register.statusCode).toBe(201);
    expect(register.json()).toMatchObject({ user: { id: "user-1", email: "a@example.com" } });
    const setCookie = register.headers["set-cookie"] as string;
    expect(setCookie).toMatch(/^sid=[a-f0-9]{64};/);

    const sid = setCookie.split(";")[0];
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: sid } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ user: { email: "a@example.com" } });
  });

  it("rejects a duplicate email", async () => {
    const app = await appWith(["user-1", "user-2"]);
    await app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "a@example.com", password: "password123" } });
    const again = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "a@example.com", password: "password456" } });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ code: "EMAIL_TAKEN", message: "该邮箱已注册" });
  });

  it("logs in with the correct password and rejects a wrong one", async () => {
    const app = await appWith(["user-1"]);
    await app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "a@example.com", password: "password123" } });
    const wrong = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "a@example.com", password: "nope" } });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ code: "INVALID_CREDENTIALS", message: "邮箱或密码错误" });

    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "a@example.com", password: "password123" } });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({ user: { email: "a@example.com" } });
  });

  it("logs out and invalidates the session", async () => {
    const app = await appWith(["user-1"]);
    const register = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "a@example.com", password: "password123" } });
    const sid = (register.headers["set-cookie"] as string).split(";")[0];
    await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: sid } });
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: sid } });
    expect(me.statusCode).toBe(401);
  });

  it("returns 401 from a protected route without a session", async () => {
    const app = await appWith();
    const tasks = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(tasks.statusCode).toBe(401);
    expect(tasks.json()).toEqual({ code: "UNAUTHENTICATED", message: "请先登录" });
  });

  it("rejects an invalid email or a short password with field errors", async () => {
    const app = await appWith(["user-1"]);
    const badEmail = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "not-an-email", password: "password123" } });
    expect(badEmail.statusCode).toBe(400);
    expect(badEmail.json()).toEqual({ code: "VALIDATION_ERROR", message: "注册信息不完整", fieldErrors: { email: "请输入有效邮箱" } });
    const shortPassword = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "a@example.com", password: "short" } });
    expect(shortPassword.statusCode).toBe(400);
    expect(shortPassword.json()).toEqual({ code: "VALIDATION_ERROR", message: "注册信息不完整", fieldErrors: { password: "密码至少 8 位" } });
  });
});

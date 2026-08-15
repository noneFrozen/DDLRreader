import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("production app database composition", () => {
  const directories: string[] = [];
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
  const originalPath = process.env.DATABASE_PATH;

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    if (originalPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalPath;
    directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
  });

  it("opens and closes a configured persistent database only when buildApp is called", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ddl-radar-task7-"));
    directories.push(directory);
    process.env.DATABASE_PATH = join(directory, "nested", "ddl-radar.sqlite");
    const first = await buildApp();
    apps.push(first);
    const register = await first.inject({ method: "POST", url: "/api/auth/register", payload: { email: "persist@example.com", password: "password123" } });
    const cookie = (register.headers["set-cookie"] as string).split(";")[0];
    expect((await first.inject({ method: "POST", url: "/api/tasks", headers: { cookie }, payload: { title: "Persist", deadline: "2026-08-20T12:00:00Z", remainingMinutes: 30 } })).statusCode).toBe(201);
    await first.close();
    apps.splice(apps.indexOf(first), 1);
    const second = await buildApp();
    apps.push(second);
    expect((await second.inject({ method: "GET", url: "/api/tasks", headers: { cookie } })).json()).toHaveLength(1);
  });
});

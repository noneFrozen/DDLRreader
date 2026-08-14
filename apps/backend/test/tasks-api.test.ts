import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("task REST API", () => {
  const databases: Database.Database[] = [];
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    databases.splice(0).forEach((database) => database.close());
  });

  async function app() {
    const database = new Database(":memory:");
    databases.push(database);
    const instance = await buildApp({
      database,
      clock: { now: () => new Date("2026-08-14T10:15:30.123Z") },
      idFactory: (() => {
        let next = 1;
        return () => `task-${next++}`;
      })(),
    });
    apps.push(instance);
    return instance;
  }

  it("returns field errors instead of storing an invalid task", async () => {
    const response = await (await app()).inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "", deadline: "not-a-date", remainingMinutes: -1 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "VALIDATION_ERROR",
      message: "任务信息不完整",
      fieldErrors: {
        title: "请输入任务名称",
        deadline: "请输入有效截止时间",
        remainingMinutes: "剩余工时不能为负数",
      },
    });
  });

  it("creates, lists, updates and deletes normalized tasks with dependencies", async () => {
    const instance = await app();
    const predecessor = await instance.inject({ method: "POST", url: "/api/tasks", payload: { title: "Read", deadline: "2026-08-20T12:00:00Z", remainingMinutes: 0 } });
    const created = await instance.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Write", deadline: "2026-08-21T12:00:00Z", remainingMinutes: 31, priority: "high", predecessorTaskIds: ["task-1"] },
    });
    expect(predecessor.statusCode).toBe(201);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ id: "task-2", title: "Write", remainingMinutes: 60, predecessorTaskIds: ["task-1"], createdAt: "2026-08-14T10:15:30.123Z", updatedAt: "2026-08-14T10:15:30.123Z" });
    expect((await instance.inject({ method: "GET", url: "/api/tasks" })).json()).toMatchObject([{ id: "task-2", title: "Write" }]);

    const updated = await instance.inject({ method: "PATCH", url: "/api/tasks/task-2", payload: { title: "Write final", remainingMinutes: 0, predecessorTaskIds: [] } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ title: "Write final", remainingMinutes: 0, predecessorTaskIds: [] });
    expect((await instance.inject({ method: "DELETE", url: "/api/tasks/task-2" })).statusCode).toBe(204);
    expect((await instance.inject({ method: "DELETE", url: "/api/tasks/task-2" })).json()).toEqual({ code: "TASK_NOT_FOUND", message: "任务不存在" });
  });

  it("rejects unknown predecessors and dependency cycles before persistence", async () => {
    const instance = await app();
    const missing = await instance.inject({ method: "POST", url: "/api/tasks", payload: { title: "Write", deadline: "2026-08-21T12:00:00Z", remainingMinutes: 30, predecessorTaskIds: ["missing"] } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({ code: "VALIDATION_ERROR", message: "任务信息不完整", fieldErrors: { predecessorTaskIds: "前置任务不存在" } });

    await instance.inject({ method: "POST", url: "/api/tasks", payload: { title: "First", deadline: "2026-08-21T12:00:00Z", remainingMinutes: 30 } });
    await instance.inject({ method: "POST", url: "/api/tasks", payload: { title: "Second", deadline: "2026-08-22T12:00:00Z", remainingMinutes: 30, predecessorTaskIds: ["task-1"] } });
    const cycle = await instance.inject({ method: "PATCH", url: "/api/tasks/task-1", payload: { predecessorTaskIds: ["task-2"] } });
    expect(cycle.statusCode).toBe(409);
    expect(cycle.json()).toEqual({ code: "DEPENDENCY_CYCLE", message: "任务依赖不能形成循环" });
  });

  it("keeps status consistent with normalized remaining work except archived tasks", async () => {
    const instance = await app();
    const zero = await instance.inject({ method: "POST", url: "/api/tasks", payload: { title: "Zero", deadline: "2026-08-20T12:00:00Z", remainingMinutes: 0, status: "active" } });
    expect(zero.json()).toMatchObject({ remainingMinutes: 0, status: "completed" });
    const positive = await instance.inject({ method: "POST", url: "/api/tasks", payload: { title: "Positive", deadline: "2026-08-21T12:00:00Z", remainingMinutes: 1, status: "completed" } });
    expect(positive.json()).toMatchObject({ remainingMinutes: 30, status: "active" });
    const archived = await instance.inject({ method: "POST", url: "/api/tasks", payload: { title: "Archived", deadline: "2026-08-22T12:00:00Z", remainingMinutes: 0, status: "archived" } });
    expect(archived.json()).toMatchObject({ status: "archived" });
    const patched = await instance.inject({ method: "PATCH", url: "/api/tasks/task-2", payload: { remainingMinutes: 0, status: "active" } });
    expect(patched.json()).toMatchObject({ remainingMinutes: 0, status: "completed" });
  });

  it("rejects missing course references before changing a task or its dependencies", async () => {
    const instance = await app();
    const database = databases.at(-1)!;
    const missing = await instance.inject({ method: "POST", url: "/api/tasks", payload: { courseId: "missing-course", title: "Missing", deadline: "2026-08-20T12:00:00Z", remainingMinutes: 30 } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({ code: "VALIDATION_ERROR", message: "任务信息不完整", fieldErrors: { courseId: "课程不存在" } });

    database.prepare("INSERT INTO courses (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("course-1", "Algorithms", "#40543A", "2026-08-14T10:15:30.123Z", "2026-08-14T10:15:30.123Z");
    const task = await instance.inject({ method: "POST", url: "/api/tasks", payload: { courseId: "course-1", title: "Saved", deadline: "2026-08-20T12:00:00Z", remainingMinutes: 30 } });
    const predecessor = await instance.inject({ method: "POST", url: "/api/tasks", payload: { title: "Predecessor", deadline: "2026-08-21T12:00:00Z", remainingMinutes: 30 } });
    expect(task.statusCode).toBe(201);
    expect(task.json()).toMatchObject({ courseId: "course-1" });
    expect(predecessor.statusCode).toBe(201);

    const failedPatch = await instance.inject({ method: "PATCH", url: "/api/tasks/task-1", payload: { courseId: "missing-course", title: "Changed", predecessorTaskIds: ["task-2"] } });
    expect(failedPatch.statusCode).toBe(400);
    expect(failedPatch.json()).toEqual({ code: "VALIDATION_ERROR", message: "任务信息不完整", fieldErrors: { courseId: "课程不存在" } });
    expect((await instance.inject({ method: "GET", url: "/api/tasks" })).json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "task-1", title: "Saved", courseId: "course-1", predecessorTaskIds: [] }),
    ]));
  });
});

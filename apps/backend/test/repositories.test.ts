import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { AvailabilityDefinition, StoredPlan, Task } from "../../../packages/domain/src/types.js";
import { migrate } from "../src/db/migrate.js";
import { SqliteAvailabilityRepository } from "../src/repositories/availability-repository.js";
import { SqlitePlanRepository } from "../src/repositories/plan-repository.js";
import { SqliteTaskRepository } from "../src/repositories/task-repository.js";

const taskFixture: Task = {
  id: "task-1",
  courseId: null,
  title: "Write essay",
  deadline: "2026-08-20T10:15:30.123Z",
  remainingMinutes: 90,
  priority: "high",
  splittable: true,
  minimumBlockMinutes: 30,
  status: "active",
  createdAt: "2026-08-14T10:15:30.123Z",
  updatedAt: "2026-08-14T11:15:30.123Z",
};

const availabilityFixture: AvailabilityDefinition = {
  timezone: "Asia/Shanghai",
  weeklyRules: [
    { id: "rule-z", weekday: 5, startLocalTime: "18:00", endLocalTime: "20:00", timezone: "Asia/Shanghai" },
    { id: "rule-a", weekday: 1, startLocalTime: "09:00", endLocalTime: "12:00", timezone: "Asia/Shanghai" },
  ],
  exceptions: [
    { id: "exception-z", date: "2026-08-21", startLocalTime: "13:00", endLocalTime: "14:30", kind: "available" },
    { id: "exception-a", date: "2026-08-17", startLocalTime: "10:00", endLocalTime: "11:00", kind: "unavailable" },
  ],
};

const validPlan: StoredPlan = {
  id: "plan-1",
  rangeStart: "2026-08-14T00:00:00.000Z",
  rangeEnd: "2026-08-21T00:00:00.000Z",
  version: 1,
  riskLevel: "yellow",
  unscheduledMinutes: 15,
  createdAt: "2026-08-14T12:00:00.000Z",
  blocks: [{ id: "block-1", taskId: "task-1", startAt: "2026-08-14T13:00:00.000Z", endAt: "2026-08-14T14:00:00.000Z", status: "planned", locked: false }],
};

const overlappingPlan: StoredPlan = {
  ...validPlan,
  id: "plan-2",
  version: 2,
  blocks: [
    validPlan.blocks[0],
    { id: "block-2", taskId: "task-1", startAt: "2026-08-14T13:30:00.000Z", endAt: "2026-08-14T14:30:00.000Z", status: "planned", locked: false },
  ],
};

describe("SQLite repositories", () => {
  const databases: Database.Database[] = [];

  afterEach(() => databases.splice(0).forEach((database) => database.close()));

  function database(): Database.Database {
    const connection = new Database(":memory:");
    migrate(connection);
    databases.push(connection);
    return connection;
  }

  function legacyDatabase(): Database.Database {
    const connection = new Database(":memory:");
    connection.pragma("foreign_keys = ON");
    connection.exec(`
      CREATE TABLE courses (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, course_id TEXT REFERENCES courses(id) ON DELETE SET NULL, title TEXT NOT NULL,
        deadline TEXT NOT NULL, remaining_minutes INTEGER NOT NULL, priority TEXT NOT NULL, splittable INTEGER NOT NULL,
        minimum_block_minutes INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE task_dependencies (
        predecessor_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        successor_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        UNIQUE(predecessor_task_id, successor_task_id)
      );
      CREATE TABLE availability_settings (id INTEGER PRIMARY KEY CHECK (id = 1), timezone TEXT NOT NULL);
      CREATE TABLE availability_rules (
        id TEXT PRIMARY KEY, weekday INTEGER NOT NULL, start_local_time TEXT NOT NULL, end_local_time TEXT NOT NULL, timezone TEXT NOT NULL
      );
      CREATE TABLE availability_exceptions (
        id TEXT PRIMARY KEY, date TEXT NOT NULL, start_local_time TEXT NOT NULL, end_local_time TEXT NOT NULL, kind TEXT NOT NULL
      );
      CREATE TABLE plans (
        id TEXT PRIMARY KEY, range_start TEXT NOT NULL, range_end TEXT NOT NULL, version INTEGER NOT NULL UNIQUE,
        risk_level TEXT NOT NULL, unscheduled_minutes INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE schedule_blocks (
        id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES tasks(id), start_at TEXT NOT NULL, end_at TEXT NOT NULL,
        status TEXT NOT NULL, locked INTEGER NOT NULL
      );
    `);
    connection.prepare("INSERT INTO courses (id, name) VALUES (?, ?)").run("legacy-course", "Legacy course");
    connection.prepare(`
      INSERT INTO tasks (id, course_id, title, deadline, remaining_minutes, priority, splittable, minimum_block_minutes, status, created_at, updated_at)
      VALUES (@id, @courseId, @title, @deadline, @remainingMinutes, @priority, @splittable, @minimumBlockMinutes, @status, @createdAt, @updatedAt)
    `).run({ ...taskFixture, id: "legacy-task", courseId: "legacy-course", splittable: 1 });
    connection.prepare("INSERT INTO availability_settings (id, timezone) VALUES (?, ?)").run(1, "Asia/Shanghai");
    connection.prepare("INSERT INTO availability_rules (id, weekday, start_local_time, end_local_time, timezone) VALUES (?, ?, ?, ?, ?)")
      .run("legacy-rule-z", 5, "18:00", "20:00", "Asia/Shanghai");
    connection.prepare("INSERT INTO availability_rules (id, weekday, start_local_time, end_local_time, timezone) VALUES (?, ?, ?, ?, ?)")
      .run("legacy-rule-a", 1, "09:00", "12:00", "Asia/Shanghai");
    connection.prepare("INSERT INTO availability_exceptions (id, date, start_local_time, end_local_time, kind) VALUES (?, ?, ?, ?, ?)")
      .run("legacy-exception-z", "2026-08-21", "13:00", "14:30", "available");
    connection.prepare("INSERT INTO availability_exceptions (id, date, start_local_time, end_local_time, kind) VALUES (?, ?, ?, ?, ?)")
      .run("legacy-exception-a", "2026-08-17", "10:00", "11:00", "unavailable");
    connection.prepare("INSERT INTO plans (id, range_start, range_end, version, risk_level, unscheduled_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("legacy-plan", validPlan.rangeStart, validPlan.rangeEnd, 1, validPlan.riskLevel, validPlan.unscheduledMinutes, validPlan.createdAt);
    const insertLegacyBlock = connection.prepare("INSERT INTO schedule_blocks (id, plan_id, task_id, start_at, end_at, status, locked) VALUES (?, ?, ?, ?, ?, ?, ?)");
    insertLegacyBlock.run("legacy-block-later", "legacy-plan", "legacy-task", "2026-08-14T15:00:00.000Z", "2026-08-14T16:00:00.000Z", "planned", 0);
    insertLegacyBlock.run("legacy-block-earlier", "legacy-plan", "legacy-task", "2026-08-14T13:00:00.000Z", "2026-08-14T14:00:00.000Z", "planned", 1);
    databases.push(connection);
    return connection;
  }

  function planRepository(): SqlitePlanRepository {
    const connection = database();
    new SqliteTaskRepository(connection).save(taskFixture);
    return new SqlitePlanRepository(connection);
  }

  it("round-trips a task without changing UTC timestamps", () => {
    const repository = new SqliteTaskRepository(database());
    repository.save(taskFixture);
    expect(repository.get(taskFixture.id)).toEqual(taskFixture);
    expect(repository.listActive()).toEqual([taskFixture]);
  });

  it("creates Course rows with the complete SPEC fields", () => {
    const connection = database();
    connection.prepare("INSERT INTO courses (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("course-1", "Algorithms", "#2563eb", "2026-08-14T10:15:30.123Z", "2026-08-14T11:15:30.123Z");
    expect(connection.prepare("SELECT color, created_at, updated_at FROM courses WHERE id = ?").get("course-1")).toEqual({
      color: "#2563eb",
      created_at: "2026-08-14T10:15:30.123Z",
      updated_at: "2026-08-14T11:15:30.123Z",
    });
  });

  it("upgrades the original Task 6 schema without losing persisted repository data", () => {
    const connection = legacyDatabase();
    migrate(connection);
    expect(connection.prepare("SELECT id, name, color, created_at, updated_at FROM courses WHERE id = ?").get("legacy-course")).toMatchObject({ id: "legacy-course", name: "Legacy course" });
    expect(connection.prepare("SELECT color, created_at, updated_at FROM courses WHERE id = ?").get("legacy-course")).toEqual({
      color: "#6b7280",
      created_at: "1970-01-01T00:00:00.000Z",
      updated_at: "1970-01-01T00:00:00.000Z",
    });
    const availability = new SqliteAvailabilityRepository(connection);
    expect(availability.get().weeklyRules.map((rule) => rule.id)).toEqual(["legacy-rule-z", "legacy-rule-a"]);
    expect(availability.get().exceptions.map((exception) => exception.id)).toEqual(["legacy-exception-z", "legacy-exception-a"]);
    availability.replace(availabilityFixture);
    expect(availability.get()).toEqual(availabilityFixture);
    const plans = new SqlitePlanRepository(connection);
    expect(plans.getById("legacy-plan")?.blocks.map((block) => block.id)).toEqual(["legacy-block-later", "legacy-block-earlier"]);
    plans.savePlan({
      ...validPlan,
      id: "post-migration-plan",
      version: 2,
      blocks: [{ ...validPlan.blocks[0], id: "post-migration-block", taskId: "legacy-task" }],
    });
    expect(plans.getLatest()?.id).toBe("post-migration-plan");
    expect(() => connection.prepare("UPDATE tasks SET splittable = 2 WHERE id = ?").run("legacy-task")).toThrow();
    expect(() => connection.prepare("UPDATE schedule_blocks SET locked = 2 WHERE id = ?").run("legacy-block-later")).toThrow();
  });

  it("refuses a legacy migration inside a caller transaction without changing the schema or course links", () => {
    const connection = legacyDatabase();
    connection.exec("BEGIN");
    try {
      expect(() => migrate(connection)).toThrow("migrations cannot run inside a transaction");
      expect(connection.prepare("SELECT course_id FROM tasks WHERE id = ?").get("legacy-task")).toEqual({ course_id: "legacy-course" });
      expect(connection.pragma("foreign_keys", { simple: true })).toBe(1);
      expect((connection.prepare("PRAGMA table_info(courses)").all() as { name: string }[]).map((column) => column.name)).not.toContain("color");
    } finally {
      connection.exec("ROLLBACK");
    }
    expect(connection.prepare("SELECT course_id FROM tasks WHERE id = ?").get("legacy-task")).toEqual({ course_id: "legacy-course" });
    expect(connection.pragma("foreign_keys", { simple: true })).toBe(1);
    expect((connection.prepare("PRAGMA table_info(courses)").all() as { name: string }[]).map((column) => column.name)).not.toContain("color");
  });

  it("round-trips availability definitions without resolving business rules", () => {
    const repository = new SqliteAvailabilityRepository(database());
    repository.replace(availabilityFixture);
    expect(repository.get()).toEqual(availabilityFixture);
  });

  it("preserves StoredPlan block order rather than sorting blocks", () => {
    const repository = planRepository();
    const orderedPlan: StoredPlan = {
      ...validPlan,
      id: "plan-ordered",
      version: 2,
      blocks: [
        { id: "block-later", taskId: "task-1", startAt: "2026-08-14T15:00:00.000Z", endAt: "2026-08-14T16:00:00.000Z", status: "planned", locked: false },
        { id: "block-earlier", taskId: "task-1", startAt: "2026-08-14T13:00:00.000Z", endAt: "2026-08-14T14:00:00.000Z", status: "planned", locked: true },
      ],
    };
    repository.savePlan(orderedPlan);
    expect(repository.getById(orderedPlan.id)).toEqual(orderedPlan);
  });

  it("does not replace the active plan when writing an overlapping block fails", () => {
    const repository = planRepository();
    repository.savePlan(validPlan);
    expect(() => repository.savePlan(overlappingPlan)).toThrow("schedule blocks overlap");
    expect(repository.getLatest()).toEqual(validPlan);
  });

  it("rejects an invalid block interval before replacing the active plan", () => {
    const repository = planRepository();
    repository.savePlan(validPlan);
    const invalidPlan: StoredPlan = {
      ...validPlan,
      id: "plan-invalid",
      version: 2,
      blocks: [{ ...validPlan.blocks[0], id: "block-invalid", startAt: "2026-08-14T14:00:00.000Z", endAt: "2026-08-14T14:00:00.000Z" }],
    };
    expect(() => repository.savePlan(invalidPlan)).toThrow("schedule block end must be after start");
    expect(repository.getLatest()).toEqual(validPlan);
  });

  it("retrieves and updates persisted plan blocks", () => {
    const repository = planRepository();
    repository.savePlan(validPlan);
    repository.updateBlock({ ...validPlan.blocks[0], status: "completed", locked: true });
    expect(repository.getById(validPlan.id)).toEqual({
      ...validPlan,
      blocks: [{ ...validPlan.blocks[0], status: "completed", locked: true }],
    });
  });

  it("does not update a block to a non-positive interval", () => {
    const repository = planRepository();
    repository.savePlan(validPlan);
    expect(() => repository.updateBlock({ ...validPlan.blocks[0], startAt: "2026-08-14T14:00:00.000Z", endAt: "2026-08-14T14:00:00.000Z" }))
      .toThrow("schedule block end must be after start");
    expect(repository.getById(validPlan.id)).toEqual(validPlan);
  });

  it("does not update a block to overlap another block in its plan", () => {
    const repository = planRepository();
    const plan: StoredPlan = {
      ...validPlan,
      blocks: [
        validPlan.blocks[0],
        { id: "block-2", taskId: "task-1", startAt: "2026-08-14T15:00:00.000Z", endAt: "2026-08-14T16:00:00.000Z", status: "planned", locked: false },
      ],
    };
    repository.savePlan(plan);
    expect(() => repository.updateBlock({ ...plan.blocks[0], startAt: "2026-08-14T15:30:00.000Z", endAt: "2026-08-14T16:30:00.000Z" }))
      .toThrow("schedule blocks overlap");
    expect(repository.getById(plan.id)).toEqual(plan);
  });

  it("rolls back a plan row when a later block insert violates a task foreign key", () => {
    const repository = planRepository();
    repository.savePlan(validPlan);
    const failedPlan: StoredPlan = {
      ...validPlan,
      id: "plan-failed-foreign-key",
      version: 2,
      blocks: [{ ...validPlan.blocks[0], id: "block-missing-task", taskId: "missing-task" }],
    };
    expect(() => repository.savePlan(failedPlan)).toThrow();
    expect(repository.getById(failedPlan.id)).toBeNull();
    expect(repository.getLatest()).toEqual(validPlan);
  });

  it("stores task booleans as 0 or 1 and rejects other values", () => {
    const connection = database();
    const repository = new SqliteTaskRepository(connection);
    repository.save({ ...taskFixture, id: "task-false", splittable: false });
    expect(connection.prepare("SELECT splittable FROM tasks WHERE id = ?").get("task-false")).toEqual({ splittable: 0 });
    expect(repository.get("task-false")).toEqual({ ...taskFixture, id: "task-false", splittable: false });
    expect(() => connection.prepare("UPDATE tasks SET splittable = 2 WHERE id = ?").run("task-false")).toThrow();
  });

  it("stores schedule block booleans as 0 or 1 and rejects other values", () => {
    const connection = database();
    new SqliteTaskRepository(connection).save(taskFixture);
    const repository = new SqlitePlanRepository(connection);
    repository.savePlan(validPlan);
    expect(connection.prepare("SELECT locked FROM schedule_blocks WHERE id = ?").get("block-1")).toEqual({ locked: 0 });
    expect(repository.getById(validPlan.id)).toEqual(validPlan);
    expect(() => connection.prepare("UPDATE schedule_blocks SET locked = 2 WHERE id = ?").run("block-1")).toThrow();
  });
});

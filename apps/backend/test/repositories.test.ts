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
  weeklyRules: [{ id: "rule-1", weekday: 1, startLocalTime: "09:00", endLocalTime: "12:00", timezone: "Asia/Shanghai" }],
  exceptions: [{ id: "exception-1", date: "2026-08-17", startLocalTime: "13:00", endLocalTime: "14:30", kind: "available" }],
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

  it("round-trips availability definitions without resolving business rules", () => {
    const repository = new SqliteAvailabilityRepository(database());
    repository.replace(availabilityFixture);
    expect(repository.get()).toEqual(availabilityFixture);
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
});

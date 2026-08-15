# 统计看板与日程交互增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a statistics dashboard (task overview, priority distribution, daily workload) and a full schedule-interaction upgrade (visual timeline, drag, block status, undo/redo, split/merge) to the existing DDL Radar implementation.

**Architecture:** Statistics are aggregated in a backend service (`services/stats.ts`) behind a new `GET /api/stats` and rendered with hand-written SVG in a new Step 05. Schedule editing adds pure domain functions (`schedule-editing.ts`) for split/merge, two new REST endpoints, and a rewritten `WeekTimeline` with a `BlockEditor` plus an undo/redo hook.

**Tech Stack:** TypeScript, Node.js 22, npm workspaces, React 19, Fastify, better-sqlite3, Vitest, Testing Library, Playwright.

## Global Constraints

- Workspace root is the worktree at `.worktrees/opencode-cold-start` (branch `codex/implementation`). Run every command with that directory as `workdir`.
- Deterministic 30-minute blocks; `BLOCK_MINUTES = 30` (`packages/domain/src/time.ts`).
- No new runtime dependency: charts are hand-written SVG/CSS; no chart library.
- Error responses use the unified `{ code, message, fieldErrors?, details? }` shape via `ApiError` (`apps/backend/src/http/error-handler.ts`).
- UI tokens are `--color-*` from `apps/frontend/src/styles/tokens.css`; risk colors `--color-risk-high/warn/ok`.
- All writes validated at API boundary; `crypto.randomUUID()` via `idFactory` (backend `buildApp`).
- Business rules live in `packages/domain`; persistence behind repository interfaces; the API orchestrates.
- Red–green–refactor: every behavior change starts with a failing test.
- `npm test`, `npm run typecheck`, `npm run build` must pass; `npm test` is the one-command entry point.
- Do NOT touch the 3 unrelated uncommitted files in the worktree (`.gitignore`, `apps/frontend/src/app/App.tsx`, `apps/frontend/src/features/availability/AvailabilityStep.tsx`) — preserve their content when editing those files. `App.tsx` and `.gitignore` are edited in this plan; keep the pre-existing uncommitted lines intact.

---

## File Structure

```text
packages/domain/src/schedule-editing.ts        # NEW  splitBlock / mergeBlocks / ScheduleEditError
packages/domain/src/index.ts                   # MOD   export schedule-editing
packages/domain/src/types.ts                   # MOD   PlanRepository.replaceBlocks
packages/domain/test/schedule-editing.test.ts  # NEW
apps/backend/src/services/stats.ts             # NEW  buildStats pure aggregation
apps/backend/src/routes/stats.ts               # NEW  GET /api/stats
apps/backend/src/routes/schedule-editing.ts    # NEW  split/merge endpoints
apps/backend/src/repositories/plan-repository.ts # MOD replaceBlocks
apps/backend/src/app.ts                        # MOD  register stats + schedule-editing routes
apps/backend/test/stats-api.test.ts            # NEW
apps/backend/test/schedule-editing-api.test.ts # NEW
apps/frontend/src/api/client.ts                # MOD  getStats / split / merge + types
apps/frontend/src/features/stats/StatsDashboard.tsx # NEW
apps/frontend/src/features/stats/PriorityDonut.tsx  # NEW
apps/frontend/src/features/stats/DailyLoadBars.tsx  # NEW
apps/frontend/src/components/StepNavigation.tsx     # MOD  5th step
apps/frontend/src/app/App.tsx                       # MOD  step 5 wiring (preserve uncommitted lines)
apps/frontend/src/features/plan/useUndoHistory.ts   # NEW
apps/frontend/src/features/plan/WeekTimeline.tsx    # MOD  visual timeline + keyboard nudge + drag
apps/frontend/src/features/plan/BlockEditor.tsx     # NEW  move/lock/status/split/merge controls
apps/frontend/src/features/plan/PlanStep.tsx        # MOD  orchestration + undo/redo
apps/frontend/src/styles/global.css                 # MOD  stats + timeline styles
apps/frontend/test/stats-dashboard.test.tsx         # NEW
apps/frontend/test/plan-step.test.tsx               # MOD  update for new interactions
e2e/stats-and-interaction.spec.ts                   # NEW
README.md, SPEC.md, PLAN.md                         # MOD  docs
```

---

### Task 1: Domain Split/Merge Functions

**Files:**
- Create: `packages/domain/src/schedule-editing.ts`
- Create: `packages/domain/test/schedule-editing.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `ScheduleBlock`, `BLOCK_MINUTES` (from `./types.js`, `./time.js`).
- Produces: `ScheduleEditError` (with `code`), `splitBlock(block, at, leftId, rightId): [ScheduleBlock, ScheduleBlock]`, `mergeBlocks(left, right): ScheduleBlock`.

- [ ] **Step 1: Write the failing tests**

Create `packages/domain/test/schedule-editing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mergeBlocks, ScheduleEditError, splitBlock } from "../src/schedule-editing.js";
import type { ScheduleBlock } from "../src/types.js";

function block(overrides: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return {
    id: "block-1",
    taskId: "task-1",
    startAt: "2026-08-18T10:00:00.000Z",
    endAt: "2026-08-18T11:30:00.000Z",
    status: "planned",
    locked: false,
    ...overrides,
  };
}

describe("splitBlock", () => {
  it("splits a block at an aligned point into two inheriting segments", () => {
    const [left, right] = splitBlock(block(), "2026-08-18T10:30:00.000Z", "left-id", "right-id");
    expect(left).toEqual({ ...block(), id: "left-id", endAt: "2026-08-18T10:30:00.000Z" });
    expect(right).toEqual({ ...block(), id: "right-id", startAt: "2026-08-18T10:30:00.000Z" });
  });

  it("rejects a split point outside the block", () => {
    expect(() => splitBlock(block(), "2026-08-18T11:30:00.000Z", "l", "r")).toThrow(ScheduleEditError);
  });

  it("rejects a split point not aligned to 30 minutes from the start", () => {
    expect(() => splitBlock(block(), "2026-08-18T10:20:00.000Z", "l", "r")).toThrow(ScheduleEditError);
  });

  it("rejects a split that would produce a segment shorter than 30 minutes", () => {
    expect(() => splitBlock(block(), "2026-08-18T10:10:00.000Z", "l", "r")).toThrow(ScheduleEditError);
  });
});

describe("mergeBlocks", () => {
  it("merges two adjacent same-task blocks into the left block", () => {
    const left = block({ startAt: "2026-08-18T10:00:00.000Z", endAt: "2026-08-18T10:30:00.000Z" });
    const right = block({ id: "block-2", startAt: "2026-08-18T10:30:00.000Z", endAt: "2026-08-18T11:00:00.000Z" });
    expect(mergeBlocks(left, right)).toEqual({ ...left, endAt: "2026-08-18T11:00:00.000Z" });
  });

  it("rejects non-adjacent blocks", () => {
    const left = block({ startAt: "2026-08-18T10:00:00.000Z", endAt: "2026-08-18T10:30:00.000Z" });
    const right = block({ id: "block-2", startAt: "2026-08-18T11:00:00.000Z", endAt: "2026-08-18T11:30:00.000Z" });
    expect(() => mergeBlocks(left, right)).toThrow(ScheduleEditError);
  });

  it("rejects blocks of different tasks", () => {
    const left = block({ startAt: "2026-08-18T10:00:00.000Z", endAt: "2026-08-18T10:30:00.000Z" });
    const right = block({ id: "block-2", taskId: "task-2", startAt: "2026-08-18T10:30:00.000Z", endAt: "2026-08-18T11:00:00.000Z" });
    expect(() => mergeBlocks(left, right)).toThrow(ScheduleEditError);
  });

  it("rejects merging blocks whose status is not planned/started", () => {
    const left = block({ startAt: "2026-08-18T10:00:00.000Z", endAt: "2026-08-18T10:30:00.000Z", status: "completed" });
    const right = block({ id: "block-2", startAt: "2026-08-18T10:30:00.000Z", endAt: "2026-08-18T11:00:00.000Z", status: "completed" });
    expect(() => mergeBlocks(left, right)).toThrow(ScheduleEditError);
  });
});
```

- [ ] **Step 2: Run to confirm red**

Run: `npm --workspace @ddl-radar/domain test -- schedule-editing.test.ts`
Expected: FAIL — `schedule-editing.js` does not exist.

- [ ] **Step 3: Implement the functions**

Create `packages/domain/src/schedule-editing.ts`:

```ts
import { BLOCK_MINUTES } from "./time.js";
import type { ScheduleBlock } from "./types.js";

export class ScheduleEditError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ScheduleEditError";
  }
}

function minutesBetween(startAt: string, endAt: string): number {
  return (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000;
}

export function splitBlock(block: ScheduleBlock, at: string, leftId: string, rightId: string): [ScheduleBlock, ScheduleBlock] {
  const startMs = new Date(block.startAt).getTime();
  const endMs = new Date(block.endAt).getTime();
  const atMs = new Date(at).getTime();
  if (atMs <= startMs || atMs >= endMs) throw new ScheduleEditError("SPLIT_POINT_OUTSIDE", "拆分点必须在块起止时间之间");
  if ((atMs - startMs) % (BLOCK_MINUTES * 60_000) !== 0) throw new ScheduleEditError("SPLIT_NOT_ALIGNED", "拆分点必须对齐 30 分钟块");
  if (minutesBetween(block.startAt, at) < BLOCK_MINUTES || minutesBetween(at, block.endAt) < BLOCK_MINUTES) {
    throw new ScheduleEditError("SPLIT_TOO_SMALL", "拆分后每段至少 30 分钟");
  }
  return [
    { ...block, id: leftId, endAt: at },
    { ...block, id: rightId, startAt: at },
  ];
}

export function mergeBlocks(left: ScheduleBlock, right: ScheduleBlock): ScheduleBlock {
  if (left.taskId !== right.taskId) throw new ScheduleEditError("MERGE_NOT_SAME_TASK", "只能合并同一任务的时间块");
  if (left.endAt !== right.startAt) throw new ScheduleEditError("MERGE_NOT_ADJACENT", "只能合并相邻的时间块");
  if (left.locked !== right.locked) throw new ScheduleEditError("MERGE_LOCK_MISMATCH", "锁定状态不一致的时间块不能合并");
  if (left.status !== right.status || (left.status !== "planned" && left.status !== "started")) {
    throw new ScheduleEditError("MERGE_STATUS_INCOMPATIBLE", "只能合并状态一致且为已计划或进行中的时间块");
  }
  return { ...left, endAt: right.endAt };
}
```

Add to `packages/domain/src/index.ts` (after the existing `generatePlan` export):

```ts
export { ScheduleEditError, splitBlock, mergeBlocks } from "./schedule-editing.js";
```

- [ ] **Step 4: Run to confirm green**

Run: `npm --workspace @ddl-radar/domain test`
Expected: PASS — all domain tests (existing + new) green.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/schedule-editing.ts packages/domain/src/index.ts packages/domain/test/schedule-editing.test.ts
git commit -m "feat(domain): split and merge schedule blocks"
```

---

### Task 2: Statistics Aggregation Service and `/api/stats`

**Files:**
- Create: `apps/backend/src/services/stats.ts`
- Create: `apps/backend/src/routes/stats.ts`
- Create: `apps/backend/test/stats-api.test.ts`
- Modify: `apps/backend/src/app.ts`

**Interfaces:**
- Consumes: `Task`, `StoredPlan`, `AvailabilityBlock` (from domain types), `resolveAvailability` (`./availability.js`), `rangeEndFor` (`./planning.js`), `TaskRepository`, `AvailabilityRepository`, `PlanRepository`, `Clock`.
- Produces: `buildStats(input): StatsResponse`, `registerStatsRoutes(app, tasks, availability, plans, clock)`.

- [ ] **Step 1: Write the failing unit test for `buildStats`**

Create `apps/backend/test/stats-api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildStats } from "../src/services/stats.js";
import type { AvailabilityBlock, ScheduleBlock, StoredPlan, Task } from "../../../packages/domain/src/types.js";

function task(id: string, deadline: string, overrides: Partial<Task> = {}): Task {
  return {
    id, courseId: null, title: id, deadline, remainingMinutes: 60, priority: "medium",
    splittable: true, minimumBlockMinutes: 30, status: "active",
    createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildStats", () => {
  it("aggregates tasks, priorities, and daily workload in the plan timezone", () => {
    const tasks = [
      task("t1", "2026-08-19T12:00:00.000Z", { priority: "high", remainingMinutes: 90 }),
      task("t2", "2026-08-21T12:00:00.000Z", { status: "completed" }),
      task("t3", "2026-08-15T12:00:00.000Z", { priority: "high" }),
    ];
    const availability: AvailabilityBlock[] = [
      { id: "a1", startAt: "2026-08-17T02:00:00.000Z", endAt: "2026-08-17T02:30:00.000Z" }, // 10:00 Asia/Shanghai
      { id: "a2", startAt: "2026-08-18T02:00:00.000Z", endAt: "2026-08-18T02:30:00.000Z" },
      { id: "a3", startAt: "2026-08-18T02:30:00.000Z", endAt: "2026-08-18T03:00:00.000Z" },
    ];
    const blocks: ScheduleBlock[] = [
      { id: "b1", taskId: "t1", startAt: "2026-08-18T02:00:00.000Z", endAt: "2026-08-18T03:00:00.000Z", status: "planned", locked: false },
    ];
    const plan: StoredPlan = {
      id: "plan-1", rangeStart: "2026-08-17T00:00:00.000Z", rangeEnd: "2026-08-19T00:00:00.000Z",
      version: 1, riskLevel: "green", unscheduledMinutes: 0, createdAt: "2026-08-17T00:00:00.000Z", blocks,
    };
    const result = buildStats({ tasks, plan, availability, now: "2026-08-16T00:00:00.000Z", timezone: "Asia/Shanghai" });

    expect(result.taskSummary).toMatchObject({
      activeCount: 2, completedCount: 1, totalRemainingMinutes: 150, dueThisWeekCount: 1,
    });
    expect(result.priorityDistribution).toEqual([
      { priority: "high", count: 2, remainingMinutes: 150 },
      { priority: "medium", count: 0, remainingMinutes: 0 },
      { priority: "low", count: 0, remainingMinutes: 0 },
    ]);
    expect(result.dailyWorkload).toEqual([
      { date: "2026-08-17", scheduledMinutes: 0, capacityMinutes: 30 },
      { date: "2026-08-18", scheduledMinutes: 60, capacityMinutes: 60 },
    ]);
  });

  it("returns zeroed statistics when there are no tasks and no plan", () => {
    const result = buildStats({ tasks: [], plan: null, availability: [], now: "2026-08-16T00:00:00.000Z", timezone: "UTC" });
    expect(result.taskSummary.completionRate).toBe(0);
    expect(result.dailyWorkload).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run to confirm red**

Run: `npm --workspace @ddl-radar/backend test -- stats-api.test.ts`
Expected: FAIL — `services/stats.js` does not exist.

- [ ] **Step 3: Implement the aggregation service**

Create `apps/backend/src/services/stats.ts`:

```ts
import { Temporal } from "@js-temporal/polyfill";
import type { AvailabilityBlock, StoredPlan, Task } from "../../../../packages/domain/src/types.js";

export type Priority = "high" | "medium" | "low";

export type StatsResponse = {
  taskSummary: {
    activeCount: number;
    completedCount: number;
    overdueCount: number;
    totalRemainingMinutes: number;
    dueThisWeekCount: number;
    completionRate: number;
  };
  priorityDistribution: Array<{ priority: Priority; count: number; remainingMinutes: number }>;
  dailyWorkload: Array<{ date: string; scheduledMinutes: number; capacityMinutes: number }>;
};

function localDate(iso: string, timezone: string): string {
  return Temporal.Instant.from(iso).toZonedDateTimeISO(timezone).toPlainDate().toString();
}

export function buildStats(input: {
  tasks: readonly Task[];
  plan: StoredPlan | null;
  availability: readonly AvailabilityBlock[];
  now: string;
  timezone: string;
}): StatsResponse {
  const { tasks, plan, availability, now, timezone } = input;
  const nowMs = new Date(now).getTime();
  const active = tasks.filter((t) => t.status === "active");
  const completed = tasks.filter((t) => t.status === "completed");
  const overdueCount = active.filter((t) => new Date(t.deadline).getTime() < nowMs).length;
  const totalRemainingMinutes = active.reduce((sum, t) => sum + t.remainingMinutes, 0);
  const weekEndMs = nowMs + 7 * 24 * 60 * 60 * 1000;
  const dueThisWeekCount = active.filter((t) => {
    const d = new Date(t.deadline).getTime();
    return d >= nowMs && d < weekEndMs;
  }).length;
  const denominator = completed.length + active.length;
  const completionRate = denominator === 0 ? 0 : completed.length / denominator;

  const priorityDistribution = (["high", "medium", "low"] as const).map((priority) => {
    const byPriority = active.filter((t) => t.priority === priority);
    return {
      priority,
      count: byPriority.length,
      remainingMinutes: byPriority.reduce((sum, t) => sum + t.remainingMinutes, 0),
    };
  });

  const rangeStart = plan?.rangeStart ?? now;
  const rangeEnd = plan?.rangeEnd
    ?? Temporal.Instant.from(now).toZonedDateTimeISO(timezone).add({ days: 7 }).toInstant().toString();
  const startDate = Temporal.Instant.from(rangeStart).toZonedDateTimeISO(timezone).toPlainDate();
  const endDate = Temporal.Instant.from(rangeEnd).toZonedDateTimeISO(timezone).toPlainDate();

  const scheduledByDate = new Map<string, number>();
  for (const block of plan?.blocks ?? []) {
    const date = localDate(block.startAt, timezone);
    const minutes = (new Date(block.endAt).getTime() - new Date(block.startAt).getTime()) / 60_000;
    scheduledByDate.set(date, (scheduledByDate.get(date) ?? 0) + minutes);
  }
  const capacityByDate = new Map<string, number>();
  for (const block of availability) {
    const date = localDate(block.startAt, timezone);
    capacityByDate.set(date, (capacityByDate.get(date) ?? 0) + 30);
  }

  const dailyWorkload: StatsResponse["dailyWorkload"] = [];
  for (let date = startDate; Temporal.PlainDate.compare(date, endDate) <= 0; date = date.add({ days: 1 })) {
    const key = date.toString();
    dailyWorkload.push({
      date: key,
      scheduledMinutes: scheduledByDate.get(key) ?? 0,
      capacityMinutes: capacityByDate.get(key) ?? 0,
    });
  }

  return {
    taskSummary: {
      activeCount: active.length,
      completedCount: completed.length,
      overdueCount,
      totalRemainingMinutes,
      dueThisWeekCount,
      completionRate,
    },
    priorityDistribution,
    dailyWorkload,
  };
}
```

- [ ] **Step 4: Create the route**

Create `apps/backend/src/routes/stats.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { AvailabilityRepository, Clock, PlanRepository, TaskRepository } from "../../../../packages/domain/src/types.js";
import { resolveAvailability } from "../services/availability.js";
import { rangeEndFor } from "../services/planning.js";
import { buildStats } from "../services/stats.js";

export function registerStatsRoutes(
  app: FastifyInstance,
  tasks: TaskRepository,
  availability: AvailabilityRepository,
  plans: PlanRepository,
  clock: Clock,
): void {
  app.get("/api/stats", async () => {
    const definition = availability.get();
    const now = clock.now().toISOString();
    const plan = plans.getLatest();
    const rangeStart = plan?.rangeStart ?? now;
    const rangeEnd = plan?.rangeEnd ?? rangeEndFor(now, definition.timezone, 7);
    return buildStats({
      tasks: tasks.listPlanning(),
      plan,
      availability: resolveAvailability(definition, rangeStart, rangeEnd),
      now,
      timezone: definition.timezone,
    });
  });
}
```

- [ ] **Step 5: Register the route**

In `apps/backend/src/app.ts`, add the import:

```ts
import { registerStatsRoutes } from "./routes/stats.js";
```

and register it after `registerAnalysisRoutes(...)` (keep the existing lines intact):

```ts
registerAnalysisRoutes(app, taskRepository, availabilityRepository, clock);
registerStatsRoutes(app, taskRepository, availabilityRepository, planRepository, clock);
```

- [ ] **Step 6: Add an end-to-end API test**

Append to `apps/backend/test/stats-api.test.ts`:

```ts
import Database from "better-sqlite3";
import { afterEach } from "vitest";
import { buildApp } from "../src/app.js";

describe("stats REST API", () => {
  const databases: Database.Database[] = [];
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    databases.splice(0).forEach((database) => database.close());
  });

  it("serves aggregated stats with zeroed data before any input", async () => {
    const database = new Database(":memory:");
    databases.push(database);
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") } });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/stats" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      taskSummary: { activeCount: 0, completedCount: 0, overdueCount: 0, totalRemainingMinutes: 0, completionRate: 0 },
    });
  });
});
```

Move the `afterEach`/`Database`/`buildApp` imports to the top of the file (merge with existing imports).

- [ ] **Step 7: Run to confirm green**

Run: `npm --workspace @ddl-radar/backend test -- stats-api.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/services/stats.ts apps/backend/src/routes/stats.ts apps/backend/src/app.ts apps/backend/test/stats-api.test.ts
git commit -m "feat(api): aggregate planning statistics"
```

---

### Task 3: Split/Merge REST Endpoints and `replaceBlocks`

**Files:**
- Create: `apps/backend/src/routes/schedule-editing.ts`
- Create: `apps/backend/test/schedule-editing-api.test.ts`
- Modify: `packages/domain/src/types.ts` (add `replaceBlocks` to `PlanRepository`)
- Modify: `apps/backend/src/repositories/plan-repository.ts`
- Modify: `apps/backend/src/app.ts`

**Interfaces:**
- Consumes: `splitBlock`, `mergeBlocks`, `ScheduleEditError` (Task 1), `PlanRepository`, `TaskRepository`, `ApiError`.
- Produces: `PlanRepository.replaceBlocks(planId, blocks)`, `registerScheduleEditingRoutes(app, tasks, plans, idFactory)`, `POST /api/schedule-blocks/:id/split`, `POST /api/schedule-blocks/:id/merge`.

- [ ] **Step 1: Extend the repository interface**

In `packages/domain/src/types.ts`, add to the `PlanRepository` interface (after `updateBlock`):

```ts
  /** Replace every block of a plan in a transaction, recomputing ordinals. */
  replaceBlocks(planId: string, blocks: readonly ScheduleBlock[]): void;
```

- [ ] **Step 2: Implement `replaceBlocks`**

In `apps/backend/src/repositories/plan-repository.ts`, add the method to `SqlitePlanRepository` (after `updateBlock`):

```ts
  replaceBlocks(planId: string, blocks: readonly ScheduleBlock[]): void {
    assertValidBlocks(blocks);
    this.database.transaction(() => {
      this.database.prepare("DELETE FROM schedule_blocks WHERE plan_id = ?").run(planId);
      const insertBlock = this.database.prepare("INSERT INTO schedule_blocks (id, plan_id, task_id, start_at, end_at, status, locked, ordinal) VALUES (@id, @planId, @taskId, @startAt, @endAt, @status, @locked, @ordinal)");
      blocks.forEach((block, ordinal) => insertBlock.run({ ...block, planId, locked: Number(block.locked), ordinal }));
    })();
  }
```

- [ ] **Step 3: Write the failing API tests**

Create `apps/backend/test/schedule-editing-api.test.ts`:

```ts
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { SqlitePlanRepository } from "../src/repositories/plan-repository.js";

const BASE_AVAILABILITY = {
  timezone: "UTC",
  weeklyRules: [{ id: "monday", weekday: 1, startLocalTime: "09:00", endLocalTime: "12:00", timezone: "UTC" }],
  exceptions: [],
};

describe("schedule editing REST API", () => {
  const databases: Database.Database[] = [];
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    databases.splice(0).forEach((database) => database.close());
  });

  function seed(database: Database.Database, idFactory: () => string): { block: { id: string; startAt: string; endAt: string } } {
    const repo = new SqlitePlanRepository(database);
    repo.savePlan({
      id: idFactory(), rangeStart: "2026-08-10T00:00:00.000Z", rangeEnd: "2026-08-17T00:00:00.000Z",
      version: 1, riskLevel: "green", unscheduledMinutes: 0, createdAt: "2026-08-10T00:00:00.000Z",
      blocks: [
        { id: "block-1", taskId: "task-1", startAt: "2026-08-10T09:00:00.000Z", endAt: "2026-08-10T10:00:00.000Z", status: "planned", locked: false },
        { id: "block-2", taskId: "task-1", startAt: "2026-08-10T10:00:00.000Z", endAt: "2026-08-10T11:00:00.000Z", status: "planned", locked: false },
      ],
    });
    return { block: { id: "block-1", startAt: "2026-08-10T09:00:00.000Z", endAt: "2026-08-10T10:00:00.000Z" } };
  }

  it("splits a splittable block into two 30-minute-aligned segments", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const ids = ["task-1", "plan-1"];
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => ids.shift()! });
    apps.push(app);
    await app.inject({ method: "PUT", url: "/api/availability", payload: BASE_AVAILABILITY });
    await app.inject({ method: "POST", url: "/api/tasks", payload: { title: "Task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 120, splittable: true } });
    seed(database, () => "plan-1");

    const response = await app.inject({ method: "POST", url: "/api/schedule-blocks/block-1/split", payload: { at: "2026-08-10T09:30:00.000Z" } });

    expect(response.statusCode).toBe(201);
    const { blocks } = response.json();
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ id: "block-1", startAt: "2026-08-10T09:00:00.000Z", endAt: "2026-08-10T09:30:00.000Z" });
    expect(blocks[1]).toMatchObject({ startAt: "2026-08-10T09:30:00.000Z", endAt: "2026-08-10T10:00:00.000Z" });
  });

  it("rejects splitting a non-splittable task", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const ids = ["task-1", "plan-1"];
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => ids.shift()! });
    apps.push(app);
    await app.inject({ method: "PUT", url: "/api/availability", payload: BASE_AVAILABILITY });
    await app.inject({ method: "POST", url: "/api/tasks", payload: { title: "Task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 120, splittable: false } });
    seed(database, () => "plan-1");

    const response = await app.inject({ method: "POST", url: "/api/schedule-blocks/block-1/split", payload: {} });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: "SPLIT_NOT_ALLOWED", message: "该任务不可拆分" });
  });

  it("merges two adjacent same-task blocks", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const ids = ["task-1", "plan-1"];
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => ids.shift()! });
    apps.push(app);
    await app.inject({ method: "PUT", url: "/api/availability", payload: BASE_AVAILABILITY });
    await app.inject({ method: "POST", url: "/api/tasks", payload: { title: "Task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 120, splittable: true } });
    seed(database, () => "plan-1");

    const response = await app.inject({ method: "POST", url: "/api/schedule-blocks/block-1/merge", payload: {} });

    expect(response.statusCode).toBe(201);
    expect(response.json().block).toMatchObject({ id: "block-1", startAt: "2026-08-10T09:00:00.000Z", endAt: "2026-08-10T11:00:00.000Z" });
  });

  it("rejects merging when there is no adjacent block", async () => {
    const database = new Database(":memory:"); databases.push(database);
    const app = await buildApp({ database, clock: { now: () => new Date("2026-08-10T00:00:00.000Z") }, idFactory: () => "plan-1" });
    apps.push(app);
    await app.inject({ method: "PUT", url: "/api/availability", payload: BASE_AVAILABILITY });
    await app.inject({ method: "POST", url: "/api/tasks", payload: { title: "Task", deadline: "2026-08-11T12:00:00.000Z", remainingMinutes: 120 } });
    new SqlitePlanRepository(database).savePlan({
      id: "plan-1", rangeStart: "2026-08-10T00:00:00.000Z", rangeEnd: "2026-08-17T00:00:00.000Z", version: 1,
      riskLevel: "green", unscheduledMinutes: 0, createdAt: "2026-08-10T00:00:00.000Z",
      blocks: [{ id: "block-1", taskId: "task-1", startAt: "2026-08-10T09:00:00.000Z", endAt: "2026-08-10T10:00:00.000Z", status: "planned", locked: false }],
    });

    const response = await app.inject({ method: "POST", url: "/api/schedule-blocks/block-1/merge", payload: {} });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: "MERGE_NOT_ADJACENT", message: "没有相邻的同任务时间块" });
  });
});
```

Note: the `POST /api/tasks` route requires the fields the existing route validates; verify against `apps/backend/src/routes/tasks.ts` and adjust the payload if it rejects extra fields. If `splittable` is not accepted, use the route's actual schema (the existing task fixtures in `plans-api.test.ts` show a minimal `{ title, deadline, remainingMinutes }` payload works).

- [ ] **Step 4: Run to confirm red**

Run: `npm --workspace @ddl-radar/backend test -- schedule-editing-api.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 5: Implement the routes**

Create `apps/backend/src/routes/schedule-editing.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { PlanRepository, TaskRepository } from "../../../../packages/domain/src/types.js";
import { mergeBlocks, ScheduleEditError, splitBlock } from "../../../../packages/domain/src/schedule-editing.js";
import { ApiError } from "../http/error-handler.js";

const BLOCK_MS = 30 * 60 * 1000;

type SplitBody = { at?: string };
type MergeBody = { with?: "next" | "prev" };

const splitSchema = {
  body: {
    type: "object", additionalProperties: false,
    properties: { at: { type: "string" } },
  },
} as const;

const mergeSchema = {
  body: {
    type: "object", additionalProperties: false,
    properties: { with: { enum: ["next", "prev"] } },
  },
} as const;

function throwEditError(error: unknown): never {
  if (error instanceof ScheduleEditError) throw new ApiError(409, { code: error.code, message: error.message });
  throw error;
}

export function registerScheduleEditingRoutes(
  app: FastifyInstance,
  tasks: TaskRepository,
  plans: PlanRepository,
  idFactory: () => string,
): void {
  app.post<{ Params: { id: string }; Body: SplitBody }>("/api/schedule-blocks/:id/split", { schema: splitSchema }, async (request, reply) => {
    const plan = plans.getLatest();
    if (!plan) throw new ApiError(404, { code: "PLAN_NOT_FOUND", message: "计划不存在" });
    const current = plan.blocks.find((block) => block.id === request.params.id);
    if (!current) throw new ApiError(404, { code: "SCHEDULE_BLOCK_NOT_FOUND", message: "安排不存在" });
    const task = tasks.get(current.taskId);
    if (!task) throw new ApiError(409, { code: "PLAN_TASK_MISSING", message: "计划中的任务不存在" });
    if (current.locked) throw new ApiError(409, { code: "SCHEDULE_BLOCK_LOCKED", message: "已锁定安排不可拆分" });
    if (!task.splittable) throw new ApiError(409, { code: "SPLIT_NOT_ALLOWED", message: "该任务不可拆分" });
    const duration = new Date(current.endAt).getTime() - new Date(current.startAt).getTime();
    if (duration < task.minimumBlockMinutes * 60_000 * 2) throw new ApiError(409, { code: "SPLIT_NOT_ALLOWED", message: "时间块过短，无法拆分" });

    const at = request.body.at
      ?? new Date(new Date(current.startAt).getTime() + Math.floor(duration / 2 / BLOCK_MS) * BLOCK_MS).toISOString();
    try {
      const [left, right] = splitBlock(current, at, current.id, idFactory());
      const remaining = plan.blocks.filter((block) => block.id !== current.id);
      plans.replaceBlocks(plan.id, [...remaining, left, right]);
      return reply.status(201).send({ blocks: [left, right] });
    } catch (error) { throwEditError(error); }
  });

  app.post<{ Params: { id: string }; Body: MergeBody }>("/api/schedule-blocks/:id/merge", { schema: mergeSchema }, async (request, reply) => {
    const plan = plans.getLatest();
    if (!plan) throw new ApiError(404, { code: "PLAN_NOT_FOUND", message: "计划不存在" });
    const current = plan.blocks.find((block) => block.id === request.params.id);
    if (!current) throw new ApiError(404, { code: "SCHEDULE_BLOCK_NOT_FOUND", message: "安排不存在" });
    const task = tasks.get(current.taskId);
    if (!task) throw new ApiError(409, { code: "PLAN_TASK_MISSING", message: "计划中的任务不存在" });
    if (current.locked) throw new ApiError(409, { code: "SCHEDULE_BLOCK_LOCKED", message: "已锁定安排不可合并" });

    const direction = request.body.with ?? "next";
    const neighbor = direction === "next"
      ? plan.blocks.find((block) => block.startAt === current.endAt && block.taskId === current.taskId)
      : plan.blocks.find((block) => block.endAt === current.startAt && block.taskId === current.taskId);
    if (!neighbor) throw new ApiError(409, { code: "MERGE_NOT_ADJACENT", message: "没有相邻的同任务时间块" });
    if (neighbor.locked) throw new ApiError(409, { code: "SCHEDULE_BLOCK_LOCKED", message: "相邻安排已锁定，不可合并" });

    try {
      const left = direction === "next" ? current : neighbor;
      const right = direction === "next" ? neighbor : current;
      const merged = mergeBlocks(left, right);
      const remaining = plan.blocks.filter((block) => block.id !== current.id && block.id !== neighbor.id);
      plans.replaceBlocks(plan.id, [...remaining, merged]);
      return reply.status(201).send({ block: merged });
    } catch (error) { throwEditError(error); }
  });
}
```

- [ ] **Step 6: Register the routes**

In `apps/backend/src/app.ts`, add the import and registration (after `registerPlanRoutes(...)`):

```ts
import { registerScheduleEditingRoutes } from "./routes/schedule-editing.js";
```

```ts
registerPlanRoutes(app, taskRepository, availabilityRepository, planRepository, clock, idFactory, (work) => database.transaction(work)());
registerScheduleEditingRoutes(app, taskRepository, planRepository, idFactory);
```

- [ ] **Step 7: Run to confirm green**

Run: `npm --workspace @ddl-radar/backend test`
Expected: PASS — health, repositories, tasks, availability, analysis, plans, stats, and schedule-editing all green.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/types.ts apps/backend/src/repositories/plan-repository.ts apps/backend/src/routes/schedule-editing.ts apps/backend/src/app.ts apps/backend/test/schedule-editing-api.test.ts
git commit -m "feat(api): split and merge schedule blocks"
```

---

### Task 4: Statistics Dashboard Frontend

**Files:**
- Modify: `apps/frontend/src/api/client.ts`
- Create: `apps/frontend/src/features/stats/PriorityDonut.tsx`
- Create: `apps/frontend/src/features/stats/DailyLoadBars.tsx`
- Create: `apps/frontend/src/features/stats/StatsDashboard.tsx`
- Modify: `apps/frontend/src/components/StepNavigation.tsx`
- Modify: `apps/frontend/src/app/App.tsx`
- Modify: `apps/frontend/src/styles/global.css`
- Create: `apps/frontend/test/stats-dashboard.test.tsx`

**Interfaces:**
- Consumes: `ApiClient` (adds `getStats`), `StatsResponse`, existing `--color-*` tokens.
- Produces: `StatsDashboard({ api })`, `PriorityDonut({ distribution })`, `DailyLoadBars({ daily })`, 5th navigation step "统计看板".

- [ ] **Step 1: Add the `getStats` client method and types**

In `apps/frontend/src/api/client.ts`, after the `PlanResponse` type, add:

```ts
export type StatsResponse = {
  taskSummary: {
    activeCount: number;
    completedCount: number;
    overdueCount: number;
    totalRemainingMinutes: number;
    dueThisWeekCount: number;
    completionRate: number;
  };
  priorityDistribution: Array<{ priority: Priority; count: number; remainingMinutes: number }>;
  dailyWorkload: Array<{ date: string; scheduledMinutes: number; capacityMinutes: number }>;
};
```

In the `ApiClient` interface, after `analyze`, add:

```ts
  getStats(): Promise<StatsResponse>;
```

In the returned object of `createApiClient`, after `analyze`, add:

```ts
    getStats: () => request<StatsResponse>(fetcher, `${baseUrl}/stats`),
```

- [ ] **Step 2: Write the failing dashboard test**

Create `apps/frontend/test/stats-dashboard.test.tsx`:

```tsx
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StatsResponse } from "../src/api/client.js";
import { StatsDashboard } from "../src/features/stats/StatsDashboard.js";

const stats: StatsResponse = {
  taskSummary: { activeCount: 3, completedCount: 1, overdueCount: 1, totalRemainingMinutes: 180, dueThisWeekCount: 2, completionRate: 0.25 },
  priorityDistribution: [
    { priority: "high", count: 2, remainingMinutes: 150 },
    { priority: "medium", count: 1, remainingMinutes: 30 },
    { priority: "low", count: 0, remainingMinutes: 0 },
  ],
  dailyWorkload: [
    { date: "2026-08-17", scheduledMinutes: 60, capacityMinutes: 120 },
    { date: "2026-08-18", scheduledMinutes: 90, capacityMinutes: 60 },
  ],
};

describe("StatsDashboard", () => {
  afterEach(cleanup);

  it("renders overview cards, priority distribution, and daily workload", async () => {
    const api = { getStats: vi.fn().mockResolvedValue(stats) };
    render(<StatsDashboard api={api} />);

    await waitFor(() => expect(screen.getByText("活跃任务")).toBeVisible());
    expect(screen.getByText("3")).toBeVisible();
    expect(screen.getByText("25%")).toBeVisible();
    expect(screen.getByRole("img", { name: /优先级分布/ })).toBeVisible();
    expect(screen.getByRole("img", { name: /每日负载/ })).toBeVisible();
    expect(screen.getByText(/高优先级 2 项/)).toBeVisible();
  });

  it("shows a retry action when loading fails", async () => {
    const api = { getStats: vi.fn().mockRejectedValue(new Error("加载失败")) };
    render(<StatsDashboard api={api} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "重试" })).toBeVisible());
    expect(screen.getByRole("alert")).toHaveTextContent("加载失败");
  });
});
```

- [ ] **Step 3: Run to confirm red**

Run: `npm --workspace @ddl-radar/frontend test -- stats-dashboard.test.tsx`
Expected: FAIL — `StatsDashboard` does not exist.

- [ ] **Step 4: Implement the donut chart**

Create `apps/frontend/src/features/stats/PriorityDonut.tsx`:

```tsx
type DistributionItem = { priority: "high" | "medium" | "low"; count: number; remainingMinutes: number };

const colors: Record<string, string> = { high: "var(--color-risk-high)", medium: "var(--color-risk-warn)", low: "var(--color-risk-ok)" };
const labels: Record<string, string> = { high: "高", medium: "中", low: "低" };

export function PriorityDonut({ distribution }: { distribution: readonly DistributionItem[] }) {
  const total = distribution.reduce((sum, item) => sum + item.count, 0);
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const ariaLabel = `优先级分布：${distribution.map((d) => `${labels[d.priority]}优先级 ${d.count} 项`).join("，") || "暂无任务"}`;

  return (
    <figure className="stats-donut">
      <svg viewBox="0 0 160 160" role="img" aria-label={ariaLabel}>
        <circle cx="80" cy="80" r={radius} fill="none" stroke="var(--color-border)" strokeWidth="20" />
        {total > 0 && distribution.map((item) => {
          const length = (item.count / total) * circumference;
          const segment = (
            <circle
              key={item.priority}
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke={colors[item.priority]}
              strokeWidth="20"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 80 80)"
            />
          );
          offset += length;
          return segment;
        })}
      </svg>
      <figcaption className="stats-donut__legend">
        {distribution.map((item) => (
          <span key={item.priority}>
            <i style={{ backgroundColor: colors[item.priority] }} aria-hidden="true" />
            {labels[item.priority]}优先级 {item.count} 项 · {item.remainingMinutes / 60} 小时
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
```

- [ ] **Step 5: Implement the bar chart**

Create `apps/frontend/src/features/stats/DailyLoadBars.tsx`:

```tsx
type DailyItem = { date: string; scheduledMinutes: number; capacityMinutes: number };

function dayLabel(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${month}/${day}`;
}

export function DailyLoadBars({ daily }: { daily: readonly DailyItem[] }) {
  const maxMinutes = Math.max(1, ...daily.map((d) => Math.max(d.scheduledMinutes, d.capacityMinutes)));
  const width = 640;
  const barArea = 220;
  const labelHeight = 22;
  const slot = width / daily.length;
  const barWidth = Math.max(8, Math.min(20, slot / 2 - 3));
  const perMinute = barArea / maxMinutes;

  return (
    <figure className="stats-bars">
      <svg viewBox={`0 0 ${width} ${barArea + labelHeight}`} role="img" aria-label="每日负载图">
        {daily.map((day, index) => {
          const centerX = index * slot + slot / 2;
          const capHeight = day.capacityMinutes * perMinute;
          const schedHeight = day.scheduledMinutes * perMinute;
          const overloaded = day.scheduledMinutes > day.capacityMinutes;
          return (
            <g key={day.date}>
              <rect x={centerX - barWidth - 2} y={barArea - capHeight} width={barWidth} height={capHeight} fill="var(--color-border)" rx="4" />
              <rect x={centerX + 2} y={barArea - schedHeight} width={barWidth} height={schedHeight} fill={overloaded ? "var(--color-risk-high)" : "var(--color-risk-ok)"} rx="4" />
              <text x={centerX} y={barArea + 15} fontSize="10" fill="var(--color-fg)" textAnchor="middle">{dayLabel(day.date)}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="stats-bars__legend">
        <span><i style={{ backgroundColor: "var(--color-border)" }} aria-hidden="true" />可用容量</span>
        <span><i style={{ backgroundColor: "var(--color-risk-ok)" }} aria-hidden="true" />已排工时</span>
      </figcaption>
    </figure>
  );
}
```

- [ ] **Step 6: Implement the dashboard**

Create `apps/frontend/src/features/stats/StatsDashboard.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import type { ApiClient, StatsResponse } from "../../api/client.js";
import { DailyLoadBars } from "./DailyLoadBars.js";
import { PriorityDonut } from "./PriorityDonut.js";

type StatsDashboardProps = { api: Pick<ApiClient, "getStats"> };

export function StatsDashboard({ api }: StatsDashboardProps) {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    void api.getStats()
      .then((result) => { setStats(result); setLoading(false); })
      .catch((reason: Error) => { setError(reason.message); setLoading(false); });
  }, [api]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <section className="stats-dashboard panel" aria-busy="true"><p className="section-label">Step 05 / Stats</p><h2>正在汇总统计…</h2></section>;
  }
  if (!stats) {
    return (
      <section className="stats-dashboard panel" aria-labelledby="stats-title">
        <p className="section-label">Step 05 / Stats</p>
        <h2 id="stats-title">暂时无法加载统计</h2>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button type="button" className="entry-submit" onClick={load}>重试</button>
      </section>
    );
  }

  const { taskSummary, priorityDistribution, dailyWorkload } = stats;
  return (
    <section className="stats-dashboard panel" aria-labelledby="stats-title">
      <p className="section-label">Step 05 / Stats</p>
      <h2 id="stats-title">统计看板</h2>
      <div className="stats-cards">
        <div className="summary-item"><span>活跃任务</span><strong>{taskSummary.activeCount}</strong></div>
        <div className="summary-item"><span>已完成</span><strong>{taskSummary.completedCount}</strong></div>
        <div className="summary-item"><span>完成率</span><strong>{Math.round(taskSummary.completionRate * 100)}%</strong></div>
        <div className="summary-item"><span>剩余总工时</span><strong>{taskSummary.totalRemainingMinutes / 60} 小时</strong></div>
        <div className="summary-item"><span>逾期任务</span><strong>{taskSummary.overdueCount}</strong></div>
        <div className="summary-item"><span>本周到期</span><strong>{taskSummary.dueThisWeekCount}</strong></div>
      </div>
      <PriorityDonut distribution={priorityDistribution} />
      <DailyLoadBars daily={dailyWorkload} />
    </section>
  );
}
```

- [ ] **Step 7: Add the fifth navigation step**

In `apps/frontend/src/components/StepNavigation.tsx`, change the `steps` array:

```ts
const steps = ["可用时间", "任务录入", "冲突分析", "生成计划", "统计看板"];
```

- [ ] **Step 8: Wire step 5 into the app**

In `apps/frontend/src/app/App.tsx`, add the import (top of file, next to the other feature imports):

```ts
import { StatsDashboard } from "../features/stats/StatsDashboard.js";
```

Change the unlock computation (find the line `const unlockedStep = plan ? 4 : ...` and update it):

```ts
const unlockedStep = plan ? 5 : hasAvailability && hasActiveTasks ? 3 : hasAvailability ? 2 : 1;
```

Add the step-5 render after the step-4 line (do not remove the existing step-4 render):

```tsx
    {currentStep === 5 && <StatsDashboard api={api} />}
```

Preserve the existing uncommitted lines in this file (the `savedAvailability` ref, the `useRef` import, and the `onSaved` handler).

- [ ] **Step 9: Add styles**

Append to `apps/frontend/src/styles/global.css`:

```css
.stats-dashboard { padding: var(--space-6); }
.stats-dashboard h2 { margin: 0; font-family: var(--font-display); font-size: clamp(1.9rem, 3vw, 2.7rem); line-height: 1.25; }
.stats-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); margin-top: var(--space-5); }
.stats-donut, .stats-bars { margin: var(--space-6) 0 0; }
.stats-donut svg, .stats-bars svg { width: 100%; height: auto; }
.stats-donut__legend, .stats-bars__legend { display: flex; flex-wrap: wrap; gap: var(--space-4); margin: var(--space-3) 0 0; color: var(--color-text-accessible); font-size: .9rem; }
.stats-donut__legend span, .stats-bars__legend span { display: inline-flex; align-items: center; gap: var(--space-2); }
.stats-donut__legend i, .stats-bars__legend i { display: inline-block; width: 12px; height: 12px; border-radius: 4px; }
@media (max-width: 767px) { .stats-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
```

- [ ] **Step 10: Run to confirm green**

Run: `npm --workspace @ddl-radar/frontend test -- stats-dashboard.test.tsx`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/frontend/src/api/client.ts apps/frontend/src/features/stats apps/frontend/src/components/StepNavigation.tsx apps/frontend/src/app/App.tsx apps/frontend/src/styles/global.css apps/frontend/test/stats-dashboard.test.tsx
git commit -m "feat(ui): add statistics dashboard"
```

---

### Task 5: Visual Timeline and Block Editor

**Files:**
- Modify: `apps/frontend/src/api/client.ts`
- Create: `apps/frontend/src/features/plan/BlockEditor.tsx`
- Modify: `apps/frontend/src/features/plan/WeekTimeline.tsx`
- Modify: `apps/frontend/src/features/plan/PlanStep.tsx`
- Modify: `apps/frontend/src/styles/global.css`
- Modify: `apps/frontend/test/plan-step.test.tsx`

**Interfaces:**
- Consumes: `ApiClient` (adds `splitScheduleBlock`, `mergeScheduleBlock`), `ScheduleBlock`, `Task`.
- Produces: `WeekTimeline({ blocks, tasks, selectedId, onSelect, onMove })`, `BlockEditor({ block, task, canSplit, canMerge, onMove, onLock, onSetStatus, onComplete, onSplit, onMerge, onClose })`.

- [ ] **Step 1: Add split/merge client methods**

In `apps/frontend/src/api/client.ts`, in the `ApiClient` interface (after `patchScheduleBlock`):

```ts
  splitScheduleBlock(id: string, at?: string): Promise<{ blocks: ScheduleBlock[] }>;
  mergeScheduleBlock(id: string, withDirection?: "next" | "prev"): Promise<{ block: ScheduleBlock }>;
```

In the returned object of `createApiClient` (after `patchScheduleBlock`):

```ts
    splitScheduleBlock: (id, at) => request<{ blocks: ScheduleBlock[] }>(fetcher, `${baseUrl}/schedule-blocks/${encodeURIComponent(id)}/split`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(at === undefined ? {} : { at }),
    }),
    mergeScheduleBlock: (id, withDirection) => request<{ block: ScheduleBlock }>(fetcher, `${baseUrl}/schedule-blocks/${encodeURIComponent(id)}/merge`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(withDirection === undefined ? {} : { with: withDirection }),
    }),
```

- [ ] **Step 2: Write the failing timeline interaction test**

Replace the `describe("PlanStep", ...)` block in `apps/frontend/test/plan-step.test.tsx` with tests for the new interaction model (the old tests select blocks by inline lock/move buttons; the new UI selects a block and uses a `BlockEditor`). Keep the fixtures at the top of the file unchanged.

```tsx
describe("PlanStep", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  function renderPlan(overrides: Partial<Parameters<typeof PlanStep>[0]> = {}) {
    const patchScheduleBlock = vi.fn(async (id: string, input: Record<string, unknown>) => ({
      block: { ...plan.blocks.find((b) => b.id === id)!, ...input, status: input.completedMinutes === undefined ? plan.blocks.find((b) => b.id === id)!.status : "completed" },
      task: input.completedMinutes === undefined ? undefined : { ...tasks[0], remainingMinutes: 60 },
      progress: input.completedMinutes === undefined ? undefined : { remainingMinutes: 60, appliedMinutes: 60, overflowMinutes: 0 },
    }));
    const splitScheduleBlock = vi.fn(async () => ({ blocks: [] }));
    const mergeScheduleBlock = vi.fn(async () => ({ block: plan.blocks[0] }));
    const api = {
      patchScheduleBlock,
      splitScheduleBlock,
      mergeScheduleBlock,
      exportPlanIcs: vi.fn().mockResolvedValue({ blob: new Blob(["BEGIN:VCALENDAR"]), filename: "radar-week.ics" }),
    };
    const effectiveApi = overrides.api ?? api;
    render(<PlanStep plan={plan} tasks={tasks} api={effectiveApi} {...overrides} />);
    return effectiveApi;
  }

  it("marks a selected block started through the editor", async () => {
    const user = userEvent.setup();
    const api = renderPlan();

    await user.click(screen.getByRole("button", { name: /软件工程大作业/ }));
    await user.click(screen.getByRole("button", { name: "开始" }));

    await waitFor(() => expect(api.patchScheduleBlock).toHaveBeenCalledWith("block-1", { status: "started" }));
  });

  it("locks a block and exposes the updated label", async () => {
    const user = userEvent.setup();
    const api = renderPlan();

    await user.click(screen.getByRole("button", { name: /软件工程大作业/ }));
    await user.click(screen.getByRole("button", { name: "锁定" }));

    await waitFor(() => expect(api.patchScheduleBlock).toHaveBeenCalledWith("block-1", { locked: true }));
  });

  it("sends a 60-minute completion update", async () => {
    const user = userEvent.setup();
    const api = renderPlan();

    await user.click(screen.getByRole("button", { name: /软件工程大作业/ }));
    await user.click(screen.getByRole("button", { name: "完成 60 分钟" }));

    await waitFor(() => expect(api.patchScheduleBlock).toHaveBeenCalledWith("block-1", { completedMinutes: 60 }));
  });

  it("calls the split endpoint for a splittable task", async () => {
    const user = userEvent.setup();
    const api = renderPlan();

    await user.click(screen.getByRole("button", { name: /软件工程大作业/ }));
    await user.click(screen.getByRole("button", { name: "拆分" }));

    await waitFor(() => expect(api.splitScheduleBlock).toHaveBeenCalledWith("block-1", undefined));
  });
});
```

The remaining old tests (`restores previous times…`, `downloads ICS…`) must be updated too: keep ICS test but replace the move test with a move-through-editor test:

```tsx
  it("restores previous times and names the conflicting task when a move conflicts", async () => {
    const user = userEvent.setup();
    const conflict = Object.assign(new Error("该时间与已有安排冲突"), { code: "SCHEDULE_CONFLICT", details: { conflictingBlockId: "block-2" } });
    const api = renderPlan({ api: {
      patchScheduleBlock: vi.fn().mockRejectedValue(conflict),
      splitScheduleBlock: vi.fn(),
      mergeScheduleBlock: vi.fn(),
      exportPlanIcs: vi.fn(),
    } });

    await user.click(screen.getByRole("button", { name: /软件工程大作业/ }));
    fireEvent.change(screen.getByLabelText("开始时间"), { target: { value: "2026-08-18T11:00" } });
    fireEvent.change(screen.getByLabelText("结束时间"), { target: { value: "2026-08-18T12:00" } });
    await user.click(screen.getByRole("button", { name: "移动" }));

    await waitFor(() => expect(api.patchScheduleBlock).toHaveBeenCalled());
    expect(screen.getByRole("alert")).toHaveTextContent("高等数学作业");
  });

  it("downloads ICS using the blob and filename returned by the server", async () => {
    const user = userEvent.setup();
    const createObjectUrl = vi.fn().mockReturnValue("blob:radar-week");
    vi.stubGlobal("URL", { createObjectURL: createObjectUrl, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const api = renderPlan();

    await user.click(screen.getByRole("button", { name: "导出 ICS" }));

    await waitFor(() => expect(api.exportPlanIcs).toHaveBeenCalledWith("plan-1"));
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run to confirm red**

Run: `npm --workspace @ddl-radar/frontend test -- plan-step.test.tsx`
Expected: FAIL — `BlockEditor` missing / buttons not found.

- [ ] **Step 4: Implement `BlockEditor`**

Create `apps/frontend/src/features/plan/BlockEditor.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { ScheduleBlock, Task } from "../../api/client.js";

const statusLabels = { planned: "已计划", started: "进行中", completed: "已完成", skipped: "已跳过" } as const;

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type BlockEditorProps = {
  block: ScheduleBlock;
  task: Task | undefined;
  canSplit: boolean;
  canMerge: boolean;
  saving: boolean;
  onMove: (block: ScheduleBlock, startAt: string, endAt: string) => Promise<boolean>;
  onLock: (block: ScheduleBlock) => Promise<void>;
  onSetStatus: (block: ScheduleBlock, status: ScheduleBlock["status"]) => Promise<void>;
  onComplete: (block: ScheduleBlock) => Promise<void>;
  onSplit: (block: ScheduleBlock) => Promise<void>;
  onMerge: (block: ScheduleBlock) => Promise<void>;
  onClose: () => void;
};

export function BlockEditor(props: BlockEditorProps) {
  const { block, task, canSplit, canMerge, saving, onMove, onLock, onSetStatus, onComplete, onSplit, onMerge, onClose } = props;
  const [draft, setDraft] = useState({ startAt: toLocalInput(block.startAt), endAt: toLocalInput(block.endAt) });
  useEffect(() => setDraft({ startAt: toLocalInput(block.startAt), endAt: toLocalInput(block.endAt) }), [block]);
  const title = task?.title ?? block.taskId;

  return (
    <section className="block-editor confirm-dialog" aria-labelledby="block-editor-title">
      <h3 id="block-editor-title">编辑：{title}</h3>
      <p>{statusLabels[block.status]} · {block.locked ? "已锁定" : "未锁定"}</p>
      <div className="block-editor__status">
        {block.status !== "started" && block.status !== "completed" && block.status !== "skipped" && (
          <button type="button" onClick={() => void onSetStatus(block, "started")}>开始</button>
        )}
        {block.status !== "completed" && (
          <button type="button" disabled={saving} onClick={() => void onComplete(block)}>完成 60 分钟</button>
        )}
        {block.status === "planned" && <button type="button" onClick={() => void onSetStatus(block, "skipped")}>跳过</button>}
        {block.status === "skipped" && <button type="button" onClick={() => void onSetStatus(block, "planned")}>恢复</button>}
        <button type="button" onClick={() => void onLock(block)}>{block.locked ? "解锁" : "锁定"}</button>
      </div>
      <fieldset className="block-editor__move">
        <legend>移动时间</legend>
        <label>开始时间<input type="datetime-local" value={draft.startAt} onChange={(event) => setDraft((current) => ({ ...current, startAt: event.target.value }))} /></label>
        <label>结束时间<input type="datetime-local" value={draft.endAt} onChange={(event) => setDraft((current) => ({ ...current, endAt: event.target.value }))} /></label>
        <button type="button" onClick={() => void onMove(block, draft.startAt, draft.endAt).then((moved) => { if (!moved) setDraft({ startAt: toLocalInput(block.startAt), endAt: toLocalInput(block.endAt) }); })}>移动</button>
      </fieldset>
      <div className="block-editor__actions">
        {canSplit && <button type="button" onClick={() => void onSplit(block)}>拆分</button>}
        {canMerge && <button type="button" onClick={() => void onMerge(block)}>合并相邻</button>}
        <button type="button" onClick={onClose}>关闭</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Rewrite `WeekTimeline` as a visual timeline**

Replace `apps/frontend/src/features/plan/WeekTimeline.tsx` in full:

```tsx
import { useMemo } from "react";
import type { ScheduleBlock, Task } from "../../api/client.js";

const DAY_START_MINUTES = 6 * 60;   // 06:00
const DAY_END_MINUTES = 24 * 60;    // 24:00
const RANGE_MINUTES = DAY_END_MINUTES - DAY_START_MINUTES;
const TIMELINE_HEIGHT = 720;        // px in viewBox

const statusLabels = { planned: "已计划", started: "进行中", completed: "已完成", skipped: "已跳过" } as const;

function labelTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function dayHeading(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
}
function minutesOfDay(iso: string): number {
  const date = new Date(iso);
  return date.getHours() * 60 + date.getMinutes();
}
function topFor(iso: string): number {
  const minutes = minutesOfDay(iso);
  return ((Math.min(DAY_END_MINUTES, Math.max(DAY_START_MINUTES, minutes)) - DAY_START_MINUTES) / RANGE_MINUTES) * TIMELINE_HEIGHT;
}
function heightFor(startAt: string, endAt: string): number {
  return Math.max(12, ((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000 / RANGE_MINUTES) * TIMELINE_HEIGHT);
}

type WeekTimelineProps = {
  blocks: readonly ScheduleBlock[];
  tasks: readonly Task[];
  selectedId: string | null;
  onSelect: (block: ScheduleBlock) => void;
  onMove: (block: ScheduleBlock, startAt: string, endAt: string) => Promise<boolean>;
};

export function WeekTimeline({ blocks, tasks, selectedId, onSelect, onMove }: WeekTimelineProps) {
  const taskMap = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const days = useMemo(() => Object.entries(
    blocks.reduce<Record<string, ScheduleBlock[]>>((grouped, block) => {
      const day = dayHeading(block.startAt);
      (grouped[day] ??= []).push(block);
      return grouped;
    }, {}),
  ), [blocks]);

  const nudge = (block: ScheduleBlock, deltaMinutes: number) => {
    const start = new Date(block.startAt).getTime() + deltaMinutes * 60_000;
    const duration = new Date(block.endAt).getTime() - new Date(block.startAt).getTime();
    const startIso = new Date(start).toISOString();
    const endIso = new Date(start + duration).toISOString();
    void onMove(block, startIso, endIso);
  };

  return (
    <div className="week-timeline">
      {days.map(([day, dayBlocks]) => (
        <section className="week-timeline__day" key={day}>
          <h3>{day}</h3>
          <div className="week-timeline__canvas" style={{ height: `${TIMELINE_HEIGHT}px` }}>
            {dayBlocks.map((block) => {
              const task = taskMap.get(block.taskId);
              const title = task?.title ?? block.taskId;
              const selected = selectedId === block.id;
              const state = `${statusLabels[block.status]}，${block.locked ? "已锁定" : "未锁定"}`;
              return (
                <button
                  key={block.id}
                  type="button"
                  className={`week-timeline__block${selected ? " week-timeline__block--selected" : ""}`}
                  style={{ top: `${topFor(block.startAt)}px`, height: `${heightFor(block.startAt, block.endAt)}px` }}
                  aria-label={`${title}，${labelTime(block.startAt)} 至 ${labelTime(block.endAt)}，${state}`}
                  aria-pressed={selected}
                  onClick={() => onSelect(block)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp" && event.shiftKey) { event.preventDefault(); nudge(block, -60); }
                    else if (event.key === "ArrowDown" && event.shiftKey) { event.preventDefault(); nudge(block, 60); }
                    else if (event.key === "ArrowUp") { event.preventDefault(); nudge(block, -30); }
                    else if (event.key === "ArrowDown") { event.preventDefault(); nudge(block, 30); }
                  }}
                >
                  <strong>{title}</strong>
                  <span>{labelTime(block.startAt)}–{labelTime(block.endAt)}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
```

Note: the Shift+Arrow branches must be checked before the plain Arrow branches (move the `shiftKey` checks above the plain ones in the final code).

- [ ] **Step 6: Rewrite `PlanStep` to orchestrate editor + timeline**

Replace `apps/frontend/src/features/plan/PlanStep.tsx` in full:

```tsx
import { useEffect, useState } from "react";
import type { ApiClient, Plan, ScheduleBlock, Task } from "../../api/client.js";
import { BlockEditor } from "./BlockEditor.js";
import { WeekTimeline } from "./WeekTimeline.js";

type PlanStepProps = {
  plan: Plan;
  tasks: readonly Task[];
  api: Pick<ApiClient, "patchScheduleBlock" | "exportPlanIcs" | "splitScheduleBlock" | "mergeScheduleBlock">;
  onTasksChanged?: (tasks: readonly Task[]) => void;
};

function toUtc(value: string): string { return new Date(value).toISOString(); }

export function PlanStep({ plan, tasks, api, onTasksChanged = () => undefined }: PlanStepProps) {
  const [currentPlan, setCurrentPlan] = useState(plan);
  const [currentTasks, setCurrentTasks] = useState<readonly Task[]>(tasks);
  const [selected, setSelected] = useState<ScheduleBlock | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  useEffect(() => setCurrentPlan(plan), [plan]);
  useEffect(() => setCurrentTasks(tasks), [tasks]);

  const updateBlock = (block: ScheduleBlock, task?: Task) => {
    setCurrentPlan((current) => ({ ...current, blocks: current.blocks.map((item) => item.id === block.id ? block : item) }));
    if (task) setCurrentTasks((current) => {
      const next = current.map((item) => item.id === task.id ? task : item);
      onTasksChanged(next);
      return next;
    });
    setSelected((current) => current?.id === block.id ? block : current);
  };
  const updateBlocks = (blocks: ScheduleBlock[]) => {
    setCurrentPlan((current) => ({ ...current, blocks }));
    setSelected(null);
  };

  const move = async (block: ScheduleBlock, start: string, end: string): Promise<boolean> => {
    setError(""); setMessage("");
    try {
      const response = await api.patchScheduleBlock(block.id, { startAt: toUtc(start), endAt: toUtc(end) });
      updateBlock(response.block);
      return true;
    } catch (reason) {
      const failure = reason as Error & { code?: string; details?: { conflictingBlockId?: string } };
      const conflictId = failure.details?.conflictingBlockId;
      const conflicting = conflictId ? currentPlan.blocks.find((item) => item.id === conflictId) : undefined;
      const conflictingTask = conflicting ? currentTasks.find((task) => task.id === conflicting.taskId) : undefined;
      setError(conflictingTask ? `与 ${conflictingTask.title} 冲突：${failure.message}` : failure.message);
      return false;
    }
  };
  const lock = async (block: ScheduleBlock) => {
    setError("");
    try { const response = await api.patchScheduleBlock(block.id, { locked: !block.locked }); updateBlock(response.block); }
    catch (reason) { setError((reason as Error).message); }
  };
  const setStatus = async (block: ScheduleBlock, status: ScheduleBlock["status"]) => {
    setError("");
    try { const response = await api.patchScheduleBlock(block.id, { status }); updateBlock(response.block); }
    catch (reason) { setError((reason as Error).message); }
  };
  const complete = async (block: ScheduleBlock) => {
    setSaving(true); setError("");
    try {
      const response = await api.patchScheduleBlock(block.id, { completedMinutes: 60 });
      updateBlock(response.block, response.task);
      const progress = response.progress;
      setMessage(progress ? `已记录 ${progress.appliedMinutes} 分钟${progress.overflowMinutes > 0 ? `；超出 ${progress.overflowMinutes} 分钟将保留为待处理` : ""}` : "已更新进度");
    } catch (reason) { setError((reason as Error).message); } finally { setSaving(false); }
  };
  const split = async (block: ScheduleBlock) => {
    setError("");
    try {
      const response = await api.splitScheduleBlock(block.id);
      updateBlocks([...currentPlan.blocks.filter((item) => item.id !== block.id), ...response.blocks]);
      setMessage("已拆分该时间块");
    } catch (reason) { setError((reason as Error).message); }
  };
  const merge = async (block: ScheduleBlock) => {
    setError("");
    try {
      const response = await api.mergeScheduleBlock(block.id);
      const merged = response.block;
      const next = currentPlan.blocks.filter((item) => item.id !== block.id && item.endAt !== merged.startAt && item.startAt !== merged.endAt);
      updateBlocks([...next, merged]);
      setMessage("已合并相邻时间块");
    } catch (reason) { setError((reason as Error).message); }
  };
  const exportIcs = async () => {
    setExporting(true); setError("");
    try {
      const { blob, filename } = await api.exportPlanIcs(currentPlan.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = filename; anchor.click();
      URL.revokeObjectURL(url);
      setMessage(`已下载 ${filename}`);
    } catch (reason) { setError((reason as Error).message); } finally { setExporting(false); }
  };

  const selectedTask = selected ? currentTasks.find((task) => task.id === selected.taskId) : undefined;
  const adjacentSameTask = selected
    ? currentPlan.blocks.find((block) => block.id !== selected.id && block.taskId === selected.taskId && (block.startAt === selected.endAt || block.endAt === selected.startAt))
    : undefined;

  return (
    <section className="plan-step panel" aria-labelledby="plan-title">
      <p className="section-label">Step 04 / Plan</p>
      <div className="plan-step__heading">
        <div><h2 id="plan-title">本周执行计划</h2><p>点击时间块查看操作；方向键微调时间，拖拽移动到新时段。</p></div>
        <button type="button" className="entry-submit" disabled={exporting} onClick={() => void exportIcs()}>{exporting ? "导出中…" : "导出 ICS"}</button>
      </div>
      {currentPlan.unscheduledMinutes > 0 && <aside className="plan-warning">仍有 {currentPlan.unscheduledMinutes} 分钟未排入计划，请优先调整可用时间或缩小任务范围。</aside>}
      {message && <p className="plan-message" role="status">{message}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <WeekTimeline blocks={currentPlan.blocks} tasks={currentTasks} selectedId={selected?.id ?? null} onSelect={setSelected} onMove={move} />
      {selected && (
        <BlockEditor
          block={selected}
          task={selectedTask}
          canSplit={Boolean(selectedTask?.splittable) && (new Date(selected.endAt).getTime() - new Date(selected.startAt).getTime()) / 60_000 >= (selectedTask?.minimumBlockMinutes ?? 30) * 2}
          canMerge={Boolean(adjacentSameTask)}
          saving={saving}
          onMove={move}
          onLock={lock}
          onSetStatus={setStatus}
          onComplete={complete}
          onSplit={split}
          onMerge={merge}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 7: Add styles**

Append to `apps/frontend/src/styles/global.css`:

```css
.week-timeline { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--space-4); margin-top: var(--space-5); }
.week-timeline__day h3 { margin: 0 0 var(--space-2); font-family: var(--font-display); font-size: 1.15rem; }
.week-timeline__canvas { position: relative; border-left: 1px solid var(--color-border); background: linear-gradient(to bottom, var(--color-border) 1px, transparent 1px); background-size: 100% 40px; }
.week-timeline__block { position: absolute; left: 6px; right: 6px; min-height: 0; display: grid; align-content: center; gap: 2px; padding: 4px 8px; border: 1px solid var(--color-border); border-radius: 12px; color: var(--color-fg); text-align: left; background: var(--color-surface); box-shadow: var(--shadow-panel); }
.week-timeline__block strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .9rem; }
.week-timeline__block span { color: var(--color-text-accessible); font-size: .78rem; }
.week-timeline__block--selected { border-color: var(--color-accent); box-shadow: var(--focus-ring); }
.block-editor__status, .block-editor__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.block-editor__move { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); margin: var(--space-3) 0; padding: var(--space-3); border: 1px dashed var(--color-border); border-radius: var(--radius-organic-sm); }
.block-editor__move legend { padding: 0 var(--space-1); font-weight: 700; }
.block-editor__move label { display: grid; gap: var(--space-1); font-size: .85rem; font-weight: 700; }
.block-editor__move input { min-height: var(--control-min-height); padding: 8px; border: 1px solid var(--color-border); border-radius: 12px; font: inherit; }
@media (max-width: 767px) { .week-timeline { grid-template-columns: minmax(0, 1fr); } .block-editor__move { grid-template-columns: minmax(0, 1fr); } }
```

- [ ] **Step 8: Run to confirm green**

Run: `npm --workspace @ddl-radar/frontend test -- plan-step.test.tsx`
Expected: PASS. If the ICS test or others still reference removed elements, fix them to match the new UI.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/api/client.ts apps/frontend/src/features/plan apps/frontend/src/styles/global.css apps/frontend/test/plan-step.test.tsx
git commit -m "feat(ui): visual timeline and block editor"
```

---

### Task 6: Drag, Undo/Redo

**Files:**
- Create: `apps/frontend/src/features/plan/useUndoHistory.ts`
- Modify: `apps/frontend/src/features/plan/WeekTimeline.tsx`
- Modify: `apps/frontend/src/features/plan/PlanStep.tsx`
- Create: `apps/frontend/test/use-undo-history.test.tsx`
- Modify: `apps/frontend/test/plan-step.test.tsx`

**Interfaces:**
- Consumes: `PlanStep` mutation handlers, `ScheduleBlock`.
- Produces: `useUndoHistory()` returning `{ canUndo, canRedo, undo, redo, push, clear }`.

- [ ] **Step 1: Write the failing undo-history hook test**

Create `apps/frontend/test/use-undo-history.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useUndoHistory } from "../src/features/plan/useUndoHistory.js";

describe("useUndoHistory", () => {
  it("undoes and redoes pushed entries in order", async () => {
    const { result } = renderHook(() => useUndoHistory());
    const order: string[] = [];

    act(() => result.current.push({ label: "a", undo: () => { order.push("undo-a"); }, redo: () => { order.push("redo-a"); } }));
    act(() => result.current.push({ label: "b", undo: () => { order.push("undo-b"); }, redo: () => { order.push("redo-b"); } }));
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    await act(async () => { await result.current.undo(); });
    expect(order).toEqual(["undo-b"]);
    expect(result.current.canRedo).toBe(true);

    await act(async () => { await result.current.redo(); });
    expect(order).toEqual(["undo-b", "redo-b"]);

    await act(async () => { await result.current.undo(); });
    expect(order).toEqual(["undo-b", "redo-b", "undo-b"]);
  });

  it("clears the redo stack when a new entry is pushed", () => {
    const { result } = renderHook(() => useUndoHistory());
    act(() => result.current.push({ label: "a", undo: () => undefined, redo: () => undefined }));
    act(() => result.current.undo());
    act(() => result.current.push({ label: "c", undo: () => undefined, redo: () => undefined }));
    expect(result.current.canRedo).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm red**

Run: `npm --workspace @ddl-radar/frontend test -- use-undo-history.test.tsx`
Expected: FAIL — `useUndoHistory` missing.

- [ ] **Step 3: Implement the hook**

Create `apps/frontend/src/features/plan/useUndoHistory.ts`:

```ts
import { useCallback, useRef, useState } from "react";

export type UndoEntry = {
  label: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
};

export function useUndoHistory(limit = 20) {
  const undoStack = useRef<UndoEntry[]>([]);
  const redoStack = useRef<UndoEntry[]>([]);
  const [version, setVersion] = useState(0);

  const push = useCallback((entry: UndoEntry) => {
    undoStack.current.push(entry);
    if (undoStack.current.length > limit) undoStack.current.shift();
    redoStack.current = [];
    setVersion((value) => value + 1);
  }, [limit]);

  const undo = useCallback(async () => {
    const entry = undoStack.current.pop();
    if (!entry) return;
    await entry.undo();
    redoStack.current.push(entry);
    setVersion((value) => value + 1);
  }, []);

  const redo = useCallback(async () => {
    const entry = redoStack.current.pop();
    if (!entry) return;
    await entry.redo();
    undoStack.current.push(entry);
    setVersion((value) => value + 1);
  }, []);

  const clear = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    setVersion((value) => value + 1);
  }, []);

  return { canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0, undo, redo, push, clear, version };
}
```

- [ ] **Step 4: Add drag support to the timeline**

In `apps/frontend/src/features/plan/WeekTimeline.tsx`, add drag via pointer events. Change the block `button` to support pointer handlers with a `dragRef`:

```tsx
import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
```

Add inside the component (after `nudge`):

```ts
  const [drag, setDrag] = useState<{ blockId: string; startY: number; baseStart: number; previewTop: number } | null>(null);
  const dragBlockRef = useRef<ScheduleBlock | null>(null);

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, block: ScheduleBlock) => {
    if (block.locked) return;
    const canvas = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const scale = TIMELINE_HEIGHT / canvas.height;
    const pointerY = (event.clientY - canvas.top) * scale;
    dragBlockRef.current = block;
    setDrag({ blockId: block.id, startY: pointerY, baseStart: new Date(block.startAt).getTime(), previewTop: topFor(block.startAt) });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || drag.blockId !== event.currentTarget.dataset.blockId) return;
    const canvas = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const scale = TIMELINE_HEIGHT / canvas.height;
    const pointerY = (event.clientY - canvas.top) * scale;
    const deltaMinutes = Math.round((pointerY - drag.startY) / (TIMELINE_HEIGHT / RANGE_MINUTES) / 30) * 30;
    setDrag({ ...drag, previewTop: topFor(new Date(drag.baseStart + deltaMinutes * 60_000).toISOString()) });
  };
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || !dragBlockRef.current) return;
    const block = dragBlockRef.current;
    const canvas = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const scale = TIMELINE_HEIGHT / canvas.height;
    const pointerY = (event.clientY - canvas.top) * scale;
    const deltaMinutes = Math.round((pointerY - drag.startY) / (TIMELINE_HEIGHT / RANGE_MINUTES) / 30) * 30;
    const duration = new Date(block.endAt).getTime() - new Date(block.startAt).getTime();
    const newStart = new Date(drag.baseStart + deltaMinutes * 60_000).toISOString();
    const newEnd = new Date(drag.baseStart + deltaMinutes * 60_000 + duration).toISOString();
    dragBlockRef.current = null;
    setDrag(null);
    if (deltaMinutes !== 0) void onMove(block, newStart, newEnd);
  };
```

Add `data-block-id={block.id}` and the pointer props to the button, and use `drag?.blockId === block.id ? drag.previewTop : topFor(block.startAt)` for `top`. The button element:

```tsx
  <button
    key={block.id}
    type="button"
    data-block-id={block.id}
    className={`week-timeline__block${selected ? " week-timeline__block--selected" : ""}`}
    style={{ top: `${drag?.blockId === block.id ? drag.previewTop : topFor(block.startAt)}px`, height: `${heightFor(block.startAt, block.endAt)}px` }}
    aria-label={`${title}，${labelTime(block.startAt)} 至 ${labelTime(block.endAt)}，${state}`}
    aria-pressed={selected}
    onClick={() => onSelect(block)}
    onPointerDown={(event) => startDrag(event, block)}
    onPointerMove={moveDrag}
    onPointerUp={endDrag}
    onKeyDown={...}
  >
```

Reorder the keydown handler so Shift+Arrow is checked first (see Task 5 note).

- [ ] **Step 5: Wire undo/redo into `PlanStep`**

In `apps/frontend/src/features/plan/PlanStep.tsx`, import the hook:

```ts
import { useEffect, useState } from "react";
import { useUndoHistory } from "./useUndoHistory.js";
```

Add inside the component (after the `useEffect` lines):

```ts
  const history = useUndoHistory();
  useEffect(() => { history.clear(); }, [currentPlan.id]);
```

Replace each mutation so it pushes an inverse entry. For `move`, after a successful patch, capture the previous block values:

```ts
  const move = async (block: ScheduleBlock, start: string, end: string): Promise<boolean> => {
    setError(""); setMessage("");
    try {
      const response = await api.patchScheduleBlock(block.id, { startAt: toUtc(start), endAt: toUtc(end) });
      history.push({
        label: "移动",
        undo: async () => { const r = await api.patchScheduleBlock(block.id, { startAt: block.startAt, endAt: block.endAt }); updateBlock(r.block); },
        redo: async () => { const r = await api.patchScheduleBlock(block.id, { startAt: response.block.startAt, endAt: response.block.endAt }); updateBlock(r.block); },
      });
      updateBlock(response.block);
      return true;
    } catch (reason) { /* unchanged */ return false; }
  };
```

Apply the same pattern:
- `lock`: push `undo/redo` that call `patchScheduleBlock(id, { locked: !block.locked })` and `updateBlock`.
- `setStatus`: push `undo/redo` with `{ status: block.status }` (previous) and `{ status }` (new).
- `complete`: push `undo/redo` with `{ completedMinutes: 60 }` forward; undo restores via `patchScheduleBlock` with the previous block's `status` (but note the task remaining minutes also changed — restore via re-fetch is out of scope; restore the block status only, and set message accordingly).
- `split`: forward calls `splitScheduleBlock`; push `undo` that calls `mergeScheduleBlock(leftId, "next")`, `redo` that re-splits at the stored split point.
- `merge`: forward calls `mergeScheduleBlock`; push `undo` that re-splits the merged block at the stored boundary.

Add undo/redo controls and keyboard shortcuts. Add at the top of the returned JSX (inside the heading, next to the ICS button):

```tsx
  <div className="plan-step__heading">
    <div>
      <h2 id="plan-title">本周执行计划</h2>
      <p>点击时间块查看操作；方向键微调时间，拖拽移动到新时段。</p>
    </div>
    <div className="plan-step__tools">
      <button type="button" disabled={!history.canUndo} onClick={() => void history.undo()}>撤销</button>
      <button type="button" disabled={!history.canRedo} onClick={() => void history.redo()}>重做</button>
      <button type="button" className="entry-submit" disabled={exporting} onClick={() => void exportIcs()}>{exporting ? "导出中…" : "导出 ICS"}</button>
    </div>
  </div>
```

Add a `useEffect` for the keyboard shortcuts:

```ts
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) void history.redo();
      else void history.undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [history]);
```

For `split`, the `updateBlocks` already clears selection; keep it. Store the split point for redo/undo. Update `split`:

```ts
  const split = async (block: ScheduleBlock) => {
    setError("");
    try {
      const response = await api.splitScheduleBlock(block.id);
      const [left, right] = response.blocks;
      history.push({
        label: "拆分",
        undo: async () => { const r = await api.mergeScheduleBlock(left.id, "next"); updateBlocks([...currentPlan.blocks.filter((b) => b.id !== left.id && b.id !== right.id), r.block]); },
        redo: async () => { const r = await api.splitScheduleBlock(block.id, right.startAt); updateBlocks([...currentPlan.blocks.filter((b) => b.id !== block.id), ...r.blocks]); },
      });
      updateBlocks([...currentPlan.blocks.filter((item) => item.id !== block.id), ...response.blocks]);
      setMessage("已拆分该时间块");
    } catch (reason) { setError((reason as Error).message); }
  };
```

For `merge`, record the boundary (`block.endAt === neighbor.startAt` or vice versa). Since `merge` receives the current block and merges with "next" by default, capture the split point from `block.endAt`:

```ts
  const merge = async (block: ScheduleBlock) => {
    setError("");
    try {
      const response = await api.mergeScheduleBlock(block.id);
      const merged = response.block;
      const boundary = block.endAt;
      const removed = currentPlan.blocks.find((b) => b.startAt === block.endAt && b.taskId === block.taskId) ?? currentPlan.blocks.find((b) => b.endAt === block.startAt && b.taskId === block.taskId);
      history.push({
        label: "合并",
        undo: async () => { const r = await api.splitScheduleBlock(merged.id, boundary); updateBlocks([...currentPlan.blocks.filter((b) => b.id !== merged.id), ...r.blocks]); },
        redo: async () => { const r = await api.mergeScheduleBlock(block.id); updateBlocks([...currentPlan.blocks.filter((b) => b.id !== removed?.id), r.block]); },
      });
      const next = currentPlan.blocks.filter((item) => item.id !== block.id && item.id !== removed?.id);
      updateBlocks([...next, merged]);
      setMessage("已合并相邻时间块");
    } catch (reason) { setError((reason as Error).message); }
  };
```

Add the `.plan-step__tools` style to `global.css`:

```css
.plan-step__tools { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.plan-step__tools button:not(.entry-submit) { padding: 8px 14px; border: 1px solid var(--color-border); border-radius: 999px; color: var(--color-fg); font-weight: 700; background: var(--color-surface); }
```

- [ ] **Step 6: Add a PlanStep undo test**

Append to `apps/frontend/test/plan-step.test.tsx`:

```tsx
  it("exposes undo after a status change and reverts via the inverse patch", async () => {
    const user = userEvent.setup();
    const api = renderPlan();

    await user.click(screen.getByRole("button", { name: /软件工程大作业/ }));
    await user.click(screen.getByRole("button", { name: "开始" }));
    await waitFor(() => expect(api.patchScheduleBlock).toHaveBeenCalledWith("block-1", { status: "started" }));

    await user.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(api.patchScheduleBlock).toHaveBeenCalledWith("block-1", { status: "planned" }));
  });
```

- [ ] **Step 7: Run to confirm green**

Run: `npm --workspace @ddl-radar/frontend test`
Expected: PASS — all frontend tests green.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/features/plan apps/frontend/src/styles/global.css apps/frontend/test
git commit -m "feat(ui): drag blocks and undo/redo schedule edits"
```

---

### Task 7: End-to-End Coverage and Documentation

**Files:**
- Create: `e2e/stats-and-interaction.spec.ts`
- Modify: `README.md`
- Modify: `SPEC.md`
- Modify: `PLAN.md`

**Interfaces:**
- Consumes: running backend/frontend (as in existing `e2e/*`), the new stats step and timeline interactions.
- Produces: repeatable browser coverage and updated docs.

- [ ] **Step 1: Write the e2e test**

Create `e2e/stats-and-interaction.spec.ts`, mirroring the fixtures in `e2e/core-flow.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("shows the stats dashboard and moves a block with the keyboard", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("checkbox", { name: "周一" }).check();
  await page.getByLabelText("开始时间").fill("18:00");
  await page.getByLabelText("结束时间").fill("21:00");
  await page.getByRole("button", { name: "保存可用时间" }).click();
  await page.getByRole("button", { name: "任务录入" }).click();
  await page.getByLabelText("任务名称").fill("软件工程大作业");
  await page.getByLabelText("截止时间").fill("2026-08-21T23:59");
  await page.getByLabelText("剩余工时").fill("12");
  await page.getByRole("button", { name: /保存|添加/ }).click();
  await page.getByRole("button", { name: "冲突分析" }).click();
  await page.getByRole("button", { name: /生成/ }).click();

  await page.getByRole("button", { name: "统计看板" }).click();
  await expect(page.getByRole("heading", { name: "统计看板" })).toBeVisible();
  await expect(page.getByText("活跃任务")).toBeVisible();
});
```

Adapt the selectors to the actual labels used in `AvailabilityStep`/`TaskForm` (read `apps/frontend/src/features/availability/AvailabilityStep.tsx` and `apps/frontend/src/features/tasks/TaskForm.tsx` if the selectors above differ).

- [ ] **Step 2: Run to confirm it executes**

Run: `npm run test:e2e -- --project=chromium`
Expected: the new spec runs (may need the existing seed/reset hooks from `e2e/core-flow.spec.ts`; copy the same `beforeEach` setup used there).

- [ ] **Step 3: Update the docs**

- `README.md`: add a "统计看板" bullet to 项目简介, add `GET /api/stats` to the API list if present, and add the new split/merge endpoints to any endpoint list.
- `SPEC.md`: add two subsections under §5 — `### 5.7 统计看板模块` and `### 5.8 日程交互增强模块` — describing inputs/behavior/outputs/edge cases for the stats endpoint and the split/merge/drag/undo interactions (mirror the format of existing §5.x sections).
- `PLAN.md`: append the seven new tasks with status "completed" and the commit hashes produced above.

- [ ] **Step 4: Run the full verification suite**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all pass, zero failures.

- [ ] **Step 5: Commit**

```bash
git add e2e/stats-and-interaction.spec.ts README.md SPEC.md PLAN.md
git commit -m "docs: document statistics and schedule interaction features"
```

---

## Dependency Map

```text
Task 1 (domain split/merge)
  └─ Task 3 (split/merge API)
Task 2 (stats API) ── independent
Task 4 (stats UI) depends on Task 2
Task 5 (timeline + editor) depends on Task 3 (client methods)
Task 6 (drag + undo) depends on Task 5
Task 7 (e2e + docs) depends on Tasks 4–6
```

Parallelizable pairs: Task 2 and Task 1 can run together; Task 4 and Task 5 can run together after their backend dependencies land.

## Final Verification Checklist

- [ ] `npm test` passes (domain, backend, frontend suites).
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] `npm run test:e2e` passes in Chromium.
- [ ] No new runtime dependency added.
- [ ] The 3 pre-existing uncommitted worktree files still contain their original lines.

# DDL Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic university deadline-conflict planner that analyzes capacity, generates and replans 7–14 day schedules, exports ICS, and ships as an accessible Dockerized WebUI.

**Architecture:** Use an npm-workspace TypeScript monorepo with a framework-independent domain package, a Fastify/SQLite backend, and a React/Vite frontend. Business rules live only in the domain package; the API coordinates validation and persistence; the UI implements the confirmed four-step Organic Productive workflow.

**Tech Stack:** TypeScript, Node.js 22+, npm workspaces, React, Vite, Fastify, better-sqlite3, Vitest, Testing Library, Playwright, Docker, GitLab CI.

## Global Constraints

- Planning uses deterministic 30-minute blocks and a 10% capacity buffer.
- Before persistence or planning, positive task estimates are normalized upward to `toBlockCount(minutes) * 30`; planner-facing `Task.remainingMinutes` is therefore a non-negative multiple of 30.
- Stable scheduling order is: least slack, earliest deadline, higher priority, earlier creation time.
- Frozen blocks during replanning are completed, started, or user-locked blocks.
- All persisted timestamps are UTC ISO strings; display uses an IANA timezone.
- MVP is single-user and uses no LLM, autonomous agent, paid API, or user API key.
- UI design is B “Organic Productive”: `#E8EDDF` background, `#F7F8EE` surface, `#40543A` primary, three-column desktop workspace, responsive stacking, and risk icon + text + color.
- Body text and interactive controls target WCAG AA contrast; the complete four-step workflow must be keyboard operable.
- Risk definitions and error behavior must match `SPEC.md`; implementations may not silently discard work minutes.
- Every behavior change follows red–green–refactor and ends with a focused commit.
- `npm test` is the one-command test entry point; `.gitlab-ci.yml` must contain a job named `unit-test`.
- Do not add authentication, collaboration, school-system scraping, LLM planning, or third-party calendar mutation.

---

## Pre-Execution Gate: Cold-Start Spec Validation

Before merging implementation work, use a different agent type from the primary developer in a fresh session with only `SPEC.md` and `PLAN.md`.

- [x] Create an isolated worktree `opencode-cold-start` from documentation commit `dd37792`.
- [x] Ask a fresh OpenCode agent to implement Tasks 1–2 with the instruction: “Pause and ask when the documents are ambiguous; do not infer missing requirements.”
- [x] Record every question, divergent interpretation, and resulting SPEC/PLAN correction in `SPEC_PROCESS.md`.
- [x] Review the validation worktree separately before reusing any implementation; preserve the original agent commits and record the human correction as its own commit.
- [x] Commit documentation corrections before creating the real `codex/implementation` branch.

## Planned File Structure

```text
.
├── apps/
│   ├── backend/
│   │   ├── src/app.ts
│   │   ├── src/server.ts
│   │   ├── src/config.ts
│   │   ├── src/db/{connection,migrate}.ts
│   │   ├── src/repositories/{task,availability,plan}-repository.ts
│   │   ├── src/routes/{tasks,availability,analysis,plans}.ts
│   │   ├── src/services/ics.ts
│   │   └── test/
│   └── frontend/
│       ├── src/app/App.tsx
│       ├── src/api/client.ts
│       ├── src/components/
│       ├── src/features/{availability,tasks,analysis,plan}/
│       ├── src/styles/{tokens,global}.css
│       └── test/
├── packages/
│   └── domain/
│       ├── src/{types,time,conflict,planner,replan,index}.ts
│       └── test/
├── e2e/core-flow.spec.ts
├── scripts/check-required-docs.mjs
├── Dockerfile
├── .dockerignore
├── .gitlab-ci.yml
├── package.json
├── tsconfig.base.json
├── SPEC.md
├── PLAN.md
├── SPEC_PROCESS.md
├── AGENT_LOG.md
├── README.md
└── REFLECTION.md
```

## Cross-Task Type Contracts

These names and fields are fixed across worktrees. Task 2 places domain types and repository contracts in `packages/domain/src/types.ts`; Task 6 implements those contracts without redeclaring them.

```ts
export type IsoUtc = string;
export type RiskLevel = "red" | "yellow" | "green";
export type Priority = "low" | "medium" | "high";
export type BlockStatus = "planned" | "started" | "completed" | "skipped";

export type Task = {
  id: string;
  courseId: string | null;
  title: string;
  deadline: IsoUtc;
  remainingMinutes: number;
  priority: Priority;
  splittable: boolean;
  minimumBlockMinutes: number;
  status: "active" | "completed" | "archived";
  createdAt: IsoUtc;
  updatedAt: IsoUtc;
};

export type TaskDependency = { predecessorTaskId: string; successorTaskId: string };
export type WeeklyAvailabilityRule = { id: string; weekday: number; startLocalTime: string; endLocalTime: string; timezone: string };
export type AvailabilityException = { id: string; date: string; startLocalTime: string; endLocalTime: string; kind: "available" | "unavailable" };
export type AvailabilityDefinition = {
  timezone: string;
  weeklyRules: readonly WeeklyAvailabilityRule[];
  exceptions: readonly AvailabilityException[];
};
export type AvailabilityBlock = { id: string; startAt: IsoUtc; endAt: IsoUtc };
export type ScheduleBlock = {
  id: string;
  taskId: string;
  startAt: IsoUtc;
  endAt: IsoUtc;
  status: BlockStatus;
  locked: boolean;
};

export type PlanningInput = {
  now: IsoUtc;
  rangeEnd: IsoUtc;
  timezone: string;
  bufferRatio: number;
  tasks: readonly Task[];
  dependencies: readonly TaskDependency[];
  availability: readonly AvailabilityBlock[];
  frozenBlocks: readonly ScheduleBlock[];
};

export type ConflictDetail = {
  deadline: IsoUtc;
  shortageMinutes: number;
  /** All active incomplete tasks due no later than this conflict deadline, in stable order. */
  taskIds: string[];
};
export type InputIssue = { code: string; taskId?: string };
export type DeadlineNode = {
  deadline: IsoUtc;
  requiredMinutes: number;
  effectiveCapacityMinutes: number;
  slackMinutes: number;
  taskIds: string[];
};
export type AnalysisWarning = { code: string; taskId?: string; message: string };
export type AnalysisResult =
  | { status: "incomplete"; issues: InputIssue[] }
  | { status: "ready"; risk: RiskLevel; nodes: DeadlineNode[]; firstConflict: ConflictDetail | null; warnings: AnalysisWarning[] };

export type UnscheduledWork = { taskId: string; minutes: number; reason: "NO_CAPACITY" | "NO_CONSECUTIVE_WINDOW" | "DEPENDENCY_BLOCKED" };
export type AllocationExplanation = { taskId: string; blockId: string; reason: string };
export type PlanResult = { blocks: ScheduleBlock[]; unscheduled: UnscheduledWork[]; explanation: AllocationExplanation[] };
export type ReplanInput = PlanningInput & { previousBlocks: readonly ScheduleBlock[] };
export type ProgressResult = { remainingMinutes: number; appliedMinutes: number; overflowMinutes: number };
export type StoredPlan = {
  id: string;
  rangeStart: IsoUtc;
  rangeEnd: IsoUtc;
  version: number;
  riskLevel: RiskLevel;
  unscheduledMinutes: number;
  blocks: ScheduleBlock[];
  createdAt: IsoUtc;
};

export interface TaskRepository {
  listActive(): Task[];
  get(id: string): Task | null;
  save(task: Task): void;
  delete(id: string): boolean;
}
export interface AvailabilityRepository {
  replace(input: AvailabilityDefinition): void;
  get(): AvailabilityDefinition;
}
export interface PlanRepository {
  savePlan(plan: StoredPlan): void;
  getById(id: string): StoredPlan | null;
  getLatest(): StoredPlan | null;
  updateBlock(block: ScheduleBlock): void;
}
```

---

### Task 1: Repository Foundation and Health Vertical Slice

**Depends on:** Approved SPEC/PLAN and cold-start corrections.  
**Can run in parallel with:** None.

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `apps/backend/package.json`
- Create: `apps/backend/tsconfig.json`
- Create: `apps/backend/src/app.ts`
- Create: `apps/backend/src/server.ts`
- Create: `apps/backend/test/health.test.ts`
- Create: `apps/frontend/package.json`
- Create: `apps/frontend/tsconfig.json`
- Create: `apps/frontend/vite.config.ts`
- Create: `apps/frontend/index.html`
- Create: `apps/frontend/src/main.tsx`
- Create: `apps/frontend/src/app/App.tsx`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `buildApp(): Promise<FastifyInstance>` and workspace scripts `test`, `typecheck`, `build`.
- Consumes: No application interfaces.

- [ ] **Step 1: Create workspace manifests and install the locked toolchain**

Root `package.json` must expose one-command verification:

```json
{
  "name": "ddl-radar",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "build": "npm run build --workspaces --if-present",
    "dev": "npm-run-all --parallel dev:backend dev:frontend",
    "dev:backend": "npm --workspace @ddl-radar/backend run dev",
    "dev:frontend": "npm --workspace @ddl-radar/frontend run dev"
  },
  "devDependencies": {
    "npm-run-all": "^4.1.5",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  },
  "engines": { "node": ">=22" }
}
```

Task 1 does not create the domain workspace or any empty `src/` tree. Root `tsconfig.base.json` contains shared `compilerOptions` only and has no project `references`; each workspace `tsconfig.json` extends it directly, so `composite: true` is unnecessary. Backend defines `test`, `typecheck`, and `build` scripts because it already contains source and a health test. Frontend defines `dev`, `typecheck`, and `build`, but does not add a `test` script until its first test is created in Task 9. Therefore root `npm test` runs the backend suite only and exits 0 without relying on `--passWithNoTests`. Extend the existing `.gitignore` rather than replacing it: preserve `.worktrees/` and add `node_modules/`, `dist/`, `*.tsbuildinfo`, `.env`, `*.log`, `.DS_Store`, and `Thumbs.db`.

Run: `npm install`  
Expected: `package-lock.json` is created and no workspace is missing.

- [ ] **Step 2: Write the failing backend health test**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("GET /health", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => app?.close());

  it("returns an explicit healthy response", async () => {
    app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 3: Run the test and observe the correct failure**

Run: `npm --workspace @ddl-radar/backend test -- health.test.ts`  
Expected: FAIL because `../src/app.js` or `buildApp` does not exist.

- [ ] **Step 4: Implement the minimal Fastify application**

```ts
import Fastify from "fastify";

export async function buildApp() {
  const app = Fastify({ logger: false });
  app.get("/health", async () => ({ status: "ok" as const }));
  return app;
}
```

`server.ts` calls `buildApp()`, listens on `HOST` defaulting to `0.0.0.0` and `PORT` defaulting to `3000`, and exits non-zero after logging a startup failure.

- [ ] **Step 5: Create a minimal React build target**

`App.tsx` renders `<h1>DDL Radar</h1>` and `<p>让截止日期变得可安排</p>`. Configure Vite and TypeScript without adding product behavior.

- [ ] **Step 6: Verify the foundation**

Run: `npm test && npm run typecheck && npm run build`  
Expected: health test passes; all three commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json .gitignore apps
git commit -m "chore: bootstrap DDL Radar workspaces"
```

---

### Task 2: Domain Types and 30-Minute Time Normalization

**Depends on:** Task 1.  
**Can run in parallel with:** None; later domain tasks consume these interfaces.

**Files:**
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/src/types.ts`
- Create: `packages/domain/src/time.ts`
- Create: `packages/domain/src/index.ts`
- Create: `packages/domain/test/time.test.ts`

**Interfaces:**
- Produces: `Task`, `AvailabilityDefinition`, `AvailabilityBlock`, `ScheduleBlock`, `PlanningInput`, `Clock`, `TaskRepository`, `AvailabilityRepository`, `PlanRepository`, `toBlockCount(minutes)`, `effectiveCapacityBlocks(blocks, bufferRatio)`.
- Consumes: No application interfaces.

- [ ] **Step 1: Create the domain workspace with its first source and test files**

Create `@ddl-radar/domain` with `test: "vitest run"`, `typecheck: "tsc --noEmit"`, and `build: "tsc"` scripts. Its `tsconfig.json` extends `../../tsconfig.base.json`, includes both `src/**/*.ts` and `test/**/*.ts`, and has neither project references nor `composite`. Create the manifest, configuration, first source files, and first test in the same step so TypeScript never evaluates an empty input set.

- [ ] **Step 2: Write failing normalization tests**

```ts
import { describe, expect, it } from "vitest";
import { effectiveCapacityBlocks, toBlockCount } from "../src/time.js";

describe("30-minute normalization", () => {
  it.each([[0, 0], [1, 1], [30, 1], [31, 2], [90, 3]])(
    "rounds %i minutes up to %i blocks",
    (minutes, expected) => expect(toBlockCount(minutes)).toBe(expected),
  );

  it("reserves ten percent and floors to whole blocks", () => {
    expect(effectiveCapacityBlocks(11, 0.1)).toBe(9);
  });
});
```

- [ ] **Step 3: Run and confirm red**

Run: `npm --workspace @ddl-radar/domain test -- time.test.ts`  
Expected: FAIL because both functions are missing.

- [ ] **Step 4: Implement exact normalization rules**

```ts
export const BLOCK_MINUTES = 30;

export function toBlockCount(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError("minutes must be finite and non-negative");
  return Math.ceil(minutes / BLOCK_MINUTES);
}

export function effectiveCapacityBlocks(blocks: number, bufferRatio: number): number {
  if (!Number.isInteger(blocks) || blocks < 0) throw new RangeError("blocks must be a non-negative integer");
  if (bufferRatio < 0 || bufferRatio >= 1) throw new RangeError("bufferRatio must be in [0, 1)");
  return Math.floor(blocks * (1 - bufferRatio));
}
```

- [ ] **Step 5: Define shared immutable types**

Use discriminated unions for `RiskLevel = "red" | "yellow" | "green"`, `TaskStatus`, and `BlockStatus`. `PlanningInput` contains `now`, `rangeEnd`, `timezone`, `bufferRatio`, readonly tasks, readonly availability blocks, readonly dependencies, and readonly frozen schedule blocks. IDs are strings supplied by callers; domain functions do not generate UUIDs. External estimates may be any non-negative integer minutes, but callers normalize positive values upward with `toBlockCount(minutes) * BLOCK_MINUTES` before constructing a persisted or planner-facing `Task`.

- [ ] **Step 6: Verify exports and boundary failures**

Add tests that negative minutes, fractional block counts, and `bufferRatio === 1` throw the exact `RangeError` messages.  
Run: `npm --workspace @ddl-radar/domain test`  
Expected: all domain tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/package.json packages/domain/tsconfig.json packages/domain/src packages/domain/test/time.test.ts
git commit -m "feat(domain): define planning types and time blocks"
```

---

### Task 3: Deterministic Conflict Analysis

**Depends on:** Task 2.  
**Can run in parallel with:** None; planner consumes the analysis vocabulary.

**Files:**
- Create: `packages/domain/src/conflict.ts`
- Create: `packages/domain/test/fixtures.ts`
- Create: `packages/domain/test/conflict.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `PlanningInput`, `Task`, and block helpers from Task 2.
- Produces: `analyzeConflicts(input: PlanningInput): AnalysisResult` where `AnalysisResult` is either `{ status: "incomplete"; issues: InputIssue[] }` or `{ status: "ready"; risk: RiskLevel; nodes: DeadlineNode[]; firstConflict: ConflictDetail | null; warnings: AnalysisWarning[] }`.

- [x] **Step 1: Write a failing cumulative-capacity test**

Define the test helpers explicitly instead of relying on undeclared fixtures:

```ts
// packages/domain/test/fixtures.ts
import type { AvailabilityBlock, PlanningInput, Task } from "../src/types.js";

const NOW = "2026-08-11T00:00:00.000Z";
const BLOCK_MS = 30 * 60 * 1000;

export function task(id: string, deadline: string, remainingMinutes: number): Task {
  return {
    id,
    courseId: null,
    title: id,
    deadline,
    remainingMinutes,
    priority: "medium",
    splittable: true,
    minimumBlockMinutes: 30,
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

export function blocksBefore(deadline: string, count: number): AvailabilityBlock[] {
  const deadlineMs = new Date(deadline).getTime();
  return Array.from({ length: count }, (_, index) => {
    const startMs = deadlineMs - (count - index) * BLOCK_MS;
    return {
      id: `block-${index}`,
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(startMs + BLOCK_MS).toISOString(),
    };
  });
}

export function makeInput({
  tasks,
  availability,
  bufferRatio = 0.1,
}: Pick<PlanningInput, "tasks" | "availability"> & { bufferRatio?: number }): PlanningInput {
  return {
    now: NOW,
    rangeEnd: "2026-08-25T00:00:00.000Z",
    timezone: "Asia/Shanghai",
    bufferRatio,
    tasks,
    dependencies: [],
    availability,
    frozenBlocks: [],
  };
}
```

```ts
import { expect, it } from "vitest";
import { analyzeConflicts } from "../src/conflict.js";
import { blocksBefore, makeInput, task } from "./fixtures.js";

it("reports the earliest deadline capacity shortage", () => {
  const result = analyzeConflicts(makeInput({
    tasks: [task("math", "2026-08-13T12:00:00.000Z", 240)],
    availability: blocksBefore("2026-08-13T12:00:00.000Z", 6),
    bufferRatio: 0,
  }));

  expect(result).toMatchObject({
    status: "ready",
    risk: "red",
    firstConflict: { deadline: "2026-08-13T12:00:00.000Z", shortageMinutes: 60, taskIds: ["math"] },
  });
});

it("lists every cumulative contributor at the first conflict", () => {
  const currentDeadline = "2026-08-13T12:00:00.000Z";
  const result = analyzeConflicts(makeInput({
    tasks: [
      task("earlier", "2026-08-13T11:30:00.000Z", 30),
      task("current", currentDeadline, 60),
    ],
    availability: blocksBefore(currentDeadline, 2),
    bufferRatio: 0,
  }));

  expect(result).toMatchObject({
    status: "ready",
    firstConflict: { deadline: currentDeadline, shortageMinutes: 30, taskIds: ["earlier", "current"] },
  });
});
```

- [x] **Step 2: Run and confirm red**

Run: `npm --workspace @ddl-radar/domain test -- conflict.test.ts`  
Expected: FAIL because `analyzeConflicts` is missing.

- [x] **Step 3: Implement cumulative deadline nodes**

Group active tasks by identical deadline, sort deadlines ascending, and for each node calculate cumulative required blocks and unique available blocks ending no later than that deadline. Use `effectiveCapacityBlocks` before comparing. Convert block shortage to minutes with `BLOCK_MINUTES`; never round a shortage down. At the first conflicting deadline, `firstConflict.taskIds` contains every active task with remaining work whose deadline is no later than that node—not only tasks newly due at that exact time. Order those IDs deterministically by deadline ascending, priority rank `high > medium > low`, creation time ascending, then task ID ascending.

- [x] **Step 4: Add failing risk-boundary tests**

Add separate tests proving:

```ts
expect(analyzeConflicts(inputWithExactBufferedFit).risk).toBe("yellow");
expect(analyzeConflicts(inputWithMoreThanTenPercentSlack).risk).toBe("green");
expect(analyzeConflicts(inputWithOverdueWork).risk).toBe("red");
expect(analyzeConflicts(inputMissingDeadline)).toEqual({
  status: "incomplete",
  issues: [{ code: "TASK_DEADLINE_MISSING", taskId: "draft" }],
});
```

Run: `npm --workspace @ddl-radar/domain test -- conflict.test.ts`  
Expected: new assertions fail before expanding the implementation.

- [x] **Step 5: Implement yellow/green, incomplete input, and non-splittable warnings**

Yellow means no shortage but minimum slack is no more than 10% of raw cumulative capacity, or an unscheduled non-splittable task has no sufficiently long consecutive availability window before its deadline. Missing required input returns `status: "incomplete"`; it never substitutes zero.

- [x] **Step 6: Add monotonicity and determinism tests**

For fixed fixtures, assert that adding 30 minutes of work cannot improve risk, removing one availability block cannot improve risk, and two calls return deeply equal objects. Use explicit fixture loops rather than random property-test seeds.

- [x] **Step 7: Verify and commit**

Run: `npm --workspace @ddl-radar/domain test && npm --workspace @ddl-radar/domain run typecheck`  
Expected: all tests pass with no warnings.

```bash
git add packages/domain/src/conflict.ts packages/domain/src/index.ts packages/domain/test/fixtures.ts packages/domain/test/conflict.test.ts
git commit -m "feat(domain): analyze cumulative deadline conflicts"
```

**Completed 2026-08-14:** `752d783 feat(domain): analyze cumulative deadline conflicts`. Independent task review: spec compliant and quality approved; one deferred Minor asks final review to consider explicit tests for the full contributor tie-break chain.

---

### Task 4: Stable Schedule Generation

**Depends on:** Tasks 2–3.  
**Can run in parallel with:** None.

**Files:**
- Create: `packages/domain/src/planner.ts`
- Create: `packages/domain/test/planner.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `PlanningInput`, normalized blocks, dependencies, and `AnalysisResult`.
- Produces: `generatePlan(input: PlanningInput): PlanResult` with `{ blocks: ScheduleBlock[]; unscheduled: UnscheduledWork[]; explanation: AllocationExplanation[] }`, and `DependencyCycleError` for invalid cyclic dependency input.

- [x] **Step 1: Write the failing stable-order test**

```ts
it("uses slack, deadline, priority, then creation time as stable tie breakers", () => {
  const input = tiedPlanningInput();
  const first = generatePlan(input);
  const second = generatePlan(input);
  expect(first).toEqual(second);
  expect(first.blocks.map((block) => block.taskId)).toEqual(["urgent-high", "urgent-low", "later"]);
});
```

- [x] **Step 2: Run and confirm red**

Run: `npm --workspace @ddl-radar/domain test -- planner.test.ts`  
Expected: FAIL because `generatePlan` is missing.

- [x] **Step 3: Implement candidate scoring and chronological allocation**

Use this comparator shape and add the task ID as the final defensive tie-breaker:

```ts
type CandidateScore = {
  slackBlocks: number;
  deadlineMs: number;
  priorityRank: number;
  createdAtMs: number;
  taskId: string;
};
```

At each chronological availability block, consider only tasks whose predecessors are complete in the simulated allocation. Sort by `slackBlocks`, `deadlineMs`, descending `priorityRank`, `createdAtMs`, then `taskId`.

- [x] **Step 4: Add failing dependency and non-splittable tests**

```ts
expect(blocksFor(result, "presentation")[0].startAt >= blocksFor(result, "research").at(-1)!.endAt).toBe(true);
expect(blocksFor(result, "exam")).toHaveLength(1);
expect(minutesFor(blocksFor(result, "exam")[0])).toBe(120);
```

Also assert a non-splittable 120-minute task with only separated 60-minute windows appears in `unscheduled` with `{ reason: "NO_CONSECUTIVE_WINDOW", minutes: 120 }`.

- [x] **Step 5: Implement dependency release and consecutive-window placement**

Reject cycles by throwing `DependencyCycleError`. The error exposes `readonly code = "DEPENDENCY_CYCLE"` and a deterministically sorted `readonly taskIds: string[]`; its message is `task dependencies contain a cycle`. This keeps `generatePlan`'s successful return type as `PlanResult`. Place ready non-splittable tasks into the earliest consecutive window that finishes before their deadline, ordered by the same stable comparator; then fill remaining blocks with splittable tasks.

- [x] **Step 6: Prove minute conservation**

Add a test asserting for every normalized planner-facing task:

```ts
expect(scheduledMinutes(result, task.id) + unscheduledMinutes(result, task.id)).toBe(task.remainingMinutes);
```

- [x] **Step 7: Verify and commit**

Run: `npm --workspace @ddl-radar/domain test && npm --workspace @ddl-radar/domain run typecheck`  
Expected: planner, conflict, and time tests pass.

```bash
git add packages/domain/src/planner.ts packages/domain/src/index.ts packages/domain/test/planner.test.ts
git commit -m "feat(domain): generate deterministic schedules"
```

**Completed 2026-08-14:** `df2bee5 feat(domain): generate deterministic schedules`. Independent task review: spec compliant and quality approved with no findings; Task 7 remains responsible for enforcing the documented normalized-minute input boundary.

---

### Task 5: Progress Updates and Replanning

**Depends on:** Task 4.  
**Can run in parallel with:** Task 6 after Task 2 interfaces are stable, but merge Task 5 before API plan routes.

**Files:**
- Create: `packages/domain/src/replan.ts`
- Create: `packages/domain/test/replan.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `PlanningInput`, previous `ScheduleBlock[]`, and progress changes.
- Produces: `replan(input: ReplanInput): PlanResult` and `applyProgress(task: Task, completedMinutes: number): ProgressResult`.

`ReplanInput.tasks[].remainingMinutes` is the current remaining work after all previously reported progress has already been applied. A completed frozen block is preserved as history but never subtracted from `remainingMinutes` again. Started blocks and future user-locked, non-completed blocks represent reserved remaining work, so their duration is subtracted once, capped at the task's current remaining minutes.

- [x] **Step 1: Write the failing frozen-block test**

```ts
it("preserves completed, started, and locked blocks exactly", () => {
  const result = replan(replanFixture());
  expect(result.blocks.filter((block) => ["done", "started", "locked"].includes(block.id)))
    .toEqual(replanFixture().previousBlocks.filter((block) => ["done", "started", "locked"].includes(block.id)));
});
```

- [x] **Step 2: Run red, then implement frozen capacity subtraction**

Run: `npm --workspace @ddl-radar/domain test -- replan.test.ts`  
Expected: FAIL because `replan` is missing.

Build a new `PlanningInput` whose availability excludes frozen intervals and whose task minutes exclude only started and future user-locked, non-completed allocations; call `generatePlan`, then merge and sort frozen plus new blocks. Preserve completed blocks without subtracting them from current remaining work. Add a regression fixture where a task has `remainingMinutes: 30` and a historical completed 60-minute block; replanning must still schedule or report exactly 30 remaining minutes, not zero.

- [x] **Step 3: Add and satisfy progress boundary tests**

```ts
expect(applyProgress(taskWithMinutes(90), 120)).toEqual({ remainingMinutes: 0, appliedMinutes: 90, overflowMinutes: 30 });
expect(() => applyProgress(taskWithMinutes(90), -30)).toThrow("completedMinutes must be non-negative");
```

`applyProgress` is the sole operation in this domain task that reduces current remaining work for newly reported completed minutes. Replanning must not apply the same completion twice.

- [x] **Step 4: Verify and commit**

Run: `npm --workspace @ddl-radar/domain test`  
Expected: all domain tests pass and minute conservation remains green.

```bash
git add packages/domain/src/replan.ts packages/domain/src/index.ts packages/domain/test/replan.test.ts
git commit -m "feat(domain): preserve user decisions during replanning"
```

**Completed 2026-08-14:** `177f38d feat(domain): preserve user decisions during replanning`. Independent task review: spec compliant and quality approved with no findings; controller verification passed 37 domain tests and typecheck.

---

### Task 6: SQLite Schema and Repository Contracts

**Depends on:** Task 2.  
**Can run in parallel with:** Tasks 3–5 in a separate worktree after shared types are committed.

**Files:**
- Modify: `apps/backend/package.json`
- Modify: `package-lock.json`
- Modify: `packages/domain/src/types.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `apps/backend/src/config.ts`
- Create: `apps/backend/src/db/connection.ts`
- Create: `apps/backend/src/db/migrate.ts`
- Create: `apps/backend/src/repositories/task-repository.ts`
- Create: `apps/backend/src/repositories/availability-repository.ts`
- Create: `apps/backend/src/repositories/plan-repository.ts`
- Create: `apps/backend/test/repositories.test.ts`

**Interfaces:**
- Produces: `SqliteTaskRepository`, `SqliteAvailabilityRepository`, `SqlitePlanRepository`, `openDatabase(path)`, `migrate(database)`.
- Consumes: domain entity types and `TaskRepository`, `AvailabilityRepository`, `PlanRepository` contracts from Task 2.

- [x] **Step 1: Install the SQLite runtime and type contract**

Add `better-sqlite3` to backend dependencies and `@types/better-sqlite3` to backend devDependencies, then run `npm install` so `package-lock.json` records the workspace dependency. Dependency installation is setup only; no repository behavior is implemented in this step.

- [x] **Step 2: Write failing repository round-trip and transaction tests**

```ts
it("round-trips a task without changing UTC timestamps", () => {
  const repository = testTaskRepository();
  repository.save(taskFixture);
  expect(repository.get(taskFixture.id)).toEqual(taskFixture);
});

it("does not replace the active plan when writing a block fails", () => {
  const repository = testPlanRepository();
  repository.savePlan(validPlan);
  expect(() => repository.savePlan(planWithOverlappingBlocks)).toThrow("schedule blocks overlap");
  expect(repository.getLatest()).toEqual(validPlan);
});

it("round-trips availability definitions without resolving business rules", () => {
  const repository = testAvailabilityRepository();
  repository.replace(availabilityDefinitionFixture);
  expect(repository.get()).toEqual(availabilityDefinitionFixture);
});
```

- [x] **Step 3: Run and confirm red**

Run: `npm --workspace @ddl-radar/backend test -- repositories.test.ts`  
Expected: FAIL because repositories and migrations are missing.

- [x] **Step 4: Create explicit migrations**

Create tables matching SPEC entities: `courses`, `tasks`, `task_dependencies`, `availability_rules`, `availability_exceptions`, `plans`, and `schedule_blocks`. Include `plans.unscheduled_minutes` because `StoredPlan` and Task 8 persist it. Add foreign keys, unique dependency pairs, plan version uniqueness, and indexes on `tasks(deadline)`, `schedule_blocks(plan_id, start_at)`, and availability date fields. Enable `PRAGMA foreign_keys = ON` on every connection.

- [x] **Step 5: Implement focused repositories**

Repository classes accept a `better-sqlite3` database in their constructor and implement the corresponding domain contracts without redeclaring those interfaces. `SqliteAvailabilityRepository` stores and returns `AvailabilityDefinition` losslessly; it never expands weekly rules or applies exceptions. Convert rows to domain values at one mapping boundary. `SqlitePlanRepository.savePlan` uses one transaction and validates interval overlap before any insert.

- [x] **Step 6: Verify and commit**

Run: `npm --workspace @ddl-radar/backend test -- repositories.test.ts`  
Expected: temporary-database tests pass and leave no files in the repository.

```bash
git add apps/backend/package.json package-lock.json packages/domain/src/types.ts packages/domain/src/index.ts apps/backend/src/config.ts apps/backend/src/db apps/backend/src/repositories apps/backend/test/repositories.test.ts
git commit -m "feat(backend): persist planning data in SQLite"
```

**Completed 2026-08-14:** `91fe275`, `ff7bb2e`, `93cbe03`, and `3d9c156`. Four independent review gates drove lossless ordered round trips, real transaction rollback coverage, versioned legacy-schema upgrades, guarded block updates, and safe rejection of nested migrations. Closure review approved with no findings. Controller verification: backend 15/15 tests, domain 37/37 tests, both typechecks, and `git diff --check` passed.

---

### Task 7: Task and Availability REST API

**Depends on:** Tasks 2 and 6.  
**Can run in parallel with:** Frontend styling Task 9.

**Files:**
- Modify: `apps/backend/package.json`
- Modify: `package-lock.json`
- Modify: `packages/domain/src/types.ts`
- Create: `apps/backend/src/routes/tasks.ts`
- Create: `apps/backend/src/routes/availability.ts`
- Create: `apps/backend/src/http/error-handler.ts`
- Create: `apps/backend/src/services/availability.ts`
- Modify: `apps/backend/src/repositories/task-repository.ts`
- Create: `apps/backend/test/tasks-api.test.ts`
- Create: `apps/backend/test/availability-api.test.ts`
- Modify: `apps/backend/test/repositories.test.ts`
- Modify: `apps/backend/src/app.ts`

**Interfaces:**
- Produces: routes `GET/POST/PATCH/DELETE /api/tasks` and `GET/PUT /api/availability`, plus `resolveAvailability(definition, rangeStart, rangeEnd): AvailabilityBlock[]`.
- Consumes: repository contracts from Task 6 and domain normalization from Task 2.

**Binding Task 7 contracts:**
- Extend the domain-owned `TaskRepository` with `listDependencies(): TaskDependency[]` and `saveWithDependencies(task, predecessorTaskIds): void`. The SQLite implementation replaces one task's incoming dependency edges and saves the task in one transaction; API code never reaches into SQLite directly.
- Task create/update payloads use `predecessorTaskIds`; responses return the normalized stored `Task` plus the same field. Reject missing predecessor IDs as validation errors and reject the candidate graph when it contains a cycle before persistence.
- Inject a `Clock` and ID factory into the app composition boundary for deterministic API tests. Production defaults may be created when `buildApp()` is called, but importing modules performs no I/O and tests use in-memory SQLite.
- Add `@js-temporal/polyfill` as a backend dependency. Availability resolution uses IANA time zones and half-open ranges `[rangeStart, rangeEnd)`; output blocks are unique, chronologically sorted 30-minute UTC intervals with stable content-derived IDs.
- Validate local times as `HH:mm`. Equal endpoints are invalid. An end earlier than its start is an overnight range: split it at local midnight before merging. Weekly ranges merge when overlapping or adjacent on the same weekday; generated normalized IDs are deterministic. Exceptions retain input order and are applied in that order, so a later exception overrides an earlier one. Each rule is normalized to the definition-level timezone.
- Resolve local times with Temporal's compatible DST disambiguation, clip to the requested UTC range, merge intervals, and only emit complete 30-minute blocks. Reject invalid IANA time zones and a non-increasing resolution range with stable validation errors.

- [x] **Step 1: Install timezone support and write failing task validation/repository tests**

Add `@js-temporal/polyfill` to backend dependencies and update the root lockfile. First add repository RED coverage for atomic task/dependency round trips and rollback, then the API validation test below.

```ts
it("returns field errors instead of storing an invalid task", async () => {
  const response = await app.inject({
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
```

- [x] **Step 2: Run red, then implement task schemas and routes**

Run: `npm --workspace @ddl-radar/backend test -- tasks-api.test.ts`  
Expected: FAIL with route not found.

Use Fastify JSON Schema for shape validation and a service-level check for dependency cycles. Before persistence, normalize every positive `remainingMinutes` value upward with `toBlockCount(minutes) * BLOCK_MINUTES`; zero remains zero. Return the normalized stored task with 201, 404 with `{ code: "TASK_NOT_FOUND", message: "任务不存在" }`, and 409 for dependency cycles.

- [x] **Step 3: Write failing availability overlap tests**

Send two overlapping Monday ranges and assert the stored response contains one merged interval. Send an end time equal to start time and assert 400 with field error `endLocalTime: "结束时间必须晚于开始时间"`.

- [x] **Step 4: Implement rule merge and exception override behavior**

Store normalized non-overlapping rules as an `AvailabilityDefinition`. Preserve exception kind and date. Implement a pure application service that expands weekly rules into 30-minute UTC blocks for the requested range and timezone, then applies date exceptions over those rules; repositories do not contain this business logic.

Cover merging, overnight splitting, exception precedence, range clipping, deterministic IDs, and a DST transition using a non-UTC IANA zone. `GET /api/availability` returns the stored normalized definition; `PUT` returns the replacement definition.

- [x] **Step 5: Verify and commit**

Run: `npm --workspace @ddl-radar/backend test`  
Expected: health, repositories, tasks, and availability tests pass.

```bash
git add apps/backend/package.json package-lock.json packages/domain/src/types.ts apps/backend/src/app.ts apps/backend/src/routes apps/backend/src/http apps/backend/src/services apps/backend/src/repositories/task-repository.ts apps/backend/test
git commit -m "feat(api): manage tasks and availability"
```

**Completed 2026-08-14:** `f255b2f`, `83dea98`, `4d35637`, and `fa798f5`. Independent review loops closed availability idempotence/validation/DST alignment, production persistence, task status/reference invariants, named-zone validation, duplicate exception IDs, and form-associated errors. Final review approved with no findings. Controller verification: backend 39/39 tests, domain 37/37 tests, both typechecks, and `git diff --check` passed. The original resolver fixture correction is retained in the local SDD report and is explicitly not counted as valid RED evidence; later remediation cycles provide valid RED coverage.

---

### Task 8: Analysis, Planning, Replanning, and ICS API

**Depends on:** Tasks 3–7.  
**Can run in parallel with:** Task 9 after endpoint response types are committed.

**Files:**
- Modify: `packages/domain/src/types.ts`
- Modify: `apps/backend/src/db/migrate.ts`
- Modify: `apps/backend/src/repositories/task-repository.ts`
- Modify: `apps/backend/src/repositories/plan-repository.ts`
- Create: `apps/backend/src/routes/analysis.ts`
- Create: `apps/backend/src/routes/plans.ts`
- Create: `apps/backend/src/services/ics.ts`
- Create: `apps/backend/test/analysis-api.test.ts`
- Create: `apps/backend/test/plans-api.test.ts`
- Create: `apps/backend/test/ics.test.ts`
- Modify: `apps/backend/test/repositories.test.ts`
- Modify: `apps/backend/src/app.ts`

**Interfaces:**
- Produces: `POST /api/analysis`, `POST /api/plans`, `POST /api/plans/:id/replan`, `PATCH /api/schedule-blocks/:id`, `GET /api/plans/:id/export.ics`.
- Consumes: all domain functions and repositories.

**Binding Task 8 contracts:**
- Analysis and plan creation bodies use `{ planningDays: 7..14, bufferRatio?: number }`; plan creation additionally requires `allowRisk: boolean`. Derive `rangeEnd` by adding local calendar days in the stored IANA timezone to the injected clock time. Default `bufferRatio` is `0.1`.
- Extend the domain-owned `TaskRepository` with `listPlanning(): Task[]`, returning active and completed tasks but excluding archived tasks. Construct one `PlanningInput`; include only dependency edges whose endpoints are in that task set. Analysis, planning, and replanning call domain functions and never duplicate their rules.
- Upgrade SQLite to schema version 3. `schedule_blocks` uses `(plan_id, id)` as its composite primary key so frozen block IDs can survive across plan versions. Preserve existing rows and ordinals in the v2→v3 migration. Change `PlanRepository.updateBlock(planId, block)` accordingly; API block mutation targets the latest plan only.
- `POST /api/plans` returns `{ plan, unscheduled, explanation, analysis }`. Reject red analysis with 409 `RISK_CONFIRMATION_REQUIRED` unless `allowRisk` is true. If resolved availability is empty, return 409 `NO_AVAILABILITY` even when risk is allowed. Plan IDs come from the injected ID factory; version is `latest.version + 1`; persist the sum of per-task unscheduled minutes.
- `POST /api/plans/:id/replan` loads the requested plan, rejects 404 when absent, resolves availability from the injected current time through the stored `rangeEnd`, and passes `previousBlocks` to domain `replan`. It persists and returns a new plan ID/version while frozen block IDs and values remain unchanged. An expired range returns 409 `PLAN_RANGE_EXPIRED`.
- `PATCH /api/schedule-blocks/:id` operates on the latest plan and accepts partial `{ startAt, endAt, status, locked, completedMinutes, allowAfterDeadline }`. Validate shape and UTC intervals. A move must be fully covered by resolved availability. Overlap with a locked sibling returns the exact documented 409 body; other overlaps return `SCHEDULE_CONFLICT` naming the conflicting block. Moving after the task deadline requires `allowAfterDeadline: true`.
- When `completedMinutes` is present, apply domain `applyProgress`, update the task remaining/status and block state, and return overflow details. Run the task and block writes in one injected database transaction so failure cannot partially apply progress. Lock/status-only updates do not change task minutes.
- ICS export reads the requested stored plan and its task titles, converts instants to the availability definition timezone, uses stable `block.id@ddl-radar.local` UIDs and plan `createdAt` for deterministic `DTSTAMP`, emits CRLF, RFC 5545 escaping and 75-octet folding, `text/calendar; charset=utf-8`, and attachment filename `ddl-radar-plan.ics`. Missing plan/task data returns a structured error, never a stack.

- [x] **Step 1: Write the failing course example analysis test**

Build an API fixture with three named tasks and availability that produces a 150-minute shortage by Thursday. Assert status 200 and:

```ts
expect(response.json()).toMatchObject({
  status: "ready",
  risk: "red",
  firstConflict: { shortageMinutes: 150 },
});
```

Run: `npm --workspace @ddl-radar/backend test -- analysis-api.test.ts`  
Expected: FAIL with route not found.

- [x] **Step 2: Implement analysis and plan orchestration**

Load tasks and the `AvailabilityDefinition` through repositories, resolve it through the Task 7 application service, construct one `PlanningInput`, and call domain functions without duplicating risk rules. `POST /api/plans` requires `{ allowRisk: boolean }`; reject red analysis with 409 unless `allowRisk` is true. Persist `unscheduledMinutes` alongside the plan response.

Before route orchestration, write repository RED tests for `listPlanning`, composite schedule-block identities across plan versions, and the v2→v3 data-preserving migration. Then implement the schema/repository changes above.

- [x] **Step 3: Write and satisfy move-conflict tests**

Assert moving a block over a locked block returns 409:

```json
{
  "code": "SCHEDULE_CONFLICT",
  "message": "该时间与已锁定安排冲突",
  "details": { "conflictingBlockId": "locked-1" }
}
```

The repository remains unchanged after the response.

Also cover unavailable-time moves, after-deadline confirmation, progress overflow, atomic task/block rollback, missing block/plan, frozen-block preservation during replan, deterministic version increments, empty availability, and expired replan ranges.

- [x] **Step 4: Write a failing ICS escaping and UID test**

```ts
expect(ics).toContain("SUMMARY:软件工程\\,大作业");
expect(ics).toContain("UID:block-1@ddl-radar.local");
expect(exportAgain).toContain("UID:block-1@ddl-radar.local");
expect(ics).toContain("TZID=Asia/Shanghai");
```

- [x] **Step 5: Implement RFC 5545-safe export**

Use CRLF line endings, escape backslash/comma/semicolon/newline, fold lines longer than 75 octets, generate stable UIDs from block IDs, and return `text/calendar; charset=utf-8` with a fixed safe filename `ddl-radar-plan.ics`.

- [x] **Step 6: Verify and commit**

Run: `npm --workspace @ddl-radar/backend test && npm --workspace @ddl-radar/backend run typecheck`  
Expected: all backend tests pass.

```bash
git add packages/domain/src/types.ts apps/backend/src/app.ts apps/backend/src/db apps/backend/src/repositories apps/backend/src/routes apps/backend/src/services apps/backend/test
git commit -m "feat(api): expose analysis plans and calendar export"
```

**Completed 2026-08-14:** `2bccda6`, `50d182b`, and `405c1d5`. Review remediation added stable locked-conflict priority, strict UTC validation, atomic progress rollback, complete planning/replan boundary coverage, schema v3 composite identities, and RFC 5545 regression evidence. Independent review approved with one deferred Minor: semantic-equivalent UTC strings with different formatting can be misclassified as a move. Controller verification: backend 62/62 tests, domain 37/37 tests, both typechecks, and `git diff --check` passed.

---

### Task 9: Organic Productive Design System and Responsive Shell

**Depends on:** Task 1 and confirmed Open Design prototype.  
**Can run in parallel with:** Tasks 6–8.

**Files:**
- Modify: `apps/frontend/package.json`
- Modify: `package-lock.json`
- Create: `apps/frontend/src/styles/tokens.css`
- Create: `apps/frontend/src/styles/global.css`
- Create: `apps/frontend/src/components/AppShell.tsx`
- Create: `apps/frontend/src/components/RiskBadge.tsx`
- Create: `apps/frontend/src/components/StepNavigation.tsx`
- Create: `apps/frontend/test/setup.ts`
- Create: `apps/frontend/test/app-shell.test.tsx`
- Modify: `apps/frontend/src/app/App.tsx`
- Modify: `apps/frontend/src/main.tsx`

**Interfaces:**
- Produces: `AppShell`, `RiskBadge({ level, label })`, `StepNavigation({ currentStep, onStepChange })`, CSS tokens.
- Consumes: no backend behavior.

**Binding Task 9 contracts:**
- Install `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, and `jsdom` as frontend dev dependencies; add a jsdom Vitest test script/setup and update the root lockfile. No remote font, image, icon, or runtime dependency is allowed.
- Implement only the confirmed B “Organic Productive” direction from the Open Design prototype: sage/mist background, translucent warm-white panels, dark botanical green, muted green text, soft green borders, and low-saturation brick/warm-yellow/plant-green risk colors. Preserve the prototype's OKLCH values with hex fallbacks.
- Tokens cover the six base colors, three risk colors, 18/20/22px organic radii, 44px minimum controls, focus ring, two shadows, spacing scale, display/body/mono system font stacks, and 180ms motion with `prefers-reduced-motion` fallback.
- `AppShell` exposes semantic header, flow navigation, main workspace, and task/summary aside slots. Desktop is exactly `220px minmax(0, 1fr) 300px`; tablet is two columns with the aside spanning; mobile is one column ordered flow → main → aside and has no horizontal overflow.
- Initial shell demo is the confirmed conflict-analysis state, not an A/B selector: heading `DDL Radar`, current step `冲突分析`, visible `高风险`, concise 2.5-hour conflict copy, and compact task/summary preview. Future unavailable steps are actual disabled buttons; completed/current steps remain keyboard reachable.

- [x] **Step 1: Install the frontend test harness and write the failing accessibility test**

Add `"test": "vitest run"` to `apps/frontend/package.json` in the same change that creates the frontend's first test. From this task onward, root `npm test` includes the frontend suite; before this task the workspace intentionally has no frontend test script, avoiding Vitest's no-test exit code 1.

```tsx
render(<App />);
expect(screen.getByRole("heading", { name: "DDL Radar" })).toBeVisible();
expect(screen.getByRole("navigation", { name: "规划步骤" })).toBeVisible();
expect(screen.getByText("高风险")).toHaveAccessibleName(/高风险/);
expect(screen.getByRole("button", { name: "冲突分析" })).toHaveAttribute("aria-current", "step");
```

- [x] **Step 2: Run and confirm red**

Run: `npm --workspace @ddl-radar/frontend test -- app-shell.test.tsx`  
Expected: FAIL because the shell components do not exist.

- [x] **Step 3: Implement tokens and the three-column shell**

Define exact CSS custom properties for the six confirmed colors, 18/20/22px radii, focus ring, shadows, spacing, body/display fonts, and muted risk colors. Use CSS Grid with desktop columns `220px minmax(0, 1fr) 300px`, two columns at 768–1023px, and one column below 768px.

- [x] **Step 4: Implement semantic navigation and risk badge**

RiskBadge always renders an icon with `aria-hidden="true"` plus visible label text. StepNavigation uses buttons, `aria-current="step"`, and does not make future unavailable steps clickable until their inputs are complete.

- [x] **Step 5: Verify and commit**

Run: `npm --workspace @ddl-radar/frontend test && npm --workspace @ddl-radar/frontend run build`  
Expected: tests and production build pass.

```bash
git add apps/frontend/package.json package-lock.json apps/frontend/src apps/frontend/test
git commit -m "feat(ui): establish Organic Productive workspace"
```

**Completed 2026-08-14:** `42c9d0d`, `203e4a0`, and `8ed6c39`. Review remediation locked exact confirmed hex fallbacks, equivalent OKLCH progressive tokens, complete color-mix fallbacks, AA contrast for compact text/risk surfaces, active step styling, and the Organic Productive responsive shell. Independent review approved with no findings. Controller verification: root 106/106 tests, all workspace typechecks, frontend production build, and `git diff --check` passed.

---

### Task 10: Availability and Task Entry Steps

**Depends on:** Tasks 7 and 9.  
**Can run in parallel with:** None because it establishes the frontend API client.

**Files:**
- Create: `apps/frontend/src/api/client.ts`
- Create: `apps/frontend/src/features/availability/AvailabilityStep.tsx`
- Create: `apps/frontend/src/features/tasks/TaskStep.tsx`
- Create: `apps/frontend/src/features/tasks/TaskForm.tsx`
- Create: `apps/frontend/test/availability-step.test.tsx`
- Create: `apps/frontend/test/task-step.test.tsx`
- Modify: `apps/frontend/src/app/App.tsx`

**Interfaces:**
- Produces: typed `api` methods, `AvailabilityStep`, `TaskStep`.
- Consumes: task and availability REST shapes from Task 7.

**Binding Task 10 contracts:**
- `apps/frontend/src/api/client.ts` exports a small typed client whose base URL defaults to same-origin `/api` and whose factory accepts an injected `fetch` for tests. Non-2xx JSON errors surface `message` and `fieldErrors` without throwing away server field names.
- Availability UI may show the simplified PLAN assertion, but the actual `PUT /api/availability` payload must match Task 7 exactly: top-level `{ timezone, weeklyRules, exceptions }`; each weekly rule includes stable local `id`, `weekday`, `startLocalTime`, `endLocalTime`, and rule `timezone`. Use the selected top-level timezone for new weekly rules. Start with `exceptions: []`.
- Browser timezone initializes the select when available; tests may run in jsdom and must still default deterministically to `Asia/Shanghai` when the browser timezone is unavailable or not in the built-in option set. Include at least `Asia/Shanghai`, `Asia/Tokyo`, `Europe/London`, and `America/New_York`.
- Task creation calls `POST /api/tasks` with `courseId: null` unless the backend later gains a course API. The “course fixtures” in this task are local UI labels/colors only; do not invent course persistence or a `/api/courses` endpoint.
- Deadline input is local date/time in the UI and is converted to an ISO UTC instant before API submission. Numeric hours are converted to integer minutes using `Math.round(hours * 60)` before sending; backend block rounding remains authoritative after persistence.
- `TaskStep` owns the local task list returned from API calls and passes it to `TaskForm`; dependency choices are rendered from existing active tasks and must exclude the task currently being created/edited.
- App navigation unlocks step 2 after a saved availability interval, unlocks step 3 only when there is at least one saved active task and at least one saved availability interval, and keeps disabled future steps as actual disabled buttons.

- [x] **Step 1: Write the failing availability submission test**

```tsx
await user.click(screen.getByRole("checkbox", { name: "周一" }));
await user.type(screen.getByLabelText("开始时间"), "18:00");
await user.type(screen.getByLabelText("结束时间"), "21:00");
await user.click(screen.getByRole("button", { name: "保存可用时间" }));
expect(fakeApi.putAvailability).toHaveBeenCalledWith(expect.objectContaining({
  timezone: "Asia/Shanghai",
  weeklyRules: [{ weekday: 1, startLocalTime: "18:00", endLocalTime: "21:00" }],
}));
```

- [x] **Step 2: Run red, then implement controlled availability fields**

Run: `npm --workspace @ddl-radar/frontend test -- availability-step.test.tsx`  
Expected: FAIL because `AvailabilityStep` is missing.

Render browser timezone as the default but allow an IANA timezone select. Associate every error message via `aria-describedby`.

- [x] **Step 3: Write the failing three-task flow test**

Enter “软件工程大作业”, Friday 23:59, 12 hours, high priority; submit and assert the row exposes the title, deadline, `剩余 12 小时`, and `优先级高`. Repeat through a parameterized test for math and English fixtures.

- [x] **Step 4: Implement task form and list**

Use numeric hours in the UI and convert to integer minutes before calling the API. Expose split/non-split and minimum block fields; dependency choices exclude the task itself. Do not proceed to analysis until at least one active task and one availability interval exist.

- [x] **Step 5: Verify and commit**

Run: `npm --workspace @ddl-radar/frontend test`  
Expected: availability, task, and shell tests pass.

```bash
git add apps/frontend/src/api apps/frontend/src/features apps/frontend/src/app/App.tsx apps/frontend/test
git commit -m "feat(ui): capture availability and course tasks"
```

**Completed 2026-08-14:** `75b4fa1` and `9f16464`. Implemented the typed frontend API client, availability entry, task entry, local course fixtures, dependency picker, saved-state navigation gates, startup hydration, guarded timezone fallback, and accessible server-error fallbacks. Initial review found three Important issues; fix round 1 was re-reviewed clean. Controller verification: frontend 16/16 tests, root 115/115 tests, all workspace typechecks, frontend production build, and `git diff --check` passed.

---

### Task 11: Conflict, Plan, Progress, and Export UI

**Depends on:** Tasks 8–10.  
**Can run in parallel with:** None.

**Files:**
- Create: `apps/frontend/src/features/analysis/AnalysisStep.tsx`
- Create: `apps/frontend/src/features/analysis/ConflictCard.tsx`
- Create: `apps/frontend/src/features/plan/PlanStep.tsx`
- Create: `apps/frontend/src/features/plan/WeekTimeline.tsx`
- Create: `apps/frontend/src/features/plan/ProgressDialog.tsx`
- Create: `apps/frontend/test/analysis-step.test.tsx`
- Create: `apps/frontend/test/plan-step.test.tsx`
- Modify: `apps/frontend/src/app/App.tsx`

**Interfaces:**
- Produces: analysis and plan views, progress update, lock/move controls, ICS download action.
- Consumes: typed endpoints from Task 8.

**Binding Task 11 contracts:**
- Extend `apps/frontend/src/api/client.ts` with typed methods for `POST /api/analysis`, `POST /api/plans`, `PATCH /api/schedule-blocks/:id`, and `GET /api/plans/:id/export.ics`. Keep injected fetch support; for ICS return `{ blob, filename }`, parsing `content-disposition` and defaulting to `ddl-radar-plan.ics`.
- Analysis requests use `{ planningDays: 7, bufferRatio: 0.1 }` by default. Create-plan requests use the same planning inputs plus `allowRisk`. A red analysis shows “生成尽力计划” and opens a confirmation dialog before sending `allowRisk: true`; yellow/green show “生成可执行计划” and send without the red confirmation.
- Incomplete analysis renders every `issues[]` item as visible text and does not render a generation button. Ready analysis renders risk, nodes, first conflict shortage, and involved task titles by mapping `taskIds` through the saved task list.
- `PlanStep` receives the latest plan response and current tasks. Schedule blocks are grouped by local day headings. Buttons expose task title, time range, status, and locked state; toggling lock calls `PATCH /api/schedule-blocks/:id` with `{ locked: true|false }` and updates the accessible label to include `已锁定` when true.
- Completing progress uses `PATCH /api/schedule-blocks/:id` with `{ completedMinutes: 60 }`, updates the returned block/task state, and keeps overflow/progress messages visible.
- Keyboard movement is implemented with start/end datetime controls for each block, not pointer-only drag. If the PATCH returns `409 SCHEDULE_CONFLICT`, restore the previous displayed times and show the conflicting block's task title by resolving `details.conflictingBlockId` against the current plan. If the conflict cannot be resolved, show the server message.
- Display `plan.unscheduledMinutes` in a persistent warning panel whenever it is greater than 0. Do not remove the availability/task entry steps; users must be able to go back and edit inputs.

- [ ] **Step 1: Write the failing conflict explanation test**

```tsx
render(<AnalysisStep analysis={redAnalysisFixture} />);
expect(screen.getByRole("status")).toHaveTextContent("周四前缺少 2.5 小时可用时间");
expect(screen.getByText("软件工程大作业")).toBeVisible();
expect(screen.getByText("高风险")).toBeVisible();
expect(screen.getByRole("button", { name: "返回修改" })).toBeEnabled();
expect(screen.getByRole("button", { name: "生成尽力计划" })).toBeEnabled();
```

- [ ] **Step 2: Run red, then implement ready/incomplete/risk states**

Run: `npm --workspace @ddl-radar/frontend test -- analysis-step.test.tsx`  
Expected: FAIL because analysis components are missing.

Incomplete analysis shows each issue and no generation button. Red analysis requires a confirmation dialog before sending `{ allowRisk: true }`. Yellow and green use “生成可执行计划”.

- [ ] **Step 3: Write failing plan interaction tests**

Assert completing 60 minutes calls the progress endpoint, locking a block changes its accessible label to “已锁定”, a 409 move response restores the original position and displays the conflicting block title, and an ICS action uses the server-provided blob and filename.

- [ ] **Step 4: Implement week timeline without mouse-only behavior**

Render days as headings and schedule blocks as buttons. Provide keyboard-accessible “移动时间” fields in addition to pointer dragging. Use the low-saturation risk palette and course colors; preserve readable text contrast. Display unscheduled minutes in a persistent warning panel.

- [ ] **Step 5: Verify and commit**

Run: `npm --workspace @ddl-radar/frontend test && npm --workspace @ddl-radar/frontend run typecheck`  
Expected: all frontend tests pass.

```bash
git add apps/frontend/src/features apps/frontend/src/app/App.tsx apps/frontend/test
git commit -m "feat(ui): analyze conflicts and manage generated plans"
```

---

### Task 12: End-to-End, Accessibility, and Performance Gates

**Depends on:** Tasks 1–11.  
**Can run in parallel with:** Initial documentation drafting in Task 14, but not final verification.

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/core-flow.spec.ts`
- Create: `e2e/keyboard.spec.ts`
- Create: `packages/domain/test/performance.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: running backend/frontend and all user-visible contracts.
- Produces: repeatable browser acceptance and domain performance evidence.

- [ ] **Step 1: Write the failing core-flow browser test**

```ts
test("detects the sample shortage and generates a plan", async ({ page }) => {
  await page.goto("/");
  await enterSampleAvailability(page);
  await enterSampleTasks(page);
  await page.getByRole("button", { name: "冲突分析" }).click();
  await expect(page.getByRole("status")).toContainText("周四前缺少 2.5 小时可用时间");
  await page.getByRole("button", { name: "生成尽力计划" }).click();
  await page.getByRole("button", { name: "仍然生成" }).click();
  await expect(page.getByRole("heading", { name: "未来 7 天计划" })).toBeVisible();
});
```

- [ ] **Step 2: Run and confirm red**

Run: `npm run test:e2e -- --project=chromium`  
Expected: FAIL until test database startup and helper fixtures are wired.

- [ ] **Step 3: Add deterministic E2E seed/reset hooks**

Start backend with a temporary SQLite path and fixed `NOW=2026-08-11T00:00:00.000Z`. Reset through a test-only process hook that is enabled only when `NODE_ENV=test`; do not expose reset routes in production.

- [ ] **Step 4: Add the keyboard-only test**

Use Tab/Shift+Tab/Enter/Space to complete the four-step flow. Assert visible focus on each primary action and no pointer calls in the test.

- [ ] **Step 5: Add the 200-task performance test**

Use a fixed fixture with 200 tasks and 14 days of availability. Measure `analyzeConflicts` and `generatePlan` separately with `performance.now()` and assert each is below 500ms after one unmeasured warm-up call.

- [ ] **Step 6: Verify and commit**

Run: `npm test && npm run test:e2e && npm run build`  
Expected: all unit, integration, browser, and build commands pass.

```bash
git add playwright.config.ts e2e packages/domain/test/performance.test.ts package.json package-lock.json
git commit -m "test: cover the complete planning workflow"
```

---

### Task 13: Docker Distribution and GitLab CI

**Depends on:** Task 12.  
**Can run in parallel with:** Task 14 documentation drafts.

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `.gitlab-ci.yml`
- Create: `scripts/container-smoke.mjs`
- Modify: `apps/backend/src/app.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: one production image, `/health`, served SPA, CI jobs `unit-test` and `container-build`.
- Consumes: production frontend build and backend server.

- [ ] **Step 1: Write a failing container smoke script**

The script requests `http://127.0.0.1:3000/health` and `/`, asserts `{ status: "ok" }`, asserts HTML contains `DDL Radar`, and exits non-zero with the failing URL and status.

Run before the Dockerfile exists: `node scripts/container-smoke.mjs`  
Expected: FAIL with connection refused.

- [ ] **Step 2: Implement the production static-serving boundary**

Register Fastify static files from an absolute `PUBLIC_DIR`; return `index.html` only for non-API GET routes. API 404 responses remain JSON and are never replaced by the SPA.

- [ ] **Step 3: Create the multi-stage Dockerfile**

Use Node 22 slim build and runtime stages, `npm ci`, non-root user, `NODE_ENV=production`, `DATA_DIR=/data`, exposed port 3000, and a health check against `/health`. Copy only production dependencies, backend output, and frontend `dist` into the runtime image.

- [ ] **Step 4: Build, run, and execute the smoke test**

Run:

```bash
docker build -t ddl-radar:test .
docker run --rm -d --name ddl-radar-test -p 3000:3000 -v ddl-radar-test-data:/data ddl-radar:test
node scripts/container-smoke.mjs
docker stop ddl-radar-test
```

Expected: image build succeeds, both smoke requests pass, and the container stops cleanly.

- [ ] **Step 5: Add GitLab CI**

`unit-test` uses Node 22, runs `npm ci`, `npm test`, `npm run typecheck`, and `npm run build`. `container-build` uses Docker-in-Docker and runs `docker build`. Cache npm downloads, not `node_modules`. Neither job prints environment values.

- [ ] **Step 6: Verify and commit**

Run a local YAML parse check and repeat `npm test && npm run build`.  
Expected: zero failures and `.gitlab-ci.yml` contains an exact top-level `unit-test:` key.

```bash
git add Dockerfile .dockerignore .gitlab-ci.yml scripts/container-smoke.mjs apps/backend/src/app.ts package.json
git commit -m "ci: package and verify the Docker application"
```

---

### Task 14: Required Documentation and Process Evidence

**Depends on:** PLAN approval; update throughout Tasks 1–13 and finalize after Task 13.  
**Can run in parallel with:** Implementation, provided factual entries are added only after their events occur.

**Files:**
- Create: `SPEC_PROCESS.md`
- Create: `AGENT_LOG.md`
- Create: `README.md`
- Create: `REFLECTION.md` by the student, not by an agent
- Create: `scripts/check-required-docs.mjs`
- Modify: `PLAN.md` after every task with status and commit hash

**Interfaces:**
- Produces: course evidence and an automated documentation completeness gate.
- Consumes: actual prompts, decisions, cold-start findings, commit hashes, CI URL, deployment URL.

- [ ] **Step 1: Write the failing document-presence check**

```js
import { readFileSync } from "node:fs";

const requirements = {
  "README.md": ["项目简介", "安装", "运行", "分发", "目录结构", "安全边界", "已知限制"],
  "SPEC_PROCESS.md": ["brainstorming 关键节点", "关键迭代", "冷启动验证", "修订前后"],
  "AGENT_LOG.md": ["时间", "Task", "Superpowers", "人工干预", "commit"],
};

for (const [file, headings] of Object.entries(requirements)) {
  const text = readFileSync(file, "utf8");
  for (const heading of headings) {
    if (!text.includes(heading)) throw new Error(`${file} missing ${heading}`);
  }
}
```

Run: `node scripts/check-required-docs.mjs`  
Expected: FAIL because required documents are absent.

- [ ] **Step 2: Write factual SPEC_PROCESS and AGENT_LOG entries**

Record at least three actual iterations: product idea selection, deterministic algorithm refinement, and rejection/replacement of the first UI direction. Include the Open Design CSS-loss incident as an example of human review correcting agent output. Add cold-start agent questions and exact before/after SPEC or PLAN excerpts after that validation occurs.

- [ ] **Step 3: Write README from verified commands**

Include the exact tested `docker build`, `docker run`, local npm commands, data volume behavior, no-API-key statement, directory tree, privacy boundary, supported platform, deployment URL, and known single-user/30-minute-granularity limitations. Do not document an untested command.

- [ ] **Step 4: Reserve REFLECTION for the student**

Create headings only after the student begins their own 1500–2500 Chinese-character reflection. The agent may report factual commit/CI evidence or polish user-authored wording, but must not author the reflection content because the course explicitly forbids AI ghostwriting.

- [ ] **Step 5: Run documentation and repository safety checks**

Run:

```bash
node scripts/check-required-docs.mjs
git grep -n -I -E "(sk-[A-Za-z0-9_-]{16,}|api[_-]?key[[:space:]]*=[[:space:]]*[^$<{])" -- . ':!package-lock.json'
git status --short
```

Expected: document check passes; credential scan has no matches; status shows only intentional documentation changes.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md SPEC_PROCESS.md AGENT_LOG.md PLAN.md scripts/check-required-docs.mjs
git commit -m "docs: document workflow distribution and evidence"
```

Commit `REFLECTION.md` separately only after the student confirms it is their own work.

---

## Dependency and Parallelization Map

```text
Cold-start gate
  └─ Task 1 → Task 2 → Task 3 → Task 4 → Task 5
                   └──────────→ Task 6 → Task 7 → Task 8
          Task 1 ─────────────→ Task 9 → Task 10
                                      Task 8 + Task 10 → Task 11
                                      Task 11 → Task 12 → Task 13
          Documentation Task 14 runs alongside verified milestones
```

- Safe parallel pair after Task 2: domain Tasks 3–5 sequential in one worktree, persistence Task 6 in another.
- Safe parallel pair after Task 7: backend Task 8 and frontend Task 9.
- Tasks 10–13 are integration-heavy and should run sequentially.
- Each worktree maps to one PR; every PR receives spec-compliance review before code-quality review.

## Final Verification Checklist

- [ ] `npm test` passes with zero failing suites.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] `npm run test:e2e` passes in Chromium.
- [ ] Domain performance tests pass for 200 tasks and 14 days.
- [ ] Docker build and container smoke test pass from a clean image.
- [ ] `.gitlab-ci.yml` has a passing `unit-test` job and container build.
- [ ] Public WebUI URL loads the four-step workflow.
- [ ] `SPEC.md`, `PLAN.md`, `SPEC_PROCESS.md`, `README.md`, `AGENT_LOG.md`, and student-authored `REFLECTION.md` are present.
- [ ] Credential scan returns no matches and Git history contains no real credentials.
- [ ] `PLAN.md` records each completed task and commit hash.
- [ ] Final code review reports no unresolved critical or important issue.

import type { FastifyInstance } from "fastify";
import { Temporal } from "@js-temporal/polyfill";
import { analyzeConflicts } from "../../../../packages/domain/src/conflict.js";
import { generatePlan } from "../../../../packages/domain/src/planner.js";
import { replan } from "../../../../packages/domain/src/replan.js";
import { applyProgress } from "../../../../packages/domain/src/replan.js";
import type { AvailabilityBlock, AvailabilityRepository, Clock, PlanRepository, ScheduleBlock, StoredPlan, TaskRepository } from "../../../../packages/domain/src/types.js";
import { ApiError } from "../http/error-handler.js";
import { buildPlanningInput } from "../services/planning.js";
import { createIcs } from "../services/ics.js";

type CreatePlanRequest = { planningDays: number; bufferRatio?: number; allowRisk: boolean };
type SchedulePatch = Partial<Pick<ScheduleBlock, "startAt" | "endAt" | "status" | "locked">> & { completedMinutes?: number; allowAfterDeadline?: boolean };

const createSchema = {
  body: {
    type: "object", required: ["planningDays", "allowRisk"], additionalProperties: false,
    properties: {
      planningDays: { type: "integer", minimum: 7, maximum: 14 },
      bufferRatio: { type: "number", minimum: 0, exclusiveMaximum: 1 },
      allowRisk: { type: "boolean" },
    },
  },
} as const;
const scheduleSchema = {
  body: {
    type: "object", minProperties: 1, additionalProperties: false,
    properties: {
      startAt: { type: "string" }, endAt: { type: "string" }, status: { enum: ["planned", "started", "completed", "skipped"] }, locked: { type: "boolean" },
      completedMinutes: { type: "integer", minimum: 0 }, allowAfterDeadline: { type: "boolean" },
    },
  },
} as const;

function unscheduledMinutes(unscheduled: readonly { minutes: number }[]): number {
  return unscheduled.reduce((total, item) => total + item.minutes, 0);
}

function utcInstant(value: string): string | null {
  if (!value.endsWith("Z")) return null;
  try { return Temporal.Instant.from(value).toString(); } catch { return null; }
}

function isFullyAvailable(startAt: string, endAt: string, availability: readonly AvailabilityBlock[]): boolean {
  let cursor = new Date(startAt).getTime();
  const target = new Date(endAt).getTime();
  for (const block of [...availability].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
    const start = new Date(block.startAt).getTime(); const end = new Date(block.endAt).getTime();
    if (end <= cursor || start > cursor) continue;
    cursor = Math.max(cursor, end);
    if (cursor >= target) return true;
  }
  return false;
}

export function registerPlanRoutes(
  app: FastifyInstance,
  tasks: TaskRepository,
  availability: AvailabilityRepository,
  plans: PlanRepository,
  clock: Clock,
  idFactory: () => string,
  runInTransaction: (work: () => void) => void,
): void {
  app.post<{ Body: CreatePlanRequest }>("/api/plans", { schema: createSchema }, async (request, reply) => {
    const input = buildPlanningInput({ tasks, availability, clock }, request.body);
    const analysis = analyzeConflicts(input);
    if (analysis.status === "ready" && analysis.risk === "red" && !request.body.allowRisk) {
      throw new ApiError(409, { code: "RISK_CONFIRMATION_REQUIRED", message: "当前风险较高，请确认后生成计划" });
    }
    if (input.availability.length === 0) throw new ApiError(409, { code: "NO_AVAILABILITY", message: "没有可用时间，无法生成计划" });
    const generated = generatePlan(input);
    const latest = plans.getLatest();
    const plan: StoredPlan = {
      id: idFactory(),
      rangeStart: input.now,
      rangeEnd: input.rangeEnd,
      version: (latest?.version ?? 0) + 1,
      riskLevel: analysis.status === "ready" ? analysis.risk : "red",
      unscheduledMinutes: unscheduledMinutes(generated.unscheduled),
      blocks: generated.blocks,
      createdAt: input.now,
    };
    plans.savePlan(plan);
    return reply.status(201).send({ plan, unscheduled: generated.unscheduled, explanation: generated.explanation, analysis });
  });

  app.post<{ Params: { id: string } }>("/api/plans/:id/replan", async (request, reply) => {
    const previous = plans.getById(request.params.id);
    if (!previous) throw new ApiError(404, { code: "PLAN_NOT_FOUND", message: "计划不存在" });
    const now = clock.now().toISOString();
    if (new Date(previous.rangeEnd).getTime() <= new Date(now).getTime()) {
      throw new ApiError(409, { code: "PLAN_RANGE_EXPIRED", message: "计划范围已过期" });
    }
    const input = buildPlanningInput({ tasks, availability, clock }, { rangeEnd: previous.rangeEnd });
    const analysis = analyzeConflicts(input);
    const generated = replan({ ...input, previousBlocks: previous.blocks });
    const latest = plans.getLatest();
    const plan: StoredPlan = {
      id: idFactory(), rangeStart: input.now, rangeEnd: previous.rangeEnd,
      version: (latest?.version ?? 0) + 1,
      riskLevel: analysis.status === "ready" ? analysis.risk : "red",
      unscheduledMinutes: unscheduledMinutes(generated.unscheduled), blocks: generated.blocks, createdAt: input.now,
    };
    plans.savePlan(plan);
    return reply.status(201).send({ plan, unscheduled: generated.unscheduled, explanation: generated.explanation, analysis });
  });

  app.get<{ Params: { id: string } }>("/api/plans/:id/export.ics", async (request, reply) => {
    const plan = plans.getById(request.params.id);
    if (!plan) throw new ApiError(404, { code: "PLAN_NOT_FOUND", message: "计划不存在" });
    const taskMap = new Map(plan.blocks.map((block) => [block.taskId, tasks.get(block.taskId)]));
    if ([...taskMap.values()].some((task) => task === null)) {
      throw new ApiError(409, { code: "PLAN_TASK_MISSING", message: "计划中的任务不存在" });
    }
    const definition = availability.get();
    const ics = createIcs(plan, new Map([...taskMap].map(([id, task]) => [id, task!])), definition.timezone);
    return reply
      .header("content-type", "text/calendar; charset=utf-8")
      .header("content-disposition", 'attachment; filename="ddl-radar-plan.ics"')
      .send(ics);
  });

  app.patch<{ Params: { id: string }; Body: SchedulePatch }>("/api/schedule-blocks/:id", { schema: scheduleSchema }, async (request) => {
    const plan = plans.getLatest();
    if (!plan) throw new ApiError(404, { code: "PLAN_NOT_FOUND", message: "计划不存在" });
    const current = plan.blocks.find((block) => block.id === request.params.id);
    if (!current) throw new ApiError(404, { code: "SCHEDULE_BLOCK_NOT_FOUND", message: "安排不存在" });
    const task = tasks.get(current.taskId);
    if (!task) throw new ApiError(409, { code: "PLAN_TASK_MISSING", message: "计划中的任务不存在" });
    const startAt = request.body.startAt === undefined ? current.startAt : utcInstant(request.body.startAt);
    const endAt = request.body.endAt === undefined ? current.endAt : utcInstant(request.body.endAt);
    if (!startAt || !endAt || new Date(endAt).getTime() <= new Date(startAt).getTime()) {
      throw new ApiError(400, { code: "VALIDATION_ERROR", message: "排程块信息不完整", fieldErrors: { startAt: "请输入有效UTC时间", endAt: "结束时间必须晚于开始时间" } });
    }
    const moved = startAt !== current.startAt || endAt !== current.endAt;
    if (moved) {
      const input = buildPlanningInput({ tasks, availability, clock }, { rangeEnd: plan.rangeEnd });
      if (!isFullyAvailable(startAt, endAt, input.availability)) throw new ApiError(409, { code: "SCHEDULE_UNAVAILABLE", message: "该时间不在可用时间内" });
      const conflicts = plan.blocks
        .filter((block) => block.id !== current.id && new Date(startAt).getTime() < new Date(block.endAt).getTime() && new Date(endAt).getTime() > new Date(block.startAt).getTime())
        .sort((left, right) => left.startAt.localeCompare(right.startAt) || left.endAt.localeCompare(right.endAt) || left.id.localeCompare(right.id));
      const lockedConflict = conflicts.find((block) => block.locked);
      if (lockedConflict) throw new ApiError(409, { code: "SCHEDULE_CONFLICT", message: "该时间与已锁定安排冲突", details: { conflictingBlockId: lockedConflict.id } });
      if (conflicts[0]) throw new ApiError(409, { code: "SCHEDULE_CONFLICT", message: "该时间与已有安排冲突", details: { conflictingBlockId: conflicts[0].id } });
      if (new Date(endAt).getTime() > new Date(task.deadline).getTime() && request.body.allowAfterDeadline !== true) {
        throw new ApiError(409, { code: "DEADLINE_CONFIRMATION_REQUIRED", message: "移动到截止时间后需要确认" });
      }
    }
    let updatedTask = task;
    let progress: ReturnType<typeof applyProgress> | undefined;
    const block: ScheduleBlock = {
      ...current, startAt, endAt, status: request.body.completedMinutes === undefined ? request.body.status ?? current.status : "completed", locked: request.body.locked ?? current.locked,
    };
    if (request.body.completedMinutes !== undefined) {
      progress = applyProgress(task, request.body.completedMinutes);
      updatedTask = { ...task, remainingMinutes: progress.remainingMinutes, status: progress.remainingMinutes === 0 ? "completed" : "active", updatedAt: clock.now().toISOString() };
    }
    runInTransaction(() => {
      if (progress) tasks.save(updatedTask);
      plans.updateBlock(plan.id, block);
    });
    return progress ? { block, task: updatedTask, progress } : { block };
  });
}

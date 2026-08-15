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
    const userId = request.user!.id;
    const plan = plans.getLatest(userId);
    if (!plan) throw new ApiError(404, { code: "PLAN_NOT_FOUND", message: "计划不存在" });
    const current = plan.blocks.find((block) => block.id === request.params.id);
    if (!current) throw new ApiError(404, { code: "SCHEDULE_BLOCK_NOT_FOUND", message: "安排不存在" });
    const task = tasks.get(userId, current.taskId);
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
      plans.replaceBlocks(userId, plan.id, [...remaining, left, right]);
      return reply.status(201).send({ blocks: [left, right] });
    } catch (error) { throwEditError(error); }
  });

  app.post<{ Params: { id: string }; Body: MergeBody }>("/api/schedule-blocks/:id/merge", { schema: mergeSchema }, async (request, reply) => {
    const userId = request.user!.id;
    const plan = plans.getLatest(userId);
    if (!plan) throw new ApiError(404, { code: "PLAN_NOT_FOUND", message: "计划不存在" });
    const current = plan.blocks.find((block) => block.id === request.params.id);
    if (!current) throw new ApiError(404, { code: "SCHEDULE_BLOCK_NOT_FOUND", message: "安排不存在" });
    const task = tasks.get(userId, current.taskId);
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
      plans.replaceBlocks(userId, plan.id, [...remaining, merged]);
      return reply.status(201).send({ block: merged });
    } catch (error) { throwEditError(error); }
  });
}

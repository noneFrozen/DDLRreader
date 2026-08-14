import { Temporal } from "@js-temporal/polyfill";
import type { FastifyInstance } from "fastify";
import { BLOCK_MINUTES, toBlockCount } from "../../../../packages/domain/src/time.js";
import type { Clock, Task, TaskRepository } from "../../../../packages/domain/src/types.js";
import { ApiError } from "../http/error-handler.js";

type TaskInput = Partial<Pick<Task, "courseId" | "title" | "deadline" | "remainingMinutes" | "priority" | "splittable" | "minimumBlockMinutes" | "status">> & { predecessorTaskIds?: string[] };
type TaskResponse = Task & { predecessorTaskIds: string[] };

const taskProperties = {
  courseId: { anyOf: [{ type: "string" }, { type: "null" }] },
  title: { type: "string" }, deadline: { type: "string" }, remainingMinutes: { type: "number" },
  priority: { enum: ["low", "medium", "high"] }, splittable: { type: "boolean" }, minimumBlockMinutes: { type: "number" },
  status: { enum: ["active", "completed", "archived"] }, predecessorTaskIds: { type: "array", items: { type: "string" } },
};
const createSchema = { body: { type: "object", additionalProperties: false, properties: taskProperties } } as const;
const patchSchema = { body: { type: "object", minProperties: 1, additionalProperties: false, properties: taskProperties } } as const;

function validationError(fieldErrors: Record<string, string>): ApiError {
  return new ApiError(400, { code: "VALIDATION_ERROR", message: "任务信息不完整", fieldErrors });
}

function validateTask(input: TaskInput, isCreate: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  if (isCreate && (!input.title || !input.title.trim())) errors.title = "请输入任务名称";
  if (input.title !== undefined && !input.title.trim()) errors.title = "请输入任务名称";
  if (isCreate && input.deadline === undefined) errors.deadline = "请输入有效截止时间";
  if (input.deadline !== undefined) {
    try { Temporal.Instant.from(input.deadline); } catch { errors.deadline = "请输入有效截止时间"; }
  }
  if (isCreate && input.remainingMinutes === undefined) errors.remainingMinutes = "请输入剩余工时";
  if (input.remainingMinutes !== undefined && (!Number.isInteger(input.remainingMinutes) || input.remainingMinutes < 0)) errors.remainingMinutes = "剩余工时不能为负数";
  if (input.minimumBlockMinutes !== undefined && (!Number.isInteger(input.minimumBlockMinutes) || input.minimumBlockMinutes <= 0 || input.minimumBlockMinutes % BLOCK_MINUTES !== 0)) errors.minimumBlockMinutes = "最小时间块必须是30分钟的正整数倍";
  return errors;
}

function dependenciesFor(repository: TaskRepository, taskId: string): string[] {
  return repository.listDependencies().filter((item) => item.successorTaskId === taskId).map((item) => item.predecessorTaskId).sort();
}

function responseFor(repository: TaskRepository, task: Task): TaskResponse {
  return { ...task, predecessorTaskIds: dependenciesFor(repository, task.id) };
}

function createsCycle(repository: TaskRepository, taskId: string, predecessorTaskIds: readonly string[]): boolean {
  const edges = repository.listDependencies().filter((edge) => edge.successorTaskId !== taskId);
  edges.push(...predecessorTaskIds.map((predecessorTaskId) => ({ predecessorTaskId, successorTaskId: taskId })));
  const successors = new Map<string, string[]>();
  edges.forEach((edge) => successors.set(edge.predecessorTaskId, [...(successors.get(edge.predecessorTaskId) ?? []), edge.successorTaskId]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const cycle = (successors.get(id) ?? []).some(visit);
    visiting.delete(id); visited.add(id);
    return cycle;
  };
  return [...successors.keys()].some(visit);
}

function assertDependencies(repository: TaskRepository, taskId: string, predecessorTaskIds: readonly string[]): void {
  if (predecessorTaskIds.some((id) => repository.get(id) === null)) throw validationError({ predecessorTaskIds: "前置任务不存在" });
  if (createsCycle(repository, taskId, predecessorTaskIds)) throw new ApiError(409, { code: "DEPENDENCY_CYCLE", message: "任务依赖不能形成循环" });
}

export function registerTaskRoutes(app: FastifyInstance, repository: TaskRepository, clock: Clock, idFactory: () => string): void {
  app.get("/api/tasks", async () => repository.listActive().map((task) => responseFor(repository, task)));

  app.post<{ Body: TaskInput }>("/api/tasks", { schema: createSchema }, async (request, reply) => {
    const errors = validateTask(request.body, true);
    if (Object.keys(errors).length) throw validationError(errors);
    const predecessors = [...new Set(request.body.predecessorTaskIds ?? [])].sort();
    if (predecessors.some((id) => repository.get(id) === null)) throw validationError({ predecessorTaskIds: "前置任务不存在" });
    const id = idFactory();
    assertDependencies(repository, id, predecessors);
    const now = clock.now().toISOString();
    const remainingMinutes = request.body.remainingMinutes === 0 ? 0 : toBlockCount(request.body.remainingMinutes ?? 0) * BLOCK_MINUTES;
    const splittable = request.body.splittable ?? true;
    const task: Task = {
      id, courseId: request.body.courseId ?? null, title: request.body.title!.trim(), deadline: Temporal.Instant.from(request.body.deadline!).toString(), remainingMinutes,
      priority: request.body.priority ?? "medium", splittable,
      minimumBlockMinutes: splittable ? request.body.minimumBlockMinutes ?? BLOCK_MINUTES : remainingMinutes || request.body.minimumBlockMinutes || BLOCK_MINUTES,
      status: request.body.status ?? (remainingMinutes === 0 ? "completed" : "active"), createdAt: now, updatedAt: now,
    };
    repository.saveWithDependencies(task, predecessors);
    return reply.status(201).send(responseFor(repository, task));
  });

  app.patch<{ Params: { id: string }; Body: TaskInput }>("/api/tasks/:id", { schema: patchSchema }, async (request) => {
    const existing = repository.get(request.params.id);
    if (!existing) throw new ApiError(404, { code: "TASK_NOT_FOUND", message: "任务不存在" });
    const errors = validateTask(request.body, false);
    if (Object.keys(errors).length) throw validationError(errors);
    const predecessors = request.body.predecessorTaskIds === undefined ? dependenciesFor(repository, existing.id) : [...new Set(request.body.predecessorTaskIds)].sort();
    assertDependencies(repository, existing.id, predecessors);
    const rawMinutes = request.body.remainingMinutes ?? existing.remainingMinutes;
    const remainingMinutes = rawMinutes === 0 ? 0 : toBlockCount(rawMinutes) * BLOCK_MINUTES;
    const splittable = request.body.splittable ?? existing.splittable;
    const task: Task = {
      ...existing, ...request.body, title: request.body.title?.trim() ?? existing.title,
      deadline: request.body.deadline === undefined ? existing.deadline : Temporal.Instant.from(request.body.deadline).toString(), remainingMinutes, splittable,
      minimumBlockMinutes: splittable ? request.body.minimumBlockMinutes ?? existing.minimumBlockMinutes : remainingMinutes || request.body.minimumBlockMinutes || existing.minimumBlockMinutes,
      updatedAt: clock.now().toISOString(),
    };
    delete (task as Partial<TaskInput>).predecessorTaskIds;
    repository.saveWithDependencies(task, predecessors);
    return responseFor(repository, task);
  });

  app.delete<{ Params: { id: string } }>("/api/tasks/:id", async (request, reply) => {
    if (!repository.delete(request.params.id)) throw new ApiError(404, { code: "TASK_NOT_FOUND", message: "任务不存在" });
    return reply.status(204).send();
  });
}

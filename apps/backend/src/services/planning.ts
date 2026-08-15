import { Temporal } from "@js-temporal/polyfill";
import { resolveAvailability } from "./availability.js";
import type { AvailabilityRepository, Clock, PlanningInput, ScheduleBlock, TaskRepository } from "../../../../packages/domain/src/types.js";

export type PlanningDependencies = {
  tasks: TaskRepository;
  availability: AvailabilityRepository;
  clock: Clock;
  userId: string;
};

export type PlanningRequest = {
  planningDays?: number;
  bufferRatio?: number;
  frozenBlocks?: readonly ScheduleBlock[];
  rangeEnd?: string;
};

export function rangeEndFor(now: string, timezone: string, planningDays: number): string {
  return Temporal.Instant.from(now).toZonedDateTimeISO(timezone).add({ days: planningDays }).toInstant().toString();
}

export function buildPlanningInput(dependencies: PlanningDependencies, request: PlanningRequest): PlanningInput {
  const now = dependencies.clock.now().toISOString();
  const definition = dependencies.availability.get(dependencies.userId);
  const rangeEnd = request.rangeEnd ?? rangeEndFor(now, definition.timezone, request.planningDays!);
  const tasks = dependencies.tasks.listPlanning(dependencies.userId);
  const taskIds = new Set(tasks.map((task) => task.id));
  return {
    now,
    rangeEnd,
    timezone: definition.timezone,
    bufferRatio: request.bufferRatio ?? 0.1,
    tasks,
    dependencies: dependencies.tasks.listDependencies(dependencies.userId).filter((edge) => taskIds.has(edge.predecessorTaskId) && taskIds.has(edge.successorTaskId)),
    availability: resolveAvailability(definition, now, rangeEnd),
    frozenBlocks: request.frozenBlocks ?? [],
  };
}

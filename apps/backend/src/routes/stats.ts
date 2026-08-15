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
  app.get("/api/stats", async (request) => {
    const userId = request.user!.id;
    const definition = availability.get(userId);
    const now = clock.now().toISOString();
    const plan = plans.getLatest(userId);
    const rangeStart = plan?.rangeStart ?? now;
    const rangeEnd = plan?.rangeEnd ?? rangeEndFor(now, definition.timezone, 7);
    return buildStats({
      tasks: tasks.listPlanning(userId),
      plan,
      availability: resolveAvailability(definition, rangeStart, rangeEnd),
      now,
      timezone: definition.timezone,
    });
  });
}

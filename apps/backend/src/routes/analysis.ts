import type { FastifyInstance } from "fastify";
import { analyzeConflicts } from "../../../../packages/domain/src/conflict.js";
import type { AvailabilityRepository, Clock, TaskRepository } from "../../../../packages/domain/src/types.js";
import { buildPlanningInput } from "../services/planning.js";

type AnalysisRequest = { planningDays: number; bufferRatio?: number };

const schema = {
  body: {
    type: "object", required: ["planningDays"], additionalProperties: false,
    properties: { planningDays: { type: "integer", minimum: 7, maximum: 14 }, bufferRatio: { type: "number", minimum: 0, exclusiveMaximum: 1 } },
  },
} as const;

export function registerAnalysisRoutes(app: FastifyInstance, tasks: TaskRepository, availability: AvailabilityRepository, clock: Clock): void {
  app.post<{ Body: AnalysisRequest }>("/api/analysis", { schema }, async (request) => {
    return analyzeConflicts(buildPlanningInput({ tasks, availability, clock }, request.body));
  });
}

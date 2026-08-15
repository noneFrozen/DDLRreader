import type { FastifyInstance } from "fastify";
import type { AvailabilityDefinition, AvailabilityRepository } from "../../../../packages/domain/src/types.js";
import { ApiError } from "../http/error-handler.js";
import { normalizeAvailabilityDefinition, validateAvailabilityDefinition } from "../services/availability.js";

const schema = {
  body: {
    type: "object", required: ["timezone", "weeklyRules", "exceptions"], additionalProperties: false,
    properties: {
      timezone: { type: "string" },
      weeklyRules: { type: "array", items: { type: "object", required: ["id", "weekday", "startLocalTime", "endLocalTime", "timezone"], additionalProperties: false, properties: { id: { type: "string" }, weekday: { type: "integer" }, startLocalTime: { type: "string" }, endLocalTime: { type: "string" }, timezone: { type: "string" } } } },
      exceptions: { type: "array", items: { type: "object", required: ["id", "date", "startLocalTime", "endLocalTime", "kind"], additionalProperties: false, properties: { id: { type: "string" }, date: { type: "string" }, startLocalTime: { type: "string" }, endLocalTime: { type: "string" }, kind: { enum: ["available", "unavailable"] } } } },
    },
  },
} as const;

export function registerAvailabilityRoutes(app: FastifyInstance, repository: AvailabilityRepository): void {
  app.get("/api/availability", async (request) => repository.get(request.user!.id));
  app.put<{ Body: AvailabilityDefinition }>("/api/availability", { schema }, async (request) => {
    const errors = validateAvailabilityDefinition(request.body);
    if (Object.keys(errors).length) throw new ApiError(400, { code: "VALIDATION_ERROR", message: "可用时间信息不完整", fieldErrors: errors });
    const definition = normalizeAvailabilityDefinition(request.body);
    repository.replace(request.user!.id, definition);
    return definition;
  });
}

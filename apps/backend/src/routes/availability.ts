import type { FastifyInstance } from "fastify";
import type { AvailabilityDefinition, AvailabilityRepository } from "../../../../packages/domain/src/types.js";
import { ApiError } from "../http/error-handler.js";
import { normalizeAvailabilityDefinition } from "../services/availability.js";

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

function invalidDefinition(input: AvailabilityDefinition): Record<string, string> {
  const errors: Record<string, string> = {};
  if ([...input.weeklyRules, ...input.exceptions].some((rule) => rule.startLocalTime === rule.endLocalTime)) {
    errors.endLocalTime = "结束时间必须晚于开始时间";
  }
  try { normalizeAvailabilityDefinition(input); } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("time zone")) errors.timezone = "请输入有效时区";
    else if (message.includes("equal local times")) errors.endLocalTime = "结束时间必须晚于开始时间";
    else if (message.includes("local time")) errors.startLocalTime = "请输入有效时间";
    else if (message.includes("weekday")) errors.weekday = "请输入有效星期";
    else if (message.includes("date")) errors.date = "请输入有效日期";
  }
  return errors;
}

export function registerAvailabilityRoutes(app: FastifyInstance, repository: AvailabilityRepository): void {
  app.get("/api/availability", async () => repository.get());
  app.put<{ Body: AvailabilityDefinition }>("/api/availability", { schema }, async (request) => {
    const errors = invalidDefinition(request.body);
    if (Object.keys(errors).length) throw new ApiError(400, { code: "VALIDATION_ERROR", message: "可用时间信息不完整", fieldErrors: errors });
    const definition = normalizeAvailabilityDefinition(request.body);
    repository.replace(definition);
    return definition;
  });
}

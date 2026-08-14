import type { FastifyInstance } from "fastify";

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly body: { code: string; message: string; fieldErrors?: Record<string, string>; details?: unknown },
  ) {
    super(body.message);
  }
}

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.status(error.statusCode).send(error.body);
    if (error instanceof Error && "validation" in error && error.validation) {
      return reply.status(400).send({ code: "VALIDATION_ERROR", message: "请求格式不正确" });
    }
    return reply.status(500).send({ code: "INTERNAL_ERROR", message: "服务器内部错误" });
  });
}

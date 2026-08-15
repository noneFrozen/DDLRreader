import type { FastifyInstance } from "fastify";
import type { Clock } from "../../../../packages/domain/src/types.js";
import { ApiError } from "../http/error-handler.js";
import type { SqliteSessionRepository } from "../repositories/session-repository.js";
import type { SqliteUserRepository } from "../repositories/user-repository.js";
import {
  clearSessionCookie,
  hashPassword,
  isValidEmail,
  newSessionId,
  normalizeEmail,
  parseSessionCookie,
  setSessionCookie,
  verifyPassword,
} from "../services/auth.js";

type Credentials = { email: string; password: string };

const credentialsSchema = {
  body: {
    type: "object", required: ["email", "password"], additionalProperties: false,
    properties: { email: { type: "string" }, password: { type: "string" } },
  },
} as const;

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function registerAuthRoutes(
  app: FastifyInstance,
  users: SqliteUserRepository,
  sessions: SqliteSessionRepository,
  clock: Clock,
  idFactory: () => string,
): void {
  const secure = process.env.NODE_ENV === "production";

  app.post<{ Body: Credentials }>("/api/auth/register", { schema: credentialsSchema }, async (request, reply) => {
    const email = normalizeEmail(request.body.email);
    if (!isValidEmail(email)) {
      throw new ApiError(400, { code: "VALIDATION_ERROR", message: "注册信息不完整", fieldErrors: { email: "请输入有效邮箱" } });
    }
    if (request.body.password.length < 8) {
      throw new ApiError(400, { code: "VALIDATION_ERROR", message: "注册信息不完整", fieldErrors: { password: "密码至少 8 位" } });
    }
    if (users.findByEmail(email)) throw new ApiError(409, { code: "EMAIL_TAKEN", message: "该邮箱已注册" });
    const now = clock.now().toISOString();
    const user = users.create({ id: idFactory(), email, passwordHash: await hashPassword(request.body.password), createdAt: now, updatedAt: now });
    const session = { id: newSessionId(), userId: user.id, createdAt: now, expiresAt: new Date(new Date(now).getTime() + SESSION_TTL_MS).toISOString() };
    sessions.create(session);
    setSessionCookie(reply, session.id, secure);
    return reply.status(201).send({ user });
  });

  app.post<{ Body: Credentials }>("/api/auth/login", { schema: credentialsSchema }, async (request, reply) => {
    const email = normalizeEmail(request.body.email);
    const user = users.findByEmail(email);
    const stored = user ? users.getPasswordHash(user.id) : null;
    if (!user || !stored || !(await verifyPassword(request.body.password, stored))) {
      throw new ApiError(401, { code: "INVALID_CREDENTIALS", message: "邮箱或密码错误" });
    }
    const now = clock.now().toISOString();
    const session = { id: newSessionId(), userId: user.id, createdAt: now, expiresAt: new Date(new Date(now).getTime() + SESSION_TTL_MS).toISOString() };
    sessions.create(session);
    setSessionCookie(reply, session.id, secure);
    return { user };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = parseSessionCookie(request);
    if (token) sessions.delete(token);
    clearSessionCookie(reply, secure);
    return { status: "ok" };
  });

  app.get("/api/auth/me", async (request) => {
    const user = request.user;
    if (!user) throw new ApiError(401, { code: "UNAUTHENTICATED", message: "请先登录" });
    return { user };
  });
}

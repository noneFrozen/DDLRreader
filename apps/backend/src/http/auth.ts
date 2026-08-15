import type { FastifyInstance } from "fastify";
import type { Clock } from "../../../../packages/domain/src/types.js";
import type { SqliteSessionRepository } from "../repositories/session-repository.js";
import type { SqliteUserRepository } from "../repositories/user-repository.js";
import { parseSessionCookie } from "../services/auth.js";
import { ApiError } from "./error-handler.js";

declare module "fastify" {
  interface FastifyRequest {
    user: { id: string; email: string } | null;
  }
}

const OPEN_ROUTES = new Set(["/health", "/api/auth/register", "/api/auth/login", "/api/auth/logout"]);

export function installAuth(app: FastifyInstance, users: SqliteUserRepository, sessions: SqliteSessionRepository, clock: Clock): void {
  app.decorateRequest("user", null);
  app.addHook("onRequest", async (request) => {
    request.user = null;
    if (OPEN_ROUTES.has(request.url.split("?")[0])) return;
    const token = parseSessionCookie(request);
    if (!token) throw new ApiError(401, { code: "UNAUTHENTICATED", message: "请先登录" });
    const session = sessions.get(token);
    if (!session || new Date(session.expiresAt).getTime() <= clock.now().getTime()) {
      throw new ApiError(401, { code: "UNAUTHENTICATED", message: "请先登录" });
    }
    const user = users.getById(session.userId);
    if (!user) throw new ApiError(401, { code: "UNAUTHENTICATED", message: "请先登录" });
    request.user = { id: user.id, email: user.email };
  });
}

import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";
import type { Clock } from "../../../packages/domain/src/types.js";
import { migrate } from "./db/migrate.js";
import { getDatabasePath } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { installErrorHandler } from "./http/error-handler.js";
import { installAuth } from "./http/auth.js";
import { SqliteTaskRepository } from "./repositories/task-repository.js";
import { SqliteAvailabilityRepository } from "./repositories/availability-repository.js";
import { SqlitePlanRepository } from "./repositories/plan-repository.js";
import { SqliteUserRepository } from "./repositories/user-repository.js";
import { SqliteSessionRepository } from "./repositories/session-repository.js";
import { registerAvailabilityRoutes } from "./routes/availability.js";
import { registerAnalysisRoutes } from "./routes/analysis.js";
import { registerPlanRoutes } from "./routes/plans.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerStatsRoutes } from "./routes/stats.js";

export type AppOptions = { database?: Database.Database; clock?: Clock; idFactory?: () => string };

export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  const databasePath = getDatabasePath();
  if (!options.database && databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const database = options.database ?? openDatabase(databasePath);
  migrate(database);
  const clock = options.clock ?? { now: () => new Date() };
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  installErrorHandler(app);
  app.get("/health", async () => ({ status: "ok" as const }));
  const taskRepository = new SqliteTaskRepository(database);
  const availabilityRepository = new SqliteAvailabilityRepository(database);
  const planRepository = new SqlitePlanRepository(database);
  const userRepository = new SqliteUserRepository(database);
  const sessionRepository = new SqliteSessionRepository(database);
  registerAuthRoutes(app, userRepository, sessionRepository, clock, idFactory);
  installAuth(app, userRepository, sessionRepository, clock);
  registerTaskRoutes(app, taskRepository, clock, idFactory);
  registerAvailabilityRoutes(app, availabilityRepository);
  registerAnalysisRoutes(app, taskRepository, availabilityRepository, clock);
  registerStatsRoutes(app, taskRepository, availabilityRepository, planRepository, clock);
  registerPlanRoutes(app, taskRepository, availabilityRepository, planRepository, clock, idFactory, (work) => database.transaction(work)());
  if (process.env.NODE_ENV === "test") {
    app.post("/api/test/reset", async (_request, reply) => {
      database.exec("DELETE FROM schedule_blocks");
      database.exec("DELETE FROM plans");
      database.exec("DELETE FROM task_dependencies");
      database.exec("DELETE FROM tasks");
      database.exec("DELETE FROM availability_exceptions");
      database.exec("DELETE FROM availability_rules");
      database.exec("DELETE FROM availability_settings");
      database.exec("DELETE FROM sessions");
      database.exec("DELETE FROM users");
      return reply.status(200).send({ status: "reset" });
    });
  }
  const publicDir = process.env.PUBLIC_DIR;
  if (publicDir && existsSync(publicDir)) {
    await app.register(fastifyStatic, { root: publicDir, prefix: "/" });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.status(404).send({ code: "NOT_FOUND", message: "请求的资源不存在" });
      }
      return reply.sendFile("index.html");
    });
  }
  if (!options.database) app.addHook("onClose", async () => database.close());
  return app;
}

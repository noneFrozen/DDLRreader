import Fastify from "fastify";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type Database from "better-sqlite3";
import type { Clock } from "../../../packages/domain/src/types.js";
import { migrate } from "./db/migrate.js";
import { getDatabasePath } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { installErrorHandler } from "./http/error-handler.js";
import { SqliteTaskRepository } from "./repositories/task-repository.js";
import { SqliteAvailabilityRepository } from "./repositories/availability-repository.js";
import { SqlitePlanRepository } from "./repositories/plan-repository.js";
import { registerAvailabilityRoutes } from "./routes/availability.js";
import { registerAnalysisRoutes } from "./routes/analysis.js";
import { registerPlanRoutes } from "./routes/plans.js";
import { registerTaskRoutes } from "./routes/tasks.js";

export type AppOptions = { database?: Database.Database; clock?: Clock; idFactory?: () => string };

export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: false });
  const databasePath = getDatabasePath();
  if (!options.database) mkdirSync(dirname(databasePath), { recursive: true });
  const database = options.database ?? openDatabase(databasePath);
  migrate(database);
  const clock = options.clock ?? { now: () => new Date() };
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  installErrorHandler(app);
  app.get("/health", async () => ({ status: "ok" as const }));
  const taskRepository = new SqliteTaskRepository(database);
  const availabilityRepository = new SqliteAvailabilityRepository(database);
  const planRepository = new SqlitePlanRepository(database);
  registerTaskRoutes(app, taskRepository, clock, idFactory);
  registerAvailabilityRoutes(app, availabilityRepository);
  registerAnalysisRoutes(app, taskRepository, availabilityRepository, clock);
  registerPlanRoutes(app, taskRepository, availabilityRepository, planRepository, clock, idFactory, (work) => database.transaction(work)());
  if (!options.database) app.addHook("onClose", async () => database.close());
  return app;
}

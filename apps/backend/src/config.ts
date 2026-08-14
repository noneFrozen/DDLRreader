import { join } from "node:path";

export function getDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.DATABASE_PATH ?? join(env.DATA_DIR ?? "data", "ddl-radar.sqlite");
}

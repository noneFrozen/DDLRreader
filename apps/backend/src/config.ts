import { join } from "node:path";

export const databasePath = process.env.DATABASE_PATH ?? join(process.env.DATA_DIR ?? "data", "ddl-radar.sqlite");

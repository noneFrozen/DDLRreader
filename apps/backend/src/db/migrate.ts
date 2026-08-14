import type Database from "better-sqlite3";

const CURRENT_SCHEMA_VERSION = 3;
const LEGACY_TIMESTAMP = "1970-01-01T00:00:00.000Z";

function tableColumns(database: Database.Database, name: string): Set<string> {
  return new Set((database.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((column) => column.name));
}

function tableSql(database: Database.Database, name: string): string {
  return (database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { sql: string } | undefined)?.sql ?? "";
}

function createCurrentTables(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      deadline TEXT NOT NULL,
      remaining_minutes INTEGER NOT NULL,
      priority TEXT NOT NULL,
      splittable INTEGER NOT NULL CHECK (splittable IN (0, 1)),
      minimum_block_minutes INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_dependencies (
      predecessor_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      successor_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      UNIQUE(predecessor_task_id, successor_task_id)
    );

    CREATE TABLE IF NOT EXISTS availability_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      timezone TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS availability_rules (
      id TEXT PRIMARY KEY,
      weekday INTEGER NOT NULL,
      start_local_time TEXT NOT NULL,
      end_local_time TEXT NOT NULL,
      timezone TEXT NOT NULL,
      ordinal INTEGER NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS availability_exceptions (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      start_local_time TEXT NOT NULL,
      end_local_time TEXT NOT NULL,
      kind TEXT NOT NULL,
      ordinal INTEGER NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      range_start TEXT NOT NULL,
      range_end TEXT NOT NULL,
      version INTEGER NOT NULL UNIQUE,
      risk_level TEXT NOT NULL,
      unscheduled_minutes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedule_blocks (
      plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      status TEXT NOT NULL,
      locked INTEGER NOT NULL CHECK (locked IN (0, 1)),
      ordinal INTEGER NOT NULL,
      PRIMARY KEY (plan_id, id),
      UNIQUE(plan_id, ordinal)
    );
  `);
}

function rebuildCourses(database: Database.Database): void {
  database.exec(`
    CREATE TABLE courses_new (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  database.prepare("INSERT INTO courses_new (id, name, color, created_at, updated_at) SELECT id, name, ?, ?, ? FROM courses")
    .run("#6b7280", LEGACY_TIMESTAMP, LEGACY_TIMESTAMP);
  database.exec("DROP TABLE courses; ALTER TABLE courses_new RENAME TO courses;");
}

function rebuildTasks(database: Database.Database): void {
  database.exec(`
    CREATE TABLE tasks_new (
      id TEXT PRIMARY KEY,
      course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
      title TEXT NOT NULL, deadline TEXT NOT NULL, remaining_minutes INTEGER NOT NULL, priority TEXT NOT NULL,
      splittable INTEGER NOT NULL CHECK (splittable IN (0, 1)), minimum_block_minutes INTEGER NOT NULL,
      status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO tasks_new (id, course_id, title, deadline, remaining_minutes, priority, splittable, minimum_block_minutes, status, created_at, updated_at)
      SELECT id, course_id, title, deadline, remaining_minutes, priority,
        CASE WHEN splittable = 1 THEN 1 ELSE 0 END,
        minimum_block_minutes, status, created_at, updated_at
      FROM tasks;
    DROP TABLE tasks;
    ALTER TABLE tasks_new RENAME TO tasks;
  `);
}

function rebuildAvailabilityRules(database: Database.Database): void {
  database.exec(`
    CREATE TABLE availability_rules_new (
      id TEXT PRIMARY KEY, weekday INTEGER NOT NULL, start_local_time TEXT NOT NULL,
      end_local_time TEXT NOT NULL, timezone TEXT NOT NULL, ordinal INTEGER NOT NULL UNIQUE
    );
    INSERT INTO availability_rules_new (id, weekday, start_local_time, end_local_time, timezone, ordinal)
      SELECT id, weekday, start_local_time, end_local_time, timezone, rowid FROM availability_rules ORDER BY rowid;
    DROP TABLE availability_rules;
    ALTER TABLE availability_rules_new RENAME TO availability_rules;
  `);
}

function rebuildAvailabilityExceptions(database: Database.Database): void {
  database.exec(`
    CREATE TABLE availability_exceptions_new (
      id TEXT PRIMARY KEY, date TEXT NOT NULL, start_local_time TEXT NOT NULL,
      end_local_time TEXT NOT NULL, kind TEXT NOT NULL, ordinal INTEGER NOT NULL UNIQUE
    );
    INSERT INTO availability_exceptions_new (id, date, start_local_time, end_local_time, kind, ordinal)
      SELECT id, date, start_local_time, end_local_time, kind, rowid FROM availability_exceptions ORDER BY rowid;
    DROP TABLE availability_exceptions;
    ALTER TABLE availability_exceptions_new RENAME TO availability_exceptions;
  `);
}

function rebuildScheduleBlocks(database: Database.Database, preserveOrdinals: boolean): void {
  database.exec(`
    CREATE TABLE schedule_blocks_new (
      plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      start_at TEXT NOT NULL, end_at TEXT NOT NULL, status TEXT NOT NULL,
      locked INTEGER NOT NULL CHECK (locked IN (0, 1)), ordinal INTEGER NOT NULL,
      PRIMARY KEY (plan_id, id),
      UNIQUE(plan_id, ordinal)
    );
    INSERT INTO schedule_blocks_new (id, plan_id, task_id, start_at, end_at, status, locked, ordinal)
      SELECT id, plan_id, task_id, start_at, end_at, status,
        CASE WHEN locked = 1 THEN 1 ELSE 0 END, ${preserveOrdinals ? "ordinal" : "rowid"}
      FROM schedule_blocks ORDER BY rowid;
    DROP TABLE schedule_blocks;
    ALTER TABLE schedule_blocks_new RENAME TO schedule_blocks;
  `);
}

function createIndexes(database: Database.Database): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
    CREATE INDEX IF NOT EXISTS idx_schedule_blocks_plan_start ON schedule_blocks(plan_id, start_at);
    CREATE INDEX IF NOT EXISTS idx_availability_rules_weekday ON availability_rules(weekday);
    CREATE INDEX IF NOT EXISTS idx_availability_exceptions_date ON availability_exceptions(date);
  `);
}

export function migrate(database: Database.Database): void {
  if (database.inTransaction) throw new Error("migrations cannot run inside a transaction");
  const installedVersion = database.pragma("user_version", { simple: true }) as number;
  database.pragma("foreign_keys = OFF");
  try {
    database.transaction(() => {
      createCurrentTables(database);

      if (installedVersion < CURRENT_SCHEMA_VERSION) {
        if (!tableColumns(database, "courses").has("color")) rebuildCourses(database);
        if (!tableSql(database, "tasks").includes("CHECK (splittable IN (0, 1))")) rebuildTasks(database);
        if (!tableColumns(database, "availability_rules").has("ordinal")) rebuildAvailabilityRules(database);
        if (!tableColumns(database, "availability_exceptions").has("ordinal")) rebuildAvailabilityExceptions(database);
        const blockColumns = tableColumns(database, "schedule_blocks");
        const blockSql = tableSql(database, "schedule_blocks");
        if (!blockColumns.has("ordinal") || !blockSql.includes("CHECK (locked IN (0, 1)") || !blockSql.includes("PRIMARY KEY (plan_id, id)")) {
          rebuildScheduleBlocks(database, blockColumns.has("ordinal"));
        }
      }

      createIndexes(database);
      database.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
    })();
  } finally {
    database.pragma("foreign_keys = ON");
  }
}

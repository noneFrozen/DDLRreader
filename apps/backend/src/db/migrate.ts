import type Database from "better-sqlite3";

const CURRENT_SCHEMA_VERSION = 4;

function createCurrentTables(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      timezone TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS availability_rules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      weekday INTEGER NOT NULL,
      start_local_time TEXT NOT NULL,
      end_local_time TEXT NOT NULL,
      timezone TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      UNIQUE(user_id, ordinal)
    );

    CREATE TABLE IF NOT EXISTS availability_exceptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      start_local_time TEXT NOT NULL,
      end_local_time TEXT NOT NULL,
      kind TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      UNIQUE(user_id, ordinal)
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      range_start TEXT NOT NULL,
      range_end TEXT NOT NULL,
      version INTEGER NOT NULL,
      risk_level TEXT NOT NULL,
      unscheduled_minutes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, version)
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

function migrateToMultiUser(database: Database.Database): void {
  database.exec(`
    DROP TABLE IF EXISTS schedule_blocks;
    DROP TABLE IF EXISTS plans;
    DROP TABLE IF EXISTS task_dependencies;
    DROP TABLE IF EXISTS tasks;
    DROP TABLE IF EXISTS availability_exceptions;
    DROP TABLE IF EXISTS availability_rules;
    DROP TABLE IF EXISTS availability_settings;
    DROP TABLE IF EXISTS courses;
  `);
  createCurrentTables(database);
}

function createIndexes(database: Database.Database): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(user_id, deadline);
    CREATE INDEX IF NOT EXISTS idx_schedule_blocks_plan_start ON schedule_blocks(plan_id, start_at);
    CREATE INDEX IF NOT EXISTS idx_availability_rules_weekday ON availability_rules(user_id, weekday);
    CREATE INDEX IF NOT EXISTS idx_availability_exceptions_date ON availability_exceptions(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);
}

export function migrate(database: Database.Database): void {
  if (database.inTransaction) throw new Error("migrations cannot run inside a transaction");
  const installedVersion = database.pragma("user_version", { simple: true }) as number;
  database.pragma("foreign_keys = OFF");
  try {
    database.transaction(() => {
      createCurrentTables(database);

      if (installedVersion < 4) migrateToMultiUser(database);

      createIndexes(database);
      database.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
    })();
  } finally {
    database.pragma("foreign_keys = ON");
  }
}

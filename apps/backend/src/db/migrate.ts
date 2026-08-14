import type Database from "better-sqlite3";

export function migrate(database: Database.Database): void {
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      deadline TEXT NOT NULL,
      remaining_minutes INTEGER NOT NULL,
      priority TEXT NOT NULL,
      splittable INTEGER NOT NULL,
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
      timezone TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS availability_exceptions (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      start_local_time TEXT NOT NULL,
      end_local_time TEXT NOT NULL,
      kind TEXT NOT NULL
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
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      status TEXT NOT NULL,
      locked INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
    CREATE INDEX IF NOT EXISTS idx_schedule_blocks_plan_start ON schedule_blocks(plan_id, start_at);
    CREATE INDEX IF NOT EXISTS idx_availability_rules_weekday ON availability_rules(weekday);
    CREATE INDEX IF NOT EXISTS idx_availability_exceptions_date ON availability_exceptions(date);
  `);
}

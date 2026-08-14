import type Database from "better-sqlite3";
import type { Task, TaskDependency, TaskRepository } from "../../../../packages/domain/src/types.js";

type TaskRow = {
  id: string;
  course_id: string | null;
  title: string;
  deadline: string;
  remaining_minutes: number;
  priority: Task["priority"];
  splittable: number;
  minimum_block_minutes: number;
  status: Task["status"];
  created_at: string;
  updated_at: string;
};

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    deadline: row.deadline,
    remainingMinutes: row.remaining_minutes,
    priority: row.priority,
    splittable: row.splittable === 1,
    minimumBlockMinutes: row.minimum_block_minutes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteTaskRepository implements TaskRepository {
  constructor(private readonly database: Database.Database) {}

  listActive(): Task[] {
    return this.database.prepare("SELECT * FROM tasks WHERE status = 'active' ORDER BY deadline, id").all().map((row) => toTask(row as TaskRow));
  }

  listDependencies(): TaskDependency[] {
    return this.database.prepare("SELECT predecessor_task_id, successor_task_id FROM task_dependencies ORDER BY successor_task_id, predecessor_task_id")
      .all()
      .map((row) => {
        const dependency = row as { predecessor_task_id: string; successor_task_id: string };
        return { predecessorTaskId: dependency.predecessor_task_id, successorTaskId: dependency.successor_task_id };
      });
  }

  courseExists(id: string): boolean {
    return this.database.prepare("SELECT 1 FROM courses WHERE id = ? LIMIT 1").get(id) !== undefined;
  }

  get(id: string): Task | null {
    const row = this.database.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  save(task: Task): void {
    this.database.prepare(`
      INSERT INTO tasks (id, course_id, title, deadline, remaining_minutes, priority, splittable, minimum_block_minutes, status, created_at, updated_at)
      VALUES (@id, @courseId, @title, @deadline, @remainingMinutes, @priority, @splittable, @minimumBlockMinutes, @status, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        course_id = excluded.course_id, title = excluded.title, deadline = excluded.deadline,
        remaining_minutes = excluded.remaining_minutes, priority = excluded.priority, splittable = excluded.splittable,
        minimum_block_minutes = excluded.minimum_block_minutes, status = excluded.status,
        created_at = excluded.created_at, updated_at = excluded.updated_at
    `).run({ ...task, splittable: Number(task.splittable) });
  }

  saveWithDependencies(task: Task, predecessorTaskIds: readonly string[]): void {
    const saveTask = this.database.transaction(() => {
      this.save(task);
      this.database.prepare("DELETE FROM task_dependencies WHERE successor_task_id = ?").run(task.id);
      const insert = this.database.prepare("INSERT INTO task_dependencies (predecessor_task_id, successor_task_id) VALUES (?, ?)");
      [...new Set(predecessorTaskIds)].forEach((predecessorTaskId) => insert.run(predecessorTaskId, task.id));
    });
    saveTask();
  }

  delete(id: string): boolean {
    return this.database.prepare("DELETE FROM tasks WHERE id = ?").run(id).changes > 0;
  }
}

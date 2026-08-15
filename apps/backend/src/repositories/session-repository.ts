import type Database from "better-sqlite3";

export type Session = { id: string; userId: string; createdAt: string; expiresAt: string };

type SessionRow = { id: string; user_id: string; created_at: string; expires_at: string };

export class SqliteSessionRepository {
  constructor(private readonly database: Database.Database) {}

  create(session: Session): void {
    this.database.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (@id, @userId, @createdAt, @expiresAt)").run(session);
  }

  get(id: string): Session | null {
    const row = this.database.prepare("SELECT id, user_id, created_at, expires_at FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
    return row ? { id: row.id, userId: row.user_id, createdAt: row.created_at, expiresAt: row.expires_at } : null;
  }

  delete(id: string): void {
    this.database.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  deleteExpired(now: string): void {
    this.database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  }
}

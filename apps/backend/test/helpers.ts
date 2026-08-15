import type Database from "better-sqlite3";

export function seedUser(database: Database.Database, userId = "user-1"): void {
  database.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, `${userId}@example.com`, "salt:hash", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
}

export function seedSession(database: Database.Database, userId = "user-1", sessionId = "session-1"): string {
  seedUser(database, userId);
  database.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(sessionId, userId, "2026-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z");
  return `sid=${sessionId}`;
}

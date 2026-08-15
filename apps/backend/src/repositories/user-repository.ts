import type Database from "better-sqlite3";
import type { User } from "../../../../packages/domain/src/types.js";

type UserRow = { id: string; email: string; created_at: string; updated_at: string };

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, createdAt: row.created_at, updatedAt: row.updated_at };
}

export class SqliteUserRepository {
  constructor(private readonly database: Database.Database) {}

  create(input: { id: string; email: string; passwordHash: string; createdAt: string; updatedAt: string }): User {
    this.database.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (@id, @email, @passwordHash, @createdAt, @updatedAt)")
      .run(input);
    return { id: input.id, email: input.email, createdAt: input.createdAt, updatedAt: input.updatedAt };
  }

  findByEmail(email: string): User | null {
    const row = this.database.prepare("SELECT id, email, created_at, updated_at FROM users WHERE email = ?").get(email) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  getById(id: string): User | null {
    const row = this.database.prepare("SELECT id, email, created_at, updated_at FROM users WHERE id = ?").get(id) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  getPasswordHash(id: string): string | null {
    return (this.database.prepare("SELECT password_hash FROM users WHERE id = ?").get(id) as { password_hash: string } | undefined)?.password_hash ?? null;
  }
}

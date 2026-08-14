import Database from "better-sqlite3";

export function openDatabase(path: string): Database.Database {
  const database = new Database(path);
  database.pragma("foreign_keys = ON");
  return database;
}

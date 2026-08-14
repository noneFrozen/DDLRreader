import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { buildApp } from "../src/app.js";

describe("GET /health", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let database: Database.Database | undefined;

  afterEach(async () => {
    await app?.close();
    database?.close();
  });

  it("returns an explicit healthy response", async () => {
    database = new Database(":memory:");
    app = await buildApp({ database });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});

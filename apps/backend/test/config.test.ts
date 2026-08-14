import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { getDatabasePath } from "../src/config.js";

describe("database path configuration", () => {
  it("resolves explicit paths and data directories at call time", () => {
    expect(getDatabasePath({ DATABASE_PATH: "C:/tmp/explicit.sqlite" })).toBe("C:/tmp/explicit.sqlite");
    expect(getDatabasePath({ DATA_DIR: "C:/tmp/data" })).toBe(join("C:/tmp/data", "ddl-radar.sqlite"));
    expect(getDatabasePath({})).toBe(join("data", "ddl-radar.sqlite"));
  });
});

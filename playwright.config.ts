import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: "npm --workspace @ddl-radar/backend run dev",
      port: 3000,
      env: {
        NODE_ENV: "test",
        DATABASE_PATH: ":memory:",
        NOW: "2026-08-11T00:00:00.000Z",
        PORT: "3000",
      },
      reuseExistingServer: false,
    },
    {
      command: "npm --workspace @ddl-radar/frontend run dev",
      port: 5173,
      reuseExistingServer: false,
    },
  ],
});
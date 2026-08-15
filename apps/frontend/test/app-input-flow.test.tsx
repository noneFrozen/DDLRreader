import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App.js";

const AUTH_USER = { user: { id: "u1", email: "a@example.com", createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z" } };

describe("input flow navigation", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("unlocks task entry only after a saved availability interval", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return { ok: true, json: async () => AUTH_USER };
      return url.endsWith("/tasks") ? { ok: true, json: async () => [] } : { ok: true, json: async () => ({ timezone: "Asia/Shanghai", weeklyRules: [], exceptions: [] }) };
    }));
    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: "任务录入" })).toBeVisible());
    expect(screen.getByRole("button", { name: "任务录入" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "周一" }));
    await user.type(screen.getByLabelText("开始时间"), "18:00");
    await user.type(screen.getByLabelText("结束时间"), "21:00");
    await user.click(screen.getByRole("button", { name: "保存可用时间" }));

    expect(screen.getByRole("button", { name: "任务录入" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "冲突分析" })).toBeDisabled();
  });

  it("restores analysis navigation from persisted availability and active tasks", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return { ok: true, json: async () => AUTH_USER };
      if (url.endsWith("/availability")) return { ok: true, json: async () => ({
        timezone: "Asia/Shanghai",
        weeklyRules: [{ id: "monday", weekday: 1, startLocalTime: "18:00", endLocalTime: "21:00", timezone: "Asia/Shanghai" }],
        exceptions: [],
      }) };
      return { ok: true, json: async () => [{
        id: "task-1", courseId: null, title: "已保存任务", deadline: "2026-08-21T15:59:00.000Z", remainingMinutes: 720,
        priority: "high", splittable: true, minimumBlockMinutes: 30, status: "active", createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z", predecessorTaskIds: [],
      }] };
    }));
    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: "冲突分析" })).toBeEnabled());
    expect(screen.getByText("已保存任务")).toBeVisible();
  });

  it("analyzes saved inputs and advances to a generated plan", async () => {
    const user = userEvent.setup();
    const task = {
      id: "task-1", courseId: null, title: "已保存任务", deadline: "2026-08-21T15:59:00.000Z", remainingMinutes: 120,
      priority: "high", splittable: true, minimumBlockMinutes: 30, status: "active", createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z", predecessorTaskIds: [],
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return { ok: true, json: async () => AUTH_USER };
      if (url.endsWith("/availability")) return { ok: true, json: async () => ({ timezone: "Asia/Shanghai", weeklyRules: [{ id: "monday", weekday: 1, startLocalTime: "18:00", endLocalTime: "21:00", timezone: "Asia/Shanghai" }], exceptions: [] }) };
      if (url.endsWith("/tasks")) return { ok: true, json: async () => [task] };
      if (url.endsWith("/analysis")) return { ok: true, json: async () => ({ status: "ready", risk: "green", nodes: [], firstConflict: null, warnings: [] }) };
      if (url.endsWith("/plans")) return { ok: true, json: async () => ({ plan: { id: "plan-1", rangeStart: "2026-08-17T00:00:00.000Z", rangeEnd: "2026-08-24T00:00:00.000Z", version: 1, riskLevel: "green", unscheduledMinutes: 0, blocks: [], createdAt: "2026-08-17T00:00:00.000Z" }, unscheduled: [], explanation: [], analysis: { status: "ready", risk: "green", nodes: [], firstConflict: null, warnings: [] } }) };
      throw new Error(`Unexpected request: ${url}`);
    }));
    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: "冲突分析" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "冲突分析" }));
    expect(await screen.findByRole("button", { name: "生成可执行计划" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "生成可执行计划" }));
    expect(await screen.findByRole("heading", { name: "本周执行计划" })).toBeVisible();
  });

  it("shows a plan-generation failure without leaving an unhandled rejection", async () => {
    const user = userEvent.setup();
    const task = {
      id: "task-1", courseId: null, title: "已保存任务", deadline: "2026-08-21T15:59:00.000Z", remainingMinutes: 120,
      priority: "high", splittable: true, minimumBlockMinutes: 30, status: "active", createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z", predecessorTaskIds: [],
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return { ok: true, json: async () => AUTH_USER };
      if (url.endsWith("/availability")) return { ok: true, json: async () => ({ timezone: "Asia/Shanghai", weeklyRules: [{ id: "monday", weekday: 1, startLocalTime: "18:00", endLocalTime: "21:00", timezone: "Asia/Shanghai" }], exceptions: [] }) };
      if (url.endsWith("/tasks")) return { ok: true, json: async () => [task] };
      if (url.endsWith("/analysis")) return { ok: true, json: async () => ({ status: "ready", risk: "green", nodes: [], firstConflict: null, warnings: [] }) };
      if (url.endsWith("/plans")) return { ok: false, json: async () => ({ message: "计划生成失败" }) };
      throw new Error(`Unexpected request: ${url}`);
    }));
    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: "冲突分析" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "冲突分析" }));
    await user.click(await screen.findByRole("button", { name: "生成可执行计划" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("计划生成失败");
  });
});

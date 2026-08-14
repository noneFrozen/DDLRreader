import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App.js";

describe("input flow navigation", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("unlocks task entry only after a saved availability interval", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).endsWith("/tasks") ? [] : ({ timezone: "Asia/Shanghai", weeklyRules: [], exceptions: [] }),
    })));
    render(<App />);

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
      if (String(input).endsWith("/availability")) return { ok: true, json: async () => ({
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
});

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StatsResponse } from "../src/api/client.js";
import { StatsDashboard } from "../src/features/stats/StatsDashboard.js";

const stats: StatsResponse = {
  taskSummary: { activeCount: 3, completedCount: 1, overdueCount: 1, totalRemainingMinutes: 180, dueThisWeekCount: 2, completionRate: 0.25 },
  priorityDistribution: [
    { priority: "high", count: 2, remainingMinutes: 150 },
    { priority: "medium", count: 1, remainingMinutes: 30 },
    { priority: "low", count: 0, remainingMinutes: 0 },
  ],
  dailyWorkload: [
    { date: "2026-08-17", scheduledMinutes: 60, capacityMinutes: 120 },
    { date: "2026-08-18", scheduledMinutes: 90, capacityMinutes: 60 },
  ],
};

describe("StatsDashboard", () => {
  afterEach(cleanup);

  it("renders overview cards, priority distribution, and daily workload", async () => {
    const api = { getStats: vi.fn().mockResolvedValue(stats) };
    render(<StatsDashboard api={api} />);

    await waitFor(() => expect(screen.getByText("活跃任务")).toBeVisible());
    expect(screen.getByText("3")).toBeVisible();
    expect(screen.getByText("25%")).toBeVisible();
    expect(screen.getByRole("img", { name: /优先级分布/ })).toBeVisible();
    expect(screen.getByRole("img", { name: /每日负载/ })).toBeVisible();
    expect(screen.getByText(/高优先级 2 项/)).toBeVisible();
  });

  it("shows a retry action when loading fails", async () => {
    const api = { getStats: vi.fn().mockRejectedValue(new Error("加载失败")) };
    render(<StatsDashboard api={api} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "重试" })).toBeVisible());
    expect(screen.getByRole("alert")).toHaveTextContent("加载失败");
  });
});

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App.js";

const AUTH_USER = { user: { id: "u1", email: "a@example.com", createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z" } };

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return { ok: true, json: async () => AUTH_USER };
    if (url.endsWith("/availability")) return { ok: true, json: async () => ({ timezone: "Asia/Shanghai", weeklyRules: [], exceptions: [] }) };
    if (url.endsWith("/tasks")) return { ok: true, json: async () => [] };
    throw new Error(`Unexpected request: ${url}`);
  }));
}

describe("Organic Productive workspace", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("renders the availability entry shell with accessible state", async () => {
    stubFetch();
    render(<App />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "DDL Radar" })).toBeVisible());
    expect(screen.getByRole("navigation", { name: "规划步骤" })).toBeVisible();
    expect(screen.getByRole("button", { name: "登出" })).toBeVisible();
    expect(screen.getByRole("button", { name: "可用时间" })).toHaveAttribute("aria-current", "step");
  });

  it("keeps the account control keyboard reachable", async () => {
    const user = userEvent.setup();
    stubFetch();
    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: "登出" })).toBeVisible());
    await user.tab();
    expect(screen.getByRole("button", { name: "登出" })).toHaveFocus();
  });

  it("marks future steps unavailable", async () => {
    stubFetch();
    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: "任务录入" })).toBeVisible());
    expect(screen.getByRole("button", { name: "任务录入" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "冲突分析" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "生成计划" })).toBeDisabled();
  });
});

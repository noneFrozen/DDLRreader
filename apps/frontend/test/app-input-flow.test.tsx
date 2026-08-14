import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App.js";

describe("input flow navigation", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("unlocks task entry only after a saved availability interval", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ timezone: "Asia/Shanghai", weeklyRules: [], exceptions: [] }) })));
    render(<App />);

    expect(screen.getByRole("button", { name: "任务录入" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "周一" }));
    await user.type(screen.getByLabelText("开始时间"), "18:00");
    await user.type(screen.getByLabelText("结束时间"), "21:00");
    await user.click(screen.getByRole("button", { name: "保存可用时间" }));

    expect(screen.getByRole("button", { name: "任务录入" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "冲突分析" })).toBeDisabled();
  });
});

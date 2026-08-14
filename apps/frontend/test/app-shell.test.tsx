import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/app/App.js";

describe("Organic Productive workspace", () => {
  afterEach(cleanup);

  it("renders the conflict analysis shell with accessible state", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "DDL Radar" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "规划步骤" })).toBeVisible();
    expect(screen.getByText("高风险")).toHaveAccessibleName(/高风险/);
    expect(screen.getByRole("button", { name: "冲突分析" })).toHaveAttribute(
      "aria-current",
      "step",
    );
  });

  it("keeps completed and current steps keyboard reachable", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.tab();
    expect(screen.getByRole("button", { name: "可用时间" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "任务录入" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "冲突分析" })).toHaveFocus();
  });

  it("marks future steps unavailable and decorative icons hidden", () => {
    render(<App />);

    expect(screen.getByRole("button", { name: "生成计划" })).toBeDisabled();
    expect(screen.getByText("高风险").previousElementSibling).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});

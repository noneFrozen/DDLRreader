import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageGuide } from "../src/components/UsageGuide.js";

describe("UsageGuide", () => {
  afterEach(cleanup);

  it("renders the five-step guide and closes on button click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<UsageGuide onClose={onClose} />);

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("heading", { name: "使用指南" })).toBeVisible();
    expect(screen.getByText("可用时间")).toBeVisible();
    expect(screen.getByText("任务录入")).toBeVisible();
    expect(screen.getByText("冲突分析")).toBeVisible();
    expect(screen.getByText("生成计划")).toBeVisible();
    expect(screen.getByText("统计看板")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "关闭使用指南" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape key", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<UsageGuide onClose={onClose} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on overlay click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<UsageGuide onClose={onClose} />);

    await user.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalled();
  });
});
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisResult, Task } from "../src/api/client.js";
import { AnalysisStep } from "../src/features/analysis/AnalysisStep.js";

const tasks: Task[] = [{
  id: "task-software", courseId: null, title: "软件工程大作业", deadline: "2026-08-20T16:00:00.000Z",
  remainingMinutes: 240, priority: "high", splittable: true, minimumBlockMinutes: 30, status: "active",
  createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z", predecessorTaskIds: [],
}];

const redAnalysisFixture: AnalysisResult = {
  status: "ready", risk: "red", warnings: [],
  nodes: [{ deadline: "2026-08-20T16:00:00.000Z", requiredMinutes: 240, effectiveCapacityMinutes: 90, slackMinutes: -150, taskIds: ["task-software"] }],
  firstConflict: { deadline: "2026-08-20T16:00:00.000Z", shortageMinutes: 150, taskIds: ["task-software"] },
};

describe("AnalysisStep", () => {
  afterEach(cleanup);

  it("explains the first red conflict and exposes the risk-aware generation action", () => {
    render(<AnalysisStep analysis={redAnalysisFixture} tasks={tasks} />);

    expect(screen.getByRole("status")).toHaveTextContent("周四前缺少 2.5 小时可用时间");
    expect(screen.getByText("软件工程大作业")).toBeVisible();
    expect(screen.getByText("高风险")).toBeVisible();
    expect(screen.getByRole("button", { name: "返回修改" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "生成尽力计划" })).toBeEnabled();
  });

  it("renders every incomplete issue without offering plan generation", () => {
    render(<AnalysisStep analysis={{ status: "incomplete", issues: [{ code: "NO_AVAILABILITY" }, { code: "INVALID_DEADLINE", taskId: "task-software" }] }} tasks={tasks} />);

    expect(screen.getByText("NO_AVAILABILITY")).toBeVisible();
    expect(screen.getByText("INVALID_DEADLINE")).toBeVisible();
    expect(screen.queryByRole("button", { name: /生成/ })).not.toBeInTheDocument();
  });

  it("requires confirmation before requesting a best-effort plan for red risk", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    render(<AnalysisStep analysis={redAnalysisFixture} tasks={tasks} onGenerate={onGenerate} />);

    await user.click(screen.getByRole("button", { name: "生成尽力计划" }));
    expect(onGenerate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认生成尽力计划" }));
    expect(onGenerate).toHaveBeenCalledWith(true);
  });

  it("shows an analysis request error instead of leaving the view busy", () => {
    render(<AnalysisStep analysis={null} tasks={tasks} loading={false} error="分析服务暂不可用" />);

    expect(screen.getByRole("alert")).toHaveTextContent("分析服务暂不可用");
    expect(screen.getByRole("button", { name: "返回修改" })).toBeEnabled();
    expect(screen.queryByText("正在分析冲突…")).not.toBeInTheDocument();
  });
});

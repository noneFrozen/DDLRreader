import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Plan, Task } from "../src/api/client.js";
import { PlanStep } from "../src/features/plan/PlanStep.js";

const tasks: Task[] = [
  { id: "task-software", courseId: null, title: "软件工程大作业", deadline: "2026-08-20T16:00:00.000Z", remainingMinutes: 120, priority: "high", splittable: true, minimumBlockMinutes: 30, status: "active", createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z", predecessorTaskIds: [] },
  { id: "task-math", courseId: null, title: "高等数学作业", deadline: "2026-08-21T12:00:00.000Z", remainingMinutes: 60, priority: "medium", splittable: true, minimumBlockMinutes: 30, status: "active", createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z", predecessorTaskIds: [] },
];

const plan: Plan = {
  id: "plan-1", rangeStart: "2026-08-17T00:00:00.000Z", rangeEnd: "2026-08-24T00:00:00.000Z", version: 1, riskLevel: "yellow", unscheduledMinutes: 30, createdAt: "2026-08-17T00:00:00.000Z",
  blocks: [
    { id: "block-1", taskId: "task-software", startAt: "2026-08-18T10:00:00.000Z", endAt: "2026-08-18T11:00:00.000Z", status: "planned", locked: false },
    { id: "block-2", taskId: "task-math", startAt: "2026-08-18T11:00:00.000Z", endAt: "2026-08-18T12:00:00.000Z", status: "planned", locked: true },
  ],
};

function renderPlan(overrides: Partial<Parameters<typeof PlanStep>[0]> = {}) {
  const patchScheduleBlock = vi.fn(async (id: string, input: Record<string, unknown>) => ({
    block: { ...plan.blocks.find((block) => block.id === id)!, ...input, status: input.completedMinutes === undefined ? plan.blocks.find((block) => block.id === id)!.status : "completed" },
    task: input.completedMinutes === undefined ? undefined : { ...tasks[0], remainingMinutes: 60 },
    progress: input.completedMinutes === undefined ? undefined : { remainingMinutes: 60, appliedMinutes: 60, overflowMinutes: 0 },
  }));
  const api = { patchScheduleBlock, exportPlanIcs: vi.fn().mockResolvedValue({ blob: new Blob(["BEGIN:VCALENDAR"]), filename: "radar-week.ics" }) };
  const effectiveApi = overrides.api ?? api;
  render(<PlanStep plan={plan} tasks={tasks} api={effectiveApi} {...overrides} />);
  return effectiveApi;
}

describe("PlanStep", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("sends a 60-minute completion update and keeps the progress result visible", async () => {
    const user = userEvent.setup();
    const api = renderPlan();

    await user.click(screen.getByRole("button", { name: /软件工程大作业.*未锁定/ }));
    await user.click(screen.getByRole("button", { name: "完成 60 分钟" }));

    await waitFor(() => expect(api.patchScheduleBlock).toHaveBeenCalledWith("block-1", { completedMinutes: 60 }));
    expect(screen.getByRole("status")).toHaveTextContent("已记录 60 分钟");
  });

  it("updates the block label after locking it", async () => {
    const user = userEvent.setup();
    const api = renderPlan();

    await user.click(screen.getByRole("button", { name: "锁定 软件工程大作业" }));

    await waitFor(() => expect(api.patchScheduleBlock).toHaveBeenCalledWith("block-1", { locked: true }));
    expect(screen.getByRole("button", { name: /软件工程大作业.*已锁定/ })).toBeVisible();
  });

  it("restores previous times and names the conflicting task when a move conflicts", async () => {
    const user = userEvent.setup();
    const conflict = Object.assign(new Error("该时间与已有安排冲突"), { code: "SCHEDULE_CONFLICT", details: { conflictingBlockId: "block-2" } });
    const api = renderPlan({ api: { patchScheduleBlock: vi.fn().mockRejectedValue(conflict), exportPlanIcs: vi.fn() } });

    fireEvent.change(screen.getByLabelText("开始时间（软件工程大作业）"), { target: { value: "2026-08-18T11:00" } });
    fireEvent.change(screen.getByLabelText("结束时间（软件工程大作业）"), { target: { value: "2026-08-18T12:00" } });
    await user.click(screen.getByRole("button", { name: "移动 软件工程大作业" }));

    await waitFor(() => expect(api.patchScheduleBlock).toHaveBeenCalled());
    const originalStart = new Date("2026-08-18T10:00:00.000Z");
    const pad = (value: number) => String(value).padStart(2, "0");
    const expectedStart = `${originalStart.getFullYear()}-${pad(originalStart.getMonth() + 1)}-${pad(originalStart.getDate())}T${pad(originalStart.getHours())}:${pad(originalStart.getMinutes())}`;
    expect(screen.getByLabelText("开始时间（软件工程大作业）")).toHaveValue(expectedStart);
    expect(screen.getByRole("alert")).toHaveTextContent("高等数学作业");
  });

  it("downloads ICS using the blob and filename returned by the server", async () => {
    const user = userEvent.setup();
    const createObjectUrl = vi.fn().mockReturnValue("blob:radar-week");
    vi.stubGlobal("URL", { createObjectURL: createObjectUrl, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const api = renderPlan();

    await user.click(screen.getByRole("button", { name: "导出 ICS" }));

    await waitFor(() => expect(api.exportPlanIcs).toHaveBeenCalledWith("plan-1"));
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(screen.getByRole("status")).toHaveTextContent("radar-week.ics");
    expect(click).toHaveBeenCalled();
  });
});

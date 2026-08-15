import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

describe("PlanStep", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  beforeAll(() => {
    if (!HTMLButtonElement.prototype.setPointerCapture) {
      Object.defineProperty(HTMLButtonElement.prototype, "setPointerCapture", { value: vi.fn(), configurable: true });
    }
  });

  function renderPlan(overrides: Partial<Parameters<typeof PlanStep>[0]> = {}) {
    const patchScheduleBlock = vi.fn(async (id: string, input: Record<string, unknown>) => ({
      block: { ...plan.blocks.find((b) => b.id === id)!, ...input, status: input.completedMinutes === undefined ? plan.blocks.find((b) => b.id === id)!.status : "completed" },
      task: input.completedMinutes === undefined ? undefined : { ...tasks[0], remainingMinutes: 60 },
      progress: input.completedMinutes === undefined ? undefined : { remainingMinutes: 60, appliedMinutes: 60, overflowMinutes: 0 },
    }));
    const splitScheduleBlock = vi.fn(async () => ({ blocks: [{ ...plan.blocks[0], id: "block-1a", endAt: "2026-08-18T10:30:00.000Z" }, { ...plan.blocks[0], id: "block-1b", startAt: "2026-08-18T10:30:00.000Z" }] }));
    const mergeScheduleBlock = vi.fn(async () => ({ block: plan.blocks[0] }));
    const api = {
      patchScheduleBlock,
      splitScheduleBlock,
      mergeScheduleBlock,
      exportPlanIcs: vi.fn().mockResolvedValue({ blob: new Blob(["BEGIN:VCALENDAR"]), filename: "radar-week.ics" }),
    };
    const effectiveApi = overrides.api ?? api;
    render(<PlanStep plan={plan} tasks={tasks} api={effectiveApi} {...overrides} />);
    return effectiveApi;
  }

  it("marks a selected block started through the editor", async () => {
    const user = userEvent.setup();
    const api = renderPlan();

    await user.click(screen.getByRole("button", { name: /软件工程大作业/ }));
    await user.click(screen.getByRole("button", { name: "开始" }));

    await waitFor(() => expect(api.patchScheduleBlock).toHaveBeenCalledWith("block-1", { status: "started" }));
  });

  it("locks a block and exposes the updated label", async () => {
    const user = userEvent.setup();
    const api = renderPlan();

    await user.click(screen.getByRole("button", { name: /软件工程大作业/ }));
    await user.click(screen.getByRole("button", { name: "锁定" }));

    await waitFor(() => expect(api.patchScheduleBlock).toHaveBeenCalledWith("block-1", { locked: true }));
  });

  it("sends a 60-minute completion update", async () => {
    const user = userEvent.setup();
    const api = renderPlan();

    await user.click(screen.getByRole("button", { name: /软件工程大作业/ }));
    await user.click(screen.getByRole("button", { name: "完成 60 分钟" }));

    await waitFor(() => expect(api.patchScheduleBlock).toHaveBeenCalledWith("block-1", { completedMinutes: 60 }));
  });

  it("calls the split endpoint for a splittable task", async () => {
    const user = userEvent.setup();
    const api = renderPlan();

    await user.click(screen.getByRole("button", { name: /软件工程大作业/ }));
    await user.click(screen.getByRole("button", { name: "拆分" }));

    await waitFor(() => expect(api.splitScheduleBlock).toHaveBeenCalledWith("block-1"));
  });

  it("restores previous times and names the conflicting task when a move conflicts", async () => {
    const user = userEvent.setup();
    const conflict = Object.assign(new Error("该时间与已有安排冲突"), { code: "SCHEDULE_CONFLICT", details: { conflictingBlockId: "block-2" } });
    const api = renderPlan({ api: {
      patchScheduleBlock: vi.fn().mockRejectedValue(conflict),
      splitScheduleBlock: vi.fn(),
      mergeScheduleBlock: vi.fn(),
      exportPlanIcs: vi.fn(),
    } });

    await user.click(screen.getByRole("button", { name: /软件工程大作业/ }));
    fireEvent.change(screen.getByLabelText("开始时间"), { target: { value: "2026-08-18T11:00" } });
    fireEvent.change(screen.getByLabelText("结束时间"), { target: { value: "2026-08-18T12:00" } });
    await user.click(screen.getByRole("button", { name: "移动" }));

    await waitFor(() => expect(api.patchScheduleBlock).toHaveBeenCalled());
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
    expect(click).toHaveBeenCalled();
  });

  it("exposes undo after a status change and reverts via the inverse patch", async () => {
    const user = userEvent.setup();
    const api = renderPlan();

    await user.click(screen.getByRole("button", { name: /软件工程大作业/ }));
    await user.click(screen.getByRole("button", { name: "开始" }));
    await waitFor(() => expect(api.patchScheduleBlock).toHaveBeenCalledWith("block-1", { status: "started" }));

    await user.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(api.patchScheduleBlock).toHaveBeenCalledWith("block-1", { status: "planned" }));
  });
});
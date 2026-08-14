import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskStep } from "../src/features/tasks/TaskStep.js";

const fixtures = [
  ["软件工程大作业", "2026-08-21T23:59", "12", "high", "优先级高"],
  ["高等数学作业", "2026-08-20T20:00", "4", "medium", "优先级中"],
  ["英语演讲准备", "2026-08-22T18:00", "3.5", "low", "优先级低"],
] as const;

describe("TaskStep", () => {
  afterEach(cleanup);

  it.each(fixtures)("creates %s with its deadline, hours, and priority", async (title, deadline, hours, priority, priorityLabel) => {
    const user = userEvent.setup();
    const fakeApi = {
      listTasks: vi.fn().mockResolvedValue([]),
      createTask: vi.fn().mockImplementation(async (input) => ({
        id: "task-1", ...input, status: "active", createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z",
      })),
    };
    render(<TaskStep api={fakeApi} onTasksChanged={() => undefined} />);

    await user.type(screen.getByLabelText("任务名称"), title);
    fireEvent.change(screen.getByLabelText("截止时间"), { target: { value: deadline } });
    await user.type(screen.getByLabelText("预计工时（小时）"), hours);
    await user.selectOptions(screen.getByLabelText("优先级"), priority);
    await user.click(screen.getByRole("button", { name: "保存任务" }));

    const taskCard = await screen.findByRole("article");
    expect(within(taskCard).getByText(title)).toBeVisible();
    expect(within(taskCard).getByText(`截止 ${deadline.replace("T", " ")}`, { exact: false })).toBeVisible();
    expect(within(taskCard).getByText(`剩余 ${hours} 小时`, { exact: false })).toBeVisible();
    expect(within(taskCard).getByText(priorityLabel, { exact: false })).toBeVisible();
    expect(fakeApi.createTask).toHaveBeenCalledWith(expect.objectContaining({
      courseId: null,
      deadline: new Date(deadline).toISOString(),
      remainingMinutes: Math.round(Number(hours) * 60),
      priority,
    }));
  });
});

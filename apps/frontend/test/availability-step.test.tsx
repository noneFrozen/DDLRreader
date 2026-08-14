import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AvailabilityStep } from "../src/features/availability/AvailabilityStep.js";

describe("AvailabilityStep", () => {
  afterEach(cleanup);

  it("saves selected weekly availability with the selected timezone", async () => {
    const user = userEvent.setup();
    const fakeApi = { putAvailability: vi.fn().mockResolvedValue(undefined) };

    render(<AvailabilityStep api={fakeApi} onSaved={() => undefined} />);

    await user.click(screen.getByRole("checkbox", { name: "周一" }));
    await user.type(screen.getByLabelText("开始时间"), "18:00");
    await user.type(screen.getByLabelText("结束时间"), "21:00");
    await user.click(screen.getByRole("button", { name: "保存可用时间" }));

    expect(fakeApi.putAvailability).toHaveBeenCalledWith(expect.objectContaining({
      timezone: "Asia/Shanghai",
      weeklyRules: [expect.objectContaining({
        id: expect.any(String),
        weekday: 1,
        startLocalTime: "18:00",
        endLocalTime: "21:00",
        timezone: "Asia/Shanghai",
      })],
      exceptions: [],
    }));
  });
});

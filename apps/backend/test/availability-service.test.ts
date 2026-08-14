import { describe, expect, it } from "vitest";
import { resolveAvailability } from "../src/services/availability.js";

describe("resolveAvailability", () => {
  it("merges weekly ranges, applies ordered exceptions, clips the range, and derives stable IDs", () => {
    const definition = {
      timezone: "America/New_York",
      weeklyRules: [
        { id: "first", weekday: 1, startLocalTime: "09:00", endLocalTime: "10:00", timezone: "America/New_York" },
        { id: "adjacent", weekday: 1, startLocalTime: "10:00", endLocalTime: "11:00", timezone: "America/New_York" },
      ],
      exceptions: [
        { id: "remove", date: "2026-03-09", startLocalTime: "09:30", endLocalTime: "10:30", kind: "unavailable" as const },
        { id: "restore", date: "2026-03-09", startLocalTime: "10:00", endLocalTime: "10:30", kind: "available" as const },
      ],
    };
    const first = resolveAvailability(definition, "2026-03-09T13:15:00Z", "2026-03-09T14:45:00Z");
    const second = resolveAvailability(definition, "2026-03-09T13:15:00Z", "2026-03-09T14:45:00Z");
    expect(first).toEqual([
      { id: "availability:2026-03-09T14:00:00Z:2026-03-09T14:30:00Z", startAt: "2026-03-09T14:00:00Z", endAt: "2026-03-09T14:30:00Z" },
    ]);
    expect(second).toEqual(first);
  });

  it("splits overnight weekly rules at midnight", () => {
    const blocks = resolveAvailability({
      timezone: "America/New_York",
      weeklyRules: [{ id: "overnight", weekday: 1, startLocalTime: "23:00", endLocalTime: "01:00", timezone: "America/New_York" }],
      exceptions: [],
    }, "2026-03-10T02:30:00Z", "2026-03-10T05:30:00Z");
    expect(blocks.map((block) => block.startAt)).toEqual(["2026-03-10T03:00:00Z", "2026-03-10T03:30:00Z", "2026-03-10T04:00:00Z", "2026-03-10T04:30:00Z"]);
  });

  it("uses compatible disambiguation for spring-forward and fall-back transitions", () => {
    const spring = resolveAvailability({ timezone: "America/New_York", weeklyRules: [], exceptions: [{ id: "spring", date: "2026-03-08", startLocalTime: "01:00", endLocalTime: "03:00", kind: "available" }] }, "2026-03-08T05:00:00Z", "2026-03-08T08:00:00Z");
    const fall = resolveAvailability({ timezone: "America/New_York", weeklyRules: [], exceptions: [{ id: "fall", date: "2026-11-01", startLocalTime: "01:00", endLocalTime: "02:00", kind: "available" }] }, "2026-11-01T04:00:00Z", "2026-11-01T08:00:00Z");
    expect(spring.map((block) => block.startAt)).toEqual(["2026-03-08T06:00:00Z", "2026-03-08T06:30:00Z"]);
    expect(fall.map((block) => block.startAt)).toEqual(["2026-11-01T05:00:00Z", "2026-11-01T05:30:00Z", "2026-11-01T06:00:00Z", "2026-11-01T06:30:00Z"]);
  });
});

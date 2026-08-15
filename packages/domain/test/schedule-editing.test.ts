import { describe, expect, it } from "vitest";
import { mergeBlocks, ScheduleEditError, splitBlock } from "../src/schedule-editing.js";
import type { ScheduleBlock } from "../src/types.js";

function block(overrides: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return {
    id: "block-1",
    taskId: "task-1",
    startAt: "2026-08-18T10:00:00.000Z",
    endAt: "2026-08-18T11:30:00.000Z",
    status: "planned",
    locked: false,
    ...overrides,
  };
}

describe("splitBlock", () => {
  it("splits a block at an aligned point into two inheriting segments", () => {
    const [left, right] = splitBlock(block(), "2026-08-18T10:30:00.000Z", "left-id", "right-id");
    expect(left).toEqual({ ...block(), id: "left-id", endAt: "2026-08-18T10:30:00.000Z" });
    expect(right).toEqual({ ...block(), id: "right-id", startAt: "2026-08-18T10:30:00.000Z" });
  });

  it("rejects a split point outside the block", () => {
    expect(() => splitBlock(block(), "2026-08-18T11:30:00.000Z", "l", "r")).toThrow(ScheduleEditError);
  });

  it("rejects a split point not aligned to 30 minutes from the start", () => {
    expect(() => splitBlock(block(), "2026-08-18T10:20:00.000Z", "l", "r")).toThrow(ScheduleEditError);
  });

  it("rejects a split that would produce a segment shorter than 30 minutes", () => {
    expect(() => splitBlock(block(), "2026-08-18T10:10:00.000Z", "l", "r")).toThrow(ScheduleEditError);
  });
});

describe("mergeBlocks", () => {
  it("merges two adjacent same-task blocks into the left block", () => {
    const left = block({ startAt: "2026-08-18T10:00:00.000Z", endAt: "2026-08-18T10:30:00.000Z" });
    const right = block({ id: "block-2", startAt: "2026-08-18T10:30:00.000Z", endAt: "2026-08-18T11:00:00.000Z" });
    expect(mergeBlocks(left, right)).toEqual({ ...left, endAt: "2026-08-18T11:00:00.000Z" });
  });

  it("rejects non-adjacent blocks", () => {
    const left = block({ startAt: "2026-08-18T10:00:00.000Z", endAt: "2026-08-18T10:30:00.000Z" });
    const right = block({ id: "block-2", startAt: "2026-08-18T11:00:00.000Z", endAt: "2026-08-18T11:30:00.000Z" });
    expect(() => mergeBlocks(left, right)).toThrow(ScheduleEditError);
  });

  it("rejects blocks of different tasks", () => {
    const left = block({ startAt: "2026-08-18T10:00:00.000Z", endAt: "2026-08-18T10:30:00.000Z" });
    const right = block({ id: "block-2", taskId: "task-2", startAt: "2026-08-18T10:30:00.000Z", endAt: "2026-08-18T11:00:00.000Z" });
    expect(() => mergeBlocks(left, right)).toThrow(ScheduleEditError);
  });

  it("rejects merging blocks whose status is not planned/started", () => {
    const left = block({ startAt: "2026-08-18T10:00:00.000Z", endAt: "2026-08-18T10:30:00.000Z", status: "completed" });
    const right = block({ id: "block-2", startAt: "2026-08-18T10:30:00.000Z", endAt: "2026-08-18T11:00:00.000Z", status: "completed" });
    expect(() => mergeBlocks(left, right)).toThrow(ScheduleEditError);
  });
});

import { BLOCK_MINUTES } from "./time.js";
import type { ScheduleBlock } from "./types.js";

export class ScheduleEditError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ScheduleEditError";
  }
}

function minutesBetween(startAt: string, endAt: string): number {
  return (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000;
}

export function splitBlock(block: ScheduleBlock, at: string, leftId: string, rightId: string): [ScheduleBlock, ScheduleBlock] {
  const startMs = new Date(block.startAt).getTime();
  const endMs = new Date(block.endAt).getTime();
  const atMs = new Date(at).getTime();
  if (atMs <= startMs || atMs >= endMs) throw new ScheduleEditError("SPLIT_POINT_OUTSIDE", "拆分点必须在块起止时间之间");
  if ((atMs - startMs) % (BLOCK_MINUTES * 60_000) !== 0) throw new ScheduleEditError("SPLIT_NOT_ALIGNED", "拆分点必须对齐 30 分钟块");
  if (minutesBetween(block.startAt, at) < BLOCK_MINUTES || minutesBetween(at, block.endAt) < BLOCK_MINUTES) {
    throw new ScheduleEditError("SPLIT_TOO_SMALL", "拆分后每段至少 30 分钟");
  }
  return [
    { ...block, id: leftId, endAt: at },
    { ...block, id: rightId, startAt: at },
  ];
}

export function mergeBlocks(left: ScheduleBlock, right: ScheduleBlock): ScheduleBlock {
  if (left.taskId !== right.taskId) throw new ScheduleEditError("MERGE_NOT_SAME_TASK", "只能合并同一任务的时间块");
  if (left.endAt !== right.startAt) throw new ScheduleEditError("MERGE_NOT_ADJACENT", "只能合并相邻的时间块");
  if (left.locked !== right.locked) throw new ScheduleEditError("MERGE_LOCK_MISMATCH", "锁定状态不一致的时间块不能合并");
  if (left.status !== right.status || (left.status !== "planned" && left.status !== "started")) {
    throw new ScheduleEditError("MERGE_STATUS_INCOMPATIBLE", "只能合并状态一致且为已计划或进行中的时间块");
  }
  return { ...left, endAt: right.endAt };
}

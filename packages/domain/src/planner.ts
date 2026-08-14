import { BLOCK_MINUTES, toBlockCount } from "./time.js";
import type { AvailabilityBlock, PlanResult, PlanningInput, ScheduleBlock, Task } from "./types.js";

type CandidateScore = {
  slackBlocks: number;
  deadlineMs: number;
  priorityRank: number;
  createdAtMs: number;
  taskId: string;
};

type AvailabilitySlot = AvailabilityBlock & { startMs: number; endMs: number };

const priorityRank = { low: 1, medium: 2, high: 3 } as const;

export class DependencyCycleError extends Error {
  readonly code = "DEPENDENCY_CYCLE";
  readonly taskIds: string[];

  constructor(taskIds: readonly string[]) {
    super("task dependencies contain a cycle");
    this.name = "DependencyCycleError";
    this.taskIds = [...taskIds].sort((left, right) => left.localeCompare(right));
  }
}

function cyclicTaskIds(input: PlanningInput): string[] {
  const taskIds = new Set(input.tasks.map((task) => task.id));
  const successors = new Map<string, string[]>();
  for (const dependency of input.dependencies) {
    if (!taskIds.has(dependency.predecessorTaskId) || !taskIds.has(dependency.successorTaskId)) continue;
    const taskSuccessors = successors.get(dependency.predecessorTaskId) ?? [];
    taskSuccessors.push(dependency.successorTaskId);
    successors.set(dependency.predecessorTaskId, taskSuccessors);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const cyclic = new Set<string>();
  const visit = (taskId: string): void => {
    if (visiting.has(taskId)) {
      cyclicTaskIdsFrom(path, taskId).forEach((id) => cyclic.add(id));
      return;
    }
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    path.push(taskId);
    for (const successorId of successors.get(taskId) ?? []) visit(successorId);
    path.pop();
    visiting.delete(taskId);
    visited.add(taskId);
  };

  [...taskIds].sort((left, right) => left.localeCompare(right)).forEach(visit);
  return [...cyclic].sort((left, right) => left.localeCompare(right));
}

function cyclicTaskIdsFrom(path: readonly string[], taskId: string): readonly string[] {
  return path.slice(path.indexOf(taskId));
}

function normalizedSlots(input: PlanningInput): AvailabilitySlot[] {
  const nowMs = new Date(input.now).getTime();
  const rangeEndMs = new Date(input.rangeEnd).getTime();
  const seenIntervals = new Set<string>();
  const slots: AvailabilitySlot[] = [];

  for (const block of input.availability) {
    const blockEndMs = new Date(block.endAt).getTime();
    for (let startMs = new Date(block.startAt).getTime(); startMs + BLOCK_MINUTES * 60_000 <= blockEndMs; startMs += BLOCK_MINUTES * 60_000) {
      const endMs = startMs + BLOCK_MINUTES * 60_000;
      const intervalKey = `${startMs}-${endMs}`;
      if (startMs < nowMs || endMs > rangeEndMs || seenIntervals.has(intervalKey)) continue;
      seenIntervals.add(intervalKey);
      slots.push({ id: block.id, startAt: new Date(startMs).toISOString(), endAt: new Date(endMs).toISOString(), startMs, endMs });
    }
  }

  return slots.sort((left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id));
}

function scoreTask(task: Task, remainingMinutes: number, availableSlotsBeforeDeadline: number): CandidateScore {
  return {
    slackBlocks: availableSlotsBeforeDeadline - toBlockCount(remainingMinutes),
    deadlineMs: new Date(task.deadline).getTime(),
    priorityRank: priorityRank[task.priority],
    createdAtMs: new Date(task.createdAt).getTime(),
    taskId: task.id,
  };
}

function compareCandidates(left: Task, right: Task, remaining: ReadonlyMap<string, number>, slotsBeforeDeadline: ReadonlyMap<string, number>): number {
  const leftScore = scoreTask(left, remaining.get(left.id)!, slotsBeforeDeadline.get(left.id) ?? 0);
  const rightScore = scoreTask(right, remaining.get(right.id)!, slotsBeforeDeadline.get(right.id) ?? 0);

  return leftScore.slackBlocks - rightScore.slackBlocks
    || leftScore.deadlineMs - rightScore.deadlineMs
    || rightScore.priorityRank - leftScore.priorityRank
    || leftScore.createdAtMs - rightScore.createdAtMs
    || leftScore.taskId.localeCompare(rightScore.taskId);
}

function countSlotsBeforeDeadline(slots: readonly AvailabilitySlot[], deadlineMs: number): number {
  return slots.filter((slot) => slot.endMs <= deadlineMs).length;
}

function buildSlotsBeforeDeadline(tasks: readonly Task[], slots: readonly AvailabilitySlot[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const task of tasks) {
    result.set(task.id, countSlotsBeforeDeadline(slots, new Date(task.deadline).getTime()));
  }
  return result;
}

function predecessorIdsByTask(input: PlanningInput): ReadonlyMap<string, readonly string[]> {
  const predecessors = new Map<string, string[]>();
  for (const dependency of input.dependencies) {
    const taskPredecessors = predecessors.get(dependency.successorTaskId) ?? [];
    taskPredecessors.push(dependency.predecessorTaskId);
    predecessors.set(dependency.successorTaskId, taskPredecessors);
  }
  return predecessors;
}

function hasCompletePredecessors(task: Task, predecessors: ReadonlyMap<string, readonly string[]>, tasksById: ReadonlyMap<string, Task>, remaining: ReadonlyMap<string, number>): boolean {
  return (predecessors.get(task.id) ?? []).every((predecessorId) => {
    const predecessor = tasksById.get(predecessorId);
    return predecessor !== undefined && (predecessor.status === "completed" || predecessor.remainingMinutes === 0 || remaining.get(predecessorId) === 0);
  });
}

function predecessorFinishMs(task: Task, predecessors: ReadonlyMap<string, readonly string[]>, blocks: readonly ScheduleBlock[]): number {
  const predecessorIds = new Set(predecessors.get(task.id) ?? []);
  return blocks.reduce((latest, block) => predecessorIds.has(block.taskId) ? Math.max(latest, new Date(block.endAt).getTime()) : latest, Number.NEGATIVE_INFINITY);
}

function scheduleBlock(taskId: string, startAt: string, endAt: string): ScheduleBlock {
  return {
    id: `schedule-${taskId}-${startAt}-${endAt}`,
    taskId,
    startAt,
    endAt,
    status: "planned",
    locked: false,
  };
}

function consecutiveWindow(slots: readonly AvailabilitySlot[], allocatedSlots: ReadonlySet<string>, task: Task, afterMs: number): AvailabilitySlot[] | null {
  const deadlineMs = new Date(task.deadline).getTime();
  const requiredBlocks = toBlockCount(task.remainingMinutes);
  let run: AvailabilitySlot[] = [];

  for (const slot of slots) {
    if (allocatedSlots.has(slot.startAt) || slot.startMs < afterMs || slot.endMs > deadlineMs) {
      run = [];
      continue;
    }
    run = run.length > 0 && run.at(-1)!.endMs === slot.startMs ? [...run, slot] : [slot];
    if (run.length === requiredBlocks) return run;
  }

  return null;
}

export function generatePlan(input: PlanningInput): PlanResult {
  const cycleTaskIds = cyclicTaskIds(input);
  if (cycleTaskIds.length > 0) throw new DependencyCycleError(cycleTaskIds);

  const tasks = input.tasks.filter((task) => task.status === "active" && task.remainingMinutes > 0);
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]));
  const remaining = new Map(tasks.map((task) => [task.id, task.remainingMinutes]));
  const predecessors = predecessorIdsByTask(input);
  const slots = normalizedSlots(input);
  const allocatedSlots = new Set<string>();
  const blocks: ScheduleBlock[] = [];
  const explanation: PlanResult["explanation"] = [];
  const slotsBeforeDeadline = buildSlotsBeforeDeadline(tasks, slots);

  const addBlock = (block: ScheduleBlock, reason: string) => {
    blocks.push(block);
    explanation.push({ taskId: block.taskId, blockId: block.id, reason });
  };

  const decrementBeforeDeadline = (slotEndMs: number) => {
    for (const task of tasks) {
      if (new Date(task.deadline).getTime() >= slotEndMs) {
        slotsBeforeDeadline.set(task.id, (slotsBeforeDeadline.get(task.id) ?? 0) - 1);
      }
    }
  };

  let madeAllocation: boolean;
  do {
    madeAllocation = false;

    const readyNonSplittable = tasks
      .filter((task) => !task.splittable && remaining.get(task.id)! > 0 && hasCompletePredecessors(task, predecessors, tasksById, remaining))
      .sort((left, right) => compareCandidates(left, right, remaining, slotsBeforeDeadline));

    for (const task of readyNonSplittable) {
      const window = consecutiveWindow(slots, allocatedSlots, task, predecessorFinishMs(task, predecessors, blocks));
      if (window === null) {
        continue;
      }
      const block = scheduleBlock(task.id, window[0].startAt, window.at(-1)!.endAt);
      window.forEach((slot) => { allocatedSlots.add(slot.startAt); decrementBeforeDeadline(slot.endMs); });
      remaining.set(task.id, 0);
      addBlock(block, "NON_SPLITTABLE_CONSECUTIVE_WINDOW");
      madeAllocation = true;
    }

    for (const slot of slots) {
      if (allocatedSlots.has(slot.startAt)) continue;
      const candidate = tasks
        .filter((task) => task.splittable && remaining.get(task.id)! > 0 && slot.endMs <= new Date(task.deadline).getTime() && slot.startMs >= predecessorFinishMs(task, predecessors, blocks) && hasCompletePredecessors(task, predecessors, tasksById, remaining))
        .sort((left, right) => compareCandidates(left, right, remaining, slotsBeforeDeadline))[0];
      if (candidate === undefined) continue;

      const block = scheduleBlock(candidate.id, slot.startAt, slot.endAt);
      allocatedSlots.add(slot.startAt);
      decrementBeforeDeadline(slot.endMs);
      remaining.set(candidate.id, remaining.get(candidate.id)! - BLOCK_MINUTES);
      addBlock(block, "STABLE_CANDIDATE_ORDER");
      madeAllocation = true;
    }
  } while (madeAllocation);

  return {
    blocks,
    unscheduled: tasks
      .filter((task) => remaining.get(task.id)! > 0)
      .map((task) => {
        if (!hasCompletePredecessors(task, predecessors, tasksById, remaining)) {
          return { taskId: task.id, minutes: remaining.get(task.id)!, reason: "DEPENDENCY_BLOCKED" as const };
        }
        if (!task.splittable && consecutiveWindow(slots, new Set<string>(), task, predecessorFinishMs(task, predecessors, blocks)) === null) {
          return { taskId: task.id, minutes: remaining.get(task.id)!, reason: "NO_CONSECUTIVE_WINDOW" as const };
        }
        return { taskId: task.id, minutes: remaining.get(task.id)!, reason: "NO_CAPACITY" as const };
      }),
    explanation,
  };
}

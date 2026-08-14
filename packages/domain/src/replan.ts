import { generatePlan } from "./planner.js";
import type { AvailabilityBlock, PlanningInput, ProgressResult, ReplanInput, ScheduleBlock, Task } from "./types.js";

function isFrozen(block: ScheduleBlock): boolean {
  return block.status === "completed" || block.status === "started" || block.locked;
}

function minutesIn(block: Pick<ScheduleBlock, "startAt" | "endAt">): number {
  return Math.max(0, (new Date(block.endAt).getTime() - new Date(block.startAt).getTime()) / 60_000);
}

function overlaps(left: Pick<ScheduleBlock, "startAt" | "endAt">, right: Pick<AvailabilityBlock, "startAt" | "endAt">): boolean {
  return new Date(left.startAt).getTime() < new Date(right.endAt).getTime()
    && new Date(right.startAt).getTime() < new Date(left.endAt).getTime();
}

function availableOutsideFrozen(availability: readonly AvailabilityBlock[], frozenBlocks: readonly ScheduleBlock[]): AvailabilityBlock[] {
  const frozen = [...frozenBlocks].sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());

  return availability.flatMap((block) => {
    let fragments: AvailabilityBlock[] = [block];
    for (const frozenBlock of frozen) {
      fragments = fragments.flatMap((fragment) => {
        if (!overlaps(frozenBlock, fragment)) return [fragment];
        const fragmentStart = new Date(fragment.startAt).getTime();
        const fragmentEnd = new Date(fragment.endAt).getTime();
        const frozenStart = new Date(frozenBlock.startAt).getTime();
        const frozenEnd = new Date(frozenBlock.endAt).getTime();
        const remaining: AvailabilityBlock[] = [];
        if (fragmentStart < frozenStart) remaining.push({ ...fragment, endAt: new Date(frozenStart).toISOString() });
        if (frozenEnd < fragmentEnd) remaining.push({ ...fragment, startAt: new Date(frozenEnd).toISOString() });
        return remaining;
      });
    }
    return fragments.map((fragment, index) => ({ ...fragment, id: `${block.id}-remaining-${index}` }));
  });
}

function isReserved(block: ScheduleBlock, nowMs: number): boolean {
  return block.status === "started"
    || (block.locked && block.status !== "completed" && new Date(block.startAt).getTime() >= nowMs);
}

function tasksAfterReservations(tasks: readonly Task[], frozenBlocks: readonly ScheduleBlock[], nowMs: number): Task[] {
  const reservedMinutes = new Map<string, number>();
  for (const block of frozenBlocks) {
    if (isReserved(block, nowMs)) {
      reservedMinutes.set(block.taskId, (reservedMinutes.get(block.taskId) ?? 0) + minutesIn(block));
    }
  }

  return tasks.map((task) => ({
    ...task,
    remainingMinutes: Math.max(0, task.remainingMinutes - (reservedMinutes.get(task.id) ?? 0)),
  }));
}

function compareBlocks(left: ScheduleBlock, right: ScheduleBlock): number {
  return new Date(left.startAt).getTime() - new Date(right.startAt).getTime()
    || new Date(left.endAt).getTime() - new Date(right.endAt).getTime()
    || left.id.localeCompare(right.id);
}

export function replan(input: ReplanInput) {
  const frozenBlocks = input.previousBlocks.filter(isFrozen);
  const planningInput: PlanningInput = {
    ...input,
    tasks: tasksAfterReservations(input.tasks, frozenBlocks, new Date(input.now).getTime()),
    availability: availableOutsideFrozen(input.availability, frozenBlocks),
    frozenBlocks,
  };
  const generated = generatePlan(planningInput);

  return {
    ...generated,
    blocks: [...frozenBlocks, ...generated.blocks].sort(compareBlocks),
  };
}

export function applyProgress(task: Task, completedMinutes: number): ProgressResult {
  if (completedMinutes < 0) throw new Error("completedMinutes must be non-negative");

  const appliedMinutes = Math.min(task.remainingMinutes, completedMinutes);
  return {
    remainingMinutes: task.remainingMinutes - appliedMinutes,
    appliedMinutes,
    overflowMinutes: completedMinutes - appliedMinutes,
  };
}

import { BLOCK_MINUTES, effectiveCapacityBlocks, toBlockCount } from "./time.js";
import type { AnalysisResult, AnalysisWarning, PlanningInput, Task } from "./types.js";

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

function activeTasksWithRemainingWork(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) => task.status === "active" && task.remainingMinutes > 0);
}

function uniqueFutureBlocksBefore(input: PlanningInput, deadline: string): number {
  const nowMs = new Date(input.now).getTime();
  const deadlineMs = new Date(deadline).getTime();
  const blockIds = new Set<string>();

  for (const block of input.availability) {
    const startMs = new Date(block.startAt).getTime();
    const endMs = new Date(block.endAt).getTime();
    if (startMs >= nowMs && endMs <= deadlineMs) blockIds.add(block.id);
  }

  return blockIds.size;
}

function orderedTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((left, right) => {
    const deadlineDifference = new Date(left.deadline).getTime() - new Date(right.deadline).getTime();
    if (deadlineDifference !== 0) return deadlineDifference;

    const priorityDifference = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
    if (priorityDifference !== 0) return priorityDifference;

    const creationDifference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    if (creationDifference !== 0) return creationDifference;

    return left.id.localeCompare(right.id);
  });
}

function hasConsecutiveWindow(input: PlanningInput, task: Task): boolean {
  const nowMs = new Date(input.now).getTime();
  const deadlineMs = new Date(task.deadline).getTime();
  const requiredDurationMs = toBlockCount(task.remainingMinutes) * BLOCK_MINUTES * 60 * 1000;
  const blocks = input.availability
    .filter((block) => new Date(block.startAt).getTime() >= nowMs && new Date(block.endAt).getTime() <= deadlineMs)
    .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime() || left.id.localeCompare(right.id));
  let windowStartMs: number | null = null;
  let windowEndMs: number | null = null;

  for (const block of blocks) {
    const startMs = new Date(block.startAt).getTime();
    const endMs = new Date(block.endAt).getTime();
    if (windowEndMs === startMs) {
      windowEndMs = endMs;
    } else {
      windowStartMs = startMs;
      windowEndMs = endMs;
    }

    if (windowStartMs !== null && windowEndMs - windowStartMs >= requiredDurationMs) return true;
  }

  return false;
}

function consecutiveWindowWarnings(input: PlanningInput, tasks: readonly Task[]): AnalysisWarning[] {
  return orderedTasks(tasks)
    .filter((task) => !task.splittable && !hasConsecutiveWindow(input, task))
    .map((task) => ({
      code: "NO_CONSECUTIVE_WINDOW",
      taskId: task.id,
      message: `Task "${task.title}" has no consecutive availability window of ${toBlockCount(task.remainingMinutes) * BLOCK_MINUTES} minutes before ${task.deadline}.`,
    }));
}

export function analyzeConflicts(input: PlanningInput): AnalysisResult {
  const tasks = activeTasksWithRemainingWork(input.tasks);
  const issues = tasks
    .filter((task) => task.deadline.trim() === "")
    .map((task) => ({ code: "TASK_DEADLINE_MISSING", taskId: task.id }));
  if (issues.length > 0) return { status: "incomplete", issues };

  const deadlines = [...new Set(tasks.map((task) => task.deadline))]
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime());
  const nodes = deadlines.map((deadline) => {
    const tasksDueByDeadline = orderedTasks(tasks.filter((task) => new Date(task.deadline).getTime() <= new Date(deadline).getTime()));
    const requiredBlocks = tasksDueByDeadline.reduce((total, task) => total + toBlockCount(task.remainingMinutes), 0);
    const effectiveCapacity = effectiveCapacityBlocks(uniqueFutureBlocksBefore(input, deadline), input.bufferRatio);

    return {
      deadline,
      requiredMinutes: requiredBlocks * BLOCK_MINUTES,
      effectiveCapacityMinutes: effectiveCapacity * BLOCK_MINUTES,
      slackMinutes: (effectiveCapacity - requiredBlocks) * BLOCK_MINUTES,
      taskIds: tasksDueByDeadline.map((task) => task.id),
    };
  });
  const conflictNode = nodes.find((node) => node.slackMinutes < 0);
  const hasTightCapacity = nodes.some((node) => {
    const rawCapacityMinutes = uniqueFutureBlocksBefore(input, node.deadline) * BLOCK_MINUTES;
    return node.slackMinutes >= 0 && node.slackMinutes <= rawCapacityMinutes * 0.1;
  });
  const warnings = consecutiveWindowWarnings(input, tasks);

  return {
    status: "ready",
    risk: conflictNode === undefined ? (hasTightCapacity || warnings.length > 0 ? "yellow" : "green") : "red",
    nodes,
    firstConflict: conflictNode === undefined
      ? null
      : {
          deadline: conflictNode.deadline,
          shortageMinutes: -conflictNode.slackMinutes,
          taskIds: conflictNode.taskIds,
        },
    warnings,
  };
}

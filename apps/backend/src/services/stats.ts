import { Temporal } from "@js-temporal/polyfill";
import type { AvailabilityBlock, StoredPlan, Task } from "../../../../packages/domain/src/types.js";

export type Priority = "high" | "medium" | "low";

export type StatsResponse = {
  taskSummary: {
    activeCount: number;
    completedCount: number;
    overdueCount: number;
    totalRemainingMinutes: number;
    dueThisWeekCount: number;
    completionRate: number;
  };
  priorityDistribution: Array<{ priority: Priority; count: number; remainingMinutes: number }>;
  dailyWorkload: Array<{ date: string; scheduledMinutes: number; capacityMinutes: number }>;
};

function localDate(iso: string, timezone: string): string {
  return Temporal.Instant.from(iso).toZonedDateTimeISO(timezone).toPlainDate().toString();
}

export function buildStats(input: {
  tasks: readonly Task[];
  plan: StoredPlan | null;
  availability: readonly AvailabilityBlock[];
  now: string;
  timezone: string;
}): StatsResponse {
  const { tasks, plan, availability, now, timezone } = input;
  const nowMs = new Date(now).getTime();
  const active = tasks.filter((t) => t.status === "active");
  const completed = tasks.filter((t) => t.status === "completed");
  const overdueCount = active.filter((t) => new Date(t.deadline).getTime() < nowMs).length;
  const totalRemainingMinutes = active.reduce((sum, t) => sum + t.remainingMinutes, 0);
  const weekEndMs = nowMs + 7 * 24 * 60 * 60 * 1000;
  const dueThisWeekCount = active.filter((t) => {
    const d = new Date(t.deadline).getTime();
    return d >= nowMs && d < weekEndMs;
  }).length;
  const denominator = completed.length + active.length;
  const completionRate = denominator === 0 ? 0 : completed.length / denominator;

  const priorityDistribution = (["high", "medium", "low"] as const).map((priority) => {
    const byPriority = active.filter((t) => t.priority === priority);
    return {
      priority,
      count: byPriority.length,
      remainingMinutes: byPriority.reduce((sum, t) => sum + t.remainingMinutes, 0),
    };
  });

  const rangeStart = plan?.rangeStart ?? now;
  const rangeEnd = plan?.rangeEnd
    ?? Temporal.Instant.from(now).toZonedDateTimeISO(timezone).add({ days: 7 }).toInstant().toString();
  const startDate = Temporal.Instant.from(rangeStart).toZonedDateTimeISO(timezone).toPlainDate();
  const endDate = Temporal.Instant.from(rangeEnd).toZonedDateTimeISO(timezone).toPlainDate();

  const scheduledByDate = new Map<string, number>();
  for (const block of plan?.blocks ?? []) {
    const date = localDate(block.startAt, timezone);
    const minutes = (new Date(block.endAt).getTime() - new Date(block.startAt).getTime()) / 60_000;
    scheduledByDate.set(date, (scheduledByDate.get(date) ?? 0) + minutes);
  }
  const capacityByDate = new Map<string, number>();
  for (const block of availability) {
    const date = localDate(block.startAt, timezone);
    capacityByDate.set(date, (capacityByDate.get(date) ?? 0) + 30);
  }

  const dailyWorkload: StatsResponse["dailyWorkload"] = [];
  for (let date = startDate; Temporal.PlainDate.compare(date, endDate) < 0; date = date.add({ days: 1 })) {
    const key = date.toString();
    dailyWorkload.push({
      date: key,
      scheduledMinutes: scheduledByDate.get(key) ?? 0,
      capacityMinutes: capacityByDate.get(key) ?? 0,
    });
  }

  return {
    taskSummary: {
      activeCount: active.length,
      completedCount: completed.length,
      overdueCount,
      totalRemainingMinutes,
      dueThisWeekCount,
      completionRate,
    },
    priorityDistribution,
    dailyWorkload,
  };
}

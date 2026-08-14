import { Temporal } from "@js-temporal/polyfill";
import type { AvailabilityBlock, AvailabilityDefinition, AvailabilityException, WeeklyAvailabilityRule } from "../../../../packages/domain/src/types.js";

const MINUTES_PER_DAY = 24 * 60;
const BLOCK_NANOSECONDS = 30n * 60n * 1_000_000_000n;

type Interval = { start: bigint; end: bigint };
type RulePart = { weekday: number; start: number; end: number };

function timeToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new RangeError("invalid local time");
  return Number(match[1]) * 60 + Number(match[2]);
}

function toTime(value: number): string {
  if (value === MINUTES_PER_DAY) return "24:00";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function assertTimezone(timezone: string): void {
  Temporal.ZonedDateTime.from({ timeZone: timezone, year: 2026, month: 1, day: 1, hour: 0, minute: 0 });
}

function splitWeekly(weekday: number, start: number, end: number): RulePart[] {
  if (end > start) return [{ weekday, start, end }];
  return [{ weekday, start, end: MINUTES_PER_DAY }, { weekday: weekday === 7 ? 1 : weekday + 1, start: 0, end }];
}

function mergeRules(parts: readonly RulePart[], timezone: string): WeeklyAvailabilityRule[] {
  const merged: RulePart[] = [];
  [...parts].sort((left, right) => left.weekday - right.weekday || left.start - right.start || left.end - right.end).forEach((part) => {
    const previous = merged.at(-1);
    if (previous && previous.weekday === part.weekday && part.start <= previous.end) previous.end = Math.max(previous.end, part.end);
    else merged.push({ ...part });
  });
  return merged.map((part) => ({
    id: `weekly:${timezone}:${part.weekday}:${toTime(part.start)}:${toTime(part.end)}`,
    weekday: part.weekday, startLocalTime: toTime(part.start), endLocalTime: toTime(part.end), timezone,
  }));
}

function nextDate(date: string): string {
  return Temporal.PlainDate.from(date).add({ days: 1 }).toString();
}

export function normalizeAvailabilityDefinition(input: AvailabilityDefinition): AvailabilityDefinition {
  assertTimezone(input.timezone);
  const weeklyParts: RulePart[] = [];
  input.weeklyRules.forEach((rule) => {
    if (!Number.isInteger(rule.weekday) || rule.weekday < 1 || rule.weekday > 7) throw new RangeError("invalid weekday");
    const start = timeToMinutes(rule.startLocalTime); const end = timeToMinutes(rule.endLocalTime);
    if (start === end) throw new RangeError("equal local times");
    weeklyParts.push(...splitWeekly(rule.weekday, start, end));
  });
  const exceptions: AvailabilityException[] = [];
  input.exceptions.forEach((exception) => {
    Temporal.PlainDate.from(exception.date);
    const start = timeToMinutes(exception.startLocalTime); const end = timeToMinutes(exception.endLocalTime);
    if (start === end) throw new RangeError("equal local times");
    const parts = end > start ? [{ date: exception.date, start, end }] : [{ date: exception.date, start, end: MINUTES_PER_DAY }, { date: nextDate(exception.date), start: 0, end }];
    parts.forEach((part, index) => exceptions.push({
      id: `exception:${exception.kind}:${part.date}:${toTime(part.start)}:${toTime(part.end)}:${index}`,
      date: part.date, startLocalTime: toTime(part.start), endLocalTime: toTime(part.end), kind: exception.kind,
    }));
  });
  return { timezone: input.timezone, weeklyRules: mergeRules(weeklyParts, input.timezone), exceptions };
}

function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const output: Interval[] = [];
  [...intervals].sort((left, right) => left.start < right.start ? -1 : left.start > right.start ? 1 : left.end < right.end ? -1 : 1).forEach((interval) => {
    const previous = output.at(-1);
    if (previous && interval.start <= previous.end) previous.end = interval.end > previous.end ? interval.end : previous.end;
    else output.push({ ...interval });
  });
  return output;
}

function subtractInterval(intervals: readonly Interval[], removal: Interval): Interval[] {
  return intervals.flatMap((interval) => {
    if (removal.end <= interval.start || removal.start >= interval.end) return [interval];
    const result: Interval[] = [];
    if (interval.start < removal.start) result.push({ start: interval.start, end: removal.start });
    if (removal.end < interval.end) result.push({ start: removal.end, end: interval.end });
    return result;
  });
}

function localInterval(date: Temporal.PlainDate, startMinutes: number, endMinutes: number, timezone: string): Interval {
  const startDate = date;
  const endDate = endMinutes === MINUTES_PER_DAY ? date.add({ days: 1 }) : date;
  const start = Temporal.ZonedDateTime.from({ timeZone: timezone, year: startDate.year, month: startDate.month, day: startDate.day, hour: Math.floor(startMinutes / 60), minute: startMinutes % 60 }, { disambiguation: "compatible" }).epochNanoseconds;
  const end = Temporal.ZonedDateTime.from({ timeZone: timezone, year: endDate.year, month: endDate.month, day: endDate.day, hour: endMinutes === MINUTES_PER_DAY ? 0 : Math.floor(endMinutes / 60), minute: endMinutes === MINUTES_PER_DAY ? 0 : endMinutes % 60 }, { disambiguation: "compatible" }).epochNanoseconds;
  return { start, end };
}

function ceilBlock(value: bigint): bigint {
  return ((value + BLOCK_NANOSECONDS - 1n) / BLOCK_NANOSECONDS) * BLOCK_NANOSECONDS;
}

export function resolveAvailability(definition: AvailabilityDefinition, rangeStart: string, rangeEnd: string): AvailabilityBlock[] {
  const normalized = normalizeAvailabilityDefinition(definition);
  const start = Temporal.Instant.from(rangeStart).epochNanoseconds;
  const end = Temporal.Instant.from(rangeEnd).epochNanoseconds;
  if (end <= start) throw new RangeError("resolution range must increase");
  const firstDate = Temporal.Instant.from(rangeStart).toZonedDateTimeISO(normalized.timezone).toPlainDate().subtract({ days: 1 });
  const lastDate = Temporal.Instant.from(rangeEnd).toZonedDateTimeISO(normalized.timezone).toPlainDate().add({ days: 1 });
  let intervals: Interval[] = [];
  for (let date = firstDate; Temporal.PlainDate.compare(date, lastDate) <= 0; date = date.add({ days: 1 })) {
    normalized.weeklyRules.filter((rule) => rule.weekday === date.dayOfWeek).forEach((rule) => intervals.push(localInterval(date, timeToMinutes(rule.startLocalTime), rule.endLocalTime === "24:00" ? MINUTES_PER_DAY : timeToMinutes(rule.endLocalTime), normalized.timezone)));
  }
  intervals = mergeIntervals(intervals);
  normalized.exceptions.forEach((exception) => {
    const date = Temporal.PlainDate.from(exception.date);
    const exceptionInterval = localInterval(date, timeToMinutes(exception.startLocalTime), exception.endLocalTime === "24:00" ? MINUTES_PER_DAY : timeToMinutes(exception.endLocalTime), normalized.timezone);
    intervals = exception.kind === "available" ? mergeIntervals([...intervals, exceptionInterval]) : subtractInterval(intervals, exceptionInterval);
  });
  const blocks = new Map<string, AvailabilityBlock>();
  intervals.forEach((interval) => {
    const clippedStart = interval.start > start ? interval.start : start;
    const clippedEnd = interval.end < end ? interval.end : end;
    for (let blockStart = ceilBlock(clippedStart); blockStart + BLOCK_NANOSECONDS <= clippedEnd; blockStart += BLOCK_NANOSECONDS) {
      const startAt = Temporal.Instant.fromEpochNanoseconds(blockStart).toString();
      const endAt = Temporal.Instant.fromEpochNanoseconds(blockStart + BLOCK_NANOSECONDS).toString();
      blocks.set(startAt, { id: `availability:${startAt}:${endAt}`, startAt, endAt });
    }
  });
  return [...blocks.values()].sort((left, right) => left.startAt.localeCompare(right.startAt));
}

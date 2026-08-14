import { Temporal } from "@js-temporal/polyfill";
import type { StoredPlan, Task } from "../../../../packages/domain/src/types.js";

const encoder = new TextEncoder();

function basic(instant: string, timezone: string): string {
  const date = Temporal.Instant.from(instant).toZonedDateTimeISO(timezone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.year}${pad(date.month)}${pad(date.day)}T${pad(date.hour)}${pad(date.minute)}${pad(date.second)}`;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\r\n|\r|\n/g, "\\n");
}

function foldLine(line: string): string[] {
  const chunks: string[] = [];
  let current = "";
  let limit = 75;
  for (const character of line) {
    if (encoder.encode(current + character).length > limit) {
      chunks.push(current);
      current = ` ${character}`;
      limit = 75;
    } else current += character;
  }
  chunks.push(current);
  return chunks;
}

export function createIcs(plan: StoredPlan, tasks: ReadonlyMap<string, Task>, timezone: string): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DDL Radar//EN", "CALSCALE:GREGORIAN"];
  for (const block of plan.blocks) {
    const task = tasks.get(block.taskId);
    if (!task) throw new Error(`task missing: ${block.taskId}`);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${block.id}@ddl-radar.local`,
      `DTSTAMP:${basic(plan.createdAt, "UTC")}Z`,
      `DTSTART;TZID=${timezone}:${basic(block.startAt, timezone)}`,
      `DTEND;TZID=${timezone}:${basic(block.endAt, timezone)}`,
      `SUMMARY:${escapeText(task.title)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.flatMap(foldLine).join("\r\n") + "\r\n";
}

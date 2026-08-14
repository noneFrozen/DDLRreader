import type Database from "better-sqlite3";
import type { AvailabilityDefinition, AvailabilityException, AvailabilityRepository, WeeklyAvailabilityRule } from "../../../../packages/domain/src/types.js";

type RuleRow = { id: string; weekday: number; start_local_time: string; end_local_time: string; timezone: string };
type ExceptionRow = { id: string; date: string; start_local_time: string; end_local_time: string; kind: AvailabilityException["kind"] };

export class SqliteAvailabilityRepository implements AvailabilityRepository {
  constructor(private readonly database: Database.Database) {}

  replace(input: AvailabilityDefinition): void {
    this.database.transaction(() => {
      this.database.prepare("DELETE FROM availability_rules").run();
      this.database.prepare("DELETE FROM availability_exceptions").run();
      this.database.prepare("INSERT INTO availability_settings (id, timezone) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET timezone = excluded.timezone").run(input.timezone);
      const insertRule = this.database.prepare("INSERT INTO availability_rules (id, weekday, start_local_time, end_local_time, timezone) VALUES (@id, @weekday, @startLocalTime, @endLocalTime, @timezone)");
      for (const rule of input.weeklyRules) insertRule.run(rule);
      const insertException = this.database.prepare("INSERT INTO availability_exceptions (id, date, start_local_time, end_local_time, kind) VALUES (@id, @date, @startLocalTime, @endLocalTime, @kind)");
      for (const exception of input.exceptions) insertException.run(exception);
    })();
  }

  get(): AvailabilityDefinition {
    const timezone = (this.database.prepare("SELECT timezone FROM availability_settings WHERE id = 1").get() as { timezone: string } | undefined)?.timezone ?? "UTC";
    const weeklyRules = this.database.prepare("SELECT * FROM availability_rules ORDER BY id").all().map((row) => {
      const rule = row as RuleRow;
      return { id: rule.id, weekday: rule.weekday, startLocalTime: rule.start_local_time, endLocalTime: rule.end_local_time, timezone: rule.timezone } satisfies WeeklyAvailabilityRule;
    });
    const exceptions = this.database.prepare("SELECT * FROM availability_exceptions ORDER BY id").all().map((row) => {
      const exception = row as ExceptionRow;
      return { id: exception.id, date: exception.date, startLocalTime: exception.start_local_time, endLocalTime: exception.end_local_time, kind: exception.kind } satisfies AvailabilityException;
    });
    return { timezone, weeklyRules, exceptions };
  }
}

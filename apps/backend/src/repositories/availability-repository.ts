import type Database from "better-sqlite3";
import type { AvailabilityDefinition, AvailabilityException, AvailabilityRepository, WeeklyAvailabilityRule } from "../../../../packages/domain/src/types.js";

type RuleRow = { id: string; weekday: number; start_local_time: string; end_local_time: string; timezone: string };
type ExceptionRow = { id: string; date: string; start_local_time: string; end_local_time: string; kind: AvailabilityException["kind"] };

export class SqliteAvailabilityRepository implements AvailabilityRepository {
  constructor(private readonly database: Database.Database) {}

  replace(userId: string, input: AvailabilityDefinition): void {
    this.database.transaction(() => {
      this.database.prepare("DELETE FROM availability_rules WHERE user_id = ?").run(userId);
      this.database.prepare("DELETE FROM availability_exceptions WHERE user_id = ?").run(userId);
      this.database.prepare("INSERT INTO availability_settings (user_id, timezone) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET timezone = excluded.timezone").run(userId, input.timezone);
      const insertRule = this.database.prepare("INSERT INTO availability_rules (id, user_id, weekday, start_local_time, end_local_time, timezone, ordinal) VALUES (@id, @userId, @weekday, @startLocalTime, @endLocalTime, @timezone, @ordinal)");
      input.weeklyRules.forEach((rule, ordinal) => insertRule.run({ ...rule, userId, ordinal }));
      const insertException = this.database.prepare("INSERT INTO availability_exceptions (id, user_id, date, start_local_time, end_local_time, kind, ordinal) VALUES (@id, @userId, @date, @startLocalTime, @endLocalTime, @kind, @ordinal)");
      input.exceptions.forEach((exception, ordinal) => insertException.run({ ...exception, userId, ordinal }));
    })();
  }

  get(userId: string): AvailabilityDefinition {
    const timezone = (this.database.prepare("SELECT timezone FROM availability_settings WHERE user_id = ?").get(userId) as { timezone: string } | undefined)?.timezone ?? "UTC";
    const weeklyRules = this.database.prepare("SELECT * FROM availability_rules WHERE user_id = ? ORDER BY ordinal").all(userId).map((row) => {
      const rule = row as RuleRow;
      return { id: rule.id, weekday: rule.weekday, startLocalTime: rule.start_local_time, endLocalTime: rule.end_local_time, timezone: rule.timezone } satisfies WeeklyAvailabilityRule;
    });
    const exceptions = this.database.prepare("SELECT * FROM availability_exceptions WHERE user_id = ? ORDER BY ordinal").all(userId).map((row) => {
      const exception = row as ExceptionRow;
      return { id: exception.id, date: exception.date, startLocalTime: exception.start_local_time, endLocalTime: exception.end_local_time, kind: exception.kind } satisfies AvailabilityException;
    });
    return { timezone, weeklyRules, exceptions };
  }
}

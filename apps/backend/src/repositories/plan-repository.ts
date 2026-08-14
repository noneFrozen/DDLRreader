import type Database from "better-sqlite3";
import type { PlanRepository, ScheduleBlock, StoredPlan } from "../../../../packages/domain/src/types.js";

type PlanRow = Omit<StoredPlan, "rangeStart" | "rangeEnd" | "riskLevel" | "unscheduledMinutes" | "createdAt" | "blocks"> & {
  range_start: string;
  range_end: string;
  risk_level: StoredPlan["riskLevel"];
  unscheduled_minutes: number;
  created_at: string;
};
type BlockRow = { id: string; task_id: string; start_at: string; end_at: string; status: ScheduleBlock["status"]; locked: number };

function toBlock(row: BlockRow): ScheduleBlock {
  return { id: row.id, taskId: row.task_id, startAt: row.start_at, endAt: row.end_at, status: row.status, locked: Boolean(row.locked) };
}

function assertValidBlocks(blocks: readonly ScheduleBlock[]): void {
  const sorted = [...blocks].sort((left, right) => left.startAt.localeCompare(right.startAt) || left.endAt.localeCompare(right.endAt));
  for (const block of sorted) {
    if (block.endAt <= block.startAt) throw new Error("schedule block end must be after start");
  }
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].startAt < sorted[index - 1].endAt) throw new Error("schedule blocks overlap");
  }
}

export class SqlitePlanRepository implements PlanRepository {
  constructor(private readonly database: Database.Database) {}

  savePlan(plan: StoredPlan): void {
    assertValidBlocks(plan.blocks);
    this.database.transaction(() => {
      this.database.prepare("INSERT INTO plans (id, range_start, range_end, version, risk_level, unscheduled_minutes, created_at) VALUES (@id, @rangeStart, @rangeEnd, @version, @riskLevel, @unscheduledMinutes, @createdAt)").run(plan);
      const insertBlock = this.database.prepare("INSERT INTO schedule_blocks (id, plan_id, task_id, start_at, end_at, status, locked) VALUES (@id, @planId, @taskId, @startAt, @endAt, @status, @locked)");
      for (const block of plan.blocks) insertBlock.run({ ...block, planId: plan.id, locked: Number(block.locked) });
    })();
  }

  getById(id: string): StoredPlan | null {
    const row = this.database.prepare("SELECT * FROM plans WHERE id = ?").get(id) as PlanRow | undefined;
    return row ? this.toPlan(row) : null;
  }

  getLatest(): StoredPlan | null {
    const row = this.database.prepare("SELECT * FROM plans ORDER BY version DESC LIMIT 1").get() as PlanRow | undefined;
    return row ? this.toPlan(row) : null;
  }

  updateBlock(block: ScheduleBlock): void {
    this.database.prepare("UPDATE schedule_blocks SET task_id = @taskId, start_at = @startAt, end_at = @endAt, status = @status, locked = @locked WHERE id = @id").run({ ...block, locked: Number(block.locked) });
  }

  private toPlan(row: PlanRow): StoredPlan {
    const blocks = this.database.prepare("SELECT id, task_id, start_at, end_at, status, locked FROM schedule_blocks WHERE plan_id = ? ORDER BY start_at, id").all(row.id).map((block) => toBlock(block as BlockRow));
    return {
      id: row.id,
      rangeStart: row.range_start,
      rangeEnd: row.range_end,
      version: row.version,
      riskLevel: row.risk_level,
      unscheduledMinutes: row.unscheduled_minutes,
      createdAt: row.created_at,
      blocks,
    };
  }
}

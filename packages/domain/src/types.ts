export type IsoUtc = string;
export type RiskLevel = "red" | "yellow" | "green";
export type Priority = "low" | "medium" | "high";
export type BlockStatus = "planned" | "started" | "completed" | "skipped";

export type Task = {
  id: string;
  courseId: string | null;
  title: string;
  deadline: IsoUtc;
  remainingMinutes: number;
  priority: Priority;
  splittable: boolean;
  minimumBlockMinutes: number;
  status: "active" | "completed" | "archived";
  createdAt: IsoUtc;
  updatedAt: IsoUtc;
};

export type TaskDependency = { predecessorTaskId: string; successorTaskId: string };
export type WeeklyAvailabilityRule = { id: string; weekday: number; startLocalTime: string; endLocalTime: string; timezone: string };
export type AvailabilityException = { id: string; date: string; startLocalTime: string; endLocalTime: string; kind: "available" | "unavailable" };
export type AvailabilityDefinition = {
  timezone: string;
  weeklyRules: readonly WeeklyAvailabilityRule[];
  exceptions: readonly AvailabilityException[];
};
export type AvailabilityBlock = { id: string; startAt: IsoUtc; endAt: IsoUtc };
export type ScheduleBlock = {
  id: string;
  taskId: string;
  startAt: IsoUtc;
  endAt: IsoUtc;
  status: BlockStatus;
  locked: boolean;
};

export type PlanningInput = {
  now: IsoUtc;
  rangeEnd: IsoUtc;
  timezone: string;
  bufferRatio: number;
  tasks: readonly Task[];
  dependencies: readonly TaskDependency[];
  availability: readonly AvailabilityBlock[];
  frozenBlocks: readonly ScheduleBlock[];
};

export type ConflictDetail = {
  deadline: IsoUtc;
  shortageMinutes: number;
  /** All active incomplete tasks due no later than this conflict deadline, in stable order. */
  taskIds: string[];
};
export type InputIssue = { code: string; taskId?: string };
export type DeadlineNode = {
  deadline: IsoUtc;
  requiredMinutes: number;
  effectiveCapacityMinutes: number;
  slackMinutes: number;
  taskIds: string[];
};
export type AnalysisWarning = { code: string; taskId?: string; message: string };
export type AnalysisResult =
  | { status: "incomplete"; issues: InputIssue[] }
  | { status: "ready"; risk: RiskLevel; nodes: DeadlineNode[]; firstConflict: ConflictDetail | null; warnings: AnalysisWarning[] };

export type UnscheduledWork = { taskId: string; minutes: number; reason: "NO_CAPACITY" | "NO_CONSECUTIVE_WINDOW" | "DEPENDENCY_BLOCKED" };
export type AllocationExplanation = { taskId: string; blockId: string; reason: string };
export type PlanResult = { blocks: ScheduleBlock[]; unscheduled: UnscheduledWork[]; explanation: AllocationExplanation[] };
export type ReplanInput = PlanningInput & { previousBlocks: readonly ScheduleBlock[] };
export type ProgressResult = { remainingMinutes: number; appliedMinutes: number; overflowMinutes: number };
export type StoredPlan = {
  id: string;
  rangeStart: IsoUtc;
  rangeEnd: IsoUtc;
  version: number;
  riskLevel: RiskLevel;
  unscheduledMinutes: number;
  blocks: ScheduleBlock[];
  createdAt: IsoUtc;
};

export interface TaskRepository {
  listActive(): Task[];
  listDependencies(): TaskDependency[];
  get(id: string): Task | null;
  save(task: Task): void;
  saveWithDependencies(task: Task, predecessorTaskIds: readonly string[]): void;
  delete(id: string): boolean;
}
export interface AvailabilityRepository {
  replace(input: AvailabilityDefinition): void;
  get(): AvailabilityDefinition;
}
export interface PlanRepository {
  savePlan(plan: StoredPlan): void;
  getById(id: string): StoredPlan | null;
  getLatest(): StoredPlan | null;
  updateBlock(block: ScheduleBlock): void;
}

export type Clock = {
  now(): Date;
};

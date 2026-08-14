export type Priority = "low" | "medium" | "high";

export type AvailabilityRule = {
  id: string;
  weekday: number;
  startLocalTime: string;
  endLocalTime: string;
  timezone: string;
};

export type AvailabilityDefinition = {
  timezone: string;
  weeklyRules: readonly AvailabilityRule[];
  exceptions: readonly AvailabilityException[];
};

export type AvailabilityException = {
  id: string;
  date: string;
  startLocalTime: string;
  endLocalTime: string;
  kind: "available" | "unavailable";
};

export type Task = {
  id: string;
  courseId: string | null;
  title: string;
  deadline: string;
  remainingMinutes: number;
  priority: Priority;
  splittable: boolean;
  minimumBlockMinutes: number;
  status: "active" | "completed" | "archived";
  createdAt: string;
  updatedAt: string;
  predecessorTaskIds: string[];
};

export type CreateTaskInput = {
  courseId: null;
  title: string;
  deadline: string;
  remainingMinutes: number;
  priority: Priority;
  splittable: boolean;
  minimumBlockMinutes: number;
  predecessorTaskIds: string[];
};

export type ApiError = Error & { fieldErrors?: Record<string, string>; code?: string; details?: { conflictingBlockId?: string } };
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type RiskLevel = "red" | "yellow" | "green";
export type AnalysisResult =
  | { status: "incomplete"; issues: { code: string; taskId?: string }[] }
  | {
    status: "ready";
    risk: RiskLevel;
    nodes: { deadline: string; requiredMinutes: number; effectiveCapacityMinutes: number; slackMinutes: number; taskIds: string[] }[];
    firstConflict: { deadline: string; shortageMinutes: number; taskIds: string[] } | null;
    warnings: { code: string; taskId?: string; message: string }[];
  };
export type ScheduleBlock = { id: string; taskId: string; startAt: string; endAt: string; status: "planned" | "started" | "completed" | "skipped"; locked: boolean };
export type Plan = { id: string; rangeStart: string; rangeEnd: string; version: number; riskLevel: RiskLevel; unscheduledMinutes: number; blocks: ScheduleBlock[]; createdAt: string };
export type PlanResponse = {
  plan: Plan;
  unscheduled: { taskId: string; minutes: number; reason: string }[];
  explanation: { taskId: string; blockId: string; reason: string }[];
  analysis: AnalysisResult;
};
export type SchedulePatchInput = Partial<Pick<ScheduleBlock, "startAt" | "endAt" | "status" | "locked">> & { completedMinutes?: number; allowAfterDeadline?: boolean };
export type SchedulePatchResponse = { block: ScheduleBlock; task?: Task; progress?: { remainingMinutes: number; appliedMinutes: number; overflowMinutes: number } };

export type ApiClient = {
  getAvailability(): Promise<AvailabilityDefinition>;
  putAvailability(input: AvailabilityDefinition): Promise<AvailabilityDefinition>;
  listTasks(): Promise<Task[]>;
  createTask(input: CreateTaskInput): Promise<Task>;
  analyze(input: { planningDays: number; bufferRatio: number }): Promise<AnalysisResult>;
  createPlan(input: { planningDays: number; bufferRatio: number; allowRisk: boolean }): Promise<PlanResponse>;
  patchScheduleBlock(id: string, input: SchedulePatchInput): Promise<SchedulePatchResponse>;
  exportPlanIcs(id: string): Promise<{ blob: Blob; filename: string }>;
};

async function request<T>(fetcher: FetchLike, url: string, init?: RequestInit): Promise<T> {
  const response = await fetcher(url, init);
  const payload = await response.json() as T | { message?: string; fieldErrors?: Record<string, string>; code?: string; details?: { conflictingBlockId?: string } };
  if (!response.ok) {
    const error = new Error((payload as { message?: string }).message ?? "请求失败") as ApiError;
    error.fieldErrors = (payload as { fieldErrors?: Record<string, string> }).fieldErrors;
    error.code = (payload as { code?: string }).code;
    error.details = (payload as { details?: { conflictingBlockId?: string } }).details;
    throw error;
  }
  return payload as T;
}

function filenameFromDisposition(value: string | null): string {
  const match = value?.match(/filename\*?=(?:UTF-8''|\")?([^;\"]+)/i);
  if (!match) return "ddl-radar-plan.ics";
  try { return decodeURIComponent(match[1].trim()); } catch { return match[1].trim(); }
}

export function createApiClient({ baseUrl = "/api", fetcher = fetch }: { baseUrl?: string; fetcher?: FetchLike } = {}): ApiClient {
  return {
    getAvailability: () => request<AvailabilityDefinition>(fetcher, `${baseUrl}/availability`),
    putAvailability: (input) => request<AvailabilityDefinition>(fetcher, `${baseUrl}/availability`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    }),
    listTasks: () => request<Task[]>(fetcher, `${baseUrl}/tasks`),
    createTask: (input) => request<Task>(fetcher, `${baseUrl}/tasks`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    }),
    analyze: (input) => request<AnalysisResult>(fetcher, `${baseUrl}/analysis`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    }),
    createPlan: (input) => request<PlanResponse>(fetcher, `${baseUrl}/plans`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    }),
    patchScheduleBlock: (id, input) => request<SchedulePatchResponse>(fetcher, `${baseUrl}/schedule-blocks/${encodeURIComponent(id)}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    }),
    exportPlanIcs: async (id) => {
      const response = await fetcher(`${baseUrl}/plans/${encodeURIComponent(id)}/export.ics`);
      if (!response.ok) {
        const payload = await response.json() as { message?: string; fieldErrors?: Record<string, string>; code?: string; details?: { conflictingBlockId?: string } };
        const error = new Error(payload.message ?? "导出失败") as ApiError;
        error.fieldErrors = payload.fieldErrors;
        error.code = payload.code;
        error.details = payload.details;
        throw error;
      }
      return { blob: await response.blob(), filename: filenameFromDisposition(response.headers.get("content-disposition")) };
    },
  };
}

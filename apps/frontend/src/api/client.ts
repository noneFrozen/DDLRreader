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

export type ApiError = Error & { fieldErrors?: Record<string, string> };
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ApiClient = {
  getAvailability(): Promise<AvailabilityDefinition>;
  putAvailability(input: AvailabilityDefinition): Promise<AvailabilityDefinition>;
  listTasks(): Promise<Task[]>;
  createTask(input: CreateTaskInput): Promise<Task>;
};

async function request<T>(fetcher: FetchLike, url: string, init?: RequestInit): Promise<T> {
  const response = await fetcher(url, init);
  const payload = await response.json() as T | { message?: string; fieldErrors?: Record<string, string> };
  if (!response.ok) {
    const error = new Error((payload as { message?: string }).message ?? "请求失败") as ApiError;
    error.fieldErrors = (payload as { fieldErrors?: Record<string, string> }).fieldErrors;
    throw error;
  }
  return payload as T;
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
  };
}

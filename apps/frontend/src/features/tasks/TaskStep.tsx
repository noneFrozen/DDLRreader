import { useEffect, useState } from "react";
import type { ApiClient, CreateTaskInput, Task } from "../../api/client.js";
import { TaskForm } from "./TaskForm.js";

const courseFixtures = [
  { label: "软件工程", color: "#40543A" }, { label: "高等数学", color: "#A17A1C" }, { label: "英语", color: "#A84232" },
];
const priorityLabels = { high: "优先级高", medium: "优先级中", low: "优先级低" } as const;

function formatDeadline(deadline: string): string {
  const date = new Date(deadline);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatHours(minutes: number): string {
  return String(minutes / 60).replace(/\.0$/, "");
}

type TaskStepProps = {
  api: Pick<ApiClient, "listTasks" | "createTask">;
  onTasksChanged: (tasks: readonly Task[]) => void;
};

export function TaskStep({ api, onTasksChanged }: TaskStepProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let mounted = true;
    void api.listTasks().then((loaded) => {
      if (!mounted) return;
      setTasks(loaded); onTasksChanged(loaded);
    }).catch((error: Error) => {
      if (mounted) setLoadError(error.message);
    });
    return () => { mounted = false; };
  }, [api, onTasksChanged]);

  const create = async (input: CreateTaskInput) => {
    const task = await api.createTask(input);
    setTasks((current) => {
      const next = [...current, task];
      onTasksChanged(next);
      return next;
    });
  };

  return <section className="entry-step panel" aria-labelledby="task-entry-title">
    <p className="section-label">Step 02 / Tasks</p><h2 id="task-entry-title">录入课程任务</h2>
    <p>课程标签仅用于当前界面识别；任务会以未分类状态保存。</p>
    <div className="course-fixtures" aria-label="课程标签">{courseFixtures.map((course) => <span key={course.label}><i style={{ backgroundColor: course.color }} />{course.label}</span>)}</div>
    <TaskForm tasks={tasks} onSubmit={create} />
    {loadError && <p className="field-error" role="alert">{loadError}</p>}
    <div className="saved-tasks" aria-live="polite">
      {tasks.map((task) => <article className="task-card" key={task.id}><p>{task.title}</p><small>截止 {formatDeadline(task.deadline)} · 剩余 {formatHours(task.remainingMinutes)} 小时 · {priorityLabels[task.priority]}</small></article>)}
    </div>
  </section>;
}

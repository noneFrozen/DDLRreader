import { useState } from "react";
import type { CreateTaskInput, Priority, Task } from "../../api/client.js";

type TaskFormProps = {
  tasks: readonly Task[];
  editingTaskId?: string;
  onSubmit: (input: CreateTaskInput) => Promise<void>;
};

const priorities: { value: Priority; label: string }[] = [
  { value: "high", label: "高" }, { value: "medium", label: "中" }, { value: "low", label: "低" },
];

function serverErrors(error: unknown): Record<string, string> {
  const apiError = error as { message?: string; fieldErrors?: Record<string, string> };
  const fieldErrors = { ...(apiError.fieldErrors ?? {}) };
  if (fieldErrors.remainingMinutes) fieldErrors.hours = fieldErrors.remainingMinutes;
  const messages = Object.values(fieldErrors);
  return { ...fieldErrors, form: messages.length ? [...new Set(messages)].join(" ") : apiError.message ?? "保存失败" };
}

export function TaskForm({ tasks, editingTaskId, onSubmit }: TaskFormProps) {
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [hours, setHours] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [splittable, setSplittable] = useState(true);
  const [minimumBlockMinutes, setMinimumBlockMinutes] = useState("30");
  const [predecessorTaskIds, setPredecessorTaskIds] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const errorDescription = (field: string) => fieldErrors[field] ? `task-${field}-error` : undefined;
  const togglePredecessor = (id: string, checked: boolean) => setPredecessorTaskIds((current) => checked ? [...current, id] : current.filter((item) => item !== id));

  const submit = async () => {
    const errors: Record<string, string> = {};
    const numericHours = Number(hours);
    const blockMinutes = Number(minimumBlockMinutes);
    if (!title.trim()) errors.title = "请输入任务名称";
    if (!deadline || Number.isNaN(new Date(deadline).getTime())) errors.deadline = "请输入有效截止时间";
    if (!Number.isFinite(numericHours) || numericHours < 0) errors.hours = "请输入非负的预计工时";
    if (!Number.isInteger(blockMinutes) || blockMinutes <= 0 || blockMinutes % 30 !== 0) errors.minimumBlockMinutes = "最小时间块必须是30分钟的正整数倍";
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setSaving(true);
    try {
      await onSubmit({
        courseId: null,
        title: title.trim(),
        deadline: new Date(deadline).toISOString(),
        remainingMinutes: Math.round(numericHours * 60),
        priority,
        splittable,
        minimumBlockMinutes: blockMinutes,
        predecessorTaskIds,
      });
      setTitle(""); setDeadline(""); setHours(""); setPriority("medium"); setSplittable(true); setMinimumBlockMinutes("30"); setPredecessorTaskIds([]);
    } catch (error) {
      setFieldErrors(serverErrors(error));
    } finally {
      setSaving(false);
    }
  };

  return <form className="task-form" onSubmit={(event) => { event.preventDefault(); void submit(); }} noValidate>
    <label className="entry-field">任务名称<input value={title} aria-describedby={errorDescription("title")} onChange={(event) => setTitle(event.target.value)} /></label>
    {fieldErrors.title && <p id="task-title-error" className="field-error">{fieldErrors.title}</p>}
    <label className="entry-field">截止时间<input type="datetime-local" value={deadline} aria-describedby={errorDescription("deadline")} onChange={(event) => setDeadline(event.target.value)} /></label>
    {fieldErrors.deadline && <p id="task-deadline-error" className="field-error">{fieldErrors.deadline}</p>}
    <label className="entry-field">预计工时（小时）<input type="number" min="0" step="0.25" value={hours} aria-describedby={errorDescription("hours")} onChange={(event) => setHours(event.target.value)} /></label>
    {fieldErrors.hours && <p id="task-hours-error" className="field-error">{fieldErrors.hours}</p>}
    <label className="entry-field">优先级<select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>{priorities.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    <label className="entry-field">最小时间块（分钟）<input type="number" min="30" step="30" value={minimumBlockMinutes} aria-describedby={errorDescription("minimumBlockMinutes")} onChange={(event) => setMinimumBlockMinutes(event.target.value)} /></label>
    {fieldErrors.minimumBlockMinutes && <p id="task-minimumBlockMinutes-error" className="field-error">{fieldErrors.minimumBlockMinutes}</p>}
    <label className="entry-checkbox"><input type="checkbox" checked={splittable} onChange={(event) => setSplittable(event.target.checked)} />允许拆分为多个时间块</label>
    <fieldset className="dependency-picker"><legend>前置任务</legend>{tasks.filter((task) => task.status === "active" && task.id !== editingTaskId).map((task) => <label key={task.id}><input type="checkbox" checked={predecessorTaskIds.includes(task.id)} onChange={(event) => togglePredecessor(task.id, event.target.checked)} />{task.title}</label>)}</fieldset>
    {fieldErrors.form && <p className="field-error" role="alert">{fieldErrors.form}</p>}
    <button className="entry-submit" type="submit" disabled={saving}>{saving ? "保存中…" : "保存任务"}</button>
  </form>;
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { createApiClient, type Task } from "../api/client.js";
import { AppShell } from "../components/AppShell.js";
import { RiskBadge } from "../components/RiskBadge.js";
import { StepNavigation } from "../components/StepNavigation.js";
import { AvailabilityStep } from "../features/availability/AvailabilityStep.js";
import { TaskStep } from "../features/tasks/TaskStep.js";

function AnalysisStep() {
  return <div className="workspace">
    <section className="workspace__intro panel"><p className="section-label">Conflict analysis</p><h2>冲突分析</h2><p>可用时间与任务已保存。下一步将根据截止时间计算可执行计划。</p></section>
    <div className="workspace__analysis"><section className="workspace__panel workspace__conflict panel"><p className="section-label">Ready</p><h3>输入已完成</h3><p>现在可以开始分析时间冲突。</p></section></div>
  </div>;
}

export function App() {
  const api = useMemo(() => createApiClient(), []);
  const [currentStep, setCurrentStep] = useState(1);
  const [hasAvailability, setHasAvailability] = useState(false);
  const [tasks, setTasks] = useState<readonly Task[]>([]);
  const hasActiveTasks = tasks.some((task) => task.status === "active");
  const unlockedStep = hasAvailability && hasActiveTasks ? 3 : hasAvailability ? 2 : 1;
  const handleTasksChanged = useCallback((nextTasks: readonly Task[]) => setTasks(nextTasks), []);
  const taskSummary = tasks.filter((task) => task.status === "active");

  useEffect(() => {
    let mounted = true;
    void Promise.allSettled([api.getAvailability(), api.listTasks()]).then(([availability, savedTasks]) => {
      if (!mounted) return;
      if (availability.status === "fulfilled") setHasAvailability(availability.value.weeklyRules.length > 0);
      if (savedTasks.status === "fulfilled") setTasks(savedTasks.value);
    });
    return () => { mounted = false; };
  }, [api]);

  return <AppShell
    header={<><div><p className="section-label">Deadline / Organic planner</p><h1>DDL Radar</h1></div><RiskBadge level="high" label="高风险" /></>}
    flow={<StepNavigation currentStep={currentStep} unlockedStep={unlockedStep} onStepChange={setCurrentStep} />}
    aside={<><section className="tasks-preview panel"><p className="section-label">Tasks</p><h2>本周 DDL</h2>{taskSummary.length ? taskSummary.map((task) => <div className="task-card" key={task.id}><p>{task.title}</p><small>剩余 {task.remainingMinutes / 60} 小时</small></div>) : <p>先保存可用时间，再录入课程任务。</p>}</section><section className="tasks-preview panel"><p className="section-label">Summary</p><strong>{taskSummary.length} 项已保存任务</strong></section></>}
  >
    {currentStep === 1 && <AvailabilityStep api={api} onSaved={(availability) => { setHasAvailability(availability.weeklyRules.length > 0); setCurrentStep(2); }} />}
    {currentStep === 2 && <TaskStep api={api} onTasksChanged={handleTasksChanged} />}
    {currentStep === 3 && <AnalysisStep />}
  </AppShell>;
}

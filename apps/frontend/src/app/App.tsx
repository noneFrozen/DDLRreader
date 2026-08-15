import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createApiClient, type AnalysisResult, type Plan, type Task, type User } from "../api/client.js";
import { AppShell } from "../components/AppShell.js";
import { StepNavigation } from "../components/StepNavigation.js";
import { AuthGate } from "../features/auth/AuthGate.js";
import { AvailabilityStep } from "../features/availability/AvailabilityStep.js";
import { AnalysisStep } from "../features/analysis/AnalysisStep.js";
import { PlanStep } from "../features/plan/PlanStep.js";
import { TaskStep } from "../features/tasks/TaskStep.js";

export function App() {
  const api = useMemo(() => createApiClient(), []);
  const [currentStep, setCurrentStep] = useState(1);
  const [hasAvailability, setHasAvailability] = useState(false);
  const [tasks, setTasks] = useState<readonly Task[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const hasActiveTasks = tasks.some((task) => task.status === "active");
  const unlockedStep = plan ? 4 : hasAvailability && hasActiveTasks ? 3 : hasAvailability ? 2 : 1;
  const handleTasksChanged = useCallback((nextTasks: readonly Task[]) => setTasks(nextTasks), []);
  const taskSummary = tasks.filter((task) => task.status === "active");
  const savedAvailability = useRef(false);

  useEffect(() => {
    let mounted = true;
    void Promise.allSettled([api.getAvailability(), api.listTasks()]).then(([availability, savedTasks]) => {
      if (!mounted) return;
      if (!savedAvailability.current && availability.status === "fulfilled") setHasAvailability(availability.value.weeklyRules.length > 0);
      if (savedTasks.status === "fulfilled") setTasks(savedTasks.value);
    });
    return () => { mounted = false; };
  }, [api]);

  useEffect(() => {
    if (currentStep !== 3 || !hasAvailability || !hasActiveTasks) return;
    let mounted = true;
    setAnalysisLoading(true); setAnalysisError("");
    void api.analyze({ planningDays: 7, bufferRatio: 0.1 }).then((result) => {
      if (mounted) setAnalysis(result);
    }).catch((error: Error) => {
      if (mounted) setAnalysisError(error.message);
    }).finally(() => {
      if (mounted) setAnalysisLoading(false);
    });
    return () => { mounted = false; };
  }, [api, currentStep, hasActiveTasks, hasAvailability]);

  const generatePlan = async (allowRisk: boolean) => {
    setAnalysisError("");
    try {
      const generated = await api.createPlan({ planningDays: 7, bufferRatio: 0.1, allowRisk });
      setPlan(generated.plan); setAnalysis(generated.analysis); setCurrentStep(4);
    } catch (error) { setAnalysisError((error as Error).message); }
  };

  const handleLogout = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    setUser(null);
    setCurrentStep(1);
    setPlan(null);
    setAnalysis(null);
    setTasks([]);
    setHasAvailability(false);
    savedAvailability.current = false;
  };

  return <AuthGate api={api} onUserChange={setUser}>
    <AppShell
      header={<><div><p className="section-label">Deadline / Organic planner</p><h1>DDL Radar</h1></div><div className="app-shell__account">{user && <span>{user.email}</span>}<button type="button" onClick={() => void handleLogout()}>登出</button></div></>}
      flow={<StepNavigation currentStep={currentStep} unlockedStep={unlockedStep} onStepChange={setCurrentStep} />}
      aside={<><section className="tasks-preview panel"><p className="section-label">Tasks</p><h2>本周 DDL</h2>{taskSummary.length ? taskSummary.map((task) => <div className="task-card" key={task.id}><p>{task.title}</p><small>剩余 {task.remainingMinutes / 60} 小时</small></div>) : <p>先保存可用时间，再录入课程任务。</p>}</section><section className="tasks-preview panel"><p className="section-label">Summary</p><strong>{taskSummary.length} 项已保存任务</strong></section></>}
    >
      {currentStep === 1 && <AvailabilityStep api={api} onSaved={(availability) => { savedAvailability.current = true; setHasAvailability(availability.weeklyRules.length > 0); setPlan(null); setAnalysis(null); setCurrentStep(2); }} />}
      {currentStep === 2 && <TaskStep api={api} onTasksChanged={handleTasksChanged} />}
      {currentStep === 3 && <AnalysisStep analysis={analysis} tasks={tasks} loading={analysisLoading} error={analysisError} onBack={() => setCurrentStep(2)} onGenerate={generatePlan} />}
      {currentStep === 4 && plan && <PlanStep plan={plan} tasks={tasks} api={api} onTasksChanged={handleTasksChanged} />}
    </AppShell>
  </AuthGate>;
}

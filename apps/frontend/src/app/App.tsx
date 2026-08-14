import { useState } from "react";
import { AppShell } from "../components/AppShell.js";
import { RiskBadge } from "../components/RiskBadge.js";
import { StepNavigation } from "../components/StepNavigation.js";

const days = [
  ["周一", "2.0h", "42%", "ok"], ["周二", "3.0h", "56%", "ok"], ["周三", "3.5h", "66%", "warn"],
  ["周四", "4.0h", "90%", "high"], ["周五", "2.5h", "74%", "warn"],
] as const;

export function App() {
  const [currentStep, setCurrentStep] = useState(3);

  return (
    <AppShell
      header={<><div><p className="section-label">Deadline / Organic planner</p><h1>DDL Radar</h1></div><RiskBadge level="high" label="高风险" /></>}
      flow={<StepNavigation currentStep={currentStep} onStepChange={setCurrentStep} />}
      aside={<><section className="tasks-preview panel"><p className="section-label">Tasks</p><h2>本周 DDL</h2><div className="task-card"><p>软件工程大作业</p><small>周五 23:59 · 剩余 12 小时</small></div><div className="task-card"><p>高等数学作业</p><small>周四 20:00 · 剩余 4 小时</small></div></section><section className="tasks-preview panel"><p className="section-label">Summary</p><strong>3 项任务 · 19h 预计工时</strong></section></>}
    >
      <div className="workspace">
        <section className="workspace__intro panel"><p className="section-label">Conflict analysis</p><h2>冲突分析</h2><p>周四前还缺少 2.5 小时可用时间；数学作业与软件工程大作业正在挤压仅有的 10% 缓冲。</p></section>
        <div className="workspace__analysis">
          <section className="workspace__panel workspace__conflict panel"><p className="section-label">Core conflict</p><h3>周四前缺少 2.5 小时可用时间</h3><p>先挪出一段可用时间，再生成可执行计划。</p></section>
          <section className="workspace__panel panel"><p className="section-label">Summary</p><div className="summary-grid"><div className="summary-item"><span>总任务</span><strong>3</strong></div><div className="summary-item"><span>预计工时</span><strong>19h</strong></div><div className="summary-item"><span>可用时间</span><strong>16.5h</strong></div><div className="summary-item"><span>缓冲</span><strong>10%</strong></div></div></section>
        </div>
        <section className="workspace__panel panel"><p className="section-label">7 days preview</p><h3>未来 7 天时间块预览</h3><div className="calendar">{days.map(([day, hours, width, level]) => <div className="calendar__row" key={day}><span>{day}</span><span className="calendar__track"><span className={`calendar__fill calendar__fill--${level}`} style={{ width }} /></span><span className="calendar__hours">{hours}</span></div>)}</div></section>
      </div>
    </AppShell>
  );
}

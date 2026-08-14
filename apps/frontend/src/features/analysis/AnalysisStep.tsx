import { useState } from "react";
import type { AnalysisResult, Task } from "../../api/client.js";
import { RiskBadge } from "../../components/RiskBadge.js";

type AnalysisStepProps = {
  analysis: AnalysisResult | null;
  tasks: readonly Task[];
  onBack?: () => void;
  onGenerate?: (allowRisk: boolean) => void | Promise<void>;
  loading?: boolean;
  error?: string;
};

const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const riskPresentation = {
  red: { level: "high" as const, label: "高风险", action: "生成尽力计划" },
  yellow: { level: "warn" as const, label: "中风险", action: "生成可执行计划" },
  green: { level: "ok" as const, label: "低风险", action: "生成可执行计划" },
};

function hours(minutes: number): string {
  return String(Math.round((minutes / 60) * 10) / 10).replace(/\.0$/, "");
}

function taskTitles(ids: readonly string[], tasks: readonly Task[]): string[] {
  const byId = new Map(tasks.map((task) => [task.id, task.title]));
  return ids.map((id) => byId.get(id)).filter((title): title is string => Boolean(title));
}

export function AnalysisStep({ analysis, tasks, onBack = () => undefined, onGenerate = () => undefined, loading = false, error = "" }: AnalysisStepProps) {
  const [confirmingRisk, setConfirmingRisk] = useState(false);
  const [generating, setGenerating] = useState(false);

  const generate = async (allowRisk: boolean) => {
    setGenerating(true);
    try { await onGenerate(allowRisk); } finally { setGenerating(false); setConfirmingRisk(false); }
  };

  if (loading) return <section className="analysis-step panel" aria-busy="true"><p className="section-label">Step 03 / Analysis</p><h2>正在分析冲突…</h2></section>;
  if (analysis === null) return <section className="analysis-step panel" aria-labelledby="analysis-title"><p className="section-label">Step 03 / Analysis</p><h2 id="analysis-title">暂时无法完成分析</h2><p className="field-error" role="alert">{error || "请稍后重试分析。"}</p><button type="button" className="entry-submit" onClick={onBack}>返回修改</button></section>;
  if (analysis.status === "incomplete") return <section className="analysis-step panel" aria-labelledby="analysis-title">
    <p className="section-label">Step 03 / Analysis</p><h2 id="analysis-title">需要补全规划信息</h2>
    <p>请修正以下问题后再生成计划。</p>
    <ul className="analysis-issues">{analysis.issues.map((issue, index) => <li key={`${issue.code}-${issue.taskId ?? index}`}><span>{issue.code}</span>{issue.taskId ? ` · ${taskTitles([issue.taskId], tasks)[0] ?? issue.taskId}` : ""}</li>)}</ul>
    <button type="button" className="entry-submit" onClick={onBack}>返回修改</button>
  </section>;

  const presentation = riskPresentation[analysis.risk];
  const conflictTitles = analysis.firstConflict ? taskTitles(analysis.firstConflict.taskIds, tasks) : [];
  const deadline = analysis.firstConflict ? new Date(analysis.firstConflict.deadline) : null;
  const conflictText = analysis.firstConflict && deadline
    ? `${weekdays[deadline.getUTCDay()]}前缺少 ${hours(analysis.firstConflict.shortageMinutes)} 小时可用时间`
    : "当前可用时间能够覆盖所有截止任务";

  return <section className="analysis-step panel" aria-labelledby="analysis-title">
    <p className="section-label">Step 03 / Analysis</p><div className="analysis-step__heading"><div><h2 id="analysis-title">冲突分析</h2><p>依据可用时间、截止日期与任务依赖计算。</p></div><RiskBadge level={presentation.level} label={presentation.label} /></div>
    <section className="analysis-conflict" aria-live="polite"><p className="section-label">First conflict</p><strong role="status">{conflictText}</strong>
      {conflictTitles.length > 0 && <p>涉及任务：{conflictTitles.map((title, index) => <span key={title}>{index ? "、" : ""}{title}</span>)}</p>}
    </section>
    <div className="analysis-nodes"><p className="section-label">Deadline checkpoints</p>{analysis.nodes.map((node) => <div className="summary-item" key={node.deadline}><span>{new Date(node.deadline).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span><strong>{node.slackMinutes < 0 ? `缺少 ${hours(-node.slackMinutes)} 小时` : `余量 ${hours(node.slackMinutes)} 小时`}</strong></div>)}</div>
    {analysis.warnings.map((warning) => <p className="analysis-warning" key={`${warning.code}-${warning.taskId ?? ""}`}>{warning.message}</p>)}
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="analysis-actions"><button type="button" onClick={onBack}>返回修改</button><button type="button" className="entry-submit" disabled={generating} onClick={() => analysis.risk === "red" ? setConfirmingRisk(true) : void generate(false)}>{generating ? "生成中…" : presentation.action}</button></div>
    {confirmingRisk && <section className="confirm-dialog" aria-labelledby="risk-confirmation-title"><h3 id="risk-confirmation-title">确认生成尽力计划？</h3><p>当前风险较高，计划可能无法覆盖所有任务。</p><div><button type="button" onClick={() => setConfirmingRisk(false)}>取消</button><button type="button" className="entry-submit" onClick={() => void generate(true)}>确认生成尽力计划</button></div></section>}
  </section>;
}

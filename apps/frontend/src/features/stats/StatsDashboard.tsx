import { useCallback, useEffect, useState } from "react";
import type { ApiClient, StatsResponse } from "../../api/client.js";
import { DailyLoadBars } from "./DailyLoadBars.js";
import { PriorityDonut } from "./PriorityDonut.js";

type StatsDashboardProps = { api: Pick<ApiClient, "getStats"> };

export function StatsDashboard({ api }: StatsDashboardProps) {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    void api.getStats()
      .then((result) => { setStats(result); setLoading(false); })
      .catch((reason: Error) => { setError(reason.message); setLoading(false); });
  }, [api]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <section className="stats-dashboard panel" aria-busy="true"><p className="section-label">Step 05 / Stats</p><h2>正在汇总统计…</h2></section>;
  }
  if (!stats) {
    return (
      <section className="stats-dashboard panel" aria-labelledby="stats-title">
        <p className="section-label">Step 05 / Stats</p>
        <h2 id="stats-title">暂时无法加载统计</h2>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button type="button" className="entry-submit" onClick={load}>重试</button>
      </section>
    );
  }

  const { taskSummary, priorityDistribution, dailyWorkload } = stats;
  return (
    <section className="stats-dashboard panel" aria-labelledby="stats-title">
      <p className="section-label">Step 05 / Stats</p>
      <h2 id="stats-title">统计看板</h2>
      <div className="stats-cards">
        <div className="summary-item"><span>活跃任务</span><strong>{taskSummary.activeCount}</strong></div>
        <div className="summary-item"><span>已完成</span><strong>{taskSummary.completedCount}</strong></div>
        <div className="summary-item"><span>完成率</span><strong>{Math.round(taskSummary.completionRate * 100)}%</strong></div>
        <div className="summary-item"><span>剩余总工时</span><strong>{taskSummary.totalRemainingMinutes / 60} 小时</strong></div>
        <div className="summary-item"><span>逾期任务</span><strong>{taskSummary.overdueCount}</strong></div>
        <div className="summary-item"><span>本周到期</span><strong>{taskSummary.dueThisWeekCount}</strong></div>
      </div>
      <PriorityDonut distribution={priorityDistribution} />
      <DailyLoadBars daily={dailyWorkload} />
    </section>
  );
}

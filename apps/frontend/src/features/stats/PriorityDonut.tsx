type DistributionItem = { priority: "high" | "medium" | "low"; count: number; remainingMinutes: number };

const colors: Record<string, string> = { high: "var(--color-risk-high)", medium: "var(--color-risk-warn)", low: "var(--color-risk-ok)" };
const labels: Record<string, string> = { high: "高", medium: "中", low: "低" };

export function PriorityDonut({ distribution }: { distribution: readonly DistributionItem[] }) {
  const total = distribution.reduce((sum, item) => sum + item.count, 0);
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const ariaLabel = `优先级分布：${distribution.map((d) => `${labels[d.priority]}优先级 ${d.count} 项`).join("，") || "暂无任务"}`;

  return (
    <figure className="stats-donut">
      <svg viewBox="0 0 160 160" role="img" aria-label={ariaLabel}>
        <circle cx="80" cy="80" r={radius} fill="none" stroke="var(--color-border)" strokeWidth="20" />
        {total > 0 && distribution.map((item) => {
          const length = (item.count / total) * circumference;
          const segment = (
            <circle
              key={item.priority}
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke={colors[item.priority]}
              strokeWidth="20"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 80 80)"
            />
          );
          offset += length;
          return segment;
        })}
      </svg>
      <figcaption className="stats-donut__legend">
        {distribution.map((item) => (
          <span key={item.priority}>
            <i style={{ backgroundColor: colors[item.priority] }} aria-hidden="true" />
            {labels[item.priority]}优先级 {item.count} 项 · {item.remainingMinutes / 60} 小时
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

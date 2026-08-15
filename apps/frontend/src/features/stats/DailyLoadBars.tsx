type DailyItem = { date: string; scheduledMinutes: number; capacityMinutes: number };

function dayLabel(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${month}/${day}`;
}

export function DailyLoadBars({ daily }: { daily: readonly DailyItem[] }) {
  const maxMinutes = Math.max(1, ...daily.map((d) => Math.max(d.scheduledMinutes, d.capacityMinutes)));
  const width = 640;
  const barArea = 220;
  const labelHeight = 22;
  const slot = width / daily.length;
  const barWidth = Math.max(8, Math.min(20, slot / 2 - 3));
  const perMinute = barArea / maxMinutes;

  return (
    <figure className="stats-bars">
      <svg viewBox={`0 0 ${width} ${barArea + labelHeight}`} role="img" aria-label="每日负载图">
        {daily.map((day, index) => {
          const centerX = index * slot + slot / 2;
          const capHeight = day.capacityMinutes * perMinute;
          const schedHeight = day.scheduledMinutes * perMinute;
          const overloaded = day.scheduledMinutes > day.capacityMinutes;
          return (
            <g key={day.date}>
              <rect x={centerX - barWidth - 2} y={barArea - capHeight} width={barWidth} height={capHeight} fill="var(--color-border)" rx="4" />
              <rect x={centerX + 2} y={barArea - schedHeight} width={barWidth} height={schedHeight} fill={overloaded ? "var(--color-risk-high)" : "var(--color-risk-ok)"} rx="4" />
              <text x={centerX} y={barArea + 15} fontSize="10" fill="var(--color-fg)" textAnchor="middle">{dayLabel(day.date)}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="stats-bars__legend">
        <span><i style={{ backgroundColor: "var(--color-border)" }} aria-hidden="true" />可用容量</span>
        <span><i style={{ backgroundColor: "var(--color-risk-ok)" }} aria-hidden="true" />已排工时</span>
      </figcaption>
    </figure>
  );
}

type RiskLevel = "high" | "warn" | "ok";

type RiskBadgeProps = {
  level: RiskLevel;
  label: string;
};

const icons: Record<RiskLevel, string> = { high: "!", warn: "~", ok: "✓" };

export function RiskBadge({ level, label }: RiskBadgeProps) {
  return (
    <span className={`risk-badge risk-badge--${level}`} aria-label={label}>
      <span className="risk-badge__icon" aria-hidden="true">{icons[level]}</span>
      <span aria-label={label}>{label}</span>
    </span>
  );
}

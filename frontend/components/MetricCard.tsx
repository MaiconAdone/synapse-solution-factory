import type { LucideIcon } from "lucide-react";

type MetricCardProps = {
  label: string;
  value: string;
  icon: LucideIcon;
};

export function MetricCard({ label, value, icon: Icon }: MetricCardProps) {
  return (
    <article className="metric-card">
      <Icon aria-hidden="true" size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

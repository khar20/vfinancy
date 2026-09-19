import type { LucideIcon } from 'lucide-react';
import { cx } from '@/utils/cx';

interface StatCardProps {
  label: string;
  value: string;
  icon?: LucideIcon;
  accent?: boolean;
  className?: string;
}

export function StatCard({ label, value, icon: Icon, accent, className }: StatCardProps) {
  return (
    <div className={cx('stat-card', accent && 'stat-card--accent', className)}>
      <p className="stat-card__label">
        {Icon && <Icon aria-hidden="true" />}
        {label}
      </p>
      <p className="stat-card__value">{value}</p>
    </div>
  );
}

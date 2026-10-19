import { AlertTriangle, Check, Clock, CloudUpload, UserX, X, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AMAL_UI_NS } from '../i18n';
import { cx } from '../cx';

export type AppointmentStatus = 'booked' | 'completed' | 'noshow' | 'conflict' | 'sync' | 'cancelled';
export const APPOINTMENT_STATUSES: readonly AppointmentStatus[] = ['booked', 'completed', 'noshow', 'conflict', 'sync', 'cancelled'];

const ICONS: Record<AppointmentStatus, LucideIcon> = {
  booked: Clock, completed: Check, noshow: UserX, conflict: AlertTriangle, sync: CloudUpload, cancelled: X,
};

export interface StatusBadgeProps {
  status: AppointmentStatus;
  size?: 'md' | 'lg';
  className?: string;
}

/** Icon + localized label + semantic colour. Never colour alone. */
export function StatusBadge({ status, size = 'md', className }: StatusBadgeProps) {
  const { t } = useTranslation(AMAL_UI_NS);
  const Icon = ICONS[status];
  return (
    <span className={cx('amal-status', `amal-status--${status}`, size === 'lg' && 'amal-status--lg', className)} data-status={status} data-testid={`status-${status}`}>
      <Icon size={size === 'lg' ? 18 : 15} strokeWidth={2.25} aria-hidden="true" />
      <span>{t(`status.${status}`)}</span>
    </span>
  );
}

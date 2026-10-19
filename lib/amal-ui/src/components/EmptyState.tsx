import type { ReactNode } from 'react';
import { cx } from '../cx';

/** Brand illustration: the only non-logo place gold (--amal-gold) is permitted. */
export function EmptyIllustration() {
  return (
    <svg className="amal-empty__art" viewBox="0 0 160 120" aria-hidden="true" focusable="false">
      <circle cx="80" cy="128" r="58" fill="var(--amal-gold)" opacity=".9" />
      <circle cx="80" cy="128" r="74" fill="none" stroke="var(--amal-gold)" strokeOpacity=".5" strokeWidth="3" />
      <circle cx="80" cy="128" r="90" fill="none" stroke="var(--amal-gold)" strokeOpacity=".25" strokeWidth="3" />
      <rect x="44" y="20" width="72" height="62" rx="12" fill="var(--amal-surface)" stroke="var(--amal-border)" strokeWidth="2" />
      <rect x="44" y="20" width="72" height="16" rx="8" fill="var(--amal-primary)" />
      <rect x="56" y="46" width="48" height="6" rx="3" fill="var(--amal-surface-2)" />
      <rect x="56" y="60" width="32" height="6" rx="3" fill="var(--amal-surface-2)" />
      <rect x="74" y="8" width="12" height="28" rx="4" fill="var(--amal-primary-strong)" />
      <rect x="66" y="16" width="28" height="12" rx="4" fill="var(--amal-primary-strong)" />
    </svg>
  );
}

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** One or more actions — empty states should always offer a next step. */
  actions?: ReactNode;
  illustration?: ReactNode;
  headingLevel?: 1 | 2 | 3 | 4;
  className?: string;
}

export function EmptyState({ title, description, actions, illustration, headingLevel = 3, className }: EmptyStateProps) {
  const H = `h${headingLevel}` as 'h1' | 'h2' | 'h3' | 'h4';
  return (
    <div className={cx('amal-empty', className)} data-testid="empty-state">
      {illustration ?? <EmptyIllustration />}
      <H className="amal-empty__title">{title}</H>
      {description && <p className="amal-empty__desc">{description}</p>}
      {actions && <div className="amal-empty__actions">{actions}</div>}
    </div>
  );
}

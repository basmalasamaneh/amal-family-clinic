import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Icon, IconChip, type AmalSection } from '../icons';
import type { LucideIcon } from 'lucide-react';

export interface PageHeaderProps { level?: 1 | 2 | 3; eyebrow?: ReactNode; titleTestId?: string; children?: ReactNode; title: ReactNode; description?: ReactNode; primaryAction?: ReactNode; secondaryActions?: ReactNode; icon?: LucideIcon; section?: AmalSection; titleId?: string; className?: string }
/** Page title, one-line description, primary + secondary actions. */
export function PageHeader({ level = 1, eyebrow, titleTestId, children, title, description, primaryAction, secondaryActions, icon, section, titleId = 'page-title', className }: PageHeaderProps) {
  return (
    <header className={cx('amal-pagehead', className)} data-testid="page-header">
      {icon && <IconChip icon={icon} section={section} size="lg" />}
      <div className="amal-pagehead__text">
        {eyebrow && <p className="amal-pagehead__eyebrow">{eyebrow}</p>}
        {(() => { const H = `h${level}` as 'h1' | 'h2' | 'h3'; return <H id={titleId} tabIndex={-1} className="amal-pagehead__title" data-testid={titleTestId}>{title}</H>; })()}
        {description && <p className="amal-pagehead__desc">{description}</p>}
        {children}
      </div>
      {(primaryAction || secondaryActions) && <div className="amal-pagehead__actions">{secondaryActions}{primaryAction}</div>}
    </header>
  );
}

export interface Crumb { label: ReactNode; href?: string; render?: (children: ReactNode, className: string) => ReactNode }
export function Breadcrumbs({ items, label }: { items: Crumb[]; label: string }) {
  return (
    <nav aria-label={label} className="amal-crumbs" data-testid="nav-breadcrumbs">
      <ol>
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i}>
              {last ? <span aria-current="page" className="amal-crumbs__current">{c.label}</span>
                : c.render ? c.render(c.label, 'amal-crumbs__link') : c.href ? <a href={c.href} className="amal-crumbs__link">{c.label}</a> : <span>{c.label}</span>}
              {!last && <Icon name="chevronNext" size={14} className="amal-crumbs__sep" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface SectionCardProps { title: ReactNode; description?: ReactNode; actions?: ReactNode; icon?: LucideIcon; section?: AmalSection; children?: ReactNode; footer?: ReactNode; className?: string; level?: 2 | 3; tone?: 'surface' | 'soft'; testId?: string }
export function SectionCard({ title, description, actions, icon, section, children, footer, className, level = 2, tone = 'surface', testId }: SectionCardProps) {
  const H = `h${level}` as 'h2' | 'h3';
  return (
    <section className={cx('amal-scard', tone === 'soft' && 'amal-scard--soft', className)} data-testid={testId}>
      <div className="amal-scard__head">
        {icon && <IconChip icon={icon} section={section} size="sm" />}
        <div className="amal-scard__titles"><H className="amal-scard__title">{title}</H>{description && <p className="amal-scard__desc">{description}</p>}</div>
        {actions && <div className="amal-scard__actions">{actions}</div>}
      </div>
      {children !== undefined && <div className="amal-scard__body">{children}</div>}
      {footer && <div className="amal-scard__foot">{footer}</div>}
    </section>
  );
}

export function InfoCard({ title, children, tone = 'info', icon }: { title: ReactNode; children?: ReactNode; tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral'; icon?: LucideIcon }) {
  return (
    <aside className="amal-info" data-tone={tone} data-testid={`info-${tone}`}>
      {icon ? (() => { const C = icon; return <C size={18} aria-hidden="true" className="amal-info__icon" />; })() : <Icon name={tone === 'success' ? 'success' : tone === 'info' || tone === 'neutral' ? 'info' : 'warning'} className="amal-info__icon" />}
      <div><p className="amal-info__title">{title}</p>{children && <div className="amal-info__body">{children}</div>}</div>
    </aside>
  );
}

export interface StatCardProps { icon: LucideIcon; section?: AmalSection; value: ReactNode; label: ReactNode; trend?: { direction: 'up' | 'down' | 'flat'; label: ReactNode }; testId?: string }
/** Network-wide figures only; never per-doctor. */
export function StatCard({ icon, section, value, label, trend, testId }: StatCardProps) {
  return (
    <div className="amal-stat" data-testid={testId}>
      <IconChip icon={icon} section={section} />
      <p className="amal-stat__value"><data className="amal-num">{value}</data></p>
      <p className="amal-stat__label">{label}</p>
      {trend && <p className="amal-stat__trend" data-direction={trend.direction}>{trend.direction !== 'flat' && <Icon name={trend.direction === 'up' ? 'trendUp' : 'trendDown'} size={14} />}{trend.label}</p>}
    </div>
  );
}

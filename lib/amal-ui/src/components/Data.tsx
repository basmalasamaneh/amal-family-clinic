import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AMAL_UI_NS } from '../i18n';
import { cx } from '../cx';
import { Icon } from '../icons';
import { EmptyState } from './EmptyState';

export function Skeleton({ lines = 3, className, block }: { lines?: number; className?: string; block?: boolean }) {
  const { t } = useTranslation(AMAL_UI_NS);
  return (
    <div className={cx('amal-skel-group', className)} role="status" aria-label={t('state.loading')} data-testid="skeleton">
      {block ? <span className="amal-skel amal-skel--block" /> : Array.from({ length: lines }, (_, i) => <span key={i} className="amal-skel" style={{ inlineSize: `${92 - (i % 3) * 17}%` }} />)}
    </div>
  );
}

export interface Column<T> { key: string; header: ReactNode; cell: (row: T) => ReactNode; numeric?: boolean; width?: string; /** Renders as <th scope="row">. */ rowHeader?: boolean }
export interface DataTableProps<T> {
  caption: string; columns: Column<T>[]; rows: T[] | undefined; rowKey: (row: T) => string | number;
  status?: 'loading' | 'error' | 'ready'; onRetry?: () => void; rowActions?: (row: T) => ReactNode;
  emptyTitle?: ReactNode; emptyDescription?: ReactNode; emptyActions?: ReactNode;
  /** Card title shown when in card view. */ cardTitle?: (row: T) => ReactNode; defaultView?: 'table' | 'cards'; testId?: string; tableTestId?: string; tableClassName?: string;
}
/** Sticky header, zebra rows, row actions, built-in loading/error/empty, card/table toggle. */
export function DataTable<T>({ caption, columns, rows, rowKey, status = 'ready', onRetry, rowActions, emptyTitle, emptyDescription, emptyActions, cardTitle, defaultView = 'table', testId = 'datatable', tableTestId, tableClassName }: DataTableProps<T>) {
  const { t } = useTranslation(AMAL_UI_NS);
  const [view, setView] = useState(defaultView);
  const toggle = (
    <div className="amal-seg amal-dt__toggle" role="group" aria-label={t('table.view')}>
      <button type="button" className="amal-seg__btn" aria-pressed={view === 'table'} onClick={() => setView('table')} data-testid={`${testId}-view-table`}><Icon name="tableView" size={16} />{t('table.table')}</button>
      <button type="button" className="amal-seg__btn" aria-pressed={view === 'cards'} onClick={() => setView('cards')} data-testid={`${testId}-view-cards`}><Icon name="cardView" size={16} />{t('table.cards')}</button>
    </div>
  );
  let body: ReactNode;
  if (status === 'loading') body = <Skeleton lines={5} />;
  else if (status === 'error') body = (
    <div className="amal-dt__state" role="alert" data-testid={`${testId}-error`}>
      <Icon name="warning" size={22} /><p>{t('state.error')}</p>
      {onRetry && <button type="button" className="amal-btn amal-btn--secondary amal-btn--sm" onClick={onRetry} data-testid={`${testId}-retry`}>{t('state.retry')}</button>}
    </div>
  );
  else if (!rows || rows.length === 0) body = <EmptyState className="amal-empty--compact" title={emptyTitle ?? t('state.empty')} description={emptyDescription} actions={emptyActions} />;
  else if (view === 'cards') body = (
    <ul className="amal-dt__cards" aria-label={caption}>
      {rows.map((r) => (
        <li key={rowKey(r)} className="amal-dt__card" data-testid={`${testId}-card-${rowKey(r)}`}>
          {cardTitle && <p className="amal-dt__cardtitle">{cardTitle(r)}</p>}
          <dl>{columns.map((c) => <div key={c.key}><dt>{c.header}</dt><dd className={c.numeric ? 'amal-num' : undefined}>{c.cell(r)}</dd></div>)}</dl>
          {rowActions && <div className="amal-dt__actions">{rowActions(r)}</div>}
        </li>
      ))}
    </ul>
  );
  else body = (
    <div className="amal-dt__scroll" role="region" tabIndex={0} aria-label={caption}>
      <table className={cx('amal-dt__table', tableClassName)} data-testid={tableTestId}>
        <caption className="amal-sr-only">{caption}</caption>
        <thead><tr>{columns.map((c) => <th key={c.key} scope="col" data-numeric={c.numeric || undefined} style={c.width ? { inlineSize: c.width } : undefined}>{c.header}</th>)}{rowActions && <th scope="col"><span className="amal-sr-only">{t('table.actions')}</span></th>}</tr></thead>
        <tbody>{rows.map((r) => <tr key={rowKey(r)} data-testid={`${testId}-row-${rowKey(r)}`}>{columns.map((c) => c.rowHeader ? <th key={c.key} scope="row">{c.cell(r)}</th> : <td key={c.key} data-numeric={c.numeric || undefined}>{c.cell(r)}</td>)}{rowActions && <td className="amal-dt__rowact">{rowActions(r)}</td>}</tr>)}</tbody>
      </table>
    </div>
  );
  return <div className="amal-dt" data-testid={testId} aria-busy={status === 'loading'}><div className="amal-dt__bar">{toggle}</div>{body}</div>;
}

export function FilterBar({ children, onReset, label }: { children: ReactNode; onReset?: () => void; label: string }) {
  const { t } = useTranslation(AMAL_UI_NS);
  return (
    <div role="group" aria-label={label} className="amal-filterbar" data-testid="filterbar">
      <Icon name="filter" size={16} className="amal-filterbar__icon" />
      {children}
      {onReset && <button type="button" className="amal-btn amal-btn--ghost amal-btn--sm" onClick={onReset} data-testid="button-filter-reset">{t('filter.reset')}</button>}
    </div>
  );
}

export interface TimelineItem { id: string | number; title: ReactNode; meta?: ReactNode; time?: string; timeLabel?: ReactNode; tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' }
/** Vertical timeline; the rail sits on the inline-start edge, so it mirrors in RTL. */
export function Timeline({ items, label }: { items: TimelineItem[]; label: string }) {
  return (
    <ol className="amal-timeline" aria-label={label}>
      {items.map((it) => (
        <li key={it.id} className="amal-timeline__item" data-tone={it.tone ?? 'neutral'}>
          <span className="amal-timeline__dot" aria-hidden="true" />
          <div>
            <p className="amal-timeline__title">{it.title}</p>
            {(it.time || it.meta) && <p className="amal-timeline__meta">{it.time && <time dateTime={it.time}>{it.timeLabel ?? it.time}</time>}{it.meta}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

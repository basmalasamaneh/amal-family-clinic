import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Table2 } from 'lucide-react';
import { useAmalPreferences } from '@workspace/amal-ui';
import { num } from './model';

/** Shared chart presentation: heading, data-derived summary, visual, keyboard data-table toggle. */
export function ChartFrame({ id, title, icon, summary, caption, head, rows, children, notes, className }: {
  id: string; title: string; icon?: ReactNode; summary: string; caption: string;
  head: string[]; rows: ReactNode[][]; children: ReactNode; notes?: ReactNode; className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const tid = useId();
  return (
    <section className={`kpi-card ${className ?? ''}`} aria-labelledby={`${id}-h`} data-testid={`chart-${id}`}>
      <h2 id={`${id}-h`} className="kpi-card__title">{icon}{title}</h2>
      <p className="kpi-summary" data-testid={`summary-${id}`}><span className="shell-sr">{t('kpi.table.summary')}: </span>{summary}</p>
      <div className="kpi-visual">{children}</div>
      {notes && <div className="kpi-notes">{notes}</div>}
      <button type="button" className="kpi-toggle" aria-expanded={open} aria-controls={tid} onClick={() => setOpen((o) => !o)} data-testid={`button-table-${id}`}>
        <Table2 size={16} aria-hidden="true" />{open ? t('kpi.table.hide') : t('kpi.table.show')}
      </button>
      <div id={tid} hidden={!open} className="kpi-table-wrap">
        {open && (
          <table className="kpi-table" data-testid={`table-${id}`}>
            <caption>{caption}</caption>
            <thead><tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export function Unavail({ label }: { label?: string }) {
  const { t } = useTranslation();
  return <span className="kpi-unavail" data-unavailable="true">{label ?? t('kpi.states.unavailable')}</span>;
}

export function useFmt() {
  const { locale, digitPreference } = useAmalPreferences();
  return { locale, digits: digitPreference, rtl: locale === 'ar', n: (v: number, f = 0) => num(v, locale, digitPreference, f) };
}

/** Isolates data-supplied names inside localized sentences. */
export const iso = (s: string) => `\u2068${s}\u2069`;

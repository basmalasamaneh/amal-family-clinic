import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RotateCcw, Search, UserRound, UserX } from 'lucide-react';
import { useAmalPreferences } from '@workspace/amal-ui';
import { formatLocalDate, isLocalDate } from '@/calendar/dates';
import { MIN_QUERY, type PatientHit, type PatientSearchAdapter } from './patients';
import { classifyError, isAbort, type FailureKind } from './errors';
import { createLatest } from './ops';
import { normalizeForSearch } from './normalize';
import '@/reception/i18n';
import { completedEmpty } from './registration-flow';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; q: string; adapter: PatientSearchAdapter; clinicId: number; refreshKey: number; nonce: number; items: PatientHit[]; more: boolean; cursor: string | null; page: 'idle' | 'loading' | 'error' }
  | { kind: 'error'; failure: FailureKind };
export const SEARCH_DEBOUNCE_MS = 300;

export function PatientQuickSearch({ adapter, clinicId, onSelect, autoFocus, paginate, refreshKey = 0, selectedId, onCreate, createDisabledReason, initialQuery = '' }: {
  adapter: PatientSearchAdapter; clinicId: number; onSelect: (p: PatientHit) => void; autoFocus?: boolean;
  /** Show "load more" using the server's opaque cursor instead of only asking to refine. */
  paginate?: boolean; /** Bump to re-run the current query (e.g. after registration). */ refreshKey?: number; selectedId?: number | null;
  onCreate?: (query: string) => void; createDisabledReason?: string;
  /** Memory-only prefill; callers key by submission id to support repeated identical queries. */
  initialQuery?: string;
}) {
  const { t } = useTranslation();
  const { locale, digitPreference } = useAmalPreferences();
  const [q, setQ] = useState(() => initialQuery.slice(0, 120));
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [active, setActive] = useState(0);
  const latest = useRef(createLatest()).current;
  const id = useId();
  const listId = id + '-list';
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const query = q.trim();
    const token = latest.next();
    if (query.length < MIN_QUERY) { setState({ kind: 'idle' }); return; }
    setState({ kind: 'loading' });
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      adapter.search(query, clinicId, ctl.signal).then(
        (r) => { if (latest.isCurrent(token)) { setState({ kind: 'ok', q: query, adapter, clinicId, refreshKey, nonce, items: r.items, more: r.more, cursor: r.nextCursor ?? null, page: 'idle' }); setActive(0); } },
        (e) => { if (!isAbort(e) && latest.isCurrent(token)) setState({ kind: 'error', failure: classifyError(e).kind }); },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctl.abort(); latest.invalidate(); };
  }, [q, nonce, adapter, clinicId, latest, refreshKey]);

  const pageCtl = useRef<AbortController | null>(null);
  useEffect(() => () => pageCtl.current?.abort(), [q, clinicId]);
  const loadMore = () => {
    if (state.kind !== 'ok' || !state.cursor || state.page === 'loading') return;
    const { q: query, cursor } = state; const mine = latest.next();
    pageCtl.current?.abort(); const ctl = new AbortController(); pageCtl.current = ctl;
    setState({ ...state, page: 'loading' });
    adapter.search(query, clinicId, ctl.signal, cursor).then(
      (r) => {
        if (!latest.isCurrent(mine)) return;
        setState((s) => {
          if (s.kind !== 'ok' || s.q !== query) return s;
          const seen = new Set(s.items.map((p) => p.id));
          return { ...s, items: [...s.items, ...r.items.filter((p) => !seen.has(p.id))], more: r.more, cursor: r.nextCursor ?? null, page: 'idle' };
        });
      },
      (e) => { if (!isAbort(e) && latest.isCurrent(mine)) setState((s) => (s.kind === 'ok' ? { ...s, page: 'error' } : s)); },
    );
  };

  const current = state.kind === 'ok' && state.adapter === adapter && state.clinicId === clinicId && state.refreshKey === refreshKey && state.nonce === nonce;
  const items = current && state.kind === 'ok' && state.q === q.trim() ? state.items : [];
  const dupNames = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of items) { const k = normalizeForSearch(p.name); c.set(k, (c.get(k) ?? 0) + 1); }
    return c;
  }, [items]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + items.length) % items.length); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(items.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); const p = items[active]; if (p) onSelect(p); }
  };
  const dob = (d: string | null) => (d && isLocalDate(d) ? formatLocalDate(d, locale, digitPreference, 'd MMM yyyy') : null);
  const errMsg = state.kind === 'error' ? (state.failure === 'unavailable' ? t('bk.search.unavailable') : state.failure === 'auth' ? t('bk.search.authErr') : t('bk.search.error')) : '';

  return (
    <div className="bk-field" data-testid="patient-quick-search">
      <label className="bk-label" htmlFor={id}>{t('bk.search.label')}</label>
      <div className="bk-search">
        <Search size={20} aria-hidden="true" />
        <input
          ref={inputRef} id={id} type="search" autoComplete="off" dir="auto" autoFocus={autoFocus}
          role="combobox" aria-expanded={items.length > 0} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={items.length ? `${id}-o-${items[active]?.id}` : undefined}
          aria-describedby={id + '-hint'}
          placeholder={t('bk.search.placeholder')} value={q}
          onChange={(e) => { latest.invalidate(); setState({ kind: 'idle' }); setQ(e.target.value.slice(0, 120)); }} onKeyDown={onKey}
          data-testid="input-patient-search"
        />
      </div>
      <p className="bk-hint" id={id + '-hint'}>{t('bk.search.hint')}</p>
      <p className="bk-sr" role="status" aria-live="polite">
        {state.kind === 'loading' ? t('bk.search.loading') : state.kind === 'ok' ? (state.items.length ? t('bk.search.results', { count: state.items.length }) : t('bk.search.empty', { q: state.q })) : errMsg}
      </p>
      {state.kind === 'loading' && <div aria-hidden="true" className="bk-list" data-testid="status-patient-loading"><div className="bk-skel" /><div className="bk-skel" /><div className="bk-skel" /></div>}
      {state.kind === 'error' && (
        <div className="bk-msg bk-msg--block" data-testid="status-patient-error">
          <AlertTriangle size={20} aria-hidden="true" />
          <div className="bk-msg__body"><p>{errMsg}</p>
            <button type="button" className="bk-btn bk-btn--sm" onClick={() => { setNonce((n) => n + 1); inputRef.current?.focus(); }} data-testid="button-patient-retry"><RotateCcw size={16} aria-hidden="true" />{t('bk.search.retry')}</button>
          </div>
        </div>
      )}
      {state.kind === 'ok' && completedEmpty(q, state, current) && (
        <div className="bk-msg bk-msg--muted" data-testid="status-patient-empty">
          <UserX size={20} aria-hidden="true" />
          <div className="bk-msg__body"><p><strong>{t('bk.search.empty', { q: state.q })}</strong></p><p className="bk-hint">{t('bk.search.emptyHint')}</p>
            {onCreate && <><button type="button" className="bk-btn bk-btn--sm" data-testid="button-register-booking-patient" disabled={!!createDisabledReason} aria-describedby={createDisabledReason ? id + '-create-hint' : undefined} onClick={() => onCreate(q.trim())}>{t('rx.bookingRegister')}</button>
              {createDisabledReason && <p id={id + '-create-hint'} className="bk-hint">{createDisabledReason}</p>}</>}
          </div>
        </div>
      )}
      <ul id={listId} role="listbox" aria-label={t('bk.search.label')} className="bk-list" hidden={!items.length}>
        {items.map((p, i) => (
          <li key={p.id} id={`${id}-o-${p.id}`} role="option" aria-selected={i === active}
            className={'bk-opt' + (i === active ? ' is-active' : '') + (p.id === selectedId ? ' is-chosen' : '')}
            onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => onSelect(p)}
            data-testid={`option-patient-${p.id}`}>
            <span className="bk-opt__av" aria-hidden="true"><UserRound size={20} /></span>
            <span className="bk-opt__main">
              <bdi className="bk-opt__name" dir="auto">{p.name}</bdi>
              <span className="bk-opt__meta">
                {p.phone && <span>{t('bk.search.phone')} <bdi dir="ltr">{p.phone}</bdi></span>}
                {dob(p.dateOfBirth) && <span>{t('bk.search.dob', { d: dob(p.dateOfBirth) })}</span>}
                <span>{t('bk.search.id', { id: p.id })}</span>
              </span>
              {(dupNames.get(normalizeForSearch(p.name)) ?? 0) > 1 && <span className="bk-hint">{t('bk.search.sameName')}</span>}
            </span>
          </li>
        ))}
      </ul>
      {state.kind === 'ok' && state.more && <p className="bk-hint" data-testid="text-patient-more">{t('bk.search.more')}</p>}
      {paginate && state.kind === 'ok' && state.cursor && state.q === q.trim() && (
        <div className="bk-field">
          {state.page === 'error' && <p className="bk-err" role="alert" data-testid="status-patient-more-error">{t('rx.loadMoreError')}</p>}
          <button type="button" className="bk-btn bk-btn--sm" onClick={loadMore} disabled={state.page === 'loading'} aria-busy={state.page === 'loading'} data-testid="button-patient-more">
            {state.page === 'loading' ? t('rx.loadingMore') : state.page === 'error' ? t('bk.search.retry') : t('rx.loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}

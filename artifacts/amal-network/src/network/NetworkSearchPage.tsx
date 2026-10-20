import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'wouter';
import { ChevronDown, Globe2, Lock, RotateCcw, Search, SearchX, ShieldAlert, UserRound } from 'lucide-react';
import { useAmalPreferences } from '@workspace/amal-ui';
import { lookupNetwork, type NetworkPatient } from '@workspace/api-client-react';
import type { ShellClinic } from '@/shell/identity';
import { demoPath } from '@/shell/identity';
import { ConsentBadge, KeyAlertChip } from './indicators';
import {
  classifyFailure, clearSelection, clinicTone, CONSENT_CHANGED_EVENT, formatVisitDay, REVALIDATE_MS, effectiveConsent, getSelection, isAbortError, latestVisit, normalizeQuery,
  PAGE_LIMIT, patientAlerts, relativeLabel, setSelection, type Failure,
} from './model';
import './i18n';
import './network.css';
import { clinicalDataBlocked } from './consent-invalidation';

type State =
  | { kind: 'idle' }
  | { kind: 'short' }
  | { kind: 'loading'; q: string }
  | { kind: 'hidden'; q: string }
  | { kind: 'ok'; q: string; items: NetworkPatient[]; next: string | null; more: boolean }
  | { kind: 'fail'; q: string; why: Failure };

/**
 * Doctor network search. Results live only in component state (no React Query cache, no storage).
 * Selection is passed to the card through an in-memory holder scoped to identity + clinic; the URL never
 * carries the term or a patient id. Every new request aborts and supersedes the previous one.
 */
export function NetworkSearchPage({ clinic, title, scope }: { clinic: ShellClinic | null; title: string; scope: string }) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const prior = useRef(getSelection(scope)).current;
  const [text, setText] = useState(prior?.q ?? '');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const seq = useRef(0);
  const ctl = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const restoreId = useRef<number | null>(prior?.id ?? null);
  const stateRef = useRef(state); stateRef.current = state;

  const run = useCallback((raw: string, cursor?: string) => {
    const q = normalizeQuery(raw);
    ctl.current?.abort();
    const id = ++seq.current;
    if (!q) { setState(raw.trim() ? { kind: 'short' } : { kind: 'idle' }); return; }
    const ac = new AbortController(); ctl.current = ac;
    setState({ kind: 'loading', q });
    if (clinicalDataBlocked()) return;
    lookupNetwork(cursor ? { q, limit: PAGE_LIMIT, cursor } : { q, limit: PAGE_LIMIT }, { signal: ac.signal }).then(
      (page) => {
        if (id !== seq.current || clinicalDataBlocked()) return; // superseded
        // Replace pages: a newly authorized response must not retain old protected projections.
        setState({ kind: 'ok', q, items: page.items, next: page.nextCursor, more: false });
      },
      (e) => {
        if (id !== seq.current || isAbortError(e)) return;
        // Any failure removes earlier protected results rather than leaving them as stale success.
        if (classifyFailure(e) !== 'error') clearSelection();
        setState({ kind: 'fail', q, why: classifyFailure(e) });
      },
    );
  }, []);

  // Restore after returning from the card: revalidate, never redisplay old data.
  useEffect(() => { if (prior?.q) run(prior.q); return () => { ctl.current?.abort(); seq.current++; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced typing; Enter / button runs immediately.
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) return;
    const h = setTimeout(() => run(text), 350);
    return () => clearTimeout(h);
  }, [text, run]);

  // Hidden tab: drop protected results. Focus/visible/consent change/interval: rerun page one (load-more pages are discarded).
  useEffect(() => {
    const again = () => { const s = stateRef.current; if (s.kind === 'ok' || s.kind === 'fail' || s.kind === 'hidden' || s.kind === 'loading') run(s.q); };
    const onVis = () => {
      const s = stateRef.current;
      if (document.visibilityState === 'hidden') {
        if (s.kind === 'ok' || s.kind === 'loading' || s.kind === 'fail') { ctl.current?.abort(); seq.current++; setState({ kind: 'hidden', q: s.q }); }
      } else again();
    };
    const tick = setInterval(() => { if (document.visibilityState === 'visible' && stateRef.current.kind === 'ok') again(); }, REVALIDATE_MS);
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', onVis);
    document.addEventListener(CONSENT_CHANGED_EVENT, again);
    return () => { clearInterval(tick); window.removeEventListener('focus', again); document.removeEventListener('visibilitychange', onVis); document.removeEventListener(CONSENT_CHANGED_EVENT, again); };
  }, [run]);

  // Focus restoration to the previously opened result.
  useEffect(() => {
    if (state.kind !== 'ok' || restoreId.current === null) return;
    const el = listRef.current?.querySelector<HTMLButtonElement>(`[data-pid="${restoreId.current}"]`);
    restoreId.current = null;
    el?.focus();
  }, [state]);

  const submit = (e: FormEvent) => { e.preventDefault(); typed.current = false; run(text); };
  const open = (p: NetworkPatient, q: string) => { setSelection({ scope, q, id: p.id }); navigate(demoPath('/doctor/patient-card')); };
  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const btns = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('.net-hit') ?? []);
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    btns[Math.min(btns.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };

  const announce = state.kind === 'loading' ? t('net.search.loading')
    : state.kind === 'ok' ? (state.items.length ? t('net.search.results', { count: state.items.length }) : t('net.search.emptyTitle'))
    : state.kind === 'fail' ? t(`net.search.${state.why === 'denied' ? 'denied' : state.why === 'session' ? 'session' : 'error'}Title`)
    : state.kind === 'short' ? t('net.search.tooShort') : '';

  return (
    <section className="net" data-testid="page-networkSearch" aria-busy={state.kind === 'loading'}>
      <header className="net-head">
        <p className="net-eyebrow">{clinic && <><bdi>{clinic.name}</bdi> · </>}{t('net.eyebrow')}</p>
        <h1 id="page-title" tabIndex={-1} className="net-h1">{title}</h1>
        <p className="net-privacy"><Lock size={14} aria-hidden="true" />{t('net.privacy')}</p>
      </header>

      <form role="search" className="net-search" onSubmit={submit} aria-label={t('net.search.label')}>
        <label className="net-search__field">
          <span className="net-sr">{t('net.search.label')}</span>
          <Search size={22} aria-hidden="true" />
          <input
            type="search" value={text} dir="auto" autoComplete="off" spellCheck={false} maxLength={200}
            placeholder={t('net.search.placeholder')} aria-describedby="net-hint"
            onChange={(e) => {
              // Abort and supersede immediately; previous results never outlive the term that produced them.
              typed.current = true; ctl.current?.abort(); seq.current++;
              const v = e.target.value; setText(v);
              setState(!v.trim() ? { kind: 'idle' } : normalizeQuery(v) ? { kind: 'loading', q: v.trim() } : { kind: 'short' });
            }}
            data-testid="input-network-search"
          />
        </label>
        <button type="submit" className="amal-btn amal-btn--primary" data-testid="button-network-search">{t('net.search.submit')}</button>
        <p id="net-hint" className="net-hint">{t('net.search.hint')}</p>
      </form>
      <p className="net-sr" role="status" aria-live="polite" data-testid="status-network-search">{announce}</p>

      {state.kind === 'idle' && <Empty icon={<Globe2 size={30} />} title={t('net.search.idleTitle')} desc={t('net.search.idleDesc')} testId="state-network-idle" />}
      {state.kind === 'short' && <Empty icon={<Search size={30} />} title={t('net.search.tooShort')} testId="state-network-short" />}
      {(state.kind === 'loading' || state.kind === 'hidden') && <Skeleton />}
      {state.kind === 'fail' && (
        <Empty
          icon={state.why === 'error' ? <RotateCcw size={30} /> : <ShieldAlert size={30} />}
          title={t(`net.search.${state.why === 'denied' ? 'denied' : state.why === 'session' ? 'session' : 'error'}Title`)}
          desc={t(`net.search.${state.why === 'denied' ? 'denied' : state.why === 'session' ? 'session' : 'error'}Desc`)}
          testId={`state-network-${state.why}`} alert
          action={state.why === 'error' ? <button type="button" className="amal-btn amal-btn--secondary" onClick={() => run(state.q)} data-testid="button-network-retry"><RotateCcw size={16} aria-hidden="true" />{t('net.search.retry')}</button> : undefined}
        />
      )}
      {state.kind === 'ok' && state.items.length === 0 && (
        <Empty icon={<SearchX size={30} />} title={t('net.search.emptyTitle')} desc={t('net.search.emptyDesc', { q: '\u2068' + state.q + '\u2069' })} testId="state-network-empty" />
      )}
      {state.kind === 'ok' && state.items.length > 0 && (
        <>
          <p className="net-count" data-testid="text-network-count">{t('net.search.results', { count: state.items.length })}<span className="net-sr"> {t('net.search.keyboard')}</span></p>
          <ul ref={listRef} className="net-results" onKeyDown={onKey} data-testid="list-network-results">
            {state.items.map((p, i) => <li key={p.id} style={{ ['--i' as string]: Math.min(i, 8) }}><Result p={p} onOpen={() => open(p, state.q)} clinicId={clinic?.id ?? null} /></li>)}
          </ul>
          {state.next && (
            <button type="button" className="amal-btn amal-btn--secondary net-more" disabled={state.more} onClick={() => run(state.q, state.next ?? undefined)} data-testid="button-network-more">
              <ChevronDown size={16} aria-hidden="true" />{state.more ? t('net.search.loadingMore') : t('net.search.more')}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Result({ p, onOpen, clinicId }: { p: NetworkPatient; onOpen: () => void; clinicId: number | null }) {
  const { t } = useTranslation();
  const { locale, digitPreference } = useAmalPreferences();
  const [now] = useState(() => new Date());
  const last = latestVisit(p);
  const alerts = patientAlerts(p);
  const shown = alerts.slice(0, 2);
  return (
    <article className="net-card" data-testid={`network-result-${p.id}`}>
      <button type="button" className="net-hit" data-pid={p.id} onClick={onOpen} aria-label={t('net.result.open', { name: p.name })} data-testid={`button-open-patient-${p.id}`}>
        <span className="net-hit__av" aria-hidden="true"><UserRound size={22} /></span>
        <span className="net-hit__main">
          <bdi className="net-hit__name" dir="auto">{p.name}</bdi>
          <span className="net-hit__meta">
            <span className="net-tag" data-testid={`text-record-${p.id}`}>{t('net.result.record', { id: p.id })}</span>
            <span className="net-tag net-tag--warn">{t('net.result.unverified')}</span>
          </span>
          <span className="net-hit__sum" data-testid={`text-summary-${p.id}`}>
            {last ? <>
              <span className={`net-dot net-tone-${clinicTone(last.clinicId)}`} aria-hidden="true" />
              {t('net.result.seen', {
                clinic: '\u2068' + (last.clinicId === clinicId ? `${last.clinicName} (${t('net.card.yourClinic')})` : last.clinicName) + '\u2069',
                when: relativeLabel(last.seenAt, now, locale, digitPreference),
                doctor: '\u2068' + last.doctorName + '\u2069',
              })}
              <time className="net-hit__abs" dateTime={last.seenAt} data-testid={`text-summary-date-${p.id}`}>({formatVisitDay(last.seenAt, locale, digitPreference)})</time>
            </> : t('net.result.none')}
          </span>
        </span>
      </button>
      <div className="net-card__side"><ConsentBadge level={effectiveConsent(p)} testId={`badge-consent-${p.id}`} /></div>
      {shown.length > 0 && (
        <div className="net-card__flags">
          {shown.map((a, i) => <KeyAlertChip key={i} alert={a} testId={`chip-alert-${p.id}-${i}`} />)}
          {alerts.length > shown.length && <p className="net-hint">{t('net.result.moreFlags', { count: alerts.length - shown.length })}</p>}
        </div>
      )}
    </article>
  );
}

export function Empty({ icon, title, desc, action, testId, alert }: { icon: React.ReactNode; title: string; desc?: string; action?: React.ReactNode; testId: string; alert?: boolean }) {
  return (
    <div className="net-empty" data-testid={testId} role={alert ? 'alert' : undefined}>
      <span className="net-empty__mark" aria-hidden="true">{icon}</span>
      <h2 className="net-h2">{title}</h2>
      {desc && <p className="net-empty__desc">{desc}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="net-results" aria-hidden="true" data-testid="state-network-loading">
      {Array.from({ length: rows }, (_, i) => <li key={i} className="net-skel"><span /><span /><span /></li>)}
    </ul>
  );
}

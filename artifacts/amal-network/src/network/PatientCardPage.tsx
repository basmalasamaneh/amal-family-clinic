import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { ArrowLeft, Building2, FileText, IdCard, Lock, RotateCcw, ShieldAlert, ShieldX, Stethoscope, UserRound } from 'lucide-react';
import { useAmalPreferences } from '@workspace/amal-ui';
import { lookupNetwork, type NetworkPatient, type NetworkVisit } from '@workspace/api-client-react';
import type { ShellClinic } from '@/shell/identity';
import { demoPath } from '@/shell/identity';
import { ConsentBadge, KeyAlertChip, NoAlerts } from './indicators';
import { Empty, Skeleton } from './NetworkSearchPage';
import {
  classifyFailure, clearSelection, clinicTone, CONSENT_CHANGED_EVENT, REVALIDATE_MS, effectiveConsent, findPatient, formatVisitDay, formatVisitTime,
  getSelection, isAbortError, orderVisits, relativeLabel, visitAlerts, visitNote, type Failure,
} from './model';
import './i18n';
import './network.css';

type State =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'ok'; p: NetworkPatient; at: Date }
  | { kind: 'gone' }
  | { kind: 'fail'; why: Failure };

/**
 * Patient card. Re-runs the exact audited lookup on every mount and window focus and matches the stable id;
 * protected content is cleared before revalidation and removed on denial, withdrawal or disappearance.
 */
export function PatientCardPage({ clinic, title, scope }: { clinic: ShellClinic | null; title: string; scope: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>(() => (getSelection(scope) ? { kind: 'loading' } : { kind: 'none' }));
  const seq = useRef(0);
  const ctl = useRef<AbortController | null>(null);
  const nameRef = useRef<HTMLHeadingElement>(null);
  const focused = useRef(false);

  const load = useCallback(() => {
    const sel = getSelection(scope);
    ctl.current?.abort();
    const id = ++seq.current;
    if (!sel) { setState({ kind: 'none' }); return; }
    const ac = new AbortController(); ctl.current = ac;
    setState({ kind: 'loading' });
    findPatient(lookupNetwork, sel.q, sel.id, ac.signal).then(
      (p) => {
        if (id !== seq.current) return;
        if (!p) { setState({ kind: 'gone' }); return; }
        setState({ kind: 'ok', p, at: new Date() });
      },
      (e) => {
        if (id !== seq.current || isAbortError(e)) return;
        const why = classifyFailure(e);
        if (why !== 'error') clearSelection();
        setState({ kind: 'fail', why });
      },
    );
  }, [scope]);

  useEffect(() => { load(); return () => { ctl.current?.abort(); seq.current++; }; }, [load]);
  // Every authorization refresh clears the old projection before fetching.
  useEffect(() => {
    const fresh = () => load();
    const onVis = () => {
      if (document.visibilityState === 'hidden') { ctl.current?.abort(); seq.current++; setState((s) => (s.kind === 'ok' || s.kind === 'loading' ? { kind: 'loading' } : s)); }
      else load();
    };
    const tick = setInterval(() => { if (document.visibilityState === 'visible') load(); }, REVALIDATE_MS);
    window.addEventListener('focus', fresh);
    document.addEventListener('visibilitychange', onVis);
    document.addEventListener(CONSENT_CHANGED_EVENT, fresh);
    return () => { clearInterval(tick); window.removeEventListener('focus', fresh); document.removeEventListener('visibilitychange', onVis); document.removeEventListener(CONSENT_CHANGED_EVENT, fresh); };
  }, [load]);
  useEffect(() => {
    if (state.kind === 'ok' && !focused.current) { focused.current = true; nameRef.current?.focus(); }
  }, [state]);

  const back = <Link href={demoPath('/doctor/network-search')} className="net-back" data-testid="link-network-back"><ArrowLeft size={18} aria-hidden="true" className="shell-dir-icon" />{t('net.card.back')}</Link>;

  return (
    <section className="net" data-testid="page-patientCard" aria-busy={state.kind === 'loading'}>
      <header className="net-head">
        {back}
        <p className="net-eyebrow">{clinic && <><bdi>{clinic.name}</bdi> · </>}{t('net.eyebrow')}</p>
        <h1 id="page-title" tabIndex={-1} className="net-h1">{title}</h1>
      </header>
      <p className="net-sr" role="status" aria-live="polite" data-testid="status-patient-card">{state.kind === 'loading' ? t('net.card.loading') : state.kind === 'gone' ? t('net.card.goneTitle') : ''}</p>

      {state.kind === 'none' && <Empty icon={<IdCard size={30} />} title={t('net.card.noneTitle')} desc={t('net.card.noneDesc')} testId="state-card-none"
        action={<Link href={demoPath('/doctor/network-search')} className="amal-btn amal-btn--primary" data-testid="link-card-search">{t('net.card.toSearch')}</Link>} />}
      {state.kind === 'loading' && <Skeleton rows={2} />}
      {state.kind === 'gone' && <Empty icon={<ShieldX size={30} />} title={t('net.card.goneTitle')} desc={t('net.card.goneDesc')} testId="state-card-gone" alert />}
      {state.kind === 'fail' && (
        <Empty
          icon={state.why === 'error' ? <RotateCcw size={30} /> : <ShieldAlert size={30} />}
          title={t(`net.search.${state.why === 'denied' ? 'denied' : state.why === 'session' ? 'session' : 'error'}Title`)}
          desc={t(`net.search.${state.why === 'denied' ? 'denied' : state.why === 'session' ? 'session' : 'error'}Desc`)}
          testId={`state-card-${state.why}`} alert
          action={state.why === 'error' ? <button type="button" className="amal-btn amal-btn--secondary" onClick={() => load()} data-testid="button-card-retry"><RotateCcw size={16} aria-hidden="true" />{t('net.search.retry')}</button> : undefined}
        />
      )}
      {state.kind === 'ok' && <Card p={state.p} at={state.at} clinicId={clinic?.id ?? null} nameRef={nameRef} />}
    </section>
  );
}

function Card({ p, at, clinicId, nameRef }: { p: NetworkPatient; at: Date; clinicId: number | null; nameRef: React.RefObject<HTMLHeadingElement | null> }) {
  const { t } = useTranslation();
  const { locale, digitPreference } = useAmalPreferences();
  const visits = orderVisits(p.visits);
  return (
    <div className="net-dossier" data-testid={`card-patient-${p.id}`}>
      <div className="net-id">
        <span className="net-hit__av net-id__av" aria-hidden="true"><UserRound size={28} /></span>
        <div className="net-id__txt">
          <h2 ref={nameRef} tabIndex={-1} className="net-id__name" data-testid="text-patient-name"><bdi dir="auto">{p.name}</bdi></h2>
          <p className="net-hit__meta">
            <span className="net-tag" data-testid="text-patient-record">{t('net.result.record', { id: p.id })}</span>
            <span className="net-tag net-tag--warn">{t('net.result.unverified')}</span>
          </p>
        </div>
        <div className="net-id__consent">
          <ConsentBadge level={effectiveConsent(p)} testId="network-consent" />
          <small className="net-hint">{t('net.consent.note')}</small>
        </div>
      </div>
      <p className="net-identity"><Lock size={14} aria-hidden="true" />{t('net.card.identity')}</p>

      <section className="net-timeline" aria-labelledby="net-tl-h" data-testid="network-timeline">
        <div className="net-timeline__head">
          <h3 id="net-tl-h" className="net-h2">{t('net.card.timeline')}</h3>
          <span className="net-tag" data-testid="text-visit-count">{t('net.card.visits', { count: visits.length })}</span>
        </div>
        <p className="net-hint">{t('net.card.timelineDesc')} {t('net.card.refreshed', { time: formatVisitTime(at.toISOString(), digitPreference) })}</p>
        {visits.length === 0 ? <p className="net-noflags" data-testid="status-no-visits">{t('net.card.noVisits')}</p> : (
          <ol className="net-tl">
            {visits.map((v, i) => <Visit key={i} v={v} i={i} local={v.clinicId === clinicId} locale={locale} digits={digitPreference} at={at} />)}
          </ol>
        )}
      </section>
    </div>
  );
}

function Visit({ v, i, local, locale, digits, at }: { v: NetworkVisit; i: number; local: boolean; locale: 'ar' | 'en'; digits: 'latn' | 'arab'; at: Date }) {
  const { t } = useTranslation();
  const note = visitNote(v);
  const alerts = visitAlerts(v);
  const time = formatVisitTime(v.seenAt, digits);
  return (
    <li className={`net-tl__item net-tone-${clinicTone(v.clinicId)}`} data-testid={`row-visit-${i}`} data-visibility={v.visibility}>
      <span className="net-tl__node" aria-hidden="true" />
      <div className="net-tl__body">
        <p className="net-tl__when">
          <time dateTime={v.seenAt} data-testid={`text-visit-date-${i}`}>{formatVisitDay(v.seenAt, locale, digits)}{time && <> · {time}</>}</time>
          <span className="net-hint">{relativeLabel(v.seenAt, at, locale, digits)}</span>
        </p>
        <p className="net-tl__who">
          <span className="net-clinic" data-testid={`text-visit-clinic-${i}`}><Building2 size={14} aria-hidden="true" /><bdi dir="auto">{v.clinicName}</bdi></span>
          <span className={`net-tag${local ? ' net-tag--local' : ''}`}>{local ? t('net.card.yourClinic') : t('net.card.otherClinic')}</span>
          <span className="net-tl__doc" data-testid={`text-visit-doctor-${i}`}><Stethoscope size={14} aria-hidden="true" />{t('net.card.with', { doctor: '\u2068' + v.doctorName + '\u2069' })}</span>
        </p>
        {v.visibility === 'clinical' ? (
          <>
            {note && (
              <div className="net-note">
                <h4 className="net-note__h"><FileText size={14} aria-hidden="true" />{t('net.card.noteHeading')}</h4>
                <p dir="auto" data-testid={`text-visit-note-${i}`}>{note}</p>
              </div>
            )}
            {alerts.length > 0
              ? <div className="net-flags" aria-label={t('net.card.flags')}>{alerts.map((a, j) => <KeyAlertChip key={j} alert={a} testId={`chip-alert-${i}-${j}`} />)}</div>
              : <NoAlerts testId={`status-no-alerts-${i}`} />}
          </>
        ) : <p className="net-hint" data-testid={`text-visit-basic-${i}`}>{t('net.card.basicOnly')}</p>}
      </div>
    </li>
  );
}

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearch } from 'wouter';
import { ShieldCheck, AlertTriangle, CalendarClock, CalendarDays, DoorOpen, FlaskConical, IdCard, Lock, PhoneCall, RotateCcw, Search, UserPlus, UserRound, X } from 'lucide-react';
import { ReminderOptOut } from '@/reminders/ReminderOptOut';
import { EmptyState, useAmalPreferences } from '@workspace/amal-ui';
import type { ShellClinic } from '@/shell/identity';
import { demoPath } from '@/shell/identity';
import { resolveSchedulingAdapter } from '@/calendar/adapter';
import { bookingQuery } from '@/calendar/booking';
import { formatLocalDate, formatNum, formatTime, isLocalDate, localDateOf } from '@/calendar/dates';
import { PatientQuickSearch } from '@/booking/PatientQuickSearch';
import { APPOINTMENTS_CHANGED } from '@/booking/BookingDrawer';
import { resolvePatientSearch, type PatientHit } from '@/booking/patients';
import { classifyError, isAbort, type FailureKind } from '@/booking/errors';
import { createLatest } from '@/booking/ops';
import { hebronToday, completedYears, isMinor } from './age';
import { createRegSession, EMPTY_DRAFT, serverFieldErrors, type NewPatientPayload, type RegDraft } from './registration';
import { createFixtureReceptionApi, realReceptionApi, type ReceptionApi, type UpcomingItem } from './api';
import { IDLE_STATUS, NewPatientDialog, startSave, type RegStatus } from './NewPatientDialog';
import { useWalkIn } from './WalkIn';
import { selectConsentPatient } from '@/consent/model';
import '@/booking/i18n';
import './i18n';
import './reception.css';

/**
 * Reception Patients. Demographics + server-filtered upcoming appointments only; no clinical
 * request exists in this module. The shell keys <main> by clinic, so a clinic switch remounts
 * this page and drops selection, results and the draft. No React Query cache is used for patients.
 */
export function PatientsPage({ clinic, fixture, title }: { clinic: ShellClinic | null; fixture: boolean; title: string }) {
  const { t } = useTranslation();
  const search = useSearch();
  const useFixture = import.meta.env.DEV && fixture;
  const scheduling = useMemo(() => resolveSchedulingAdapter(search, fixture), [fixture]); // eslint-disable-line react-hooks/exhaustive-deps
  const patients = useMemo(() => resolvePatientSearch(useFixture), [useFixture]);
  const walkIn = useWalkIn();
  const api = useMemo<ReceptionApi>(() => walkIn.reception ?? (useFixture ? createFixtureReceptionApi((id, s) => scheduling.listDoctors(id, s)) : realReceptionApi), [walkIn.reception, useFixture, scheduling]);
  const [selected, setSelected] = useState<PatientHit | null>(null);
  const [regOpen, setRegOpen] = useState(false);
  const [draft, setDraft] = useState<RegDraft>(EMPTY_DRAFT);
  const [refresh, setRefresh] = useState(0);
  // Page-owned (memory only) so close/reopen and Walk-in handoff keep the same clientOpId.
  const session = useRef(createRegSession()).current;
  const [regStatus, setRegStatus] = useState<RegStatus>(IDLE_STATUS);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [saved, setSaved] = useState<string | null>(null);
  const [doctorNames, setDoctorNames] = useState<Map<number, string>>(new Map());
  const newBtn = useRef<HTMLButtonElement>(null);
  const detailRef = useRef<HTMLHeadingElement>(null);
  const dirty = (draft !== EMPTY_DRAFT && Object.values(draft).some((v) => v.trim())) || session.pending !== null;

  useEffect(() => {
    if (!clinic) return;
    const ctl = new AbortController();
    scheduling.listDoctors(clinic.id, ctl.signal).then((ds) => setDoctorNames(new Map(ds.filter((d) => d.clinicId === clinic.id).map((d) => [d.id, d.name]))), () => undefined);
    return () => ctl.abort();
  }, [scheduling, clinic]);

  if (!clinic) return <section className="rx" data-testid="page-patientLookup"><h1 id="page-title" tabIndex={-1} className="cal-h1">{title}</h1><p>{t('shell.page.noClinic')}</p></section>;

  const select = (p: PatientHit) => { setSelected(p); setSaved(null); setTimeout(() => detailRef.current?.focus(), 0); };
  const submitReg = (key: string, payload: NewPatientPayload) => {
    const r = startSave(api, session, key, payload, (res) => {
      if (!alive.current) return; // page gone (clinic/account switch): drop, never show in another scope
      if (res.ok) {
        const p = { ...res.patient, clinicId: res.patient.clinicId || clinic.id };
        setRegStatus(IDLE_STATUS); setRegOpen(false); setDraft(EMPTY_DRAFT); setRefresh((n) => n + 1); select(p);
        setSaved(t('rx.reg.saved', { name: '\u2068' + p.name + '\u2069' }));
      } else setRegStatus({ saving: false, failure: res.failure, serverErrors: serverFieldErrors(res.failure, res.data) });
    });
    if (r === 'started') { session.snapshot = draft; setRegStatus({ saving: true, failure: null, serverErrors: {} }); }
  };
  const handoff = walkIn.enabled ? () => { setRegOpen(false); setTimeout(() => walkIn.open(), 0); } : null;

  return (
    <section className="rx" data-testid="page-patientLookup">
      <header className="rx-head">
        <div>
          <p className="cal-eyebrow"><bdi>{clinic.name}</bdi> · {t('rx.eyebrow')}</p>
          <h1 id="page-title" tabIndex={-1} className="cal-h1"><Search size={28} aria-hidden="true" />{title}</h1>
          <p className="rx-privacy"><Lock size={16} aria-hidden="true" />{t('rx.privacy')}</p>
        </div>
        <button ref={newBtn} type="button" className="bk-btn bk-btn--primary" onClick={() => setRegOpen(true)} data-testid="button-new-patient"><UserPlus size={20} aria-hidden="true" />{t('rx.newPatient')}</button>
      </header>
      {(patients.mode === 'fixture' || api.mode === 'fixture') && <p className="bk-fixture" data-testid="status-fixture-reception"><FlaskConical size={16} aria-hidden="true" />{t('rx.fixture')}</p>}
      {dirty && !regOpen && (
        <div className="bk-msg bk-msg--info" role="status" data-testid="status-draft-kept"><UserPlus size={20} aria-hidden="true" />
          <div className="bk-msg__body"><p>{t('rx.reg.draftKept')}</p>
            {session.pending && <p className="bk-hint" data-testid="text-draft-pending">{t('rx.reg.pendingKept')}</p>}
            <div className="rx-actions">
              <button type="button" className="bk-btn bk-btn--sm" onClick={() => setRegOpen(true)} data-testid="button-draft-resume">{t('rx.reg.resume')}</button>
              {!session.pending && <button type="button" className="bk-btn bk-btn--sm" onClick={() => setDraft(EMPTY_DRAFT)} data-testid="button-draft-discard">{t('rx.reg.discard')}</button>}
            </div></div></div>
      )}
      {saved && <p className="bk-msg bk-msg--ok" role="status" data-testid="status-patient-saved">{saved}</p>}

      <div className="rx-grid">
        <section className="rx-panel" aria-labelledby="rx-search-h">
          <h2 id="rx-search-h" className="rx-h2">{t('rx.searchTitle')}</h2>
          <PatientQuickSearch adapter={patients} clinicId={clinic.id} onSelect={select} paginate refreshKey={refresh} selectedId={selected?.id ?? null} />
        </section>
        <section className="rx-panel rx-dossier" aria-labelledby="rx-detail-h" data-testid="panel-patient-detail">
          {selected ? (
            <PatientDetail key={selected.id} patient={selected} clinic={clinic} api={api} doctorNames={doctorNames} headingRef={detailRef}
              onClear={() => setSelected(null)} onWalkIn={walkIn.enabled ? () => walkIn.open({ patient: selected }) : null} />
          ) : (
            <div className="rx-empty" data-testid="state-no-patient">
              <span className="rx-empty__mark" aria-hidden="true"><IdCard size={34} /></span>
              <h2 id="rx-detail-h" ref={detailRef} tabIndex={-1} className="rx-h2">{t('rx.noneTitle')}</h2>
              <p className="bk-hint">{t('rx.noneBody')}</p>
            </div>
          )}
        </section>
      </div>

      {regOpen && (
        <NewPatientDialog api={api} clinicId={clinic.id} draft={draft} onDraft={setDraft} onWalkIn={handoff}
          session={session} status={regStatus} onSubmit={submitReg}
          onClose={() => { setRegOpen(false); setTimeout(() => newBtn.current?.focus(), 0); }} />
      )}
    </section>
  );
}

type Up = { kind: 'loading' } | { kind: 'ok'; items: UpcomingItem[]; cursor: string | null; more: 'idle' | 'loading' | 'error' } | { kind: 'error'; failure: FailureKind };

function PatientDetail({ patient, clinic, api, doctorNames, headingRef, onClear, onWalkIn }: {
  patient: PatientHit; clinic: ShellClinic; api: ReceptionApi; doctorNames: Map<number, string>;
  headingRef: RefObject<HTMLHeadingElement | null>; onClear: () => void; onWalkIn: (() => void) | null;
}) {
  const { t } = useTranslation();
  const { locale, digitPreference: dp } = useAmalPreferences();
  const today = hebronToday();
  const [up, setUp] = useState<Up>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);
  const latest = useRef(createLatest()).current;

  useEffect(() => {
    const token = latest.next(); const ctl = new AbortController();
    setUp({ kind: 'loading' });
    api.upcoming(clinic.id, patient.id, null, ctl.signal).then(
      (p) => { if (latest.isCurrent(token)) setUp({ kind: 'ok', items: p.items, cursor: p.nextCursor, more: 'idle' }); },
      (e) => { if (!isAbort(e) && latest.isCurrent(token)) setUp({ kind: 'error', failure: classifyError(e).kind }); },
    );
    return () => { ctl.abort(); latest.invalidate(); };
  }, [api, clinic.id, patient.id, nonce, latest]);
  useEffect(() => {
    const on = () => setNonce((n) => n + 1);
    window.addEventListener(APPOINTMENTS_CHANGED, on); return () => window.removeEventListener(APPOINTMENTS_CHANGED, on);
  }, []);
  const more = () => {
    if (up.kind !== 'ok' || !up.cursor || up.more === 'loading') return;
    const token = latest.next(); setUp({ ...up, more: 'loading' });
    api.upcoming(clinic.id, patient.id, up.cursor, undefined).then(
      (p) => { if (latest.isCurrent(token)) setUp((s) => s.kind === 'ok' ? { kind: 'ok', items: [...s.items, ...p.items.filter((x) => !s.items.some((y) => y.id === x.id))], cursor: p.nextCursor, more: 'idle' } : s); },
      () => { if (latest.isCurrent(token)) setUp((s) => (s.kind === 'ok' ? { ...s, more: 'error' } : s)); },
    );
  };

  const dobOk = !!patient.dateOfBirth && isLocalDate(patient.dateOfBirth);
  const age = dobOk ? completedYears(patient.dateOfBirth!, today) : null;
  const minor = dobOk ? isMinor(patient.dateOfBirth!, today) : null;
  const errText = up.kind === 'error' ? (up.failure === 'unavailable' ? t('rx.up.unavailable') : up.failure === 'auth' ? t('rx.up.auth') : t('rx.up.error')) : '';

  return (
    <div className="rx-detail">
      <div className="rx-id">
        <span className="rx-id__av" aria-hidden="true"><UserRound size={30} /></span>
        <div className="rx-id__txt">
          <p className="bk-hint">{t('rx.detail.title')}</p>
          <h2 id="rx-detail-h" ref={headingRef} tabIndex={-1} className="rx-id__name" data-testid="text-patient-name"><bdi dir="auto">{patient.name}</bdi></h2>
          <p className="rx-id__rec">{t('rx.detail.record', { id: patient.id })}{minor && <span className="rx-tag" data-testid="badge-minor">{t('rx.detail.minor')}</span>}</p>
        </div>
        <button type="button" className="bk-x" onClick={onClear} aria-label={t('rx.detail.clear')} data-testid="button-clear-patient"><X size={20} aria-hidden="true" /></button>
      </div>
      <dl className="rx-dl">
        <div><dt>{t('rx.detail.phone')}</dt><dd data-testid="text-patient-phone">{patient.phone ? <bdi dir="ltr">{patient.phone}</bdi> : '—'}</dd></div>
        <div><dt>{t('rx.detail.dob')}</dt><dd data-testid="text-patient-dob">{dobOk ? formatLocalDate(patient.dateOfBirth!, locale, dp, 'd MMMM yyyy') : t('rx.detail.noDob')}</dd></div>
        <div><dt>{t('rx.detail.age')}</dt><dd data-testid="text-patient-age">{age !== null ? t('rx.detail.ageYears', { count: age }).replace(String(age), formatNum(age, dp)) : '—'}</dd></div>
      </dl>
      <div className="rx-actions">
        {onWalkIn && <button type="button" className="bk-btn bk-btn--primary" onClick={onWalkIn} data-testid="button-patient-walkin"><DoorOpen size={20} aria-hidden="true" />{t('rx.detail.walkIn')}</button>}
        <Link href={demoPath(`/desk/consent?patientId=${patient.id}`)} onClick={() => selectConsentPatient(clinic.id, patient.id)} className="bk-btn" data-testid="link-patient-consent"><ShieldCheck size={18} aria-hidden="true" />{t('rx.detail.consent')}</Link>
        <Link href={demoPath(bookingQuery({ clinicId: clinic.id, source: 'phone' }))} className="bk-btn" data-testid="link-patient-phone-booking"><PhoneCall size={18} aria-hidden="true" />{t('rx.detail.phoneBooking')}</Link>
      </div>

      <ReminderOptOut key={`${clinic.id}:${patient.id}`} patientId={patient.id} />

      <section className="rx-up" aria-labelledby="rx-up-h" data-testid="section-upcoming">
        <h3 id="rx-up-h" className="rx-h3"><CalendarClock size={20} aria-hidden="true" />{t('rx.up.title')}</h3>
        <p className="rx-sr" role="status" aria-live="polite">{up.kind === 'loading' ? t('rx.up.loading') : errText}</p>
        {up.kind === 'loading' && <div className="bk-list" aria-hidden="true" data-testid="status-upcoming-loading"><div className="bk-skel" /><div className="bk-skel" /></div>}
        {up.kind === 'error' && <div className="bk-msg bk-msg--block" data-testid="status-upcoming-error"><AlertTriangle size={20} aria-hidden="true" /><div className="bk-msg__body"><p>{errText}</p>
          <button type="button" className="bk-btn bk-btn--sm" onClick={() => setNonce((n) => n + 1)} data-testid="button-upcoming-retry"><RotateCcw size={16} aria-hidden="true" />{t('rx.up.retry')}</button></div></div>}
        {up.kind === 'ok' && !up.items.length && <div data-testid="status-upcoming-empty"><EmptyState className="amal-empty--compact" title={t('rx.up.empty')} description={t('rx.up.emptyDesc')} /></div>}
        {up.kind === 'ok' && up.items.length > 0 && (
          <ol className="rx-up__list">
            {up.items.map((a) => {
              const d = localDateOf(a.startsAt);
              return (
                <li key={a.id} className="rx-up__item" data-testid={`row-upcoming-${a.id}`}>
                  <span className="rx-up__date"><strong>{formatLocalDate(d, locale, dp, 'd')}</strong><span>{formatLocalDate(d, locale, dp, 'MMM')}</span></span>
                  <span className="rx-up__main">
                    <span className="rx-up__when">{formatLocalDate(d, locale, dp, 'EEEE')} · <bdi dir="ltr">{formatTime(a.startsAt, locale, dp)}–{formatTime(a.endsAt, locale, dp)}</bdi></span>
                    <span className="bk-hint"><bdi dir="auto">{doctorNames.get(a.doctorId) ?? t('rx.up.doctor', { id: a.doctorId })}</bdi> · <bdi>{clinic.name}</bdi></span>
                  </span>
                  <span className={`rx-tag rx-tag--${a.status}`}>{t(`rx.up.status.${a.status}`, { defaultValue: a.status })}</span>
                  <Link href={demoPath(`/desk/today?date=${d}&doctor=${a.doctorId}`)} className="bk-btn bk-btn--sm" aria-label={`${t('rx.up.open')}: ${formatLocalDate(d, locale, dp)}`} data-testid={`link-upcoming-${a.id}`}><CalendarDays size={16} aria-hidden="true" />{t('rx.up.open')}</Link>
                </li>);
            })}
          </ol>
        )}
        {up.kind === 'ok' && up.cursor && <button type="button" className="bk-btn bk-btn--sm" onClick={more} disabled={up.more === 'loading'} data-testid="button-upcoming-more">{up.more === 'error' ? t('rx.up.retry') : t('rx.up.more')}</button>}
      </section>
    </div>
  );
}

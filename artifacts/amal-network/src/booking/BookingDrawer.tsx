import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ArrowRight, Ban, CheckCircle2, DoorOpen, FlaskConical, Info, Loader2, PhoneCall, RotateCcw, TriangleAlert, UserRound, X } from 'lucide-react';
import type { Appointment, AppointmentInput, ConflictItemSuggestedSlotsItem, ConflictPreview } from '@workspace/api-client-react';
import { useAmalPreferences } from '@workspace/amal-ui';
import type { ShellClinic } from '@/shell/identity';
import type { CalendarDoctor, SchedulingReadAdapter } from '@/calendar/adapter';
import type { BookingContext } from '@/calendar/booking';
import { formatLocalDate, formatTime, localDateOf, todayLocal } from '@/calendar/dates';
import { formatExpiry } from './time';
import { PatientQuickSearch } from './PatientQuickSearch';
import { ConflictDialog } from './ConflictDialog';
import { commitAllowed, summarize } from './conflicts';
import { createAttemptKeeper, createLatest, newOpId, stableKey } from './ops';
import { classifyError, isAbort, type Failure, type FailureKind } from './errors';
import { effectiveInterval, localTimeOf, minutesBetween, nextLocalTime, type ExactSlot } from './time';
import type { BookingApi } from './api';
import type { PatientHit, PatientSearchAdapter } from './patients';
import { QuickSlots } from '@/reception/QuickSlots';
import { WalkInHandoff } from '@/reception/WalkInHandoff';
import type { AvailabilityFn, AvailabilitySlot } from '@/reception/api';
import { cachedPatientSearch, cachedSchedulingAdapter, getBookingSnapshot, localBookingErrorKey, prepareBookingCache, saveLocalBooking, validateLocalBooking } from '@/offline/booking-bridge';
import { localCache } from '@/offline';
import type { CachedSnapshot } from '@/offline/types';
import './local-messages';
import './booking.css';

export const CHECK_DEBOUNCE_MS = 350;
export const APPOINTMENTS_CHANGED = 'amal:appointments-changed';
const DURATIONS = [10, 15, 20, 30, 45, 60, 90];
type Stage = 0 | 1 | 2;
type Check = { kind: 'incomplete' } | { kind: 'checking'; key: string } | { kind: 'done'; key: string; preview: ConflictPreview } | { kind: 'error'; key: string; failure: FailureKind; localKey?: string };
type Hold = { kind: 'none' } | { kind: 'getting'; key: string } | { kind: 'held'; key: string; token: string; expiresAt: string } | { kind: 'failed'; key: string; failure: FailureKind };

export interface BookingDrawerProps {
  clinic: ShellClinic; ctx: BookingContext | null; title: string;
  scheduling: SchedulingReadAdapter; patients: PatientSearchAdapter; api: BookingApi;
  onClose: (created: Appointment | null) => void;
  /** Explicitly chosen patient handed in by the caller (still shown and changeable). */
  initialPatient?: PatientHit | null;
  /** Walk-in quick path: server nearest-slot lookup. Absent means the classic three-stage flow only. */
  availability?: AvailabilityFn;
  /** Walk-in hint only: ranked first if the doctor is on the live clinic roster; never auto-booked. */
  preferDoctorId?: number | null;
}

export function BookingDrawer({ clinic, ctx, title, scheduling, patients, api, onClose, initialPatient, availability, preferDoctorId = null }: BookingDrawerProps) {
  const { t } = useTranslation();
  const { locale, digitPreference: dp } = useAmalPreferences();
  const qc = useQueryClient();
  const local = api.mode === 'real';
  const readScheduling: SchedulingReadAdapter = local ? cachedSchedulingAdapter : scheduling;
  const readPatients: PatientSearchAdapter = local ? cachedPatientSearch : patients;
  const [cache, setCache] = useState<{ kind: 'loading' } | { kind: 'error'; key: string | null } | { kind: 'ready'; snapshot: CachedSnapshot; refreshFailed: boolean }>({ kind: 'loading' });
  const [cacheNonce, setCacheNonce] = useState(0);
  const [localSubmitError, setLocalSubmitError] = useState<string | null>(null);
  const source = ctx?.source ?? 'phone';
  const walkIn = source === 'walk-in';
  const initial = useMemo(() => {
    if (ctx?.startsAt) return { date: localDateOf(ctx.startsAt), time: localTimeOf(ctx.startsAt), dur: ctx.endsAt ? minutesBetween(ctx.startsAt, ctx.endsAt) : 0 };
    if (walkIn) { const n = nextLocalTime(); return { date: n.date, time: n.time, dur: 0 }; }
    return { date: ctx?.localDate ?? todayLocal(), time: '', dur: 0 };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [stage, setStage] = useState<Stage>(0);
  const [patient, setPatient] = useState<PatientHit | null>(initialPatient && initialPatient.clinicId === clinic.id ? initialPatient : null);
  const [doctorId, setDoctorId] = useState<number | null>(ctx?.doctorId ?? null);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [duration, setDuration] = useState<number>(initial.dur || 30);
  const [exact, setExact] = useState<ExactSlot | null>(ctx?.startsAt ? { startsAt: ctx.startsAt, ...(ctx.endsAt ? { endsAt: ctx.endsAt } : {}) } : null);
  const [doctors, setDoctors] = useState<{ kind: 'loading' | 'ok' | 'error'; list: CalendarDoctor[] }>({ kind: 'loading', list: [] });
  const [docNonce, setDocNonce] = useState(0);
  const [check, setCheck] = useState<Check>({ kind: 'incomplete' });
  const [checkNonce, setCheckNonce] = useState(0);
  const [ack, setAck] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [hold, setHold] = useState<Hold>({ kind: 'none' });
  const [now, setNow] = useState(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<Failure | null>(null);
  /** Quick walk-in: checkKey that should auto-commit once its check passes and its hold is held. */
  const [auto, setAuto] = useState<{ key: string; label: string } | null>(null);
  const checkSeq = useRef(createLatest()).current;
  const holdSeq = useRef(createLatest()).current;
  const attempts = useRef(createAttemptKeeper<Omit<AppointmentInput, 'clientOpId'>>()).current;
  const submittingRef = useRef(false);
  const holdRef = useRef<string | null>(null);
  const openConflictsOnResult = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  const apiRef = useRef(api); apiRef.current = api;

  // Real identities always come from the authorized operational snapshot, never a
  // remote roster or a caller's potentially stale patient display data.
  useEffect(() => {
    if (!local) return;
    let live = true;
    let authorized = false;
    setCache({ kind: 'loading' });
    setDoctors({ kind: 'loading', list: [] });
    const load = async () => {
      let refreshFailed = false;
      if (navigator.onLine) {
        try { await prepareBookingCache(); } catch { refreshFailed = true; }
      }
      try {
        const snapshot: CachedSnapshot = await getBookingSnapshot();
        if (!live) return;
        if (!snapshot.metadata || snapshot.metadata.clinicId !== clinic.id) throw new Error('cache-not-ready');
        authorized = true;
        setCache({ kind: 'ready', snapshot, refreshFailed });
        setPatient((p) => p ? snapshot.patients.find((item) => item.id === p.id && item.clinicId === clinic.id) ?? null : null);
      } catch (e) { if (live) setCache({ kind: 'error', key: localBookingErrorKey(e) }); }
    };
    void load();
    // A revoked context must hide identities immediately, including a selected patient.
    const unsubscribe = localCache.subscribeContext(() => {
      // Initial shell context activation can happen while readyScope is waiting.
      // There are no displayed cache identities to revoke until the read succeeds.
      if (!live || !authorized) return;
      live = false;
      setPatient(null); setDoctorId(null); setDoctors({ kind: 'loading', list: [] });
      setCache({ kind: 'error', key: null }); setCheck({ kind: 'incomplete' });
      checkSeq.invalidate();
    });
    return () => { live = false; unsubscribe(); };
  }, [local, clinic.id, cacheNonce, checkSeq]);

  // Doctors (clinic-scoped; another clinic's doctor is never accepted).
  useEffect(() => {
    if (local && cache.kind !== 'ready') return;
    const ctl = new AbortController();
    setDoctors((d) => ({ kind: 'loading', list: d.list }));
    readScheduling.listDoctors(clinic.id, ctl.signal).then(
      (ds) => {
        if (ctl.signal.aborted) return;
        const list = ds.filter((d) => d.clinicId === clinic.id);
        setDoctors({ kind: 'ok', list });
        setDoctorId((id) => (id && list.some((d) => d.id === id) ? id : list.length === 1 ? list[0]!.id : null));
      },
      (e) => { if (!ctl.signal.aborted && !isAbort(e)) setDoctors({ kind: 'error', list: [] }); },
    );
    return () => ctl.abort();
  }, [readScheduling, clinic.id, docNonce, local, cache]);
  useEffect(() => {
    if (initial.dur || (local && cache.kind !== 'ready')) return;
    const ctl = new AbortController();
    readScheduling.clinicHours(clinic.id, ctl.signal).then((h) => { if (!ctl.signal.aborted && h?.slotMinutes) setDuration((d) => (d === 30 ? h.slotMinutes : d)); }, () => undefined);
    return () => ctl.abort();
  }, [readScheduling, clinic.id, initial.dur, local, cache]);

  const interval = useMemo(() => effectiveInterval(exact, date, time, duration), [exact, date, time, duration]);
  const checkInput = patient && doctorId && interval.ok && (!local || cache.kind === 'ready')
    ? { clinicId: clinic.id, doctorId, patientId: patient.id, startsAt: interval.startsAt, endsAt: interval.endsAt, source }
    : null;
  const checkKey = checkInput ? stableKey(checkInput) : null;
  const checkInputRef = useRef(checkInput); checkInputRef.current = checkInput;

  // Any context change invalidates acknowledgement and reason.
  useEffect(() => { setAck(false); setReason(''); setReasonTouched(false); }, [checkKey]);

  // Debounced, abortable, latest-only availability check.
  useEffect(() => {
    const token = checkSeq.next();
    const input = checkInputRef.current;
    if (!checkKey || !input) { setCheck({ kind: 'incomplete' }); return; }
    setCheck({ kind: 'checking', key: checkKey });
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      const request: Promise<ConflictPreview> = local
        ? validateLocalBooking(input).then(() => ({ ok: true, conflicts: [] }))
        : apiRef.current.check(input, ctl.signal);
      request.then(
        (preview) => { if (checkSeq.isCurrent(token)) setCheck({ kind: 'done', key: checkKey, preview }); },
        (e) => { if (!isAbort(e) && checkSeq.isCurrent(token)) setCheck({ kind: 'error', key: checkKey, failure: classifyError(e).kind, ...(local ? { localKey: localBookingErrorKey(e) } : {}) }); },
      );
    }, CHECK_DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [checkKey, checkNonce, checkSeq, local, cache]);

  const preview = check.kind === 'done' && check.key === checkKey ? check.preview : null;
  const summary = preview ? summarize(preview) : null;
  const cleanReason = ack ? reason.trim() : '';
  const canProceed = commitAllowed(preview, cleanReason);

  useEffect(() => {
    if (preview && openConflictsOnResult.current) { openConflictsOnResult.current = false; if (preview.conflicts.length) setConflictOpen(true); }
  }, [preview]);

  // Soft hold at confirmation; released whenever the selection changes or the drawer closes.
  const releaseHold = () => { const tok = holdRef.current; holdRef.current = null; if (tok) apiRef.current.release(tok).catch(() => undefined); };
  const holdKey = !local && stage === 2 && canProceed && checkKey ? checkKey + '|' + cleanReason : null;
  useEffect(() => {
    releaseHold();
    const token = holdSeq.next();
    const input = checkInputRef.current;
    if (!holdKey || !input) { setHold({ kind: 'none' }); return; }
    setHold({ kind: 'getting', key: holdKey });
    const { source: _s, ...rest } = input;
    apiRef.current.hold({ ...rest, clientOpId: newOpId(), ...(cleanReason ? { overrideReason: cleanReason } : {}) }).then(
      (h) => {
        if (!holdSeq.isCurrent(token)) { apiRef.current.release(h.token).catch(() => undefined); return; }
        holdRef.current = h.token; setNow(Date.now()); setHold({ kind: 'held', key: holdKey, token: h.token, expiresAt: h.expiresAt });
      },
      (e) => {
        if (!holdSeq.isCurrent(token)) return;
        const f = classifyError(e); setHold({ kind: 'failed', key: holdKey, failure: f.kind });
        if (f.kind === 'conflict') { openConflictsOnResult.current = true; setCheckNonce((n) => n + 1); }
      },
    );
  }, [holdKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Unmount: invalidate in-flight check/hold so a late hold resolution is released, not adopted.
  useEffect(() => () => { checkSeq.invalidate(); holdSeq.invalidate(); releaseHold(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (hold.kind !== 'held') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hold.kind]);
  const remaining = hold.kind === 'held' ? Math.max(0, Math.ceil((Date.parse(hold.expiresAt) - now) / 1000)) : 0;
  const holdExpired = hold.kind === 'held' && remaining <= 0;
  useEffect(() => { if (holdExpired) holdRef.current = null; }, [holdExpired]);

  useEffect(() => { if (mounted.current) headingRef.current?.focus(); mounted.current = true; }, [stage]);
  const attemptContext = checkKey ? checkKey + '|' + cleanReason : null;
  useEffect(() => { setSubmitErr(null); setLocalSubmitError(null); }, [checkKey, stage]);
  useEffect(() => { attempts.clear(); }, [attemptContext, attempts]);

  const doctorName = doctors.list.find((d) => d.id === doctorId)?.name ?? (doctorId ? t('calendar.booking.doctorId', { id: doctorId }) : '');
  const fmtSlot = (s: { startsAt: string; endsAt: string }) =>
    `${formatLocalDate(localDateOf(s.startsAt), locale, dp, 'EEE d MMM')} ${formatTime(s.startsAt, locale, dp)}–${formatTime(s.endsAt, locale, dp)}`;
  const whenLabel = interval.ok ? fmtSlot(interval) : '';
  const pickSlot = (s: ConflictItemSuggestedSlotsItem) => {
    setExact({ startsAt: s.startsAt, endsAt: s.endsAt }); setDate(localDateOf(s.startsAt)); setTime(localTimeOf(s.startsAt)); setDuration(minutesBetween(s.startsAt, s.endsAt));
    setConflictOpen(false); setStage(1);
  };

  /** replay=true re-sends the exact previous attempt; a fresh submit requires a current passing check. */
  const submit = async (replay = false) => {
    if (submittingRef.current || !attemptContext) return;
    const prior = attempts.current(attemptContext);
    if (replay && !prior) return;
    if (!prior && (!checkInput || !canProceed || holdExpired)) return;
    const attempt = prior ?? attempts.begin(attemptContext, () => {
      const usable = hold.kind === 'held' && !holdExpired && hold.key === holdKey ? hold.token : undefined;
      return { ...checkInput!, ...(cleanReason ? { overrideReason: cleanReason } : {}), ...(usable ? { holdToken: usable } : {}) };
    });
    submittingRef.current = true; setSubmitting(true); setSubmitErr(null); setLocalSubmitError(null);
    try {
      const input = { ...attempt.payload, clientOpId: attempt.clientOpId };
      const a = await (local ? saveLocalBooking(input) : api.create(input));
      attempts.clear(); holdRef.current = null;
      if (!local) window.dispatchEvent(new CustomEvent(APPOINTMENTS_CHANGED, { detail: { kind: 'created', appointment: a, simulated: api.mode === 'fixture' } }));
      void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('/api/appointments') });
      onClose(a);
    } catch (e) {
      if (local) {
        // Nothing persisted: preserve all fields and the stable retry attempt.
        setLocalSubmitError(localBookingErrorKey(e));
        return;
      }
      const f = classifyError(e);
      setSubmitErr(f);
      if (f.kind === 'conflict' || f.kind === 'validation' || f.kind === 'auth') {
        attempts.clear(); releaseHold(); setHold({ kind: 'none' });
        if (f.kind === 'conflict') { openConflictsOnResult.current = true; setCheckNonce((n) => n + 1); setStage(1); }
      }
    } finally { submittingRef.current = false; setSubmitting(false); }
  };
  const close = () => { if (submittingRef.current) return; releaseHold(); onClose(null); };

  // Quick walk-in tap 3: sets the exact server slot, then the normal check -> hold -> create
  // pipeline runs. Any conflict, warning, failed check or failed hold stops and hands the user
  // the existing conflict dialog / confirm step. Nothing is acknowledged on the user's behalf.
  const quickBook = (s: AvailabilitySlot, docName: string) => {
    if (!patient || submitting) return;
    setDoctorId(s.doctorId); setExact({ startsAt: s.startsAt, endsAt: s.endsAt }); setDate(localDateOf(s.startsAt)); setTime(localTimeOf(s.startsAt)); setDuration(minutesBetween(s.startsAt, s.endsAt));
    const key = stableKey({ clinicId: clinic.id, doctorId: s.doctorId, patientId: patient.id, startsAt: s.startsAt, endsAt: s.endsAt, source });
    setAuto({ key, label: t('rx.quick.committing', { doctor: '\u2068' + docName + '\u2069', time: formatTime(s.startsAt, locale, dp) }) });
    setStage(2);
  };
  useEffect(() => {
    if (!auto || checkKey !== auto.key) return;
    if (check.kind === 'error') { setAuto(null); return; }
    if (preview && !canProceed) { setAuto(null); setStage(1); if (preview.conflicts.length) setConflictOpen(true); return; }
    if (preview && summary?.warnings.length) { setAuto(null); setStage(1); setConflictOpen(true); return; }
    if (hold.kind === 'failed') { setAuto(null); return; }
    if (hold.kind === 'held' && hold.key === holdKey && !holdExpired && !submittingRef.current) { setAuto(null); void submit(false); }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const next = () => setStage((s) => (s === 0 && patient ? 1 : s === 1 && canProceed ? 2 : s));
  const back = () => { setAuto(null); setStage((s) => (s > 0 ? ((s - 1) as Stage) : s)); };
  const Icon = walkIn ? DoorOpen : PhoneCall;
  const quick = !local && walkIn && !!availability;
  const steps = ['patient', 'slot', 'confirm'] as const;
  const reasonError = summary?.overrideable && ack && reasonTouched && !reason.trim();
  const durations = DURATIONS.includes(duration) ? DURATIONS : [...DURATIONS, duration].sort((a, b) => a - b);

  const checkPanel = () => {
    if (!checkKey) return <Msg tone="muted" icon={Info} testId="status-check-incomplete">{t('bk.check.incomplete')}</Msg>;
    if (check.kind === 'checking' || (check.kind === 'done' && check.key !== checkKey)) return <Msg tone="muted" icon={Loader2} testId="status-check-checking">{t('bk.check.checking')}</Msg>;
    if (check.kind === 'error') return (
      <Msg tone="block" icon={AlertTriangle} testId="status-check-error">{local ? t(check.localKey ?? 'notReady', { ns: 'localBooking' }) : t('bk.check.error')}
        <button type="button" className="bk-btn bk-btn--sm" onClick={() => setCheckNonce((n) => n + 1)} data-testid="button-check-retry"><RotateCcw size={16} aria-hidden="true" />{t('bk.check.retry')}</button>
      </Msg>);
    if (!summary) return null;
    const review = summary.blocking.length + summary.warnings.length + summary.info.length > 0 && (
      <button type="button" className="bk-btn bk-btn--sm" onClick={() => setConflictOpen(true)} data-testid="button-review-conflicts">{t('bk.check.review')}</button>);
    if (summary.blocking.length) return <Msg tone="block" icon={Ban} testId="status-check-blocked">{t('bk.check.blocked')}{review}</Msg>;
    if (summary.warnings.length) return <Msg tone="warn" icon={TriangleAlert} testId="status-check-warning">{t('bk.check.warn')}{cleanReason && <span className="bk-hint">{t('bk.confirm.reason')}: <bdi dir="auto">{cleanReason}</bdi></span>}{review}</Msg>;
    if (summary.info.length) return <Msg tone="info" icon={Info} testId="status-check-info">{t('bk.check.okInfo')}{review}</Msg>;
    return <Msg tone="ok" icon={CheckCircle2} testId="status-check-ok">{t(local ? 'localBookingUi.checked' : 'bk.check.ok')}</Msg>;
  };

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="bk-overlay" />
        <Dialog.Content className="bk-drawer" onCloseAutoFocus={(e) => e.preventDefault()} data-testid="drawer-booking" data-source={source} aria-describedby="bk-stage-desc"
          onInteractOutside={(e) => { if (submitting) e.preventDefault(); }} onEscapeKeyDown={(e) => { if (submitting) e.preventDefault(); }}>
          <div className="bk-head">
            <div className="bk-head__txt">
              <p className="bk-eyebrow"><bdi>{clinic.name}</bdi> · {walkIn ? t('bk.srcWalkIn') : t('bk.srcPhone')}</p>
              <Dialog.Title className="bk-title"><Icon size={26} aria-hidden="true" />{walkIn ? t('bk.walkInTitle') : title}</Dialog.Title>
            </div>
            {!walkIn && !submitting && <WalkInHandoff testId="button-drawer-walkin" context={{ clinicId: clinic.id, patient, doctorId }} />}
            <Dialog.Close className="bk-x" aria-label={t('bk.close')} disabled={submitting} data-testid="button-close-booking"><X size={22} aria-hidden="true" /></Dialog.Close>
          </div>
          <ol className="bk-steps" aria-label={t('bk.stepsLabel')}>
            {steps.map((s, i) => (
              <li key={s} className={'bk-step' + (i === stage ? ' is-current' : i < stage ? ' is-done' : '')} aria-current={i === stage ? 'step' : undefined}>
                <span className="bk-step__n" aria-hidden="true">{i < stage ? <CheckCircle2 size={16} /> : i + 1}</span>
                <span className="bk-step__label">{t(`bk.steps.${s}`)}</span>
              </li>
            ))}
          </ol>
          <div className="bk-body">
            <p id="bk-stage-desc" className="bk-sr">{t('bk.stepOf', { n: stage + 1 })}</p>
            {patients.mode === 'fixture' && <p className="bk-fixture" data-testid="status-fixture-patients"><FlaskConical size={16} aria-hidden="true" />{t('bk.fixture.patients')}</p>}
            {api.mode === 'fixture' && <p className="bk-fixture" data-testid="status-fixture-writes"><FlaskConical size={16} aria-hidden="true" />{t('bk.fixture.writes')}</p>}
            {local && <Msg tone="info" icon={Info} testId="status-local-booking-note">{t('localBookingUi.explanation')}</Msg>}
            {local && cache.kind === 'loading' && <Msg tone="muted" icon={Loader2} testId="status-booking-cache-loading">{t('localBookingUi.loading')}</Msg>}
            {local && cache.kind === 'error' && <Msg tone="block" icon={AlertTriangle} testId="status-booking-cache-error">
              {t('localBookingUi.notReady')} {cache.key && t(cache.key, { ns: 'localBooking' })}
              <button type="button" className="bk-btn bk-btn--sm" onClick={() => setCacheNonce((n) => n + 1)}>{t('bk.search.retry')}</button>
            </Msg>}
            {local && cache.kind === 'ready' && cache.snapshot.metadata && <div className="bk-hint" data-testid="text-booking-cache-coverage">
              <p>{t('localBookingUi.coverage', {
                from: formatLocalDate(localDateOf(cache.snapshot.metadata.coverageStartUtc), locale, dp),
                to: formatLocalDate(localDateOf(new Date(Date.parse(cache.snapshot.metadata.coverageEndUtc) - 1).toISOString()), locale, dp),
                refreshed: `${formatLocalDate(localDateOf(cache.snapshot.metadata.refreshedAt), locale, dp)} ${formatTime(cache.snapshot.metadata.refreshedAt, locale, dp)}`,
              })}</p>
              {cache.refreshFailed && <p role="status">{t('localBookingUi.refreshFailed')}</p>}
            </div>}
            <h2 ref={headingRef} tabIndex={-1} className="bk-stage-title" data-testid="text-stage-title">{t(`bk.steps.${steps[stage]}`)}</h2>

            <fieldset className="bk-fields" disabled={submitting || (local && cache.kind !== 'ready')}>
            {stage === 0 && (!local || cache.kind === 'ready') && (patient ? (
              <div className="bk-field">
                <div className="bk-chosen" data-testid="card-selected-patient">
                  <span className="bk-opt__av" aria-hidden="true"><UserRound size={20} /></span>
                  <span className="bk-opt__main"><span className="bk-hint">{t('bk.search.selected')}</span><bdi className="bk-opt__name" dir="auto">{patient.name}</bdi>
                    <span className="bk-opt__meta">{patient.phone && <bdi dir="ltr">{patient.phone}</bdi>}<span>{t('bk.search.id', { id: patient.id })}</span></span></span>
                </div>
                <button type="button" className="bk-btn bk-btn--sm" onClick={() => { setAuto(null); setPatient(null); }} data-testid="button-change-patient">{t('bk.search.change')}</button>
                {quick && <QuickSlots clinicId={clinic.id} clinicName={clinic.name} patient={patient} doctors={doctors.list} doctorsKind={doctors.kind} onDoctorsRetry={() => setDocNonce((n) => n + 1)}
                  availability={availability!} preferDoctorId={preferDoctorId} busy={submitting || !!auto} onBook={quickBook} onOther={() => setStage(1)} />}
              </div>
            ) : <PatientQuickSearch adapter={readPatients} clinicId={clinic.id} autoFocus paginate onSelect={(p) => { setPatient(p); if (!quick) setStage(1); }} />)}

            {stage === 1 && <>
              <div className="bk-field">
                <label className="bk-label" htmlFor="bk-doctor">{t('bk.slot.doctor')}</label>
                <select id="bk-doctor" className="bk-input" value={doctorId ?? ''} disabled={doctors.kind !== 'ok' || !doctors.list.length}
                  onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : null)} data-testid="select-booking-doctor">
                  <option value="">{doctors.kind === 'loading' ? t('bk.slot.doctorsLoading') : t('bk.slot.chooseDoctor')}</option>
                  {doctors.list.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                {doctors.kind === 'error' && <Msg tone="block" icon={AlertTriangle} testId="status-doctors-error">{t('bk.slot.doctorsError')}
                  <button type="button" className="bk-btn bk-btn--sm" onClick={() => setDocNonce((n) => n + 1)} data-testid="button-doctors-retry"><RotateCcw size={16} aria-hidden="true" />{t('bk.search.retry')}</button></Msg>}
                {doctors.kind === 'ok' && !doctors.list.length && <p className="bk-hint">{t('bk.slot.noDoctors')}</p>}
              </div>
              <div className="bk-row">
                <div className="bk-field"><label className="bk-label" htmlFor="bk-date">{t('bk.slot.date')}</label>
                  <input id="bk-date" type="date" className="bk-input" value={date} onChange={(e) => { setExact(null); setDate(e.target.value); }} aria-invalid={!interval.ok && interval.error === 'invalid'} data-testid="input-booking-date" /></div>
                <div className="bk-field"><label className="bk-label" htmlFor="bk-time">{t('bk.slot.time')}</label>
                  <input id="bk-time" type="time" step={300} className="bk-input" value={time} onChange={(e) => { setExact(null); setTime(e.target.value); }} aria-invalid={!interval.ok && !!time} data-testid="input-booking-time" /></div>
                <div className="bk-field"><label className="bk-label" htmlFor="bk-dur">{t('bk.slot.duration')}</label>
                  <select id="bk-dur" className="bk-input" value={duration} onChange={(e) => { setExact((x) => (x ? { startsAt: x.startsAt } : x)); setDuration(Number(e.target.value)); }} data-testid="select-booking-duration">
                    {durations.map((d) => <option key={d} value={d}>{t('bk.slot.minutes', { n: d })}</option>)}
                  </select></div>
              </div>
              <p className="bk-hint">{t('bk.slot.localNote')}</p>
              {!interval.ok && (time || interval.error !== 'invalid') && <p className="bk-err" role="alert" data-testid="text-interval-error">{t(`bk.slot.err.${interval.error}`)}</p>}
              {interval.ok && interval.ambiguous && <Msg tone="warn" icon={TriangleAlert} testId="status-dst-ambiguous">{t('bk.slot.ambiguous')}</Msg>}
              <div aria-live="polite">{checkPanel()}</div>
            </>}

            {stage === 2 && patient && interval.ok && <>
              <dl className="bk-review" data-testid="booking-review">
                <dt>{t('bk.confirm.patient')}</dt><dd><bdi dir="auto">{patient.name}</bdi> <span className="bk-hint">{t('bk.search.id', { id: patient.id })}</span></dd>
                <dt>{t('bk.confirm.clinic')}</dt><dd><bdi>{clinic.name}</bdi></dd>
                <dt>{t('bk.confirm.doctor')}</dt><dd><bdi dir="auto">{doctorName}</bdi></dd>
                <dt>{t('bk.confirm.when')}</dt><dd data-testid="text-review-when">{formatLocalDate(localDateOf(interval.startsAt), locale, dp)} · <bdi>{formatTime(interval.startsAt, locale, dp)}–{formatTime(interval.endsAt, locale, dp)}</bdi></dd>
                <dt>{t('bk.confirm.source')}</dt><dd>{walkIn ? t('bk.srcWalkIn') : t('bk.srcPhone')}</dd>
                {cleanReason && <><dt>{t('bk.confirm.reason')}</dt><dd><bdi dir="auto">{cleanReason}</bdi></dd></>}
              </dl>
              <div aria-live="polite">
                {auto && <Msg tone="muted" icon={Loader2} testId="status-quick-committing">{auto.label}</Msg>}
                {!canProceed ? checkPanel()
                  : local ? <Msg tone="info" icon={Info} testId="status-local-no-hold">{t('localBookingUi.noHold')}</Msg>
                  : hold.kind === 'getting' ? <Msg tone="muted" icon={Loader2} testId="status-hold-getting">{t('bk.confirm.holdGetting')}</Msg>
                  : hold.kind === 'held' && !holdExpired ? (
                    <div className="bk-msg bk-msg--ok bk-hold" data-testid="status-hold-active">
                      <span className={'bk-hold__ring' + (remaining <= 10 ? ' is-low' : '')} aria-hidden="true">{remaining}</span>
                      <div className="bk-msg__body"><p>{t('bk.confirm.held', { s: remaining })}</p><p data-testid="text-hold-expiry">{t('bk.confirm.heldUntil', { t: formatExpiry(hold.expiresAt, dp) })}</p><p className="bk-hint">{t('bk.confirm.heldNote')}</p></div>
                    </div>)
                  : holdExpired ? <Msg tone="warn" icon={TriangleAlert} testId="status-hold-expired">{t('bk.confirm.expired')}
                      <button type="button" className="bk-btn bk-btn--sm" onClick={() => setCheckNonce((n) => n + 1)} data-testid="button-hold-again"><RotateCcw size={16} aria-hidden="true" />{t('bk.confirm.holdAgain')}</button></Msg>
                  : hold.kind === 'failed' ? <Msg tone={hold.failure === 'conflict' ? 'block' : 'warn'} icon={AlertTriangle} testId="status-hold-failed">{t('bk.confirm.holdFailed')}{hold.failure !== 'conflict' && <span className="bk-hint">{t('bk.confirm.noHold')}</span>}</Msg>
                  : null}
              </div>
            </>}
            </fieldset>
            {localSubmitError && <div className="bk-msg bk-msg--block" role="alert" data-testid="status-local-submit-error">
              <AlertTriangle size={20} aria-hidden="true" /><div className="bk-msg__body">
                <p>{t('localBookingUi.notSaved')} {t(localSubmitError, { ns: 'localBooking' })}</p>
              </div>
            </div>}
            {submitErr && (
              <div className="bk-msg bk-msg--block" role="alert" data-testid="status-submit-error">
                <AlertTriangle size={20} aria-hidden="true" />
                <div className="bk-msg__body"><p>{t(`bk.result.${submitErr.kind === 'unavailable' ? 'server' : submitErr.kind}`, { code: submitErr.code ?? submitErr.status ?? '—' })}</p>
                  {(submitErr.kind === 'network' || submitErr.kind === 'server' || submitErr.kind === 'unavailable') && stage === 2 &&
                    <button type="button" className="bk-btn bk-btn--sm" onClick={() => void submit(true)} disabled={submitting} data-testid="button-submit-retry"><RotateCcw size={16} aria-hidden="true" />{t('bk.result.retry')}</button>}
                </div>
              </div>
            )}
          </div>
          <footer className="bk-foot">
            {stage > 0 && <button type="button" className="bk-btn" onClick={back} disabled={submitting} data-testid="button-stage-back"><ArrowLeft size={18} className="bk-flip" aria-hidden="true" />{t('bk.back')}</button>}
            <span className="bk-foot__spacer" />
            {stage < 2 && <button type="button" className="bk-btn bk-btn--primary" onClick={next} disabled={submitting || (local && cache.kind !== 'ready') || (stage === 0 ? !patient : !canProceed)} data-testid="button-stage-next">{t('bk.next')}<ArrowRight size={18} className="bk-flip" aria-hidden="true" /></button>}
            {stage === 2 && <button type="button" className="bk-btn bk-btn--primary" onClick={() => void submit(false)}
              disabled={submitting || !canProceed || hold.kind === 'getting' || holdExpired || (hold.kind === 'failed' && hold.failure === 'conflict')} aria-busy={submitting} data-testid="button-confirm-booking">
               {submitting ? <><Loader2 size={18} aria-hidden="true" />{t(local ? 'localBookingUi.saving' : 'bk.confirm.submitting')}</> : <><CheckCircle2 size={18} aria-hidden="true" />{t(local ? 'localBookingUi.save' : 'bk.confirm.submit')}</>}
            </button>}
          </footer>
          {preview && interval.ok && (
            <ConflictDialog open={conflictOpen} onOpenChange={setConflictOpen} preview={preview} clinicId={clinic.id} doctorName={doctorName}
              whenLabel={whenLabel} formatSlot={fmtSlot} ack={ack} onAck={setAck} reason={reason}
              onReason={(v) => { setReason(v); setReasonTouched(true); }} reasonError={!!reasonError} onPick={pickSlot} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Msg({ tone, icon: I, testId, children }: { tone: 'ok' | 'info' | 'warn' | 'block' | 'muted'; icon: typeof Info; testId: string; children: ReactNode }) {
  return <div className={`bk-msg bk-msg--${tone}`} data-testid={testId}><I size={20} aria-hidden="true" /><div className="bk-msg__body">{children}</div></div>;
}

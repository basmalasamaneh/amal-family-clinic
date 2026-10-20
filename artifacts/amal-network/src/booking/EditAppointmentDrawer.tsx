import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Ban, CalendarClock, CheckCircle2, Info, Loader2, Lock, RotateCcw, TriangleAlert, WifiOff, X } from 'lucide-react';
import type { Appointment, AppointmentUpdate, ConflictItemSuggestedSlotsItem, ConflictPreview } from '@workspace/api-client-react';
import { useAmalPreferences } from '@workspace/amal-ui';
import type { CalendarAppointment } from '@/calendar/adapter';
import { realSchedulingAdapter } from '@/calendar/adapter';
import { formatLocalDate, formatTime, localDateOf } from '@/calendar/dates';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { ConflictDialog } from './ConflictDialog';
import { commitAllowed, summarize } from './conflicts';
import { createLatest, newOpId, stableKey } from './ops';
import { classifyError, isAbort, type Failure, type FailureKind } from './errors';
import { effectiveInterval, localTimeOf, minutesBetween, type ExactSlot } from './time';
import { APPOINTMENTS_CHANGED, CHECK_DEBOUNCE_MS } from './BookingDrawer';
import { checkSourceOf, isEditableStatus, isVersionConflict, realEditApi, type EditApi } from './edit-api';
import './i18n';
import './edit-strings';
import './booking.css';
import './edit.css';

const DURATIONS = [10, 15, 20, 30, 45, 60, 90];
type Live = { kind: 'loading' } | { kind: 'error' } | { kind: 'missing' } | { kind: 'ok'; appt: Appointment };
type Check = { kind: 'idle' } | { kind: 'checking'; key: string } | { kind: 'done'; key: string; preview: ConflictPreview } | { kind: 'error'; key: string; failure: FailureKind; code: string | null };
type Hold = { kind: 'none' } | { kind: 'held'; key: string; token: string; expiresAt: string };
type Sent = { clientOpId: string; payload: AppointmentUpdate };

export interface EditAppointmentDrawerProps {
  target: CalendarAppointment; clinicName: string;
  onClose: (updated: Appointment | null) => void;
  api?: EditApi;
}

export function EditAppointmentDrawer({ target, clinicName, onClose, api = realEditApi }: EditAppointmentDrawerProps) {
  const { t } = useTranslation();
  const { locale, digitPreference: dp } = useAmalPreferences();
  const qc = useQueryClient();
  const online = useOnlineStatus();
  const apiRef = useRef(api); apiRef.current = api;

  const [live, setLive] = useState<Live>({ kind: 'loading' });
  const [loadNonce, setLoadNonce] = useState(0);
  const [doctorName, setDoctorName] = useState<string | null>(null);
  const [date, setDate] = useState(''); const [time, setTime] = useState(''); const [duration, setDuration] = useState(30);
  const [exact, setExact] = useState<ExactSlot | null>(null);
  const [check, setCheck] = useState<Check>({ kind: 'idle' });
  const [checkNonce, setCheckNonce] = useState(0);
  const [ack, setAck] = useState(false); const [reason, setReason] = useState(''); const [reasonTouched, setReasonTouched] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [hold, setHold] = useState<Hold>({ kind: 'none' });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<Failure | null>(null);
  const [stale, setStale] = useState(false);
  const [authLost, setAuthLost] = useState(false);
  const [uncertain, setUncertain] = useState<Sent | null>(null);
  const [note, setNote] = useState<{ kind: 'reloaded'; v: number } | null>(null);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const initialized = useRef(false);
  const keepForm = useRef(false);
  const submittingRef = useRef(false);
  const holdRef = useRef<string | null>(null);
  /** Hold token carried by an in-flight/uncertain PATCH: never released until a definitive response. */
  const pendingHoldRef = useRef<string | null>(null);
  const checkSeq = useRef(createLatest()).current;
  const holdSeq = useRef(createLatest()).current;

  // Authoritative live row (no fixture fallback). On first load it pre-fills the form; an explicit
  // reload (stale version) only updates the baseline and keeps the user's proposed time.
  useEffect(() => {
    if (target.version === undefined) { setLive({ kind: 'error' }); return; }
    const ctl = new AbortController();
    setLive({ kind: 'loading' });
    apiRef.current.load({ id: target.id, clinicId: target.clinicId, doctorId: target.doctorId, startsAt: target.startsAt }, ctl.signal).then((a) => {
      if (ctl.signal.aborted) return;
      if (!a) { setLive({ kind: 'missing' }); return; }
      setLive({ kind: 'ok', appt: a });
      if (!initialized.current || !keepForm.current) {
        initialized.current = true;
        setDate(localDateOf(a.startsAt)); setTime(localTimeOf(a.startsAt)); setDuration(minutesBetween(a.startsAt, a.endsAt));
        setExact({ startsAt: a.startsAt, endsAt: a.endsAt });
      }
      else setNote({ kind: 'reloaded', v: a.version });
      keepForm.current = false;
    }, (e) => {
      if (ctl.signal.aborted || isAbort(e)) return;
      if (classifyError(e).kind === 'auth') setAuthLost(true);
      setLive({ kind: 'error' });
    });
    return () => ctl.abort();
  }, [target.id, target.clinicId, target.doctorId, target.startsAt, target.version, loadNonce]);

  useEffect(() => {
    const ctl = new AbortController();
    realSchedulingAdapter.listDoctors(target.clinicId, ctl.signal).then((ds) => { if (!ctl.signal.aborted) setDoctorName(ds.find((d) => d.id === target.doctorId)?.name ?? null); }, () => undefined);
    return () => ctl.abort();
  }, [target.clinicId, target.doctorId]);

  const appt = live.kind === 'ok' ? live.appt : null;
  const previewSource = appt ? checkSourceOf(appt.source) : null;
  const editable = !!appt && isEditableStatus(appt.status) && !!previewSource;
  const interval = useMemo(() => effectiveInterval(exact, date, time, duration), [exact, date, time, duration]);
  const dirty = !!appt && interval.ok && (Date.parse(interval.startsAt) !== Date.parse(appt.startsAt) || Date.parse(interval.endsAt) !== Date.parse(appt.endsAt));
  const checkInput = appt && editable && dirty && interval.ok && previewSource ? {
    clinicId: appt.clinicId, doctorId: appt.doctorId, patientId: appt.patientId, startsAt: interval.startsAt, endsAt: interval.endsAt,
    source: previewSource, appointmentId: appt.id, expectedVersion: appt.version,
  } : null;
  const checkKey = checkInput ? stableKey(checkInput) : null;
  const inputRef = useRef(checkInput); inputRef.current = checkInput;

  useEffect(() => { setAck(false); setReason(''); setReasonTouched(false); setErr(null); }, [checkKey]);

  useEffect(() => {
    const tok = checkSeq.next(); const input = inputRef.current;
    if (!checkKey || !input || stale || !online || authLost) { setCheck({ kind: 'idle' }); return; }
    setCheck({ kind: 'checking', key: checkKey });
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      apiRef.current.check(input, ctl.signal).then(
        (preview) => { if (checkSeq.isCurrent(tok)) setCheck({ kind: 'done', key: checkKey, preview }); },
        (e) => {
          if (isAbort(e) || !checkSeq.isCurrent(tok)) return;
          const f = classifyError(e);
          if (f.kind === 'auth') setAuthLost(true);
          if (f.kind === 'conflict' && isVersionConflict(f.code)) { setStale(true); return; }
          setCheck({ kind: 'error', key: checkKey, failure: f.kind, code: f.code });
        },
      );
    }, CHECK_DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [checkKey, checkNonce, stale, online, authLost, checkSeq]);

  const preview = check.kind === 'done' && check.key === checkKey ? check.preview : null;
  const summary = preview ? summarize(preview) : null;
  const cleanReason = ack ? reason.trim() : '';
  const canProceed = commitAllowed(preview, cleanReason);
  const openOnResult = useRef(false);
  useEffect(() => { if (preview && openOnResult.current) { openOnResult.current = false; if (preview.conflicts.length) setConflictOpen(true); } }, [preview]);

  // Optional soft hold on the proposed slot (includes appointmentId so the own booking is excluded).
  const releaseHold = () => { const tk = holdRef.current; holdRef.current = null; if (tk) apiRef.current.release(tk).catch(() => undefined); };
  const holdKey = canProceed && checkKey && !uncertain && !stale && online && !authLost ? checkKey + '|' + cleanReason : null;
  useEffect(() => {
    releaseHold(); const tok = holdSeq.next(); const input = inputRef.current;
    setHold({ kind: 'none' });
    if (!holdKey || !input) return;
    const { source: _s, expectedVersion: _v, ...rest } = input;
    apiRef.current.hold({ ...rest, clientOpId: newOpId(), ...(cleanReason ? { overrideReason: cleanReason } : {}) }).then((h) => {
      if (!holdSeq.isCurrent(tok)) { apiRef.current.release(h.token).catch(() => undefined); return; }
      holdRef.current = h.token; setNow(Date.now()); setHold({ kind: 'held', key: holdKey, token: h.token, expiresAt: h.expiresAt });
    }, (e) => {
      if (!holdSeq.isCurrent(tok)) return;
      const f = classifyError(e);
      if (f.kind === 'auth') setAuthLost(true);
      if (f.kind === 'conflict') { if (isVersionConflict(f.code)) setStale(true); else { openOnResult.current = true; setCheckNonce((n) => n + 1); } }
    });
  }, [holdKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { checkSeq.invalidate(); holdSeq.invalidate(); releaseHold(); if (pendingHoldRef.current) apiRef.current.release(pendingHoldRef.current).catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (hold.kind !== 'held') return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [hold.kind]);
  const remaining = hold.kind === 'held' ? Math.max(0, Math.ceil((Date.parse(hold.expiresAt) - now) / 1000)) : 0;

  const fmtSlot = (s: { startsAt: string; endsAt: string }) => `${formatLocalDate(localDateOf(s.startsAt), locale, dp, 'EEE d MMM')} ${formatTime(s.startsAt, locale, dp)}–${formatTime(s.endsAt, locale, dp)}`;
  const docLabel = doctorName ?? t('calendar.booking.doctorId', { id: target.doctorId });
  const locked = !!uncertain || submitting;

  const finish = (a: Appointment) => {
    holdRef.current = null; pendingHoldRef.current = null; setUncertain(null);
    window.dispatchEvent(new CustomEvent(APPOINTMENTS_CHANGED, { detail: { kind: 'updated', appointment: a } }));
    void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('/api/appointments') });
    onClose(a);
  };

  const send = async (sent: Sent) => {
    if (submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true); setErr(null); setNote(null); setCloseBlocked(false);
    if (sent.payload.holdToken) { pendingHoldRef.current = sent.payload.holdToken; if (holdRef.current === sent.payload.holdToken) holdRef.current = null; }
    try {
      finish(await apiRef.current.update(target.id, sent.payload));
    } catch (e) {
      const f = classifyError(e);
      if (f.kind === 'network' || f.kind === 'server' || (f.kind === 'unavailable' && f.status !== 404)) {
        setUncertain(sent); setErr(f);
      } else {
        setUncertain(null); releaseHold(); setHold({ kind: 'none' });
        const ph = pendingHoldRef.current; pendingHoldRef.current = null; if (ph) apiRef.current.release(ph).catch(() => undefined);
        if (f.kind === 'auth') setAuthLost(true);
        if (f.kind === 'conflict' && isVersionConflict(f.code)) setStale(true);
        else { setErr(f); if (f.kind === 'conflict') { openOnResult.current = true; setCheckNonce((n) => n + 1); } }
      }
    } finally { submittingRef.current = false; setSubmitting(false); }
  };

  const save = () => {
    if (!appt || !interval.ok || !canProceed || !online || authLost || stale || uncertain || submittingRef.current) return;
    const usable = hold.kind === 'held' && hold.key === holdKey && remaining > 0 ? hold.token : undefined;
    const clientOpId = newOpId();
    // clientOpId is bound into the payload once, so a retry of an uncertain attempt is byte-identical.
    void send({ clientOpId, payload: {
      clientOpId, expectedVersion: appt.version, startsAt: interval.startsAt, endsAt: interval.endsAt,
      ...(cleanReason ? { overrideReason: cleanReason } : {}), ...(usable ? { holdToken: usable } : {}),
    } });
  };

  const reloadLatest = () => { keepForm.current = true; setStale(false); setErr(null); setLoadNonce((n) => n + 1); };

  const requestClose = () => {
    if (submittingRef.current) return;
    if (uncertain) { setCloseBlocked(true); return; }
    releaseHold(); onClose(null);
  };
  const pickSlot = (s: ConflictItemSuggestedSlotsItem) => {
    if (locked) return;
    setExact({ startsAt: s.startsAt, endsAt: s.endsAt }); setDate(localDateOf(s.startsAt)); setTime(localTimeOf(s.startsAt)); setDuration(minutesBetween(s.startsAt, s.endsAt));
    setConflictOpen(false);
  };
  const durations = DURATIONS.includes(duration) ? DURATIONS : [...DURATIONS, duration].sort((a, b) => a - b);
  const reasonError = !!summary?.overrideable && ack && reasonTouched && !reason.trim();

  const checkPanel = () => {
    if (!appt || !editable) return null;
    if (!dirty) return <Msg tone="muted" icon={Info} testId="status-edit-unchanged">{t('ed.unchanged')}</Msg>;
    if (!checkKey) return null;
    if (check.kind === 'checking' || (check.kind === 'done' && check.key !== checkKey) || check.kind === 'idle') return <Msg tone="muted" icon={Loader2} testId="status-check-checking">{t('bk.check.checking')}</Msg>;
    if (check.kind === 'error') return <Msg tone="block" icon={AlertTriangle} testId="status-check-error">{t('bk.check.error')}
      <button type="button" className="bk-btn bk-btn--sm" onClick={() => setCheckNonce((n) => n + 1)} data-testid="button-check-retry"><RotateCcw size={16} aria-hidden="true" />{t('bk.check.retry')}</button></Msg>;
    if (!summary) return null;
    const review = summary.blocking.length + summary.warnings.length + summary.info.length > 0 &&
      <button type="button" className="bk-btn bk-btn--sm" onClick={() => setConflictOpen(true)} data-testid="button-review-conflicts">{t('bk.check.review')}</button>;
    if (summary.blocking.length) return <Msg tone="block" icon={Ban} testId="status-check-blocked">{t('bk.check.blocked')}{review}</Msg>;
    if (summary.warnings.length) return <Msg tone="warn" icon={TriangleAlert} testId="status-check-warning">{t('bk.check.warn')}{cleanReason && <span className="bk-hint">{t('bk.confirm.reason')}: <bdi dir="auto">{cleanReason}</bdi></span>}{review}</Msg>;
    if (summary.info.length) return <Msg tone="info" icon={Info} testId="status-check-info">{t('bk.check.okInfo')}{review}</Msg>;
    return <Msg tone="ok" icon={CheckCircle2} testId="status-check-ok">{t('bk.check.ok')}</Msg>;
  };

  const canSave = !!appt && editable && dirty && canProceed && online && !authLost && !stale && !uncertain && !submitting;

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="bk-overlay" />
        <Dialog.Content className="bk-drawer" data-testid="drawer-edit-appointment" aria-describedby={undefined} onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => { if (submitting || uncertain) { e.preventDefault(); if (uncertain) setCloseBlocked(true); } }}
          onEscapeKeyDown={(e) => { if (submitting || uncertain) { e.preventDefault(); if (uncertain) setCloseBlocked(true); } }}>
          <header className="bk-head">
            <div className="bk-head__txt">
              <p className="bk-eyebrow"><bdi>{clinicName}</bdi> · {t('ed.eyebrow', { id: target.id })}</p>
              <Dialog.Title className="bk-title"><CalendarClock size={26} aria-hidden="true" />{t('ed.title')}</Dialog.Title>
            </div>
            <button type="button" className="bk-x" aria-label={t('ed.close')} disabled={submitting} onClick={requestClose} data-testid="button-close-edit"><X size={22} aria-hidden="true" /></button>
          </header>
          <div className="bk-body">
            {!online && <Msg tone="warn" icon={WifiOff} testId="status-edit-offline">{t('ed.offline')}</Msg>}
            {authLost && <Msg tone="block" icon={Lock} testId="status-edit-auth">{t('ed.authLost')}</Msg>}
            {target.version === undefined ? <Msg tone="muted" icon={Info} testId="status-edit-fixture">{t('ed.fixture')}</Msg>
            : live.kind === 'loading' && !initialized.current ? <div aria-busy="true" data-testid="status-edit-loading"><p className="bk-sr">{t('ed.loading')}</p><div className="bk-skel" /><div className="bk-skel" /><div className="bk-skel" /></div>
            : live.kind === 'error' ? <Msg tone="block" icon={AlertTriangle} testId="status-edit-load-error">{t('ed.loadError')}
                <button type="button" className="bk-btn bk-btn--sm" onClick={() => setLoadNonce((n) => n + 1)} data-testid="button-edit-reload"><RotateCcw size={16} aria-hidden="true" />{t('ed.reload')}</button></Msg>
            : live.kind === 'missing' ? <Msg tone="block" icon={AlertTriangle} testId="status-edit-missing">{t('ed.missing')}</Msg>
            : appt && <>
              <p className="ed-fixed__cap"><Lock size={14} aria-hidden="true" />{t('ed.fixed')}</p>
              <dl className="ed-fixed" data-testid="section-edit-fixed">
                <dt>{t('ed.patient')}</dt><dd data-testid="text-edit-patient"><bdi dir="auto">{target.patientName ?? t('ed.patientId', { id: appt.patientId })}</bdi></dd>
                <dt>{t('ed.doctor')}</dt><dd data-testid="text-edit-doctor"><bdi dir="auto">{docLabel}</bdi></dd>
                <dt>{t('ed.clinic')}</dt><dd data-testid="text-edit-clinic"><bdi>{clinicName}</bdi></dd>
                <dt>{t('ed.source')}</dt><dd data-testid="text-edit-source">{t(`ed.sources.${['phone', 'walk-in', 'online', 'import', 'calendar_app', 'in_person'].includes(appt.source) ? appt.source : 'unknown'}`)} <span className="bk-hint" data-testid="text-edit-version">{t('ed.version', { v: appt.version })}</span></dd>
              </dl>
              {!isEditableStatus(appt.status) ? <Msg tone="block" icon={Ban} testId="status-edit-not-editable">{t('ed.notEditable', { status: appt.status })}</Msg>
              : !previewSource ? <Msg tone="block" icon={Ban} testId="status-edit-source-unsupported">{t('ed.sourceUnsupported')}</Msg>
              : <>
                <div className={'bk-row' + (locked ? ' ed-locked' : '')}>
                  <div className="bk-field"><label className="bk-label" htmlFor="ed-date">{t('bk.slot.date')}</label>
                    <input id="ed-date" type="date" className="bk-input" value={date} disabled={locked} aria-invalid={!interval.ok} aria-describedby={!interval.ok ? 'ed-interval-error' : undefined} onChange={(e) => { setExact(null); setDate(e.target.value); }} data-testid="input-edit-date" /></div>
                  <div className="bk-field"><label className="bk-label" htmlFor="ed-time">{t('bk.slot.time')}</label>
                    <input id="ed-time" type="time" step={300} className="bk-input" value={time} disabled={locked} onChange={(e) => { setExact(null); setTime(e.target.value); }} aria-invalid={!interval.ok} aria-describedby={!interval.ok ? 'ed-interval-error' : undefined} data-testid="input-edit-time" /></div>
                  <div className="bk-field"><label className="bk-label" htmlFor="ed-dur">{t('bk.slot.duration')}</label>
                    <select id="ed-dur" className="bk-input" value={duration} disabled={locked} onChange={(e) => { setExact((x) => (x ? { startsAt: x.startsAt } : x)); setDuration(Number(e.target.value)); }} data-testid="select-edit-duration">
                      {durations.map((d) => <option key={d} value={d}>{t('bk.slot.minutes', { n: d })}</option>)}
                    </select></div>
                </div>
                <p className="bk-hint">{t('bk.slot.localNote')}</p>
                {!interval.ok && <p id="ed-interval-error" className="bk-err" role="alert" data-testid="text-edit-interval-error">{t(`bk.slot.err.${interval.error}`)}</p>}
                {interval.ok && interval.ambiguous && <Msg tone="warn" icon={TriangleAlert} testId="status-dst-ambiguous">{t('bk.slot.ambiguous')}</Msg>}
                <div className="ed-compare">
                  <div className="ed-compare__cell"><span className="bk-hint">{t('ed.current')}</span><p data-testid="text-edit-current">{fmtSlot(appt)}</p></div>
                  <ArrowRight className="ed-compare__arrow" size={20} aria-hidden="true" />
                  <div className={'ed-compare__cell' + (dirty ? ' is-new' : '')}><span className="bk-hint">{t('ed.proposed')}</span><p data-testid="text-edit-proposed">{interval.ok ? fmtSlot(interval) : '—'}</p></div>
                </div>
                <div aria-live="polite">
                  {checkPanel()}
                  {hold.kind === 'held' && remaining > 0 && canProceed && <p className="bk-hint" data-testid="status-edit-hold">{t('ed.holdNote', { s: remaining })}</p>}
                  {note?.kind === 'reloaded' && <Msg tone="info" icon={Info} testId="status-edit-reloaded">{t('ed.reloaded', { v: note.v })}</Msg>}
                </div>
              </>}
            </>}
            {stale && <div className="bk-msg bk-msg--warn" role="alert" data-testid="status-edit-stale"><TriangleAlert size={20} aria-hidden="true" /><div className="bk-msg__body"><p>{t('ed.stale')}</p>
              <button type="button" className="bk-btn bk-btn--sm" onClick={reloadLatest} disabled={!online} data-testid="button-edit-stale-reload"><RotateCcw size={16} aria-hidden="true" />{t('ed.staleReload')}</button></div></div>}
            {uncertain && <div className="bk-msg bk-msg--warn" role="alert" data-testid="status-edit-uncertain"><AlertTriangle size={20} aria-hidden="true" /><div className="bk-msg__body">
              <p>{t('ed.uncertain')}</p>
              {closeBlocked && <p className="bk-err" data-testid="text-edit-close-blocked">{t('ed.uncertainClose')}</p>}
              <div className="ed-actions">
                <button type="button" className="bk-btn bk-btn--sm" onClick={() => void send(uncertain)} disabled={submitting || !online || authLost} data-testid="button-edit-retry-same"><RotateCcw size={16} aria-hidden="true" />{t('ed.uncertainRetry')}</button>
              </div></div></div>}
            {err && !uncertain && <div className="bk-msg bk-msg--block" role="alert" data-testid="status-edit-rejected"><AlertTriangle size={20} aria-hidden="true" /><div className="bk-msg__body">
              <p>{err.kind === 'conflict' || err.kind === 'validation' ? t('ed.rejected') : t(`bk.result.${err.kind === 'unavailable' ? 'server' : err.kind}`, { code: err.code ?? err.status ?? '—' })}</p></div></div>}
          </div>
          <footer className="bk-foot">
            <button type="button" className="bk-btn" onClick={requestClose} disabled={submitting} data-testid="button-edit-cancel">{t('ed.close')}</button>
            <span className="bk-foot__spacer" />
            <button type="button" className="bk-btn bk-btn--primary" onClick={save} disabled={!canSave} aria-busy={submitting} data-testid="button-edit-save">
              {submitting ? <><Loader2 size={18} aria-hidden="true" />{t('ed.saving')}</> : <><CheckCircle2 size={18} aria-hidden="true" />{t('ed.save')}</>}
            </button>
          </footer>
          {preview && interval.ok && <ConflictDialog open={conflictOpen} onOpenChange={setConflictOpen} preview={preview} clinicId={target.clinicId} doctorName={docLabel}
            whenLabel={fmtSlot(interval)} formatSlot={fmtSlot} ack={ack} onAck={setAck} reason={reason}
            onReason={(v) => { setReason(v); setReasonTouched(true); }} reasonError={reasonError} onPick={pickSlot} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Msg({ tone, icon: I, testId, children }: { tone: 'ok' | 'info' | 'warn' | 'block' | 'muted'; icon: typeof Info; testId: string; children: ReactNode }) {
  return <div className={`bk-msg bk-msg--${tone}`} data-testid={testId}><I size={20} aria-hidden="true" /><div className="bk-msg__body">{children}</div></div>;
}

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, DoorOpen, Loader2, RotateCcw, ShieldAlert, UserPlus, X } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { classifyError, type Failure } from '@/booking/errors';
import { newOpId } from '@/booking/ops';
import type { PatientHit } from '@/booking/patients';
import { hebronToday, isMinor } from './age';
import { GUARDIAN_RELATIONS, isUncertain, opFor, reconcileGuardian, settle, validateRegistration, type RegDraft, type RegErrors, type RegField, type RegSession, type NewPatientPayload } from './registration';
import type { ReceptionApi } from './api';

/**
 * Registration dialog. The draft is owned by the parent so a walk-in handoff can close this
 * overlay without losing input. Same payload retries reuse one clientOpId (server replay-safe).
 */
export interface RegStatus { saving: boolean; failure: Failure | null; serverErrors: RegErrors }
export const IDLE_STATUS: RegStatus = { saving: false, failure: null, serverErrors: {} };

/**
 * Starts a save bound to the page-owned session. Results go to `report`, which belongs to the
 * page, so closing the dialog or a Walk-in handoff mid-request never loses the outcome.
 */
export function startSave(api: ReceptionApi, session: RegSession, key: string, payload: NewPatientPayload,
  report: (r: { ok: true; patient: PatientHit } | { ok: false; failure: Failure; data: unknown }) => void): 'started' | 'busy' | 'blocked' {
  if (session.inFlight) return 'busy';
  const clientOpId = opFor(session, key, newOpId);
  if (!clientOpId) return 'blocked';
  session.inFlight = true;
  api.createPatient({ ...payload, clientOpId }).then(
    (patient) => { settle(session, false); report({ ok: true, patient }); },
    (e) => { const failure = classifyError(e); settle(session, isUncertain(failure)); report({ ok: false, failure, data: (e as { data?: unknown })?.data }); },
  );
  return 'started';
}

export function NewPatientDialog({ api, clinicId, draft, onDraft, onClose, onWalkIn, session, status, onSubmit, saveDisabled = false }: {
  api: ReceptionApi; clinicId: number; draft: RegDraft; onDraft: (d: RegDraft) => void;
  onClose: () => void; onWalkIn: (() => void) | null;
  session: RegSession; status: RegStatus; onSubmit: (key: string, payload: NewPatientPayload) => void;
  saveDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const online = useOnlineStatus();
  const [today] = useState(() => hebronToday());
  const [errors, setErrors] = useState<RegErrors>({});
  const [showErrors, setShowErrors] = useState(false);
  const { saving, failure } = status;
  const [cleared, setCleared] = useState(false);
  const onRevert = () => { if (session.snapshot) onDraft(session.snapshot); };
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const minor = isMinor(draft.dob, today);
  const result = useMemo(() => validateRegistration(draft, today), [draft, today]);
  const payloadKey = result.ok ? JSON.stringify({ clinicId, ...result.payload }) : null;
  // An unanswered save pins the payload: a changed form may not be sent until reconciled.
  const changedAfterUncertain = session.pending !== null && !session.inFlight && payloadKey !== session.pending.key;
  useEffect(() => { if (Object.keys(status.serverErrors).length) setErrors((x) => ({ ...x, ...status.serverErrors })); }, [status.serverErrors]);

  const set = (k: RegField, v: string) => {
    const next = reconcileGuardian({ ...draft, [k]: v }, today);
    setCleared(next !== draft && k === 'dob' && (!!draft.guardianName || !!draft.guardianRelation) && !next.guardianName && !next.guardianRelation);
    onDraft(next);
    if (errors[k] === 'server') setErrors((e) => ({ ...e, [k]: undefined }));
  };
  useEffect(() => { if (showErrors && !result.ok) setErrors((e) => ({ ...result.errors, ...Object.fromEntries(Object.entries(e).filter(([, v]) => v === 'server')) })); else if (result.ok) setErrors((e) => Object.fromEntries(Object.entries(e).filter(([, v]) => v === 'server'))); }, [result, showErrors]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (session.inFlight) return;
    setShowErrors(true);
    if (!result.ok) { setErrors(result.errors); setTimeout(() => summaryRef.current?.focus(), 0); return; }
    if (!online || saveDisabled || !payloadKey || changedAfterUncertain) return;
    onSubmit(payloadKey, result.payload);
  };
  const err = (k: RegField) => (errors[k] ? t(`rx.reg.err.${errors[k]}`) : null);
  const field = (k: RegField) => ({ id: `rx-${k}`, 'aria-invalid': !!errors[k], 'aria-describedby': [errors[k] ? `rx-${k}-err` : '', `rx-${k}-hint`].filter(Boolean).join(' ') || undefined });

  const failMsg = failure ? t(`rx.reg.fail.${failure.kind}`, { code: failure.code ?? failure.status ?? '—' }) : null;

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="bk-overlay" />
        <Dialog.Content className="bk-drawer rx-reg" aria-describedby="rx-reg-desc" data-testid="dialog-new-patient"
          onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }} >
          <header className="bk-head">
            <div className="bk-head__txt">
              <p className="bk-eyebrow">{t('rx.eyebrow')}</p>
              <Dialog.Title className="bk-title"><UserPlus size={26} aria-hidden="true" />{t('rx.reg.title')}</Dialog.Title>
            </div>
            {onWalkIn && <button type="button" className="bk-btn bk-btn--sm rx-handoff" onClick={onWalkIn} data-testid="button-reg-walkin"><DoorOpen size={18} aria-hidden="true" />{t('rx.reg.walkInHandoff')}</button>}
            <Dialog.Close className="bk-x" aria-label={t('rx.reg.close')} data-testid="button-reg-close"><X size={22} aria-hidden="true" /></Dialog.Close>
          </header>
          <form className="bk-body" onSubmit={submit} noValidate id="rx-reg-form">
            <p id="rx-reg-desc" className="bk-hint">{t('rx.reg.desc')}</p>
            {api.mode === 'fixture' && <p className="bk-fixture" data-testid="status-fixture-reception">{t('rx.fixture')}</p>}
            {(!online || saveDisabled) && <div className="bk-msg bk-msg--warn" role="status" data-testid="status-reg-offline"><AlertTriangle size={20} aria-hidden="true" /><div className="bk-msg__body"><p>{t('rx.reg.offline')}</p></div></div>}
            <p ref={summaryRef} tabIndex={-1} className="bk-err" role="alert" hidden={!showErrors || result.ok} data-testid="text-reg-summary">{t('rx.reg.summary')}</p>

            <div className="bk-field">
              <label className="bk-label" htmlFor="rx-name">{t('rx.reg.name')}</label>
              <input {...field('name')} className="bk-input" dir="auto" autoComplete="off" autoFocus maxLength={220} value={draft.name} onChange={(e) => set('name', e.target.value)} required data-testid="input-reg-name" />
              {err('name') && <p id="rx-name-err" className="bk-err">{err('name')}</p>}
            </div>
            <div className="bk-row rx-row2">
              <div className="bk-field">
                <label className="bk-label" htmlFor="rx-phone">{t('rx.reg.phone')}</label>
                <input {...field('phone')} className="bk-input" dir="ltr" inputMode="tel" autoComplete="off" maxLength={45} value={draft.phone} onChange={(e) => set('phone', e.target.value)} required data-testid="input-reg-phone" />
                <p id="rx-phone-hint" className="bk-hint">{t('rx.reg.phoneHint')}</p>
                {err('phone') && <p id="rx-phone-err" className="bk-err">{err('phone')}</p>}
              </div>
              <div className="bk-field">
                <label className="bk-label" htmlFor="rx-dob">{t('rx.reg.dob')}</label>
                <input {...field('dob')} type="date" className="bk-input" max={today} min="0001-01-01" value={draft.dob} onChange={(e) => set('dob', e.target.value)} required data-testid="input-reg-dob" />
                <p id="rx-dob-hint" className="bk-hint">{t('rx.reg.dobHint')}</p>
                {err('dob') && <p id="rx-dob-err" className="bk-err">{err('dob')}</p>}
              </div>
            </div>
            <div aria-live="polite">
              {cleared && minor === false && <p className="bk-hint" data-testid="text-guardian-cleared">{t('rx.reg.adultCleared')}</p>}
            </div>
            {minor && (
              <fieldset className="rx-guardian" data-testid="fieldset-guardian">
                <legend className="rx-guardian__legend"><ShieldAlert size={18} aria-hidden="true" />{t('rx.reg.minorNote')}</legend>
                <div className="bk-field">
                  <label className="bk-label" htmlFor="rx-guardianName">{t('rx.reg.guardianName')}</label>
                  <input {...field('guardianName')} className="bk-input" dir="auto" autoComplete="off" maxLength={220} value={draft.guardianName} onChange={(e) => set('guardianName', e.target.value)} required data-testid="input-reg-guardian-name" />
                  {err('guardianName') && <p id="rx-guardianName-err" className="bk-err">{err('guardianName')}</p>}
                </div>
                <div className="bk-field">
                  <label className="bk-label" htmlFor="rx-guardianRelation">{t('rx.reg.guardianRelation')}</label>
                  <select {...field('guardianRelation')} className="bk-input" value={draft.guardianRelation} onChange={(e) => set('guardianRelation', e.target.value)} required data-testid="select-reg-guardian-relation">
                    <option value="">{t('rx.reg.chooseRelation')}</option>
                    {GUARDIAN_RELATIONS.map((r) => <option key={r} value={r}>{t(`rx.reg.rel.${r}`)}</option>)}
                  </select>
                  {err('guardianRelation') && <p id="rx-guardianRelation-err" className="bk-err">{err('guardianRelation')}</p>}
                </div>
              </fieldset>
            )}
            {failMsg && (
              <div className="bk-msg bk-msg--block" role="alert" data-testid="status-reg-error"><AlertTriangle size={20} aria-hidden="true" />
                <div className="bk-msg__body"><p>{failMsg}</p>
                  {changedAfterUncertain && <p className="bk-hint" data-testid="text-reg-changed">{t('rx.reg.changedAfterUncertain')}</p>}
                  {changedAfterUncertain && session.pending && <button type="button" className="bk-btn bk-btn--sm" onClick={onRevert} data-testid="button-reg-revert">{t('rx.reg.revert')}</button>}
                  {failure && isUncertain(failure) && !changedAfterUncertain && <button type="button" className="bk-btn bk-btn--sm" onClick={() => void submit()} disabled={saving || !online || saveDisabled} data-testid="button-reg-retry"><RotateCcw size={16} aria-hidden="true" />{t('rx.reg.retrySame')}</button>}
                </div></div>
            )}
          </form>
          <footer className="bk-foot">
            <button type="button" className="bk-btn" onClick={onClose} data-testid="button-reg-cancel">{t('rx.reg.cancel')}</button>
            <span className="bk-foot__spacer" />
            <button type="submit" form="rx-reg-form" className="bk-btn bk-btn--primary" disabled={saving || !online || saveDisabled || changedAfterUncertain} aria-busy={saving} data-testid="button-reg-save">
              {saving ? <><Loader2 size={18} aria-hidden="true" className="rx-spin" />{t('rx.reg.saving')}</> : <><UserPlus size={18} aria-hidden="true" />{t('rx.reg.save')}</>}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

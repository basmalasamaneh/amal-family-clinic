import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CircleCheckBig, SearchCheck, UserPlus } from 'lucide-react';
import { Button } from '@workspace/amal-ui';
import { useCreateClinic, type AdminClinic } from '@workspace/api-client-react';
import { Confirm, ErrorSummary, Notice, adminWrite, classify, fetchAllClinics, useAlive, useInstant, useOnline, useSharedInvalidate } from './common';
import { ClinicSummary, DetailsFields, EMPTY_DRAFT, ScheduleFields, toPayload, validateDetails, validateSchedule, type ClinicDraft, type FieldErr } from './ClinicForm';

type Step = 0 | 1 | 2 | 3;
const STEP_KEYS = ['details', 'schedule', 'review', 'done'] as const;

interface Ambiguity { startedAt: number; knownIds: number[] | null }

export function AddClinicWizard({ accountKey, knownIds, onClose, onCreated, onAddDoctor }: {
  accountKey: string; knownIds: number[] | null; onClose: () => void; onCreated: () => void | Promise<void>; onAddDoctor: (clinic: AdminClinic) => void;
}) {
  // Account-scoped safety bit only; no form data, clinic names or credentials.
  const marker = `amal.admin.uncertain-clinic:${accountKey}`;
  const { t } = useTranslation();
  const alive = useAlive();
  const online = useOnline();
  const fmt = useInstant();
  const invalidate = useSharedInvalidate();
  const create = useCreateClinic();
  const [step, setStep] = useState<Step>(0);
  const [draft, setDraft] = useState<ClinicDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<FieldErr[]>([]);
  const [server, setServer] = useState<string | null>(null);
  const [created, setCreated] = useState<AdminClinic | null>(null);
  const [ambiguous, setAmbiguous] = useState<Ambiguity | null>(() => {
    try { return sessionStorage.getItem(marker) ? { startedAt: 0, knownIds: null } : null; }
    catch { return { startedAt: 0, knownIds: null }; }
  });
  const [recon, setRecon] = useState<{ state: 'idle' | 'loading' | 'failed' } | { state: 'done'; candidates: AdminClinic[] }>({ state: 'idle' });
  const [retryAck, setRetryAck] = useState(false);
  const [cancelAsk, setCancelAsk] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const submitting = useRef(false);
  const headRef = useRef<HTMLHeadingElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(EMPTY_DRAFT);

  useEffect(() => { headRef.current?.focus(); }, [step]);
  const set = (p: Partial<ClinicDraft>) => setDraft(d => ({ ...d, ...p }));

  const next = (e: FormEvent) => {
    e.preventDefault();
    const errs = step === 0 ? validateDetails(draft, t) : step === 1 ? validateSchedule(draft, t) : [];
    setErrors(errs);
    if (!errs.length) setStep((s) => (s + 1) as Step);
  };
  const back = () => { setErrors([]); setServer(null); setStep((s) => (s - 1) as Step); };

  const finishCreated = async (clinic: AdminClinic) => {
    try { sessionStorage.removeItem(marker); } catch { /* retain safety bit */ }
    invalidate({ clinics: true });
    setCreated(clinic); setAmbiguous(null); setServer(null); setStep(3);
    // Persistence is already confirmed. A selector refresh failure must never
    // turn this into an uncertain creation or invite a duplicate POST.
    try { await onCreated(); }
    catch { if (alive.current) setRefreshFailed(true); }
  };

  const submit = async () => {
    // Blind resubmission after an unknown outcome could create a duplicate clinic.
    if (submitting.current || created || (ambiguous && !retryAck)) return;
    const all = [...validateDetails(draft, t), ...validateSchedule(draft, t)];
    if (all.length) { setErrors(all); setStep(validateDetails(draft, t).length ? 0 : 1); return; }
    setServer(null);
    submitting.current = true;
    const startedAt = Date.now();
    try {
      // Persist before dispatch: even reload during an in-flight POST is uncertain.
      sessionStorage.setItem(marker, '1');
      const clinic = await adminWrite(() => create.mutateAsync({ data: toPayload(draft) }));
      if (!alive.current) return;
      await finishCreated(clinic);
    } catch (e) {
      if (!alive.current) return;
      const f = classify(e);
      if (!f.ambiguous && !ambiguous) { try { sessionStorage.removeItem(marker); } catch { /* retain safety bit */ } }
      if (f.session) { setServer(t(f.key)); return; }
      if (f.ambiguous) { setAmbiguous({ startedAt, knownIds }); setRecon({ state: 'idle' }); setRetryAck(false); }
      setServer(t(f.key));
    } finally {
      submitting.current = false;
    }
  };

  const reconcile = async () => {
    if (!ambiguous) return;
    setRecon({ state: 'loading' });
    try {
      const fresh = await fetchAllClinics();
      if (!alive.current) return;
      const since = ambiguous.startedAt - 5 * 60_000;
      const candidates = fresh.filter(c => ambiguous.knownIds ? !ambiguous.knownIds.includes(c.id) : Date.parse(c.joinedAt) >= since);
      setRecon({ state: 'done', candidates });
    } catch (e) {
      if (classify(e).session) return;
      if (alive.current) setRecon({ state: 'failed' });
    }
  };

  const requestClose = () => { if (step === 3 || (!dirty && !ambiguous)) onClose(); else setCancelAsk(true); };

  return (
    <section className="adm-wizard" aria-labelledby="wizard-title" data-testid="wizard-add-clinic">
      <header className="adm-wizard__head">
        <p className="adm-eyebrow" id="wizard-title">{t('adm.wizard.title')}</p>
        <ol className="adm-steps" aria-label={t('adm.wizard.stepOf', { n: step + 1 })}>
          {STEP_KEYS.map((k, i) => (
            <li key={k} className={i === step ? 'is-current' : i < step ? 'is-done' : ''} aria-current={i === step ? 'step' : undefined} data-testid={`step-wizard-${k}`}>
              <span className="adm-steps__n" aria-hidden="true">{i < step ? <Check size={14} /> : i + 1}</span>
              <span>{t(`adm.wizard.steps.${k}`)}</span>
            </li>))}
        </ol>
      </header>
      <h2 ref={headRef} tabIndex={-1} className="adm-wizard__title" data-testid="text-wizard-step">
        <span className="shell-sr">{t('adm.wizard.stepOf', { n: step + 1 })}: </span>{t(`adm.wizard.steps.${STEP_KEYS[step]}`)}
      </h2>

      {step < 2 && (
        <form className="adm-form" onSubmit={next} noValidate>
          <p className="adm-lede">{step === 0 ? t('adm.wizard.detailsLede') : t('adm.wizard.scheduleLede')}</p>
          <ErrorSummary errors={errors} testId="summary-wizard-errors" />
          {step === 0 ? <DetailsFields d={draft} set={set} errors={errors} /> : <ScheduleFields d={draft} set={set} errors={errors} />}
          <div className="adm-actions">
            <Button type="button" variant="ghost" onClick={requestClose} data-testid="button-wizard-cancel">{t('adm.common.cancel')}</Button>
            {step > 0 && <Button type="button" variant="secondary" onClick={back} data-testid="button-wizard-back">{t('adm.common.back')}</Button>}
            <Button type="submit" data-testid="button-wizard-next">{t('adm.common.next')}</Button>
          </div>
        </form>
      )}

      {step === 2 && (
        <div className="adm-form">
          <p className="adm-lede">{t('adm.wizard.reviewLede')}</p>
          <ClinicSummary d={draft} />
          {server && <Notice tone="danger" testId="status-wizard-error">{server}</Notice>}
          {ambiguous && (
            <div className="adm-recon" role="region" aria-labelledby="recon-title" data-testid="panel-wizard-ambiguous">
              <h3 id="recon-title">{t('adm.wizard.ambiguousTitle')}</h3>
              <p>{t('adm.wizard.ambiguousBody')}</p>
              <Button variant="secondary" startIcon={<SearchCheck size={16} aria-hidden="true" />} loading={recon.state === 'loading'} disabled={!online} onClick={() => void reconcile()} data-testid="button-wizard-reconcile">
                {recon.state === 'loading' ? t('adm.wizard.reconciling') : t('adm.wizard.reconcile')}
              </Button>
              {recon.state === 'failed' && <Notice tone="danger" testId="status-reconcile-failed">{t('adm.wizard.reconcileFailed')}</Notice>}
              {recon.state === 'done' && (<>
                <p className="adm-sub">{t('adm.wizard.reconcileLede')}</p>
                {recon.candidates.length === 0 ? <p data-testid="text-reconcile-none">{t('adm.wizard.reconcileNone')}</p>
                  : <ul className="adm-recon__list" data-testid="list-reconcile-candidates">{recon.candidates.map(c => (
                    <li key={c.id} data-testid={`row-reconcile-${c.id}`}>
                      <span><strong className="adm-mono">#{c.id}</strong> <bdi>{c.name}</bdi> · <bdi>{c.city}</bdi> · {fmt(c.joinedAt)}</span>
                      <Button size="sm" variant="secondary" onClick={() => void finishCreated(c)} data-testid={`button-reconcile-mine-${c.id}`}>{t('adm.wizard.thisIsMine', { id: c.id })}</Button>
                    </li>))}</ul>}
                <label className="adm-check">
                  <input type="checkbox" checked={retryAck} onChange={(e) => setRetryAck(e.target.checked)} data-testid="checkbox-wizard-retry-ack" />
                  {t('adm.wizard.confirmRetry')}
                </label>
              </>)}
            </div>
          )}
          {!online && <Notice tone="warn">{t('adm.common.onlineOnly')}</Notice>}
          <div className="adm-actions">
            <Button type="button" variant="ghost" disabled={create.isPending} onClick={requestClose} data-testid="button-wizard-cancel">{t('adm.common.cancel')}</Button>
            <Button type="button" variant="secondary" disabled={create.isPending || !!ambiguous} onClick={back} data-testid="button-wizard-back">{t('adm.common.back')}</Button>
            <Button type="button" loading={create.isPending} disabled={!online || (!!ambiguous && !retryAck)} onClick={() => void submit()} data-testid="button-wizard-submit">
              {create.isPending ? t('adm.wizard.creating') : t('adm.wizard.create')}
            </Button>
          </div>
        </div>
      )}

      {step === 3 && created && (
        <div className="adm-done" data-testid="panel-wizard-done">
          {refreshFailed && <Notice tone="warn" testId="status-wizard-refresh-failed">{t('adm.wizard.refreshFailed')}</Notice>}
          <CircleCheckBig size={40} aria-hidden="true" className="adm-done__icon" />
          <p className="adm-done__title" data-testid="text-wizard-created">{t('adm.wizard.doneTitle', { name: created.name })}</p>
          <p data-testid="text-wizard-created-id">{t('adm.wizard.doneBody', { id: created.id })}</p>
          <div className="adm-actions adm-actions--start">
            <Button startIcon={<UserPlus size={16} aria-hidden="true" />} onClick={() => onAddDoctor(created)} data-testid="button-wizard-add-doctor">{t('adm.wizard.addDoctorNow')}</Button>
            <Button variant="secondary" onClick={() => { setDraft(EMPTY_DRAFT); setCreated(null); setErrors([]); setRefreshFailed(false); setStep(0); }} data-testid="button-wizard-another">{t('adm.wizard.another')}</Button>
            <Button variant="ghost" onClick={onClose} data-testid="button-wizard-finish">{t('adm.wizard.finish')}</Button>
          </div>
        </div>
      )}

      <Confirm open={cancelAsk} onOpenChange={setCancelAsk} testId="dialog-wizard-cancel" title={t('adm.wizard.cancelTitle')} body={t(ambiguous ? 'adm.wizard.cancelUncertain' : 'adm.wizard.cancelBody')}
        confirmLabel={t('adm.wizard.discard')} onConfirm={() => { setCancelAsk(false); onClose(); }} />
    </section>
  );
}

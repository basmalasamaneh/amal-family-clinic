import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { AlertTriangle, LogIn, PlugZap, Power, RotateCcw, Trash2 } from 'lucide-react';
import { Button, EmptyState } from '@workspace/amal-ui';
import {
  getDeveloperResetReceipt, getDeveloperStatus, getGetDeveloperStatusQueryKey, resetDeveloperDemo, setDeveloperOutage, useGetDeveloperStatus,
  type DemoResetReceipt, type DeveloperStatus,
} from '@workspace/api-client-react';
import { reportUnauthorized } from '@/auth/session-events';
import { ensureDemoContext } from '@/auth/demo-context';
import { OfflineError, PageHead, Notice, SelectField, Skeleton, LoadError, classify, useAlive, useInstant, useOnline } from './common';
import './developer-strings';
import './admin.css';
import './developer.css';

const PHRASE = 'RESET-OPERATIONAL-DEMO-DATA' as const;
const ATTEMPT_KEY = 'amal:developer-reset-attempt';
interface Attempt { requestId: string; expectedGeneration: string }

const statusOf = (e: unknown) => e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number' ? (e as { status: number }).status : null;
const codeOf = (e: unknown) => {
  const d = e && typeof e === 'object' && 'data' in e ? (e as { data: unknown }).data : null;
  return d && typeof d === 'object' && typeof (d as { code?: unknown }).code === 'string' ? (d as { code: string }).code : null;
};
function readAttempt(): Attempt | null {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) ?? 'null');
    if (v && typeof v === 'object' && typeof (v as Attempt).requestId === 'string' && typeof (v as Attempt).expectedGeneration === 'string') return v as Attempt;
  } catch { /* corrupt entry is treated as absent */ }
  return null;
}
const writeAttempt = (a: Attempt) => sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(a));
const clearAttempt = () => sessionStorage.removeItem(ATTEMPT_KEY);

type Phase = 'idle' | 'sending' | 'checking' | 'ambiguous' | 'superseded' | 'done';

export function DeveloperToolsPage({ title }: { title: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const alive = useAlive();
  const online = useOnline();
  const fmt = useInstant();

  const [phase, setPhase] = useState<Phase>(() => (readAttempt() ? 'checking' : 'idle'));
  const [attempt, setAttemptState] = useState<Attempt | null>(readAttempt);
  const [notFound, setNotFound] = useState(false);
  const [receipt, setReceipt] = useState<DemoResetReceipt | null>(null);
  const [cleanupFailed, setCleanupFailed] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const stopPolling = phase === 'done' || phase === 'sending';
  const q = useGetDeveloperStatus({ query: { queryKey: getGetDeveloperStatusQueryKey(), refetchInterval: stopPolling ? false : 5000, refetchIntervalInBackground: false, retry: false, enabled: phase !== 'done' } });

  const errText = useCallback((e: unknown) => {
    const code = codeOf(e);
    if (code === 'DEVELOPER_TOOLS_DISABLED') return t('dev.err.disabled');
    if (statusOf(e) === 403) return t('dev.err.scoped');
    return t(classify(e).key);
  }, [t]);

  /* ---------- reset reconciliation ---------- */
  const succeed = useCallback(async (r: DemoResetReceipt) => {
    clearAttempt(); setAttemptState(null); setReceipt(r); setPhase('done'); setNotFound(false);
    // Local data is cleared only now, after a server-confirmed generation change.
    try { await ensureDemoContext(true); } catch { if (alive.current) setCleanupFailed(true); }
  }, [alive]);

  const reconcile = useCallback(async (a: Attempt) => {
    setPhase('checking'); setNotFound(false);
    try {
      const r = await getDeveloperResetReceipt(a.requestId);
      if (alive.current) await succeed(r);
    } catch (e) {
      if (!alive.current) return;
      const s = statusOf(e);
      if (s === 401) { setPhase('ambiguous'); reportUnauthorized(); return; }
      if (s === 404) {
        try {
          const st = await qc.fetchQuery({ queryKey: getGetDeveloperStatusQueryKey(), queryFn: () => getDeveloperStatus(), staleTime: 0 }) as DeveloperStatus;
          if (!alive.current) return;
          if (st.generation !== a.expectedGeneration) { clearAttempt(); setAttemptState(null); setPhase('superseded'); return; }
        } catch { /* status unknown: stay ambiguous */ }
        setNotFound(true);
      }
      setPhase('ambiguous');
    }
  }, [alive, qc, succeed]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; started.current = true;
    const a = readAttempt();
    if (a) void reconcile(a);
  }, [reconcile]);

  const inFlight = useRef(false);
  const send = useCallback(async (a: Attempt) => {
    if (inFlight.current) return;
    if (!navigator.onLine) { setResetError(t('adm.err.offline')); return; }
    inFlight.current = true; setPhase('sending'); setResetError(null);
    try {
      const r = await resetDeveloperDemo({ requestId: a.requestId, expectedGeneration: a.expectedGeneration, confirmation: PHRASE });
      if (alive.current) await succeed(r);
    } catch (e) {
      if (!alive.current) return;
      const s = statusOf(e);
      if (s === 401) { setPhase('ambiguous'); reportUnauthorized(); return; }
      const c = classify(e);
      if (s !== null && !c.ambiguous) {
        // Definitive refusal: nothing was reset, so this attempt is closed.
        clearAttempt(); setAttemptState(null); setPhase('idle');
        setResetError(s === 409 ? t('dev.reset.conflict') : errText(e));
        void q.refetch();
        return;
      }
      await reconcile(a);
    } finally { inFlight.current = false; }
  }, [alive, errText, q, reconcile, succeed, t]);

  const startReset = async () => {
    if (readAttempt() || !q.data) return; // never mint a new attempt while one is unresolved
    const a: Attempt = { requestId: crypto.randomUUID(), expectedGeneration: q.data.generation };
    writeAttempt(a); setAttemptState(a); // persisted BEFORE submission
    setConfirmOpen(false);
    await send(a);
  };

  /* ---------- confirm dialog ---------- */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [typedErr, setTypedErr] = useState(false);
  const startBtn = useRef<HTMLButtonElement>(null);

  /* ---------- outage ---------- */
  const [selected, setSelected] = useState('');
  const [outBusy, setOutBusy] = useState<null | 'on' | 'off'>(null);
  const [outMsg, setOutMsg] = useState<{ tone: 'success' | 'danger' | 'warn'; text: string; key?: string; clinic?: string } | null>(null);
  const clinics = q.data?.clinics ?? [];
  useEffect(() => {
    if (!q.data) return;
    if (!selected || !q.data.clinics.some(c => String(c.id) === selected)) setSelected(q.data.clinics[0] ? String(q.data.clinics[0].id) : '');
  }, [q.data, selected]);
  const clinic = clinics.find(c => String(c.id) === selected) ?? null;
  const stale = q.isError && !!q.data;

  const toggle = async (enabled: boolean) => {
    if (!clinic || !q.data || outBusy) return;
    setOutBusy(enabled ? 'on' : 'off'); setOutMsg(null);
    const name = '\u2068' + clinic.name + '\u2069';
    try {
      if (!navigator.onLine) throw new OfflineError();
      const updated = await setDeveloperOutage(clinic.id, { enabled, expectedGeneration: q.data.generation });
      if (!alive.current) return;
      qc.setQueryData<DeveloperStatus>(getGetDeveloperStatusQueryKey(), old => old ? { ...old, clinics: old.clinics.map(c => c.id === updated.id ? updated : c) } : old);
      setOutMsg({ tone: 'success', text: '', key: updated.outage ? 'dev.outage.enabled' : 'dev.outage.restored', clinic: name });
    } catch (e) {
      if (!alive.current) return;
      const s = statusOf(e);
      if (s === 401) { reportUnauthorized(); return; }
      void q.refetch();
      if (s === 409) setOutMsg({ tone: 'warn', text: t('dev.outage.changedElsewhere') });
      else if (classify(e).ambiguous) setOutMsg({ tone: 'warn', text: t('dev.outage.ambiguous') });
      else setOutMsg({ tone: 'danger', text: errText(e) });
    } finally { if (alive.current) setOutBusy(null); }
  };

  /* ---------- render ---------- */
  if (phase === 'done' && receipt) {
    return (
      <section className="adm" data-testid="page-developer">
        <PageHead id="developer" title={title} lede={t('dev.lede')} />
        <div className="dev-card" role="status" data-testid="state-reset-done">
          <h2 className="dev-card__title">{t('dev.reset.doneTitle')}</h2>
          <p className="dev-card__desc">{t('dev.reset.done', { time: fmt(receipt.completedAt) })}</p>
          <p className="adm-foot adm-mono" data-testid="text-reset-generation">{t('dev.generation')}: <bdi>{receipt.generation}</bdi></p>
          {cleanupFailed && <Notice tone="warn" testId="status-reset-cleanup">{t('dev.reset.cleanupFailed')}</Notice>}
          <div className="dev-actions"><Button startIcon={<LogIn size={16} aria-hidden="true" />} onClick={() => reportUnauthorized()} data-testid="button-reset-signin">{t('dev.reset.signIn')}</Button></div>
        </div>
      </section>
    );
  }

  const unresolved = phase === 'ambiguous' || phase === 'checking' || (phase === 'sending' && !!attempt);
  const accessDenied = q.isError && !q.data && statusOf(q.error) === 403;

  return (
    <section className="adm" data-testid="page-developer" aria-busy={q.isFetching}>
      <PageHead id="developer" title={title} lede={t('dev.lede')} actions={
        <Button variant="secondary" startIcon={<RotateCcw size={16} aria-hidden="true" />} loading={q.isFetching} onClick={() => void q.refetch()} data-testid="button-developer-refresh">{t('adm.common.refresh')}</Button>} />

      {/* Reset attempt reconciliation is shown even if the status call fails, so an unresolved reset is never hidden. */}
      {unresolved && attempt && (
        <div className="dev-card dev-card--danger" data-testid="state-reset-pending">
          <h2 className="dev-card__title">{t('dev.reset.pendingTitle')}</h2>
          <p className="dev-card__desc">{t('dev.reset.pendingBody')}</p>
          <p className="adm-foot adm-mono" data-testid="text-reset-request">{t('dev.reset.requestId')}: <bdi>{attempt.requestId}</bdi></p>
          <div role="status" aria-live="polite">
            {phase === 'checking' || phase === 'sending' ? <p className="adm-foot" data-testid="status-reset-checking">{phase === 'sending' ? t('dev.reset.running') : t('dev.reset.checking')}</p>
              : notFound ? <Notice tone="warn" testId="status-reset-notfound">{t('dev.reset.notFound')}</Notice> : null}
          </div>
          {!online && <Notice tone="warn" testId="status-reset-offline">{t('dev.reset.offline')}</Notice>}
          <div className="dev-actions">
            <Button variant="secondary" disabled={phase !== 'ambiguous'} loading={phase === 'checking'} onClick={() => void reconcile(attempt)} data-testid="button-reset-check">{t('dev.reset.check')}</Button>
            <Button variant="danger" disabled={phase !== 'ambiguous' || !online} loading={phase === 'sending'} onClick={() => void send(attempt)} data-testid="button-reset-replay">{t('dev.reset.replay')}</Button>
          </div>
        </div>
      )}
      {phase === 'superseded' && (
        <Notice tone="warn" testId="status-reset-superseded">
          <strong>{t('dev.reset.supersededTitle')}</strong> {t('dev.reset.superseded')}{' '}
          <Button size="sm" variant="ghost" onClick={() => setPhase('idle')} data-testid="button-reset-dismiss">{t('dev.reset.dismiss')}</Button>
        </Notice>
      )}

      {q.isPending ? <Skeleton rows={5} />
        : accessDenied ? <div className="adm-empty" role="alert" data-testid="state-developer-forbidden"><AlertTriangle size={28} aria-hidden="true" /><p className="adm-empty__title">{errText(q.error)}</p></div>
        : q.isError && !q.data ? <LoadError text={t('dev.err.load')} error={q.error} onRetry={() => void q.refetch()} />
        : q.data && <>
          <p className={`dev-gen${stale ? ' is-stale' : ''}`} data-testid="text-developer-generation">
            <span className="dev-gen__dot" aria-hidden="true" />{t('dev.generation')}: <bdi className="adm-mono">{q.data.generation.slice(0, 8)}</bdi>
            <span className="shell-sr">{q.data.generation}</span>
          </p>
          {stale ? <Notice tone="warn" testId="status-developer-stale">{t('dev.stale')} {errText(q.error)}</Notice> : <p className="adm-foot">{t('dev.live')}</p>}

          <section className="dev-card" aria-labelledby="dev-outage-h" data-testid="card-outage">
            <h2 id="dev-outage-h" className="dev-card__title"><PlugZap size={20} aria-hidden="true" /> {t('dev.outage.title')}</h2>
            <p className="dev-card__desc">{t('dev.outage.desc')}</p>
            {clinics.length === 0 ? <div data-testid="state-outage-empty"><EmptyState className="amal-empty--compact" headingLevel={3} title={t('dev.outage.none')} /></div> : <>
              <div className="dev-row">
                <SelectField id="dev-clinic" label={t('dev.outage.clinic')} value={selected} onChange={(v) => { setSelected(v); setOutMsg(null); }} testId="select-outage-clinic" disabled={!!outBusy}>
                  {clinics.map(c => <option key={c.id} value={String(c.id)}>{c.name}{c.outage ? ` (${t('dev.outage.on')})` : ''}</option>)}
                </SelectField>
                {clinic && (
                  <p className={`dev-state dev-state--${stale ? 'unknown' : clinic.outage ? 'on' : 'off'}`} data-testid={`status-outage-${clinic.id}`}>
                    <span className="shell-sr">{t('dev.outage.statusLabel')}: </span>
                    {stale ? `${t(clinic.outage ? 'dev.outage.on' : 'dev.outage.off')} (${t('dev.outage.unknown')})` : t(clinic.outage ? 'dev.outage.on' : 'dev.outage.off')}
                  </p>
                )}
              </div>
              {clinic && <div className="dev-actions">
                {clinic.outage
                  ? <Button startIcon={<Power size={16} aria-hidden="true" />} loading={outBusy === 'off'} disabled={!!outBusy || !online || unresolved} onClick={() => void toggle(false)} data-testid="button-outage-restore">{outBusy === 'off' ? t('dev.outage.restoring') : t('dev.outage.restore')}</Button>
                  : <Button variant="danger" startIcon={<PlugZap size={16} aria-hidden="true" />} loading={outBusy === 'on'} disabled={!!outBusy || !online || unresolved} onClick={() => void toggle(true)} data-testid="button-outage-enable">{outBusy === 'on' ? t('dev.outage.enabling') : t('dev.outage.enable')}</Button>}
              </div>}
            </>}
            <div aria-live="polite">{outMsg && <Notice tone={outMsg.tone} testId="status-outage-result">{outMsg.key ? t(outMsg.key, { clinic: outMsg.clinic }) : outMsg.text}</Notice>}</div>
          </section>

          <section className="dev-card dev-card--danger" aria-labelledby="dev-reset-h" data-testid="card-reset">
            <h2 id="dev-reset-h" className="dev-card__title"><Trash2 size={20} aria-hidden="true" /> {t('dev.reset.title')}</h2>
            <p className="dev-card__desc">{t('dev.reset.desc')}</p>
            <ul className="dev-warn"><li>{t('dev.reset.warn1')}</li><li>{t('dev.reset.warn2')}</li><li>{t('dev.reset.warn3')}</li></ul>
            {!online && <Notice tone="warn" testId="status-reset-offline-idle">{t('dev.reset.offline')}</Notice>}
            {resetError && <Notice tone="danger" testId="status-reset-error">{resetError}</Notice>}
            <div className="dev-actions">
              <Button ref={startBtn} variant="danger" disabled={!online || unresolved || phase === 'sending' || stale} onClick={() => { setTyped(''); setTypedErr(false); setResetError(null); setConfirmOpen(true); }} data-testid="button-reset-start">{t('dev.reset.start')}</Button>
            </div>
          </section>
        </>}

      <AlertDialog.Root open={confirmOpen} onOpenChange={(o) => { if (phase !== 'sending') setConfirmOpen(o); }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="shell-overlay" />
          <AlertDialog.Content className="shell-dialog adm-dialog" data-testid="dialog-reset-confirm" onCloseAutoFocus={(e) => { if (startBtn.current?.isConnected) { e.preventDefault(); startBtn.current.focus(); } }}>
            <AlertDialog.Title className="shell-dialog__title">{t('dev.reset.confirmTitle')}</AlertDialog.Title>
            <AlertDialog.Description asChild>
              <ul className="dev-warn adm-dialog__desc"><li>{t('dev.reset.warn1')}</li><li>{t('dev.reset.warn2')}</li><li>{t('dev.reset.warn3')}</li></ul>
            </AlertDialog.Description>
            <form noValidate onSubmit={(e) => { e.preventDefault(); if (typed.trim() !== PHRASE) { setTypedErr(true); return; } void startReset(); }}>
              <div className="amal-field">
                <label className="amal-field__label" htmlFor="dev-confirm">{t('dev.reset.typeLabel', { phrase: PHRASE })}</label>
                <input id="dev-confirm" className="amal-input dev-confirm-input" dir="ltr" autoComplete="off" spellCheck={false} value={typed}
                  onChange={(e) => { setTyped(e.target.value); setTypedErr(false); }} aria-invalid={typedErr || undefined} aria-describedby={typedErr ? 'dev-confirm-err' : undefined} data-testid="input-reset-confirm" />
                {typedErr && <p id="dev-confirm-err" className="adm-field-error" role="alert">{t('dev.reset.typeMismatch')}</p>}
              </div>
              <div className="dev-actions" style={{ marginBlockStart: 16 }}>
                <AlertDialog.Cancel asChild><Button variant="secondary" type="button" data-testid="button-reset-cancel">{t('adm.common.cancel')}</Button></AlertDialog.Cancel>
                <Button variant="danger" type="submit" disabled={!online || phase === 'sending' || !!readAttempt() || typed.trim() !== PHRASE} data-testid="button-reset-confirm">{t('dev.reset.confirm')}</Button>
              </div>
            </form>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
}

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearch } from 'wouter';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, ArrowLeft, CheckCircle2, Eye, History, KeyRound, Loader2, Lock, RotateCcw, ShieldCheck, ShieldOff, UserRound, Users, X } from 'lucide-react';
import { EmptyState, useAmalPreferences } from '@workspace/amal-ui';
import type { Consent } from '@workspace/api-client-react';
import type { ShellClinic } from '@/shell/identity';
import { demoPath } from '@/shell/identity';
import { formatDateOnly } from '@/shell/formatting';
import { describeApiError } from '@/auth/errors';
import { normalizePin, isValidPin } from '@/auth/digits';
import { newOpId } from '@/booking/ops';
import { completeClinicalInvalidation, invalidateClinicalData } from '../network/consent-invalidation';
import { realConsentApi, type ConsentApi } from './api';
import {
  ACCESS_LIMIT, ACCESS_MAX_PAGES, EMPTY_DRAFT, LEVELS, appendAccess, buildBody, classifyOutcome, formatAt, isConsentSelected,
  isDowngrade, parsePatientId, confirms, getUnresolved, putUnresolved, resolveUnresolved, unresolvedKey, rowState, settle, validateDraft, type AccessItem, type ConsentView, type Draft, type DraftError, type Level, type PendingOp,
} from './model';
import '@/booking/i18n';
import './i18n';
import '@/reception/reception.css';
import './consent.css';

/** Route guard: only a patient explicitly selected in Patients for this clinic. The server still authorizes. */
export function ConsentPage({ clinic, title, scope, api = realConsentApi }: { clinic: ShellClinic | null; title: string; scope: string; api?: ConsentApi }) {
  const { t } = useTranslation();
  const patientId = parsePatientId(useSearch());
  const allowed = !!clinic && patientId !== null && isConsentSelected(clinic.id, patientId);
  if (!allowed) {
    return (
      <section className="rx cs" data-testid="page-consent">
        <h1 id="page-title" tabIndex={-1} className="cal-h1"><ShieldCheck size={28} aria-hidden="true" />{title}</h1>
        <div className="cs-guard" data-testid="state-consent-guard">
          <span className="rx-empty__mark" aria-hidden="true"><Lock size={30} /></span>
          <h2 className="rx-h2">{clinic ? t('cs.guard.title') : t('cs.guard.noClinic')}</h2>
          {clinic && <p className="bk-hint">{t('cs.guard.body')}</p>}
          <Link href={demoPath('/desk/patients')} className="bk-btn bk-btn--primary" data-testid="link-consent-guard-patients">{t('cs.guard.open')}</Link>
        </div>
      </section>
    );
  }
  return <ConsentWorkspace key={`${scope}:${patientId}`} clinic={clinic!} patientId={patientId!} title={title} api={api} scope={scope} />;
}

type Load = { kind: 'loading' } | { kind: 'ok'; data: ConsentView } | { kind: 'fail'; why: 'denied' | 'session' | 'error' };
type Msg = { tone: 'ok' | 'block' | 'warn'; text: string } | null;
type PinAction = { kind: 'record' } | { kind: 'withdraw' } | { kind: 'replay' } | { kind: 'views'; more: boolean };
type Views = { kind: 'idle' } | { kind: 'loading'; items: AccessItem[] } | { kind: 'ok'; items: AccessItem[]; cursor: string | null; pages: number } | { kind: 'fail'; why: 'denied' | 'unavailable' | 'error'; items: AccessItem[] };

function readFailure(e: unknown): 'denied' | 'session' | 'error' {
  const s = (e as { status?: unknown })?.status;
  if (s === 401) return 'session';
  if (s === 403 || s === 404) return 'denied';
  return 'error';
}

function ConsentWorkspace({ clinic, patientId, title, api, scope }: { clinic: ShellClinic; patientId: number; title: string; api: ConsentApi; scope: string }) {
  const { t } = useTranslation();
  const { locale, digitPreference: dp } = useAmalPreferences();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<DraftError[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<null | 'record' | 'withdraw' | 'replay'>(null);
  // Unresolved op + invalidation token live in module memory keyed by identity:role:clinic + patient, so
  // in-app navigation away and back restores them. Unmount never completes the token.
  const ukey = unresolvedKey(scope, patientId);
  const restored = useRef(getUnresolved(ukey)).current;
  const [op, setOpState] = useState<PendingOp | null>(restored?.op ?? null);
  const opRef = useRef<PendingOp | null>(restored?.op ?? null);
  const blockToken = useRef<string | null>(restored?.token ?? null);
  /** Known result recorded; the token is released only after a successful authoritative reread. */
  const awaitingReread = useRef(!!restored && !restored.op);
  const persist = () => { if (blockToken.current) putUnresolved(ukey, { op: opRef.current, token: blockToken.current }); };
  const setOp = (o: PendingOp | null) => { opRef.current = o; if (mounted.current) setOpState(o); persist(); };
  const busyRef = useRef(false);
  const mounted = useRef(true);
  /** Accepted op waiting for the reread to confirm it; success is announced only after confirmation. */
  const confirmRef = useRef<PendingOp | null>(null);
  const [pin, setPin] = useState<PinAction | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [views, setViews] = useState<Views>({ kind: 'idle' });
  const [requested, setRequested] = useState(false);
  const gen = useRef(0);
  const viewsGen = useRef(0);
  const ctl = useRef<AbortController | null>(null);
  const viewsCtl = useRef<AbortController | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const msgRef = useRef<HTMLDivElement>(null);
  const withdrawBtn = useRef<HTMLButtonElement>(null);

  const clearViews = useCallback(() => { viewsCtl.current?.abort(); viewsGen.current++; setViews({ kind: 'idle' }); setRequested(false); }, []);
  /** Denial: every patient-specific display and draft is dropped at once. */
  const clearPatient = useCallback(() => { setDraft(EMPTY_DRAFT); setErrors([]); setMsg(null); setConfirmWithdraw(false); setPin(null); clearViews(); confirmRef.current = null; }, [clearViews]);

  const reload = useCallback(() => {
    ctl.current?.abort();
    const g = ++gen.current; const ac = new AbortController(); ctl.current = ac;
    setLoad({ kind: 'loading' });
    api.read(patientId, ac.signal).then(
      (data) => {
        if (g !== gen.current || !mounted.current) return;
        setLoad({ kind: 'ok', data });
        if (awaitingReread.current && blockToken.current && !opRef.current) {
          resolveUnresolved(ukey); completeClinicalInvalidation(blockToken.current); blockToken.current = null; awaitingReread.current = false;
        }
        const accepted = confirmRef.current; confirmRef.current = null;
        if (accepted) say(confirms(accepted, data)
          ? { tone: 'ok', text: accepted.kind === 'record' ? t('cs.result.recorded') : t('cs.result.withdrawn') }
          : { tone: 'warn', text: t('cs.result.concurrent') });
      },
      (e) => {
        if (g !== gen.current || !mounted.current || (e as { name?: string })?.name === 'AbortError') return;
        const why = readFailure(e);
        if (why !== 'error') clearPatient(); else confirmRef.current = null;
        setLoad({ kind: 'fail', why });
      },
    );
  }, [api, patientId, clearPatient, ukey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Hide everything protected (stale in-flight reads are dropped by the generation counter). */
  const drop = useCallback(() => { ctl.current?.abort(); gen.current++; setLoad({ kind: 'loading' }); clearViews(); }, [clearViews]);

  useEffect(() => {
    mounted.current = true;
    reload();
    const onFocus = () => { if (!busyRef.current) reload(); };
    const onVis = () => { if (document.visibilityState === 'hidden') drop(); else if (!busyRef.current) reload(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVis); mounted.current = false; ctl.current?.abort(); viewsCtl.current?.abort(); gen.current++; viewsGen.current++; };
  }, [reload, drop]);

  const say = (m: Msg) => { if (!mounted.current) return; setMsg(m); setTimeout(() => msgRef.current?.focus(), 0); };
  const data = load.kind === 'ok' ? load.data : null;

  /* ---- Mutations: one at a time, fresh PIN, invalidate first, reread after ---- */
  const execute = async (o: PendingOp) => {
    if (busyRef.current) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { say({ tone: 'block', text: t('cs.form.offline') }); return; }
    busyRef.current = true; setBusy(o.ambiguous ? 'replay' : o.kind); setMsg(null);
    if (!blockToken.current) blockToken.current = invalidateClinicalData();
    setOp(o);
    // Before any consent write, protected clinical views are cleared and blocked. An exact replay of an
    // ambiguous op reuses the still-open block; nothing unblocks until reconciliation is known.
    awaitingReread.current = false;
    clearViews();
    try {
      if (o.kind === 'record') await api.record(o.patientId, o.body);
      else await api.withdraw(o.consentId, o.body);
      setOp(settle(o, 'ok'));
      confirmRef.current = o; // receipt only: success is announced after the reread confirms it
      if (mounted.current) { setDraft(EMPTY_DRAFT); setErrors([]); }
    } catch (e) {
      const outcome = classifyOutcome(e);
      setOp(settle(o, outcome));
      if (outcome === 'ambiguous') { say({ tone: 'warn', text: t('cs.result.ambiguous') }); }
      else if (outcome === 'needsPin') say({ tone: 'block', text: t('cs.pin.wrong') });
      else {
        const s = (e as { status?: number })?.status;
        say({ tone: 'block', text: s === 400 || s === 422 ? t('cs.result.validation') : s === 401 || s === 403 ? t('cs.result.denied') : t('cs.result.rejected') });
      }
    } finally {
      busyRef.current = false;
      awaitingReread.current = !opRef.current; // known result: release after the GET below succeeds
      persist();
      // Unmounted: no state, no refetch here. The store keeps op/token; returning to this patient rereads.
      if (mounted.current) { setBusy(null); reload(); } // receipts are not state: always reread
    }
  };

  const startRecord = (e: FormEvent) => {
    e.preventDefault();
    if (!data || busyRef.current || opRef.current) return;
    const errs = validateDraft(draft, data.eligibility.ageStatus);
    setErrors(errs);
    if (errs.length) { setTimeout(() => document.getElementById(`cs-f-${errs[0]}`)?.focus(), 0); return; }
    setPin({ kind: 'record' });
  };
  const afterPin = (a: PinAction) => {
    setPin(null);
    if (a.kind === 'views') { void readViews(a.more); return; }
    if (a.kind === 'replay') { if (opRef.current) void execute(opRef.current); return; }
    if (!data) return;
    if (a.kind === 'record') {
      const body = buildBody(draft, data.eligibility.ageStatus, newOpId());
      void execute({ kind: 'record', scope, patientId, body, ambiguous: false });
    } else if (a.kind === 'withdraw' && data.current && data.canWithdraw) {
      void execute({ kind: 'withdraw', scope, patientId, consentId: data.current.id, body: { clientOpId: newOpId() }, ambiguous: false });
    }
  };

  /* ---- Access history: explicit request, fresh PIN per call, bounded ---- */
  const readViews = async (more: boolean) => {
    const prev = views.kind === 'ok' && more ? views : null;
    if (more && (!prev || !prev.cursor || prev.pages >= ACCESS_MAX_PAGES)) return;
    viewsCtl.current?.abort();
    const g = ++viewsGen.current; const ac = new AbortController(); viewsCtl.current = ac;
    const keep = prev?.items ?? [];
    setViews({ kind: 'loading', items: keep });
    try {
      const page = await api.accessHistory(patientId, prev?.cursor ?? null, ac.signal);
      if (g !== viewsGen.current || !mounted.current) return;
      setViews({ kind: 'ok', items: appendAccess(keep, page.items), cursor: page.nextCursor, pages: (prev?.pages ?? 0) + 1 });
    } catch (e) {
      if (g !== viewsGen.current || !mounted.current || (e as { name?: string })?.name === 'AbortError') return;
      const s = (e as { status?: number })?.status;
      if (s === 401 || s === 403 || s === 404) { clearPatient(); ctl.current?.abort(); gen.current++; setLoad({ kind: 'fail', why: s === 401 ? 'session' : 'denied' }); return; }
      // Never keep older audit rows next to a failure; retry restarts from the newest page.
      setViews({ kind: 'fail', why: s === 501 || s === 503 ? 'unavailable' : 'error', items: [] });
    }
  };

  if (load.kind === 'fail') {
    const text = t(`cs.fail.${load.why}`);
    return (
      <section className="rx cs" data-testid="page-consent">
        <BackLink />
        <h1 id="page-title" tabIndex={-1} className="cal-h1"><ShieldCheck size={28} aria-hidden="true" />{title}</h1>
        <div className="bk-msg bk-msg--block" role="alert" data-testid={`status-consent-${load.why}`}><AlertTriangle size={20} aria-hidden="true" />
          <div className="bk-msg__body"><p>{text}</p>
            {load.why === 'error' && <button type="button" className="bk-btn bk-btn--sm" onClick={reload} data-testid="button-consent-retry"><RotateCcw size={16} aria-hidden="true" />{t('cs.fail.retry')}</button>}
          </div></div>
        {op && <PendingCard op={op} busy={busy} onReplay={() => setPin({ kind: 'replay' })} />}
      </section>
    );
  }

  const age = data?.eligibility.ageStatus ?? 'unknown';
  const hasErr = (k: DraftError) => errors.includes(k);
  const fmtDate = (d: string) => { try { return formatDateOnly(d, locale, dp); } catch { return t('cs.patient.noDob'); } };

  return (
    <section className="rx cs" data-testid="page-consent" aria-busy={load.kind === 'loading'}>
      <BackLink />
      <header className="rx-head">
        <div>
          <p className="cal-eyebrow"><bdi>{clinic.name}</bdi> · {t('cs.eyebrow')}</p>
          <h1 id="page-title" tabIndex={-1} className="cal-h1"><ShieldCheck size={28} aria-hidden="true" />{title}</h1>
        </div>
      </header>
      <p className="rx-sr" role="status" aria-live="polite">{load.kind === 'loading' ? t('cs.loading') : ''}</p>

      <div ref={msgRef} tabIndex={-1} className="cs-msgslot">
        {msg && <div className={`bk-msg bk-msg--${msg.tone}`} role={msg.tone === 'ok' ? 'status' : 'alert'} data-testid={`status-consent-msg-${msg.tone}`}>
          {msg.tone === 'ok' ? <CheckCircle2 size={20} aria-hidden="true" /> : <AlertTriangle size={20} aria-hidden="true" />}
          <div className="bk-msg__body"><p>{msg.text}</p></div>
          <button type="button" className="bk-x" onClick={() => setMsg(null)} aria-label={t('cs.pin.cancel')} data-testid="button-consent-msg-close"><X size={18} aria-hidden="true" /></button>
        </div>}
      </div>
      {op && <PendingCard op={op} busy={busy} onReplay={() => setPin({ kind: 'replay' })} />}

      {!data ? (
        <div className="cs-grid" aria-hidden="true" data-testid="status-consent-loading"><div className="bk-skel cs-skel-lg" /><div className="bk-skel cs-skel-lg" /></div>
      ) : (
        <div className="cs-grid">
          <div className="cs-col">
            {/* Identity: server-permitted fields only */}
            <div className="cs-who" data-testid="panel-consent-patient">
              <span className="rx-id__av" aria-hidden="true"><UserRound size={28} /></span>
              <div className="rx-id__txt">
                <h2 ref={headingRef} className="rx-id__name" data-testid="text-consent-patient"><bdi dir="auto">{data.patient.name}</bdi></h2>
                <p className="rx-id__rec">{t('cs.patient.record', { id: data.patient.id })}
                  <span className={`cs-age cs-age--${age}`} data-testid="badge-consent-age">{t(`cs.age.${age}`)}</span></p>
                <p className="bk-hint cs-dob">{t('cs.patient.dob')}: {data.eligibility.dateOfBirth ? fmtDate(data.eligibility.dateOfBirth) : t('cs.patient.noDob')} · {t('cs.patient.asOf', { date: fmtDate(data.eligibility.asOfDate) })}</p>
              </div>
            </div>

            <NowCard data={data} />

            {data.canWithdraw && data.current && data.current.status === 'active' && data.effectiveLevel !== 'none' && (
              <section className="cs-card cs-withdraw" aria-labelledby="cs-wd-h">
                <h3 id="cs-wd-h" className="rx-h3"><ShieldOff size={20} aria-hidden="true" />{t('cs.withdraw.title')}</h3>
                <p className="bk-hint">{t('cs.withdraw.body')}</p>
                <button ref={withdrawBtn} type="button" className="bk-btn cs-btn-danger" disabled={!!busy || !!op} onClick={() => setConfirmWithdraw(true)} data-testid="button-consent-withdraw">
                  {busy === 'withdraw' ? <><Loader2 size={18} className="cs-spin" aria-hidden="true" />{t('cs.withdraw.working')}</> : <><ShieldOff size={18} aria-hidden="true" />{t('cs.withdraw.button')}</>}
                </button>
              </section>
            )}

            <HistoryList data={data} />
          </div>

          <div className="cs-col">
            <form className="cs-card cs-form" onSubmit={startRecord} noValidate aria-labelledby="cs-form-h" data-testid="form-consent">
              <h3 id="cs-form-h" className="rx-h3">{t('cs.form.title')}</h3>
              <p className="bk-hint">{t('cs.form.lede')}</p>
              {errors.length > 0 && <p className="cs-err" role="alert" data-testid="text-consent-errors">{t('cs.form.summary', { count: errors.length })}</p>}
              {age === 'unknown' && <p className="bk-msg bk-msg--warn" data-testid="status-age-unknown"><AlertTriangle size={18} aria-hidden="true" />{t('cs.form.unknownAge')}</p>}

              <fieldset className="cs-fs" aria-invalid={hasErr('level') || hasErr('ageUnknown')} aria-describedby={hasErr('level') ? 'cs-e-level' : hasErr('ageUnknown') ? 'cs-e-age' : undefined}>
                <legend className="bk-label">{t('cs.form.level')}</legend>
                <div className="cs-ladder" role="radiogroup" aria-label={t('cs.form.level')}>
                  {LEVELS.map((l, i) => {
                    const disabled = age === 'unknown' && l !== 'none';
                    const isNow = data.effectiveLevel === l;
                    return (
                      <label key={l} className={`cs-rung cs-rung--${l}${draft.level === l ? ' is-on' : ''}${disabled ? ' is-off' : ''}`} data-testid={`option-level-${l}`}>
                        <input id={i === 0 ? 'cs-f-level' : undefined} type="radio" name="cs-level" value={l} checked={draft.level === l} disabled={disabled || !!busy}
                          onChange={() => setDraft({ ...draft, level: l })} data-testid={`radio-level-${l}`} />
                        <span className="cs-rung__steps" aria-hidden="true">{[0, 1].map((s) => <i key={s} className={s < i ? 'on' : ''} />)}</span>
                        <span className="cs-rung__txt">
                          <strong>{t(`cs.level.${l}.name`)} <span className="cs-rung__short">· {t(`cs.level.${l}.short`)}</span></strong>
                          <span>{t(`cs.level.${l}.body`)}</span>
                        </span>
                        {isNow && <span className="cs-now-chip">{t('cs.now.title')}</span>}
                      </label>
                    );
                  })}
                </div>
                {hasErr('level') && <p id="cs-e-level" className="cs-err">{t('cs.form.err.level')}</p>}
                {hasErr('ageUnknown') && <p id="cs-e-age" className="cs-err">{t('cs.form.err.ageUnknown')}</p>}
              </fieldset>

              <fieldset className="cs-fs" aria-invalid={hasErr('evidence')} aria-describedby={hasErr('evidence') ? 'cs-e-ev' : undefined}>
                <legend className="bk-label">{t('cs.form.evidence')}</legend>
                <div className="cs-seg">
                  {(['verbal', 'signed'] as const).map((ev, i) => (
                    <label key={ev} className={draft.evidence === ev ? 'is-on' : ''} data-testid={`option-evidence-${ev}`}>
                      <input id={i === 0 ? 'cs-f-evidence' : undefined} type="radio" name="cs-ev" checked={draft.evidence === ev} disabled={!!busy} onChange={() => setDraft({ ...draft, evidence: ev })} data-testid={`radio-evidence-${ev}`} />
                      {t(`cs.form.${ev}`)}
                    </label>
                  ))}
                </div>
                {hasErr('evidence') && <p id="cs-e-ev" className="cs-err">{t('cs.form.err.evidence')}</p>}
              </fieldset>

              {age === 'minor' && (
                <fieldset className="cs-fs cs-guardian" data-testid="fieldset-guardian">
                  <legend className="bk-label"><Users size={16} aria-hidden="true" />{t('cs.form.guardianTitle')}</legend>
                  <p className="bk-hint">{t('cs.form.guardianHint')}</p>
                  <Field id="cs-f-guardianName" label={t('cs.form.guardianName')} err={hasErr('guardianName') ? t('cs.form.err.guardianName') : null}>
                    <input id="cs-f-guardianName" className="bk-input" dir="auto" maxLength={200} autoComplete="off" value={draft.guardianName} disabled={!!busy}
                      aria-invalid={hasErr('guardianName')} aria-describedby={hasErr('guardianName') ? 'cs-f-guardianName-e' : undefined}
                      onChange={(e) => setDraft({ ...draft, guardianName: e.target.value })} data-testid="input-guardian-name" />
                  </Field>
                  <Field id="cs-f-guardianRelation" label={t('cs.form.guardianRelation')} err={hasErr('guardianRelation') ? t('cs.form.err.guardianRelation') : null}>
                    <input id="cs-f-guardianRelation" className="bk-input" dir="auto" maxLength={100} autoComplete="off" value={draft.guardianRelation} disabled={!!busy}
                      aria-invalid={hasErr('guardianRelation')} aria-describedby={hasErr('guardianRelation') ? 'cs-f-guardianRelation-e' : undefined}
                      onChange={(e) => setDraft({ ...draft, guardianRelation: e.target.value })} data-testid="input-guardian-relation" />
                  </Field>
                </fieldset>
              )}

              {op && <p className="bk-hint" data-testid="text-consent-blocked">{t('cs.form.blockedByPending')}</p>}
              <button type="submit" className="bk-btn bk-btn--primary" disabled={!!busy || !!op || load.kind !== 'ok'} aria-disabled={!!busy || !!op} data-testid="button-consent-submit">
                {busy === 'record' ? <><Loader2 size={18} className="cs-spin" aria-hidden="true" />{t('cs.form.saving')}</> : <><KeyRound size={18} aria-hidden="true" />{t('cs.form.submit')}</>}
              </button>
              {draft.level && data.effectiveLevel !== 'none' && isDowngrade(data.effectiveLevel, draft.level) && <p className="bk-hint" data-testid="text-consent-downgrade">{t('cs.withdraw.body')}</p>}
            </form>

            <section className="cs-card cs-views" aria-labelledby="cs-views-h" data-testid="section-access-history">
              <h3 id="cs-views-h" className="rx-h3"><Eye size={20} aria-hidden="true" />{t('cs.views.title')}</h3>
              <p className="bk-hint">{t('cs.views.lede')}</p>
              <p className="cs-coverage" data-testid="text-access-coverage">{t('cs.views.coverage')}</p>
              {views.kind === 'idle' ? (
                <div className="cs-views__ask">
                  <label className="cs-check" data-testid="option-access-confirm">
                    <input type="checkbox" checked={requested} onChange={(e) => setRequested(e.target.checked)} data-testid="checkbox-access-confirm" />
                    <span>{t('cs.views.confirm')}</span>
                  </label>
                  <button type="button" className="bk-btn" disabled={!requested} onClick={() => setPin({ kind: 'views', more: false })} data-testid="button-access-open"><KeyRound size={18} aria-hidden="true" />{t('cs.views.open')}</button>
                </div>
              ) : (
                <AccessList views={views} onMore={() => setPin({ kind: 'views', more: true })} onRetry={() => setPin({ kind: 'views', more: false })} onHide={clearViews} />
              )}
            </section>
          </div>
        </div>
      )}

      <Dialog.Root open={confirmWithdraw} onOpenChange={(o) => { setConfirmWithdraw(o); if (!o) setTimeout(() => withdrawBtn.current?.focus(), 0); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="cs-overlay" />
          <Dialog.Content className="cs-dialog" data-testid="dialog-withdraw">
            <Dialog.Title className="rx-h2">{t('cs.withdraw.confirmTitle')}</Dialog.Title>
            <Dialog.Description className="cs-dialog__body">{t('cs.withdraw.confirmBody')} {t('cs.withdraw.body')}</Dialog.Description>
            <div className="rx-actions">
              <button type="button" className="bk-btn cs-btn-danger" onClick={() => { setConfirmWithdraw(false); setPin({ kind: 'withdraw' }); }} data-testid="button-withdraw-confirm">{t('cs.withdraw.confirm')}</button>
              <Dialog.Close asChild><button type="button" className="bk-btn" data-testid="button-withdraw-cancel">{t('cs.withdraw.cancel')}</button></Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {pin && <PinDialog api={api} onCancel={() => setPin(null)} onVerified={() => afterPin(pin)} />}
    </section>
  );
}

function BackLink() {
  const { t } = useTranslation();
  return <Link href={demoPath('/desk/patients')} className="cs-back" data-testid="link-consent-back"><ArrowLeft size={16} aria-hidden="true" className="cs-flip" />{t('cs.back')}</Link>;
}

function Field({ id, label, err, children }: { id: string; label: string; err: string | null; children: ReactNode }) {
  return <div className="bk-field"><label htmlFor={id} className="bk-label">{label}</label>{children}{err && <p id={`${id}-e`} className="cs-err">{err}</p>}</div>;
}

function NowCard({ data }: { data: ConsentView }) {
  const { t } = useTranslation();
  const { locale, digitPreference: dp } = useAmalPreferences();
  const c = data.current;
  const lvl = data.effectiveLevel;
  const withdrawn = c?.status === 'withdrawn';
  return (
    <section className={`cs-card cs-now cs-now--${lvl}`} aria-labelledby="cs-now-h" data-testid="panel-consent-current">
      <p className="cs-kicker" id="cs-now-h">{t('cs.now.title')}</p>
      <p className="cs-now__level" data-testid="text-effective-level">{t(`cs.level.${lvl}.name`)}<span>{t(`cs.level.${lvl}.short`)}</span></p>
      <div className="cs-meter" aria-hidden="true">{LEVELS.slice(1).map((l) => <i key={l} className={LEVELS.indexOf(l) <= LEVELS.indexOf(lvl) ? 'on' : ''} />)}</div>
      <p className="cs-now__body">{t(`cs.level.${lvl}.body`)}</p>
      {!c && <p className="bk-hint" data-testid="text-consent-never">{t('cs.now.never')}</p>}
      {c && withdrawn && <p className="bk-hint" data-testid="text-consent-withdrawn">{t('cs.now.withdrawnNote', { at: formatAt(c.withdrawnAt, locale, dp) ?? '—' })}</p>}
      {c && !withdrawn && <Attribution c={c} />}
    </section>
  );
}

function Attribution({ c }: { c: Consent }) {
  const { t } = useTranslation();
  const { locale, digitPreference: dp } = useAmalPreferences();
  const at = formatAt(c.recordedAt, locale, dp);
  return (
    <ul className="cs-attr">
      {at && <li data-testid="text-consent-since">{t('cs.now.since', { at })}</li>}
      <li>{c.givenBy === 'guardian' && c.guardian
        ? <>{t('cs.now.guardian', { name: '\u2068' + c.guardian.name + '\u2069', rel: '\u2068' + c.guardian.relationship + '\u2069' })}</>
        : t('cs.now.patientGave')}</li>
      <li>{c.evidence ? t(`cs.now.evidence.${c.evidence}`) : t('cs.now.evidence.none')}</li>
    </ul>
  );
}

function HistoryList({ data }: { data: ConsentView }) {
  const { t } = useTranslation();
  const { locale, digitPreference: dp } = useAmalPreferences();
  return (
    <section className="cs-card" aria-labelledby="cs-hist-h" data-testid="section-consent-history">
      <h3 id="cs-hist-h" className="rx-h3"><History size={20} aria-hidden="true" />{t('cs.history.title')}</h3>
      <p className="bk-hint">{t('cs.history.lede')}</p>
      {!data.history.length ? <p className="bk-hint" data-testid="status-history-empty">{t('cs.history.empty')}</p> : (
        <ol className="cs-ledger">
          {data.history.map((c) => {
            const st = rowState(c, data);
            return (
              <li key={c.id} className={`cs-row cs-row--${st}`} data-testid={`row-consent-${c.id}`}>
                <span className="cs-row__dot" aria-hidden="true" />
                <div className="cs-row__main">
                  <p className="cs-row__top"><strong>{t(`cs.level.${c.level}.name`)}</strong>
                    <span className={`cs-stamp cs-stamp--${st}`} data-testid={`status-consent-row-${c.id}`}>{t(`cs.history.state.${st}`)}</span></p>
                  <p className="bk-hint"><bdi>{formatAt(c.recordedAt, locale, dp) ?? '—'}</bdi> · {c.givenBy === 'guardian' && c.guardian ? t('cs.now.guardian', { name: '\u2068' + c.guardian.name + '\u2069', rel: '\u2068' + c.guardian.relationship + '\u2069' }) : t('cs.now.patientGave')} · {c.evidence ? t(`cs.now.evidence.${c.evidence}`) : t('cs.now.evidence.none')}</p>
                  {c.status === 'withdrawn' && c.withdrawnAt && <p className="bk-hint">{t('cs.history.withdrawnAt', { at: formatAt(c.withdrawnAt, locale, dp) ?? '—' })}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function PendingCard({ op, busy, onReplay }: { op: PendingOp; busy: string | null; onReplay: () => void }) {
  const { t } = useTranslation();
  if (!op.ambiguous) return null;
  return (
    <div className="bk-msg bk-msg--warn cs-pending" role="alert" data-testid="status-consent-ambiguous"><AlertTriangle size={20} aria-hidden="true" />
      <div className="bk-msg__body">
        <p>{t('cs.result.ambiguous')}</p>
        <p className="bk-hint">{op.kind === 'record' ? `${t('cs.form.title')}: ${t(`cs.level.${op.body.level}.name`)}` : t('cs.withdraw.title')} · {t('cs.result.discardNote')}</p>
        <button type="button" className="bk-btn bk-btn--sm" disabled={!!busy} onClick={onReplay} data-testid="button-consent-reconcile">
          {busy === 'replay' ? <><Loader2 size={16} className="cs-spin" aria-hidden="true" />{t('cs.result.reconciling')}</> : <><RotateCcw size={16} aria-hidden="true" />{t('cs.result.reconcile')}</>}
        </button>
      </div>
    </div>
  );
}

function AccessList({ views, onMore, onRetry, onHide }: { views: Exclude<Views, { kind: 'idle' }>; onMore: () => void; onRetry: () => void; onHide: () => void }) {
  const { t } = useTranslation();
  const { locale, digitPreference: dp } = useAmalPreferences();
  const items = views.items;
  const capped = views.kind === 'ok' && views.pages >= ACCESS_MAX_PAGES && !!views.cursor;
  return (
    <div className="cs-views__list">
      <p className="rx-sr" role="status" aria-live="polite">{views.kind === 'loading' ? t('cs.views.loading') : views.kind === 'fail' ? t(`cs.views.${views.why}`) : ''}</p>
      {views.kind === 'loading' && !items.length && <div className="bk-list" aria-hidden="true" data-testid="status-access-loading"><div className="bk-skel" /><div className="bk-skel" /><div className="bk-skel" /></div>}
      {views.kind === 'ok' && !items.length && <div data-testid="status-access-empty"><EmptyState className="amal-empty--compact" title={t('cs.views.empty')} description={t('cs.views.emptyDesc')} /></div>}
      {items.length > 0 && (
        <ol className="cs-access">
          {items.map((i) => {
            const roleKey = i.viewerRole && ['doctor', 'front-desk', 'admin'].includes(i.viewerRole) ? `cs.views.role.${i.viewerRole}` : null;
            return (
              <li key={i.id} className="cs-access__item" data-testid={`row-access-${i.id}`}>
                <time className="cs-access__at" dateTime={i.at}>{formatAt(i.at, locale, dp) ?? '—'}</time>
                <span className="cs-access__who"><strong>{i.viewerName ? <bdi dir="auto">{i.viewerName}</bdi> : t('cs.views.unknownViewer')}</strong>
                  <span className="bk-hint">{roleKey ? t(roleKey) : t('cs.views.unknownRole')} · {i.viewerClinicName ? <bdi dir="auto">{i.viewerClinicName}</bdi> : t('cs.views.unknownClinic')}</span></span>
                <span className="rx-tag">{t('cs.views.action')}</span>
              </li>
            );
          })}
        </ol>
      )}
      {views.kind === 'fail' && (
        <div className="bk-msg bk-msg--block" data-testid={`status-access-${views.why}`}><AlertTriangle size={20} aria-hidden="true" />
          <div className="bk-msg__body"><p>{t(`cs.views.${views.why}`)}</p>
            {views.why !== 'denied' && <button type="button" className="bk-btn bk-btn--sm" onClick={onRetry} data-testid="button-access-retry"><RotateCcw size={16} aria-hidden="true" />{t('cs.views.retry')}</button>}
          </div></div>
      )}
      {capped && <p className="bk-hint" data-testid="text-access-capped">{t('cs.views.capped', { count: ACCESS_LIMIT * ACCESS_MAX_PAGES })}</p>}
      <div className="rx-actions">
        {views.kind === 'ok' && views.cursor && !capped && <button type="button" className="bk-btn bk-btn--sm" onClick={onMore} data-testid="button-access-more"><KeyRound size={16} aria-hidden="true" />{t('cs.views.more')}</button>}
        {views.kind === 'loading' && items.length > 0 && <span className="bk-hint"><Loader2 size={16} className="cs-spin" aria-hidden="true" />{t('cs.views.loading')}</span>}
        <button type="button" className="bk-btn bk-btn--sm" onClick={onHide} data-testid="button-access-hide"><X size={16} aria-hidden="true" />{t('cs.views.hide')}</button>
      </div>
    </div>
  );
}

function PinDialog({ api, onCancel, onVerified }: { api: ConsentApi; onCancel: () => void; onVerified: () => void }) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'wrong' | 'locked' | 'error' | 'format'>('idle');
  const doneRef = useRef(onVerified); doneRef.current = onVerified;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (state === 'checking') return;
    if (!isValidPin(pin)) { setState('format'); return; }
    setState('checking');
    try { await api.verifyPin(pin); setPin(''); doneRef.current(); }
    catch (err) {
      setPin('');
      const k = describeApiError(err).key;
      setState(k === 'pinLocked' || k === 'rateLimited' ? 'locked' : k === 'unauthorized' || k === 'validation' || k === 'forbidden' ? 'wrong' : 'error');
    }
  };
  const err = state === 'wrong' || state === 'locked' || state === 'error' || state === 'format' ? t(`cs.pin.${state}`) : null;
  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o && state !== 'checking') onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="cs-overlay" />
        <Dialog.Content className="cs-dialog cs-dialog--pin" data-testid="dialog-pin">
          <span className="rx-empty__mark" aria-hidden="true"><KeyRound size={26} /></span>
          <Dialog.Title className="rx-h2">{t('cs.pin.title')}</Dialog.Title>
          <Dialog.Description className="cs-dialog__body">{t('cs.pin.body')}</Dialog.Description>
          <form onSubmit={submit} className="bk-field">
            <label htmlFor="cs-pin" className="bk-label">{t('cs.pin.label')}</label>
            <input id="cs-pin" className="bk-input cs-pin" type="password" inputMode="numeric" autoComplete="off" dir="ltr" maxLength={8} autoFocus
              value={pin} onChange={(e) => setPin(normalizePin(e.target.value))} aria-invalid={!!err} aria-describedby={err ? 'cs-pin-e' : undefined} disabled={state === 'checking' || state === 'locked'} data-testid="input-pin" />
            {err && <p id="cs-pin-e" className="cs-err" role="alert" data-testid="text-pin-error">{err}</p>}
            <p className="rx-sr" role="status">{state === 'checking' ? t('cs.pin.checking') : ''}</p>
            <div className="rx-actions">
              <button type="submit" className="bk-btn bk-btn--primary" disabled={state === 'checking' || state === 'locked'} data-testid="button-pin-submit">
                {state === 'checking' ? <><Loader2 size={18} className="cs-spin" aria-hidden="true" />{t('cs.pin.checking')}</> : t('cs.pin.submit')}
              </button>
              <button type="button" className="bk-btn" onClick={onCancel} disabled={state === 'checking'} data-testid="button-pin-cancel">{t('cs.pin.cancel')}</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

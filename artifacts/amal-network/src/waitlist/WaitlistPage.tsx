import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, BellOff, CheckCircle2, Info, ListOrdered, ListPlus, Loader2, RotateCcw, TriangleAlert, WifiOff, XCircle } from 'lucide-react';
import {
  getListWaitlistQueryKey, useCheckWaitlistOffer, useDecideWaitlistOffer, useListWaitlist,
  type ConflictPreview, type WaitlistOffer, type WaitlistSnapshot,
} from '@workspace/api-client-react';
import { EmptyState, useAmalPreferences } from '@workspace/amal-ui';
import type { ShellClinic } from '@/shell/identity';
import { formatInstant } from '@/shell/formatting';
import { formatLocalDate, formatTime, localDateOf } from '@/calendar/dates';
import { resolvePatientSearch } from '@/booking/patients';
import { ConflictDialog } from '@/booking/ConflictDialog';
import { commitAllowed, summarize } from '@/booking/conflicts';
import { createAttemptKeeper, type Attempt } from '@/booking/ops';
import { classifyError } from '@/booking/errors';
import { APPOINTMENTS_CHANGED } from '@/booking/BookingDrawer';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { AddToWaitlistDialog } from './AddToWaitlistDialog';
import type { EntryPayload } from './model';
import { useUnconfirmedGuard } from './use-unconfirmed-guard';
import {
  POLL_MS, clockOffset, isAffectedByDecision, isUncertain, isWaitlistKey, notificationReasonKey, notificationWarning,
  offerGate, remainingSeconds, waitlistKey,
} from './model';
import './strings';
import '@/booking/booking.css';
import './waitlist.css';

export function WaitlistPage({ clinic, title, scope, fixture }: { clinic: ShellClinic | null; title: string; scope: string; fixture: boolean }) {
  const { t } = useTranslation('wl');
  return (
    <div className="wl-page" data-testid="page-waitlist">
      <div className="wl-head">
        <div>
          <p className="shell-page__eyebrow">{t('eyebrow')}</p>
          <h1 id="page-title" tabIndex={-1} className="shell-page__title"><ListOrdered size={30} aria-hidden="true" />{title}</h1>
          <p className="wl-lede">{t('lede')}</p>
        </div>
      </div>
      <div className="wl-note" role="note" data-testid="notice-waitlist-not-reservation"><Info size={20} aria-hidden="true" /><p>{t('notice')}</p></div>
      {clinic ? <WaitlistBody key={scope + '|' + clinic.id} clinic={clinic} scope={scope} fixture={fixture} />
        : <div data-testid="status-waitlist-no-clinic"><EmptyState title={t('noClinic.title')} description={t('noClinic.body')} /></div>}
    </div>
  );
}

function WaitlistBody({ clinic, scope, fixture }: { clinic: ShellClinic; scope: string; fixture: boolean }) {
  const { t } = useTranslation('wl');
  const { locale, digitPreference: dp } = useAmalPreferences();
  const qc = useQueryClient();
  const online = useOnlineStatus();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  // In-memory only, dropped with this scope (clinic/actor). Survives dialog/card unmount and poll removal.
  const [createRetained, setCreateRetained] = useState<Attempt<EntryPayload> | null>(null);
  const [decisions, setDecisions] = useState<Record<number, OfferMemo>>({});
  const unconfirmed = !!createRetained || Object.values(decisions).some((m) => !!m.pending);
  useUnconfirmedGuard(unconfirmed);
  const memo = (id: number, m: Partial<OfferMemo> | null) => setDecisions((d) => {
    const next = { ...d };
    if (m === null) delete next[id]; else next[id] = { ...(d[id] ?? { offer: null, pending: null, outcome: null }), ...m } as OfferMemo;
    return next;
  });
  const patients = useMemo(() => resolvePatientSearch(fixture), [fixture]);
  const queryKey = useMemo(() => [...getListWaitlistQueryKey(), ...waitlistKey(scope, clinic.id).slice(1)], [scope, clinic.id]);
  const q = useListWaitlist<WaitlistSnapshot>({ query: { queryKey, enabled: online, refetchInterval: online ? POLL_MS : false, gcTime: 0, staleTime: 0 } });
  // No persisted waitlist data: drop this scope's snapshot when leaving (clinic switch, logout, navigation).
  useEffect(() => () => { qc.removeQueries({ predicate: (x) => isWaitlistKey(x.queryKey) }); }, [qc]);

  const offset = q.data ? clockOffset(q.data.serverNow, q.dataUpdatedAt) : 0;
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(id); }, []);
  const serverNowMs = tick + offset;

  const fmtWhen = (s: string, e: string) => `${formatLocalDate(localDateOf(s), locale, dp, 'EEE d MMM')} ${formatTime(s, locale, dp)}–${formatTime(e, locale, dp)}`;
  const data = q.data;
  // An offer with an unconfirmed decision or a server outcome stays visible even if a poll drops it.
  const kept = Object.values(decisions).filter((m) => m.offer && (m.pending || m.outcome) && !data?.offers.some((o) => o.id === m.offer!.id)).map((m) => m.offer!);
  const offers = data ? [...data.offers, ...kept].sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || Date.parse(b.createdAt) - Date.parse(a.createdAt)) : [];
  const entries = data ? [...data.entries].sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt)) : [];

  return (
    <>
      <div className="wl-head">
        <div className="wl-meta">
          {data && <span data-testid="text-waitlist-server-clock">{t('clock', { time: formatInstant(new Date(serverNowMs).toISOString(), locale, dp) })}</span>}
          {q.dataUpdatedAt > 0 && <span data-testid="text-waitlist-updated">{t('updated', { time: formatInstant(new Date(q.dataUpdatedAt + offset).toISOString(), locale, dp) })}</span>}
        </div>
        <button type="button" className="bk-btn bk-btn--primary" onClick={() => { setAdded(false); setAdding(true); }} disabled={!online} data-testid="button-open-add-waitlist"><ListPlus size={18} aria-hidden="true" />{t('add')}</button>
      </div>
      {!online && <div className="bk-msg bk-msg--warn" role="status" data-testid="status-waitlist-offline"><WifiOff size={20} aria-hidden="true" /><div className="bk-msg__body"><p>{t('offline')}</p></div></div>}
      {unconfirmed && <div className="bk-msg bk-msg--warn" role="status" data-testid="status-waitlist-unconfirmed"><AlertTriangle size={20} aria-hidden="true" /><div className="bk-msg__body"><p>{t('guard.page')}</p>
        {createRetained && !adding && <button type="button" className="bk-btn bk-btn--sm" onClick={() => setAdding(true)} data-testid="button-waitlist-reopen-unconfirmed"><RotateCcw size={16} aria-hidden="true" />{t('form.retry')}</button>}</div></div>}
      {added && <div className="bk-msg bk-msg--ok" role="status" data-testid="status-waitlist-added"><CheckCircle2 size={20} aria-hidden="true" /><div className="bk-msg__body"><p>{t('form.done')}</p></div></div>}
      {!data && (q.isLoading || q.isFetching) && <div aria-busy="true" data-testid="status-waitlist-loading"><span className="bk-sr">{t('loading')}</span><div className="wl-list"><div className="wl-skel" /><div className="wl-skel" /><div className="wl-skel" /></div></div>}
      {q.isError && <div className="bk-msg bk-msg--block" role="alert" data-testid="status-waitlist-error"><AlertTriangle size={20} aria-hidden="true" />
        <div className="bk-msg__body"><p>{t('error')}</p><button type="button" className="bk-btn bk-btn--sm" disabled={!online} onClick={() => void q.refetch()} data-testid="button-waitlist-retry"><RotateCcw size={16} aria-hidden="true" />{t('retry')}</button></div></div>}

      {data && <>
        <section className="wl-section" aria-labelledby="wl-offers-h">
          <h2 id="wl-offers-h" className="wl-section__h">{t('sections.offers')}<span className="wl-count">{offers.filter((o) => o.status === 'active').length}</span></h2>
          {offers.length === 0 ? <p className="bk-hint" data-testid="text-offers-empty">{t('empty.offers')}</p> : (
            <ul className="wl-list">{offers.map((o) => <li key={o.id}><OfferCard offer={o} memo={decisions[o.id] ?? null} onMemo={(m) => memo(o.id, m)} serverNowMs={serverNowMs} online={online} clinicId={clinic.id} fmtWhen={fmtWhen} /></li>)}</ul>
          )}
        </section>

        <section className="wl-section" aria-labelledby="wl-opps-h">
          <h2 id="wl-opps-h" className="wl-section__h">{t('sections.opportunities')}<span className="wl-count">{data.opportunities.length}</span></h2>
          {data.opportunities.length === 0 ? <p className="bk-hint" data-testid="text-opportunities-empty">{t('empty.opportunities')}</p> : (
            <ul className="wl-list">{data.opportunities.map((o) => (
              <li key={o.id} className={'wl-card' + (o.status === 'open' ? ' wl-card--active' : ' wl-card--closed')} data-testid={`card-opportunity-${o.id}`}>
                <div className="wl-card__top"><bdi className="wl-card__when">{fmtWhen(o.startsAt, o.endsAt)}</bdi>
                  <span className={`wl-badge wl-badge--${o.status}`} data-testid={`status-opportunity-${o.id}`}>{t(`opp.status.${o.status}`)}</span></div>
                {o.status === 'exhausted' && <p className="bk-hint">{t('opp.exhaustedHint')}</p>}
                {o.status === 'unavailable' && <p className="bk-hint">{t('opp.unavailableHint')}</p>}
              </li>))}</ul>
          )}
        </section>

        <section className="wl-section" aria-labelledby="wl-entries-h">
          <h2 id="wl-entries-h" className="wl-section__h">{t('sections.entries')}<span className="wl-count">{entries.filter((e) => e.status === 'active').length}</span></h2>
          {entries.length === 0 ? <div data-testid="status-entries-empty"><EmptyState title={t('empty.entries.title')} description={t('empty.entries.body')} headingLevel={3}
            actions={<button type="button" className="bk-btn bk-btn--primary" disabled={!online} onClick={() => setAdding(true)} data-testid="button-empty-add-waitlist"><ListPlus size={18} aria-hidden="true" />{t('add')}</button>} /></div> : (
            <ul className="wl-list">{entries.map((e) => (
              <li key={e.id} className={'wl-card' + (e.status === 'fulfilled' ? ' wl-card--closed' : '')} data-testid={`card-entry-${e.id}`}>
                <div className="wl-card__top"><bdi className="wl-card__name" dir="auto">{e.patientName}</bdi><span className="bk-hint">{t('entry.patientId', { id: e.patientId })}</span>
                  <span className={`wl-badge wl-badge--${e.status === 'active' ? 'active' : 'fulfilled'}`}>{t(`entry.status.${e.status}`)}</span></div>
                <dl className="wl-dl">
                  <dt>{t('entry.doctor')}</dt><dd><bdi dir="auto">{e.doctorName}</bdi></dd>
                  <dt>{t('entry.days')}</dt><dd>{[...e.weekdays].sort().map((d) => t(`wd.${d}`)).join('، ')}</dd>
                  <dt>{t('entry.window')}</dt><dd><bdi dir="ltr">{e.windowStart}–{e.windowEnd}</bdi></dd>
                </dl>
                <p className="bk-hint">{t('entry.requested', { time: formatInstant(e.requestedAt, locale, dp) })}</p>
              </li>))}</ul>
          )}
        </section>
      </>}
      {adding && <AddToWaitlistDialog clinicId={clinic.id} patients={patients} retained={createRetained} onRetain={setCreateRetained} onClose={(c) => { setAdding(false); if (c) setAdded(true); }} />}
    </>
  );
}

type Check = { kind: 'idle' } | { kind: 'checking' } | { kind: 'done'; preview: ConflictPreview } | { kind: 'error' };
type Decision = { decision: 'accept' | 'decline'; overrideReason?: string };
export interface OfferMemo { offer: WaitlistOffer | null; pending: Attempt<Decision> | null; outcome: WaitlistOffer | null }

function OfferCard({ offer, memo, onMemo, serverNowMs, online, clinicId, fmtWhen }: { offer: WaitlistOffer; memo: OfferMemo | null; onMemo: (m: Partial<OfferMemo> | null) => void; serverNowMs: number; online: boolean; clinicId: number; fmtWhen: (s: string, e: string) => string }) {
  const { t } = useTranslation('wl');
  const { locale, digitPreference: dp } = useAmalPreferences();
  const qc = useQueryClient();
  const [check, setCheck] = useState<Check>({ kind: 'idle' });
  const [conflictOpen, setConflictOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = memo?.pending ?? null;
  const [rejected, setRejected] = useState(false);
  const outcome = memo?.outcome ?? null;
  const [suggestNote, setSuggestNote] = useState(false);
  const keeper = useRef(createAttemptKeeper<Decision>()).current;
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const checkM = useCheckWaitlistOffer(); const checkRef = useRef(checkM.mutateAsync); checkRef.current = checkM.mutateAsync;
  const memoRef = useRef(onMemo); memoRef.current = onMemo;
  const decideM = useDecideWaitlistOffer(); const decideRef = useRef(decideM.mutateAsync); decideRef.current = decideM.mutateAsync;

  const shown = outcome ?? offer;
  const gate = offerGate(shown, serverNowMs, online);
  const canAct = gate === 'ok' && !busy && !pending && !outcome;
  const preview = check.kind === 'done' ? check.preview : null;
  const summary = preview ? summarize(preview) : null;
  const cleanReason = ack ? reason.trim() : '';
  const canBook = commitAllowed(preview, cleanReason);
  const warn = notificationWarning(shown);
  const left = remainingSeconds(shown.expiresAt, serverNowMs);

  const runCheck = async () => {
    if (!canAct) return;
    setCheck({ kind: 'checking' }); setRejected(false); setAck(false); setReason(''); setReasonTouched(false);
    try {
      const p = await checkRef.current({ id: offer.id, data: {} });
      if (!alive.current) return;
      setCheck({ kind: 'done', preview: p });
      if (p.conflicts.length) setConflictOpen(true);
    } catch { if (alive.current) setCheck({ kind: 'error' }); }
  };

  const send = async (attempt: Attempt<Decision>) => {
    if (!online || busy) return;
    setBusy(true); setRejected(false);
    try {
      const res = await decideRef.current({ id: offer.id, data: { ...attempt.payload, clientOpId: attempt.clientOpId } });
      // Server result is authoritative (may be terminal expired/unavailable); recorded even if this card unmounted.
      keeper.clear(); memoRef.current({ offer, pending: null, outcome: res });
      if (alive.current) setCheck({ kind: 'idle' });
      void qc.invalidateQueries({ predicate: (x) => isAffectedByDecision(x.queryKey) });
      if (res.status === 'accepted') window.dispatchEvent(new CustomEvent(APPOINTMENTS_CHANGED, { detail: { kind: 'waitlist', appointmentId: res.appointmentId } }));
    } catch (e) {
      const f = classifyError(e);
      if (isUncertain(f.status)) { memoRef.current({ offer, pending: attempt }); return; }
      keeper.clear(); memoRef.current(null);
      if (alive.current) { setRejected(true); setCheck({ kind: 'idle' }); }
      void qc.invalidateQueries({ predicate: (x) => isWaitlistKey(x.queryKey) });
    } finally { if (alive.current) setBusy(false); }
  };
  const decide = (d: Decision) => {
    if (!canAct) return;
    if (d.decision === 'accept' && !canBook) return;
    void send(keeper.begin(d.decision + '|' + (d.overrideReason ?? ''), () => d));
  };

  const st = shown.status;
  return (
    <article className={'wl-card' + (st === 'active' ? ' wl-card--active' : ' wl-card--closed')} data-testid={`card-offer-${offer.id}`} aria-labelledby={`wl-offer-${offer.id}`}>
      <div className="wl-card__top">
        <bdi id={`wl-offer-${offer.id}`} className="wl-card__name" dir="auto">{offer.patientName}</bdi>
        <span className={`wl-badge wl-badge--${st}`} data-testid={`status-offer-${offer.id}`}>{t(`offer.status.${st}`)}</span>
        <span className={`wl-badge wl-badge--${shown.notificationStatus}`} data-testid={`status-offer-notification-${offer.id}`}>{warn === 'suppressed' || warn === 'cancelled' ? <BellOff size={14} aria-hidden="true" /> : null}{t(`offer.notif.${shown.notificationStatus}`)}</span>
      </div>
      <dl className="wl-dl">
        <dt>{t('offer.slot')}</dt><dd className="wl-card__when" data-testid={`text-offer-when-${offer.id}`}><bdi>{fmtWhen(offer.startsAt, offer.endsAt)}</bdi></dd>
        <dt>{t('entry.doctor')}</dt><dd><bdi dir="auto">{offer.doctorName}</bdi></dd>
        <dt>{t('offer.patientIdLabel')}</dt><dd>{offer.patientId}</dd>
      </dl>
      <p className="bk-hint">
        {t('offer.offered', { time: formatInstant(offer.createdAt, locale, dp) })} · <span data-testid={`text-offer-expiry-${offer.id}`}>{t('offer.expires', { time: formatInstant(offer.expiresAt, locale, dp) })}</span>
        {st === 'active' && left > 0 && <> · <span aria-live="off">{t('offer.remaining', { m: Math.floor(left / 60), s: left % 60 })}</span></>}
      </p>
      {warn && st === 'active' && <div className={`bk-msg bk-msg--${warn === 'pending' ? 'info' : 'warn'}`} data-testid={`status-offer-notif-warning-${offer.id}`}>
        <TriangleAlert size={20} aria-hidden="true" /><div className="bk-msg__body"><p>{t(`offer.notifWarn.${warn}`)}</p>
          {shown.notificationReason && <p className="bk-hint">{t(notificationReasonKey(shown.notificationReason))}</p>}</div></div>}
      {!warn && shown.notificationReason && <p className="bk-hint">{t(notificationReasonKey(shown.notificationReason))}</p>}

      {outcome && <div className={`bk-msg bk-msg--${outcome.status === 'accepted' ? 'ok' : outcome.status === 'declined' ? 'info' : 'block'}`} role="status" data-testid={`status-offer-outcome-${offer.id}`}>
        {outcome.status === 'accepted' ? <CheckCircle2 size={20} aria-hidden="true" /> : <XCircle size={20} aria-hidden="true" />}
        <div className="bk-msg__body"><p>{t(`offer.outcome.${outcome.status}`, { id: outcome.appointmentId ?? '' })}</p></div></div>}

      {!outcome && st === 'active' && gate !== 'ok' && !pending && <div className="bk-msg bk-msg--warn" role="status" data-testid={`status-offer-gate-${offer.id}`}><AlertTriangle size={20} aria-hidden="true" /><div className="bk-msg__body"><p>{t(`offer.gate.${gate}`)}</p></div></div>}

      {!outcome && st === 'active' && <div aria-live="polite">
        {check.kind === 'checking' && <div className="bk-msg bk-msg--muted"><Loader2 size={20} aria-hidden="true" /><div className="bk-msg__body"><p>{t('offer.checking')}</p></div></div>}
        {check.kind === 'error' && <div className="bk-msg bk-msg--block" data-testid={`status-offer-check-error-${offer.id}`}><AlertTriangle size={20} aria-hidden="true" /><div className="bk-msg__body"><p>{t('offer.checkError')}</p>
          <button type="button" className="bk-btn bk-btn--sm" disabled={!canAct} onClick={() => void runCheck()}><RotateCcw size={16} aria-hidden="true" />{t('retry')}</button></div></div>}
        {summary && (summary.blocking.length ? <div className="bk-msg bk-msg--block" data-testid={`status-offer-check-blocked-${offer.id}`}><Ban size={20} aria-hidden="true" /><div className="bk-msg__body"><p>{t('offer.checkBlocked')}</p></div></div>
          : summary.warnings.length ? <div className="bk-msg bk-msg--warn" data-testid={`status-offer-check-warn-${offer.id}`}><TriangleAlert size={20} aria-hidden="true" /><div className="bk-msg__body"><p>{t('offer.checkWarn')}</p>
              {cleanReason && <p className="bk-hint">{t('offer.reasonLabel')}: <bdi dir="auto">{cleanReason}</bdi></p>}
              <button type="button" className="bk-btn bk-btn--sm" onClick={() => setConflictOpen(true)} data-testid="button-review-conflicts">{t('offer.review')}</button></div></div>
          : <div className="bk-msg bk-msg--ok" data-testid={`status-offer-check-ok-${offer.id}`}><CheckCircle2 size={20} aria-hidden="true" /><div className="bk-msg__body"><p>{t('offer.checkOk')}</p></div></div>)}
        {suggestNote && <p className="bk-hint">{t('offer.suggestNote')}</p>}
        {rejected && <div className="bk-msg bk-msg--block" role="alert" data-testid={`status-offer-rejected-${offer.id}`}><AlertTriangle size={20} aria-hidden="true" /><div className="bk-msg__body"><p>{t('offer.rejected')}</p></div></div>}
      </div>}

      {pending && !outcome && <div className="bk-msg bk-msg--block" role="alert" data-testid={`status-offer-uncertain-${offer.id}`}><AlertTriangle size={20} aria-hidden="true" />
        <div className="bk-msg__body"><p>{t('offer.uncertain')}</p>
          <button type="button" className="bk-btn bk-btn--sm" disabled={busy || !online} onClick={() => void send(pending)} data-testid={`button-offer-retry-${offer.id}`}><RotateCcw size={16} aria-hidden="true" />{t('offer.retry')}</button>
          {!online && <p className="bk-hint">{t('offer.offlineRetry')}</p>}</div></div>}

      {!outcome && st === 'active' && !pending && <div className="wl-actions">
        {preview && canBook
          ? <button type="button" className="bk-btn bk-btn--primary" disabled={!canAct} aria-busy={busy} onClick={() => decide({ decision: 'accept', ...(cleanReason ? { overrideReason: cleanReason } : {}) })} data-testid={`button-offer-confirm-${offer.id}`}>
              {busy ? <><Loader2 size={18} aria-hidden="true" />{t('offer.sending')}</> : <><CheckCircle2 size={18} aria-hidden="true" />{t('offer.confirm')}</>}</button>
          : <button type="button" className="bk-btn bk-btn--primary" disabled={!canAct || check.kind === 'checking'} onClick={() => void runCheck()} data-testid={`button-offer-accept-${offer.id}`}><CheckCircle2 size={18} aria-hidden="true" />{t('offer.accept')}</button>}
        <button type="button" className="bk-btn" disabled={!canAct} onClick={() => decide({ decision: 'decline' })} data-testid={`button-offer-decline-${offer.id}`}><XCircle size={18} aria-hidden="true" />{t('offer.decline')}</button>
      </div>}

      {preview && !outcome && (
        <ConflictDialog open={conflictOpen} onOpenChange={setConflictOpen} preview={preview} clinicId={clinicId} doctorName={offer.doctorName}
          whenLabel={fmtWhen(offer.startsAt, offer.endsAt)} formatSlot={(s) => fmtWhen(s.startsAt, s.endsAt)} ack={ack} onAck={setAck} reason={reason}
          onReason={(v) => { setReason(v); setReasonTouched(true); }} reasonError={!!(summary?.overrideable && ack && reasonTouched && !reason.trim())}
          onPick={() => { setConflictOpen(false); setSuggestNote(true); }} />
      )}
    </article>
  );
}

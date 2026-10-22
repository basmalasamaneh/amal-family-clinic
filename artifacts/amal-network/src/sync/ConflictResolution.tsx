import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, ArrowLeftRight, CalendarClock, Phone, RotateCw, X } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import { arSA, enUS } from 'date-fns/locale';
import { Button, useAmalPreferences } from '@workspace/amal-ui';
import { getListAppointmentsQueryKey, listAppointments } from '@workspace/api-client-react';
import type {
  Appointment, ConflictItemSuggestedSlotsItem, ResolutionInput, SyncConflict, SyncResolutionResult,
} from '@workspace/api-client-react';
import type { BookingProposal, ResolutionIntent } from '@/offline/types';
import { syncClient } from './client';
import { reasonCode } from './messages';
import {
  explicitOtherRef, gateCall, gateMoveOther, gateMoveSelf, isConflictItem, sanitizePhone, validateOtherDestination, verifyOther,
  type GateInput, type GateReason, type OtherRef,
} from './resolution-model';

const TZ = 'Asia/Hebron';
const MAX_PAGES = 20;

export function useFormatWhen() {
  const { locale, digitPreference } = useAmalPreferences();
  return (iso: string | null | undefined) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    let s = formatInTimeZone(d, TZ, 'EEE d MMM, HH:mm', { locale: locale === 'ar' ? arSA : enUS });
    if (digitPreference === 'latn' || locale === 'en') s = s.replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660));
    return s;
  };
}

function slotKey(s: ConflictItemSuggestedSlotsItem) { return `${s.startsAt}|${s.endsAt}`; }

/** Pages listAppointments over the proposed interval; returns only the exact referenced appointment. */
async function fetchOther(clinicId: number, from: string, to: string, id: number, signal: AbortSignal): Promise<Appointment | null> {
  let cursor: string | undefined;
  // List filters appointment starts, not interval overlap. Durations are bounded
  // to 24h, so include a collision that started before the proposed interval.
  const overlapFrom = new Date(Date.parse(from) - 86_400_000).toISOString();
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await listAppointments({ clinicId, from: overlapFrom, to, limit: 100, ...(cursor ? { cursor } : {}) }, { signal });
    const hit = page.items.find((a) => a.id === id);
    if (hit) return hit;
    if (!page.nextCursor) return null;
    cursor = page.nextCursor;
  }
  return null;
}

type Pending =
  | { kind: 'move'; slot: ConflictItemSuggestedSlotsItem }
  | { kind: 'keep'; startsAt: string; endsAt: string; other: Appointment }
  | { kind: 'call' };

type Msg = { tone: 'ok' | 'bad' | 'info'; text: string } | null;

export function ConflictResolution({ conflict, proposal, intent, clinicId, locked, announce }: {
  conflict: SyncConflict;
  proposal: BookingProposal | undefined;
  intent: ResolutionIntent | undefined;
  clinicId: number;
  locked: boolean;
  announce: (text: string) => void;
}) {
  const { t } = useTranslation('sync');
  const fmt = useFormatWhen();
  const uid = useId();
  const [moveSlot, setMoveSlot] = useState<string | null>(null);
  const [destDate, setDestDate] = useState('');
  const [destTime, setDestTime] = useState('');
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  // Ephemeral phone: memory only, cleared on lock, unmount, or scope change (parent keys by scope).
  const [phone, setPhone] = useState<{ value: string | null } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (locked) { setPhone(null); setConfirm(null); } }, [locked]);

  const payload = conflict.operation.payload as Partial<{ startsAt: string; endsAt: string; doctorId: number; patientId: number }>;
  const local = proposal?.input ?? payload;
  const identity = { clinicId, doctorId: proposal?.input.doctorId ?? payload.doctorId, patientId: proposal?.input.patientId ?? payload.patientId };

  const codes = useMemo(() => {
    const set = new Set<string>();
    for (const r of conflict.reasons) set.add(reasonCode(isConflictItem(r) ? r.type : (r as { code?: string }).code));
    return [...set];
  }, [conflict.reasons]);
  const slots = useMemo(() => {
    const seen = new Map<string, ConflictItemSuggestedSlotsItem>();
    for (const r of conflict.reasons) if (isConflictItem(r)) for (const s of r.suggestedSlots) seen.set(slotKey(s), s);
    return [...seen.values()];
  }, [conflict.reasons]);

  const refState = explicitOtherRef(conflict, clinicId);
  const ref: OtherRef | null = refState.kind === 'ref' ? refState.ref : null;
  const resolved = conflict.status === 'resolved';
  const canFetch = !!ref && !resolved && !locked && !!local?.startsAt && !!local?.endsAt && clinicId > 0;
  const otherQ = useQuery({
    queryKey: [...getListAppointmentsQueryKey({ clinicId, from: local?.startsAt, to: local?.endsAt }), 'sync-other', ref?.appointmentId, conflict.version],
    queryFn: ({ signal }) => fetchOther(clinicId, local!.startsAt!, local!.endsAt!, ref!.appointmentId, signal),
    enabled: canFetch, staleTime: 0, gcTime: 0, retry: false,
  });
  const other = ref && otherQ.data ? verifyOther(otherQ.data, ref, identity) : null;
  const otherState: GateInput['otherState'] = refState.kind === 'none' ? 'none' : refState.kind === 'hidden' ? 'hidden'
    : otherQ.isLoading ? 'loading' : other ? 'verified' : 'unavailable';

  const dest = other ? validateOtherDestination(destDate, destTime, other, { startsAt: local?.startsAt, endsAt: local?.endsAt }) : null;
  const pendingIntent = intent && intent.status === 'pending' ? intent : undefined;
  const targetExpectedVersion = conflict.targetId && conflict.baseVersion ? conflict.baseVersion : undefined;
  const chosenMove = slots.find((s) => slotKey(s) === moveSlot) ?? null;

  const gate: GateInput = { resolved, locked, busy, pendingIntent: !!pendingIntent, slotCount: slots.length, moveSelected: !!chosenMove, otherState, destValid: !!dest?.ok };
  const gMove = gateMoveSelf(gate); const gKeep = gateMoveOther(gate); const gCall = gateCall(gate);
  const why = (g: GateReason, which: 'move' | 'keep'): string | null => {
    switch (g) {
      case null: case 'resolved': case 'busy': return null;
      case 'locked': return t('lockedConflicts');
      case 'pendingIntent': return t('pendingTitle');
      case 'noSlots': return t('moveUnavailable');
      case 'noOther': return t('keepUnavailableNone');
      case 'otherHidden': return t('keepUnavailableHidden');
      case 'otherLoading': return t('otherLoading');
      case 'otherUnavailable': return t('otherUnavailable');
      case 'noSelection': return which === 'keep' && dest && !dest.ok ? t(`dest.${dest.error}`) : t('noSelection');
    }
  };

  function handleResult(r: SyncResolutionResult) {
    if (!mounted.current) return;
    if (r.status === 'resolved') { setMsg({ tone: 'ok', text: t('result.resolved') }); announce(t('result.resolved')); }
    else if (r.status === 'follow-up') {
      setPhone({ value: sanitizePhone(r.phone) });
      setMsg({ tone: 'info', text: t('notCalled') }); announce(t('result.followUp'));
    } else { setMsg({ tone: 'bad', text: t('result.open') }); announce(t('result.open')); syncClient.refresh(); }
  }
  async function run(fn: () => Promise<SyncResolutionResult>) {
    setBusy(true); setMsg(null);
    try { handleResult(await fn()); }
    catch { if (mounted.current) { setMsg({ tone: 'bad', text: t('result.failed') }); announce(t('result.failed')); } syncClient.refresh(); }
    finally { if (mounted.current) setBusy(false); }
  }

  function submit(p: Pending) {
    setConfirm(null);
    if (locked) return;
    // UUID generated exactly once, on the explicit confirmed action. Retries reuse the stored intent.
    const clientOpId = crypto.randomUUID();
    const base = { clientOpId, conflictId: conflict.id, expectedVersion: conflict.version };
    const tev = targetExpectedVersion ? { targetExpectedVersion } : {};
    let input: ResolutionInput;
    if (p.kind === 'call') input = { ...base, action: 'call' };
    else if (p.kind === 'move') input = { ...base, action: 'move-self', startsAt: p.slot.startsAt, endsAt: p.slot.endsAt, ...tev };
    else input = { ...base, action: 'move-other', startsAt: p.startsAt, endsAt: p.endsAt, otherAppointmentId: p.other.id, otherExpectedVersion: p.other.version, ...tev };
    void run(() => syncClient.resolve(input));
  }

  const headingId = `${uid}-h`;
  const moveWhy = why(gMove, 'move'); const keepWhy = why(gKeep, 'keep');

  return (
    <article className="cr" aria-labelledby={headingId} data-testid={`card-conflict-${conflict.id}`}>
      <header className="cr__head">
        <AlertTriangle size={18} aria-hidden="true" />
        <h3 className="cr__title" id={headingId}>{proposal ? proposal.patient.name : t('local')}</h3>
        <span className="sync-chip" data-s={resolved ? 'acknowledged' : 'conflict'}><ArrowLeftRight size={14} aria-hidden="true" />{resolved ? t('resolvedBadge') : t('status.conflict')}</span>
      </header>

      <div className="cr__compare">
        <section className="cr__col cr__col--local" aria-label={t('local')}>
          <p className="cr__cap">{t('local')}</p>
          <dl className="cr__dl">
            {proposal && <><dt>{t('patient')}</dt><dd>{proposal.patient.name}</dd><dt>{t('doctor')}</dt><dd>{proposal.doctor.name}</dd></>}
            <dt>{t('when')}</dt><dd>{fmt(local?.startsAt)}</dd>
          </dl>
          <p className="cr__note">{t('localNote')}</p>
        </section>
        <section className="cr__col" aria-label={t('server')}>
          <p className="cr__cap">{t('server')}</p>
          {conflict.serverState ? (
            <dl className="cr__dl"><dt>{t('when')}</dt><dd>{fmt(conflict.serverState.startsAt)}</dd><dt>{t('version', { n: '' }).trim()}</dt><dd>{conflict.serverState.version}</dd></dl>
          ) : <p className="cr__muted">{t('serverNone')}</p>}
        </section>
        <section className="cr__col" aria-label={t('other')} aria-busy={otherState === 'loading' || undefined}>
          <p className="cr__cap">{t('other')}</p>
          {other ? (
            <>
              <dl className="cr__dl"><dt>{t('when')}</dt><dd>{fmt(other.startsAt)}</dd><dt>{t('version', { n: '' }).trim()}</dt><dd data-testid={`text-other-version-${conflict.id}`}>{other.version}</dd></dl>
              <p className="cr__note">{t('otherVerified')}</p>
            </>
          ) : otherState === 'loading' ? <div className="sync-skel" role="status" aria-label={t('otherLoading')} />
            : <p className="cr__muted">{otherState === 'none' ? t('otherNone') : otherState === 'hidden' ? t('otherHidden') : t('otherUnavailable')}</p>}
        </section>
      </div>

      <ul className="cr__reasons" aria-label={t('reasons')}>
        {codes.map((c) => <li key={c}><AlertTriangle size={14} aria-hidden="true" />{t(`reason.${c}`)}</li>)}
      </ul>

      {pendingIntent && !locked && (
        <div className="cr__pending" role="status">
          <p><strong>{t('pendingTitle')}</strong><br />{t('pendingBody')}</p>
          <Button variant="secondary" startIcon={<RotateCw size={16} aria-hidden="true" />} loading={busy}
            onClick={() => run(() => syncClient.retryResolution(pendingIntent.clientOpId))}
            data-testid={`button-retry-intent-${conflict.id}`}>{t('pendingRetry')}</Button>
        </div>
      )}

      {!resolved && (
        <div className="cr__actions" role="group" aria-label={t('actionsTitle')}>
          <div className="cr__action">
            <Button variant="primary" startIcon={<ArrowLeftRight size={16} aria-hidden="true" />} disabled={gKeep !== null}
              aria-describedby={keepWhy ? `${uid}-keep` : undefined}
              onClick={() => other && dest?.ok && setConfirm({ kind: 'keep', startsAt: dest.startsAt, endsAt: dest.endsAt, other })}
              data-testid={`button-keep-${conflict.id}`}>{t('keep')}</Button>
            {other && (
              <fieldset className="cr__slots" disabled={gate.locked || gate.busy || gate.pendingIntent}>
                <legend>{t('destTitle')}</legend>
                <label className="amal-field__label">{t('destDate')}
                  <input className="cr__slot" type="date" value={destDate} onChange={(e) => setDestDate(e.target.value)} data-testid={`input-dest-date-${conflict.id}`} />
                </label>
                <label className="amal-field__label">{t('destTime')}
                  <input className="cr__slot" type="time" dir="ltr" step={300} value={destTime} onChange={(e) => setDestTime(e.target.value)} data-testid={`input-dest-time-${conflict.id}`} />
                </label>
                {dest?.ok && dest.ambiguous && <p className="cr__why">{t('destAmbiguous')}</p>}
              </fieldset>
            )}
            {keepWhy && <p className="cr__why" id={`${uid}-keep`}>{keepWhy}</p>}
          </div>
          <div className="cr__action">
            <Button variant="secondary" startIcon={<CalendarClock size={16} aria-hidden="true" />} disabled={gMove !== null}
              aria-describedby={moveWhy ? `${uid}-move` : undefined}
              onClick={() => chosenMove && setConfirm({ kind: 'move', slot: chosenMove })}
              data-testid={`button-move-${conflict.id}`}>{t('move')}</Button>
            {slots.length > 0 && (
              <fieldset className="cr__slots" disabled={gate.locked || gate.busy || gate.pendingIntent}>
                <legend>{t('pickSlot')}</legend>
                {slots.map((s, i) => (
                  <label key={slotKey(s)} className="cr__slot">
                    <input type="radio" name={`${uid}-m`} checked={moveSlot === slotKey(s)} onChange={() => setMoveSlot(slotKey(s))} data-testid={`radio-move-${conflict.id}-${i}`} />
                    <time dateTime={s.startsAt}>{fmt(s.startsAt)}</time>
                  </label>
                ))}
              </fieldset>
            )}
            {moveWhy && <p className="cr__why" id={`${uid}-move`}>{moveWhy}</p>}
          </div>
          <div className="cr__action">
            <Button variant="ghost" startIcon={<Phone size={16} aria-hidden="true" />} disabled={gCall !== null}
              onClick={() => setConfirm({ kind: 'call' })} data-testid={`button-call-${conflict.id}`}>{t('call')}</Button>
          </div>
        </div>
      )}

      {phone && !locked && (
        <div className="cr__phone" data-testid={`panel-phone-${conflict.id}`}>
          <span>{t('phoneLabel')}</span>
          {phone.value
            ? <a className="cr__tel" href={`tel:${phone.value}`} aria-label={t('phoneDial', { phone: phone.value })} data-testid={`link-tel-${conflict.id}`}><Phone size={16} aria-hidden="true" /><bdi>{phone.value}</bdi></a>
            : <span className="cr__muted">{t('phoneUnavailable')}</span>}
          <Button variant="ghost" size="sm" onClick={() => setPhone(null)} data-testid={`button-clear-phone-${conflict.id}`}>{t('phoneClear')}</Button>
        </div>
      )}

      {msg && <p className="cr__msg" data-tone={msg.tone} role={msg.tone === 'bad' ? 'alert' : undefined} data-testid={`status-resolution-${conflict.id}`}>{msg.text}</p>}

      {conflict.history.length > 0 && (
        <details className="cr__history">
          <summary>{t('history')} ({conflict.history.length})</summary>
          <ol>
            {conflict.history.map((h) => (
              <li key={h.id}>{t(`historyAction.${h.action}`)} · {t(`historyResult.${h.result.status}`)}<time dateTime={h.createdAt}>{fmt(h.createdAt)}</time></li>
            ))}
          </ol>
        </details>
      )}

      <Dialog.Root open={!!confirm && !locked} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="shell-overlay" />
          <Dialog.Content className="shell-dialog cr-confirm" data-testid={`dialog-confirm-${conflict.id}`}>
            <div className="shell-dialog__head">
              <Dialog.Title className="shell-dialog__title">
                {confirm?.kind === 'keep' ? t('confirmKeepTitle') : confirm?.kind === 'move' ? t('confirmMoveTitle') : t('confirmCallTitle')}
              </Dialog.Title>
              <Dialog.Close asChild><Button variant="ghost" iconOnly aria-label={t('cancel')}><X size={18} aria-hidden="true" /></Button></Dialog.Close>
            </div>
            <Dialog.Description asChild>
              <div>
                {confirm?.kind === 'keep' && <ul><li>{t('confirmKeepThis', { when: fmt(local?.startsAt) })}</li><li>{t('confirmKeepOther', { v: confirm.other.version, when: fmt(confirm.startsAt) })}</li></ul>}
                {confirm?.kind === 'move' && <p>{t('confirmMoveBody', { when: fmt(confirm.slot.startsAt) })}</p>}
                {confirm?.kind === 'call' && <p>{t('confirmCallBody')}</p>}
              </div>
            </Dialog.Description>
            <div className="cr-confirm__foot">
              <Dialog.Close asChild><Button variant="secondary" data-testid="button-confirm-cancel">{t('cancel')}</Button></Dialog.Close>
              <Button variant="primary" onClick={() => confirm && submit(confirm)} data-testid="button-confirm-ok">{t('confirm')}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </article>
  );
}

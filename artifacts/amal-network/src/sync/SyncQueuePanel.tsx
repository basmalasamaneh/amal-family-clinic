import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Lock, RefreshCcw, RotateCw, WifiOff } from 'lucide-react';
import { Button, EmptyState } from '@workspace/amal-ui';
import type { BookingProposal, OutboxRecord } from '@/offline/types';
import type { ShellClinic } from '@/shell/identity';
import { syncClient } from './client';
import { ConflictResolution, useFormatWhen } from './ConflictResolution';
import './messages';
import './sync.css';

type RowState = 'waiting' | 'syncing' | 'acknowledged' | 'conflict' | 'retry' | 'dependent' | 'rejected';
const COUNT_KEYS = ['waiting', 'syncing', 'retry', 'dependent', 'conflict', 'acknowledged'] as const;

function rowState(p: BookingProposal, ob: OutboxRecord | undefined): RowState {
  if (p.outcome === 'applied') return 'acknowledged';
  if (p.outcome === 'conflict') return 'conflict';
  if (p.outcome === 'blocked') return 'dependent';
  if (p.outcome === 'rejected') return 'rejected';
  if (ob?.status === 'processing') return 'syncing';
  if (ob && (ob.status === 'failed' || ob.retryAt || ob.attempts > 0)) return 'retry';
  return 'waiting';
}

export function SyncQueuePanel({ clinic, title, scope }: { clinic: ShellClinic | null; title: string; scope: string }) {
  const { t } = useTranslation('sync');
  const fmt = useFormatWhen();
  const snap = useSyncExternalStore(syncClient.subscribe, syncClient.getSnapshot);
  const [live, setLive] = useState('');
  const announce = useCallback((text: string) => { setLive(''); requestAnimationFrame(() => setLive(text)); }, []);

  const prevPhase = useRef(snap.phase);
  useEffect(() => {
    if (prevPhase.current !== snap.phase) { prevPhase.current = snap.phase; announce(t(`phase.${snap.phase}`)); }
  }, [snap.phase, announce, t]);

  const rows = useMemo(() => {
    const byOp = new Map(snap.outbox.map((o) => [o.operationId, o]));
    let blocked = false;
    return [...snap.bookings].sort((a, b) => a.sequence - b.sequence).map((p) => {
      const state = rowState(p, byOp.get(p.operationId));
      const s = blocked && state !== 'acknowledged' && state !== 'conflict' && state !== 'rejected' ? 'dependent' as const : state;
      if (state !== 'acknowledged') blocked = true;
      return { p, s };
    });
  }, [snap.bookings, snap.outbox]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) { const k = r.s === 'rejected' ? 'conflict' : r.s; c[k] = (c[k] ?? 0) + 1; }
    return c;
  }, [rows]);

  const proposalFor = useMemo(() => {
    const m = new Map(snap.bookings.map((b) => [b.input.clientOpId, b]));
    return (opId: string) => m.get(opId);
  }, [snap.bookings]);
  const intentFor = useMemo(() => {
    const m = new Map(snap.intents.filter((i) => i.status === 'pending').map((i) => [i.conflictId, i]));
    return (id: string) => m.get(id);
  }, [snap.intents]);

  const loading = snap.phase === 'loading';
  const PhaseIcon = snap.phase === 'offline' ? WifiOff : snap.phase === 'locked' ? Lock : snap.phase === 'error' ? AlertCircle : snap.phase === 'syncing' ? RefreshCcw : CheckCircle2;
  const errText = snap.error ? t(`error.${snap.error}`, { defaultValue: t('error.generic') }) : null;
  const openConflicts = snap.conflicts.filter((c) => c.status === 'open').length;

  return (
    <section className="shell-page sync" aria-labelledby="sync-title" data-testid="page-sync">
      <div className="sync-head">
        <p className="shell-page__eyebrow">{t('eyebrow')}</p>
        <h1 className="shell-page__title" id="sync-title" tabIndex={-1}>{title}</h1>
        <p className="shell-page__body">{t('lede')}</p>
      </div>

      <div className="shell-sr" aria-live="polite" role="status" data-testid="status-live">{live}</div>

      <div className="sync-phase" data-phase={snap.phase} data-testid="status-phase">
        <PhaseIcon size={20} aria-hidden="true" className={snap.phase === 'syncing' ? 'sync-spin' : undefined} />
        <p className="sync-phase__text">
          {t(`phase.${snap.phase}`)}
          {errText && <span className="sync-phase__sub" role="alert">{errText}</span>}
        </p>
        <div className="sync-phase__actions">
          <Button variant="secondary" size="sm" startIcon={<RotateCw size={16} aria-hidden="true" />}
            disabled={snap.phase === 'syncing' || snap.phase === 'locked' || loading}
            onClick={() => { syncClient.retry(); announce(t('phase.syncing')); }} data-testid="button-sync-retry">{t('retry')}</Button>
          <Button variant="ghost" size="sm" startIcon={<RefreshCcw size={16} aria-hidden="true" />}
            disabled={snap.phase === 'locked' || loading} onClick={() => syncClient.refresh()} data-testid="button-sync-refresh">{t('refresh')}</Button>
        </div>
      </div>

      <ul className="sync-counts" aria-label={t('queueTitle')}>
        {COUNT_KEYS.map((k) => (
          <li key={k} className="sync-count" data-tone={k === 'conflict' ? 'conflict' : k === 'acknowledged' ? 'ack' : undefined}>
            <span className="sync-count__n" data-testid={`count-${k}`}>{loading ? '–' : counts[k] ?? 0}</span>
            <span className="sync-count__l">{t(`counts.${k}`)}</span>
          </li>
        ))}
      </ul>

      <section aria-labelledby="sync-conflicts-h">
        <h2 className="sync-h" id="sync-conflicts-h">{t('conflictsTitle')}<span className="sync-h__badge">{openConflicts}</span></h2>
        {snap.phase === 'locked' ? <div className="sync-empty" data-testid="locked-conflicts"><strong>{t('lockedConflicts')}</strong></div>
          : loading ? <div className="sync-skels" aria-hidden="true"><div className="sync-skel" style={{ blockSize: 180 }} /></div>
          : snap.conflicts.length === 0 ? <div data-testid="empty-conflicts"><EmptyState className="amal-empty--compact" title={t('conflictsEmpty')} description={t('conflictsEmptyHint')} /></div>
          : snap.conflicts.map((c) => (
            <ConflictResolution key={`${scope}:${c.id}`} conflict={c} proposal={proposalFor(c.clientOpId)} intent={intentFor(c.id)} clinicId={clinic?.id ?? 0} locked={false} announce={announce} />
          ))}
      </section>

      <section aria-labelledby="sync-queue-h">
        <h2 className="sync-h" id="sync-queue-h">{t('queueTitle')}<span className="sync-h__badge">{rows.length}</span></h2>
        {loading ? (
          <div className="sync-skels" role="status" aria-busy="true" aria-label={t('phase.loading')}>{[0, 1, 2].map((i) => <div key={i} className="sync-skel" />)}</div>
        ) : rows.length === 0 ? (
          <div data-testid="empty-queue"><EmptyState className="amal-empty--compact" title={t('queueEmpty')} description={t('queueEmptyHint')} /></div>
        ) : (
          <ol className="sync-list">
            {rows.map(({ p, s }) => (
              <li key={p.operationId} className="sync-row" data-testid={`row-booking-${p.operationId}`}>
                <span className="sync-row__seq">{t('sequence', { n: p.sequence })}</span>
                <span className="sync-row__main">
                  <span className="sync-row__who">{p.patient.name} · {p.doctor.name}</span>
                  <time className="sync-row__when" dateTime={p.input.startsAt}>{fmt(p.input.startsAt)}</time>
                </span>
                <span className="sync-chip" data-s={s} data-testid={`status-booking-${p.operationId}`}><RefreshCcw size={14} aria-hidden="true" />{t(`status.${s}`)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}

export default SyncQueuePanel;

import { useEffect, useState, useSyncExternalStore } from 'react';
import Dexie from 'dexie';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { AlertTriangle, LoaderCircle, LockKeyhole, Wifi, WifiOff } from 'lucide-react';
import { useAmalPreferences } from '@workspace/amal-ui';
import { localCache } from '../offline';
import { useOnlineStatus } from '../hooks/use-online-status';
import { connectionState, summarizeQueue, type QueueSummary } from './connection-model';
import { formatNumber } from './formatting';
import { demoPath } from './identity';
import './connection-messages';
import { isDemoReachable, subscribeDemoReachability } from '../auth/demo-context';

type Load = { scope: string; state: 'loading' | 'locked' | 'error' | 'ready'; counts: QueueSummary | null };
export function ConnectionStatus({ userId, clinicId, queueAvailable }: { userId: string; clinicId: number | null; queueAvailable: boolean }) {
  const { t } = useTranslation('connection');
  const { locale, digitPreference } = useAmalPreferences();
  const online = useOnlineStatus();
  const reachable = useSyncExternalStore(subscribeDemoReachability, isDemoReachable, isDemoReachable);
  const scope = `${userId}:${clinicId}`;
  const [load, setLoad] = useState<Load>({ scope, state: 'loading', counts: null });
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let activeGeneration: number | undefined;
    let subscription: { unsubscribe(): void } | undefined;
    const restart = () => {
      const run = ++generation;
      subscription?.unsubscribe();
      subscription = undefined;
      activeGeneration = undefined;
      const ticket = localCache.captureScope();
      if (!ticket.ok || ticket.value.userId !== userId || ticket.value.clinicId !== clinicId) {
        setLoad({ scope, state: 'locked', counts: null }); return;
      }
      setLoad({ scope, state: 'loading', counts: null });
      activeGeneration = ticket.value.generation;
      let readId = 0;
      const refresh = async () => {
        const request = ++readId;
        try {
        const [result, sync, bookings, registrations] = await Promise.all([
          localCache.listOutbox(ticket.value), localCache.readSyncState(ticket.value), localCache.listBookings(ticket.value), localCache.listPatientRegistrations(ticket.value),
        ]);
        if (!result.ok) throw new Error(result.error);
        if (!sync.ok) throw new Error(sync.error);
        if (!bookings.ok) throw new Error(bookings.error);
        if (!registrations.ok) throw new Error(registrations.error);
        const counts = summarizeQueue(result.value, bookings.value);
        counts.attention = Math.max(counts.attention, sync.value.conflicts.filter(c => c.status === 'open').length);
        for (const registration of registrations.value) {
          if (registration.status === 'applied') continue;
          counts.waiting++;
          if (registration.status === 'rejected') counts.attention++;
          else counts.pending++;
        }
        if (!disposed && run === generation && request === readId) setLoad({ scope, state: 'ready', counts });
        } catch {
          if (!disposed && run === generation && request === readId) setLoad({ scope, state: 'error', counts: null });
        }
      };
      // The controller uses guarded rw transactions, which cannot run inside a
      // Dexie liveQuery. Observe committed mutations, then use authorized reads.
      const changed = () => { void refresh(); };
      Dexie.on('storagemutated', changed);
      subscription = { unsubscribe: () => { readId++; Dexie.on('storagemutated').unsubscribe(changed); } };
      void refresh();
    };
    const unsubscribe = localCache.subscribeContext(restart);
    const unsubscribeStorage = localCache.subscribeStorage(() => {
      if (localCache.getStorageStatus().state !== 'ready') return;
      const ticket = localCache.captureScope();
      if (ticket.ok && ticket.value.generation !== activeGeneration) restart();
    });
    restart();
    return () => { disposed = true; generation++; subscription?.unsubscribe(); unsubscribe(); unsubscribeStorage(); };
  }, [scope, userId, clinicId]);
  const current = load.scope === scope ? load : { state: 'loading' as const, counts: null };
  const state = connectionState(online && reachable, current.state, current.counts);
  const Icon = state === 'attention' || state === 'error' ? AlertTriangle : state === 'loading' ? LoaderCircle : state === 'locked' ? LockKeyhole : online ? Wifi : WifiOff;
  const queueCounts = current.counts ? [
    t('pending', { n: formatNumber(current.counts.pending, locale, digitPreference) }),
    ...(current.counts.attention ? [t('attentionCount', { n: formatNumber(current.counts.attention, locale, digitPreference) })] : []),
    ...(current.counts.held ? [t('held', { n: formatNumber(current.counts.held, locale, digitPreference) })] : []),
  ].join(' · ') : null;
  return <div className="connection-status">
    <div className="shell-pill" role="status" aria-live="polite" data-testid="status-connection">
      <Icon size={16} aria-hidden="true" /><span>{t(state)}{state !== 'online' && state !== 'offline' && ` · ${t(online ? 'online' : 'offline')}`}{queueCounts && ` · ${queueCounts}`}</span>
    </div>
    <small>{t('caveat')}</small>
    {online && !reachable && <p role="status">{t('offline:demoUnavailable')}</p>}
    {!online && <p>{t('cached')} {t('coverage')}</p>}
    {queueAvailable && current.state === 'ready' && (!online || !!current.counts?.waiting || state === 'attention') &&
      <Link href={demoPath('/desk/sync')}>{t('queue')}</Link>}
  </div>;
}

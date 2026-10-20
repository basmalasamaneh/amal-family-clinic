import { useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { localCache } from '../offline';
import type { ShellIdentity } from './identity';
import './offline-messages';

/** Only a freshly loaded identity can grant access; reconnect alone never unlocks records. */
export function usePrivateCacheContext(identity: ShellIdentity, clinicId: number | null, fixture: boolean) {
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const prune = () => {
      const ticket = localCache.captureScope();
      if (ticket.ok) void localCache.rollover(ticket.value);
    };
    const schedule = () => {
      const date = formatInTimeZone(new Date(), 'Asia/Hebron', 'yyyy-MM-dd');
      const next = new Date(`${date}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      const midnight = fromZonedTime(`${next.toISOString().slice(0, 10)}T00:00:00`, 'Asia/Hebron');
      timer = setTimeout(() => { prune(); schedule(); }, Math.max(1000, midnight.getTime() - Date.now() + 100));
    };
    const valid = !fixture && navigator.onLine && identity.role !== null &&
      identity.clinicsState !== 'error' && identity.clinics.some(c => c.id === clinicId) && identity.expiresAt;
    void localCache.setContext(valid && clinicId !== null ? {
      userId: identity.id, clinicId, authorizedUntil: identity.expiresAt!,
    } : null).then(result => { if (!disposed && result.ok) prune(); });
    const lock = () => { void localCache.setContext(null); };
    const visible = () => { if (document.visibilityState === 'visible') prune(); };
    window.addEventListener('offline', lock);
    document.addEventListener('visibilitychange', visible);
    schedule();
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener('offline', lock);
      document.removeEventListener('visibilitychange', visible);
      void localCache.setContext(null);
    };
  }, [identity, clinicId, fixture]);
}

export function PrivateStorageNotice() {
  const { t } = useTranslation();
  const status = useSyncExternalStore(localCache.subscribeStorage, localCache.getStorageStatus, localCache.getStorageStatus);
  if (status.state !== 'error') return null;
  return <p className="shell-fixture" role="status" data-testid="status-private-storage">{t('offline:storage')}</p>;
}

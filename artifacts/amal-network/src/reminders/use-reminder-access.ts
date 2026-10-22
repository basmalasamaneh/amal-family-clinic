import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetReminderClinicPreference } from '@workspace/api-client-react';
import type { ShellIdentity } from '../shell/identity';
import { CAPABILITY_TTL, errorStatus, freshReminderCapability } from './model';

export const REMINDER_REVOKED = 'amal:reminders-revoked';
export function useReminderAccess(identity: ShellIdentity, fixture: boolean) {
  const qc = useQueryClient();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [epoch, setEpoch] = useState(0);
  const [now, setNow] = useState(Date.now);
  const home = identity.homeClinicId;
  const enabled = online && !fixture && !identity.offlineRestored && identity.role === 'doctor' && !!home;
  const pref = useGetReminderClinicPreference(home ?? 0, { query: {
    queryKey: ['reminder-access', identity.id, home, epoch], enabled,
    gcTime: 0, staleTime: 0, retry: false, refetchInterval: 45_000,
    refetchOnWindowFocus: 'always', refetchOnMount: 'always',
  } });
  const allowed = enabled && pref.isFetchedAfterMount && !pref.isError &&
    freshReminderCapability(online, pref.data?.canManage, pref.dataUpdatedAt, Math.max(now, Date.now()));
  useEffect(() => {
    const purge = () => {
      setEpoch((n) => n + 1);
      const filters = { predicate: (q: { queryKey: readonly unknown[] }) => JSON.stringify(q.queryKey).includes('/api/reminders/') };
      void qc.cancelQueries(filters);
      qc.removeQueries(filters);
    };
    const offline = () => { setOnline(false); purge(); };
    const revoked = () => { if (identity.role === 'doctor') purge(); };
    const reconnect = () => { setOnline(true); setEpoch((n) => n + 1); };
    window.addEventListener('offline', offline);
    window.addEventListener('online', reconnect);
    window.addEventListener(REMINDER_REVOKED, revoked);
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', reconnect);
      window.removeEventListener(REMINDER_REVOKED, revoked);
      void qc.cancelQueries({ queryKey: ['reminder-access', identity.id, home] });
      qc.removeQueries({ queryKey: ['reminder-access', identity.id, home] });
    };
  }, [qc, identity.id, identity.role, home]);
  useEffect(() => {
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, pref.dataUpdatedAt + CAPABILITY_TTL - Date.now()) + 1);
    return () => window.clearTimeout(timer);
  }, [pref.dataUpdatedAt]);
  useEffect(() => {
    if (identity.role === 'doctor' && (!enabled || (pref.isSuccess && pref.data?.canManage !== true) || [401, 403].includes(errorStatus(pref.error) ?? 0))) {
      const filters = { predicate: (q: { queryKey: readonly unknown[] }) => JSON.stringify(q.queryKey).includes('/api/reminders/log') };
      void qc.cancelQueries(filters);
      qc.removeQueries(filters);
    }
  }, [enabled, identity.role, pref.isSuccess, pref.data?.canManage, pref.error, qc]);
  return { allowed };
}

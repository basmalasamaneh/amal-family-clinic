import { useCallback, useEffect, useState } from 'react';
import type { ShellRole } from '../shell/identity';
import { readTour, tourFor, writeTour } from './tours';

/** Auto-opens once per user+role+version; Help can replay any time. */
export function useTour(userId: string, role: ShellRole | null) {
  const [open, setOpen] = useState(false);
  const [run, setRun] = useState(0);
  useEffect(() => { setOpen(!!role && readTour(userId, role) === null); }, [userId, role]);
  const start = useCallback(() => { if (role) { setRun((r) => r + 1); setOpen(true); } }, [role]);
  const finish = useCallback((status: 'completed' | 'dismissed') => { if (role) writeTour(userId, role, status); setOpen(false); }, [userId, role]);
  return { open: open && !!role, run, steps: tourFor(role), start, finish };
}

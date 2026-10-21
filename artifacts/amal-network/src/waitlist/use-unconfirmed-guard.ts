import { useEffect } from 'react';

/**
 * No in-app navigation guard exists in the shell, so this only covers tab close/reload:
 * the browser shows its own leave prompt while an unconfirmed request is held. Nothing is stored.
 */
export function useUnconfirmedGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);
}

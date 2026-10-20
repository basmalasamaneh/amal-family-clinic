import { configureDemoTransport, invalidateDemoResponses, setDemoGeneration } from '@workspace/api-client-react';
import { localCache } from '../offline';
import { revokeOfflineAuthorization } from './offline-permit';

const key = 'amal-demo-generation';
let generation: string | null = null;
let reachable = true;
let pending: Promise<void> | null = null;
let probeRevision = 0;
const listeners = new Set<() => void>();
export const isDemoReachable = () => reachable;
export function subscribeDemoReachability(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function connectivity(value: boolean) {
  if (reachable === value) return;
  reachable = value;
  listeners.forEach(listener => listener());
}
export type DemoContext = { enabled: boolean; generation: string | null; clinicId: number | null; outage: boolean };
export function isDemoContext(value: unknown): value is DemoContext {
  if (!value || typeof value !== 'object') return false;
  const v = value as DemoContext;
  return typeof v.enabled === 'boolean' && typeof v.outage === 'boolean' &&
    (v.clinicId === null || Number.isSafeInteger(v.clinicId)) &&
    (v.enabled ? typeof v.generation === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.generation) : v.generation === null);
}
/** Read persisted epoch BEFORE any overwrite. Failed probes never discard work or grant authority. */
export function ensureDemoContext(forceFresh = false): Promise<void> {
  if (forceFresh) {
    // Do not allow a pre-reset probe to apply its stale response. Serialize a new
    // server read after it settles; no generation supplied by UI grants authority.
    ++probeRevision;
    invalidateDemoResponses();
    connectivity(false);
    const old = pending;
    return (old ? old.catch(() => {}) : Promise.resolve()).then(() => ensureDemoContext());
  }
  if (pending) return pending;
  const revision = probeRevision;
  pending = (async () => {
    const previous = generation ?? localStorage.getItem(key);
    setDemoGeneration(previous);
    let response: Response;
    try { response = await fetch('/api/demo/context', { credentials: 'include', cache: 'no-store' }); }
    catch (error) {
      connectivity(false);
      // Preserve existing offline-permit behavior on actual transport failure.
      if (error instanceof TypeError) return;
      throw error;
    }
    if (!response.ok) throw new Error('Demo context verification failed');
    const context: unknown = await response.json();
    if (revision !== probeRevision) return;
    if (!isDemoContext(context)) throw new Error('Invalid demo context');
    let warned = false;
    const reset = () => {
      if (warned) return;
      warned = true;
      connectivity(false);
      invalidateDemoResponses();
      revokeOfflineAuthorization();
      void localCache.setContext(null);
      window.dispatchEvent(new CustomEvent('amal:demo-reset'));
    };
    if (context.enabled) {
      if (previous !== null && previous !== context.generation) reset();
      const result = await localCache.reconcileDemoGeneration(context.generation!, reset);
      if (!result.ok) throw new Error(`Demo reset cleanup failed: ${result.error}`);
    }
    generation = context.generation;
    if (generation) localStorage.setItem(key, generation);
    // Disabled deployments do not destroy retained generation evidence.
    setDemoGeneration(generation);
    connectivity(!context.outage);
  })().finally(() => { pending = null; });
  return pending;
}
configureDemoTransport(() => ensureDemoContext(true), () => connectivity(false));

export function startDemoContextPolling() {
  const probe = () => { void ensureDemoContext().catch(() => connectivity(false)); };
  const timer = setInterval(probe, 5000);
  const visible = () => { if (document.visibilityState === 'visible') probe(); };
  const storage = (event: StorageEvent) => {
    if (event.key === key) {
      // Peer epoch is a signal, not authority. Fence immediately, confirm with server.
      invalidateDemoResponses();
      connectivity(false);
      void localCache.setContext(null);
      probe();
    }
  };
  window.addEventListener('online', probe);
  window.addEventListener('storage', storage);
  document.addEventListener('visibilitychange', visible);
  return () => {
    clearInterval(timer);
    window.removeEventListener('online', probe);
    window.removeEventListener('storage', storage);
    document.removeEventListener('visibilitychange', visible);
  };
}

import type { ResolutionInput, SyncResolutionResult, SyncPushResult, SyncPullResult, SyncConflictPage } from '@workspace/api-client-react';
import type { LocalCacheController } from '../offline/controller';
import type { BookingProposal, OutboxRecord, PatientRegistration, ResolutionIntent, Result, ScopeTicket } from '../offline/types';
import type { SyncConflict } from '@workspace/api-client-react';

export class SyncFailure extends Error {
  constructor(readonly code: string) { super(code); }
}
export function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new SyncFailure(r.error);
  return r.value;
}
export type SyncSnapshot = {
  phase: 'idle' | 'loading' | 'syncing' | 'offline' | 'error' | 'locked';
  error: null | 'network' | 'invalid-data' | 'storage' | 'authorization' | 'unavailable';
  bookings: BookingProposal[]; outbox: OutboxRecord[]; conflicts: SyncConflict[]; intents: ResolutionIntent[];
  registrations: PatientRegistration[];
};
export interface SyncTransport {
  /** Existing idempotent patient endpoint, not a device-sequenced sync operation. */
  registerPatient?(input: import('@workspace/api-client-react').PatientInput, signal: AbortSignal): Promise<import('../offline/types').PatientProjection>;
  state(signal: AbortSignal): Promise<{ deviceId: number; nextSequence: number }>;
  push(operations: import('@workspace/api-client-react').SyncOperation[], signal: AbortSignal): Promise<SyncPushResult>;
  pull(since: string | null, signal: AbortSignal): Promise<SyncPullResult>;
  conflicts(cursor: string | null, signal: AbortSignal): Promise<SyncConflictPage>;
  resolve(input: ResolutionInput, signal: AbortSignal): Promise<SyncResolutionResult>;
}
export type QueueLock = <T>(deviceId: number, signal: AbortSignal, work: () => Promise<T>) => Promise<T>;
export const browserQueueLock: QueueLock = async (deviceId, signal, work) => {
  if (typeof navigator === 'undefined' || !navigator.locks) return Promise.reject(new SyncFailure('unavailable'));
  // Browser-owned lock is released on tab crash. No expiry can let a slow request
  // overlap a new owner; exact operation IDs recover a crash after server commit.
  return navigator.locks.request(`amal-sync-device:${deviceId}`, { signal }, work);
};
const empty = (): SyncSnapshot => ({ phase: 'locked', error: null, bookings: [], outbox: [], conflicts: [], intents: [], registrations: [] });
const authCodes = new Set(['FORBIDDEN', 'UNAUTHORIZED', 'DEVICE_UNTRUSTED', 'SESSION_EXPIRED']);
function status(e: unknown): number | undefined {
  return e && typeof e === 'object' && 'status' in e && typeof e.status === 'number' ? e.status : undefined;
}
function apiCode(e: unknown): string | undefined {
  if (!e || typeof e !== 'object' || !('data' in e)) return;
  const data = e.data;
  return data && typeof data === 'object' && 'code' in data && typeof data.code === 'string' ? data.code : undefined;
}
export class SyncRunner {
  private snapshot = empty();
  private listeners = new Set<() => void>();
  private session: { ticket: ScopeTicket; controller: AbortController; onlineVerified: boolean } | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private running: Promise<void> | null = null;
  private requested = false;
  private failures = 0;
  private unsubscribe: () => void;
  constructor(private cache: LocalCacheController, private api: SyncTransport,
    private lock: QueueLock, private online: () => boolean,
    private unauthorized: () => void, private changed: () => void = () => {}) {
    this.unsubscribe = cache.subscribeContext(() => this.stop());
  }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snapshot;
  private publish(patch: Partial<SyncSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(fn => fn());
  }
  start(ticket: ScopeTicket, onlineVerified: boolean) {
    this.stop();
    this.session = { ticket, controller: new AbortController(), onlineVerified };
    this.publish({ phase: this.online() && onlineVerified ? 'loading' : 'offline' });
    this.refresh();
  }
  stop() {
    this.session?.controller.abort();
    this.session = null;
    clearTimeout(this.timer);
    this.requested = false;
    this.snapshot = empty();
    this.listeners.forEach(fn => fn());
  }
  close() { this.stop(); this.unsubscribe(); }
  private current(s: NonNullable<SyncRunner['session']>) {
    if (s !== this.session || s.controller.signal.aborted) throw new SyncFailure('stale-context');
    const ticket = unwrap(this.cache.captureScope());
    if (ticket.generation !== s.ticket.generation || ticket.userId !== s.ticket.userId || ticket.clinicId !== s.ticket.clinicId)
      throw new SyncFailure('stale-context');
  }
  private async local(s: NonNullable<SyncRunner['session']>) {
    const [bookings, outbox, state, registrations] = await Promise.all([
      this.cache.listBookings(s.ticket), this.cache.listOutbox(s.ticket), this.cache.readSyncState(s.ticket), this.cache.listPatientRegistrations(s.ticket),
    ]);
    this.current(s);
    this.publish({ bookings: unwrap(bookings), outbox: unwrap(outbox), ...unwrap(state), registrations: unwrap(registrations) });
  }
  refresh = () => {
    const s = this.session;
    if (!s) return;
    void this.local(s).catch(e => this.handle(s, e));
    this.requested = true;
    clearTimeout(this.timer);
    if (!this.running) {
      this.running = this.drain().finally(() => {
        this.running = null;
        if (this.requested && this.session) this.refresh();
      });
    }
  };
  retry = () => { this.failures = 0; this.refresh(); };
  private schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(this.refresh, ms);
    this.timer.unref?.();
  }
  private async drain() {
    const s = this.session;
    this.requested = false;
    if (!s) return;
    if (!this.online() || !s.onlineVerified) { this.publish({ phase: 'offline' }); return; }
    try {
      this.current(s);
      const state = await this.api.state(s.controller.signal);
      this.current(s);
      if (!Number.isSafeInteger(state.deviceId) || state.deviceId < 1) throw new SyncFailure('invalid-data');
      await this.lock(state.deviceId, s.controller.signal, async () => {
        this.current(s);
        unwrap(await this.cache.prepareBookingStream(s.ticket, state));
        this.publish({ phase: 'syncing', error: null });
        await this.pull(s);
        await this.conflicts(s);
        // Recover uncertain decisions before attempting dependent bookings.
        const pending = unwrap(await this.cache.readSyncState(s.ticket)).intents.filter(i => i.status === 'pending');
        for (const intent of pending) await this.sendIntent(s, intent.input);
        const registrations = unwrap(await this.cache.listPatientRegistrations(s.ticket));
        for (const registration of registrations) {
          if (registration.status === 'applied' || registration.status === 'rejected') continue;
          this.current(s);
          if (!this.online()) throw new SyncFailure('network');
          if (!this.api.registerPatient) throw new SyncFailure('unavailable');
          unwrap(await this.cache.markPatientRegistration(s.ticket, registration.clientOpId, 'processing'));
          try {
            const patient = await this.api.registerPatient(registration.input, s.controller.signal);
            this.current(s);
            unwrap(await this.cache.acknowledgePatientRegistration(s.ticket, registration.clientOpId, patient));
            this.changed();
          } catch (e) {
            this.current(s);
            unwrap(await this.cache.markPatientRegistration(s.ticket, registration.clientOpId,
              [400, 409, 422].includes(status(e) ?? 0) ? 'rejected' : 'failed'));
            this.changed();
            throw e;
          }
        }
        const proposals = unwrap(await this.cache.listBookings(s.ticket)).sort((a, b) => a.sequence - b.sequence);
        for (const p of proposals) {
          this.current(s);
          if (!this.online()) throw new SyncFailure('network');
          if (p.outcome === 'applied') continue;
          if (p.outcome === 'conflict' || p.outcome === 'rejected') break;
          const op = unwrap(await this.cache.beginBookingDelivery(s.ticket, p.operationId));
          if (!op) break; // Includes unresolved work belonging to a different owner.
          unwrap(await this.cache.markBookingAttempt(s.ticket, p.operationId, 'processing', null, null));
          await this.local(s);
          try {
            const result = await this.api.push([op], s.controller.signal);
            this.current(s);
            if (!result || !Array.isArray(result.outcomes) || result.outcomes.length !== 1) throw new SyncFailure('invalid-data');
            const outcome = result.outcomes[0]!;
            if (!outcome || typeof outcome !== 'object') throw new SyncFailure('invalid-data');
            if (outcome.clientOpId !== p.operationId || outcome.sequence !== p.sequence) throw new SyncFailure('invalid-data');
            if (outcome.status === 'rejected' && authCodes.has(outcome.error?.code)) throw new SyncFailure('authorization');
            unwrap(await this.cache.acknowledgeBooking(s.ticket, p.operationId, outcome));
            await this.local(s);
            this.changed();
            if (outcome.status !== 'applied') break;
          } catch (e) {
            if (this.session === s) await this.cache.markBookingAttempt(s.ticket, p.operationId, 'failed',
              new Date(Date.now() + this.backoff()).toISOString(), 'network');
            throw e;
          }
        }
        await this.pull(s);
        await this.conflicts(s);
        await this.local(s);
        this.current(s);
        this.failures = 0;
        this.publish({ phase: 'idle', error: null });
        this.changed();
      });
      if (this.session === s) this.schedule(30_000);
    } catch (e) { this.handle(s, e); }
  }
  private async pull(s: NonNullable<SyncRunner['session']>) {
    let since = unwrap(await this.cache.readSyncState(s.ticket)).cursor;
    const seen = new Set<string>();
    let reset = false;
    for (;;) {
      this.current(s);
      let page: SyncPullResult;
      try { page = await this.api.pull(since, s.controller.signal); }
      catch (e) {
        if (!reset && apiCode(e) === 'CURSOR_SCOPE_CHANGED') {
          unwrap(await this.cache.resetSyncCursor(s.ticket)); since = null; reset = true; continue;
        }
        throw e;
      }
      this.current(s);
      if (page?.nextCursor && (seen.has(page.nextCursor) || page.nextCursor === since)) throw new SyncFailure('invalid-data');
      unwrap(await this.cache.applySyncPage(s.ticket, page));
      if (!page.nextCursor) break;
      seen.add(page.nextCursor); since = page.nextCursor;
    }
  }
  private async conflicts(s: NonNullable<SyncRunner['session']>) {
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const page = await this.api.conflicts(cursor, s.controller.signal);
      this.current(s);
      if (!page || !Array.isArray(page.items) ||
        !(page.nextCursor === null || typeof page.nextCursor === 'string')) throw new SyncFailure('invalid-data');
      if (page.nextCursor && seen.has(page.nextCursor)) throw new SyncFailure('invalid-data');
      unwrap(await this.cache.reconcileConflicts(s.ticket, page.items));
      cursor = page.nextCursor;
      if (cursor) seen.add(cursor);
    } while (cursor);
  }
  private backoff() { return Math.min(60_000, 1000 * 2 ** Math.min(this.failures, 6)); }
  private handle(s: NonNullable<SyncRunner['session']>, e: unknown) {
    if (s !== this.session) return;
    const code = e instanceof SyncFailure ? e.code : '';
    if (status(e) === 401 || status(e) === 403 || code === 'authorization') {
      this.stop(); void this.cache.setContext(null); this.unauthorized(); return;
    }
    if (code === 'stale-context' || code === 'unauthorized') { this.stop(); return; }
    this.failures++;
    this.publish({ phase: this.online() ? 'error' : 'offline', error:
      code === 'invalid-data' ? 'invalid-data' : code === 'unavailable' ? 'unavailable' : code.startsWith('storage') ? 'storage' : 'network' });
    if (s.onlineVerified) this.schedule(this.backoff());
  }
  private async sendIntent(s: NonNullable<SyncRunner['session']>, input: ResolutionInput) {
    this.current(s);
    let result: SyncResolutionResult;
    try { result = await this.api.resolve(input, s.controller.signal); }
    catch (e) {
      this.current(s);
      // Definite rejection did not commit. Ambiguous/network/5xx keeps exact intent.
      if ([400, 409, 422].includes(status(e) ?? 0)) {
        unwrap(await this.cache.rejectResolutionIntent(s.ticket, input.clientOpId));
        await this.conflicts(s);
        await this.local(s);
      }
      throw e;
    }
    this.current(s);
    unwrap(await this.cache.finishResolutionIntent(s.ticket, input.clientOpId, result));
    await this.local(s);
    this.changed();
    return result;
  }
  resolve = async (input: ResolutionInput): Promise<SyncResolutionResult> => {
    const s = this.session;
    if (!s || !s.onlineVerified || !this.online()) throw new SyncFailure('authorization');
    try {
      this.current(s);
      const state = await this.api.state(s.controller.signal);
      this.current(s);
      return await this.lock(state.deviceId, s.controller.signal, async () => {
        this.current(s);
        const intent = unwrap(await this.cache.saveResolutionIntent(s.ticket, input));
        await this.local(s);
        if (intent.status !== 'pending') throw new SyncFailure('invalid-data');
        const result = await this.sendIntent(s, intent.input);
        this.refresh();
        return result;
      });
    } catch (e) { this.handle(s, e); throw e; }
  };
  retryResolution = async (clientOpId: string): Promise<SyncResolutionResult> => {
    const s = this.session;
    if (!s) throw new SyncFailure('authorization');
    const state = unwrap(await this.cache.readSyncState(s.ticket));
    this.current(s);
    const intent = state.intents.find(i => i.clientOpId === clientOpId && i.status === 'pending');
    if (!intent) throw new SyncFailure('invalid-data');
    return this.resolve(intent.input);
  };
}

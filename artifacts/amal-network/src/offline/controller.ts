import type { Transaction } from 'dexie';
import { appointmentWindow } from './calendar';
import { LocalCacheDatabase } from './database';
import { InvalidProjection, projectOperation, projectSnapshot, requireValid, utcInstant, validId, validText } from './projections';
import type {
  AuthorizedContext, AuthorizedSnapshot, CacheErrorCode, CacheMetadata, CachedSnapshot,
  LocalOperation, OutboxRecord, OutboxStatus, OutboxUpdate, Result, Scope, ScopeTicket, StorageStatus,
} from './types';

class CacheFailure extends Error {
  constructor(readonly code: CacheErrorCode) { super(code); }
}
function fail(code: CacheErrorCode): never { throw new CacheFailure(code); }
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const statuses: OutboxStatus[] = ['pending', 'processing', 'failed', 'conflict', 'succeeded'];

/** Transport messages carry no identities or records. Any context change conservatively locks peer tabs. */
export interface InvalidationTransport {
  post(): void;
  subscribe(listener: () => void): () => void;
  close(): void;
}

export function browserInvalidationTransport(): InvalidationTransport | undefined {
  if (typeof window === 'undefined') return undefined;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  let channel: BroadcastChannel | undefined;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('amal-private-cache-lifecycle');
      channel.onmessage = notify;
    }
  } catch { /* Storage revision checks remain authoritative if messaging is unavailable. */ }
  const key = 'amal-private-cache-invalidation';
  const onStorage = (event: StorageEvent) => { if (event.key === key) notify(); };
  window.addEventListener('storage', onStorage);
  return {
    post() {
      try { channel?.postMessage('invalidate'); } catch { /* See persisted epoch guard. */ }
      // No private identity is placed in localStorage; fallback only sends an opaque pulse.
      try { window.localStorage.setItem(key, crypto.randomUUID()); } catch { /* Optional notification only. */ }
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    close() { channel?.close(); window.removeEventListener('storage', onStorage); listeners.clear(); },
  };
}

export interface LocalCacheOptions {
  database?: LocalCacheDatabase;
  now?: () => Date;
  transport?: InvalidationTransport;
  /** Browser singleton enables this; tests can explicitly probe injected databases. */
  proactiveProbe?: boolean;
}

/**
 * No authentication, fetches, replay, background sync, or automatic workflow enqueueing.
 * Capture a ticket BEFORE starting a fetch; use that same ticket when storing its result.
 */
export class LocalCacheController {
  private readonly db: LocalCacheDatabase;
  private readonly now: () => Date;
  private readonly transport?: InvalidationTransport;
  private readonly unsubscribeTransport?: () => void;
  private context: (AuthorizedContext & { expires: number; epoch: number }) | null = null;
  private lastUserId: string | null = null;
  private generation = 0;
  private readonly tickets = new WeakMap<ScopeTicket, { generation: number; epoch: number }>();
  private readonly transactions = new Set<Transaction>();
  private readonly listeners = new Set<() => void>();
  private readonly contextListeners = new Set<() => void>();
  private status: StorageStatus = { state: 'idle' };
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private blocked = false;
  private opening?: Promise<void>;
  private openFailure?: Promise<never>;
  private rejectOpen?: (code: CacheErrorCode) => void;

  constructor(options: LocalCacheOptions = {}) {
    this.db = options.database ?? new LocalCacheDatabase();
    this.now = options.now ?? (() => new Date());
    this.transport = options.transport;
    this.unsubscribeTransport = this.transport?.subscribe(() => this.invalidate());
    this.db.on('blocked', () => {
      this.blocked = true;
      this.setStatus({ state: 'error', error: 'storage-blocked' });
      this.invalidate();
      // IDB cannot cancel a queued native open. Keep ownership of it and fail callers
      // promptly; closing Dexie here would leave a late native connection unowned.
      this.rejectOpen?.('storage-blocked');
    });
    this.db.on('versionchange', () => {
      this.invalidate();
      this.db.close();
      this.setStatus({ state: 'error', error: 'storage-blocked' });
    });
    if (options.proactiveProbe) void this.probe();
  }

  /** Stable getSnapshot/subscribe functions suitable for useSyncExternalStore. No raw browser errors. */
  getStorageStatus = (): StorageStatus => this.status;
  subscribeStorage = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  /** Parent may lock private UI when another tab revokes context or authorization expires. */
  subscribeContext = (listener: () => void): (() => void) => {
    this.contextListeners.add(listener);
    return () => this.contextListeners.delete(listener);
  };
  private setStatus(status: StorageStatus) {
    this.status = status;
    this.listeners.forEach((listener) => { try { listener(); } catch { /* Observers cannot break persistence. */ } });
  }
  private invalidate() {
    ++this.generation;
    this.context = null;
    clearTimeout(this.expiryTimer);
    for (const tx of this.transactions) {
      try { tx.abort(); } catch { /* Already completed. */ }
    }
    this.contextListeners.forEach((listener) => { try { listener(); } catch { /* Isolate observers. */ } });
  }
  private notifyPeers() { try { this.transport?.post(); } catch { /* Persisted epoch remains authoritative. */ } }
  private scheduleExpiry() {
    clearTimeout(this.expiryTimer);
    if (!this.context) return;
    const delay = this.context.expires - this.now().getTime();
    if (delay <= 0) { this.invalidate(); return; }
    this.expiryTimer = setTimeout(() => this.scheduleExpiry(), Math.min(delay, 2_147_483_647));
    this.expiryTimer.unref?.();
  }
  private mapFailure(error: unknown): CacheErrorCode {
    if (error instanceof CacheFailure) return error.code;
    if (error instanceof InvalidProjection || error instanceof RangeError || error instanceof TypeError) return 'invalid-data';
    const name = (error && typeof error === 'object' && 'name' in error) ? String(error.name) : '';
    if (this.blocked) return 'storage-blocked';
    if (name === 'QuotaExceededError') return 'storage-quota';
    if (['MissingAPIError', 'SecurityError', 'InvalidStateError', 'NotSupportedError'].includes(name)) return 'storage-unavailable';
    return 'storage-failed';
  }
  private async result<T>(work: () => Promise<T>): Promise<Result<T>> {
    try { return ok(await work()); } catch (error) {
      const code = this.mapFailure(error);
      if (code.startsWith('storage-')) this.setStatus({ state: 'error', error: code });
      return { ok: false, error: code };
    }
  }
  private async open() {
    if (this.closed) fail('storage-unavailable');
    if (!this.db.isOpen() || this.opening) {
      if (!this.opening) {
        this.blocked = false;
        this.openFailure = new Promise<never>((_, reject) => {
          this.rejectOpen = (code) => reject(new CacheFailure(code));
        });
        const attempt = this.db.open().then(() => {
          this.blocked = false;
          if (this.closed) this.db.close();
        });
        this.opening = attempt;
        const finished = () => {
          if (this.opening === attempt) {
            this.opening = undefined;
            this.openFailure = undefined;
            this.rejectOpen = undefined;
          }
        };
        void attempt.then(finished, finished);
      }
      await Promise.race([this.opening, this.openFailure!]);
    }
    if (this.closed) fail('storage-unavailable');
  }
  /** Performs a real read/write transaction, so a read-only/quota failure isn't reported as ready. */
  probe(): Promise<Result<void>> {
    this.setStatus({ state: 'checking' });
    return this.result(async () => {
      await this.open();
      await this.db.transaction('rw', this.db.lifecycle, async () => {
        const revision = await this.db.lifecycle.get('global');
        await this.db.lifecycle.put(revision ?? { key: 'global', epoch: 0 });
      });
      this.setStatus({ state: 'ready' });
    });
  }

  /**
   * Invalidates tickets/active transactions synchronously, then persists a cross-tab revision.
   * Await success before capturing a new scope. Call null immediately on unknown session/401.
   * Reauthorizing any tab intentionally locks all other tabs until verified again.
   */
  setContext(input: AuthorizedContext | null): Promise<Result<void>> {
    this.invalidate();
    this.notifyPeers();
    const generation = this.generation;
    return this.result(async () => {
      let next: (AuthorizedContext & { expires: number }) | null = null;
      let authorizationError = false;
      if (input !== null) {
        try {
          requireValid(validText(input.userId) && validId(input.clinicId));
          const expires = Date.parse(utcInstant(input.authorizedUntil));
          requireValid(expires > this.now().getTime());
          next = { userId: input.userId, clinicId: input.clinicId, authorizedUntil: new Date(expires).toISOString(), expires };
        } catch { authorizationError = true; }
      }
      await this.open();
      const epoch = await this.db.transaction('rw', this.db.lifecycle, async () => {
        const previous = await this.db.lifecycle.get('global');
        const epoch = (previous?.epoch ?? 0) + 1;
        await this.db.lifecycle.put({ key: 'global', epoch });
        return epoch;
      });
      if (generation !== this.generation) fail('stale-context');
      if (authorizationError) fail('unauthorized');
      if (next) {
        if (next.expires <= this.now().getTime()) fail('unauthorized');
        this.context = { ...next, epoch };
        this.lastUserId = next.userId;
        this.scheduleExpiry();
      }
      this.setStatus({ state: 'ready' });
    });
  }

  captureScope(): Result<ScopeTicket> {
    if (!this.context || this.context.expires <= this.now().getTime()) {
      if (this.context) this.invalidate();
      return { ok: false, error: 'unauthorized' };
    }
    const ticket: ScopeTicket = Object.freeze({
      userId: this.context.userId, clinicId: this.context.clinicId, generation: this.generation,
    });
    this.tickets.set(ticket, { generation: this.generation, epoch: this.context.epoch });
    return ok(ticket);
  }
  private assertTicket(ticket: ScopeTicket) {
    const issued = ticket && this.tickets.get(ticket);
    if (!issued || issued.generation !== this.generation) fail('stale-context');
    if (!this.context || this.context.expires <= this.now().getTime()) {
      this.invalidate();
      fail('unauthorized');
    }
    if (ticket.userId !== this.context.userId || ticket.clinicId !== this.context.clinicId) fail('stale-context');
    return issued;
  }
  private scoped<T>(ticket: ScopeTicket, work: (scope: Scope) => Promise<T>): Promise<Result<T>> {
    return this.result(async () => {
      const issued = this.assertTicket(ticket);
      await this.open();
      this.assertTicket(ticket);
      try {
        return await this.db.transaction('rw', this.db.tables, async (tx) => {
          this.transactions.add(tx);
          // Keep it abortable through the actual IDB commit, not just until the callback returns.
          const finished = () => { this.transactions.delete(tx); };
          tx.on('complete', finished);
          tx.on('abort', finished);
          tx.on('error', finished);
          this.assertTicket(ticket);
          const revision = await this.db.lifecycle.get('global');
          if (revision?.epoch !== issued.epoch) {
            this.invalidate();
            fail('stale-context');
          }
          const value = await work({ userId: ticket.userId, clinicId: ticket.clinicId });
          this.assertTicket(ticket);
          return value;
        });
      } catch (error) {
        // An abort due to logout/expiry must not be misreported as a broken storage device.
        this.assertTicket(ticket);
        throw error;
      }
    });
  }
  private scopeRows<T extends { userId: string; clinicId: number }>(
    table: import('dexie').Table<T, any>, scope: Scope,
  ) {
    return table.where('[userId+clinicId]').equals([scope.userId, scope.clinicId]);
  }
  private async prune(scope: Scope) {
    const window = appointmentWindow(this.now());
    await this.scopeRows(this.db.appointments, scope)
      .filter((row) => row.startsAt < window.startUtc || row.startsAt >= window.endUtc).delete();
    const key: [string, number] = [scope.userId, scope.clinicId];
    const metadata = await this.db.metadata.get(key);
    if (metadata) {
      await this.db.metadata.update(key, { windowStartUtc: window.startUtc, windowEndUtc: window.endUtc });
    }
    return window;
  }
  /** Date rollover primitive; parent can invoke at local midnight/visibility return. Access also prunes. */
  rollover(ticket: ScopeTicket): Promise<Result<void>> {
    return this.scoped(ticket, async (scope) => { await this.prune(scope); });
  }
  replaceSnapshot(ticket: ScopeTicket, input: AuthorizedSnapshot): Promise<Result<void>> {
    return this.scoped(ticket, async (scope) => {
      const projection = projectSnapshot(input, scope);
      const window = appointmentWindow(this.now());
      // Rows outside source coverage are never accepted as authorized coverage.
      requireValid(projection.appointments.every((row) =>
        row.startsAt >= projection.coverageStartUtc && row.startsAt < projection.coverageEndUtc));
      const appointments = projection.appointments.filter((row) => row.startsAt >= window.startUtc && row.startsAt < window.endUtc);
      await this.scopeRows(this.db.appointments, scope).delete();
      await this.scopeRows(this.db.doctors, scope).delete();
      await this.scopeRows(this.db.patients, scope).delete();
      await this.db.appointments.bulkPut(appointments);
      await this.db.doctors.bulkPut(projection.doctors);
      await this.db.patients.bulkPut(projection.patients);
      await this.db.metadata.put({
        ...scope, refreshedAt: this.now().toISOString(),
        coverageStartUtc: projection.coverageStartUtc, coverageEndUtc: projection.coverageEndUtc,
        windowStartUtc: window.startUtc, windowEndUtc: window.endUtc,
      });
      await this.prune(scope);
    });
  }
  readSnapshot(ticket: ScopeTicket): Promise<Result<CachedSnapshot>> {
    return this.scoped(ticket, async (scope) => {
      const window = await this.prune(scope);
      const [doctors, patients, appointments, stored] = await Promise.all([
        this.scopeRows(this.db.doctors, scope).toArray(),
        this.scopeRows(this.db.patients, scope).toArray(),
        this.scopeRows(this.db.appointments, scope).sortBy('startsAt'),
        this.db.metadata.get([scope.userId, scope.clinicId]),
      ]);
      let metadata: CacheMetadata | null = null;
      if (stored) {
        metadata = {
          ...scope, refreshedAt: utcInstant(stored.refreshedAt),
          coverageStartUtc: utcInstant(stored.coverageStartUtc), coverageEndUtc: utcInstant(stored.coverageEndUtc),
          windowStartUtc: window.startUtc, windowEndUtc: window.endUtc,
        };
      }
      // Re-project reads as well, so old records never leak unexpected fields after migration.
      const safe = projectSnapshot({
        ...scope, doctors, patients, appointments,
        coverage: { startUtc: metadata?.coverageStartUtc ?? window.startUtc, endUtc: metadata?.coverageEndUtc ?? window.endUtc },
      }, scope);
      return {
        doctors: safe.doctors, patients: safe.patients, appointments: safe.appointments, metadata, window,
        fullyCovered: metadata !== null && metadata.coverageStartUtc <= window.startUtc && metadata.coverageEndUtc >= window.endUtc,
      };
    });
  }
  enqueue(ticket: ScopeTicket, input: LocalOperation): Promise<Result<OutboxRecord>> {
    return this.scoped(ticket, async (scope) => {
      const operation = projectOperation(input);
      const key: [string, number, string] = [scope.userId, scope.clinicId, operation.operationId];
      const existing = await this.db.outbox.get(key);
      if (existing) {
        // Same id + same payload is idempotent; never overwrite a different intent.
        requireValid(JSON.stringify(projectOperation(existing)) === JSON.stringify(operation));
        return this.safeOutbox(existing, scope);
      }
      const now = this.now().toISOString();
      const row: OutboxRecord = {
        ...operation, ...scope, enqueuedAt: now, updatedAt: now,
        status: 'pending', attempts: 0, retryAt: null, errorCode: null,
      };
      await this.db.outbox.add(row);
      return row;
    });
  }
  private safeOutbox(row: OutboxRecord, scope: Scope): OutboxRecord {
    requireValid(statuses.includes(row.status) && Number.isSafeInteger(row.attempts) && row.attempts >= 0);
    requireValid(row.errorCode === null || ['network', 'rate-limited', 'conflict', 'rejected', 'unknown'].includes(row.errorCode));
    return {
      ...projectOperation(row), ...scope, enqueuedAt: utcInstant(row.enqueuedAt), updatedAt: utcInstant(row.updatedAt),
      status: row.status, attempts: row.attempts, retryAt: row.retryAt === null ? null : utcInstant(row.retryAt), errorCode: row.errorCode,
    };
  }
  listOutbox(ticket: ScopeTicket, status?: OutboxStatus): Promise<Result<OutboxRecord[]>> {
    return this.scoped(ticket, async (scope) => {
      requireValid(status === undefined || statuses.includes(status));
      const rows = await this.scopeRows(this.db.outbox, scope).toArray();
      return rows.filter((row) => status === undefined || row.status === status)
        .map((row) => this.safeOutbox(row, scope))
        .sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt) || a.operationId.localeCompare(b.operationId));
    });
  }
  updateOutbox(ticket: ScopeTicket, operationId: string, update: OutboxUpdate): Promise<Result<void>> {
    return this.scoped(ticket, async (scope) => {
      const key: [string, number, string] = [scope.userId, scope.clinicId, operationId];
      const current = await this.db.outbox.get(key);
      requireValid(current && update && statuses.includes(update.status));
      requireValid(Number.isSafeInteger(update.attempts) && update.attempts >= current.attempts);
      const row = this.safeOutbox({
        ...current, status: update.status, attempts: update.attempts,
        retryAt: update.retryAt ?? null, errorCode: update.errorCode ?? null, updatedAt: this.now().toISOString(),
      }, scope);
      await this.db.outbox.put(row);
    });
  }
  /** All clinics belonging to the currently authorized user, including failed/conflict/processing. */
  pendingCount(ticket: ScopeTicket): Promise<Result<number>> {
    return this.scoped(ticket, async (scope) =>
      this.db.outbox.where('userId').equals(scope.userId).filter((row) => row.status !== 'succeeded').count());
  }
  /**
   * Explicit logout/account removal: clears ALL clinics for the last verified user, not only active clinic.
   * Invalidate immediately even if a confirmation is required. Unsent rows require explicit discard.
   * Can run after setContext(null); no private records are returned through this cleanup path.
   */
  logout(options: { discardPending?: boolean; userId?: string } = {}): Promise<Result<void>> {
    // Explicit identity is a deletion-only capability from the session owner, never an access grant.
    const userId = options.userId ?? this.context?.userId ?? this.lastUserId;
    this.invalidate();
    this.notifyPeers();
    return this.result(async () => {
      if (options.userId !== undefined && !validText(options.userId)) fail('invalid-data');
      await this.open();
      // Revocation commits even when pending work prevents the subsequent destructive cleanup.
      await this.db.transaction('rw', this.db.lifecycle, async () => {
        const revision = await this.db.lifecycle.get('global');
        await this.db.lifecycle.put({ key: 'global', epoch: (revision?.epoch ?? 0) + 1 });
      });
      await this.db.transaction('rw', this.db.tables, async () => {
        if (!userId) fail('unauthorized');
        const pending = await this.db.outbox.where('userId').equals(userId).filter((row) => row.status !== 'succeeded').count();
        if (pending && options.discardPending !== true) fail('pending-outbox');
        for (const table of [this.db.appointments, this.db.doctors, this.db.patients, this.db.metadata, this.db.outbox]) {
          await table.where('userId').equals(userId).delete();
        }
      });
      if (this.lastUserId === userId) this.lastUserId = null;
    });
  }
  /** Dispose for tests/unmounting the owning application; does not silently delete pending work. */
  close() {
    this.closed = true;
    this.invalidate();
    this.unsubscribeTransport?.();
    this.transport?.close();
    this.rejectOpen?.('storage-unavailable');
    if (!this.opening) this.db.close();
    this.listeners.clear();
    this.contextListeners.clear();
  }
}

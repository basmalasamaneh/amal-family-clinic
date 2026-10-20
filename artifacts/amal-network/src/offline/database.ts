import Dexie, { type Table } from 'dexie';
import type { BookingProposal, CachedAppointment, CachedDoctor, CachedPatient, CacheMetadata, OutboxRecord, Scope, ResolutionIntent } from './types';

export const DATABASE_NAME = 'amal-private-cache';
export const SCHEMA_V1 = {
  appointments: '[userId+clinicId+id], userId, [userId+clinicId], [userId+clinicId+startsAt], [userId+clinicId+doctorId+startsAt]',
  doctors: '[userId+clinicId+id], userId, [userId+clinicId]',
  patients: '[userId+clinicId+id], userId, [userId+clinicId]',
  outbox: '[userId+clinicId+operationId], userId, [userId+clinicId], [userId+clinicId+status]',
  metadata: '[userId+clinicId], userId',
};

/** Append-only schema history. v2 only adds indexes/a lifecycle table: never clears records. */
export class LocalCacheDatabase extends Dexie {
  appointments!: Table<CachedAppointment, [string, number, number]>;
  doctors!: Table<CachedDoctor, [string, number, number]>;
  patients!: Table<CachedPatient, [string, number, number]>;
  outbox!: Table<OutboxRecord, [string, number, string]>;
  metadata!: Table<CacheMetadata, [string, number]>;
  lifecycle!: Table<{ key: string; epoch: number; demoGeneration?: string }, string>;
  proposals!: Table<BookingProposal, [string, number, string]>;
  streams!: Table<{ deviceId: number; nextSequence: number }, number>;
  bookingScopes!: Table<{ userId: string; clinicId: number; deviceId: number }, [string, number]>;
  syncCursors!: Table<Scope & { cursor: string | null }, [string, number]>;
  syncTombstones!: Table<Scope & { id: number; changeId: string }, [string, number, number]>;
  syncConflicts!: Table<Scope & { id: string; conflict: import('@workspace/api-client-react').SyncConflict }, [string, number, string]>;
  resolutionIntents!: Table<ResolutionIntent, [string, number, string]>;

  constructor(name = DATABASE_NAME) {
    super(name);
    this.version(1).stores(SCHEMA_V1);
    this.version(2).stores({
      ...SCHEMA_V1,
      outbox: `${SCHEMA_V1.outbox}, [userId+clinicId+status+enqueuedAt], [userId+clinicId+enqueuedAt]`,
      lifecycle: 'key',
    });
    this.version(3).stores({
      proposals: '[userId+clinicId+operationId], userId, [userId+clinicId], [deviceId+sequence]',
      streams: 'deviceId',
      bookingScopes: '[userId+clinicId], userId',
    });
    this.version(4).stores({
      syncCursors: '[userId+clinicId], userId',
      syncConflicts: '[userId+clinicId+id], userId, [userId+clinicId]',
      resolutionIntents: '[userId+clinicId+clientOpId], userId, [userId+clinicId]',
    });
    this.version(5).stores({
      syncTombstones: '[userId+clinicId+id], userId, [userId+clinicId]',
    });
  }
}

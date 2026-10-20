import Dexie, { type Table } from 'dexie';
import type { CachedAppointment, CachedDoctor, CachedPatient, CacheMetadata, OutboxRecord } from './types';

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
  lifecycle!: Table<{ key: string; epoch: number }, string>;

  constructor(name = DATABASE_NAME) {
    super(name);
    this.version(1).stores(SCHEMA_V1);
    this.version(2).stores({
      ...SCHEMA_V1,
      outbox: `${SCHEMA_V1.outbox}, [userId+clinicId+status+enqueuedAt], [userId+clinicId+enqueuedAt]`,
      lifecycle: 'key',
    });
  }
}

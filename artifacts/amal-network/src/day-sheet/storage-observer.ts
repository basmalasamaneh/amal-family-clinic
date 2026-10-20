import Dexie, { type ObservabilitySet } from 'dexie';
import { DATABASE_NAME } from '../offline/database';

const tables = new Set(['appointments', 'doctors', 'patients', 'metadata', 'proposals', 'outbox', 'syncTombstones', 'syncConflicts']);
export function affectsSheet(parts: ObservabilitySet): boolean {
  const prefix = `idb://${DATABASE_NAME}/`;
  return Object.keys(parts).some(key => key.startsWith(prefix) && tables.has(key.slice(prefix.length).split('/')[0]));
}
/** Coalesce committed mutations across tabs; the caller still enforces scope tickets. */
export function observeSheetStorage(refresh: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = (parts: ObservabilitySet) => {
    if (!affectsSheet(parts)) return;
    clearTimeout(timer);
    timer = setTimeout(refresh, 30);
  };
  Dexie.on('storagemutated', changed);
  return () => { clearTimeout(timer); Dexie.on('storagemutated').unsubscribe(changed); };
}

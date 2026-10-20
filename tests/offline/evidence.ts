import type { Page } from '@playwright/test';
import type { BookingProposal, OutboxRecord } from '../../artifacts/amal-network/src/offline/types';

/** Read-only observation; all records must have been written by the real UI. */
export async function durable(page: Page): Promise<{ proposals: BookingProposal[]; outbox: OutboxRecord[] }> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('amal-private-cache');
      request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error('Required private cache missing')); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Private cache unavailable'));
    });
    try {
      const tx = db.transaction(['proposals', 'outbox'], 'readonly');
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(new Error('Cache observation failed'));
      });
      const read = (store: string) => new Promise<any[]>((resolve, reject) => {
        const r = tx.objectStore(store).getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(new Error('Cache observation failed'));
      });
      const [proposals, outbox] = await Promise.all([read('proposals'), read('outbox')]);
      await done;
      return { proposals: proposals.sort((a, b) => a.sequence - b.sequence), outbox };
    } finally { db.close(); }
  });
}

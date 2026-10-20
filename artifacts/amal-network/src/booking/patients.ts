import { listPatients } from '@workspace/api-client-react';
import { matchesPatient } from './normalize';
import { withAuthReport } from './errors';

/** Identity fields only — enough to tell people apart, no clinical data. */
export interface PatientHit { id: number; name: string; phone: string | null; dateOfBirth: string | null; clinicId: number }
export interface PatientSearchResult { items: PatientHit[]; /** Server has more pages: user should refine, never assume roster complete. */ more: boolean; /** Opaque server cursor for the next page (real pagination). */ nextCursor?: string | null }
export interface PatientSearchAdapter { mode: 'real' | 'fixture'; search(q: string, clinicId: number, signal?: AbortSignal, cursor?: string): Promise<PatientSearchResult> }
export const MIN_QUERY = 2;
export const PAGE = 25;

/** Real contract (GET /api/patients?q=). Server normalizes; no client fallback when absent. */
export const realPatientSearch: PatientSearchAdapter = {
  mode: 'real',
  async search(q, _clinicId, signal, cursor) {
    const page = await withAuthReport(listPatients({ q, limit: PAGE, ...(cursor ? { cursor } : {}) }, { signal }));
    return {
      items: page.items.map((p) => ({ id: p.id, name: p.name, phone: p.phone || null, dateOfBirth: p.dateOfBirth || null, clinicId: p.clinicId })),
      more: page.nextCursor !== null,
      nextCursor: page.nextCursor,
    };
  },
};

/** DEV FIXTURE ONLY. Invented people; never shown outside development/fixture sessions. */
export const FIXTURE_ROSTER: Omit<PatientHit, 'clinicId'>[] = [
  { id: 9001, name: 'محمد أحمد', phone: '0599 412 873', dateOfBirth: '1986-04-12' },
  { id: 9002, name: 'محمد احمد', phone: '0568 220 914', dateOfBirth: '2001-11-03' },
  { id: 9003, name: 'فاطمة الزهراء عودة', phone: '0597 118 406', dateOfBirth: '1979-07-25' },
  { id: 9004, name: 'آمنة يوسف', phone: '0592 337 051', dateOfBirth: '1994-02-17' },
  { id: 9005, name: 'إبراهيم مصطفى', phone: '0569 804 662', dateOfBirth: '1958-09-30' },
  { id: 9006, name: 'ليلى حداد', phone: '0598 650 129', dateOfBirth: '2012-05-08' },
  { id: 9007, name: 'Lina Haddad', phone: '0595 771 238', dateOfBirth: '1990-12-01' },
  { id: 9008, name: 'هدى مرتضى', phone: '0562 409 775', dateOfBirth: '1971-03-14' },
];
const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
});
export function createFixturePatientSearch(latency: (q: string) => number = () => 220): PatientSearchAdapter {
  return {
    mode: 'fixture',
    async search(q, clinicId, signal, cursor) {
      await wait(latency(q), signal);
      if (q.trim().toLowerCase() === 'error') throw Object.assign(new Error('fixture failure'), { status: 500 });
      const all = FIXTURE_ROSTER.filter((p) => matchesPatient(p, q)).map((p) => ({ ...p, clinicId }));
      // Fixture pages of 5 so pagination is exercised; cursor is the offset.
      const off = cursor ? Number(cursor) || 0 : 0; const items = all.slice(off, off + 5); const next = off + 5 < all.length ? String(off + 5) : null;
      return { items, more: next !== null, nextCursor: next };
    },
  };
}
export function resolvePatientSearch(fixture: boolean): PatientSearchAdapter {
  return fixture ? createFixturePatientSearch() : realPatientSearch;
}

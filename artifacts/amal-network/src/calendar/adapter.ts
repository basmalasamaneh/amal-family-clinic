import { listAppointments, listDoctors, type Appointment, type Doctor } from '@workspace/api-client-react';
import { addLocalDays, localDateOf, localToUtc } from './dates';

export interface CalendarDoctor { id: number; clinicId: number; name: string }
export type Lifecycle = 'booked' | 'double_booked' | 'completed' | 'no_show' | 'cancelled' | 'unknown';
export interface CalendarAppointment {
  id: number; clinicId: number; doctorId: number;
  /** Display name only when the read contract supplies it; null renders a localized fallback. */
  patientName: string | null;
  startsAt: string; endsAt: string;
  lifecycle: Lifecycle;
  /** Server-reported conflict flag, separate from lifecycle. */
  conflict: boolean;
  /** Local outbox state, separate from lifecycle. */
  syncPending: boolean;
  /** Real API version required for safe operational cancellation; absent in read-only fixtures. */
  version?: number;
}
/** Local working hours in minutes from local midnight. null = not configured. */
export interface ClinicHours { open: number; close: number; slotMinutes: number }
export interface AppointmentQuery { clinicId: number; from: string; to: string; doctorId?: number }

export interface SchedulingReadAdapter {
  mode: 'real' | 'mock';
  scenario?: MockScenario;
  listDoctors(clinicId: number, signal?: AbortSignal): Promise<CalendarDoctor[]>;
  listAppointments(q: AppointmentQuery, signal?: AbortSignal): Promise<CalendarAppointment[]>;
  clinicHours(clinicId: number, signal?: AbortSignal): Promise<ClinicHours | null>;
}

const LIFECYCLES: readonly Lifecycle[] = ['booked', 'double_booked', 'completed', 'no_show', 'cancelled'];
export function toLifecycle(v: unknown): Lifecycle {
  return typeof v === 'string' && (LIFECYCLES as readonly string[]).includes(v) ? (v as Lifecycle) : 'unknown';
}
export function fromApiAppointment(a: Appointment): CalendarAppointment {
  const ext = a as Appointment & { patientName?: unknown; conflict?: unknown };
  return {
    id: a.id, clinicId: a.clinicId, doctorId: a.doctorId,
    patientName: typeof ext.patientName === 'string' && ext.patientName.trim() ? ext.patientName : null,
    startsAt: a.startsAt, endsAt: a.endsAt, lifecycle: toLifecycle(a.status),
    conflict: ext.conflict === true, syncPending: false,
    version: a.version,
  };
}
const fromApiDoctor = (d: Doctor): CalendarDoctor => ({ id: d.id, clinicId: d.clinicId, name: d.name });

async function paged<T>(load: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>): Promise<T[]> {
  const out: T[] = []; const seen = new Set<string>(); let cursor: string | undefined;
  do {
    const page = await load(cursor);
    if (!Array.isArray(page.items)) throw new Error('Invalid page');
    out.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    if (cursor && seen.has(cursor)) throw new Error('Repeated cursor');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return out;
}

/** Real contract adapter. Errors propagate; there is never a mock fallback. */
export const realSchedulingAdapter: SchedulingReadAdapter = {
  mode: 'real',
  async listDoctors(clinicId, signal) {
    const items = await paged((cursor) => listDoctors({ clinicId, limit: 100, ...(cursor ? { cursor } : {}) }, { signal }));
    // Defense in depth: drop anything outside the requested clinic.
    return items.filter((d) => d.clinicId === clinicId).map(fromApiDoctor);
  },
  async listAppointments(q, signal) {
    const items = await paged((cursor) => listAppointments({ clinicId: q.clinicId, from: q.from, to: q.to, ...(q.doctorId ? { doctorId: q.doctorId } : {}), limit: 100, ...(cursor ? { cursor } : {}) }, { signal }));
    return items.filter((a) => a.clinicId === q.clinicId && (!q.doctorId || a.doctorId === q.doctorId)).map(fromApiAppointment);
  },
  // No clinic hours/settings contract exists yet: report "not configured" so no availability is invented.
  async clinicHours() { return null; },
};

// ---------------- Explicit mock mode ----------------
export const MOCK_SCENARIOS = ['standard', 'empty', 'no-doctors', 'error', 'no-hours', 'slow'] as const;
export type MockScenario = typeof MOCK_SCENARIOS[number];

const FIXTURE_DOCTORS = ['د. ليلى حداد', 'Dr. Omar Nassar-Khalil', 'د. يوسف «Joe» البرغوثي'];
const FIXTURE_PATIENTS = ['سلمى عودة', 'Rami Haddad', 'محمد عبد الرحمن الشريف أبو زيد (Mohammad Abu Zeid)', 'Nour Al-Masri', 'هبة خليل', ''];

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}
function seed(s: string): number { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

/** Deterministic: same clinic + date always yields the same appointments. Instants are UTC. */
export function mockDay(clinicId: number, date: string, doctors: CalendarDoctor[]): CalendarAppointment[] {
  const s = seed(`${clinicId}:${date}`);
  const out: CalendarAppointment[] = [];
  const plan: Array<[number, number, number, Lifecycle, boolean, boolean]> = [
    // doctorIdx, startMin, duration, lifecycle, conflict, sync
    [0, 9 * 60, 30, 'completed', false, false],
    [0, 10 * 60, 30, 'booked', false, false],
    [0, 10 * 60 + 15, 30, 'booked', true, false],
    [0, 11 * 60 + 30, 45, 'no_show', false, false],
    [1, 9 * 60 + 30, 30, 'booked', false, true],
    [1, 12 * 60, 30, 'cancelled', false, false],
    [1, 13 * 60, 60, 'double_booked', false, false],
    [2, 14 * 60, 30, 'booked', false, false],
  ];
  plan.forEach(([di, start, dur, lifecycle, conflict, sync], i) => {
    const doc = doctors[di]; if (!doc) return;
    if (date !== DEMO_DATE && (s + i) % 5 === 4 && i > 1) return; // deterministic per-day variation
    out.push({
      id: clinicId * 100000 + Number(date.replace(/-/g, '').slice(2)) * 10 + i,
      clinicId, doctorId: doc.id,
      patientName: FIXTURE_PATIENTS[(s + i) % FIXTURE_PATIENTS.length] || null,
      startsAt: localToUtc(date, start), endsAt: localToUtc(date, start + dur),
      lifecycle, conflict, syncPending: sync,
    });
  });
  return out;
}

export function createMockSchedulingAdapter(scenario: MockScenario, opts: { latency?: (call: number) => number } = {}): SchedulingReadAdapter {
  let call = 0;
  const delay = (signal?: AbortSignal) => wait(opts.latency ? opts.latency(call++) : scenario === 'slow' ? 1800 : 250, signal);
  const doctorsFor = (clinicId: number): CalendarDoctor[] =>
    scenario === 'no-doctors' ? [] : FIXTURE_DOCTORS.map((name, i) => ({ id: clinicId * 100 + i + 1, clinicId, name }));
  return {
    mode: 'mock', scenario,
    async listDoctors(clinicId, signal) { await delay(signal); return doctorsFor(clinicId); },
    async listAppointments(q, signal) {
      await delay(signal);
      if (scenario === 'error') throw new Error('Mock scenario: appointments unavailable');
      if (scenario === 'empty') return [];
      const docs = doctorsFor(q.clinicId);
      const out: CalendarAppointment[] = [];
      for (let d = localDateOf(q.from); localToUtc(d, 0) < q.to; d = addLocalDays(d, 1)) out.push(...mockDay(q.clinicId, d, docs));
      return out.filter((a) => a.startsAt >= q.from && a.startsAt < q.to && (!q.doctorId || a.doctorId === q.doctorId));
    },
    async clinicHours(_clinicId, signal) {
      await delay(signal);
      return scenario === 'no-hours' ? null : { open: 8 * 60, close: 16 * 60, slotMinutes: 30 };
    },
  };
}

/** Fixed historical date exposing the full fixture set; always labeled as demo, never as today. */
export const DEMO_DATE = '2025-03-10';

/**
 * Mock is explicit: DEV builds with `?calendarDemo=<scenario>`, or the DEV shell fixture
 * (`?shellDemo=`) which implies `standard`. Production always uses the real adapter.
 */
export function resolveSchedulingAdapter(search: string, shellFixture: boolean, dev = import.meta.env.DEV): SchedulingReadAdapter {
  if (!dev) return realSchedulingAdapter;
  const q = new URLSearchParams(search).get('calendarDemo');
  if (q && (MOCK_SCENARIOS as readonly string[]).includes(q)) return createMockSchedulingAdapter(q as MockScenario);
  return shellFixture ? createMockSchedulingAdapter('standard') : realSchedulingAdapter;
}

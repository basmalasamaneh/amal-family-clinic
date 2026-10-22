import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { fail } from "../lib/auth-errors";

export interface Appointment {
  id: number;
  clinicId: number;
  doctorId: number;
  patientId: number;
  startAt: string;
  durationMinutes: number;
  status: string;
}

export interface Settings {
  /** JavaScript weekdays: Sunday = 0. */
  workingDays: number[];
  openTime: string;
  closeTime: string;
  slotMinutes: number;
  timezone: string;
}

export interface Hold {
  doctorId: number;
  clinicId: number;
  startAt: string;
  durationMinutes: number;
  ownerId: number;
  expiresAt: string;
}

export interface SuggestedSlot {
  startsAt: string;
  endsAt: string;
}

export type ConflictType =
  | "doctor-overlap"
  | "patient-overlap"
  | "same-day-other-clinic"
  | "outside-hours"
  | "slot-held";

export interface ConflictResult {
  /** Commit eligibility, not merely absence of conflicts. */
  ok: boolean;
  conflicts: {
    type: ConflictType;
    with: { appointmentId: number; clinicId: number } | null;
    severity: "blocking" | "warning" | "info";
    suggestedSlots: SuggestedSlot[];
  }[];
}

export interface EvaluationInput {
  appointment: Appointment;
  appointments: Appointment[];
  holds: Hold[];
  settings: Settings;
  now: Date;
  ownerId: number;
  overrideReason?: string;
  canOverride: boolean;
  /** Internal safety equivalence, not an authorization or consent grant. */
  equivalentPatientIds?: readonly number[];
  visible: (appointment: Appointment) => boolean;
}

/** Completed/no_show/cancelled do not reserve time. No unsupported API "arrived" status. */
export const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["booked", "double_booked"]);
const MINUTE = 60_000;
const DAY = 86_400_000;
const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/;
const utcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function instant(value: string): number {
  const result = typeof value === "string" && utcPattern.test(value) ? Date.parse(value) : NaN;
  if (!Number.isFinite(result) ||
      new Date(result).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw fail(400, "VALIDATION", "validation");
  }
  return result;
}

function interval(value: Pick<Appointment, "startAt" | "durationMinutes">) {
  if (!Number.isInteger(value.durationMinutes) || value.durationMinutes < 1 || value.durationMinutes > 1440) {
    throw fail(400, "VALIDATION", "validation");
  }
  const start = instant(value.startAt);
  return { start, end: start + value.durationMinutes * MINUTE };
}

function clockMilliseconds(value: string): number {
  const [hours, minutes, seconds = "0"] = value.split(":");
  return (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000;
}

function validateSettings(settings: Settings): void {
  const invalid = () => fail(422, "INVALID_CLINIC_SETTINGS", "invalidClinicSettings");
  if (!settings || !Array.isArray(settings.workingDays) ||
      settings.workingDays.length < 1 || settings.workingDays.length > 7 ||
      new Set(settings.workingDays).size !== settings.workingDays.length ||
      settings.workingDays.some(day => !Number.isInteger(day) || day < 0 || day > 6) ||
      !Number.isInteger(settings.slotMinutes) || settings.slotMinutes < 1 || settings.slotMinutes > 1440 ||
      typeof settings.openTime !== "string" || !clockPattern.test(settings.openTime) ||
      typeof settings.closeTime !== "string" || !clockPattern.test(settings.closeTime) ||
      clockMilliseconds(settings.openTime) >= clockMilliseconds(settings.closeTime) ||
      typeof settings.timezone !== "string" || !settings.timezone.trim()) {
    throw invalid();
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: settings.timezone }).format(0);
  } catch {
    throw invalid();
  }
}

function addLocalDays(day: string, count: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY).toISOString().slice(0, 10);
}

type Interval = { start: number; end: number };
const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;
const samePatient = (input: EvaluationInput, other: Appointment) =>
  other.patientId === input.appointment.patientId || Boolean(input.equivalentPatientIds?.includes(other.patientId));

function windowFor(day: string, settings: Settings): Interval | null {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  if (!settings.workingDays.includes(weekday)) return null;
  const open = clockMilliseconds(settings.openTime);
  const close = clockMilliseconds(settings.closeTime);
  // Convert local boundaries, never reinterpret an already-normalized operational instant.
  const at = (milliseconds: number, boundary: "open" | "close") => {
    const local = `${day}T${new Date(milliseconds).toISOString().slice(11, 23)}`;
    const base = fromZonedTime(local, settings.timezone).getTime();
    if (!Number.isFinite(base)) return NaN;
    const candidates = new Set([base]);
    // fromZonedTime chooses one occurrence of an ambiguous clock reading.
    // Sample adjacent offsets so both occurrences can bound fall-back opening hours.
    for (const delta of [-DAY, DAY]) {
      const sample = base + delta;
      const wall = formatInTimeZone(sample, settings.timezone, "yyyy-MM-dd'T'HH:mm:ss.SSS");
      const offset = Date.parse(`${wall}Z`) - sample;
      candidates.add(Date.parse(`${local}Z`) - offset);
    }
    const matching = [...candidates].filter(candidate =>
      formatInTimeZone(candidate, settings.timezone, "yyyy-MM-dd'T'HH:mm:ss.SSS") === local);
    if (!matching.length) return NaN;
    return boundary === "open" ? Math.min(...matching) : Math.max(...matching);
  };
  const start = at(open, "open");
  const end = at(close, "close");
  // Nonexistent DST boundaries cannot manufacture opening hours on a shifted local time.
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start ||
      localClock(start, settings.timezone) !== open || localClock(end, settings.timezone) !== close) return null;
  return { start, end };
}

function localClock(at: number, timezone: string): number {
  return clockMilliseconds(formatInTimeZone(at, timezone, "HH:mm:ss.SSS"));
}

function fits(value: Interval, settings: Settings): boolean {
  const day = formatInTimeZone(value.start, settings.timezone, "yyyy-MM-dd");
  const window = windowFor(day, settings);
  if (!window || value.start < window.start || value.end > window.end ||
      formatInTimeZone(value.end - 1, settings.timezone, "yyyy-MM-dd") !== day) return false;
  const open = clockMilliseconds(settings.openTime);
  const close = clockMilliseconds(settings.closeTime);
  const first = localClock(value.start, settings.timezone);
  const last = localClock(value.end - 1, settings.timezone);
  if (first < open || first >= close || last < open || last >= close) return false;
  if (last - first === value.end - value.start - 1) return true;
  // Check the whole local interval, including a repeated hour after a fall-back.
  // Minute stepping is sufficient for operational minute durations; also check endpoints.
  for (let at = value.start; at < value.end; at += MINUTE) {
    const clock = localClock(at, settings.timezone);
    if (clock < open || clock >= close) return false;
  }
  return true;
}

/** Shared bounded slot search for conflict suggestions and reception availability. */
function* eligibleStarts(
  appointment: Appointment, settings: Settings, now: Date, firstDay: string,
  occupied: Interval[], holds: Interval[],
): Generator<number> {
  for (let dayIndex = 0; dayIndex < 30; dayIndex++) {
    const day = addLocalDays(firstDay, dayIndex);
    const window = windowFor(day, settings);
    if (!window) continue;
    // Walk UTC minutes so DST gaps disappear and repeated clocks stay distinct.
    for (let start = window.start; start + appointment.durationMinutes * MINUTE <= window.end; start += MINUTE) {
      if (start <= now.getTime()) continue;
      const offset = localClock(start, settings.timezone) - clockMilliseconds(settings.openTime);
      if (offset < 0 || offset % (settings.slotMinutes * MINUTE) !== 0) continue;
      const candidate = { start, end: start + appointment.durationMinutes * MINUTE };
      if (occupied.some(value => overlaps(candidate, value)) || holds.some(value => overlaps(candidate, value))) continue;
      if (fits(candidate, settings)) yield start;
    }
  }
}

/** Earliest future eligible interval, with no patient-overlap override or hold exemption. */
export function nearestAvailability(input: EvaluationInput): SuggestedSlot | null {
  validateSettings(input.settings);
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) throw fail(400, "VALIDATION", "validation");
  interval(input.appointment);
  const occupied = input.appointments
    .filter(a => ACTIVE_STATUSES.has(a.status) &&
      (a.doctorId === input.appointment.doctorId || samePatient(input, a)))
    .map(interval);
  const holds = input.holds.filter(h => h.doctorId === input.appointment.doctorId &&
    instant(h.expiresAt) > input.now.getTime()).map(interval);
  const firstDay = formatInTimeZone(input.now, input.settings.timezone, "yyyy-MM-dd");
  const start = eligibleStarts(input.appointment, input.settings, input.now, firstDay, occupied, holds).next().value;
  return start === undefined ? null : {
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + input.appointment.durationMinutes * MINUTE).toISOString(),
  };
}

/**
 * Pure and deterministic; callers own persistence, locking, audit and relationship authorization.
 * Search covers 30 local dates starting at max(today, requested-day minus 15 days).
 * This includes preceding dates for genuine nearest-distance ordering, even for far-future requests.
 * Only starts strictly after now qualify. Ties prefer the earlier UTC instant.
 */
export function evaluate(input: EvaluationInput): ConflictResult {
  const { appointment, settings, now } = input;
  validateSettings(settings);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw fail(400, "VALIDATION", "validation");
  const requested = interval(appointment);
  const active = input.appointments
    .filter(a => a.id !== appointment.id && ACTIVE_STATUSES.has(a.status))
    .sort((a, b) => a.id - b.id)
    .map(a => ({ appointment: a, interval: interval(a) }));
  const holds = input.holds
    .filter(h => h.ownerId !== input.ownerId && instant(h.expiresAt) > now.getTime())
    .filter(h => h.doctorId === appointment.doctorId)
    .map(h => interval(h));
  const conflicts: ConflictResult["conflicts"] = [];
  const push = (type: ConflictType, severity: "blocking" | "warning" | "info", other?: Appointment) => {
    const evidence = other && other.patientId === appointment.patientId && input.visible(other) ||
      other && !samePatient(input, other) && input.visible(other);
    // Hidden safety evidence is existence-only, never a count of matched records.
    if (!evidence && conflicts.some(c => c.type === type && c.with === null)) return;
    conflicts.push({
      type,
      with: other && evidence ? { appointmentId: other.id, clinicId: other.clinicId } : null,
      severity,
      suggestedSlots: [],
    });
  };

  // Cancellation / historical status changes must not be blocked by their old interval.
  if (!ACTIVE_STATUSES.has(appointment.status)) return { ok: true, conflicts };

  if (!fits(requested, settings)) push("outside-hours", "blocking");
  const requestedDay = formatInTimeZone(requested.start, settings.timezone, "yyyy-MM-dd");
  // Network patient-day notices are always Hebron days, independent of clinic opening-hours zone.
  const patientDay = formatInTimeZone(requested.start, "Asia/Hebron", "yyyy-MM-dd");
  for (const { appointment: other, interval: otherInterval } of active) {
    const overlapping = overlaps(requested, otherInterval);
    if (other.doctorId === appointment.doctorId && overlapping) push("doctor-overlap", "blocking", other);
    if (!samePatient(input, other)) continue;
    if (overlapping) push("patient-overlap", "blocking", other);
    else if (other.patientId === appointment.patientId && input.visible(other) && other.clinicId !== appointment.clinicId &&
      formatInTimeZone(otherInterval.start, "Asia/Hebron", "yyyy-MM-dd") === patientDay) {
      // An overlapping pair already has its more important warning, not a duplicate info notice.
      push("same-day-other-clinic", "info", other);
    }
  }
  if (holds.some(hold => overlaps(requested, hold))) push("slot-held", "blocking");

  if (conflicts.some(c => c.severity === "blocking")) {
    const today = formatInTimeZone(now, settings.timezone, "yyyy-MM-dd");
    const centered = addLocalDays(requestedDay, -15);
    const firstDay = centered > today ? centered : today;
    const occupied = active.filter(a => a.appointment.doctorId === appointment.doctorId ||
      samePatient(input, a.appointment)).map(a => a.interval);
    const candidates = [...eligibleStarts(appointment, settings, now, firstDay, occupied, holds)];
    candidates.sort((a, b) => Math.abs(a - requested.start) - Math.abs(b - requested.start) || a - b);
    const slots = candidates.slice(0, 3).map(start => ({
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + appointment.durationMinutes * MINUTE).toISOString(),
    }));
    for (const conflict of conflicts) {
      if (conflict.severity === "blocking") conflict.suggestedSlots = slots.map(slot => ({ ...slot }));
    }
  }
  const acknowledged = input.canOverride && Boolean(input.overrideReason?.trim());
  return {
    ok: !conflicts.some(c => c.severity === "blocking" || (c.severity === "warning" && !acknowledged)),
    conflicts,
  };
}

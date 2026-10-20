import assert from "node:assert/strict";
import { test } from "node:test";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { readSource } from "../../../scripts/src/seed-source";
import { ApiError } from "../src/lib/auth-errors";
import {
  ACTIVE_STATUSES, evaluate, nearestAvailability,
  type Appointment, type EvaluationInput, type Hold, type Settings,
} from "../src/appointments/engine";

const settings: Settings = {
  workingDays: [0, 1, 2, 3, 4, 5, 6],
  openTime: "08:00", closeTime: "17:00", slotMinutes: 30, timezone: "Asia/Hebron",
};
const utc = (local: string, timezone = settings.timezone) => fromZonedTime(local, timezone).toISOString();
const appointment = (overrides: Partial<Appointment> = {}): Appointment => ({
  id: 1, clinicId: 1, doctorId: 1, patientId: 1,
  startAt: utc("2026-09-09T10:00:00"), durationMinutes: 30, status: "booked", ...overrides,
});
const other = (overrides: Partial<Appointment> = {}) => appointment({
  id: 2, patientId: 2, ...overrides,
});
function check(overrides: Partial<EvaluationInput> = {}) {
  return evaluate({
    appointment: appointment(), appointments: [], holds: [], settings,
    now: new Date(utc("2026-09-09T07:00:00")), ownerId: 1,
    canOverride: false, visible: () => true, ...overrides,
  });
}
const types = (result: ReturnType<typeof check>) => result.conflicts.map(c => c.type);

test("reception availability shares grid/hours, excludes patient overlap and all active holds without overrides", () => {
  const now = new Date(utc("2026-09-09T07:55:00"));
  const input: EvaluationInput = {
    appointment: appointment({ id: 0, startAt: now.toISOString() }),
    appointments: [
      other({ startAt: utc("2026-09-09T08:00:00") }),
      other({ id: 3, doctorId: 9, clinicId: 9, patientId: 1, startAt: utc("2026-09-09T08:30:00") }),
      other({ id: 4, startAt: utc("2026-09-09T09:30:00"), status: "cancelled" }),
    ],
    holds: [{ doctorId: 1, clinicId: 1, startAt: utc("2026-09-09T09:00:00"), durationMinutes: 30,
      ownerId: 1, expiresAt: utc("2026-09-09T10:00:00") }],
    settings, now, ownerId: 1, canOverride: false, visible: () => false,
  };
  assert.deepEqual(nearestAvailability(input), {
    startsAt: utc("2026-09-09T09:30:00"), endsAt: utc("2026-09-09T10:00:00"),
  });
  assert.deepEqual(nearestAvailability({ ...input, holds: input.holds.map(h => ({ ...h, expiresAt: now.toISOString() })) }), {
    startsAt: utc("2026-09-09T09:00:00"), endsAt: utc("2026-09-09T09:30:00"),
  });
  assert.equal(nearestAvailability({ ...input, appointments: [], holds: [],
    now: new Date(utc("2026-09-09T08:00:00")) })!.startsAt, utc("2026-09-09T08:30:00"),
  "starts strictly after checkedAt, never an already-started slot");
});

test("reception availability is bounded to 30 local dates and respects no-slot and invalid settings", () => {
  const now = new Date(utc("2026-09-09T07:00:00"));
  const input: EvaluationInput = {
    appointment: appointment({ id: 0, startAt: now.toISOString(), durationMinutes: 30 }),
    appointments: [], holds: [], settings: { ...settings, openTime: "08:00", closeTime: "08:30" },
    now, ownerId: 1, canOverride: false, visible: () => false,
  };
  const busy = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 8, 9 + i)).toISOString().slice(0, 10);
    return other({ id: i + 2, startAt: utc(`${date}T08:00:00`) });
  });
  assert.equal(nearestAvailability({ ...input, appointments: busy }), null);
  assert.equal(nearestAvailability({ ...input, appointment: { ...input.appointment, durationMinutes: 60 } }), null);
  assert.throws(() => nearestAvailability({ ...input, settings: { ...settings, slotMinutes: 0 } }));
});

test("reception availability walks real DST instants and never fabricates a shifted opening boundary", () => {
  for (const day of ["2026-03-28", "2026-10-24"]) {
    const now = new Date(utc(`${day}T00:00:00`));
    const slot = nearestAvailability({
      appointment: appointment({ id: 0, startAt: now.toISOString(), durationMinutes: 15 }),
      appointments: [], holds: [], settings: { ...settings, slotMinutes: 15 }, now,
      ownerId: 1, canOverride: false, visible: () => false,
    });
    assert(slot);
    assert.equal(formatInTimeZone(slot.startsAt, "Asia/Hebron", "yyyy-MM-dd HH:mm"), `${day} 08:00`);
    assert.equal(Date.parse(slot.endsAt) - Date.parse(slot.startsAt), 15 * 60000);
  }
});

test("half-open intervals permit adjacent starts and ends, and exclude the edited id", () => {
  const result = check({ appointments: [
    other({ startAt: utc("2026-09-09T09:30:00") }),
    other({ id: 3, startAt: utc("2026-09-09T10:30:00") }),
    appointment(),
  ] });
  assert.deepEqual(result, { ok: true, conflicts: [] });
});

test("unequal durations detect containment and overlaps that do not have equal starts", () => {
  for (const row of [
    other({ startAt: utc("2026-09-09T09:15:00"), durationMinutes: 60 }),
    other({ startAt: utc("2026-09-09T10:15:00"), durationMinutes: 10 }),
    other({ durationMinutes: 90 }),
  ]) {
    const result = check({ appointments: [row], canOverride: true, overrideReason: "urgent" });
    assert.equal(result.ok, false);
    assert.deepEqual(types(result), ["doctor-overlap"]);
  }
});

test("only booked and double_booked reserve time; all historical/cancelled statuses release", () => {
  assert.deepEqual([...ACTIVE_STATUSES], ["booked", "double_booked"]);
  for (const status of ["completed", "no_show", "cancelled"]) {
    assert.equal(check({ appointments: [other({ status })] }).ok, true);
    assert.deepEqual(check({ appointment: appointment({ status }), appointments: [other()] }),
      { ok: true, conflicts: [] });
  }
  assert.equal(check({ appointments: [other({ status: "double_booked" })] }).ok, false);
});

test("patient overlaps warn at any clinic and need both authorized and nonblank reason", () => {
  for (const clinicId of [1, 2]) {
    const row = other({ doctorId: 2, clinicId, patientId: 1 });
    for (const [canOverride, overrideReason, ok] of [
      [false, undefined, false], [true, undefined, false], [true, "   ", false],
      [false, "urgent", false], [true, " documented reason ", true],
    ] as const) {
      const result = check({ appointments: [row], canOverride, overrideReason });
      assert.equal(result.ok, ok);
      assert.deepEqual(result.conflicts, [{
        type: "patient-overlap", with: { appointmentId: 2, clinicId },
        severity: "warning", suggestedSlots: [],
      }]);
    }
  }
});

test("same local day at another clinic is information, deduplicated with overlapping patient warnings", () => {
  const row = other({ clinicId: 2, doctorId: 2, patientId: 1, startAt: utc("2026-09-09T15:00:00") });
  assert.equal(check({ appointments: [row] }).ok, true);
  assert.deepEqual(types(check({ appointments: [row] })), ["same-day-other-clinic"]);
  assert.deepEqual(types(check({ appointments: [{ ...row, startAt: appointment().startAt }] })), ["patient-overlap"]);
  assert.deepEqual(types(check({ appointments: [{ ...row, clinicId: 1 }] })), []);
  assert.deepEqual(types(check({ appointments: [{ ...row, startAt: utc("2026-09-10T10:00:00") }] })), []);
});

test("local-date information uses Asia/Hebron rather than UTC date", () => {
  const result = check({
    appointment: appointment({ startAt: "2026-09-08T21:30:00.000Z" }),
    appointments: [other({ doctorId: 2, clinicId: 2, patientId: 1, startAt: "2026-09-09T07:00:00.000Z" })],
  });
  assert(types(result).includes("same-day-other-clinic"));
});

test("patient-day notices always use Hebron even when clinic windows use another valid timezone", () => {
  const clinicSettings = { ...settings, timezone: "UTC", openTime: "00:00", closeTime: "23:59" };
  const row = appointment({ startAt: "2026-09-08T21:30:00.000Z" }); // Hebron September 9.
  const sameHebronDay = other({
    doctorId: 2, clinicId: 2, patientId: 1, startAt: "2026-09-09T07:00:00.000Z",
  });
  const differentHebronDay = { ...sameHebronDay, startAt: "2026-09-08T10:00:00.000Z" };
  assert.deepEqual(check({ appointment: row, appointments: [sameHebronDay], settings: clinicSettings }), {
    ok: true, conflicts: [{
      type: "same-day-other-clinic", with: { appointmentId: 2, clinicId: 2 },
      severity: "info", suggestedSlots: [],
    }],
  });
  assert.deepEqual(check({ appointment: row, appointments: [differentHebronDay], settings: clinicSettings }), {
    ok: true, conflicts: [],
  });
});

test("conflict projections contain only appointmentId and clinicId, or null if invisible", () => {
  const row = { ...other(), clinicalNotes: "must never leave evaluation", patientName: "private" };
  for (const visible of [true, false]) {
    const result = check({ appointments: [row], visible: () => visible });
    assert.deepEqual(Object.keys(result).sort(), ["conflicts", "ok"]);
    assert.deepEqual(Object.keys(result.conflicts[0]!).sort(), ["severity", "suggestedSlots", "type", "with"]);
    assert.deepEqual(result.conflicts[0]!.with, visible ? { appointmentId: 2, clinicId: 1 } : null);
    assert(!JSON.stringify(result).includes("must never"));
    assert.equal(result.ok, false, "redaction never disables conflict detection");
  }
});

test("the complete interval must fit local days and opening/closing hours; override cannot bypass", () => {
  for (const [start, durationMinutes, expected] of [
    ["07:59:00", 30, false], ["08:00:00", 30, true],
    ["16:30:00", 30, true], ["16:31:00", 30, false],
    ["16:00:00", 600, false], ["23:45:00", 30, false],
  ] as const) {
    const result = check({
      appointment: appointment({ startAt: utc(`2026-09-09T${start}`), durationMinutes }),
      canOverride: true, overrideReason: "not an hours override",
    });
    assert.equal(result.ok, expected);
    assert.deepEqual(types(result), expected ? [] : ["outside-hours"]);
  }
  const result = check({ settings: { ...settings, workingDays: [0] } });
  assert.deepEqual(types(result), ["outside-hours"]);
  assert.equal(result.conflicts[0]!.with, null);
});

test("invalid or missing settings throw the existing typed error, never always-open fallback", () => {
  const invalid: unknown[] = [
    undefined, null, {}, { ...settings, timezone: "not/a-zone" }, { ...settings, timezone: "" },
    { ...settings, workingDays: [] }, { ...settings, workingDays: [7] },
    { ...settings, workingDays: [1, 1] }, { ...settings, slotMinutes: 0 },
    { ...settings, slotMinutes: 1.5 }, { ...settings, openTime: "25:00" },
    { ...settings, openTime: "17:00" }, { ...settings, closeTime: undefined },
  ];
  for (const value of invalid) {
    assert.throws(() => check({ settings: value as Settings }), (error: unknown) =>
      error instanceof ApiError && error.code === "INVALID_CLINIC_SETTINGS" &&
      error.status === 422 && error.key === "invalidClinicSettings");
  }
  assert.equal(check({ settings: { ...settings, openTime: "08:00:00", closeTime: "17:00:00.000000" } }).ok, true);
});

test("invalid instants, normalized impossible calendar dates and invalid durations are rejected", () => {
  const validation = (error: unknown) => error instanceof ApiError &&
    error.status === 400 && error.code === "VALIDATION" && error.key === "validation";
  for (const startAt of ["2026-09-09T10:00:00", "not a date", "2026-02-30T10:00:00Z"]) {
    assert.throws(() => check({ appointment: appointment({ startAt }) }), validation);
  }
  for (const durationMinutes of [0, -1, 1.5, NaN, 1441]) {
    assert.throws(() => check({ appointment: appointment({ durationMinutes }) }), validation);
  }
  assert.throws(() => check({ now: new Date(NaN) }), validation);
});

test("suggestions are nearest eligible instants; equal distances use earlier UTC", () => {
  const result = check({ appointments: [other()] });
  assert.deepEqual(result.conflicts[0]!.suggestedSlots, ["09:30:00", "10:30:00", "09:00:00"].map(time => ({
    startsAt: utc(`2026-09-09T${time}`),
    endsAt: new Date(Date.parse(utc(`2026-09-09T${time}`)) + 30 * 60_000).toISOString(),
  })));
  assert.deepEqual(result, check({ appointments: [other()] }), "evaluation is deterministic");
});

test("suggestions honor duration, doctor bookings across clinics and patient overlaps", () => {
  const result = check({
    appointment: appointment({ durationMinutes: 60 }),
    appointments: [
      other(), other({ id: 3, clinicId: 2, startAt: utc("2026-09-09T09:00:00") }),
      other({ id: 4, doctorId: 2, patientId: 1, startAt: utc("2026-09-09T10:30:00") }),
    ],
  });
  assert.deepEqual(result.conflicts[0]!.suggestedSlots.map(s => s.startsAt), [
    utc("2026-09-09T11:00:00"), utc("2026-09-09T11:30:00"), utc("2026-09-09T08:00:00"),
  ]);
  for (const slot of result.conflicts[0]!.suggestedSlots) {
    assert.equal(Date.parse(slot.endsAt) - Date.parse(slot.startsAt), 60 * 60_000);
  }
});

test("suggestions are strictly future-only, bounded to 30 local dates, and may contain fewer than 3", () => {
  const result = check({
    appointment: appointment({ durationMinutes: 90 }), appointments: [other()],
    settings: { ...settings, openTime: "10:00", closeTime: "10:30" },
  });
  assert.deepEqual(result.conflicts[0]!.suggestedSlots, []);
  const future = check({
    appointments: [other()], now: new Date(appointment().startAt),
    settings: { ...settings, closeTime: "10:30" },
  });
  const slots = future.conflicts[0]!.suggestedSlots;
  assert.equal(slots.length, 3);
  for (const slot of slots) {
    assert(Date.parse(slot.startsAt) > Date.parse(appointment().startAt));
    assert(formatInTimeZone(slot.startsAt, settings.timezone, "yyyy-MM-dd") < "2026-10-09");
  }
  // A once-weekly 15-minute window cannot fit a 30-minute request: no fabricated slots.
  const none = check({ appointments: [other()], settings: { ...settings, workingDays: [3], closeTime: "08:15" } });
  assert.deepEqual(none.conflicts[0]!.suggestedSlots, []);
  const occupied = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(Date.UTC(2026, 8, 9 + index)).toISOString().slice(0, 10);
    return other({ id: index + 2, startAt: utc(`${day}T10:00:00`) });
  }).filter((_, index) => index !== 1 && index !== 2);
  const two = check({ appointments: occupied, settings: { ...settings, openTime: "10:00", closeTime: "10:30" } });
  assert.deepEqual(two.conflicts[0]!.suggestedSlots.map(s => s.startsAt), [
    utc("2026-09-10T10:00:00"), utc("2026-09-11T10:00:00"),
  ]);
});

test("nearest search includes previous local days for a future requested date", () => {
  const result = check({
    appointment: appointment({ startAt: utc("2026-09-25T08:00:00") }),
    appointments: [other({ startAt: utc("2026-09-25T08:00:00"), durationMinutes: 540 })],
  });
  assert.deepEqual(result.conflicts[0]!.suggestedSlots.map(s => s.startsAt), [
    utc("2026-09-24T16:30:00"), utc("2026-09-24T16:00:00"), utc("2026-09-24T15:30:00"),
  ]);
});

test("other owners hold the doctor across clinics, owners can commit, expiry is exact at 30 seconds", () => {
  const acquired = new Date(utc("2026-09-09T07:00:00"));
  const hold: Hold = {
    doctorId: 1, clinicId: 2, startAt: appointment().startAt, durationMinutes: 30,
    ownerId: 2, expiresAt: new Date(acquired.getTime() + 30_000).toISOString(),
  };
  assert.deepEqual(types(check({ holds: [hold], now: new Date(acquired.getTime() + 29_999) })), ["slot-held"]);
  assert.deepEqual(check({ holds: [hold], now: new Date(acquired.getTime() + 30_000) }), { ok: true, conflicts: [] });
  assert.equal(check({ holds: [hold], ownerId: 2 }).ok, true);
  assert.equal(check({ holds: [{ ...hold, doctorId: 2 }] }).ok, true);
  assert.equal(check({ holds: [{ ...hold, startAt: utc("2026-09-09T10:30:00") }] }).ok, true);
  const result = check({
    appointments: [other()],
    holds: [{ ...hold, startAt: utc("2026-09-09T09:30:00") }],
  });
  assert(!result.conflicts[0]!.suggestedSlots.some(s => s.startsAt === utc("2026-09-09T09:30:00")));
  assert.equal(check({ holds: [hold], canOverride: true, overrideReason: "urgent" }).ok, false);
});

test("spring DST uses elapsed duration and local boundaries without imaginary slots", () => {
  const timezone = "America/New_York";
  const localSettings = { ...settings, timezone, openTime: "01:00", closeTime: "04:00" };
  const row = appointment({ startAt: utc("2026-03-08T01:30:00", timezone), durationMinutes: 90 });
  assert.equal(check({ appointment: row, settings: localSettings, now: new Date("2026-03-08T05:00:00Z") }).ok, true);
  assert.equal(check({
    appointment: { ...row, durationMinutes: 91 }, settings: localSettings,
    now: new Date("2026-03-08T05:00:00Z"),
  }).ok, false);
  const result = check({
    appointment: row, appointments: [{ ...row, id: 2, patientId: 2 }],
    settings: localSettings, now: new Date("2026-03-08T05:00:00Z"),
  });
  for (const slot of result.conflicts[0]!.suggestedSlots) {
    assert.notEqual(formatInTimeZone(slot.startsAt, timezone, "yyyy-MM-dd HH"), "2026-03-08 02");
    assert.equal(Date.parse(slot.endsAt) - Date.parse(slot.startsAt), 90 * 60_000);
  }
});

test("a nonexistent DST opening boundary yields no shifted availability for that date", () => {
  const result = check({
    appointment: appointment({ startAt: "2026-03-08T07:30:00.000Z" }),
    settings: { ...settings, timezone: "America/New_York", openTime: "02:00", closeTime: "04:00" },
    now: new Date("2026-03-08T05:00:00Z"),
  });
  assert.deepEqual(types(result), ["outside-hours"]);
  assert(result.conflicts[0]!.suggestedSlots.every(slot =>
    formatInTimeZone(slot.startsAt, "America/New_York", "yyyy-MM-dd") !== "2026-03-08"));
});

test("evaluation does not mutate caller records, settings, holds, arrays or current time", () => {
  const input: EvaluationInput = {
    appointment: Object.freeze(appointment()), appointments: [Object.freeze(other())],
    settings: Object.freeze({ ...settings, workingDays: Object.freeze([...settings.workingDays]) as unknown as number[] }),
    holds: [], now: new Date(utc("2026-09-09T07:00:00")),
    ownerId: 1, canOverride: false, visible: () => true,
  };
  const before = JSON.stringify(input);
  Object.freeze(input.appointments);
  Object.freeze(input.holds);
  evaluate(input);
  assert.equal(JSON.stringify(input), before);
});

test("fall DST retains distinct UTC occurrences of repeated local slots", () => {
  const result = check({
    appointment: appointment({ startAt: "2026-11-01T05:00:00.000Z" }),
    appointments: [other({ startAt: "2026-11-01T05:00:00.000Z" })],
    settings: { ...settings, timezone: "America/New_York", openTime: "00:00", closeTime: "04:00" },
    now: new Date("2026-11-01T03:00:00Z"),
  });
  assert.deepEqual(result.conflicts[0]!.suggestedSlots.map(s => s.startsAt), [
    "2026-11-01T04:30:00.000Z", "2026-11-01T05:30:00.000Z", "2026-11-01T04:00:00.000Z",
  ]);
  const later = check({
    appointment: appointment({ startAt: "2026-11-01T06:00:00.000Z" }),
    appointments: [other({ startAt: "2026-11-01T06:00:00.000Z" })],
    settings: { ...settings, timezone: "America/New_York", openTime: "00:00", closeTime: "04:00" },
    now: new Date("2026-11-01T03:00:00Z"),
  });
  assert(later.conflicts[0]!.suggestedSlots.some(s => s.startsAt === "2026-11-01T05:30:00.000Z"));
});

test("fall-back closing boundaries include both occurrences but never bridge a closed local period", () => {
  const localSettings = { ...settings, timezone: "America/New_York", openTime: "01:00", closeTime: "01:30" };
  for (const startAt of ["2026-11-01T05:00:00.000Z", "2026-11-01T06:00:00.000Z"]) {
    assert.equal(check({ appointment: appointment({ startAt }), settings: localSettings }).ok, true);
  }
  // This interval ends in the second opening, but passes through the closed 01:30–01:59 period.
  assert.equal(check({
    appointment: appointment({ startAt: "2026-11-01T05:15:00.000Z", durationMinutes: 60 }),
    settings: localSettings,
  }).ok, false);
});

test("working-day selection follows local midnight, not the UTC weekday", () => {
  const localSettings = { ...settings, workingDays: [0], openTime: "00:00", closeTime: "05:00" };
  const startAt = utc("2026-09-13T00:30:00");
  assert.equal(new Date(startAt).getUTCDay(), 6);
  assert.equal(check({ appointment: appointment({ startAt }), settings: localSettings }).ok, true);
  assert.equal(check({
    appointment: appointment({ startAt }), settings: { ...localSettings, workingDays: [6] },
  }).ok, false);
});

test("Asia/Hebron opening instants follow its actual seasonal offset", () => {
  for (const date of ["2026-01-15", "2026-07-15"]) {
    const row = appointment({ startAt: utc(`${date}T08:00:00`) });
    assert.equal(check({ appointment: row }).ok, true);
    assert.equal(formatInTimeZone(row.startAt, settings.timezone, "HH:mm"), "08:00");
  }
  assert.notEqual(utc("2026-01-15T08:00:00").slice(11, 16), utc("2026-07-15T08:00:00").slice(11, 16));
});

test("Asia/Hebron spring gap preserves elapsed duration and never suggests the skipped 02:00 hour", () => {
  // At 2026-03-28T00:00Z Hebron jumps from 01:59:59 +02 to 03:00:00 +03.
  assert.equal(formatInTimeZone("2026-03-27T23:59:59Z", "Asia/Hebron", "yyyy-MM-dd HH:mm:ss xxx"),
    "2026-03-28 01:59:59 +02:00");
  assert.equal(formatInTimeZone("2026-03-28T00:00:00Z", "Asia/Hebron", "yyyy-MM-dd HH:mm:ss xxx"),
    "2026-03-28 03:00:00 +03:00");
  const gapSettings = { ...settings, openTime: "01:00", closeTime: "04:00" };
  const row = appointment({ startAt: "2026-03-27T23:30:00.000Z", durationMinutes: 90 });
  const now = new Date("2026-03-27T21:00:00Z");
  assert.equal(check({ appointment: row, settings: gapSettings, now }).ok, true);
  assert.deepEqual(types(check({
    appointment: { ...row, durationMinutes: 91 }, settings: gapSettings, now,
  })), ["outside-hours"]);
  const result = check({
    appointment: row, appointments: [{ ...row, id: 2, patientId: 2 }], settings: gapSettings, now,
  });
  assert.equal(result.conflicts[0]!.suggestedSlots.length, 3);
  for (const slot of result.conflicts[0]!.suggestedSlots) {
    assert.notEqual(formatInTimeZone(slot.startsAt, "Asia/Hebron", "yyyy-MM-dd HH"), "2026-03-28 02");
    assert.equal(Date.parse(slot.endsAt) - Date.parse(slot.startsAt), 90 * 60_000);
  }
  const nonexistentOpening = check({
    appointment: appointment({ startAt: "2026-03-28T00:00:00.000Z" }),
    settings: { ...gapSettings, openTime: "02:00" }, now,
  });
  assert.deepEqual(types(nonexistentOpening), ["outside-hours"]);
  assert(nonexistentOpening.conflicts[0]!.suggestedSlots.every(slot =>
    formatInTimeZone(slot.startsAt, "Asia/Hebron", "yyyy-MM-dd") !== "2026-03-28"));
});

test("Asia/Hebron fall-back retains both repeated-hour UTC slots and full local interval limits", () => {
  // At 2026-10-23T23:00Z the local clock repeats 01:00 on October 24.
  assert.equal(formatInTimeZone("2026-10-23T22:59:59Z", "Asia/Hebron", "yyyy-MM-dd HH:mm:ss xxx"),
    "2026-10-24 01:59:59 +03:00");
  assert.equal(formatInTimeZone("2026-10-23T23:00:00Z", "Asia/Hebron", "yyyy-MM-dd HH:mm:ss xxx"),
    "2026-10-24 01:00:00 +02:00");
  const fallSettings = { ...settings, openTime: "00:00", closeTime: "04:00" };
  const row = appointment({ startAt: "2026-10-23T23:00:00.000Z" });
  const now = new Date("2026-10-23T20:00:00Z");
  const result = check({
    appointment: row, appointments: [other({ startAt: row.startAt })], settings: fallSettings, now,
  });
  assert.deepEqual(result.conflicts[0]!.suggestedSlots.map(slot => slot.startsAt), [
    "2026-10-23T22:30:00.000Z", "2026-10-23T23:30:00.000Z", "2026-10-23T22:00:00.000Z",
  ]);
  assert.deepEqual(result.conflicts[0]!.suggestedSlots.slice(0, 2).map(slot =>
    formatInTimeZone(slot.startsAt, "Asia/Hebron", "yyyy-MM-dd HH:mm")), [
    "2026-10-24 01:30", "2026-10-24 01:30",
  ]);
  const narrowSettings = { ...settings, openTime: "01:00", closeTime: "01:30" };
  for (const startAt of ["2026-10-23T22:00:00.000Z", "2026-10-23T23:00:00.000Z"]) {
    assert.equal(check({ appointment: appointment({ startAt }), settings: narrowSettings, now }).ok, true);
  }
  assert.equal(check({
    appointment: appointment({ startAt: "2026-10-23T22:15:00.000Z", durationMinutes: 60 }),
    settings: narrowSettings, now,
  }).ok, false, "cannot bridge the locally closed period before the clock repeats");
});

test("verified workbook baseline identifies six exact doctor pairs and both patient pairs without status filtering", t => {
  // Existing read-only reader verifies both workbook hashes; no DB access or seed writes.
  const sheet = readSource().appointments!;
  const rows: Appointment[] = sheet.rows.map(row => ({
    id: Number(row[0]), clinicId: Number(row[1]), doctorId: Number(row[2]), patientId: Number(row[3]),
    startAt: utc(String(row[4])), durationMinutes: 30, status: String(row[6]),
  }));
  assert.equal(rows.length, 102);
  const pairs = rows.flatMap((a, index) => rows.slice(index + 1).map(b => [a, b] as const));
  const doctorPairs = pairs.filter(([a, b]) => a.doctorId === b.doctorId && a.startAt === b.startAt);
  assert.deepEqual(doctorPairs.map(([a, b]) => [a.id, b.id]), [
    [10, 12], [42, 44], [46, 50], [57, 58], [67, 72], [99, 100],
  ]);
  const patientPairs = pairs.filter(([a, b]) => a.patientId === b.patientId &&
    a.clinicId !== b.clinicId && a.startAt === b.startAt);
  assert.deepEqual(patientPairs.map(([a, b]) => [
    a.id, b.id, a.patientId, formatInTimeZone(a.startAt, settings.timezone, "yyyy-MM-dd HH:mm"),
  ]), [
    [25, 31, 13, "2026-09-09 10:45"],
    [67, 81, 1, "2026-09-12 12:45"],
  ]);
  // Historical classification and live occupancy are deliberately different policies.
  for (const [a, b] of doctorPairs) {
    const historicalFixture = check({
      appointment: { ...a, status: "booked" }, appointments: [{ ...b, status: "booked" }],
    });
    assert(types(historicalFixture).includes("doctor-overlap"), `historical doctor pair ${a.id}/${b.id}`);
    assert.equal(types(check({ appointment: a, appointments: [b] })).includes("doctor-overlap"),
      ACTIVE_STATUSES.has(a.status) && ACTIVE_STATUSES.has(b.status));
  }
  for (const [a, b] of patientPairs) {
    assert(types(check({
      appointment: { ...a, status: "booked" }, appointments: [{ ...b, status: "booked" }],
    })).includes("patient-overlap"), `historical patient pair ${a.id}/${b.id}`);
  }
  const additional = pairs.filter(([a, b]) => a.doctorId === b.doctorId && a.startAt !== b.startAt &&
    Math.abs(Date.parse(a.startAt) - Date.parse(b.startAt)) < 30 * 60_000);
  t.diagnostic(`Additional duration overlaps (30-minute operational default), separate from exact baseline: ${JSON.stringify(additional.map(([a, b]) => [a.id, b.id]))}`);
  assert.equal(doctorPairs.filter(([a, b]) => a.status === "double_booked" && b.status === "double_booked").length, 1);
});

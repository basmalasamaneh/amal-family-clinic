import { describe, expect, it } from "vitest";
import type { OperationalClinic } from "@workspace/db/schema";
import { createDemoBuilders, hebronInstant } from "../builders";

/** Deliberately unrelated IDs/names to catch accidental source-clinic routing. */
function context(offset = 0) {
  const clinic = (clinic_id: number, clinic_name: string): OperationalClinic => ({
    clinic_id, clinic_name, city: "Synthetic test locality", booking_method: "amal_network",
    slot_minutes: 30, working_days: [0, 1, 2, 3, 4, 5, 6], open_time: "08:00",
    close_time: "17:00", network_mode: "full", joined_at: new Date("2026-01-01T00:00:00Z"),
    timezone: "Asia/Hebron", reminders_enabled: false,
    adoption_state: "full", membership_status: "active", adoption_changed_at: new Date("2026-01-01T00:00:00Z"),
    trial_started_at: null, lite_started_at: null, full_started_at: new Date("2026-01-01T00:00:00Z"),
    left_at: null, left_by: null,
  });
  return {
    sourceClinic: clinic(701 + offset, "Synthetic source"),
    receivingClinic: clinic(983 + offset, "Synthetic receiver"),
  };
}

const recipes = ["collision", "crossClinic", "clinicalSafety", "outage",
  "calendarImport", "sameName", "minor", "liteToFull"] as const;

describe("isolated typed in-memory demo recipes", () => {
  it.each(recipes)("%s is deterministic with no shared mutable result state", name => {
    const input = context();
    const original = structuredClone(input);
    const first = createDemoBuilders(input)[name]();
    const second = createDemoBuilders(input)[name]();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(input).toEqual(original);
  });

  it("allocates unique IDs within a factory, resets only by creating a factory", () => {
    const a = createDemoBuilders(context(), { idStart: 5000 });
    const b = createDemoBuilders(context(), { idStart: 5000 });
    expect(a.patient().patient_id).toBe(5000);
    expect(a.patient().patient_id).toBe(5001);
    expect(b.patient().patient_id).toBe(5000);
    const collision = a.collision();
    expect(new Set([collision.doctor.doctor_id, ...collision.patients.map(p => p.patient_id),
      ...collision.appointments.map(p => p.appointment_id)]).size).toBe(5);
  });

  it("snapshots context and defaults and returns independent Date/array objects", () => {
    const input = context();
    const defaults = { patient: { phone: "000123" } };
    const factory = createDemoBuilders(input, defaults);
    input.receivingClinic.working_days.length = 0;
    defaults.patient.phone = "changed";
    expect(factory.patient().phone).toBe("000123");
    const first = factory.liteToFull();
    first.initial.working_days.length = 0;
    expect(factory.liteToFull().initial.working_days).toHaveLength(7);
    const collision = factory.collision();
    collision.appointments[0]!.scheduled_at.setUTCFullYear(2000);
    expect(collision.appointments[1]!.scheduled_at.getUTCFullYear()).toBe(2026);
  });

  it.each([0, 20_000])("derives relationships from caller context (%i)", offset => {
    const input = context(offset);
    const factory = createDemoBuilders(input);
    const collision = factory.collision();
    for (const row of collision.appointments) {
      expect(row.clinic_id).toBe(input.sourceClinic.clinic_id);
      expect(row.doctor_id).toBe(collision.doctor.doctor_id);
      expect(collision.patients.map(p => p.patient_id)).toContain(row.patient_id);
    }
    const cross = factory.crossClinic();
    expect(cross.appointments.map(a => a.clinic_id)).toEqual([
      input.sourceClinic.clinic_id, input.receivingClinic.clinic_id,
    ]);
    expect(new Set(cross.appointments.map(a => a.patient_id))).toEqual(new Set([cross.patient.patient_id]));
    expect(cross.appointments[0]!.scheduled_at).toEqual(cross.appointments[1]!.scheduled_at);
  });

  it("preserves explicitly supplied historical collision statuses", () => {
    const factory = createDemoBuilders(context());
    expect(factory.collision({ statuses: ["booked", "completed"] }).appointments.map(a => a.status))
      .toEqual(["booked", "completed"]);
    expect(factory.collision().appointments.map(a => a.status)).toEqual(["double_booked", "double_booked"]);
  });

  it("supports typed entity and recipe overrides without changing relationship IDs", () => {
    const input = context();
    const factory = createDemoBuilders(input, { patient: { phone: "0000999" }, doctor: { specialty: "test.override" } });
    const person = factory.patient({ patient_name: "  أَمَل   تجريبية ", dob: "1998-01-02" });
    expect(person.name_normalized).toBe("امل تجريبيه");
    expect(person.patient_name).toBe("  أَمَل   تجريبية ");
    expect(person.phone).toBe("0000999");
    const doctor = factory.doctor(input.sourceClinic);
    const scheduled_at = hebronInstant("2026-10-25", "11:30");
    expect(factory.appointment(doctor, person, { scheduled_at, duration_minutes: 45 }))
      .toMatchObject({ doctor_id: doctor.doctor_id, patient_id: person.patient_id, scheduled_at, duration_minutes: 45 });
    expect(doctor.specialty).toBe("test.override");
  });

  it("rejects foreign doctors/patients, clinic mismatches and invalid setup", () => {
    const input = context();
    const factory = createDemoBuilders(input);
    const doctor = factory.doctor(input.sourceClinic);
    const person = factory.patient();
    expect(() => factory.actor(input.receivingClinic, doctor)).toThrow(/same clinic/);
    expect(() => factory.appointment({ ...doctor, clinic_id: input.receivingClinic.clinic_id }, person)).toThrow(/relationship/);
    expect(() => factory.appointment(doctor, { ...person, patient_id: 999_999 })).toThrow(/not owned/);
    expect(() => factory.doctor(context(100).sourceClinic)).toThrow(/outside/);
    expect(() => createDemoBuilders({ ...input, receivingClinic: input.sourceClinic })).toThrow(/distinct/);
    expect(() => createDemoBuilders(input, { idStart: -1 })).toThrow(/ID start/);
    expect(() => createDemoBuilders({ ...input, sourceClinic: { ...input.sourceClinic, timezone: "UTC" } })).toThrow(/Asia\/Hebron/);
    expect(() => factory.appointment(doctor, person, { duration_minutes: 0 })).toThrow(/duration/);
    expect(() => factory.appointment(doctor, person, { updated_at: new Date("2000-01-01Z") })).toThrow(/precedes/);
  });
});

describe("clinical, guardian and identity protections", () => {
  it("requires explicit isolated Full opt-in and preserves provenance and reciprocal actor links", () => {
    const input = context();
    const factory = createDemoBuilders(input);
    const blocked = factory.clinicalSafety({ note: "Synthetic unchanged source note" });
    expect(blocked.receivingClinic.network_mode).toBe("lite");
    expect(blocked.expectedLookupAvailable).toBe(false);
    expect(blocked.sourceClinic.network_mode).toBe("full");
    expect(blocked.receivingActor).toMatchObject({
      role: "doctor", clinic_id: blocked.receivingClinic.clinic_id, doctor_id: blocked.receivingDoctor.doctor_id,
    });
    expect(blocked.receivingDoctor.user_id).toBe(blocked.receivingActor.id);
    expect(blocked.alert).toMatchObject({
      patient_id: blocked.patient.patient_id, visit_id: blocked.medicationVisit.visit_id,
      source_note_excerpt: blocked.medicationVisit.diagnosis_notes,
    });
    expect(blocked.consent).toMatchObject({
      patient_id: blocked.patient.patient_id, level: "clinical", given_by: "patient",
      recorded_by_user: blocked.receptionist.id, withdrawn_at: null,
    });
    expect(blocked.receptionist.clinic_id).toBe(blocked.medicationVisit.clinic_id);
    expect(blocked.receivingVisit.clinic_id).toBe(blocked.receivingDoctor.clinic_id);
    expect(factory.clinicalSafety({ optIntoFull: true }).expectedLookupAvailable).toBe(true);
    expect(factory.clinicalSafety().receivingClinic.network_mode).toBe("lite");
    expect(factory.liteToFull().initial.network_mode).toBe("lite");
    expect(input).toEqual(context());
  });

  it("does not silently upgrade a Lite source clinic, even when the receiver opts in", () => {
    const input = context();
    input.sourceClinic.network_mode = "lite";
    const scenario = createDemoBuilders(input).clinicalSafety({ optIntoFull: true });
    expect(scenario.sourceClinic.network_mode).toBe("lite");
    expect(scenario.receivingClinic.network_mode).toBe("full");
    expect(scenario.expectedLookupAvailable).toBe(false);
    expect(input.sourceClinic.network_mode).toBe("lite");
  });

  it("keeps same-name people distinct by phone/DOB and never merges them", () => {
    const { patients, candidate } = createDemoBuilders(context()).sameName({ name: "Synthetic identical label" });
    expect(patients[0]!.patient_name).toBe(patients[1]!.patient_name);
    expect(patients[0]!.dob).not.toBe(patients[1]!.dob);
    expect(patients[0]!.phone).not.toBe(patients[1]!.phone);
    expect(patients.every(p => p.merged_into_id === null)).toBe(true);
    expect(candidate).toMatchObject({
      patient_a: patients[0]!.patient_id, patient_b: patients[1]!.patient_id,
      status: "not_a_match", score: "0",
    });
  });

  it("attributes Basic minor consent to a guardian and the actual clinic receptionist", () => {
    const factory = createDemoBuilders(context());
    const scenario = factory.minor({ dob: "2014-02-03" });
    expect(scenario.patient.is_minor).toBe(true);
    expect(scenario.consent).toMatchObject({
      patient_id: scenario.patient.patient_id, level: "basic", given_by: "guardian",
      guardian_name: "Synthetic Test Guardian", guardian_relation: "parent",
      recorded_by_user: scenario.receptionist.id,
    });
    expect(scenario.appointment.clinic_id).toBe(scenario.receptionist.clinic_id);
    expect(() => factory.consent(scenario.patient, scenario.receptionist, "clinical")).toThrow(/guardian/);
    expect(() => factory.minor({ dob: "1990-01-01" })).toThrow(/needs a minor/);
    expect(() => factory.patient({ guardian_name: "Synthetic only" })).toThrow(/paired/);
    // A stale adult snapshot cannot permit patient-attributed consent.
    const stale = factory.patient({ dob: "2010-01-01", minor_as_of: "2040-01-01" });
    expect(stale.is_minor).toBe(false);
    expect(() => factory.consent(stale, scenario.receptionist, "clinical")).toThrow(/guardian/);
  });

  it("does not upgrade onboarding until the caller explicitly chooses", () => {
    const factory = createDemoBuilders(context());
    expect(factory.liteToFull().afterChoice.network_mode).toBe("lite");
    const chosen = factory.liteToFull({ explicitUpgrade: true });
    expect(chosen.initial.network_mode).toBe("lite");
    expect(chosen.afterChoice.network_mode).toBe("full");
    expect(chosen.upgradeRequiresExplicitChoice).toBe(true);
    expect(factory.liteToFull().afterChoice.network_mode).toBe("lite");
  });
});

describe("outage and import recipes are pending inputs, never pre-applied work", () => {
  it("produces three device-scoped pending operations, two future slots and one active-slot conflict", () => {
    const input = context();
    const result = createDemoBuilders(input).outage({ lastAppointmentAt: hebronInstant("2026-10-23", "09:00") });
    expect(result.operations.map(o => o.client_op_id)).toEqual(["demo.outage.1", "demo.outage.2", "demo.outage.3"]);
    expect(result.operations.every(o => o.status === "pending" && o.resolved_by === null)).toBe(true);
    expect(result.expectedOutcomes).toEqual(["applied", "applied", "conflict"]);
    for (const op of result.operations) {
      expect(op.device_id).toBe(result.device.id);
      expect(op.clinic_id).toBe(input.receivingClinic.clinic_id);
      expect(op.clinic_id).toBe(result.device.clinic_id);
      expect(op.payload).toMatchObject({ doctor_id: result.doctor.doctor_id, duration_minutes: 30 });
    }
    const payloads = result.operations.map(o => o.payload as { scheduled_at: string; patient_id: number });
    expect(payloads.map(p => p.patient_id)).toEqual(result.patients.map(p => p.patient_id));
    expect(payloads.map(p => p.scheduled_at)).toEqual([
      hebronInstant("2026-10-30", "10:00").toISOString(),
      hebronInstant("2026-10-30", "11:00").toISOString(),
      result.existing.scheduled_at.toISOString(),
    ]);
  });

  it("surfaces incompatible working hours instead of silently modifying a clinic", () => {
    const input = context();
    input.receivingClinic.close_time = "11:00";
    expect(() => createDemoBuilders(input).outage()).toThrow(/working day/);
  });

  it("stages all 24 rows for human review; name/email suggestions never become confirmed identities", () => {
    const result = createDemoBuilders(context()).calendarImport({ sourceName: "synthetic override" });
    expect(result.rows).toHaveLength(24);
    expect(result.batch.source_name).toBe("synthetic override");
    expect(result.batch.status).toBe("review_required");
    expect(result.automaticPatientLinks).toBe(0);
    expect(new Set(result.rows.map(r => `${r.batch_id}:${r.source_event_id}`)).size).toBe(24);
    for (const row of result.rows) {
      expect(row).toMatchObject({
        batch_id: result.batch.id, review_state: "review_required",
        confirmed_patient_id: null, confirmed_doctor_id: null, chosen_action: null, appointment_id: null,
        suggested_doctor_id: result.doctor.doctor_id,
      });
      expect(row.source_payload).not.toHaveProperty("phone");
      expect(row.source_payload).not.toHaveProperty("dob");
    }
    expect(result.rows.filter(r => r.confidence === "0.5")).toHaveLength(3);
    expect(result.rows.filter(r => r.confidence === "0")).toHaveLength(21);
    expect(result.rows.filter(r => r.suggested_patient_id !== null)).toHaveLength(3);
    expect(result.rows.filter(r => result.patients.some(p =>
      p.patient_name === (r.source_payload as { patient_name: string }).patient_name))).toHaveLength(3);
    const payloads = result.rows.map(r => r.source_payload as { scheduled_at: string });
    expect(payloads[21]!.scheduled_at).toBe(payloads[22]!.scheduled_at);
    const counts = new Map<string, number>();
    payloads.forEach(p => counts.set(p.scheduled_at, (counts.get(p.scheduled_at) ?? 0) + 1));
    expect([...counts.values()].filter(count => count > 1)).toEqual([2, 2, 2]);
    result.rows[0]!.confirmed_patient_id = result.patients[0]!.patient_id;
    expect(createDemoBuilders(context()).calendarImport().rows[0]!.confirmed_patient_id).toBeNull();
  });
});

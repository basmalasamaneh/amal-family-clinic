import type {
  OperationalClinic, OperationalDoctor, OperationalUser, OperationalDevice,
  OperationalPatient, OperationalAppointment, OperationalPatientVisitHistory,
  OperationalPatientConsent, OperationalVisitAlert, OperationalSyncOperation,
  OperationalImportBatch, OperationalImportRow, OperationalPatientMergeCandidate,
} from "@workspace/db/schema";
import { addCalendarDays, dateOnly, demoZone, hebronDate, hebronInstant, isMinor, utcInstant } from "./time";

export * from "./time";

export interface ClinicContext {
  sourceClinic: OperationalClinic;
  receivingClinic: OperationalClinic;
}
type PatientOverrides = Partial<Omit<OperationalPatient, "patient_id" | "is_minor" | "merged_into_id">>;
type DoctorOverrides = Partial<Pick<OperationalDoctor, "doctor_name" | "specialty" | "email">>;
type AppointmentOverrides = Partial<Omit<OperationalAppointment,
  "appointment_id" | "clinic_id" | "doctor_id" | "patient_id" | "created_by">>;
export interface BuilderOptions {
  idStart?: number;
  instant?: string;
  asOf?: string;
  patient?: PatientOverrides;
  doctor?: DoctorOverrides;
  appointment?: AppointmentOverrides;
}

const normalize = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "")
  .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
  .replace(/ـ/g, "").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * One private ID stream per factory. No pool, script, seed data, clock, randomness,
 * environment access or global mutable state. All strings below are synthetic.
 */
export function createDemoBuilders(input: ClinicContext, initialOptions: BuilderOptions = {}) {
  const options = structuredClone(initialOptions);
  const context = structuredClone(input);
  const clinics = [context.sourceClinic, context.receivingClinic];
  if (clinics[0]!.clinic_id === clinics[1]!.clinic_id) throw new Error("Two distinct clinics are required");
  for (const clinic of clinics) {
    if (!Number.isSafeInteger(clinic.clinic_id) || clinic.clinic_id <= 0) throw new Error("Invalid clinic ID");
    if (clinic.timezone !== demoZone) throw new Error("Demo recipes require Asia/Hebron clinics");
  }
  const fixed = utcInstant(options.instant ?? "2026-09-08T05:00:00Z");
  const asOf = dateOnly(options.asOf ?? hebronDate(fixed));
  let next = options.idStart ?? Math.max(...clinics.map(c => c.clinic_id)) + 1_000;
  if (!Number.isSafeInteger(next) || next <= 0) throw new Error("Invalid ID start");
  const allocated = new Set(clinics.map(c => c.clinic_id));
  const id = () => {
    while (allocated.has(next)) next++;
    if (!Number.isSafeInteger(next)) throw new Error("ID range exhausted");
    allocated.add(next);
    return next++;
  };
  const stamp = () => new Date(fixed);
  const clinicFor = (clinic: OperationalClinic) => {
    const found = clinics.find(c => c.clinic_id === clinic.clinic_id);
    if (!found) throw new Error("Clinic is outside the provided context");
    return found;
  };
  const doctors = new Map<number, OperationalDoctor>();
  const patients = new Map<number, OperationalPatient>();
  const users = new Map<number, OperationalUser>();
  const requireDoctor = (doctor: OperationalDoctor) => {
    if (doctors.get(doctor.doctor_id)?.clinic_id !== doctor.clinic_id) throw new Error("Doctor/clinic relationship is not owned by this builder");
    return clinicFor({ ...context.sourceClinic, clinic_id: doctor.clinic_id });
  };
  const requirePatient = (patient: OperationalPatient) => {
    if (!patients.has(patient.patient_id)) throw new Error("Patient is not owned by this builder");
  };

  function patient(overrides: PatientOverrides = {}): OperationalPatient {
    const patient_id = id();
    const values = { ...options.patient, ...overrides };
    const dob = dateOnly(values.dob ?? "1990-03-15");
    const minor_as_of = dateOnly(values.minor_as_of ?? asOf);
    const patient_name = values.patient_name ?? `Synthetic patient ${patient_id}`;
    if ((values.guardian_name == null) !== (values.guardian_relation == null)) throw new Error("Guardian details must be paired");
    const row: OperationalPatient = {
      patient_name, phone: `000${patient_id}`, dob, minor_as_of,
      name_normalized: normalize(patient_name), guardian_name: null, guardian_relation: null,
      ...values, patient_id, is_minor: isMinor(dob, minor_as_of), merged_into_id: null,
    };
    patients.set(patient_id, structuredClone(row));
    return row;
  }
  function doctor(clinic: OperationalClinic, overrides: DoctorOverrides = {}): OperationalDoctor {
    clinicFor(clinic);
    const doctor_id = id();
    const row: OperationalDoctor = {
      doctor_name: `Synthetic doctor ${doctor_id}`,
      specialty: "test.specialty", email: `doctor.${doctor_id}@synthetic.example`,
      ...options.doctor, ...overrides, doctor_id, clinic_id: clinic.clinic_id, user_id: null,
    };
    doctors.set(doctor_id, structuredClone(row));
    return row;
  }
  function actor(clinic: OperationalClinic, assignedDoctor?: OperationalDoctor): OperationalUser {
    clinicFor(clinic);
    if (assignedDoctor && requireDoctor(assignedDoctor).clinic_id !== clinic.clinic_id) {
      throw new Error("Actor and doctor must belong to the same clinic");
    }
    const userId = id();
    const row: OperationalUser = {
      id: userId, fixture_key: `test.user.${userId}`, email: `user.${userId}@synthetic.example`,
      // Deliberately unusable as a real password/PIN hash. Never authenticates.
      password_hash: "!synthetic-test-only", pin_hash: assignedDoctor ? null : "!synthetic-test-only",
      role: assignedDoctor ? "doctor" : "receptionist", clinic_id: clinic.clinic_id,
      doctor_id: assignedDoctor?.doctor_id ?? null, locale: "ar", theme: "light", last_login: null,
    };
    if (assignedDoctor) {
      if (assignedDoctor.user_id !== null) throw new Error("Doctor already has an actor");
      assignedDoctor.user_id = userId;
      doctors.set(assignedDoctor.doctor_id, structuredClone(assignedDoctor));
    }
    users.set(userId, structuredClone(row));
    return row;
  }
  function appointment(assignedDoctor: OperationalDoctor, assignedPatient: OperationalPatient,
    overrides: AppointmentOverrides = {}): OperationalAppointment {
    requireDoctor(assignedDoctor);
    requirePatient(assignedPatient);
    const row: OperationalAppointment = {
      scheduled_at: hebronInstant(asOf), booking_method: "amal_network", status: "booked",
      duration_minutes: 30, source_ref: null, client_op_id: null, conflict_state: "none",
      created_at: stamp(), updated_at: stamp(), cancel_reason: null, version: 1,
      ...structuredClone(options.appointment), ...structuredClone(overrides),
      appointment_id: id(), clinic_id: assignedDoctor.clinic_id, doctor_id: assignedDoctor.doctor_id,
      patient_id: assignedPatient.patient_id, created_by: null,
    };
    row.scheduled_at = utcInstant(row.scheduled_at);
    row.created_at = utcInstant(row.created_at);
    row.updated_at = utcInstant(row.updated_at);
    if (!Number.isInteger(row.duration_minutes) || row.duration_minutes < 1 || row.duration_minutes > 1440) throw new Error("Invalid appointment duration");
    if (row.updated_at < row.created_at) throw new Error("Appointment update precedes creation");
    if (!["booked", "completed", "double_booked", "no_show", "cancelled"].includes(row.status)) throw new Error("Invalid appointment status");
    return row;
  }
  function consent(assignedPatient: OperationalPatient, recorder: OperationalUser,
    level: OperationalPatientConsent["level"], guardian = false): OperationalPatientConsent {
    requirePatient(assignedPatient);
    if (recorder.role !== "receptionist" || users.get(recorder.id)?.role !== "receptionist"
      || users.get(recorder.id)?.clinic_id !== recorder.clinic_id
      || !clinics.some(c => c.clinic_id === recorder.clinic_id)) {
      throw new Error("Consent requires a recording receptionist in context");
    }
    if (!guardian && isMinor(assignedPatient.dob, hebronDate(fixed))) throw new Error("A minor requires guardian attribution");
    const consentId = id();
    return {
      id: consentId, fixture_key: `test.consent.${consentId}`, patient_id: assignedPatient.patient_id,
      level, given_by: guardian ? "guardian" : "patient",
      guardian_name: guardian ? "Synthetic Test Guardian" : null,
      guardian_relation: guardian ? "parent" : null, given_at: stamp(), withdrawn_at: null,
      recorded_by_user: recorder.id,
    };
  }

  function collision(overrides: { scheduledAt?: Date; statuses?: [string, string] } = {}) {
    const assignedDoctor = doctor(context.sourceClinic);
    const people = [patient(), patient()];
    const scheduled_at = overrides.scheduledAt ?? hebronInstant(addCalendarDays(asOf, 1), "11:00");
    const appointments = people.map((p, i) => appointment(assignedDoctor, p, {
      scheduled_at, status: overrides.statuses?.[i] ?? "double_booked", conflict_state: "flagged",
    }));
    return { doctor: assignedDoctor, patients: people, appointments };
  }
  function crossClinic(overrides: { scheduledAt?: Date; patient?: PatientOverrides } = {}) {
    const person = patient(overrides.patient);
    const assignedDoctors = clinics.map(c => doctor(c));
    const scheduled_at = overrides.scheduledAt ?? hebronInstant(addCalendarDays(asOf, 1), "10:45");
    return {
      patient: person, doctors: assignedDoctors,
      appointments: assignedDoctors.map(d => appointment(d, person, { scheduled_at })),
    };
  }
  function clinicalSafety(overrides: { optIntoFull?: boolean; patient?: PatientOverrides; note?: string } = {}) {
    const source = structuredClone(context.sourceClinic);
    const receiver = { ...structuredClone(context.receivingClinic), network_mode: overrides.optIntoFull ? "full" as const : "lite" as const };
    const person = patient(overrides.patient);
    const sourceDoctor = doctor(source);
    const receivingDoctor = doctor(receiver);
    const receptionist = actor(source);
    const receivingActor = actor(receiver, receivingDoctor);
    const medicationVisit: OperationalPatientVisitHistory = {
      visit_id: id(), patient_id: person.patient_id, clinic_id: source.clinic_id,
      doctor_id: sourceDoctor.doctor_id, visit_date: asOf,
      diagnosis_notes: overrides.note ?? "Synthetic medication provenance; not medical advice.",
    };
    const receivingVisit: OperationalPatientVisitHistory = {
      visit_id: id(), patient_id: person.patient_id, clinic_id: receiver.clinic_id,
      doctor_id: receivingDoctor.doctor_id, visit_date: addCalendarDays(asOf, 1),
      diagnosis_notes: "Synthetic dizziness encounter; not medical advice.",
    };
    const alert: OperationalVisitAlert = {
      id: id(), fixture_key: "test.clinical.medication", visit_id: medicationVisit.visit_id,
      patient_id: person.patient_id, kind: "medication", label: "demo.alerts.bloodPressureMedication",
      source_note_excerpt: medicationVisit.diagnosis_notes,
    };
    return {
      sourceClinic: source, receivingClinic: receiver, patient: person, sourceDoctor, receivingDoctor,
      receptionist, receivingActor, medicationVisit, receivingVisit, alert,
      consent: consent(person, receptionist, "clinical"),
      prerequisites: { bothClinicsFull: true, activeClinicalConsent: true, role: "doctor" as const },
      // A scenario expectation, not an implementation of production authorization.
      expectedLookupAvailable: source.network_mode === "full" && receiver.network_mode === "full",
    };
  }
  function outage(overrides: { lastAppointmentAt?: Date } = {}) {
    const clinic = structuredClone(context.receivingClinic);
    const assignedDoctor = doctor(clinic);
    const people = [patient(), patient(), patient()];
    const existing = appointment(assignedDoctor, people[2]!, {
      scheduled_at: overrides.lastAppointmentAt ?? hebronInstant(asOf, "09:00"),
      status: "booked",
    });
    const futureDate = addCalendarDays(hebronDate(existing.scheduled_at), 7);
    const device: OperationalDevice = {
      id: id(), fixture_key: "test.outage.device", clinic_id: clinic.clinic_id,
      label: "demo.devices.reception", registered_at: stamp(),
    };
    const futureStarts = ["10:00", "11:00"].map(t => hebronInstant(futureDate, t));
    const weekday = new Date(`${futureDate}T12:00:00Z`).getUTCDay();
    if (!clinic.working_days.includes(weekday) || clinic.open_time > "10:00" || clinic.close_time < "11:30") {
      throw new Error("Outage needs a working day with local hours 10:00-11:30");
    }
    const operations: OperationalSyncOperation[] = people.map((p, i) => ({
      id: id(), fixture_key: `test.outage.${i + 1}`, clinic_id: clinic.clinic_id, device_id: device.id,
      client_op_id: `demo.outage.${i + 1}`, type: "appointment.create",
      payload: {
        doctor_id: assignedDoctor.doctor_id, patient_id: p.patient_id,
        scheduled_at: (futureStarts[i] ?? existing.scheduled_at).toISOString(),
        duration_minutes: 30, booking_method: "amal_network",
      },
      status: "pending", received_at: stamp(), resolved_by: null,
    }));
    return { clinic, doctor: assignedDoctor, patients: people, device, existing, operations,
      expectedOutcomes: ["applied", "applied", "conflict"] as const };
  }
  function calendarImport(overrides: { sourceName?: string } = {}) {
    const assignedDoctor = doctor(context.sourceClinic);
    const people = [patient(), patient(), patient()];
    const batch: OperationalImportBatch = {
      id: id(), fixture_key: "test.calendar.batch", clinic_id: context.sourceClinic.clinic_id,
      source_name: overrides.sourceName ?? "synthetic_calendar_export",
      source_checksum: "synthetic-in-memory-not-a-workbook-checksum", status: "review_required", created_at: stamp(),
    };
    const rows: OperationalImportRow[] = Array.from({ length: 24 }, (_, i) => {
      const slot = i === 2 ? 1 : i === 8 ? 7 : i === 22 ? 21 : i;
      const localDate = addCalendarDays(asOf, Math.floor(slot / 4));
      const time = `${String(8 + slot % 4).padStart(2, "0")}:00`;
      return {
      id: id(), batch_id: batch.id, source_event_id: i + 1,
      source_payload: {
        event_id: i + 1, patient_name: i < 3 ? people[i]!.patient_name : `Synthetic unmatched export person ${i + 1}`,
        doctor_email: assignedDoctor.email,
        // Three synthetic collision pairs; events 22/23 share local 09:00.
        scheduled_at: hebronInstant(localDate, time).toISOString(),
      },
      review_state: "review_required", suggested_patient_id: i < 3 ? people[i]!.patient_id : null,
      confirmed_patient_id: null, suggested_doctor_id: assignedDoctor.doctor_id,
      confirmed_doctor_id: null, confidence: i < 3 ? "0.5" : "0",
      chosen_action: null, appointment_id: null,
      };
    });
    return { batch, rows, doctor: assignedDoctor, patients: people, automaticPatientLinks: 0 as const };
  }
  function sameName(overrides: { name?: string } = {}) {
    const name = overrides.name ?? "Synthetic Shared Name";
    const a = patient({ patient_name: name, dob: "1990-01-01", phone: "000000001" });
    const b = patient({ patient_name: name, dob: "1992-02-02", phone: "000000002" });
    const candidate: OperationalPatientMergeCandidate = {
      id: id(), fixture_key: "test.distinctSameName", patient_a: a.patient_id, patient_b: b.patient_id,
      score: "0", status: "not_a_match", reason: "demo.duplicates.differentDobAndPhone",
    };
    return { patients: [a, b], candidate };
  }
  function minor(overrides: { dob?: string } = {}) {
    const dob = overrides.dob ?? `${Number(asOf.slice(0, 4)) - 12}-01-01`;
    const person = patient({ dob });
    if (!isMinor(dob, hebronDate(fixed))) throw new Error("Minor scenario needs a minor at consent time");
    const assignedDoctor = doctor(context.sourceClinic);
    const receptionist = actor(context.sourceClinic);
    return {
      patient: person, doctor: assignedDoctor, receptionist,
      appointment: appointment(assignedDoctor, person),
      consent: consent(person, receptionist, "basic", true),
    };
  }
  function liteToFull(overrides: { explicitUpgrade?: boolean } = {}) {
    const initial: OperationalClinic = { ...structuredClone(context.receivingClinic), network_mode: "lite" };
    return {
      initial, afterChoice: { ...structuredClone(initial), network_mode: overrides.explicitUpgrade ? "full" as const : "lite" as const },
      upgradeRequiresExplicitChoice: true as const,
    };
  }
  return { patient, doctor, actor, appointment, consent, collision, crossClinic,
    clinicalSafety, outage, calendarImport, sameName, minor, liteToFull };
}

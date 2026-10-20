import { sql } from "drizzle-orm";
import { integer, text, date, jsonb, check, unique, foreignKey, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  operational, identity, instant, fixtureKey, nonblank,
  operationalClinics, operationalDoctors, operationalPatients, operationalUsers,
} from "./operational-core";

export const conflictState = operational.enum("conflict_state", ["none", "flagged", "resolved"]);
export const consentLevel = operational.enum("consent_level", ["none", "basic", "clinical"]);
export const consentGivenBy = operational.enum("consent_given_by", ["patient", "guardian"]);
export const alertKind = operational.enum("alert_kind", ["medication", "allergy", "condition"]);

export const operationalAppointments = operational.table("appointments", {
  appointment_id: identity("appointment_id"),
  clinic_id: integer("clinic_id").notNull().references(() => operationalClinics.clinic_id),
  doctor_id: integer("doctor_id").notNull().references(() => operationalDoctors.doctor_id),
  patient_id: integer("patient_id").notNull().references(() => operationalPatients.patient_id),
  scheduled_at: instant("scheduled_at").notNull(),
  booking_method: text("booking_method").notNull(),
  status: text("status").notNull(),
  duration_minutes: integer("duration_minutes").notNull().default(30),
  source_ref: text("source_ref").unique(),
  client_op_id: text("client_op_id").unique(),
  conflict_state: conflictState("conflict_state").notNull().default("none"),
  created_by: integer("created_by").references(() => operationalUsers.id),
  created_at: instant("created_at").notNull().defaultNow(),
  updated_at: instant("updated_at").notNull().defaultNow(),
  cancel_reason: text("cancel_reason"),
  version: integer("version").notNull().default(1),
}, (t) => [
  unique("appointments_id_patient_clinic_unique").on(t.appointment_id, t.patient_id, t.clinic_id),
  foreignKey({ name: "appointments_doctor_clinic_fk", columns: [t.doctor_id, t.clinic_id], foreignColumns: [operationalDoctors.doctor_id, operationalDoctors.clinic_id] }),
  check("appointments_duration_check", sql`${t.duration_minutes} BETWEEN 1 AND 1440`),
  check("appointments_status_check", sql`${t.status} IN ('booked','completed','double_booked','no_show','cancelled')`),
  check("appointments_times_check", sql`${t.updated_at} >= ${t.created_at}`),
  check("appointments_refs_check", sql`(${t.source_ref} IS NULL OR length(btrim(${t.source_ref})) > 0) AND (${t.client_op_id} IS NULL OR length(btrim(${t.client_op_id})) > 0)`),
  index("appointments_doctor_time_idx").on(t.doctor_id, t.scheduled_at),
  index("appointments_patient_time_idx").on(t.patient_id, t.scheduled_at),
]);

export const operationalPatientVisitHistory = operational.table("patient_visit_history", {
  visit_id: identity("visit_id"),
  patient_id: integer("patient_id").notNull().references(() => operationalPatients.patient_id),
  clinic_id: integer("clinic_id").notNull().references(() => operationalClinics.clinic_id),
  doctor_id: integer("doctor_id").notNull().references(() => operationalDoctors.doctor_id),
  visit_date: date("visit_date").notNull(),
  diagnosis_notes: text("diagnosis_notes").notNull(),
}, (t) => [
  unique("visits_id_patient_unique").on(t.visit_id, t.patient_id),
  foreignKey({ name: "visits_doctor_clinic_fk", columns: [t.doctor_id, t.clinic_id], foreignColumns: [operationalDoctors.doctor_id, operationalDoctors.clinic_id] }),
  index("visits_patient_date_idx").on(t.patient_id, t.visit_date),
]);

export const operationalPatientConsents = operational.table("patient_consents", {
  id: identity(),
  fixture_key: fixtureKey(),
  patient_id: integer("patient_id").notNull().references(() => operationalPatients.patient_id),
  level: consentLevel("level").notNull(),
  given_by: consentGivenBy("given_by").notNull(),
  guardian_name: text("guardian_name"),
  guardian_relation: text("guardian_relation"),
  given_at: instant("given_at").notNull().defaultNow(),
  withdrawn_at: instant("withdrawn_at"),
  recorded_by_user: integer("recorded_by_user").notNull().references(() => operationalUsers.id),
}, (t) => [
  check("consents_guardian_check", sql`(${t.given_by} = 'guardian' AND ${t.guardian_name} IS NOT NULL AND ${t.guardian_relation} IS NOT NULL AND length(btrim(${t.guardian_name})) > 0 AND length(btrim(${t.guardian_relation})) > 0) OR (${t.given_by} = 'patient' AND ${t.guardian_name} IS NULL AND ${t.guardian_relation} IS NULL)`),
  check("consents_times_check", sql`${t.withdrawn_at} IS NULL OR ${t.withdrawn_at} >= ${t.given_at}`),
  index("consents_patient_given_idx").on(t.patient_id, t.given_at),
]);

export const operationalVisitAlerts = operational.table("visit_alerts", {
  id: identity(),
  fixture_key: fixtureKey(),
  visit_id: integer("visit_id").notNull(),
  patient_id: integer("patient_id").notNull().references(() => operationalPatients.patient_id),
  kind: alertKind("kind").notNull(),
  label: text("label").notNull(),
  source_note_excerpt: text("source_note_excerpt").notNull(),
}, (t) => [
  foreignKey({ name: "alerts_visit_patient_fk", columns: [t.visit_id, t.patient_id], foreignColumns: [operationalPatientVisitHistory.visit_id, operationalPatientVisitHistory.patient_id] }),
  check("alerts_label_check", sql`${t.label} ~ '^[a-z][A-Za-z0-9_.-]*$'`),
  check("alerts_excerpt_check", sql`length(${t.source_note_excerpt}) > 0`),
]);

export const operationalAuditLog = operational.table("audit_log", {
  id: identity(),
  fixture_key: fixtureKey(),
  user_id: integer("user_id").references(() => operationalUsers.id),
  clinic_id: integer("clinic_id").references(() => operationalClinics.clinic_id),
  action: text("action").notNull(),
  patient_id: integer("patient_id").references(() => operationalPatients.patient_id),
  detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
  at: instant("at").notNull().defaultNow(),
}, (t) => [
  check("audit_action_check", sql`length(btrim(${t.action})) > 0`),
  check("audit_detail_check", sql`jsonb_typeof(${t.detail}) = 'object'`),
  index("audit_patient_at_idx").on(t.patient_id, t.at),
]);

export const insertOperationalAppointmentSchema = createInsertSchema(operationalAppointments, {
  duration_minutes: z.number().int().min(1).max(1440),
  status: z.enum(["booked", "completed", "double_booked", "no_show", "cancelled"]),
  booking_method: nonblank, source_ref: nonblank.nullable(), client_op_id: nonblank.nullable(),
}).refine(v => !v.created_at || !v.updated_at || v.updated_at >= v.created_at, { message: "updated_at must not precede created_at", path: ["updated_at"] });
export const insertOperationalPatientVisitHistorySchema = createInsertSchema(operationalPatientVisitHistory);
export const insertOperationalPatientConsentSchema = createInsertSchema(operationalPatientConsents, {
  guardian_name: nonblank.nullable(), guardian_relation: nonblank.nullable(),
}).refine(v => v.given_by === "guardian" ? v.guardian_name != null && v.guardian_relation != null : v.guardian_name == null && v.guardian_relation == null, { message: "Guardian consent requires guardian details; patient consent must omit them", path: ["guardian_name"] })
  .refine(v => !v.given_at || !v.withdrawn_at || v.withdrawn_at >= v.given_at, { message: "Withdrawal must follow consent", path: ["withdrawn_at"] });
export const insertOperationalVisitAlertSchema = createInsertSchema(operationalVisitAlerts, { label: z.string().regex(/^[a-z][A-Za-z0-9_.-]*$/), source_note_excerpt: z.string().min(1) });
export const insertOperationalAuditLogSchema = createInsertSchema(operationalAuditLog, { action: nonblank, detail: z.record(z.string(), z.json()) });

export type OperationalAppointment = typeof operationalAppointments.$inferSelect;
export type OperationalPatientVisitHistory = typeof operationalPatientVisitHistory.$inferSelect;
export type OperationalPatientConsent = typeof operationalPatientConsents.$inferSelect;
export type OperationalVisitAlert = typeof operationalVisitAlerts.$inferSelect;
export type OperationalAuditLog = typeof operationalAuditLog.$inferSelect;
export type InsertOperationalAppointment = z.infer<typeof insertOperationalAppointmentSchema>;
export type InsertOperationalPatientVisitHistory = z.infer<typeof insertOperationalPatientVisitHistorySchema>;
export type InsertOperationalPatientConsent = z.infer<typeof insertOperationalPatientConsentSchema>;
export type InsertOperationalVisitAlert = z.infer<typeof insertOperationalVisitAlertSchema>;
export type InsertOperationalAuditLog = z.infer<typeof insertOperationalAuditLogSchema>;

import { sql } from "drizzle-orm";
import { integer, text, jsonb, numeric, date, check, unique, foreignKey, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  operational, identity, instant, fixtureKey, nonblank,
  operationalClinics, operationalDoctors, operationalPatients, operationalUsers, operationalDevices,
} from "./operational-core";
import { operationalAppointments } from "./operational-clinical";

export const syncStatus = operational.enum("sync_status", ["pending", "applied", "conflict", "rejected"]);
export const importBatchStatus = operational.enum("import_batch_status", ["review_required", "reviewed", "committed"]);
export const importReviewState = operational.enum("import_review_state", ["review_required", "confirmed", "rejected"]);
export const importChosenAction = operational.enum("import_chosen_action", ["create", "link", "skip"]);
export const mergeStatus = operational.enum("merge_status", ["review_required", "not_a_match", "confirmed"]);
export const notificationStatus = operational.enum("notification_status", ["pending", "simulated", "cancelled"]);
const translationKey = z.string().regex(/^[a-z][A-Za-z0-9_.-]*$/);
// PostgreSQL numeric is intentionally represented as a string, avoiding precision loss.
const finiteNumeric = z.string().regex(/^-?(?:\d+(?:\.\d*)?|\.\d+)$/);
const probability = finiteNumeric.refine(v => Number(v) >= 0 && Number(v) <= 1, "Must be between 0 and 1");

export const operationalSyncOperations = operational.table("sync_operations", {
  id: identity(),
  fixture_key: fixtureKey(),
  clinic_id: integer("clinic_id").notNull().references(() => operationalClinics.clinic_id),
  device_id: integer("device_id").notNull().references(() => operationalDevices.id),
  client_op_id: text("client_op_id").notNull().unique(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  status: syncStatus("status").notNull().default("pending"),
  received_at: instant("received_at").notNull().defaultNow(),
  resolved_by: integer("resolved_by").references(() => operationalUsers.id),
}, (t) => [
  foreignKey({ name: "sync_device_clinic_fk", columns: [t.device_id, t.clinic_id], foreignColumns: [operationalDevices.id, operationalDevices.clinic_id] }),
  check("sync_text_check", sql`length(btrim(${t.client_op_id})) > 0 AND length(btrim(${t.type})) > 0`),
  check("sync_payload_check", sql`jsonb_typeof(${t.payload}) = 'object'`),
]);

export const operationalImportBatches = operational.table("import_batches", {
  id: identity(),
  fixture_key: fixtureKey(),
  clinic_id: integer("clinic_id").notNull().references(() => operationalClinics.clinic_id),
  source_name: text("source_name").notNull(),
  source_checksum: text("source_checksum").notNull(),
  status: importBatchStatus("status").notNull().default("review_required"),
  created_at: instant("created_at").notNull().defaultNow(),
}, (t) => [
  check("import_batches_source_check", sql`length(btrim(${t.source_name})) > 0 AND length(btrim(${t.source_checksum})) > 0`),
]);

export const operationalImportRows = operational.table("import_rows", {
  id: identity(),
  batch_id: integer("batch_id").notNull().references(() => operationalImportBatches.id),
  source_event_id: integer("source_event_id").notNull(),
  source_payload: jsonb("source_payload").notNull(),
  review_state: importReviewState("review_state").notNull().default("review_required"),
  suggested_patient_id: integer("suggested_patient_id").references(() => operationalPatients.patient_id),
  confirmed_patient_id: integer("confirmed_patient_id").references(() => operationalPatients.patient_id),
  suggested_doctor_id: integer("suggested_doctor_id").references(() => operationalDoctors.doctor_id),
  confirmed_doctor_id: integer("confirmed_doctor_id").references(() => operationalDoctors.doctor_id),
  confidence: numeric("confidence").notNull().default("0"),
  chosen_action: importChosenAction("chosen_action"),
  appointment_id: integer("appointment_id").references(() => operationalAppointments.appointment_id),
}, (t) => [
  unique("import_rows_batch_event_unique").on(t.batch_id, t.source_event_id),
  check("import_rows_confidence_check", sql`${t.confidence} BETWEEN 0 AND 1`),
  check("import_rows_payload_check", sql`jsonb_typeof(${t.source_payload}) = 'object'`),
  check("import_rows_review_check", sql`(${t.review_state} <> 'review_required' OR (${t.confirmed_patient_id} IS NULL AND ${t.confirmed_doctor_id} IS NULL AND ${t.chosen_action} IS NULL AND ${t.appointment_id} IS NULL)) AND (${t.review_state} <> 'rejected' OR (${t.appointment_id} IS NULL AND (${t.chosen_action} IS NULL OR ${t.chosen_action} = 'skip'))) AND (${t.review_state} <> 'confirmed' OR ${t.chosen_action} IS NOT NULL)`),
  check("import_rows_action_check", sql`(${t.chosen_action} IS DISTINCT FROM 'link' OR (${t.confirmed_patient_id} IS NOT NULL AND ${t.confirmed_doctor_id} IS NOT NULL)) AND (${t.chosen_action} IS DISTINCT FROM 'skip' OR ${t.appointment_id} IS NULL) AND (${t.appointment_id} IS NULL OR (${t.review_state} = 'confirmed' AND ${t.chosen_action} IN ('create','link') AND ${t.confirmed_patient_id} IS NOT NULL AND ${t.confirmed_doctor_id} IS NOT NULL))`),
]);

export const operationalPatientMergeCandidates = operational.table("patient_merge_candidates", {
  id: identity(),
  fixture_key: fixtureKey(),
  patient_a: integer("patient_a").notNull().references(() => operationalPatients.patient_id),
  patient_b: integer("patient_b").notNull().references(() => operationalPatients.patient_id),
  score: numeric("score").notNull(),
  reason: text("reason").notNull(),
  status: mergeStatus("status").notNull().default("review_required"),
}, (t) => [
  unique("merge_pair_unique").on(t.patient_a, t.patient_b),
  check("merge_pair_order_check", sql`${t.patient_a} < ${t.patient_b}`),
  check("merge_score_check", sql`${t.score} BETWEEN 0 AND 1`),
  check("merge_reason_check", sql`${t.reason} ~ '^[a-z][A-Za-z0-9_.-]*$'`),
]);

export const operationalNotifications = operational.table("notifications", {
  id: identity(),
  fixture_key: fixtureKey(),
  clinic_id: integer("clinic_id").notNull().references(() => operationalClinics.clinic_id),
  patient_id: integer("patient_id").notNull().references(() => operationalPatients.patient_id),
  appointment_id: integer("appointment_id").references(() => operationalAppointments.appointment_id),
  message_key: text("message_key").notNull(),
  status: notificationStatus("status").notNull().default("pending"),
  scheduled_at: instant("scheduled_at").notNull(),
}, (t) => [
  foreignKey({ name: "notifications_appointment_patient_clinic_fk", columns: [t.appointment_id, t.patient_id, t.clinic_id], foreignColumns: [operationalAppointments.appointment_id, operationalAppointments.patient_id, operationalAppointments.clinic_id] }),
  check("notifications_message_check", sql`${t.message_key} ~ '^[a-z][A-Za-z0-9_.-]*$'`),
]);

export const operationalKpiSnapshots = operational.table("kpi_snapshots", {
  id: identity(),
  fixture_key: fixtureKey(),
  date: date("date").notNull(),
  metric: text("metric").notNull(),
  clinic_id: integer("clinic_id").references(() => operationalClinics.clinic_id),
  value: numeric("value").notNull(),
}, (t) => [
  uniqueIndex("kpi_clinic_date_metric_unique").on(t.date, t.metric, t.clinic_id).where(sql`${t.clinic_id} IS NOT NULL`),
  uniqueIndex("kpi_network_date_metric_unique").on(t.date, t.metric).where(sql`${t.clinic_id} IS NULL`),
  check("kpi_metric_check", sql`length(btrim(${t.metric})) > 0`),
  check("kpi_value_check", sql`${t.value} NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)`),
]);

export const insertOperationalSyncOperationSchema = createInsertSchema(operationalSyncOperations, { client_op_id: nonblank, type: nonblank, payload: z.record(z.string(), z.json()) });
export const insertOperationalImportBatchSchema = createInsertSchema(operationalImportBatches, { source_name: nonblank, source_checksum: nonblank });
export const insertOperationalImportRowSchema = createInsertSchema(operationalImportRows, { confidence: probability, source_payload: z.record(z.string(), z.json()) })
  .superRefine((v, ctx) => {
    const state = v.review_state ?? "review_required";
    if (state === "review_required" && (v.confirmed_patient_id != null || v.confirmed_doctor_id != null || v.chosen_action != null || v.appointment_id != null)) ctx.addIssue({ code: "custom", message: "Unreviewed rows cannot carry confirmed identities, actions or appointments", path: ["review_state"] });
    if (state === "confirmed" && v.chosen_action == null) ctx.addIssue({ code: "custom", message: "Confirmed review requires an explicit action", path: ["chosen_action"] });
    if (state === "rejected" && (v.appointment_id != null || (v.chosen_action != null && v.chosen_action !== "skip"))) ctx.addIssue({ code: "custom", message: "Rejected rows cannot create or link appointments", path: ["chosen_action"] });
    if (v.chosen_action === "link" && (v.confirmed_patient_id == null || v.confirmed_doctor_id == null)) ctx.addIssue({ code: "custom", message: "Link requires confirmed patient and doctor", path: ["confirmed_patient_id"] });
    if (v.appointment_id != null && (state !== "confirmed" || !["create", "link"].includes(v.chosen_action ?? "") || v.confirmed_patient_id == null || v.confirmed_doctor_id == null)) ctx.addIssue({ code: "custom", message: "Appointment requires confirmed create/link and identities", path: ["appointment_id"] });
  });
export const insertOperationalPatientMergeCandidateSchema = createInsertSchema(operationalPatientMergeCandidates, { score: probability, reason: translationKey })
  .refine(v => v.patient_a < v.patient_b, { message: "Store each pair once, with patient_a < patient_b", path: ["patient_b"] });
export const insertOperationalNotificationSchema = createInsertSchema(operationalNotifications, { message_key: translationKey });
export const insertOperationalKpiSnapshotSchema = createInsertSchema(operationalKpiSnapshots, { metric: nonblank, value: finiteNumeric });

export type OperationalSyncOperation = typeof operationalSyncOperations.$inferSelect;
export type OperationalImportBatch = typeof operationalImportBatches.$inferSelect;
export type OperationalImportRow = typeof operationalImportRows.$inferSelect;
export type OperationalPatientMergeCandidate = typeof operationalPatientMergeCandidates.$inferSelect;
export type OperationalNotification = typeof operationalNotifications.$inferSelect;
export type OperationalKpiSnapshot = typeof operationalKpiSnapshots.$inferSelect;
export type InsertOperationalSyncOperation = z.infer<typeof insertOperationalSyncOperationSchema>;
export type InsertOperationalImportBatch = z.infer<typeof insertOperationalImportBatchSchema>;
export type InsertOperationalImportRow = z.infer<typeof insertOperationalImportRowSchema>;
export type InsertOperationalPatientMergeCandidate = z.infer<typeof insertOperationalPatientMergeCandidateSchema>;
export type InsertOperationalNotification = z.infer<typeof insertOperationalNotificationSchema>;
export type InsertOperationalKpiSnapshot = z.infer<typeof insertOperationalKpiSnapshotSchema>;

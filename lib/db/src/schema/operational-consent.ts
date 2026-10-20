import { sql } from "drizzle-orm";
import { foreignKey, integer, jsonb, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  instant, operational, operationalClinics, operationalDoctors, operationalPatients, operationalUsers,
} from "./operational-core";

/** Trusted, independently verified relationships; application runtime has SELECT only. */
export const patientDoctorAccess = operational.table("patient_doctor_access", {
  patient_id: integer("patient_id").notNull().references(() => operationalPatients.patient_id, { onDelete: "cascade" }),
  clinic_id: integer("clinic_id").notNull().references(() => operationalClinics.clinic_id),
  doctor_id: integer("doctor_id").notNull(),
}, t => [
  primaryKey({ columns: [t.patient_id, t.clinic_id, t.doctor_id] }),
  foreignKey({
    columns: [t.doctor_id, t.clinic_id],
    foreignColumns: [operationalDoctors.doctor_id, operationalDoctors.clinic_id],
  }).onDelete("cascade"),
]);

export const consentOperations = operational.table("consent_operations", {
  clinic_id: integer("clinic_id").notNull().references(() => operationalClinics.clinic_id, { onDelete: "cascade" }),
  client_op_id: uuid("client_op_id").notNull(),
  actor_id: integer("actor_id").notNull().references(() => operationalUsers.id, { onDelete: "cascade" }),
  request_hash: text("request_hash").notNull(),
  result: jsonb("result").notNull(),
  created_at: instant("created_at").notNull().default(sql`clock_timestamp()`),
}, t => [primaryKey({ columns: [t.clinic_id, t.client_op_id] })]);

export const insertPatientDoctorAccessSchema = createInsertSchema(patientDoctorAccess);
export const insertConsentOperationSchema = createInsertSchema(consentOperations);
export type PatientDoctorAccess = typeof patientDoctorAccess.$inferSelect;
export type ConsentOperation = typeof consentOperations.$inferSelect;
export type InsertPatientDoctorAccess = z.infer<typeof insertPatientDoctorAccessSchema>;
export type InsertConsentOperation = z.infer<typeof insertConsentOperationSchema>;

import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, text, uuid } from "drizzle-orm/pg-core";
import { operational, operationalUsers, operationalClinics, operationalDoctors, operationalPatients, instant } from "./operational-core";
import { operationalAppointments } from "./operational-clinical";

/** Successful operation outcomes only; inserted in the appointment transaction. */
export const appointmentOperations = operational.table("appointment_operations", {
  client_op_id: uuid("client_op_id").primaryKey(),
  actor_id: integer("actor_id").notNull().references(() => operationalUsers.id),
  clinic_id: integer("clinic_id").notNull().references(() => operationalClinics.clinic_id),
  doctor_id: integer("doctor_id").notNull().references(() => operationalDoctors.doctor_id),
  payload_hash: text("payload_hash").notNull(),
  result: jsonb("result").notNull(),
  created_at: instant("created_at").notNull().default(sql`clock_timestamp()`),
});

export const appointmentHolds = operational.table("appointment_holds", {
  token: uuid("token").primaryKey(),
  owner_id: integer("owner_id").notNull().references(() => operationalUsers.id),
  clinic_id: integer("clinic_id").notNull().references(() => operationalClinics.clinic_id),
  doctor_id: integer("doctor_id").notNull(),
  patient_id: integer("patient_id").notNull().references(() => operationalPatients.patient_id),
  appointment_id: integer("appointment_id").references(() => operationalAppointments.appointment_id),
  starts_at: instant("starts_at").notNull(),
  duration_minutes: integer("duration_minutes").notNull(),
  expires_at: instant("expires_at").notNull(),
}, t => [
  foreignKey({ columns: [t.doctor_id, t.clinic_id], foreignColumns: [operationalDoctors.doctor_id, operationalDoctors.clinic_id] }),
  check("appointment_holds_duration_minutes_check", sql`${t.duration_minutes} BETWEEN 1 AND 1440`),
  index("appointment_holds_doctor_expiry_idx").on(t.doctor_id, t.expires_at),
]);

export type AppointmentOperation = typeof appointmentOperations.$inferSelect;
export type AppointmentHold = typeof appointmentHolds.$inferSelect;

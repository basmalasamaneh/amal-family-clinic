// Immutable source tables. No defaults, generated IDs, operational fields,
// insert schemas or cleanup cascades: workbook IDs and values are authoritative.
import { pgTable, integer, text, date, timestamp } from "drizzle-orm/pg-core";

export const clinics = pgTable("clinics", {
  clinic_id: integer("clinic_id").primaryKey(),
  clinic_name: text("clinic_name").notNull(),
  city: text("city").notNull(),
  booking_method: text("booking_method").notNull(),
});
export const doctors = pgTable("doctors", {
  doctor_id: integer("doctor_id").primaryKey(),
  doctor_name: text("doctor_name").notNull(),
  clinic_id: integer("clinic_id").notNull(),
  specialty: text("specialty").notNull(),
});
export const patients = pgTable("patients", {
  patient_id: integer("patient_id").primaryKey(),
  patient_name: text("patient_name").notNull(),
  phone: text("phone").notNull(),
  dob: date("dob").notNull(),
});
export const appointments = pgTable("appointments", {
  appointment_id: integer("appointment_id").primaryKey(),
  clinic_id: integer("clinic_id").notNull(),
  doctor_id: integer("doctor_id").notNull(),
  patient_id: integer("patient_id").notNull(),
  scheduled_at: timestamp("scheduled_at", {withTimezone:true}).notNull(),
  booking_method: text("booking_method").notNull(),
  status: text("status").notNull(),
});
export const patientVisitHistory = pgTable("patient_visit_history", {
  visit_id: integer("visit_id").primaryKey(),
  patient_id: integer("patient_id").notNull(),
  clinic_id: integer("clinic_id").notNull(),
  doctor_id: integer("doctor_id").notNull(),
  visit_date: date("visit_date").notNull(),
  diagnosis_notes: text("diagnosis_notes").notNull(),
});
export const calendarAppExport = pgTable("calendar_app_export", {
  event_id: integer("event_id").primaryKey(),
  doctor_email: text("doctor_email").notNull(),
  patient_name_typed: text("patient_name_typed").notNull(),
  start_time: timestamp("start_time", {withTimezone:true}).notNull(),
  end_time: timestamp("end_time", {withTimezone:true}).notNull(),
  event_status: text("event_status").notNull(),
});

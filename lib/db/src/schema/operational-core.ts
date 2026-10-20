import { sql } from "drizzle-orm";
import {
  pgSchema, integer, text, date, timestamp, time, boolean, check, unique,
  foreignKey, type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const operational = pgSchema("operational");
export const networkMode = operational.enum("network_mode", ["full", "lite"]);
export const userRole = operational.enum("user_role", ["administrator", "doctor", "receptionist"]);
export const locale = operational.enum("locale", ["ar", "en"]);
export const theme = operational.enum("theme", ["light", "dark"]);
export const identity = (name = "id") => integer(name).primaryKey().generatedByDefaultAsIdentity();
export const instant = (name: string) => timestamp(name, { withTimezone: true });
export const fixtureKey = () => text("fixture_key").unique();
// Validate without changing original/source text.
export const nonblank = z.string().refine(v => v.trim().length > 0, "Must not be blank");

export const operationalClinics = operational.table("clinics", {
  clinic_id: identity("clinic_id"),
  clinic_name: text("clinic_name").notNull(),
  city: text("city").notNull(),
  booking_method: text("booking_method").notNull(),
  slot_minutes: integer("slot_minutes").notNull().default(30),
  working_days: integer("working_days").array().notNull().default(sql`ARRAY[0,1,2,3,4,5,6]::integer[]`),
  open_time: time("open_time").notNull().default("08:00"),
  close_time: time("close_time").notNull().default("17:00"),
  network_mode: networkMode("network_mode").notNull().default("full"),
  joined_at: instant("joined_at").notNull().defaultNow(),
  timezone: text("timezone").notNull().default("Asia/Hebron"),
}, (t) => [
  check("clinics_slot_minutes_check", sql`${t.slot_minutes} > 0 AND ${t.slot_minutes} <= 1440`),
  check("clinics_hours_check", sql`${t.open_time} < ${t.close_time}`),
  check("clinics_working_days_check", sql`cardinality(${t.working_days}) BETWEEN 1 AND 7 AND ${t.working_days} <@ ARRAY[0,1,2,3,4,5,6]::integer[] AND array_position(${t.working_days}, NULL) IS NULL`),
  check("clinics_timezone_check", sql`length(btrim(${t.timezone})) > 0`),
]);

export const operationalDoctors = operational.table("doctors", {
  doctor_id: identity("doctor_id"),
  doctor_name: text("doctor_name").notNull(),
  clinic_id: integer("clinic_id").notNull().references(() => operationalClinics.clinic_id),
  specialty: text("specialty").notNull(),
  email: text("email").notNull().unique(),
  user_id: integer("user_id").unique().references((): AnyPgColumn => operationalUsers.id),
}, (t) => [
  unique("doctors_id_clinic_unique").on(t.doctor_id, t.clinic_id),
  check("doctors_email_check", sql`${t.email} ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'`),
]);

export const operationalUsers = operational.table("users", {
  id: identity(),
  fixture_key: fixtureKey(),
  email: text("email").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  role: userRole("role").notNull(),
  clinic_id: integer("clinic_id").references(() => operationalClinics.clinic_id),
  doctor_id: integer("doctor_id").unique().references((): AnyPgColumn => operationalDoctors.doctor_id),
  pin_hash: text("pin_hash"),
  locale: locale("locale").notNull().default("ar"),
  theme: theme("theme").notNull().default("light"),
  last_login: instant("last_login"),
  disabled_at: instant("disabled_at"),
  auth_version: integer("auth_version").notNull().default(1),
}, (t) => [
  check("users_role_assignment_check", sql`(${t.role} = 'administrator' AND ${t.doctor_id} IS NULL) OR (${t.role} = 'receptionist' AND ${t.clinic_id} IS NOT NULL AND ${t.doctor_id} IS NULL) OR (${t.role} = 'doctor' AND ${t.clinic_id} IS NOT NULL AND ${t.doctor_id} IS NOT NULL)`),
  check("users_email_check", sql`${t.email} ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'`),
  check("users_hashes_check", sql`length(btrim(${t.password_hash})) > 0 AND (${t.pin_hash} IS NULL OR length(btrim(${t.pin_hash})) > 0)`),
  foreignKey({ name: "users_doctor_clinic_fk", columns: [t.doctor_id, t.clinic_id], foreignColumns: [operationalDoctors.doctor_id, operationalDoctors.clinic_id] }),
]);

export const operationalDevices = operational.table("devices", {
  id: identity(),
  fixture_key: fixtureKey(),
  clinic_id: integer("clinic_id").notNull().references(() => operationalClinics.clinic_id),
  label: text("label").notNull(),
  registered_at: instant("registered_at").notNull().defaultNow(),
}, (t) => [
  unique("devices_id_clinic_unique").on(t.id, t.clinic_id),
  check("devices_label_check", sql`${t.label} ~ '^[a-z][A-Za-z0-9_.-]*$'`),
]);

export const operationalPatients = operational.table("patients", {
  patient_id: identity("patient_id"),
  version: integer("version").notNull().default(1),
  created_clinic_id: integer("created_clinic_id").references(() => operationalClinics.clinic_id),
  patient_name: text("patient_name").notNull(),
  phone: text("phone").notNull(),
  dob: date("dob").notNull(),
  name_normalized: text("name_normalized").notNull(),
  minor_as_of: date("minor_as_of").notNull().default(sql`CURRENT_DATE`),
  is_minor: boolean("is_minor").generatedAlwaysAs(sql`minor_as_of < (dob + interval '18 years')::date`),
  guardian_name: text("guardian_name"),
  guardian_relation: text("guardian_relation"),
  merged_into_id: integer("merged_into_id").references((): AnyPgColumn => operationalPatients.patient_id),
}, (t) => [
  check("patients_dob_check", sql`${t.dob} <= ${t.minor_as_of}`),
  check("patients_name_phone_check", sql`length(btrim(${t.patient_name})) > 0 AND length(btrim(${t.name_normalized})) > 0 AND length(btrim(${t.phone})) > 0`),
  check("patients_guardian_check", sql`(${t.guardian_name} IS NULL AND ${t.guardian_relation} IS NULL) OR (length(btrim(${t.guardian_name})) > 0 AND length(btrim(${t.guardian_relation})) > 0 AND ${t.guardian_name} IS NOT NULL AND ${t.guardian_relation} IS NOT NULL)`),
  check("patients_merge_self_check", sql`${t.merged_into_id} IS NULL OR ${t.merged_into_id} <> ${t.patient_id}`),
]);

export const insertOperationalClinicSchema = createInsertSchema(operationalClinics, {
  clinic_name: nonblank, city: nonblank, booking_method: nonblank,
  open_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/),
  close_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/),
  slot_minutes: z.number().int().min(1).max(1440),
  working_days: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(v => new Set(v).size === v.length, "Working days must be distinct"),
  timezone: z.string().refine(v => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }, "Unknown IANA timezone"),
}).refine(v => (v.open_time ?? "08:00") < (v.close_time ?? "17:00"), { message: "Closing time must follow opening time", path: ["close_time"] });
export const insertOperationalDoctorSchema = createInsertSchema(operationalDoctors, { email: z.email(), doctor_name: nonblank, specialty: nonblank });
export const insertOperationalUserSchema = createInsertSchema(operationalUsers, { email: z.email(), password_hash: nonblank, pin_hash: nonblank.nullable() })
  .refine(v => v.role === "administrator" ? v.doctor_id == null : v.role === "doctor" ? v.clinic_id != null && v.doctor_id != null : v.clinic_id != null && v.doctor_id == null, { message: "Invalid role/clinic/doctor assignment", path: ["doctor_id"] });
export const insertOperationalDeviceSchema = createInsertSchema(operationalDevices, { label: z.string().regex(/^[a-z][A-Za-z0-9_.-]*$/) });
export const insertOperationalPatientSchema = createInsertSchema(operationalPatients, {
  patient_name: nonblank, phone: nonblank, name_normalized: nonblank,
  guardian_name: nonblank.nullable(), guardian_relation: nonblank.nullable(),
}).refine(v => (v.guardian_name == null) === (v.guardian_relation == null), { message: "Guardian name and relation must be supplied together", path: ["guardian_name"] })
  .refine(v => v.minor_as_of == null || v.dob <= v.minor_as_of, { message: "Birth date must not follow minor_as_of", path: ["dob"] })
  .refine(v => v.merged_into_id == null || v.patient_id == null || v.merged_into_id !== v.patient_id, { message: "Patient cannot merge into self", path: ["merged_into_id"] });

export type OperationalClinic = typeof operationalClinics.$inferSelect;
export type OperationalDoctor = typeof operationalDoctors.$inferSelect;
export type OperationalUser = typeof operationalUsers.$inferSelect;
export type OperationalDevice = typeof operationalDevices.$inferSelect;
export type OperationalPatient = typeof operationalPatients.$inferSelect;
export type InsertOperationalClinic = z.infer<typeof insertOperationalClinicSchema>;
export type InsertOperationalDoctor = z.infer<typeof insertOperationalDoctorSchema>;
export type InsertOperationalUser = z.infer<typeof insertOperationalUserSchema>;
export type InsertOperationalDevice = z.infer<typeof insertOperationalDeviceSchema>;
export type InsertOperationalPatient = z.infer<typeof insertOperationalPatientSchema>;

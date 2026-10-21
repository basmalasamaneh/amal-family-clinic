import { sql } from "drizzle-orm";
import { integer, text, uuid, jsonb, unique, uniqueIndex, index, foreignKey, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { operational, identity, instant, operationalClinics, operationalDoctors, operationalPatients, operationalUsers, operationalDevices } from "./operational-core";
import { operationalAppointments } from "./operational-clinical";

export const operationalWaitlistEntries = operational.table("waitlist_entries", {
  id: identity(),
  clinic_id: integer("clinic_id").notNull().references(() => operationalClinics.clinic_id),
  patient_id: integer("patient_id").notNull().references(() => operationalPatients.patient_id),
  doctor_id: integer("doctor_id").notNull(),
  weekdays: integer("weekdays").array().notNull(),
  window_start: text("window_start").notNull(),
  window_end: text("window_end").notNull(),
  requested_at: instant("requested_at").notNull().default(sql`clock_timestamp()`),
  status: text("status").notNull().default("active"),
  created_by: integer("created_by").notNull().references(() => operationalUsers.id),
}, t => [
  unique().on(t.id, t.clinic_id, t.doctor_id, t.patient_id),
  foreignKey({ columns: [t.doctor_id, t.clinic_id], foreignColumns: [operationalDoctors.doctor_id, operationalDoctors.clinic_id] }),
  index("waitlist_fifo").on(t.clinic_id, t.doctor_id, t.requested_at, t.id).where(sql`${t.status}='active'`),
  check("waitlist_entry_days", sql`cardinality(${t.weekdays}) BETWEEN 1 AND 7 AND ${t.weekdays} <@ ARRAY[0,1,2,3,4,5,6] AND array_position(${t.weekdays},NULL) IS NULL`),
  check("waitlist_entry_window", sql`${t.window_start} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND ${t.window_end} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND ${t.window_start}<${t.window_end}`),
  check("waitlist_entry_status", sql`${t.status} IN ('active','fulfilled')`),
]);
export const operationalWaitlistOpportunities = operational.table("waitlist_opportunities", {
  id: identity(),
  clinic_id: integer("clinic_id").notNull().references(() => operationalClinics.clinic_id),
  doctor_id: integer("doctor_id").notNull(),
  source_appointment_id: integer("source_appointment_id").notNull().references(() => operationalAppointments.appointment_id),
  cancellation_version: integer("cancellation_version").notNull(),
  cancellation_op_id: uuid("cancellation_op_id").notNull().unique(),
  starts_at: instant("starts_at").notNull(),
  ends_at: instant("ends_at").notNull(),
  created_at: instant("created_at").notNull().default(sql`clock_timestamp()`),
  status: text("status").notNull().default("open"),
}, t => [
  unique().on(t.source_appointment_id, t.cancellation_version),
  unique().on(t.id, t.clinic_id, t.doctor_id),
  foreignKey({ columns: [t.doctor_id, t.clinic_id], foreignColumns: [operationalDoctors.doctor_id, operationalDoctors.clinic_id] }),
  check("waitlist_opportunity_interval", sql`${t.ends_at}>${t.starts_at} AND ${t.cancellation_version}>1`),
  check("waitlist_opportunity_status", sql`${t.status} IN ('open','fulfilled','unavailable','exhausted')`),
]);
export const operationalWaitlistOffers = operational.table("waitlist_offers", {
  id: identity(),
  clinic_id: integer("clinic_id").notNull().references(() => operationalClinics.clinic_id),
  doctor_id: integer("doctor_id").notNull(),
  patient_id: integer("patient_id").notNull().references(() => operationalPatients.patient_id),
  entry_id: integer("entry_id").notNull(),
  opportunity_id: integer("opportunity_id").notNull(),
  created_at: instant("created_at").notNull().default(sql`clock_timestamp()`),
  expires_at: instant("expires_at").notNull(),
  status: text("status").notNull().default("active"),
  appointment_id: integer("appointment_id").references(() => operationalAppointments.appointment_id),
}, t => [
  unique().on(t.opportunity_id, t.entry_id),
  unique().on(t.id, t.patient_id, t.clinic_id),
  foreignKey({ columns: [t.appointment_id, t.patient_id, t.clinic_id],
    foreignColumns: [operationalAppointments.appointment_id, operationalAppointments.patient_id, operationalAppointments.clinic_id] }),
  foreignKey({ columns: [t.entry_id, t.clinic_id, t.doctor_id, t.patient_id],
    foreignColumns: [operationalWaitlistEntries.id, operationalWaitlistEntries.clinic_id, operationalWaitlistEntries.doctor_id, operationalWaitlistEntries.patient_id] }),
  foreignKey({ columns: [t.opportunity_id, t.clinic_id, t.doctor_id],
    foreignColumns: [operationalWaitlistOpportunities.id, operationalWaitlistOpportunities.clinic_id, operationalWaitlistOpportunities.doctor_id] }),
  uniqueIndex("waitlist_one_opportunity_offer").on(t.opportunity_id).where(sql`${t.status}='active'`),
  uniqueIndex("waitlist_one_entry_offer").on(t.entry_id).where(sql`${t.status}='active'`),
  index("waitlist_expiry").on(t.expires_at, t.id).where(sql`${t.status}='active'`),
  check("waitlist_offer_lifetime", sql`${t.expires_at}=${t.created_at}+interval '15 minutes'`),
  check("waitlist_offer_status", sql`${t.status} IN ('active','accepted','declined','expired','unavailable') AND (${t.status}='accepted')=(${t.appointment_id} IS NOT NULL)`),
]);
export const operationalWaitlistOperations = operational.table("waitlist_operations", {
  client_op_id: uuid("client_op_id").primaryKey(),
  actor_id: integer("actor_id").notNull().references(() => operationalUsers.id),
  clinic_id: integer("clinic_id").notNull().references(() => operationalClinics.clinic_id),
  device_id: integer("device_id").references(() => operationalDevices.id),
  payload_hash: text("payload_hash").notNull(),
  result: jsonb("result").notNull(),
  created_at: instant("created_at").notNull().default(sql`clock_timestamp()`),
});
export const operationalWaitlistTransitions = operational.table("waitlist_transitions", {
  id: identity(),
  clinic_id: integer("clinic_id").notNull().references(() => operationalClinics.clinic_id),
  actor_id: integer("actor_id").references(() => operationalUsers.id),
  entry_id: integer("entry_id").references(() => operationalWaitlistEntries.id),
  opportunity_id: integer("opportunity_id").references(() => operationalWaitlistOpportunities.id),
  offer_id: integer("offer_id").references(() => operationalWaitlistOffers.id),
  event: text("event").notNull(),
  reason: text("reason"),
  occurred_at: instant("occurred_at").notNull().default(sql`clock_timestamp()`),
});
export const insertOperationalWaitlistEntrySchema = createInsertSchema(operationalWaitlistEntries);
export const insertOperationalWaitlistOpportunitySchema = createInsertSchema(operationalWaitlistOpportunities);
export const insertOperationalWaitlistOfferSchema = createInsertSchema(operationalWaitlistOffers);
export type OperationalWaitlistEntry = typeof operationalWaitlistEntries.$inferSelect;
export type OperationalWaitlistOpportunity = typeof operationalWaitlistOpportunities.$inferSelect;
export type OperationalWaitlistOffer = typeof operationalWaitlistOffers.$inferSelect;

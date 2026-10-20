import { integer, text, uuid, primaryKey } from "drizzle-orm/pg-core";
import { operational, operationalClinics, operationalPatients, operationalUsers, instant } from "./operational-core";

export const patientClinicAccess = operational.table("patient_clinic_access", {
  patient_id: integer("patient_id").notNull().references(() => operationalPatients.patient_id),
  clinic_id: integer("clinic_id").notNull().references(() => operationalClinics.clinic_id),
}, t => [primaryKey({ columns: [t.patient_id, t.clinic_id] })]);

// Patient ID deliberately has no FK: receipt and audit retention survive deletion.
export const patientCreateReceipts = operational.table("patient_create_receipts", {
  user_id: integer("user_id").notNull().references(() => operationalUsers.id),
  client_op_id: uuid("client_op_id").notNull(),
  clinic_id: integer("clinic_id").notNull().references(() => operationalClinics.clinic_id),
  request_hash: text("request_hash").notNull(),
  patient_id: integer("patient_id").notNull(),
  created_at: instant("created_at").notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.clinic_id, t.client_op_id] })]);

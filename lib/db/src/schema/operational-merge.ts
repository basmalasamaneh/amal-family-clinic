import { sql } from "drizzle-orm";
import { integer, text, uuid, jsonb, primaryKey, check } from "drizzle-orm/pg-core";
import { operational, operationalUsers, operationalClinics, operationalPatients, instant } from "./operational-core";

export const patientMergeOperations = operational.table("patient_merge_operations", {
  client_op_id: uuid("client_op_id").primaryKey(),
  actor_id: integer("actor_id").notNull().references(() => operationalUsers.id),
  clinic_id: integer("clinic_id").notNull().references(() => operationalClinics.clinic_id),
  source_id: integer("source_id").notNull().unique().references(() => operationalPatients.patient_id),
  target_id: integer("target_id").notNull().references(() => operationalPatients.patient_id),
  request_hash: text("request_hash").notNull(),
  reason: text("reason").notNull(),
  result: jsonb("result").notNull(),
  created_at: instant("created_at").notNull().default(sql`clock_timestamp()`),
}, t => [
  check("patient_merge_operations_reason_check", sql`length(btrim(${t.reason})) BETWEEN 1 AND 1000`),
  check("patient_merge_operations_check", sql`${t.source_id} <> ${t.target_id}`),
]);

// The migration makes the receipt FK deferred so moves and receipt are atomic.
export const patientMergeMoves = operational.table("patient_merge_moves", {
  client_op_id: uuid("client_op_id").notNull().references(() => patientMergeOperations.client_op_id),
  relation_name: text("relation_name").notNull(),
  record_id: integer("record_id").notNull(),
  source_id: integer("source_id").notNull().references(() => operationalPatients.patient_id),
  target_id: integer("target_id").notNull().references(() => operationalPatients.patient_id),
}, t => [primaryKey({ columns: [t.client_op_id, t.relation_name, t.record_id] })]);

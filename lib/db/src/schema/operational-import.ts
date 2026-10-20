import { integer, text, uuid, jsonb, primaryKey } from "drizzle-orm/pg-core";
import { operational, operationalUsers, instant, identity } from "./operational-core";
import { operationalAppointments } from "./operational-clinical";
import { operationalImportBatches, operationalImportRows } from "./operational-workflows";

export const importSourceLinks = operational.table("import_source_links", {
  source_name: text("source_name").notNull(),
  source_event_id: integer("source_event_id").notNull(),
  source_hash: text("source_hash").notNull(),
  appointment_id: integer("appointment_id").notNull().references(() => operationalAppointments.appointment_id),
  batch_id: integer("batch_id").notNull().references(() => operationalImportBatches.id),
  row_id: integer("row_id").notNull().references(() => operationalImportRows.id),
  created_at: instant("created_at").notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.source_name, t.source_event_id] })]);
export const importOperations = operational.table("import_operations", {
  user_id: integer("user_id").notNull().references(() => operationalUsers.id),
  client_op_id: uuid("client_op_id").notNull(),
  request_hash: text("request_hash").notNull(),
  batch_id: integer("batch_id").notNull().references(() => operationalImportBatches.id),
  operation: text("operation").notNull(),
}, t => [primaryKey({ columns: [t.user_id, t.client_op_id] })]);
export const importReviews = operational.table("import_reviews", {
  id: identity(),
  batch_id: integer("batch_id").notNull().references(() => operationalImportBatches.id),
  row_id: integer("row_id").notNull().references(() => operationalImportRows.id),
  version: integer("version").notNull(),
  reviewer_id: integer("reviewer_id").notNull().references(() => operationalUsers.id),
  reviewed_at: instant("reviewed_at").notNull().defaultNow(),
  action: text("action").notNull(),
  verification_method: text("verification_method"),
  detail: jsonb("detail").notNull(),
});

import { sql } from "drizzle-orm";
import { bigserial, integer, jsonb, text, uuid, primaryKey, unique, index } from "drizzle-orm/pg-core";
import { operational, operationalUsers, operationalClinics, operationalDoctors, operationalDevices, instant } from "./operational-core";
import { appointmentOperations } from "./operational-scheduling";

export const syncDeviceOperations = operational.table("sync_device_operations", {
  device_id: integer("device_id").notNull().references(() => operationalDevices.id),
  sequence: integer("sequence").notNull(),
  client_op_id: uuid("client_op_id").notNull().references(() => appointmentOperations.client_op_id),
}, t => [primaryKey({ columns: [t.device_id, t.sequence] }), unique().on(t.device_id, t.client_op_id)]);

export const syncConflicts = operational.table("sync_conflicts", {
  id: uuid("id").primaryKey(),
  client_op_id: uuid("client_op_id").notNull().unique().references(() => appointmentOperations.client_op_id),
  actor_id: integer("actor_id").notNull().references(() => operationalUsers.id),
  device_id: integer("device_id").references(() => operationalDevices.id),
  clinic_id: integer("clinic_id").notNull().references(() => operationalClinics.clinic_id),
  doctor_id: integer("doctor_id").notNull().references(() => operationalDoctors.doctor_id),
  operation: jsonb("operation").notNull(),
  target_id: integer("target_id"),
  base_version: integer("base_version"),
  server_state: jsonb("server_state"),
  reasons: jsonb("reasons").notNull(),
  status: text("status").notNull().default("open"),
  version: integer("version").notNull().default(1),
  created_at: instant("created_at").notNull().default(sql`clock_timestamp()`),
  updated_at: instant("updated_at").notNull().default(sql`clock_timestamp()`),
}, t => [index("sync_conflicts_scope_idx").on(t.actor_id, t.clinic_id, t.status, t.created_at, t.id)]);

export const syncResolutionHistory = operational.table("sync_resolution_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  conflict_id: uuid("conflict_id").notNull().references(() => syncConflicts.id),
  client_op_id: uuid("client_op_id").notNull().unique().references(() => appointmentOperations.client_op_id),
  actor_id: integer("actor_id").notNull().references(() => operationalUsers.id),
  action: text("action").notNull(),
  result: jsonb("result").notNull(),
  created_at: instant("created_at").notNull().default(sql`clock_timestamp()`),
});

export const syncChanges = operational.table("sync_changes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  clinic_id: integer("clinic_id").notNull(),
  doctor_id: integer("doctor_id").notNull(),
  kind: text("kind").notNull(),
  entity_id: text("entity_id").notNull(),
  payload: jsonb("payload").notNull(),
  created_at: instant("created_at").notNull().default(sql`clock_timestamp()`),
}, t => [index("sync_changes_scope_idx").on(t.clinic_id, t.doctor_id, t.id)]);

import { sql } from "drizzle-orm";
import { boolean, check, integer, pgSchema, uuid } from "drizzle-orm/pg-core";
import { operational, operationalClinics, instant } from "./operational-core";

const operationalMeta = pgSchema("operational_meta");
export const demoState = operationalMeta.table("demo_state", {
  singleton: boolean("singleton").primaryKey().default(true),
  generation: uuid("generation").notNull(),
  changed_at: instant("changed_at").notNull().defaultNow(),
}, t => [check("demo_state_singleton_check", sql`${t.singleton}`)]);
export const demoResetReceipts = operationalMeta.table("demo_reset_receipts", {
  request_id: uuid("request_id").primaryKey(),
  previous_generation: uuid("previous_generation").notNull(),
  generation: uuid("generation").notNull(),
  completed_at: instant("completed_at").notNull().defaultNow(),
});
export const developerOutages = operational.table("developer_outages", {
  clinic_id: integer("clinic_id").primaryKey().references(() => operationalClinics.clinic_id),
  enabled_at: instant("enabled_at").notNull().defaultNow(),
  enabled_by: integer("enabled_by"),
});

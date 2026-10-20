import { integer, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { operational, operationalClinics, operationalUsers, instant } from "./operational-core";
export const clinicManagers = operational.table("clinic_managers", {
  clinic_id: integer("clinic_id").notNull().references(()=>operationalClinics.clinic_id),
  user_id: integer("user_id").notNull().references(()=>operationalUsers.id),
  granted_at: instant("granted_at").notNull().defaultNow(),
},t=>[primaryKey({columns:[t.clinic_id,t.user_id]})]);
export const insertClinicManagerSchema=createInsertSchema(clinicManagers);
export type ClinicManager=typeof clinicManagers.$inferSelect;

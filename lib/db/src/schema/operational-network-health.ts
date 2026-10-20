import { sql } from "drizzle-orm";
import { bigint, integer, check } from "drizzle-orm/pg-core";
import { operational, operationalDevices, instant } from "./operational-core";

export const deviceNetworkHealth = operational.table("device_network_health", {
  device_id: integer("device_id").primaryKey().references(() => operationalDevices.id, { onDelete: "cascade" }),
  heartbeat_sequence: bigint("heartbeat_sequence", { mode: "number" }),
  last_heartbeat_at: instant("last_heartbeat_at"),
  unsubmitted_operation_count: integer("unsubmitted_operation_count"),
  last_successful_sync_at: instant("last_successful_sync_at"),
}, t => [
  check("network_heartbeat_check", sql`(${t.heartbeat_sequence} IS NULL AND ${t.last_heartbeat_at} IS NULL AND ${t.unsubmitted_operation_count} IS NULL) OR (${t.heartbeat_sequence} BETWEEN 1 AND 9007199254740991 AND ${t.last_heartbeat_at} IS NOT NULL AND ${t.unsubmitted_operation_count} BETWEEN 0 AND 1000000)`),
  check("network_sequence_presence_check", sql`(${t.heartbeat_sequence} IS NULL) = (${t.last_heartbeat_at} IS NULL) AND (${t.heartbeat_sequence} IS NULL) = (${t.unsubmitted_operation_count} IS NULL)`),
]);

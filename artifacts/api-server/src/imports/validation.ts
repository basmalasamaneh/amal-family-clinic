import { z } from "zod/v4";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { canonicalPhone, normalizeName } from "@workspace/db/patient-search";
import { validBirthDate, isMinor } from "../patients/demographics";

const positive = z.number().int().positive().max(2147483647);
const reason = z.string().trim().min(1).max(1000);
export const sourceRow = z.object({
  event_id: positive, doctor_email: z.string().max(254), patient_name_typed: z.string().max(200),
  start_time: z.string().max(40), end_time: z.string().max(40), event_status: z.string().max(40),
}).strict();
export type SourceRow = z.infer<typeof sourceRow>;
export const uploadInput = z.object({
  source: z.enum(["seed", "json"]), clientOpId: z.uuid(), sourceName: z.string().trim().min(1).max(100).optional(),
  // Keep malformed column rows for actionable row errors, but never unbounded payloads.
  rows: z.array(z.record(z.string(), z.json())).min(1).max(100).optional(),
}).strict().refine(v => v.source === "seed" ? !v.rows && !v.sourceName :
  !!v.rows && !!v.sourceName && v.sourceName !== "calendar_app_export");
export const newPatientInput = z.object({
  name: z.string().trim().min(1).max(200).refine(v => !!normalizeName(v)),
  phone: z.string().trim().min(1).max(40).refine(v => canonicalPhone(v) !== null),
  dateOfBirth: z.string().refine(v => validBirthDate(v)),
  guardianName: z.string().trim().min(1).max(200).optional(),
  guardianRelation: z.string().trim().min(1).max(100).optional(),
}).strict().refine(v => !isMinor(v.dateOfBirth) || (!!v.guardianName && !!v.guardianRelation));
export const identityInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), patientId: positive, verification: z.object({
    method: z.enum(["phone", "dob"]), value: z.string().min(1).max(40),
  }).strict() }).strict(),
  z.object({ kind: z.literal("new"), patient: newPatientInput }).strict(),
]);
export const mapInput = z.object({
  expectedVersion: positive, rows: z.array(z.discriminatedUnion("action", [
    z.object({ rowId: positive, action: z.literal("skip"), reason }).strict(),
    z.object({ rowId: positive, action: z.literal("include"), doctorId: positive, identity: identityInput,
      startLocal: z.string().max(19).optional(), endLocal: z.string().max(19).optional(),
      associateAppointmentId: positive.optional(), overrideReason: reason.optional(),
    }).strict().refine(v => !!v.startLocal === !!v.endLocal),
  ])).min(1).max(100),
}).strict().refine(v => new Set(v.rows.map(r => r.rowId)).size === v.rows.length);
export const commitInput = z.object({ expectedVersion: positive, clientOpId: z.uuid() }).strict();
export type Issue = { code: string; messageKey: string; params: Record<string, string | number> };
export const issue = (code: string, params: Issue["params"] = {}): Issue => ({ code, messageKey: `import.${code}`, params });
export const zone = "Asia/Hebron";
export const localTime = (instant: string) => formatInTimeZone(instant, zone, "yyyy-MM-dd'T'HH:mm:ss");

/** Strict wall-time conversion: reject both missing and repeated DST clock readings. */
export function wallToUtc(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local)) throw new Error("INVALID_LOCAL_TIME");
  const wall = Date.parse(`${local}Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 19) !== local) throw new Error("INVALID_LOCAL_TIME");
  const base = fromZonedTime(local, zone).getTime();
  const candidates = new Set<number>();
  for (const delta of [-86400000, 0, 86400000]) {
    const sample = base + delta;
    if (!Number.isFinite(sample)) continue;
    const offset = Date.parse(`${localTime(new Date(sample).toISOString())}Z`) - sample;
    const candidate = wall - offset;
    if (localTime(new Date(candidate).toISOString()) === local) candidates.add(candidate);
  }
  if (candidates.size !== 1) throw new Error(candidates.size ? "AMBIGUOUS_LOCAL_TIME" : "INVALID_LOCAL_TIME");
  return new Date([...candidates][0]!).toISOString();
}
export type Mapping = { doctorId: number; clinicId: number; startsAt: string; endsAt: string; durationMinutes: number; status: string };
export function interval(start: string, end: string, converted: boolean) {
  const startsAt = converted ? new Date(start).toISOString() : wallToUtc(start);
  const endsAt = converted ? new Date(end).toISOString() : wallToUtc(end);
  const durationMinutes = (Date.parse(endsAt) - Date.parse(startsAt)) / 60000;
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) throw new Error("INVALID_INTERVAL");
  return { startsAt, endsAt, durationMinutes };
}
export const statuses: Record<string, string> = { confirmed: "booked", completed: "completed", cancelled: "cancelled" };

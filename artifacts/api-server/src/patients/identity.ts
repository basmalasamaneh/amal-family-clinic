import type { PoolClient } from "pg";
import { canonicalPhone, normalizeName } from "@workspace/db/patient-search";
import { validBirthDate } from "./demographics";

export type Identity = { patient_name: string | null; phone: string | null; dob: string | null };
/** Exact demographics are scheduling safety only, never consent or access authority. */
export function duplicateIdentity(row: Identity): string | null {
  if (!row.patient_name || !row.phone || !row.dob || !validBirthDate(row.dob)) return null;
  const name = normalizeName(row.patient_name), phone = canonicalPhone(row.phone);
  return name && phone ? JSON.stringify([name, row.dob, phone]) : null;
}
export async function schedulingIdentities(client: Pick<PoolClient, "query">) {
  const { rows } = await client.query<Identity & { patient_id: number }>(
    "SELECT patient_id,patient_name,phone,dob::text FROM operational.patients");
  return new Map(rows.map(row => [row.patient_id, duplicateIdentity(row)]));
}
export function equivalentPatientIds(identities: Map<number, string | null>, id: number): number[] {
  const key = identities.get(id);
  return [id, ...[...identities].filter(([other, value]) => other !== id && key && value === key).map(([other]) => other)];
}

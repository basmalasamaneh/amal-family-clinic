import type { Auth } from "../lib/auth";

export type ConsentLevel = "none" | "basic" | "clinical";
export interface ConsentRow {
  id: number; patient_id: number; level: ConsentLevel; given_at: Date; withdrawn_at: Date | null;
  given_by: "patient" | "guardian"; guardian_name: string | null; guardian_relation: string | null;
  recorded_clinic_id: number | null;
  recorded_by_user: number; evidence: "signed" | "verbal" | null;
}
export interface Consent {
  id: number; patientId: number; level: ConsentLevel; status: "active" | "withdrawn"; recordedAt: string;
  guardian?: { name: string; relationship: string };
  recordedByUserId: number; recordedClinicId: number | null; withdrawnAt: string | null;
  givenBy: "patient" | "guardian"; evidence: "signed" | "verbal" | null;
}
export function effectiveLevel(row?: ConsentRow): ConsentLevel {
  return !row || row.withdrawn_at ? "none" : row.level;
}
export function projectConsent(row: ConsentRow): Consent {
  return {
    id: row.id, patientId: row.patient_id, level: row.level,
    status: row.withdrawn_at ? "withdrawn" : "active", recordedAt: row.given_at.toISOString(),
    recordedByUserId: row.recorded_by_user, recordedClinicId: row.recorded_clinic_id,
    withdrawnAt: row.withdrawn_at?.toISOString() ?? null, givenBy: row.given_by, evidence: row.evidence,
    ...(row.given_by === "guardian" ? { guardian: { name: row.guardian_name!, relationship: row.guardian_relation! } } : {}),
  };
}
export interface VisibilityContext {
  auth: Auth; sourceClinicId: number; sourceMode: string; requesterMode: string;
  ownPatient: boolean; consent: ConsentLevel;
}
/** Null means no visit or existence metadata may be disclosed. */
export function visitVisibility(c: VisibilityContext): "basic" | "clinical" | null {
  if (c.auth.role !== "doctor" || !c.auth.clinicId || !c.auth.doctorId) return null;
  if (c.sourceClinicId === c.auth.clinicId) return c.ownPatient ? "clinical" : null;
  if (c.sourceMode !== "full" || c.requesterMode !== "full") return null;
  return c.consent === "none" ? null : c.consent;
}
export interface VisitSource {
  clinic_id: number; doctor_id: number; clinic_name: string; doctor_name: string;
  seen_at: Date; diagnosis_notes: string; key_alerts: string[];
}
export interface NetworkVisit {
  clinicId: number; doctorId: number; clinicName: string; doctorName: string;
  seenAt: string; visibility: "basic" | "clinical"; complaint?: string; keyAlerts?: string[];
}
export function projectVisit(row: VisitSource, visibility: "basic" | "clinical"): NetworkVisit {
  return {
    clinicId: row.clinic_id, doctorId: row.doctor_id, clinicName: row.clinic_name, doctorName: row.doctor_name,
    seenAt: row.seen_at.toISOString(), visibility,
    ...(visibility === "clinical" ? { complaint: row.diagnosis_notes, keyAlerts: row.key_alerts } : {}),
  };
}

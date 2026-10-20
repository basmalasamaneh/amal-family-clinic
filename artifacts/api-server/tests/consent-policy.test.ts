import { test } from "node:test";
import assert from "node:assert/strict";
import type { Auth } from "../src/lib/auth";
import {
  effectiveLevel, projectConsent, projectVisit, visitVisibility,
  type ConsentLevel, type ConsentRow, type VisitSource,
} from "../src/consent/policy";

const auth: Auth = {
  id: 900001, email: "policy@consent.test", role: "doctor", clinicId: 900002, doctorId: 900003,
  locale: "ar", theme: "light", sessionDigest: "unit-test-only", csrfToken: "unit-test-only",
  device: null, expiresAt: new Date("2099-01-01"), absoluteExpiresAt: null, pinVerifiedAt: null,
};
const levels: ConsentLevel[] = ["none", "basic", "clinical"];
const row: ConsentRow = {
  id: 900004, patient_id: 900005, level: "clinical", given_at: new Date("2025-01-01T10:00:00Z"),
  withdrawn_at: null, given_by: "patient", guardian_name: null, guardian_relation: null,
  recorded_clinic_id: auth.clinicId, recorded_by_user: auth.id, evidence: "signed",
};

test("policy: exhaustive roles × consent × local/cross × trusted relationship × Lite matrix", () => {
  let combinations = 0;
  for (const role of ["admin", "front-desk", "doctor"] as const) {
    for (const consent of levels) {
      for (const local of [false, true]) {
        for (const ownPatient of [false, true]) {
          for (const sourceMode of ["full", "lite"]) {
            for (const requesterMode of ["full", "lite"]) {
              const context = {
                auth: { ...auth, role }, sourceClinicId: local ? auth.clinicId! : 900006,
                sourceMode, requesterMode, ownPatient, consent,
              };
              let expected: "basic" | "clinical" | null = null;
              if (role === "doctor") {
                if (local) expected = ownPatient ? "clinical" : null;
                else if (sourceMode === "full" && requesterMode === "full" && consent !== "none") expected = consent;
              }
              assert.equal(visitVisibility(context), expected, JSON.stringify({ role, consent, local, ownPatient, sourceMode, requesterMode }));
              combinations++;
            }
          }
        }
      }
    }
  }
  assert.equal(combinations, 144);
});

test("policy: incomplete doctor identity and unknown network modes fail closed", () => {
  const context = {
    auth, sourceClinicId: 900006, sourceMode: "full", requesterMode: "full",
    ownPatient: true, consent: "clinical" as const,
  };
  for (const change of [{ clinicId: null }, { doctorId: null }, { clinicId: 0 }, { doctorId: 0 }]) {
    assert.equal(visitVisibility({ ...context, auth: { ...auth, ...change } }), null);
  }
  for (const unknown of ["", "FULL", "disabled", "unknown"]) {
    assert.equal(visitVisibility({ ...context, sourceMode: unknown }), null);
    assert.equal(visitVisibility({ ...context, requesterMode: unknown }), null);
  }
});

test("policy: withdrawal suppresses the latest grant; legacy null provenance remains explicit", () => {
  assert.equal(effectiveLevel(undefined), "none");
  for (const level of levels) {
    assert.equal(effectiveLevel({ ...row, level }), level);
    assert.equal(effectiveLevel({ ...row, level, withdrawn_at: new Date("2025-01-02T10:00:00Z") }), "none");
  }
  const projected = projectConsent(row);
  assert.deepEqual(projected, {
    id: row.id, patientId: row.patient_id, level: "clinical", status: "active",
    recordedAt: "2025-01-01T10:00:00.000Z", recordedByUserId: auth.id,
    recordedClinicId: auth.clinicId, evidence: "signed", withdrawnAt: null, givenBy: "patient",
  });
  const legacy = projectConsent({ ...row, recorded_clinic_id: null, evidence: null });
  assert.equal(legacy.recordedClinicId, null);
  assert.equal(legacy.evidence, null);
  const withdrawn = projectConsent({
    ...row, given_by: "guardian", guardian_name: "Parent", guardian_relation: "mother",
    withdrawn_at: new Date("2025-01-02T10:00:00Z"),
  });
  assert.equal(withdrawn.status, "withdrawn");
  assert.equal(withdrawn.withdrawnAt, "2025-01-02T10:00:00.000Z");
  assert.equal(withdrawn.givenBy, "guardian");
  assert.deepEqual(withdrawn.guardian, { name: "Parent", relationship: "mother" });
});

test("policy: basic projection is an exact whitelist and clinical projection contains only complaint/key alerts", () => {
  const source: VisitSource & Record<string, unknown> = {
    clinic_id: 900002, doctor_id: 900003, clinic_name: "Unit clinic", doctor_name: "Unit doctor",
    seen_at: new Date("2025-01-01T10:00:00Z"), diagnosis_notes: "PRIVATE COMPLAINT",
    key_alerts: ["allergy.test"], phone: "PRIVATE PHONE", guardian_name: "PRIVATE GUARDIAN",
    patient_dob: "2000-01-01", evidence: "PRIVATE EVIDENCE", unknown_clinical_field: "PRIVATE NOTE",
  };
  const basic = projectVisit(source, "basic");
  assert.deepEqual(basic, {
    clinicId: 900002, doctorId: 900003, clinicName: "Unit clinic", doctorName: "Unit doctor",
    seenAt: "2025-01-01T10:00:00.000Z", visibility: "basic",
  });
  assert(!JSON.stringify(basic).includes("PRIVATE"));
  assert.deepEqual(projectVisit(source, "clinical"), {
    ...basic, visibility: "clinical", complaint: "PRIVATE COMPLAINT", keyAlerts: ["allergy.test"],
  });
  assert.deepEqual(projectVisit({ ...source, key_alerts: [] }, "clinical").keyAlerts, []);
});

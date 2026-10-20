import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";
import { ApiError } from "../src/lib/auth-errors";
import { buildClinicExport, CLINIC_EXPORT_LIMITS } from "../src/adoption/export";

const names = ["clinicSettings", "doctors", "patients", "appointments", "visits", "consents", "importBatches", "importProvenance"];
type FakeOptions = {
  rows?: Record<string, { data: Record<string, any> | null; bytes: number }[]>;
  isolation?: string;
  error?: unknown;
};
function fake(options: FakeOptions = {}) {
  const calls: { text: string; values?: unknown[] }[] = [];
  let index = 0;
  const client = {
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      if (text.includes("current_setting")) return { rows: [{
        isolation: options.isolation ?? "repeatable read", exported_at: "2026-06-10T21:30:00.000Z",
      }] };
      if (text.includes("WITH selected")) {
        if (options.error) throw options.error;
        const name = names[index++];
        return { rows: options.rows?.[name] ?? (name === "clinicSettings"
          ? [{ data: { clinic_id: 41, clinic_name: "عيادة" }, bytes: 60 }] : []) };
      }
      return { rows: [] };
    },
  } as unknown as PoolClient;
  return { client, calls };
}
const rejectsCode = (code: string, status: number) => (error: unknown) =>
  error instanceof ApiError && error.code === code && error.status === status;

test("export is versioned UTF-8 JSON, enumerates field allowlists/counts/exclusions, and explicitly marks empty data", async () => {
  const { client, calls } = fake();
  const result = await buildClinicExport(client, 41);
  assert.equal(result.manifest.empty, true);
  assert.equal(result.manifest.rowCount, 1);
  assert.equal(result.manifest.format, "amal-clinic-export");
  assert.equal(result.manifest.schemaVersion, 1);
  assert.equal(result.manifest.encoding, "UTF-8");
  assert.equal(result.manifest.displayTimezone, "Asia/Hebron");
  assert.equal(result.manifest.exportedAt, "2026-06-10T21:30:00.000Z");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.deepEqual(Object.keys(result.datasets), names);
  assert.deepEqual(result.manifest.includedDatasets.map(d => d.count), [1, 0, 0, 0, 0, 0, 0, 0]);
  assert(result.manifest.excludedDatasets.some(d => d.dataset === "auditLogs"));
  const settingsFields = result.manifest.includedDatasets.find(d => d.dataset === "clinicSettings")!.fields;
  for (const field of ["adoption_state", "membership_status", "adoption_changed_at", "trial_started_at",
    "lite_started_at", "full_started_at", "left_at", "left_by"]) assert(settingsFields.includes(field), field);
  assert(!calls.some(c => /BEGIN|COMMIT|ROLLBACK/.test(c.text)));
  const reads = calls.filter(c => c.text.includes("WITH selected"));
  for (const query of reads) {
    assert.equal(query.values?.[0], 41);
    assert.match(query.text, /LIMIT \$2/);
    assert.match(query.text, /sum\(bytes\).*<= \$3/);
    assert(!query.text.includes("SELECT *"));
    for (const forbidden of ["password_hash", "pin_hash", "fixture_key", "source_payload", "staging", "source_hash",
      "recorded_by_user", "created_by", "client_op_id", "source_ref"]) assert(!query.text.includes(forbidden));
  }
  assert.match(reads[2].text, /patient_clinic_access/);
  assert.match(reads[2].text, /patient_doctor_access/);
  assert.match(reads[2].text, /patient_visit_history/);
  assert.match(reads[5].text, /c.recorded_clinic_id=\$1/);
  assert.match(reads[7].text, /a.clinic_id=\$1 AND b.clinic_id=\$1/);
});

test("non-empty counts and independent datasets", async () => {
  const { client } = fake({ rows: { visits: [{ data: { visit_id: 8, diagnosis_notes: "ملاحظة" }, bytes: 60 }] } });
  const result = await buildClinicExport(client, 41);
  assert.equal(result.manifest.empty, false);
  assert.equal(result.manifest.rowCount, 2);
  assert.equal(result.manifest.includedDatasets.find(d => d.dataset === "visits")?.count, 1);
});

test("rejects missing clinic and missing repeatable snapshot", async () => {
  await assert.rejects(buildClinicExport(fake({ rows: { clinicSettings: [] } }).client, 41), rejectsCode("NOT_FOUND", 404));
  await assert.rejects(buildClinicExport(fake({ isolation: "read committed" }).client, 41),
    rejectsCode("EXPORT_SNAPSHOT_REQUIRED", 500));
  await assert.rejects(buildClinicExport(fake().client, 0), rejectsCode("VALIDATION", 400));
});

test("row and SQL byte sentinels fail closed without returning partial data", async () => {
  await assert.rejects(buildClinicExport(fake({ rows: {
    patients: Array.from({ length: CLINIC_EXPORT_LIMITS.maxRows }, () => ({ data: { patient_id: 1 }, bytes: 10 })),
  } }).client, 41), rejectsCode("EXPORT_LIMIT_EXCEEDED", 413));
  await assert.rejects(buildClinicExport(fake({ rows: { visits: [{ data: null, bytes: CLINIC_EXPORT_LIMITS.maxBytes + 1 }] } }).client, 41),
    rejectsCode("EXPORT_LIMIT_EXCEEDED", 413));
});

test("final UTF-8 byte ceiling includes manifest and multibyte content, not JS string length", async () => {
  await assert.rejects(buildClinicExport(fake({ rows: {
    visits: [{ data: { diagnosis_notes: "ع".repeat(CLINIC_EXPORT_LIMITS.maxBytes / 2) }, bytes: 1 }],
  } }).client, 41), rejectsCode("EXPORT_LIMIT_EXCEEDED", 413));
});

test("database cancellation, lock/resource exhaustion are typed; unknown failures are not hidden", async () => {
  for (const code of ["57014", "55P03"]) await assert.rejects(buildClinicExport(fake({ error: { code } }).client, 41),
    rejectsCode("EXPORT_TIMEOUT", 503));
  for (const code of ["53100", "53200", "53300", "53400", "54000"]) {
    await assert.rejects(buildClinicExport(fake({ error: { code } }).client, 41),
      rejectsCode("EXPORT_RESOURCE_UNAVAILABLE", 503));
  }
  const unexpected = new Error("unexpected");
  await assert.rejects(buildClinicExport(fake({ error: unexpected }).client, 41), error => error === unexpected);
});

test("total elapsed deadline stops the export before the next dataset query", async context => {
  let call = 0;
  context.mock.method(performance, "now", () => call++ === 0 ? 0 : CLINIC_EXPORT_LIMITS.maxDurationMs + 1);
  const { client, calls } = fake();
  await assert.rejects(buildClinicExport(client, 41), rejectsCode("EXPORT_TIMEOUT", 503));
  assert(!calls.some(c => c.text.includes("WITH selected")));
});

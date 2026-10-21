import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import type { Auth } from "../src/lib/auth";

// No database is used: imports get an unreachable, explicitly test-only URL,
// and every pool entry point is replaced before the service is called.
process.env.DATABASE_URL = "postgresql://unused@127.0.0.1:1/amal_unit_no_database";
process.env.SESSION_SECRET = "unit-test-only-sync-suggestions";
const { pool } = await import("@workspace/db");
const { listSyncConflicts, pullSync } = await import("../src/sync/reads");
const { checkAppointment } = await import("../src/appointments/service");
const { ApiError } = await import("../src/lib/auth-errors");

const at = (time: string) => `2091-06-04T${time}:00.000Z`;
const actor: Auth = {
  id: 1, email: "unit@example.invalid", role: "front-desk", clinicId: 10, doctorId: null,
  locale: "en", theme: "light", sessionDigest: "unit", csrfToken: "unit",
  device: { id: 3, clinicId: 10 }, expiresAt: new Date(at("23:00")),
  absoluteExpiresAt: null, pinVerifiedAt: null,
};
function fixture() {
  const proposal = {
    clientOpId: randomUUID(), clinicId: 10, doctorId: 20, patientId: 30,
    startsAt: at("09:00"), endsAt: at("09:30"), source: "phone",
  };
  const appointment = (id: number, startsAt: string, overrides = {}) => ({
    appointment_id: id, clinic_id: 10, doctor_id: 20, patient_id: 31,
    scheduled_at: new Date(startsAt), duration_minutes: 30, status: "booked",
    booking_method: "phone", client_op_id: randomUUID(), version: 2, ...overrides,
  });
  const storedSlot = { startsAt: at("09:30"), endsAt: at("10:00") };
  const conflict = {
    id: randomUUID(), client_op_id: proposal.clientOpId, actor_id: 1, clinic_id: 10, doctor_id: 20,
    operation: { target: "create", payload: { ...proposal, holdToken: randomUUID() } },
    target_id: null as number | null, base_version: null as number | null, server_state: null,
    reasons: [{ type: "doctor-overlap", with: { appointmentId: 40, clinicId: 10 },
      severity: "blocking", suggestedSlots: [storedSlot] }],
    status: "open", version: 1, receipt: "1", created_at: new Date(at("07:00")), updated_at: new Date(at("07:00")),
  };
  return {
    proposal, appointment, conflict, storedSlot,
    appointments: [appointment(40, at("09:00")), appointment(41, at("09:30"))],
    holds: [{ token: randomUUID(), owner_id: 1, clinic_id: 10, doctor_id: 20, patient_id: 31,
      appointment_id: null, starts_at: new Date(at("08:30")), duration_minutes: 30, expires_at: new Date(at("08:05")) }],
    currentUser: { role: "receptionist", clinic_id: 10, doctor_id: null as number | null, device_id: 3 },
    requesterMode: "full", sourceMode: "full", patientAllowed: true, sessionAllowed: true, previewError: null as Error | null,
    statements: [] as string[], changeIds: [] as string[],
  };
}
type Fixture = ReturnType<typeof fixture>;
async function withFixture(t: TestContext, f: Fixture) {
  let locked = false;
  const client = {
    release() {},
    async query(sql: string, params: any[] = []) {
      f.statements.push(sql);
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("pg_advisory_xact_lock(761910)")) { locked = true; return { rows: [] }; }
      assert(locked, "authority and scheduling reads must follow the scheduling lock");
      if (sql.includes("SELECT u.role")) return { rows: f.sessionAllowed ? [f.currentUser] : [] };
      if (sql.includes("clock_timestamp() AS now")) return { rows: [{ now: new Date(at("08:00")) }] };
      if (sql.includes("FROM operational.sync_changes") && !sql.includes("SELECT c.*")) {
        // PostgreSQL resolves ORDER BY id to the projected text alias. Only a
        // qualified source-column order preserves the bigint cursor contract.
        const numeric = sql.includes("ORDER BY changes.id");
        const ids = f.changeIds.filter(id => BigInt(id) > BigInt(params[3])).sort((a, b) =>
          numeric ? (BigInt(a) < BigInt(b) ? -1 : 1) : a.localeCompare(b));
        return { rows: ids.slice(0, params[4]).map(id => ({
          id, kind: "appointment", entity_id: id,
          payload: { startsAt: at("09:00"), endsAt: at("09:30"), clinicId: 10, doctorId: 20 },
        })) };
      }
      if (sql.includes("SELECT c.*")) {
        assert.equal(params[0], actor.id);
        assert.equal(params[1], f.currentUser.clinic_id);
        return { rows: f.currentUser.role !== "doctor" || f.conflict.doctor_id === f.currentUser.doctor_id ? [f.conflict] : [] };
      }
      if (sql.includes("sync_resolution_history")) return { rows: [] };
      if (sql.includes("SELECT 1 FROM operational.appointments")) return { rows: [{ "?column?": 1 }] };
      if (sql.includes("SELECT * FROM operational.appointments WHERE appointment_id")) {
        return { rows: f.appointments.filter(a => a.appointment_id === params[0]) };
      }
      if (sql.includes("AS doctor")) {
        if (f.previewError) throw f.previewError;
        return { rows: [{ doctor: true, patient: f.patientAllowed }] };
      }
      if (sql.includes("SELECT * FROM operational.clinics")) return { rows: [{
        network_mode: f.requesterMode, working_days: [0, 1, 2, 3, 4, 5, 6],
        open_time: "08:00", close_time: "18:00", slot_minutes: 30, timezone: "UTC",
      }] };
      if (sql.includes("SELECT a.* FROM operational.appointments")) {
        assert(sql.includes("source.network_mode='full' AND $4='full'"), "filter remote occupancy before evaluation");
        assert.equal(params[3], f.requesterMode);
        return { rows: f.appointments.filter(a => (a.doctor_id === params[0] || a.patient_id === params[1]) &&
          (a.clinic_id === params[2] || (f.sourceMode === "full" && params[3] === "full"))) };
      }
      if (sql.includes("SELECT * FROM operational.appointment_holds")) return { rows: f.holds };
      throw new Error(`Unexpected SQL in read-only suggestion test: ${sql}`);
    },
  };
  t.mock.method(pool, "connect", async () => client);
  t.mock.method(pool, "query", () => { throw new Error("Unexpected database access"); });
}

test("fresh conflict suggestions (no database)", async t => {
  await t.test("pull pagination never skips receipts at bigint digit boundaries", async t => {
    const f = fixture();
    f.changeIds = ["8", "9", "10", "11", "99", "100", "101"];
    await withFixture(t, f);
    const delivered: string[] = [];
    let since: string | undefined;
    for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
      const page = await pullSync(actor, { limit: 2, ...(since ? { since } : {}) });
      delivered.push(...page.changes.map(change => change.id));
      since = page.since;
      if (!page.nextCursor) break;
    }
    assert.deepEqual(delivered, f.changeIds);
    assert.deepEqual((await pullSync(actor, { since })).changes, []);
  });
  await t.test("reload replaces occupied stale slots using current occupancy and live own holds, without writes", async t => {
    const f = fixture();
    await withFixture(t, f);
    const original = structuredClone(f.conflict);
    const result = await listSyncConflicts(actor, {});
    const item = result.items[0]!;
    const fresh = await checkAppointment(actor, f.proposal);
    assert.deepEqual(item.reasons, fresh.conflicts);
    const slots = item.reasons.flatMap(r => r.suggestedSlots ?? []);
    assert(slots.length > 0, "reloaded conflict must offer selectable alternatives");
    assert(!slots.some(s => [at("08:30"), at("09:00"), at("09:30")].includes(s.startsAt)));
    assert.equal("holdToken" in item.operation.payload, false);
    assert.deepEqual(f.conflict, original, "delivery must not rewrite durable conflict evidence/version");
    assert(!f.statements.some(sql => /^\s*(INSERT|UPDATE|DELETE)/.test(sql)));
  });

  await t.test("changed occupancy is reflected on each read, never cached historical suggestions", async t => {
    const f = fixture();
    await withFixture(t, f);
    const first = (await listSyncConflicts(actor, {})).items[0]!;
    const slot = first.reasons.flatMap(r => r.suggestedSlots ?? [])[0]!;
    f.appointments.push(f.appointment(42, slot.startsAt));
    const next = (await listSyncConflicts(actor, {})).items[0]!;
    assert(!next.reasons.flatMap(r => r.suggestedSlots ?? []).some(s => s.startsAt === slot.startsAt));
  });

  for (const restricted of ["requester", "source"] as const) {
    await t.test(`${restricted} downgrade removes all influence of formerly visible remote occupancy`, async t => {
      const f = fixture();
      f.appointments.push(f.appointment(50, at("10:00"), { clinic_id: 11, doctor_id: 21, patient_id: 30 }));
      await withFixture(t, f);
      const full = (await listSyncConflicts(actor, {})).items[0]!;
      assert(!full.reasons.flatMap(r => r.suggestedSlots ?? []).some(s => s.startsAt === at("10:00")));
      if (restricted === "requester") f.requesterMode = "lite";
      else f.sourceMode = "lite";
      const downgraded = (await listSyncConflicts(actor, {})).items[0]!;
      f.appointments = f.appointments.filter(a => a.clinic_id === 10);
      const withoutRemote = (await listSyncConflicts(actor, {})).items[0]!;
      assert.deepEqual(downgraded, withoutRemote, "foreign occupancy must not affect any delivered field");
      assert(downgraded.reasons.flatMap(r => r.suggestedSlots ?? []).some(s => s.startsAt === at("10:00")));
    });
  }

  await t.test("current doctor scope, patient access and session revocation are not bypassed", async t => {
    const f = fixture();
    await withFixture(t, f);
    f.currentUser.role = "doctor";
    f.currentUser.doctor_id = 21;
    assert.deepEqual((await listSyncConflicts(actor, {})).items, []);
    f.currentUser.role = "receptionist";
    f.patientAllowed = false;
    const item = (await listSyncConflicts(actor, {})).items[0]!;
    assert.deepEqual(item.reasons, [{ code: "INVALID_BOOKING_REFERENCE", messageKey: "error.validation", params: {}, conflictId: f.conflict.id }]);
    f.patientAllowed = true;
    f.sessionAllowed = false;
    await assert.rejects(listSyncConflicts(actor, {}), { code: "FORBIDDEN" });
    assert(f.statements.includes("ROLLBACK"));
  });

  await t.test("unexpected and authorization preview failures still abort the read", async t => {
    const f = fixture();
    await withFixture(t, f);
    for (const error of [new Error("unexpected preview failure"), new ApiError(500, "INTERNAL", "internal"),
      new ApiError(403, "FORBIDDEN", "forbidden"), new ApiError(400, "VALIDATION", "validation")]) {
      f.previewError = error;
      await assert.rejects(listSyncConflicts(actor, {}), e => e === error);
      assert.equal(f.statements.at(-1), "ROLLBACK");
    }
  });

  await t.test("update proposals use current authorized target, exclude it from collisions and retain stale revision evidence", async t => {
    const f = fixture();
    f.appointments.push(f.appointment(60, at("11:00"), { patient_id: 30 }));
    const staleRevision = { code: "VERSION_CONFLICT", params: { currentVersion: 2 } };
    Object.assign(f.conflict, {
      operation: { target: "update:60", payload: { clientOpId: randomUUID(), expectedVersion: 1,
        startsAt: at("09:00"), endsAt: at("09:30"), holdToken: randomUUID() } },
      target_id: 60, base_version: 1, reasons: [staleRevision],
    });
    await withFixture(t, f);
    const item = (await listSyncConflicts(actor, {})).items[0]!;
    assert(item.reasons.some(r => r.code === "VERSION_CONFLICT"));
    assert(item.reasons.flatMap(r => r.suggestedSlots ?? []).length > 0);
    assert(!item.reasons.some(r => r.with?.appointmentId === 60));
    assert.equal(item.baseVersion, 1, "preview must not accept or replace the stale mutation revision");
  });

  await t.test("missing update target is ineligible without retaining stored scheduling evidence", async t => {
    const f = fixture();
    Object.assign(f.conflict, {
      operation: { target: "update:60", payload: { clientOpId: randomUUID(), expectedVersion: 1,
        startsAt: at("09:00"), endsAt: at("09:30") } },
      target_id: 60, base_version: 1,
    });
    await withFixture(t, f);
    const item = (await listSyncConflicts(actor, {})).items[0]!;
    assert.deepEqual(item.reasons, [{ code: "NOT_FOUND", messageKey: "error.notFound", params: {}, conflictId: f.conflict.id }]);
    assert.equal(item.status, "open");
    assert.equal(item.version, 1);
    assert(!f.statements.some(sql => /^\s*(INSERT|UPDATE|DELETE)/.test(sql)));
  });

  await t.test("resolved conflicts never regain stored suggestion capabilities", async t => {
    const f = fixture();
    f.conflict.status = "resolved";
    await withFixture(t, f);
    const item = (await listSyncConflicts(actor, { status: "resolved" })).items[0]!;
    assert.deepEqual(item.reasons.flatMap(r => r.suggestedSlots ?? []), []);
    assert(!f.statements.some(sql => sql.includes("SELECT a.*")));
  });
});

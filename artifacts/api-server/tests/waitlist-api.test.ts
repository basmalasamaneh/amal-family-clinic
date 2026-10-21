import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import { test } from "node:test";
import type { Auth } from "../src/lib/auth";
import { withIsolatedAuthDatabase } from "./helpers/auth-isolated";

test("waitlist operational lifecycle, scope, concurrency, replay, sync and seed protections", { timeout: 240000 }, async t => {
  await withIsolatedAuthDatabase(async (admin, runtime) => {
    // Migrations run ONLY in this disposable PostgreSQL clone. Source DB is read-only.
    const { seedFingerprint } = await import("../../../scripts/src/operational-support");
    process.env.LOG_LEVEL = "silent";
    process.env.AUTH_ALLOWED_ORIGINS = "http://waitlist.test";
    process.env.SECURITY_RATE_GENERAL = "100000";
    const fingerprint = await seedFingerprint(admin);
    const migration = readFileSync(new URL("../../../lib/db/migrations/0017_waitlist.sql", import.meta.url), "utf8");
    await admin.query(migration);
    await admin.query(migration);
    assert.equal(await seedFingerprint(admin), fingerprint);
    const { digest } = await import("../src/lib/auth");
    const { createWaitlistEntry, listWaitlist, decideWaitlistOffer, checkWaitlistOffer } = await import("../src/waitlist/service");
    const { createAppointment, updateAppointment } = await import("../src/appointments/service");
    const { processWaitlist } = await import("../src/waitlist/lifecycle");
    const { pushSync } = await import("../src/sync/service");
    const { listReminderLog } = await import("../src/reminders/access");
    const { ApiError } = await import("../src/lib/auth-errors");
    const checkError = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;
    type Actor = Auth & { cookie: string; csrf: string };
    async function actor(clinicId: number, role: "receptionist" | "administrator" = "receptionist"): Promise<Actor> {
      const token = randomUUID(), csrf = randomUUID(), credential = randomUUID();
      const user = (await admin.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id)
        VALUES($1,'unused',$2,$3) RETURNING id`, [`${randomUUID()}@waitlist.test`, role, clinicId])).rows[0];
      let deviceId: number | null = null;
      if (role === "receptionist") {
        deviceId = (await admin.query(`INSERT INTO operational.devices(clinic_id,label) VALUES($1,'waitlistTest') RETURNING id`, [clinicId])).rows[0].id;
        await admin.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [deviceId, digest(credential)]);
      }
      await admin.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,device_id,csrf_token,absolute_expires_at,pin_verified_at)
        VALUES($1,$2,$3,$4,clock_timestamp()+interval '8 hours',clock_timestamp())`, [digest(token), user.id, deviceId, csrf]);
      return { id: user.id, role: role === "receptionist" ? "front-desk" : "admin", clinicId, doctorId: null,
        email: "waitlist@test.invalid", locale: "en", theme: "light", csrfToken: csrf,
        expiresAt: new Date(Date.now() + 3600000), absoluteExpiresAt: new Date(Date.now() + 28800000), pinVerifiedAt: new Date(),
        sessionDigest: digest(token), device: deviceId === null ? null : { id: deviceId, clinicId },
        cookie: `amal_session=${token}; amal_device=${credential}`, csrf };
    }
    async function fixture(enabled = true) {
      const clinicId = (await admin.query(`INSERT INTO operational.clinics(clinic_name,city,booking_method,reminders_enabled)
        VALUES($1,'test','phone',$2) RETURNING clinic_id`, [`WAITLIST-CLINIC-${randomUUID()}`, enabled])).rows[0].clinic_id as number;
      const doctorId = (await admin.query(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
        VALUES('Waitlist doctor',$1,'test',$2) RETURNING doctor_id`, [clinicId, `${randomUUID()}@waitlist.test`])).rows[0].doctor_id as number;
      const reception = await actor(clinicId);
      const patient = async () => (await admin.query(`INSERT INTO operational.patients
        (patient_name,phone,dob,name_normalized,created_clinic_id)
        VALUES($1,'secret-phone','1980-01-01','waitlist',$2) RETURNING patient_id`,
      [`PATIENT-PRIVATE-${randomUUID()}`, clinicId])).rows[0].patient_id as number;
      const sourcePatient = await patient();
      const source = async (startsAt = "2091-06-04T08:00:00Z", status = "booked") =>
        (await admin.query(`INSERT INTO operational.appointments(clinic_id,doctor_id,patient_id,scheduled_at,duration_minutes,booking_method,status)
          VALUES($1,$2,$3,$4,30,'phone',$5) RETURNING appointment_id`, [clinicId, doctorId, sourcePatient, startsAt, status])).rows[0].appointment_id as number;
      const entry = async (patientId?: number, fields = {}) => createWaitlistEntry(reception, {
        clientOpId: randomUUID(), patientId: patientId ?? await patient(), doctorId,
        weekdays: [0,1,2,3,4,5,6], windowStart: "08:00", windowEnd: "17:00", ...fields,
      });
      const cancel = async (id: number, fields = {}) => updateAppointment(reception, id, {
        clientOpId: randomUUID(), expectedVersion: 1, status: "cancelled", ...fields,
      });
      const list = () => listWaitlist(reception);
      return { clinicId, doctorId, reception, patient, source, sourcePatient, entry, cancel, list };
    }
    async function ageOffer(offerId: number) {
      await admin.query(`UPDATE operational.waitlist_offers SET created_at=statement_timestamp()-interval '16 minutes',
        expires_at=statement_timestamp()-interval '1 minute' WHERE id=$1`, [offerId]);
    }
    await t.test("cancellation -> FIFO offer -> standard booking, reminders once and terminal replay", async () => {
      const f = await fixture();
      const e1 = await f.entry(), e2 = await f.entry();
      const id = await f.source();
      assert.equal((await f.list()).offers.length, 0, "uncommitted cancellation/undo must not offer");
      const op = randomUUID();
      await f.cancel(id, { clientOpId: op, startsAt: "2091-06-05T08:00:00Z", endsAt: "2091-06-05T08:30:00Z" });
      await f.cancel(id, { clientOpId: op, startsAt: "2091-06-05T08:00:00Z", endsAt: "2091-06-05T08:30:00Z" });
      const state = await f.list(), offer = state.offers[0]!;
      assert.equal(state.opportunities.length, 1);
      assert.equal(offer.entryId, e1.id);
      assert.equal(offer.startsAt, "2091-06-04T08:00:00.000Z", "cancel+move must use ORIGINAL interval");
      assert.equal(Date.parse(offer.expiresAt) - Date.parse(offer.createdAt), 900000);
      assert.equal(offer.notificationStatus, "simulated");
      assert.deepEqual(await checkWaitlistOffer(f.reception, offer.id, {}), { ok: true, conflicts: [] });
      const decision = { clientOpId: randomUUID(), decision: "accept" };
      const accepted = await decideWaitlistOffer(f.reception, offer.id, decision);
      assert.equal(accepted.status, "accepted");
      assert.deepEqual(await decideWaitlistOffer(f.reception, offer.id, decision), accepted);
      assert.deepEqual(await decideWaitlistOffer(f.reception, offer.id, { clientOpId: randomUUID(), decision: "accept" }), accepted);
      assert.equal((await f.list()).entries.find(e => e.id === e1.id)!.status, "fulfilled");
      assert.equal((await f.list()).entries.find(e => e.id === e2.id)!.status, "active");
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM operational.notifications WHERE appointment_id=$1 AND schedule_version IS NOT NULL",
        [accepted.appointmentId])).rows[0].n, 2);
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM operational.appointments WHERE client_op_id=$1", [decision.clientOpId])).rows[0].n, 1);
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM operational.notifications WHERE waitlist_offer_id=$1", [offer.id])).rows[0].n, 1);
      await assert.rejects(runtime.query("UPDATE operational.waitlist_transitions SET reason='tampered' WHERE offer_id=$1", [offer.id]));
      await assert.rejects(admin.query("DELETE FROM operational.waitlist_transitions WHERE offer_id=$1", [offer.id]), /append-only/);
      await assert.rejects(runtime.query("TRUNCATE operational.waitlist_transitions"));
    });
    await t.test("filter before FIFO, stable ID ties, decline/expiry progression, recovery without expired burst", async () => {
      const f = await fixture();
      const wrongWindow = await f.entry(undefined, { windowStart: "08:00", windowEnd: "09:00" });
      const first = await f.entry(), second = await f.entry(), third = await f.entry();
      await admin.query("UPDATE operational.waitlist_entries SET requested_at='2020-01-01' WHERE id=ANY($1::int[])",
        [[first.id, second.id, third.id]]);
      await f.cancel(await f.source());
      let state = await f.list();
      assert.equal(state.offers[0]!.entryId, first.id);
      await decideWaitlistOffer(f.reception, state.offers[0]!.id, { clientOpId: randomUUID(), decision: "decline" });
      state = await f.list();
      const next = state.offers.find(o => o.status === "active")!;
      assert.equal(next.entryId, second.id);
      await ageOffer(next.id);
      await Promise.all(Array.from({ length: 4 }, () => processWaitlist()));
      state = await f.list();
      assert.equal(state.offers.length, 3);
      assert.equal(state.offers.find(o => o.id === next.id)!.status, "expired");
      const latest = state.offers.find(o => o.status === "active")!;
      assert.equal(latest.entryId, third.id);
      assert(Date.parse(latest.expiresAt) > Date.now() + 14 * 60000);
      await decideWaitlistOffer(f.reception, latest.id, { clientOpId: randomUUID(), decision: "decline" });
      state = await f.list();
      assert.equal(state.opportunities[0]!.status, "exhausted");
      assert(!state.offers.some(o => o.entryId === wrongWindow.id));
      assert(state.entries.every(e => e.status === "active"), "decline/expiry retain original queue age");
      await f.cancel(await f.source("2091-06-05T08:00:00Z"));
      assert.equal((await f.list()).offers.filter(o => o.status === "active")[0]!.entryId, first.id, "later opportunities can retry declined entries");
    });
    await t.test("one active per entry/opportunity, concurrent cancel replay and decisions", async () => {
      const f = await fixture();
      await f.entry(); await f.entry();
      const id = await f.source(), clientOpId = randomUUID();
      await Promise.all(Array.from({ length: 5 }, () => f.cancel(id, { clientOpId })));
      await f.cancel(await f.source("2091-06-05T08:00:00Z"));
      const offers = (await f.list()).offers;
      assert.equal(offers.length, 2);
      assert.equal(new Set(offers.map(o => o.entryId)).size, 2);
      const offer = offers[0]!;
      const decision = { clientOpId: randomUUID(), decision: "accept" };
      const outcomes = await Promise.all(Array.from({ length: 5 }, () => decideWaitlistOffer(f.reception, offer.id, decision)));
      assert(outcomes.every(o => o.appointmentId === outcomes[0]!.appointmentId && o.status === "accepted"));
    });
    await t.test("patient warning requires explicit override; conflict evidence survives; no implicit exemption", async () => {
      const f = await fixture(), e = await f.entry();
      const otherDoctor = (await admin.query(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
        VALUES('Other doctor',$1,'test',$2) RETURNING doctor_id`, [f.clinicId, `${randomUUID()}@waitlist.test`])).rows[0].doctor_id;
      await admin.query(`INSERT INTO operational.appointments(clinic_id,doctor_id,patient_id,scheduled_at,duration_minutes,booking_method,status)
        VALUES($1,$2,$3,'2091-06-04T08:00:00Z',30,'phone','booked')`, [f.clinicId, otherDoctor, e.patientId]);
      await f.cancel(await f.source());
      const offer = (await f.list()).offers[0]!;
      const preview = await checkWaitlistOffer(f.reception, offer.id, {});
      assert.equal(preview!.ok, false);
      assert(preview!.conflicts.some(c => c.type === "patient-overlap"));
      const input = { clientOpId: randomUUID(), decision: "accept" };
      await assert.rejects(decideWaitlistOffer(f.reception, offer.id, input), checkError("APPOINTMENT_CONFLICT"));
      await assert.rejects(decideWaitlistOffer(f.reception, offer.id, input), checkError("APPOINTMENT_CONFLICT"));
      assert.equal((await admin.query("SELECT status FROM operational.appointment_operations WHERE client_op_id=$1", [input.clientOpId])).rows[0].status, "conflict");
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM operational.sync_conflicts WHERE client_op_id=$1", [input.clientOpId])).rows[0].n, 1);
      assert.equal((await f.list()).offers[0]!.status, "active");
      await assert.rejects(decideWaitlistOffer(f.reception, offer.id, { ...input, overrideReason: "changed payload" }), checkError("IDEMPOTENCY_CONFLICT"));
      const accepted = await decideWaitlistOffer(f.reception, offer.id, { clientOpId: randomUUID(), decision: "accept", overrideReason: "Patient confirmed both visits" });
      assert.equal(accepted.status, "accepted");
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM operational.audit_log WHERE action='appointment.patient_overlap_override' AND clinic_id=$1", [f.clinicId])).rows[0].n, 1);
    });
    await t.test("independent booking, acceptance and expiry races serialize against scheduling lock", async () => {
      const f = await fixture(); await f.entry(); await f.entry();
      await f.cancel(await f.source());
      const o = (await f.list()).offers[0]!;
      const externalId = randomUUID();
      const raced = await Promise.allSettled([
        decideWaitlistOffer(f.reception, o.id, { clientOpId: randomUUID(), decision: "accept" }),
        createAppointment(f.reception, { clientOpId: externalId, clinicId: f.clinicId, doctorId: f.doctorId,
          patientId: await f.patient(), source: "phone", startsAt: o.startsAt, endsAt: o.endsAt }),
        processWaitlist(),
      ]);
      const state = await f.list();
      assert(["accepted", "unavailable"].includes(state.offers[0]!.status));
      assert.equal((await admin.query(`SELECT count(*)::int AS n FROM operational.appointments
        WHERE clinic_id=$1 AND doctor_id=$2 AND scheduled_at=$3 AND status='booked'`, [f.clinicId, f.doctorId, o.startsAt])).rows[0].n, 1);
      assert(raced.some(r => r.status === "fulfilled"));
      const expiry = await fixture(); await expiry.entry(); await expiry.entry();
      await expiry.cancel(await expiry.source());
      const expiring = (await expiry.list()).offers[0]!;
      await Promise.all([
        decideWaitlistOffer(expiry.reception, expiring.id, { clientOpId: randomUUID(), decision: "accept" }),
        processWaitlist({ now: new Date(expiring.expiresAt) }),
      ]);
      const outcome = (await expiry.list()).offers.find(x => x.id === expiring.id)!;
      assert(["accepted", "expired"].includes(outcome.status));
      assert.equal(outcome.appointmentId !== null, outcome.status === "accepted");
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM operational.waitlist_transitions WHERE offer_id=$1 AND event IN ('accepted','expired')",
        [expiring.id])).rows[0].n, 1, "only one terminal transition wins");
    });
    await t.test("waiting decisions use server time AFTER lock acquisition, not request arrival", async () => {
      const f = await fixture(); await f.entry();
      await f.cancel(await f.source());
      const o = (await f.list()).offers[0]!;
      await admin.query("BEGIN");
      await admin.query("SELECT pg_advisory_xact_lock_shared(761930)");
      await admin.query("SELECT pg_advisory_xact_lock(761910)");
      const waiting = decideWaitlistOffer(f.reception, o.id, { clientOpId: randomUUID(), decision: "accept" });
      await ageOffer(o.id);
      await admin.query("COMMIT");
      const outcome = await waiting;
      assert.equal(outcome.status, "expired"); assert.equal(outcome.appointmentId, null);
      const beforeStart = await fixture(); await beforeStart.entry();
      await beforeStart.cancel(await beforeStart.source());
      const active = (await beforeStart.list()).offers[0]!;
      await processWaitlist({ now: new Date(active.startsAt) });
      const late = await decideWaitlistOffer(beforeStart.reception, active.id, { clientOpId: randomUUID(), decision: "accept" });
      assert.equal(late.status, "unavailable"); assert.equal(late.appointmentId, null);
    });
    await t.test("late acceptance, occupied/past/invalid slots, no match, no historical backfill", async () => {
      const f = await fixture();
      await f.entry(); await f.entry();
      await f.cancel(await f.source());
      const offer = (await f.list()).offers[0]!;
      await ageOffer(offer.id);
      const result = await decideWaitlistOffer(f.reception, offer.id, { clientOpId: randomUUID(), decision: "accept" });
      assert.equal(result.status, "expired"); assert.equal(result.appointmentId, null);
      const active = (await f.list()).offers.find(o => o.status === "active")!;
      await createAppointment(f.reception, { clientOpId: randomUUID(), clinicId: f.clinicId, doctorId: f.doctorId,
        patientId: await f.patient(), source: "phone", startsAt: active.startsAt, endsAt: active.endsAt });
      const stale = await decideWaitlistOffer(f.reception, active.id, { clientOpId: randomUUID(), decision: "accept" });
      assert.equal(stale.status, "unavailable");
      assert.equal((await f.list()).opportunities[0]!.status, "unavailable");
      const empty = await fixture();
      await empty.cancel(await empty.source());
      assert.equal((await empty.list()).opportunities[0]!.status, "exhausted");
      await empty.entry();
      await empty.cancel(await empty.source("2001-06-04T08:00:00Z"));
      await empty.cancel(await empty.source("2091-06-05T22:00:00Z"));
      assert.equal((await empty.list()).offers.length, 0);
      const before = (await empty.list()).opportunities.length;
      await empty.source("2091-06-06T08:00:00Z", "cancelled");
      await processWaitlist();
      assert.equal((await empty.list()).opportunities.length, before);
      const failed = await empty.source();
      await assert.rejects(empty.cancel(failed, { expectedVersion: 999 }), checkError("VERSION_CONFLICT"));
      assert.equal((await empty.list()).opportunities.length, before);
    });
    await t.test("suppression visible, privacy fixed templates, Messages Log front-desk only and pending invalidation", async () => {
      const f = await fixture(false);
      const e = await f.entry();
      await f.cancel(await f.source());
      const o = (await f.list()).offers[0]!;
      assert.equal(o.notificationStatus, "suppressed");
      assert.equal(o.notificationReason, "clinic_disabled");
      const log = await listReminderLog(f.reception, { clinicId: f.clinicId });
      assert.equal(log.items.length, 1);
      assert(!JSON.stringify(log).includes(e.patientName));
      assert(!JSON.stringify(log).includes("secret-phone"));
      const clinicAdmin = await actor(f.clinicId, "administrator");
      assert.equal((await listReminderLog(clinicAdmin, { clinicId: f.clinicId })).items.length, 0);
      await admin.query(`UPDATE operational.notifications SET status='pending',cancelled_at=NULL,cancellation_reason=NULL
        WHERE waitlist_offer_id=$1`, [o.id]);
      await decideWaitlistOffer(f.reception, o.id, { clientOpId: randomUUID(), decision: "decline" });
      const n = (await admin.query("SELECT * FROM operational.notifications WHERE waitlist_offer_id=$1", [o.id])).rows[0];
      assert.equal(n.status, "cancelled"); assert.equal(n.cancellation_reason, "offer_declined");
      const opted = await fixture();
      const p = await opted.patient();
      await admin.query("UPDATE operational.patients SET reminder_opt_out=true WHERE patient_id=$1", [p]);
      await opted.entry(p); await opted.cancel(await opted.source());
      assert.equal((await opted.list()).offers[0]!.notificationReason, "patient_opt_out");
    });
    await t.test("clinic isolation, identity validation and refreshed role rather than caller claims", async () => {
      const f = await fixture(), other = await fixture();
      const e = await other.entry();
      await other.cancel(await other.source());
      const o = (await other.list()).offers[0]!;
      assert.equal((await f.list()).entries.length, 0);
      await assert.rejects(checkWaitlistOffer(f.reception, o.id, {}), checkError("NOT_FOUND"));
      await assert.rejects(decideWaitlistOffer(f.reception, o.id, { clientOpId: randomUUID(), decision: "decline" }), checkError("NOT_FOUND"));
      await assert.rejects(f.entry(e.patientId), checkError("INVALID_BOOKING_REFERENCE"));
      await assert.rejects(f.entry(undefined, { doctorId: other.doctorId }), checkError("INVALID_BOOKING_REFERENCE"));
      const receiptId = randomUUID(), patientId = await f.patient();
      const input = { clientOpId: receiptId, patientId, doctorId: f.doctorId, weekdays: [0,1], windowStart: "09:00", windowEnd: "12:00" };
      const created = await createWaitlistEntry(f.reception, input);
      assert.deepEqual(await createWaitlistEntry(f.reception, input), created);
      await assert.rejects(createWaitlistEntry(f.reception, { ...input, weekdays: [0] }), checkError("IDEMPOTENCY_CONFLICT"));
      await assert.rejects(createWaitlistEntry(f.reception, { ...input, clientOpId: randomUUID(), weekdays: [0,0] }));
      await assert.rejects(createWaitlistEntry(f.reception, { ...input, clientOpId: randomUUID(), windowEnd: "08:00" }));
      const a = await actor(f.clinicId, "administrator");
      await assert.rejects(listWaitlist({ ...a, role: "front-desk" }), checkError("FORBIDDEN"));
      await admin.query("UPDATE operational.users SET disabled_at=clock_timestamp() WHERE id=$1", [f.reception.id]);
      await assert.rejects(f.list(), checkError("FORBIDDEN"));
    });
    await t.test("sync committed cancellations use exact same hook, server lifetime and replay identity", async () => {
      const f = await fixture(); await f.entry();
      const id = await f.source(), op = randomUUID();
      const input = { operations: [{ sequence: 1, type: "update", appointmentId: id,
        input: { clientOpId: op, expectedVersion: 1, status: "cancelled" } }] };
      const response = await pushSync(f.reception, input);
      assert.equal(response.outcomes[0]!.status, "applied");
      await pushSync(f.reception, input);
      const state = await f.list();
      assert.equal(state.opportunities.length, 1); assert.equal(state.offers.length, 1);
      assert(Date.parse(state.offers[0]!.expiresAt) > Date.now() + 14 * 60000);
      const failed = await f.source("2091-06-05T08:00:00Z");
      await pushSync(f.reception, { operations: [{ sequence: 2, type: "update", appointmentId: failed,
        input: { clientOpId: randomUUID(), expectedVersion: 9, status: "cancelled" } }] });
      assert.equal((await f.list()).opportunities.length, 1);
    });
    await t.test("offer rollback leaves no success audit/notification and worker restart recovers", async () => {
      const f = await fixture(); await f.entry();
      const id = await f.source();
      await admin.query(`CREATE FUNCTION operational.waitlist_test_failure() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN RAISE EXCEPTION 'forced waitlist failure'; END $$;
        CREATE TRIGGER waitlist_test_failure BEFORE INSERT ON operational.waitlist_offers
        FOR EACH ROW EXECUTE FUNCTION operational.waitlist_test_failure()`);
      await assert.rejects(f.cancel(id), /forced waitlist failure/);
      assert.equal((await f.list()).opportunities.length, 0);
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM operational.audit_log WHERE clinic_id=$1 AND action LIKE 'waitlist.opportunity%'", [f.clinicId])).rows[0].n, 0);
      await admin.query("DROP TRIGGER waitlist_test_failure ON operational.waitlist_offers; DROP FUNCTION operational.waitlist_test_failure()");
      await f.cancel(id);
      await ageOffer((await f.list()).offers[0]!.id);
      await processWaitlist();
      assert.equal((await f.list()).opportunities[0]!.status, "exhausted");
    });
    await t.test("unrelated duplicate merge stays eligible; any source/target waitlist history blocks identity reassignment", async () => {
      const { previewPatientMerge, mergePatients } = await import("../src/patients/merge");
      const f = await fixture(), sourceId = await f.patient(), targetId = await f.patient();
      await admin.query(`UPDATE operational.patients SET patient_name=$2,name_normalized=$2,phone='+972595123456',dob='1980-01-01'
        WHERE patient_id=ANY($1::int[])`, [[sourceId, targetId], `Merge Match ${randomUUID()}`]);
      const input = { sourceId, targetId };
      assert.equal((await previewPatientMerge(f.reception, input)).canMerge, true,
        "registering waitlist foreign keys must not block every unrelated merge");
      const entry = await f.entry(sourceId);
      for (const pair of [input, { sourceId: targetId, targetId: sourceId }]) {
        const preview = await previewPatientMerge(f.reception, pair);
        assert.equal(preview.canMerge, false);
        assert.deepEqual(preview.blockers, ["MERGE_RESTRICTED"], "do not reveal hidden waitlist history");
        await assert.rejects(mergePatients(f.reception, { ...pair, sourceVersion: preview.sourceVersion, targetVersion: preview.targetVersion,
          confirmed: true, reason: "Explicit duplicate review", clientOpId: randomUUID() }), checkError("MERGE_UNSAFE"));
      }
      await admin.query("UPDATE operational.waitlist_entries SET status='fulfilled' WHERE id=$1", [entry.id]);
      assert.equal((await previewPatientMerge(f.reception, input)).canMerge, false, "terminal history also protects original identity");
    });
    await t.test("HTTP validation, CSRF and no-store match generated API contract", async () => {
      process.env.AUTH_ALLOWED_ORIGINS = "http://waitlist.test";
      process.env.LOG_LEVEL = "silent";
      process.env.SECURITY_RATE_GENERAL = "100000";
      const { default: app } = await import("../src/app");
      const f = await fixture();
      const server = app.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address(); assert(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}/api`;
      try {
        const request = async (path: string, method = "GET", body?: unknown, csrf = true) => fetch(base + path, {
          method, headers: { cookie: f.reception.cookie, origin: "http://waitlist.test",
            ...(body === undefined ? {} : { "content-type": "application/json" }),
            ...(csrf ? { "x-csrf-token": f.reception.csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
        });
        const response = await request("/waitlist");
        assert.equal(response.status, 200); assert.match(response.headers.get("cache-control")!, /no-store/);
        assert.equal(typeof (await response.json()).serverNow, "string");
        assert.equal((await request("/waitlist?clinicId=1")).status, 400);
        const input = { clientOpId: randomUUID(), doctorId: f.doctorId, patientId: await f.patient(), weekdays: [0,1],
          windowStart: "09:00", windowEnd: "12:00" };
        assert.equal((await request("/waitlist/entries", "POST", input, false)).status, 403);
        const created = await request("/waitlist/entries", "POST", input);
        assert.equal(created.status, 201);
        assert.equal((await request("/waitlist/entries", "POST", { ...input, clinicId: f.clinicId })).status, 400);
        assert.equal((await request("/waitlist/offers/01/check", "POST", {})).status, 400);
      } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
    });
    await t.test("controlled reset cleanup clears only operational waitlist with unchanged six-seed fingerprint", async () => {
      const { clearOperational } = await import("../../../scripts/src/demo-reset");
      const before = await seedFingerprint(admin);
      await admin.query("BEGIN");
      try {
        await clearOperational(admin);
        for (const table of ["waitlist_transitions", "waitlist_operations", "waitlist_offers", "waitlist_opportunities", "waitlist_entries"]) {
          assert.equal((await admin.query(`SELECT count(*)::int AS n FROM operational.${table}`)).rows[0].n, 0);
        }
        assert.equal(await seedFingerprint(admin), before);
      } finally { await admin.query("ROLLBACK"); }
    });
    assert.equal(await seedFingerprint(admin), fingerprint, "all six seed schemas/content/protections stay immutable");
  });
});

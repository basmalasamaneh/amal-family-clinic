import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import type { Auth } from "../src/lib/auth";
import { withIsolatedAuthDatabase } from "./helpers/auth-isolated";

// The existing operational database is read only: the helper clones it into a
// private disposable cluster before importing app/db. No bootstrap or migration.
test("reminders API: own-clinic access, independent preferences and private simulated log", { timeout: 180_000 }, async t => {
  await withIsolatedAuthDatabase(async (admin, pool) => {
    const requiredColumns: Record<string, string[]> = {
      clinics: ["reminders_enabled"],
      patients: ["reminder_opt_out"],
      notifications: ["schedule_version", "offset_hours", "text_ar", "text_en", "sent_at", "cancelled_at", "cancellation_reason", "receipt"],
    };
    for (const [table, columns] of Object.entries(requiredColumns)) {
      const found = (await admin.query(`SELECT column_name FROM information_schema.columns
        WHERE table_schema='operational' AND table_name=$1`, [table])).rows.map(r => r.column_name);
      for (const column of columns) assert(found.includes(column),
        `Missing prerequisite operational.${table}.${column}; run the completed reminders migration before this suite`);
    }
    const { seedFingerprint } = await import("../../../scripts/src/operational-support");
    const before = await seedFingerprint(admin);
    process.env.AUTH_ALLOWED_ORIGINS = "http://reminders-test.local";
    process.env.LOG_LEVEL = "silent";
    process.env.SECURITY_RATE_GENERAL = "100000";
    const { default: app } = await import("../src/app");
    const { digest } = await import("../src/lib/auth");
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api`;
    const marker = randomUUID();
    const sentinel = `CLINICAL-SECRET-${marker}`;
    type Actor = { id: number; clinicId: number | null; session: string; csrf: string; device?: string };
    async function clinic() {
      return (await admin.query(`INSERT INTO operational.clinics(clinic_name,city,booking_method,reminders_enabled)
        VALUES($1,'test','phone',true) RETURNING clinic_id`, [`reminder-${marker}-${randomUUID()}`])).rows[0].clinic_id as number;
    }
    async function actor(role: "administrator" | "receptionist" | "doctor", clinicId: number | null, doctorId?: number): Promise<Actor> {
      // The reciprocal doctor/user constraint is deferred until commit.
      await admin.query("BEGIN");
      try {
        const id = (await admin.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id,doctor_id)
          VALUES($1,'unused',$2,$3,$4) RETURNING id`,
        [`${randomUUID()}@reminders.test`, role, clinicId, doctorId ?? null])).rows[0].id as number;
        if (doctorId) await admin.query("UPDATE operational.doctors SET user_id=$1 WHERE doctor_id=$2", [id, doctorId]);
        const result: Actor = { id, clinicId, session: randomUUID(), csrf: randomUUID() };
        let deviceId: number | null = null;
        if (role === "receptionist") {
          deviceId = (await admin.query(`INSERT INTO operational.devices(clinic_id,label)
            VALUES($1,'reminderTest') RETURNING id`, [clinicId])).rows[0].id;
          result.device = randomUUID();
          await admin.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [deviceId, digest(result.device!)]);
        }
        await admin.query(`INSERT INTO operational.auth_sessions
          (token_digest,user_id,device_id,csrf_token,absolute_expires_at,pin_verified_at)
          VALUES($1,$2,$3,$4,now()+interval '8 hours',now())`,
        [digest(result.session), id, deviceId, result.csrf]);
        await admin.query("COMMIT");
        return result;
      } catch (error) {
        await admin.query("ROLLBACK");
        throw error;
      }
    }
    async function request(a: Actor | null, path: string, method = "GET", body?: unknown, csrf = true) {
      const response = await fetch(base + path, {
        method, headers: {
          origin: process.env.AUTH_ALLOWED_ORIGINS!,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(a ? {
            cookie: `amal_session=${a.session}${a.device ? `; amal_device=${a.device}` : ""}`,
            ...(csrf ? { "x-csrf-token": a.csrf } : {}),
          } : {}),
        }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, data: text ? JSON.parse(text) : null,
        cacheControl: response.headers.get("cache-control"), requestId: response.headers.get("x-request-id"),
        text };
    }
    async function patient(createdClinicId: number | null) {
      return (await admin.query(`INSERT INTO operational.patients
        (patient_name,phone,dob,name_normalized,created_clinic_id)
        VALUES($1,$2,'1980-01-01',$1,$3) RETURNING patient_id`,
      [`PATIENT-SECRET-${marker}-${randomUUID()}`, `PHONE-SECRET-${marker}`, createdClinicId])).rows[0].patient_id as number;
    }
    async function appointment(clinicId: number, doctorId: number, patientId: number) {
      return (await admin.query(`INSERT INTO operational.appointments
        (clinic_id,doctor_id,patient_id,scheduled_at,booking_method,status)
        VALUES($1,$2,$3,'2091-06-04T10:00:00Z','phone','booked') RETURNING appointment_id`,
      [clinicId, doctorId, patientId])).rows[0].appointment_id as number;
    }
    type NotificationStatus = "pending" | "simulated" | "cancelled";
    async function notification(clinicId: number, patientId: number, appointmentId: number,
      status: NotificationStatus = "pending", scheduledAt = "2091-06-03T10:00:00Z", offset = 24) {
      return (await admin.query(`INSERT INTO operational.notifications
        (clinic_id,patient_id,appointment_id,message_key,status,scheduled_at,schedule_version,
         offset_hours,text_ar,text_en,sent_at,cancelled_at,cancellation_reason,receipt)
        VALUES($1,$2,$3,'reminder.appointment',$4::text::operational.notification_status,$5::timestamptz,1,$6,
          'تذكير بموعدك في العيادة','Reminder: your clinic appointment',
          CASE WHEN $4::text='simulated' THEN $5::timestamptz ELSE NULL END,
          CASE WHEN $4::text='cancelled' THEN $5::timestamptz ELSE NULL END,
          CASE WHEN $4::text='cancelled' THEN 'appointment_inactive' ELSE NULL END,
          CASE WHEN $4::text='simulated' THEN '{"transport":"simulated"}'::jsonb ELSE NULL END)
        RETURNING id`, [clinicId, patientId, appointmentId, status, scheduledAt, offset])).rows[0].id as number;
    }
    try {
      const local = await clinic(), remote = await clinic();
      const doctorId = (await admin.query(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
        VALUES($1,$2,'test',$3) RETURNING doctor_id`, [sentinel, local, `${randomUUID()}@reminders.test`])).rows[0].doctor_id as number;
      const remoteDoctorId = (await admin.query(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
        VALUES('reminder remote',$1,'test',$2) RETURNING doctor_id`, [remote, `${randomUUID()}@reminders.test`])).rows[0].doctor_id as number;
      const desk = await actor("receptionist", local), remoteDesk = await actor("receptionist", remote);
      const manager = await actor("administrator", local), globalManager = await actor("administrator", null);
      const doctor = await actor("doctor", local, doctorId);
      const own = await patient(local), shared = await patient(remote), foreign = await patient(remote);
      const merged = await patient(local), target = await patient(local), bookingOnly = await patient(remote);
      await admin.query("INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)", [shared, local]);
      await admin.query("UPDATE operational.patients SET merged_into_id=$1 WHERE patient_id=$2", [target, merged]);
      await appointment(local, doctorId, bookingOnly); // Mutable bookings never grant patient access.
      await admin.query(`INSERT INTO operational.patient_visit_history
        (patient_id,clinic_id,doctor_id,visit_date,diagnosis_notes)
        VALUES($1,$2,$3,'2025-01-12',$4)`, [own, local, doctorId, sentinel]);
      const logPath = `/reminders/log?clinicId=${local}`;
      const clinicPath = `/reminders/clinics/${local}`, patientPath = `/reminders/patients/${own}`;
      await t.test("authentication, doctor denial and strict own-clinic roles including null-clinic admin", async () => {
        for (const [path, method, body] of [
          [logPath, "GET", undefined], [clinicPath, "GET", undefined],
          [clinicPath, "PUT", { enabled: false }], [patientPath, "GET", undefined],
          [patientPath, "PUT", { optedOut: true }],
        ] as const) {
          assert.equal((await request(null, path, method, body)).status, 401);
          assert.equal((await request(doctor, path, method, body)).status, 403);
        }
        for (const a of [desk, manager]) {
          assert.equal((await request(a, logPath)).status, 200);
          assert.equal((await request(a, clinicPath)).status, 200);
          assert.equal((await request(a, `/reminders/log?clinicId=${remote}`)).status, 403);
          assert.equal((await request(a, `/reminders/clinics/${remote}`)).status, 403);
        }
        for (const path of [logPath, clinicPath]) assert.equal((await request(globalManager, path)).status, 403);
        assert.equal((await request(globalManager, clinicPath, "PUT", { enabled: false })).status, 403);
        assert.equal((await request(desk, clinicPath, "PUT", { enabled: false })).status, 403);
        for (const a of [manager, globalManager]) {
          assert.equal((await request(a, patientPath)).status, 403);
          assert.equal((await request(a, patientPath, "PUT", { optedOut: true })).status, 403);
        }
        assert.equal((await request(manager, clinicPath, "PUT", { enabled: true }, false)).status, 403);
        assert.equal((await request(desk, patientPath, "PUT", { optedOut: false }, false)).status, 403);
      });
      await t.test("delegated home-clinic doctor manages reminders, never patients or other clinics", async () => {
        // A network coordinator without a manager grant has no reminder authority.
        await admin.query("INSERT INTO operational.network_coordinator_scope(user_id,clinic_id) VALUES($1,$2)", [doctor.id, local]);
        for (const path of [logPath, clinicPath]) assert.equal((await request(doctor, path)).status, 403);
        assert.equal((await request(doctor, clinicPath, "PUT", { enabled: true })).status, 403);
        await admin.query("INSERT INTO operational.clinic_managers(clinic_id,user_id) VALUES($1,$2)", [local, doctor.id]);
        assert.equal((await request(doctor, logPath)).status, 200);
        assert.deepEqual((await request(doctor, clinicPath)).data, { enabled: true, canManage: true });
        assert.deepEqual((await request(manager, clinicPath)).data, { enabled: true, canManage: true });
        assert.deepEqual((await request(desk, clinicPath)).data, { enabled: true, canManage: false });
        assert.equal((await request(doctor, clinicPath, "PUT", { enabled: true }, false)).status, 403);
        for (const path of [patientPath, `/reminders/patients/${foreign}`]) {
          assert.equal((await request(doctor, path)).status, 403);
          assert.equal((await request(doctor, path, "PUT", { optedOut: true })).status, 403);
        }
        assert.equal((await request(doctor, `/reminders/log?clinicId=${remote}`)).status, 403);
        assert.equal((await request(doctor, `/reminders/clinics/${remote}`)).status, 403);
        assert.equal((await request(doctor, `/reminders/clinics/${remote}`, "PUT", { enabled: false })).status, 403);
        // Delegated writes preserve the same cancellation/no-resurrection semantics.
        const p = await patient(local), appt = await appointment(local, doctorId, p);
        const pending = await notification(local, p, appt);
        assert.deepEqual((await request(doctor, clinicPath, "PUT", { enabled: false })).data,
          { enabled: false, canManage: true });
        assert.equal((await admin.query("SELECT cancellation_reason FROM operational.notifications WHERE id=$1", [pending])).rows[0].cancellation_reason, "clinic_disabled");
        assert.deepEqual((await request(doctor, clinicPath, "PUT", { enabled: true })).data,
          { enabled: true, canManage: true });
        assert.equal((await admin.query("SELECT status FROM operational.notifications WHERE id=$1", [pending])).rows[0].status, "cancelled");
      });
      await t.test("fresh authority rejects disabled users, revoked/idle sessions and changed home clinic", async () => {
        const { clinicPreference, listReminderLog } = await import("../src/reminders/access");
        const stale: Auth = { id: doctor.id, email: "unused@reminders.test", role: "doctor", clinicId: local, doctorId,
          locale: "en", theme: "light", sessionDigest: digest(doctor.session), csrfToken: doctor.csrf,
          device: null, expiresAt: new Date(Date.now() + 3600000), absoluteExpiresAt: null, pinVerifiedAt: null };
        const denied = async () => {
          for (const work of [
            () => clinicPreference(stale, local),
            () => clinicPreference(stale, local, { enabled: false }),
            () => listReminderLog(stale, { clinicId: local }),
          ]) await assert.rejects(work, (error: { status?: number }) => error.status === 403);
        };
        await admin.query("UPDATE operational.users SET disabled_at=now() WHERE id=$1", [doctor.id]);
        await denied();
        await admin.query("UPDATE operational.users SET disabled_at=NULL WHERE id=$1", [doctor.id]);
        await admin.query("UPDATE operational.auth_sessions SET revoked_at=now() WHERE token_digest=$1", [stale.sessionDigest]);
        await denied();
        await admin.query("UPDATE operational.auth_sessions SET revoked_at=NULL,last_seen_at=now()-interval '31 minutes' WHERE token_digest=$1", [stale.sessionDigest]);
        await denied();
        await admin.query("UPDATE operational.auth_sessions SET last_seen_at=now() WHERE token_digest=$1", [stale.sessionDigest]);
        // Use an administrator's stale cached clinic to check current-user scope
        // without violating the doctor's reciprocal home-clinic constraints.
        const moved = await actor("administrator", local);
        const oldAdmin: Auth = { ...stale, id: moved.id, role: "admin", doctorId: null,
          sessionDigest: digest(moved.session), csrfToken: moved.csrf };
        await admin.query("UPDATE operational.users SET clinic_id=$2 WHERE id=$1", [moved.id, remote]);
        await assert.rejects(() => clinicPreference(oldAdmin, local), (error: { status?: number }) => error.status === 403);
        assert.equal((await clinicPreference(stale, local)).canManage, true);
      });
      await t.test("last manager grant revocation serializes before waiting log/read/write authority", async () => {
        await admin.query("BEGIN");
        try {
          // The database delegation trigger obtains 160005 then 761910.
          await admin.query("DELETE FROM operational.clinic_managers WHERE clinic_id=$1 AND user_id=$2", [local, doctor.id]);
          const requests = [
            request(doctor, logPath), request(doctor, clinicPath),
            request(doctor, clinicPath, "PUT", { enabled: false }),
          ];
          const deadline = Date.now() + 5000;
          let waiting = 0;
          while (Date.now() < deadline) {
            waiting = Number((await pool.query(`SELECT count(*) FROM pg_locks
              WHERE locktype='advisory' AND objid=160005 AND NOT granted`)).rows[0].count);
            if (waiting >= 3) break;
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.equal(waiting, 3, "all reminder operations wait on authority before scheduling, with no lock inversion");
          await admin.query("COMMIT");
          for (const response of await Promise.all(requests)) assert.equal(response.status, 403);
          assert.equal((await request(doctor, clinicPath)).status, 403, "coordinator scope cannot replace the last revoked grant");
          assert.equal((await request(manager, clinicPath)).data.enabled, true, "rejected stale writes do not toggle");
        } finally { await admin.query("ROLLBACK"); }
      });
      await t.test("strict query/body validation rejects forged context, arbitrary fields and invalid bounds", async () => {
        for (const suffix of [
          "&patientId=1", "&doctorId=1", "&unknown=x", `&clinicId=${remote}`,
          "&limit=0", "&limit=101", "&limit=1.5", "&limit=2&limit=3",
          "&cursor=0", "&cursor=-1", "&cursor=garbage", "&cursor=2147483648",
          "&status=pending", "&status=simulated", "&status=unknown",
          "&from=not-a-date", "&to=2091-06-04", "&from=2091-06-04T00:00:00Z&to=2091-06-03T00:00:00Z",
          "&from=2091-06-04T00:00:00Z&to=2091-06-04T00:00:00Z",
        ]) assert.equal((await request(desk, logPath + suffix)).status, 400, suffix);
        assert.equal((await request(desk, "/reminders/log")).status, 400);
        for (const id of ["0", "-1", "abc", "1.5", "2147483648"]) {
          assert.equal((await request(manager, `/reminders/clinics/${id}`)).status, 400);
          assert.equal((await request(desk, `/reminders/patients/${id}`)).status, 400);
        }
        for (const body of [undefined, {}, { enabled: "false" }, { enabled: true, clinicId: remote }, { enabled: true, patientId: foreign }, { enabled: true, unknown: 1 }]) {
          assert.equal((await request(manager, clinicPath, "PUT", body)).status, 400, JSON.stringify(body));
        }
        for (const body of [undefined, {}, { optedOut: "false" }, { optedOut: true, clinicId: remote }, { optedOut: true, patientId: foreign }, { optedOut: true, consent: "clinical" }]) {
          assert.equal((await request(desk, patientPath, "PUT", body)).status, 400, JSON.stringify(body));
        }
        for (const [a, path, body] of [[manager, clinicPath, { enabled: true }], [desk, patientPath, { optedOut: false }]] as const) {
          for (const suffix of [`?clinicId=${remote}`, `?patientId=${foreign}`, "?unknown=1"]) {
            assert.equal((await request(a, path + suffix)).status, 400, path + suffix);
            assert.equal((await request(a, path + suffix, "PUT", body)).status, 400, path + suffix);
          }
        }
      });
      await t.test("patient preference requires trusted local relationship and excludes merged sources", async () => {
        for (const id of [own, shared, target]) {
          const result = await request(desk, `/reminders/patients/${id}`);
          assert.equal(result.status, 200, JSON.stringify(result.data));
          assert.deepEqual(result.data, { optedOut: false });
        }
        for (const id of [foreign, bookingOnly, merged, 2147483647]) {
          const path = `/reminders/patients/${id}`;
          assert.equal((await request(desk, path)).status, 404);
          assert.equal((await request(desk, path, "PUT", { optedOut: true })).status, 404);
        }
        assert.equal((await request(remoteDesk, patientPath)).status, 404);
      });
      await t.test("opt-out is independent of network consent and never resurrects cancelled reminders", async () => {
        const consent = await request(desk, `/patients/${own}/consent`, "POST", {
          level: "clinical", evidence: "signed", clientOpId: randomUUID(),
        });
        assert.equal(consent.status, 201, JSON.stringify(consent.data));
        const consentRows = async () => (await admin.query(
          "SELECT row_to_json(c) AS row FROM operational.patient_consents c WHERE patient_id=$1 ORDER BY id", [own])).rows;
        const consentBefore = await consentRows();
        const appt = await appointment(local, doctorId, own);
        const pending = await notification(local, own, appt);
        assert.deepEqual((await request(desk, patientPath, "PUT", { optedOut: true })).data, { optedOut: true });
        const cancelled = (await admin.query("SELECT status,cancelled_at,cancellation_reason FROM operational.notifications WHERE id=$1", [pending])).rows[0];
        assert.equal(cancelled.status, "cancelled");
        assert(cancelled.cancelled_at);
        assert.equal(cancelled.cancellation_reason, "patient_opt_out");
        assert.deepEqual(await consentRows(), consentBefore, "reminder opt-out does not withdraw or alter consent");
        assert.deepEqual((await request(desk, patientPath, "PUT", { optedOut: false })).data, { optedOut: false });
        assert.deepEqual((await admin.query("SELECT status,cancelled_at,cancellation_reason FROM operational.notifications WHERE id=$1", [pending])).rows[0], cancelled);
        assert.deepEqual(await consentRows(), consentBefore);
        assert.equal((await request(desk, `/reminders/patients/${shared}`, "PUT", { optedOut: true })).status, 200,
          "no consent grant is required for a local reminder preference");
        assert.deepEqual((await request(desk, `/reminders/patients/${shared}`)).data, { optedOut: true });
        await request(desk, `/reminders/patients/${shared}`, "PUT", { optedOut: false });
      });
      await t.test("clinic disable cancels only its pending reminders and enable does not resurrect", async () => {
        const p = await patient(local), rp = await patient(remote);
        const appt = await appointment(local, doctorId, p), remoteAppt = await appointment(remote, remoteDoctorId, rp);
        const pending = await notification(local, p, appt);
        const sent = await notification(local, p, appt, "simulated", "2091-06-04T09:00:00Z", 2);
        const other = await notification(remote, rp, remoteAppt);
        const state = async () => (await admin.query(`SELECT id,status,sent_at,cancelled_at,cancellation_reason
          FROM operational.notifications WHERE id=ANY($1::integer[]) ORDER BY id`, [[pending, sent, other]])).rows;
        const original = await state();
        const disabled = await request(manager, clinicPath, "PUT", { enabled: false });
        assert.equal(disabled.status, 200, JSON.stringify(disabled.data));
        assert.deepEqual(disabled.data, { enabled: false, canManage: true });
        const changed = await state();
        assert.equal(changed[0].status, "cancelled");
        assert(changed[0].cancelled_at);
        assert.equal(changed[0].cancellation_reason, "clinic_disabled");
        assert.deepEqual(changed.slice(1), original.slice(1), "sent and remote reminders are untouched");
        assert.deepEqual((await request(desk, clinicPath)).data, { enabled: false, canManage: false });
        assert.deepEqual((await request(manager, clinicPath, "PUT", { enabled: true })).data, { enabled: true, canManage: true });
        assert.deepEqual(await state(), changed, "enabling a clinic never revives old notifications");
      });
      await t.test("bounded log is clinic-local, minimal, privacy-headered and filterable with half-open time bounds", async () => {
        const p = await patient(local), appt = await appointment(local, doctorId, p);
        const first = await notification(local, p, appt, "pending", "2092-01-01T00:00:00Z", 24);
        const second = await notification(local, p, appt, "simulated", "2092-01-02T00:00:00Z", 2);
        const otherAppt = await appointment(local, doctorId, p);
        const third = await notification(local, p, otherAppt, "cancelled", "2092-01-03T00:00:00Z", 24);
        const range = "&from=2092-01-01T00:00:00Z&to=2092-01-04T00:00:00Z";
        const page = await request(manager, logPath + range + "&limit=2");
        assert.equal(page.status, 200, JSON.stringify(page.data));
        assert.equal(page.cacheControl, "private, no-store");
        assert.deepEqual(Object.keys(page.data).sort(), ["items", "nextCursor"]);
        assert.deepEqual(page.data.items.map((r: { id: number }) => r.id), [third, second]);
        assert.equal(page.data.nextCursor, second);
        const next = await request(desk, `${logPath}${range}&limit=2&cursor=${page.data.nextCursor}`);
        assert.deepEqual(next.data.items.map((r: { id: number }) => r.id), [first]);
        assert.equal(next.data.nextCursor, null);
        for (const item of [...page.data.items, ...next.data.items]) {
          assert.deepEqual(Object.keys(item).sort(), [
            "id", "status", "textAr", "textEn", "scheduledAt", "sentAt", "cancelledAt", "cancellationReason",
          ].sort());
          assert.equal(item.textAr, "تذكير بموعدك في العيادة");
          assert.equal(item.textEn, "Reminder: your clinic appointment");
          assert(Number.isFinite(Date.parse(item.scheduledAt)));
        }
        for (const secret of [sentinel, `PATIENT-SECRET-${marker}`, `PHONE-SECRET-${marker}`]) assert(!page.text.includes(secret));
        for (const key of ["patientId", "patient_id", "doctorId", "appointmentId", "receipt", "diagnosis_notes"]) assert(!page.text.includes(`"${key}"`));
        for (const [status, id] of [["scheduled", first], ["sent", second], ["cancelled", third]] as const) {
          const filtered = await request(desk, `${logPath}${range}&status=${status}`);
          assert.equal(filtered.status, 200);
          assert.deepEqual(filtered.data.items.map((r: { id: number }) => r.id), [id]);
          assert.equal(filtered.data.items[0].status, status);
          assert.equal(filtered.data.nextCursor, null);
        }
        const halfOpen = await request(desk, `${logPath}&from=2092-01-01T00:00:00Z&to=2092-01-03T00:00:00Z`);
        assert.deepEqual(halfOpen.data.items.map((r: { id: number }) => r.id), [second, first]);
        const remoteLog = await request(remoteDesk, `/reminders/log?clinicId=${remote}${range}`);
        assert.deepEqual(remoteLog.data, { items: [], nextCursor: null });
        const error = await request(desk, `${logPath}&patientId=${own}`);
        assert.match(error.cacheControl ?? "", /(?:^|, )no-store(?:,|$)/);
      });
      await t.test("default and maximum page sizes bound results; legacy notifications do not enter the reminder log", async () => {
        const p = await patient(local);
        const ids: number[] = [];
        for (let i = 0; i < 27; i++) {
          const appt = await appointment(local, doctorId, p);
          ids.push(await notification(local, p, appt, "pending", "2093-01-01T00:00:00Z"));
        }
        await admin.query(`INSERT INTO operational.notifications
          (clinic_id,patient_id,message_key,status,scheduled_at)
          VALUES($1,$2,'legacy.notice','pending','2093-01-01T00:00:00Z')`, [local, p]);
        const path = `${logPath}&from=2093-01-01T00:00:00Z&to=2093-01-02T00:00:00Z`;
        const page = await request(desk, path);
        assert.equal(page.status, 200);
        assert.equal(page.data.items.length, 25);
        assert.deepEqual(page.data.items.map((r: { id: number }) => r.id), ids.slice().reverse().slice(0, 25));
        const next = await request(desk, `${path}&cursor=${page.data.nextCursor}`);
        assert.deepEqual(next.data.items.map((r: { id: number }) => r.id), ids.slice(0, 2).reverse());
        assert.equal(next.data.nextCursor, null);
        const max = await request(manager, `${path}&limit=100`);
        assert.equal(max.status, 200);
        assert.equal(max.data.items.length, 27);
        assert.equal(max.data.nextCursor, null);
      });
      await t.test("generated response contracts reject identifiers, clinical fields and raw internal statuses", async () => {
        const { ListReminderLogResponse, GetReminderClinicPreferenceResponse, GetReminderPatientPreferenceResponse } = await import("@workspace/api-zod");
        const response = await request(desk, logPath + "&limit=1");
        assert(ListReminderLogResponse.safeParse(response.data).success);
        const item = response.data.items[0];
        for (const extra of [{ patientId: own }, { appointmentId: 1 }, { diagnosis: sentinel }, { receipt: sentinel }]) {
          assert.equal(ListReminderLogResponse.safeParse({ items: [{ ...item, ...extra }], nextCursor: null }).success, false);
        }
        for (const status of ["pending", "simulated", "delivered"]) {
          assert.equal(ListReminderLogResponse.safeParse({ items: [{ ...item, status }], nextCursor: null }).success, false);
        }
        assert(GetReminderClinicPreferenceResponse.safeParse({ enabled: true, canManage: true }).success);
        assert.equal(GetReminderClinicPreferenceResponse.safeParse({ enabled: true }).success, false);
        assert.equal(GetReminderClinicPreferenceResponse.safeParse({ enabled: true, canManage: true, clinicId: local }).success, false);
        assert.equal(GetReminderPatientPreferenceResponse.safeParse({ optedOut: true, patientId: own }).success, false);
      });
      await t.test("notification persistence enforces reminder identity and terminal-state shape", async () => {
        const p = await patient(local), appt = await appointment(local, doctorId, p);
        const id = await notification(local, p, appt);
        await assert.rejects(notification(local, p, appt), (error: { code?: string }) => error.code === "23505",
          "same appointment, schedule version and offset cannot be queued twice");
        for (const sql of [
          "UPDATE operational.notifications SET status='simulated',sent_at=now() WHERE id=$1",
          "UPDATE operational.notifications SET status='cancelled' WHERE id=$1",
          "UPDATE operational.notifications SET offset_hours=3 WHERE id=$1",
          "UPDATE operational.notifications SET schedule_version=0 WHERE id=$1",
        ]) {
          await assert.rejects(admin.query(sql, [id]), (error: { code?: string }) => error.code === "23514");
        }
        assert.equal((await admin.query("SELECT status FROM operational.notifications WHERE id=$1", [id])).rows[0].status, "pending");
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      assert.equal(await seedFingerprint(admin), before, "All six cloned seed tables and protections remain unchanged");
      // Helper stops/removes the private cluster, including all fixtures, sessions,
      // append-only audits and notifications. No cleanup role or source writes.
    }
  });
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Request, Response } from "express";
import { withIsolatedAuthDatabase } from "./helpers/auth-isolated";

test("calendar settings use the existing freshly authorized clinic directory read, never admin access or another clinic", { timeout: 180_000 }, async () => {
  await withIsolatedAuthDatabase(async admin => {
    const { default: router } = await import("../src/routes/directory");
    const auth = await import("../src/lib/auth");
    const { seedFingerprint } = await import("../../../scripts/src/operational-support");
    const seedBefore = await seedFingerprint(admin);
    const clinics = (await admin.query("SELECT clinic_id,open_time,close_time,working_days,slot_minutes FROM operational.clinics ORDER BY clinic_id LIMIT 2")).rows;
    assert.equal(clinics.length, 2);
    const [clinic, other] = clinics;
    // All test-only writes target the helper's disposable clone. No clinic,
    // appointment, seed, or scheduling setting is mutated even in the clone.
    const credential = randomUUID();
    const { rows: [device] } = await admin.query("INSERT INTO operational.devices(clinic_id,label) VALUES($1,'calendarHoursTest') RETURNING id", [clinic.clinic_id]);
    await admin.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [device.id, auth.digest(credential)]);
    const { rows: [user] } = await admin.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id)
      VALUES($1,'unused','receptionist',$2) RETURNING id`, [`${randomUUID()}@calendar-hours.test`, clinic.clinic_id]);
    const request = (session?: string, query: Record<string, string> = {}) => ({
      originalUrl: "/api/clinics", method: "GET", query,
      cookies: { amal_session: session, amal_device: credential },
    } as unknown as Request);
    const login = request();
    await auth.createSession(login, { cookie() {} } as unknown as Response, user.id, device.id, true);
    const endpoint = router.stack.find(layer => layer.route?.path === "/clinics")!.route!;
    const read = async (req: Request) => {
      let body: any;
      for (const layer of endpoint.stack) {
        let failure: unknown;
        await layer.handle(req, { json(result: unknown) { body = result; } } as Response,
          (error?: unknown) => { failure = error; });
        if (failure) throw failure;
      }
      return body;
    };
    const session = login.cookies.amal_session;
    const result = await read(request(session));
    assert.deepEqual(result.items.map((c: any) => c.id), [clinic.clinic_id]);
    assert.deepEqual(result.items[0].scheduling, { openTime: clinic.open_time, closeTime: clinic.close_time,
      workingDays: clinic.working_days, slotMinutes: clinic.slot_minutes });
    assert.equal(result.items[0].adoption.capabilities.canManage, false, 'front desk gains no settings-management rights');
    const denied = (status: number) => (error: any) => error.status === status;
    await assert.rejects(read(request()), denied(401));
    await assert.rejects(read(request(session, { clinicId: String(other.clinic_id) })), /unrecognized|Unrecognized/);
    const forgedCursor = Buffer.from(JSON.stringify({ scope: `clinics:${user.id}:${other.clinic_id}`, after: 1 })).toString("base64url");
    await assert.rejects(read(request(session, { cursor: forgedCursor })), denied(400));
    await admin.query("UPDATE operational.users SET clinic_id=$2 WHERE id=$1", [user.id, other.clinic_id]);
    await assert.rejects(read(request(session)), denied(401));
    await admin.query("UPDATE operational.users SET clinic_id=$2 WHERE id=$1", [user.id, clinic.clinic_id]);
    await admin.query("UPDATE operational.auth_sessions SET absolute_expires_at=clock_timestamp()-interval '1 second' WHERE token_digest=$1", [auth.digest(session)]);
    await assert.rejects(read(request(session)), denied(401));
    assert.equal(await seedFingerprint(admin), seedBefore, 'cloned source seed tables are unchanged');
  });
});

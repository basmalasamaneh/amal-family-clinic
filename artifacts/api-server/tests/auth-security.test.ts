import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Request, Response, RequestHandler } from "express";
import { withIsolatedAuthDatabase } from "./helpers/auth-isolated";

// Reuse developer-reset.test's disposable-cluster pattern, but never run a
// migration or reset. The source is read ONLY by pg_dump; all mutations below
// target the private Unix socket. No HTTP server/workflow is started.
test("isolated session/PIN security policies", { timeout: 180_000 }, async t => {
  await withIsolatedAuthDatabase(async (admin, pool) => {
    const auth = await import("../src/lib/auth");
    const { seedFingerprint } = await import("../../../scripts/src/operational-support");
    const seedBefore = await seedFingerprint(admin);
    assert.equal((await pool.query("SELECT current_user u")).rows[0].u, "amal_app");
    const clinicId = (await pool.query("SELECT clinic_id FROM operational.clinics ORDER BY clinic_id LIMIT 1")).rows[0]?.clinic_id;
    assert(clinicId, "Requires prerequisite operational clinic");
    const pinHash = await bcrypt.hash("0123", 4);
    const users: Record<string, number> = {};
    for (const role of ["administrator", "doctor", "receptionist"]) {
      if (role === "doctor") {
        users[role] = (await pool.query("SELECT id FROM operational.users WHERE role='doctor' AND disabled_at IS NULL ORDER BY id LIMIT 1")).rows[0]?.id;
        assert(users[role], "Requires existing prerequisite doctor with valid linkage");
        continue;
      }
      const { rows: [u] } = await admin.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id,pin_hash)
        VALUES($1,'unused',$2,$3,$4) RETURNING id`,
      [`${randomUUID()}@auth-security.test`, role, role === "administrator" ? null : clinicId, role === "receptionist" ? pinHash : null]);
      users[role] = u.id;
    }
    const deviceCredentials: string[] = [];
    const deviceIds: number[] = [];
    for (let i = 0; i < 2; i++) {
      const credential = randomUUID();
      const { rows: [d] } = await admin.query("INSERT INTO operational.devices(clinic_id,label) VALUES($1,'authSecurity') RETURNING id", [clinicId]);
      await admin.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [d.id, auth.digest(credential)]);
      deviceCredentials.push(credential); deviceIds.push(d.id);
    }
    const request = (credential?: string, device = deviceCredentials[0]) => ({
      originalUrl: "/api/me", method: "GET",
      cookies: { amal_session: credential, amal_device: device },
    } as unknown as Request);
    async function invoke(handler: RequestHandler, req: Request) {
      let error: any;
      await handler(req, {} as Response, e => { error = e; });
      return error;
    }
    async function session(role: string, expiry?: Date) {
      const req = request();
      await auth.createSession(req, { cookie() {} } as unknown as Response, users[role]!,
        role === "receptionist" ? deviceIds[0]! : null, role === "receptionist", expiry);
      assert.equal(await invoke(auth.authenticate, req), undefined);
      return req;
    }
    const restart = async (input: unknown) => {
      const child = spawn(process.execPath, ["--import", "tsx", new URL("./restart-probe.ts", import.meta.url).pathname],
        { stdio: ["pipe", "pipe", "pipe"] });
      let output = "", stderr = "";
      child.stdout.on("data", c => { output += c; });
      child.stderr.on("data", c => { stderr += c; });
      child.stdin.end(JSON.stringify(input));
      const [code] = await once(child, "close");
      assert.equal(code, 0, stderr);
      return JSON.parse(output);
    };
    const status = (code: string) => (e: any) => e.code === code;

    await t.test("doctor/admin just-inside idle, exact boundary, concurrent denial and restart", async () => {
      for (const role of ["doctor", "administrator"]) {
        const req = await session(role);
        const tokenDigest = req.auth!.sessionDigest;
        await admin!.query("UPDATE operational.auth_sessions SET last_seen_at=clock_timestamp()-interval '29 minutes 59 seconds' WHERE token_digest=$1", [tokenDigest]);
        assert.equal(await invoke(auth.authenticateReadOnly, request(req.cookies.amal_session)), undefined);
        // Same PostgreSQL transaction clock on both statements makes the exact
        // boundary deterministic, not a scheduling-dependent sleep.
        const client = await pool.connect();
        await client.query("BEGIN");
        await client.query("UPDATE operational.auth_sessions SET last_seen_at=now()-interval '30 minutes' WHERE token_digest=$1", [tokenDigest]);
        const boundary = await client.query(`SELECT last_seen_at>now()-interval '30 minutes' AS valid
          FROM operational.auth_sessions WHERE token_digest=$1`, [tokenDigest]);
        assert.equal(boundary.rows[0].valid, false);
        await client.query("COMMIT"); client.release();
        const errors = await Promise.all(Array.from({ length: 8 }, () => invoke(auth.authenticate, request(req.cookies.amal_session))));
        assert(errors.every(e => e?.status === 401));
        assert.deepEqual(await restart({ kind: "session", session: req.cookies.amal_session }), { status: 401 });
        const stored = (await pool.query("SELECT last_seen_at FROM operational.auth_sessions WHERE token_digest=$1", [tokenDigest])).rows[0];
        assert(stored.last_seen_at.getTime() <= Date.now() - 1_800_000, "Denied concurrent requests must not revive expiry");
      }
    });
    await t.test("authenticated activity refreshes idle and read-only verification never refreshes", async () => {
      const req = await session("doctor");
      await admin!.query("UPDATE operational.auth_sessions SET last_seen_at=now()-interval '29 minutes' WHERE token_digest=$1", [req.auth!.sessionDigest]);
      const before = (await pool.query("SELECT last_seen_at FROM operational.auth_sessions WHERE token_digest=$1", [req.auth!.sessionDigest])).rows[0].last_seen_at;
      assert.equal(await invoke(auth.authenticateReadOnly, req), undefined);
      assert.equal((await pool.query("SELECT last_seen_at FROM operational.auth_sessions WHERE token_digest=$1", [req.auth!.sessionDigest])).rows[0].last_seen_at.getTime(), before.getTime());
      assert.equal(await invoke(auth.authenticate, req), undefined);
      assert(req.auth!.expiresAt.getTime() > Date.now() + 1_790_000);
      assert.deepEqual(await restart({ kind: "session", session: req.cookies.amal_session }), { id: users.doctor });
    });
    await t.test("reception 8h absolute, concurrent activity cannot extend and restart denies expired cookies", async () => {
      const req = await session("receptionist");
      const deadline = req.auth!.absoluteExpiresAt!;
      assert(Math.abs(deadline.getTime() - Date.now() - 28_800_000) < 3000);
      await admin!.query("UPDATE operational.auth_sessions SET last_seen_at=now()-interval '7 hours' WHERE token_digest=$1", [req.auth!.sessionDigest]);
      const active = await Promise.all(Array.from({ length: 8 }, () => invoke(auth.authenticate, request(req.cookies.amal_session))));
      assert(active.every(e => e === undefined));
      assert.equal((await pool.query("SELECT absolute_expires_at FROM operational.auth_sessions WHERE token_digest=$1", [req.auth!.sessionDigest])).rows[0].absolute_expires_at.getTime(), deadline.getTime());
      await admin!.query("UPDATE operational.auth_sessions SET absolute_expires_at=clock_timestamp() WHERE token_digest=$1", [req.auth!.sessionDigest]);
      assert.equal((await invoke(auth.authenticate, request(req.cookies.amal_session)))?.status, 401);
      assert.deepEqual(await restart({ kind: "session", session: req.cookies.amal_session, device: req.cookies.amal_device }), { status: 401 });
    });
    await t.test("rotation revokes stale cookies and preserves reception absolute expiry", async () => {
      const req = await session("receptionist");
      const old = req.cookies.amal_session, expiry = req.auth!.absoluteExpiresAt!;
      await auth.createSession(req, { cookie() {} } as unknown as Response, users.receptionist!, deviceIds[0]!, true, expiry);
      assert.notEqual(req.cookies.amal_session, old);
      assert.equal(await invoke(auth.authenticate, req), undefined);
      assert.equal(req.auth!.absoluteExpiresAt!.getTime(), expiry.getTime());
      assert.equal((await invoke(auth.authenticate, request(old)))?.status, 401);
      await pool.query("UPDATE operational.auth_sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1", [req.auth!.sessionDigest]);
      assert.equal((await invoke(auth.authenticate, request(req.cookies.amal_session)))?.status, 401);
      await assert.rejects(auth.createSession(req, { cookie() {} } as unknown as Response, users.receptionist!, deviceIds[0]!, true, expiry), status("UNAUTHORIZED"));
    });
    await t.test("concurrent reauthentication of one session has one winner; logout cannot be raced into revival", async () => {
      const req = await session("receptionist");
      const attempts = await Promise.all(Array.from({ length: 4 }, async () => {
        const copy = request(req.cookies.amal_session);
        copy.auth = { ...req.auth! };
        try {
          await auth.createSession(copy, { cookie() {} } as unknown as Response, users.receptionist!, deviceIds[0]!, true, req.auth!.absoluteExpiresAt);
          return 200;
        } catch (e: any) { return e.status; }
      }));
      assert.equal(attempts.filter(s => s === 200).length, 1);
      assert.equal(attempts.filter(s => s === 401).length, 3);
      const active = await session("receptionist");
      const locker = await pool.connect();
      await locker.query("BEGIN");
      await locker.query("SELECT 1 FROM operational.auth_sessions WHERE token_digest=$1 FOR UPDATE", [active.auth!.sessionDigest]);
      try {
        const pending = auth.createSession(active, { cookie() {} } as unknown as Response, users.receptionist!, deviceIds[0]!, true, active.auth!.absoluteExpiresAt)
          .then(() => 200, (e: any) => e.status);
        await new Promise(resolve => setTimeout(resolve, 100));
        // This is precisely the logout handler's durable revocation write.
        await locker.query("UPDATE operational.auth_sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1", [active.auth!.sessionDigest]);
        await locker.query("COMMIT");
        assert.equal(await pending, 401);
        assert.deepEqual(await restart({ kind: "session", session: active.cookies.amal_session, device: active.cookies.amal_device }), { status: 401 });
      } finally { await locker.query("ROLLBACK"); locker.release(); }
    });
    await t.test("expiry occurring after authenticate cannot be revived by session rotation", async () => {
      const req = await session("receptionist");
      await pool.query("UPDATE operational.auth_sessions SET absolute_expires_at=clock_timestamp() WHERE token_digest=$1", [req.auth!.sessionDigest]);
      await assert.rejects(auth.createSession(req, { cookie() {} } as unknown as Response, users.receptionist!, deviceIds[0]!, true, req.auth!.absoluteExpiresAt), status("UNAUTHORIZED"));
    });
    await t.test("queued idle requests evaluate expiry after acquiring the session row lock", async () => {
      const req = await session("doctor");
      await pool.query("UPDATE operational.auth_sessions SET last_seen_at=clock_timestamp()-interval '30 minutes'+interval '200 milliseconds' WHERE token_digest=$1", [req.auth!.sessionDigest]);
      const locker = await pool.connect();
      await locker.query("BEGIN");
      await locker.query("SELECT 1 FROM operational.auth_sessions WHERE token_digest=$1 FOR UPDATE", [req.auth!.sessionDigest]);
      try {
        const pending = invoke(auth.authenticate, request(req.cookies.amal_session));
        await new Promise(resolve => setTimeout(resolve, 400));
        await locker.query("COMMIT");
        assert.equal((await pending)?.status, 401);
      } finally { await locker.query("ROLLBACK"); locker.release(); }
    });
    await t.test("sensitive PIN freshness exact five-minute boundary, missing device and leading zero", async () => {
      const version = await auth.verifyPin(users.receptionist!, "0123");
      assert(Number.isInteger(version));
      const req = await session("receptionist");
      assert.equal(await invoke(auth.requireFreshPin, req), undefined);
      const now = Date.now;
      const instant = req.auth!.pinVerifiedAt!.getTime();
      try {
        Date.now = () => instant + 299_999;
        assert.equal(await invoke(auth.requireFreshPin, req), undefined);
        Date.now = () => instant + 300_000;
        assert.equal((await invoke(auth.requireFreshPin, req))?.code, "REAUTH_REQUIRED");
      } finally { Date.now = now; }
      req.auth!.device = null;
      assert.equal((await invoke(auth.requireFreshPin, req))?.code, "REAUTH_REQUIRED");
      assert.equal((await invoke(auth.requireFreshPin, request()))?.status, 401);
    });
    await t.test("atomic fifth PIN failure, 15m account lock, selector/device/IP changes and restart", async () => {
      await pool.query("DELETE FROM operational.auth_pin_state WHERE user_id=$1", [users.receptionist]);
      const outcomes = await Promise.all(Array.from({ length: 12 }, async () => {
        try { await auth.verifyPin(users.receptionist!, "9999"); return "success"; }
        catch (e: any) { return e.code; }
      }));
      assert.equal(outcomes.filter(v => v === "UNAUTHORIZED").length, 4);
      assert.equal(outcomes.filter(v => v === "PIN_LOCKED").length, 8);
      const locked = (await pool.query("SELECT *,extract(epoch FROM locked_until-clock_timestamp()) AS remaining FROM operational.auth_pin_state WHERE user_id=$1", [users.receptionist])).rows[0];
      assert.equal(locked.failures, 5);
      assert(Number(locked.remaining) > 890 && Number(locked.remaining) <= 900);
      for (const device of deviceCredentials) {
        assert((await auth.trustedDevice(request(undefined, device))).id);
        await assert.rejects(auth.verifyPin(users.receptionist!, "0123"), status("PIN_LOCKED"));
      }
      // Account identity is the durable user ID, not a caller-selected email/IP.
      await admin!.query("UPDATE operational.users SET email=$2 WHERE id=$1", [users.receptionist, `${randomUUID()}@auth-security.test`]);
      await assert.rejects(auth.verifyPin(users.receptionist!, "0123"), status("PIN_LOCKED"));
      assert.deepEqual(await restart({ kind: "pin", userId: users.receptionist, pin: "0123" }), { status: 423 });
      const unchanged = (await pool.query("SELECT failures,locked_until FROM operational.auth_pin_state WHERE user_id=$1", [users.receptionist])).rows[0];
      assert.equal(unchanged.failures, 5);
      assert.equal(unchanged.locked_until.getTime(), locked.locked_until.getTime(), "Locked requests neither reset nor extend lock");
      await pool.query("UPDATE operational.auth_pin_state SET locked_until=clock_timestamp()-interval '1 second' WHERE user_id=$1", [users.receptionist]);
      await auth.verifyPin(users.receptionist!, "0123");
      assert.deepEqual((await pool.query("SELECT failures,locked_until FROM operational.auth_pin_state WHERE user_id=$1", [users.receptionist])).rows[0], { failures: 0, locked_until: null });
    });
    await t.test("queued PIN recovery evaluates lock expiry after acquiring the PIN row lock", async () => {
      await pool.query("UPDATE operational.auth_pin_state SET failures=5,locked_until=clock_timestamp()+interval '200 milliseconds' WHERE user_id=$1", [users.receptionist]);
      const locker = await pool.connect();
      await locker.query("BEGIN");
      await locker.query("SELECT 1 FROM operational.auth_pin_state WHERE user_id=$1 FOR UPDATE", [users.receptionist]);
      try {
        const pending = auth.verifyPin(users.receptionist!, "0123").then(() => 200, (e: any) => e.status);
        await new Promise(resolve => setTimeout(resolve, 400));
        await locker.query("COMMIT");
        assert.equal(await pending, 200);
      } finally { await locker.query("ROLLBACK"); locker.release(); }
    });
    await t.test("credential recovery preserves active PIN lock and resets only expired counters", async () => {
      await pool.query("UPDATE operational.auth_pin_state SET failures=5,locked_until=clock_timestamp()+interval '15 minutes' WHERE user_id=$1", [users.receptionist]);
      const before = (await pool.query("SELECT failures,locked_until FROM operational.auth_pin_state WHERE user_id=$1", [users.receptionist])).rows[0];
      const recovery = await pool.connect();
      try {
        await recovery.query("BEGIN");
        await recovery.query("SELECT id FROM operational.users WHERE id=$1 FOR UPDATE", [users.receptionist]);
        await recovery.query("UPDATE operational.users SET pin_hash=$2 WHERE id=$1", [users.receptionist, await bcrypt.hash("0456", 4)]);
        await auth.resetPinFailures(recovery, users.receptionist!);
        await recovery.query("COMMIT");
      } finally { recovery.release(); }
      assert.deepEqual((await pool.query("SELECT failures,locked_until FROM operational.auth_pin_state WHERE user_id=$1", [users.receptionist])).rows[0], before);
      await assert.rejects(auth.verifyPin(users.receptionist!, "0456"), status("PIN_LOCKED"));
      assert.deepEqual(await restart({ kind: "pin", userId: users.receptionist, pin: "0456" }), { status: 423 });
      await pool.query("UPDATE operational.auth_pin_state SET locked_until=clock_timestamp()-interval '1 second' WHERE user_id=$1", [users.receptionist]);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM operational.users WHERE id=$1 FOR UPDATE", [users.receptionist]);
        await auth.resetPinFailures(client, users.receptionist!);
        await client.query("COMMIT");
      } finally { client.release(); }
      assert.deepEqual((await pool.query("SELECT failures,locked_until FROM operational.auth_pin_state WHERE user_id=$1", [users.receptionist])).rows[0], { failures: 0, locked_until: null });
      await auth.verifyPin(users.receptionist!, "0456");
    });
    await t.test("source-copy seeds remain unchanged and restricted writes are denied", async () => {
      assert.equal(await seedFingerprint(admin!), seedBefore);
      for (const table of ["clinics", "doctors", "patients", "appointments", "patient_visit_history", "calendar_app_export"]) {
        await assert.rejects(pool.query(`DELETE FROM public.${table} WHERE false`), /permission denied/);
      }
    });
  });
});

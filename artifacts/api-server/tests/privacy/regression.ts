import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import type { Client, Pool, PoolClient } from "pg";
import { fromZonedTime } from "date-fns-tz";

type Actor = { id: number; clinic: number; doctorId?: number; session: string; csrf: string; device?: string };
type Patient = { id: number; name: string };
type Response = { status: number; data: any; cacheControl: string | null; requestId: string | null };
type Context = {
  admin: Client; pool: Pool;
  patient(a?: Actor, name?: string): Promise<Patient>;
  actor(role: string, clinic: number): Promise<Actor>;
  clinic(mode?: string): Promise<number>;
  visit(p: Patient, a?: Actor): Promise<{ id: number; note: string }>;
  trustedDoctor(p: Patient, a?: Actor): Promise<void>;
  request(a: Actor | null, path: string, method?: string, body?: unknown): Promise<Response>;
  record(p: Patient, level?: string, a?: Actor): Promise<any>;
  input(level?: string): { level: string; evidence: string; clientOpId: string };
  actors(): { localDoctor: Actor; remoteDoctor: Actor; desk: Actor; manager: Actor };
};
const keys = (value: object, expected: string[]) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
const patientKeys = ["id", "name", "identityVerified", "effectiveConsentLevel", "visits"];
const basicKeys = ["clinicId", "doctorId", "clinicName", "doctorName", "seenAt", "visibility"];
function projection(patient: any) {
  keys(patient, patientKeys);
  assert.equal(patient.identityVerified, false);
  for (const visit of patient.visits) {
    keys(visit, [...basicKeys, ...(visit.visibility === "clinical" ? ["complaint", "keyAlerts", "alerts"] : [])]);
    assert.equal(visit.seenAt, fromZonedTime("2025-01-12T00:00:00", "Asia/Hebron").toISOString());
    if (visit.visibility === "clinical") {
      assert.equal(typeof visit.complaint, "string");
      assert(Array.isArray(visit.keyAlerts));
      for (const alert of visit.alerts) {
        keys(alert, ["kind", "labelKey", "labelParams", "label", "ruleId", "dictionaryVersion",
          "sourceNoteExcerpt", "excerptStart", "excerptEnd", "sourceVisitId", "patientId",
          "sourceClinicId", "sourceClinicName", "sourceVisitDate", "disclaimerKey", "crossClinicDisclaimerKey"]);
        assert.deepEqual(alert.labelParams, {});
        assert.equal(alert.patientId, patient.id);
        assert.equal(alert.sourceClinicId, visit.clinicId);
        assert.equal(alert.sourceNoteExcerpt, visit.complaint);
      }
    }
  }
}
function safe(response: Response) {
  assert.equal(response.status, 200);
  assert.equal(response.cacheControl, "private, no-store");
}
export function registerPrivacyRegression(c: Context) {
  const actor = async (role: string, clinic: number) => {
    await c.admin.query("BEGIN");
    try {
      const result = await c.actor(role, clinic);
      await c.admin.query("COMMIT");
      return result;
    } catch (error) { await c.admin.query("ROLLBACK"); throw error; }
  };
  test("privacy gate: role × consent × local/foreign API matrix", async t => {
    const { localDoctor, remoteDoctor, desk, manager } = c.actors();
    const foreignDesk = await actor("receptionist", remoteDoctor.clinic);
    const foreignAdmin = await actor("administrator", remoteDoctor.clinic);
    for (const level of ["missing", "none", "basic", "clinical", "withdrawn"]) {
      const p = await c.patient();
      await c.trustedDoctor(p);
      const v = await c.visit(p);
      if (level !== "missing") {
        const grant = await c.record(p, level === "withdrawn" ? "clinical" : level);
        if (level === "withdrawn") assert.equal((await c.request(desk, `/consent/${grant.id}/withdraw`, "POST",
          { clientOpId: randomUUID() })).status, 200);
      }
      for (const [role, a] of [["front-desk", desk], ["admin", manager], ["doctor", localDoctor]] as const) {
        await t.test(`${role}/${level}/local`, async () => {
          const demographics = await c.request(a, `/patients/${p.id}`);
          assert.equal(demographics.status, role === "admin" ? 403 : 200);
          if (demographics.status === 200) keys(demographics.data, ["id", "name", "phone", "dateOfBirth", "clinicId", "visibility"]);
          assert(!JSON.stringify(demographics.data).includes(v.note));
          for (const path of [`/doctor/patients/${p.id}`, "/doctor/day", `/network/lookup?q=${encodeURIComponent(p.name)}`, `/audit?patientId=${p.id}`]) {
            const r = await c.request(a, path);
            assert.equal(r.status, role === "doctor" ? 200 : 403);
            if (role !== "doctor") {
              keys(r.data, ["code", "messageKey", "params"]);
              assert.deepEqual(r.data.params, {});
              assert(!JSON.stringify(r.data).includes(v.note));
            }
          }
          const consent = await c.request(a, `/patients/${p.id}/consent`);
          assert.equal(consent.status, role === "admin" ? 403 : 200);
          assert(!JSON.stringify(consent.data).includes(v.note));
          const own = await c.request(localDoctor, `/doctor/patients/${p.id}`);
          projection(own.data);
          assert.equal(own.data.visits[0].complaint, v.note);
        });
      }
      await t.test(`doctor/${level}/foreign`, async () => {
        const r = await c.request(remoteDoctor, `/network/lookup?q=${encodeURIComponent(p.name)}&limit=1`);
        safe(r);
        keys(r.data, ["items", "nextCursor"]);
        assert.equal(r.data.nextCursor, null);
        if (["missing", "none", "withdrawn"].includes(level)) {
          assert.deepEqual(r.data, { items: [], nextCursor: null });
          assert(!JSON.stringify(r.data).includes(String(p.id)));
        } else {
          assert.equal(r.data.items.length, 1);
          projection(r.data.items[0]);
          assert.equal(r.data.items[0].visits[0].visibility, level);
          assert.equal(JSON.stringify(r.data).includes(v.note), level === "clinical");
        }
        for (const path of [`/patients/${p.id}`, `/patients/${p.id}/consent`, `/doctor/patients/${p.id}`]) {
          const denied = await c.request(remoteDoctor, path);
          assert.equal(denied.status, 404);
          keys(denied.data, ["code", "messageKey", "params"]);
        }
        for (const forged of [`clinicId=${localDoctor.clinic}`, `patientId=${p.id}`, `doctorId=${localDoctor.doctorId}`]) {
          assert.equal((await c.request(remoteDoctor, `/network/lookup?q=${encodeURIComponent(p.name)}&${forged}`)).status, 400);
        }
      });
      for (const [role, a] of [["front-desk", foreignDesk], ["admin", foreignAdmin]] as const) {
        await t.test(`${role}/${level}/foreign`, async () => {
          for (const path of [`/patients/${p.id}`, `/patients/${p.id}/consent`, `/doctor/patients/${p.id}`,
            `/network/lookup?q=${encodeURIComponent(p.name)}`, `/audit?patientId=${p.id}`]) {
            const r = await c.request(a, path);
            assert.equal(r.status, role === "front-desk" && path.startsWith("/patients/") ? 404 : 403);
            keys(r.data, ["code", "messageKey", "params"]);
            assert.deepEqual(r.data.params, {});
            assert(!JSON.stringify(r.data).includes(v.note));
          }
        });
      }
    }
  });

  test("privacy gate: runtime cannot escape its login or mutate any seed table", async () => {
    const client = await c.pool.connect();
    try {
      await client.query("RESET ROLE");
      assert.deepEqual((await client.query("SELECT current_user,session_user")).rows,
        [{ current_user: "amal_app", session_user: "amal_app" }]);
      for (const table of ["clinics", "doctors", "patients", "appointments", "patient_visit_history", "calendar_app_export"]) {
        assert.equal((await client.query("SELECT has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') AS writable",
          [`public.${table}`])).rows[0].writable, false);
      }
      for (const role of ["privacy_fixture", "amal_seed_owner", "amal_demo_reset"]) {
        await assert.rejects(client.query(`SET ROLE ${role}`), (error: { code?: string }) => error.code === "42501");
      }
    } finally { client.release(); }
  });

  test("privacy gate: every cross-clinic path audits every source and immediately revalidates across processes", async t => {
    const source = await c.clinic(), source2 = await c.clinic(), requesting = await c.clinic();
    const doctor = await actor("doctor", requesting);
    const sourceDoctor = await actor("doctor", source), secondDoctor = await actor("doctor", source2);
    const staff = await actor("receptionist", source);
    const name = `Privacy synthetic / اصطناعي ${randomUUID()}`;
    const patients = [await c.patient(staff, name), await c.patient(staff, name)];
    const sources: { patient: number; visit: number; clinic: number; note: string }[] = [];
    const localNotes: string[] = [];
    const { dayInterval } = await import("../../src/doctor/service");
    const { start } = dayInterval();
    for (const [i, p] of patients.entries()) {
      await c.trustedDoctor(p, doctor);
      localNotes.push((await c.visit(p, doctor)).note);
      for (const a of [sourceDoctor, secondDoctor]) {
        const v = await c.visit(p, a);
        sources.push({ patient: p.id, visit: v.id, clinic: a.clinic, note: v.note });
      }
      await c.admin.query(`INSERT INTO operational.appointments(clinic_id,doctor_id,patient_id,scheduled_at,booking_method,status)
        VALUES($1,$2,$3,$4,'phone','booked')`, [requesting, doctor.doctorId, p.id, new Date(start.getTime() + i * 3600000)]);
      await c.record(p, "basic", staff); // Earlier grant must never be resurrected.
      await c.record(p, "clinical", staff);
    }
    const child = fork(new URL("./instance.ts", import.meta.url), [], { execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const port = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(new Error("Second API instance did not start")); }, 15000);
      child.once("message", (message: any) => { clearTimeout(timeout); resolve(message.port); });
      child.once("exit", () => { clearTimeout(timeout); reject(new Error("Second API instance exited before readiness")); });
    });
    const read = async (path: string): Promise<Response> => {
      const r = await fetch(`http://127.0.0.1:${port}/api${path}`, { headers: {
        origin: process.env.AUTH_ALLOWED_ORIGINS!, cookie: `amal_session=${doctor.session}`,
      } });
      return { status: r.status, data: await r.json(), cacheControl: r.headers.get("cache-control"), requestId: r.headers.get("x-request-id") };
    };
    const lookup = `/network/lookup?q=${encodeURIComponent(name)}`;
    const paths = [lookup, `${lookup}&limit=1`, "/doctor/day", "/doctor/day?limit=1",
      ...patients.map(p => `/doctor/patients/${p.id}`)];
    const lastAudit = async () => (await c.admin.query("SELECT COALESCE(max(id),0) AS id FROM operational.audit_log")).rows[0].id;
    const audits: any[] = [];
    try {
      for (const path of [...paths]) {
        const r = await read(path);
        if (r.data.nextCursor) paths.push(`${path}&cursor=${encodeURIComponent(r.data.nextCursor)}`);
      }
      for (const path of paths) {
        await t.test(`durable repeated disclosure ${path.split("?")[0]}`, async () => {
          for (let repeat = 0; repeat < 2; repeat++) {
            const after = await lastAudit();
            const r = await read(path);
            safe(r);
            const visible = path.startsWith("/doctor/patients/") ? [r.data]
              : path.startsWith("/doctor/day") ? r.data.items.map((a: any) => {
                keys(a, ["id", "startsAt", "status", "patient"]);
                assert.match(a.startsAt, /Z$/);
                return a.patient;
              }) : r.data.items;
            if (!path.startsWith("/doctor/patients/")) keys(r.data, path.startsWith("/doctor/day") ? ["day", "items", "nextCursor"] : ["items", "nextCursor"]);
            visible.forEach(projection);
            const expected = sources.filter(s => visible.some((p: any) => p.id === s.patient));
            const rows = (await c.admin.query("SELECT * FROM operational.audit_log WHERE id>$1 AND user_id=$2 ORDER BY id", [after, doctor.id])).rows;
            assert.equal(rows.length, expected.length);
            assert.deepEqual(rows.map(row => row.detail.sourceVisitId).sort(), expected.map(s => s.visit).sort());
            assert.equal(new Set(rows.map(row => row.detail.correlationId)).size, 1);
            for (const row of rows) {
              keys(row.detail, ["correlationId", "outcome", "sourceClinicId", "sourceVisitId", "effectiveLevel", "projection"]);
              assert.equal(row.user_id, doctor.id);
              assert.equal(row.clinic_id, requesting);
              assert.equal(row.action, "network.lookup");
              assert.equal(row.detail.projection, "clinical");
              assert.equal(row.detail.effectiveLevel, "clinical");
              assert.equal(row.detail.outcome, "disclosed");
              assert.match(row.detail.correlationId, /^[0-9a-f-]{36}$/);
              if (r.requestId) assert.equal(row.detail.correlationId, r.requestId);
              assert(row.at instanceof Date && Number.isFinite(row.at.getTime()));
              assert(expected.some(s => s.patient === row.patient_id && s.visit === row.detail.sourceVisitId && s.clinic === row.detail.sourceClinicId));
              for (const secret of [name, doctor.session, doctor.csrf, ...sources.map(s => s.note), ...localNotes]) {
                assert(!JSON.stringify(row).includes(secret));
              }
            }
            audits.push(...rows);
          }
        });
      }
      for (const target of ["basic", "withdrawn"]) {
        for (const p of patients) {
          const grant = await c.record(p, target === "basic" ? "basic" : "clinical", staff);
          if (target === "withdrawn") assert.equal((await c.request(staff, `/consent/${grant.id}/withdraw`, "POST",
            { clientOpId: randomUUID() })).status, 200);
        }
        // Identical sessions, paths and old cursors. No sleep, fresh login or cache bust.
        for (const path of paths) {
          const r = await read(path);
          safe(r);
          const serialized = JSON.stringify(r.data);
          for (const source of sources) assert(!serialized.includes(source.note));
          const visible = path.startsWith("/doctor/patients/") ? [r.data]
            : path.startsWith("/doctor/day") ? r.data.items.map((a: any) => a.patient) : r.data.items;
          for (const p of visible) {
            projection(p);
            assert.equal(p.effectiveConsentLevel, target === "withdrawn" ? "none" : "basic");
            assert.equal(p.visits.filter((v: any) => v.clinicId !== requesting).length, target === "withdrawn" ? 0 : 2);
            assert(p.visits.some((v: any) => localNotes.includes(v.complaint)));
          }
        }
      }
      assert.deepEqual((await c.admin.query("SELECT * FROM operational.audit_log WHERE id=ANY($1::integer[]) ORDER BY id",
        [audits.map(a => a.id)])).rows, audits);
    } finally {
      const exited = once(child, "exit");
      child.send("stop");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(timeout);
    }
  });

  test("privacy gate: audit storage rejection fails closed on detail and paginated day", async () => {
    const { remoteDoctor } = c.actors();
    const clinic = await c.clinic();
    const localDoctor = await actor("doctor", clinic), desk = await actor("receptionist", clinic);
    const p = await c.patient(desk);
    await c.trustedDoctor(p, localDoctor);
    await c.visit(p, remoteDoctor);
    await c.record(p, "clinical", desk);
    const { start } = (await import("../../src/doctor/service")).dayInterval();
    await c.admin.query(`INSERT INTO operational.appointments(clinic_id,doctor_id,patient_id,scheduled_at,booking_method,status)
      VALUES($1,$2,$3,$4,'phone','booked')`, [localDoctor.clinic, localDoctor.doctorId, p.id, start]);
    const originals = new Map<PoolClient, PoolClient["query"]>();
    let rejected = 0;
    const inject = (client: PoolClient) => {
      if (originals.has(client)) return;
      const original = client.query;
      originals.set(client, original);
      client.query = function (this: PoolClient, ...args: any[]) {
        if (typeof args[0] === "string" && args[0].includes("INSERT INTO operational.audit_log(")
          && args[1]?.[0] === localDoctor.id && args[1]?.[2] === "network.lookup") {
          args[1] = [...args[1]]; args[1][2] = null; rejected++;
        }
        return Reflect.apply(original, this, args);
      } as PoolClient["query"];
    };
    c.pool.on("acquire", inject);
    try {
      for (const path of [`/doctor/patients/${p.id}`, "/doctor/day?limit=1"]) {
        const r = await c.request(localDoctor, path);
        assert.equal(r.status, 500);
        assert.deepEqual(r.data, { code: "INTERNAL", messageKey: "error.internal", params: {} });
      }
      assert.equal(rejected, 2);
    } finally {
      c.pool.removeListener("acquire", inject);
      for (const [client, query] of originals) client.query = query;
    }
    assert.equal((await c.request(desk, `/patients/${p.id}`)).status, 200);
  });
}

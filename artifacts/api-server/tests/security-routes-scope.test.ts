import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { pool } from "@workspace/db";
import type { Auth } from "../src/lib/auth";
import { ApiError } from "../src/lib/auth-errors";
import kpisRouter from "../src/routes/kpis";
import { networkHealth } from "../src/network-health/service";

// SQL-capture unit doubles: no connection to or mutation of any database.
const actor = { id: 1, role: "admin", clinicId: 17, doctorId: null,
  sessionDigest: "unit-only", device: null } as unknown as Auth;
test("clinic-limited KPI admin cannot select another clinic or silently default to network scope", async () => {
  const endpoint = kpisRouter.stack.find(layer => layer.route?.path === "/kpis")!.route!;
  const handler = endpoint.stack.at(-1)!.handle;
  const original = pool.connect;
  const queries: { sql: string; values: unknown[] }[] = [];
  const stop = new Error("STOP_BEFORE_AGGREGATES");
  const client = {
    async query(sql: string, values: unknown[] = []) {
      queries.push({ sql, values });
      if (sql.includes("FROM operational.clinics WHERE clinic_id=$1")) throw stop;
      return { rows: [], rowCount: 0 };
    }, release() {},
  };
  pool.connect = (async () => client) as unknown as typeof pool.connect;
  try {
    await assert.rejects(handler({ auth: actor, query: { range: "day", clinicId: "18" } } as unknown as Request,
      {} as Response, () => {}), (error: unknown) => error instanceof ApiError && error.status === 403);
    assert.equal(queries.length, 0, "cross-clinic request cannot reach a business query");
    await assert.rejects(handler({ auth: actor, query: { range: "day" } } as unknown as Request,
      {} as Response, () => {}), error => error === stop);
    assert.deepEqual(queries.find(q => q.sql.includes("FROM operational.clinics WHERE clinic_id=$1"))?.values, [17]);
    assert.equal(queries[0]!.sql, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert(queries.every(q => !/\b(?:INSERT|UPDATE|DELETE)\b/.test(q.sql)));
  } finally { pool.connect = original; }
});

test("network-health clinic, device and conflict queries all bind the reauthorized clinic", async () => {
  const original = pool.connect;
  const queries: { sql: string; values: unknown[] }[] = [];
  const client = {
    async query(sql: string, values: unknown[] = []) {
      queries.push({ sql, values });
      if (sql.includes("SELECT u.role,u.clinic_id")) return { rows: [{
        role: "administrator", clinic_id: 17, doctor_id: null, device_id: null,
      }] };
      if (sql.includes("clock_timestamp() AS now")) return { rows: [{ now: new Date("2026-09-12T06:00:00Z") }] };
      return { rows: [], rowCount: 0 };
    }, release() {},
  };
  pool.connect = (async () => client) as unknown as typeof pool.connect;
  try {
    const result = await networkHealth(actor);
    assert.deepEqual(result.clinics, []);
    const scoped = queries.filter(q => q.sql.includes("ORDER BY clinic_id") ||
      q.sql.includes("ORDER BY d.id") || q.sql.includes("GROUP BY clinic_id"));
    assert.equal(scoped.length, 3);
    for (const query of scoped) {
      assert.deepEqual(query.values, [17]);
      assert.match(query.sql, /\$1::integer IS NULL OR (?:d\.)?clinic_id=\$1/);
    }
  } finally { pool.connect = original; }
});

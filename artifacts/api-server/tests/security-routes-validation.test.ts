import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Request, Response } from "express";
import { routeContracts, validateRouteInputs } from "../src/lib/route-validation";
import { ApiError } from "../src/lib/auth-errors";
import { createInput } from "../src/appointments/service";
import { pushInput, resolveInput } from "../src/sync/validation";
import { mapInput, uploadInput } from "../src/imports/validation";
import mountedRouter from "../src/routes";
import { requireFreshPin } from "../src/lib/auth";

function check(path: string, method = "GET", query: Record<string, unknown> = {},
  body?: unknown, headers: Record<string, string | string[]> = {}) {
  let error: unknown;
  const req = { path, method, query, body, headers,
    is: (type: string) => headers["content-type"]?.toString().split(";")[0] === type,
  } as unknown as Request;
  validateRouteInputs(req, {} as Response, value => { error = value; });
  return error;
}
function invalid(error: unknown) {
  assert(error instanceof ApiError);
  assert.equal(error.status, 400);
  assert.equal(error.code, "VALIDATION");
  assert.equal(error.key, "validation");
}
const booking = () => ({
  clinicId: 1, doctorId: 2, patientId: 3, clientOpId: randomUUID(), source: "phone",
  startsAt: "2026-09-12T06:00:00.000Z", endsAt: "2026-09-12T06:30:00.000Z",
});

test("the wire validation inventory covers every mounted API method/path exactly once", () => {
  const dir = new URL("../src/routes/", import.meta.url);
  const mounted = readdirSync(dir).filter(f => f.endsWith(".ts") && f !== "index.ts")
    .flatMap(file => [...readFileSync(new URL(file, dir), "utf8")
      .matchAll(/router\.(get|post|put|patch|delete)\("([^"]+)"/g)]
      .map(match => `${match[1]!.toUpperCase()} ${match[2]}`)).sort();
  const inventoried = routeContracts.map(c => `${c.method} ${c.path}`).sort();
  assert.deepEqual(inventoried, mounted);
  assert.equal(new Set(inventoried).size, inventoried.length);
  const index = readFileSync(new URL("../src/routes/index.ts", import.meta.url), "utf8");
  assert(index.indexOf("router.use(validateRouteInputs)") < index.indexOf("router.use(demoBoundary)"));
});

test("actual mounted Express stack equals wire inventory and OpenAPI operations", () => {
  const mounted: string[] = [];
  function inspect(stack: typeof mountedRouter.stack) {
    for (const layer of stack) {
      if (layer.route) {
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          if (enabled) mounted.push(`${method.toUpperCase()} ${layer.route.path}`);
        }
      } else if ("stack" in layer.handle) {
        inspect(layer.handle.stack as typeof mountedRouter.stack);
      }
    }
  }
  inspect(mountedRouter.stack);
  assert.deepEqual(mounted.sort(), routeContracts.map(c => `${c.method} ${c.path}`).sort());
  const spec = JSON.parse(readFileSync(new URL("../../../lib/api-spec/openapi.yaml", import.meta.url), "utf8"));
  const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.keys(methods as object).filter(method => ["get", "post", "put", "patch", "delete", "head", "options"].includes(method))
      .map(method => `${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ":$1")}`));
  assert.deepEqual(mounted, operations.sort(), "spec-only operations must be recorded as not reviewed, not silently passed");
});

test("import commit and patient merge enforce fresh reception PIN; read previews do not prompt", () => {
  function endpoint(path: string, method: string) {
    const pending = [...mountedRouter.stack];
    while (pending.length) {
      const layer = pending.shift()!;
      if (layer.route?.path === path && layer.route.methods[method]) return layer.route;
      if (!layer.route && "stack" in layer.handle) pending.push(...layer.handle.stack as typeof mountedRouter.stack);
    }
    throw new Error(`Missing ${method} ${path}`);
  }
  for (const path of ["/import/:id/commit", "/patients/merge"]) {
    const route = endpoint(path, "post");
    assert(route.stack.some(layer => layer.handle === requireFreshPin), path);
    for (const auth of [
      { role: "front-desk", device: { id: 1 }, pinVerifiedAt: new Date(Date.now() - 300_001) },
      { role: "front-desk", device: { id: 1 }, pinVerifiedAt: null },
      { role: "front-desk", device: null, pinVerifiedAt: new Date() },
    ]) {
      let error: unknown;
      requireFreshPin({ auth } as unknown as Request, {} as Response, value => { error = value; });
      assert(error instanceof ApiError);
      assert.equal(error.code, "REAUTH_REQUIRED");
    }
    for (const auth of [
      { role: "front-desk", device: { id: 1 }, pinVerifiedAt: new Date() },
      { role: "doctor", device: null, pinVerifiedAt: null },
    ]) {
      let error: unknown;
      requireFreshPin({ auth } as unknown as Request, {} as Response, value => { error = value; });
      assert.equal(error, undefined);
    }
  }
  assert(!endpoint("/patients/merge/preview", "post").stack.some(layer => layer.handle === requireFreshPin));
  assert(!endpoint("/clinics/:id/export", "post").stack.some(layer => layer.handle === requireFreshPin),
    "export authority is own-clinic doctor-manager only; doctors do not have reception PINs");
});

test("malformed and overflowing path identifiers fail before handlers", () => {
  for (const id of ["0", "-1", "01", "1e2", "0x10", "1.0", "%201", "2147483648", "999999999999999999"]) {
    for (const path of [`/patients/${id}`, `/clinics/${id}/adoption`, `/import/${id}`,
      `/admin/users/${id}`, `/admin/developer/clinics/${id}/outage`]) {
      invalid(check(path, path.endsWith("/outage") ? "PUT" : "GET", {},
        path.endsWith("/outage") ? { enabled: true, expectedGeneration: randomUUID() } : undefined));
    }
  }
  invalid(check("/patients/%E0%A4%A"));
  invalid(check("/appointments/holds/not-a-uuid", "DELETE", {}, { clientOpId: randomUUID() }));
  invalid(check("/admin/developer/resets/not-a-uuid"));
  assert.equal(check("/patients/2147483647"), undefined);
});

test("query keys, scalar types, canonical integers and pagination remain bounded", () => {
  for (const limit of ["1e2", "0x10", "+1", " 1", "1.0", "0", "-1", "2147483648", ["1", "2"], { value: "1" }]) {
    invalid(check("/clinics", "GET", { limit }));
  }
  for (const path of ["/healthz", "/demo/context", "/network/health", "/sync/state",
    "/patients/1", "/patients/1/consent", "/clinics/1/adoption", "/admin/developer/status"]) {
    invalid(check(path, "GET", { clinicId: "1" }));
  }
  invalid(check("/doctors", "GET", { clinicId: ["1", "2"] }));
  invalid(check("/sync/pull", "GET", { since: "a".repeat(2049) }));
  assert.equal(check("/doctors", "GET", { clinicId: "1", limit: "100" }), undefined);
  assert.equal(check("/import/1/report", "GET", { locale: "ar" }), undefined);
});

test("unexpected body, unsupported media and duplicate/malformed security headers fail", () => {
  invalid(check("/patients/1", "GET", {}, { role: "admin" }));
  invalid(check("/patients/1", "DELETE", {}, { clinicId: 2 }));
  invalid(check("/auth/logout", "POST", {}, { role: "admin" }));
  invalid(check("/patients", "POST", {}, {}, { "content-length": "2", "content-type": "text/plain" }));
  invalid(check("/patients", "POST", {}, []));
  invalid(check("/patients", "POST", {}, null));
  invalid(check("/healthz", "GET", {}, undefined, { "x-csrf-token": ["one", "two"] }));
  invalid(check("/healthz", "GET", {}, undefined, { "x-amal-demo-generation": "x".repeat(257) }));
  assert.equal(check("/clinics/1/export", "POST", {}, {}), undefined);
  assert.equal(check("/auth/logout", "POST"), undefined);
});

test("nested booking IDs and real UTC dates are checked without changing import raw-row errors", () => {
  for (const bad of [2147483648, "1", 0, 1.5]) {
    invalid(check("/sync/push", "POST", {}, { operations: [
      { sequence: 1, type: "create", input: { ...booking(), doctorId: bad } },
    ] }));
  }
  for (const startsAt of ["2026-02-30T06:00:00Z", "2026-09-12", "2026-09-12T06:00:00+02:00"]) {
    invalid(check("/appointments", "POST", {}, { ...booking(), startsAt }));
    invalid(check("/sync/resolve", "POST", {}, { action: "move-self", startsAt }));
  }
  assert.equal(check("/sync/push", "POST", {}, { operations: [
    { sequence: 1, type: "create", input: booking() },
  ] }), undefined);
  const upload = { source: "json", sourceName: "external", clientOpId: randomUUID(),
    rows: [{ event_id: "invalid row retained for report", start_time: "bad", unknown_column: true }] };
  assert.equal(check("/import/upload", "POST", {}, upload), undefined);
  assert(uploadInput.safeParse(upload).success);
});

test("existing strict service schemas reject unknown/privilege fields, enums and nested batch abuse", () => {
  assert(createInput.safeParse(booking()).success);
  for (const value of [{ ...booking(), role: "admin" }, { ...booking(), source: "unknown" },
    { ...booking(), actorId: 1 }]) assert.equal(createInput.safeParse(value).success, false);
  const op = { sequence: 1, type: "create", input: booking() };
  assert.equal(pushInput.safeParse({ operations: [] }).success, false);
  assert.equal(pushInput.safeParse({ operations: Array.from({ length: 51 }, (_, i) =>
    ({ ...op, sequence: i + 1 })) }).success, false);
  assert.equal(pushInput.safeParse({ operations: [{ ...op, admin: true }] }).success, false);
  assert.equal(resolveInput.safeParse({ action: "unknown" }).success, false);
  assert.equal(mapInput.safeParse({ expectedVersion: 1, rows: [{
    rowId: 1, action: "include", doctorId: 2, identity: { kind: "existing", patientId: 3,
      verification: { method: "phone", value: "123", confirmed: true } },
  }] }).success, false);
});

test("every cookie mutation explicitly applies csrf; login/PIN have the origin bootstrap policy", () => {
  const dir = new URL("../src/routes/", import.meta.url);
  for (const file of readdirSync(dir).filter(f => f.endsWith(".ts"))) {
    const source = readFileSync(new URL(file, dir), "utf8");
    for (const match of source.matchAll(/router\.(post|put|patch|delete)\("([^"]+)",([^\n]*)/g)) {
      if (["/auth/login", "/auth/pin"].includes(match[2]!)) continue;
      assert.match(match[3]!, /\bcsrf\b/, `${file}: ${match[1]} ${match[2]}`);
    }
  }
});

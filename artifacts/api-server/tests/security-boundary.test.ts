import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Server } from "node:http";
import { withIsolatedAuthDatabase } from "./helpers/auth-isolated";

type Input = { path: string; method?: string; headers?: Record<string, string>; raw?: string };
type Result = { status: number; data: any; headers: Record<string, string>; cookies: string[] };
const origin = "http://boundary-test.local";
async function call(base: string, input: Input): Promise<Result> {
  const response = await fetch(base + input.path, {
    method: input.method ?? "GET", headers: { origin, ...input.headers }, body: input.raw,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let data: any;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, headers: Object.fromEntries(response.headers), cookies: response.headers.getSetCookie() };
}
const close = async (server: Server) => { server.close(); await once(server, "close"); };

// The same file doubles as a fresh-process HTTP probe. Its app/database modules
// are dynamically imported only after inheriting the isolated database URL.
if (process.env.AMAL_BOUNDARY_CHILD === "1") {
  let server: Server | undefined;
  let pool: { end(): Promise<void> } | undefined;
  try {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    const inputs: Input[] = JSON.parse(text);
    const { default: app } = await import("../src/app");
    pool = (await import("@workspace/db")).pool;
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const results = [];
    for (const input of inputs) results.push(await call(base, input));
    process.stdout.write(JSON.stringify({ results }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ startupError: error instanceof Error ? error.message : "Unknown startup failure" }));
  } finally { if (server) await close(server); await pool?.end(); }
} else {
  test("isolated HTTP security boundary", { timeout: 180_000 }, async t => {
    await withIsolatedAuthDatabase(async (admin, pool) => {
      Object.assign(process.env, {
        LOG_LEVEL: "silent", AUTH_ALLOWED_ORIGINS: origin, AUTH_PROXY_HOPS: "0", AUTH_TRUSTED_PROXIES: "",
        SECURITY_RATE_WINDOW_SECONDS: "60", SECURITY_RATE_GENERAL: "80",
        SECURITY_RATE_LOOKUP: "5", SECURITY_RATE_EXPENSIVE: "4", SECURITY_RATE_SYNC: "4",
        AUTH_RATE_WINDOW_SECONDS: "900", AUTH_RATE_IP: "15", AUTH_RATE_ACCOUNT: "4", AUTH_RATE_DEVICE: "3",
      });
      const { default: app } = await import("../src/app");
      const { digest } = await import("../src/lib/auth");
      const { networkKey } = await import("../src/lib/security-rate");
      const { seedFingerprint } = await import("../../../scripts/src/operational-support");
      const before = await seedFingerprint(admin);
      const password = "Boundary-test-only!";
      const { rows: [actor] } = await admin.query(`INSERT INTO operational.users(email,password_hash,role)
        VALUES($1,$2,'administrator') RETURNING id,email`, [`${randomUUID()}@boundary.test`, await bcrypt.hash(password, 4)]);
      const clinicId = (await admin.query("SELECT clinic_id FROM operational.clinics ORDER BY clinic_id LIMIT 1")).rows[0].clinic_id;
      const { rows: [desk] } = await admin.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id,pin_hash)
        VALUES($1,'unused','receptionist',$2,$3) RETURNING id,email`, [`${randomUUID()}@boundary.test`, clinicId, await bcrypt.hash("0123", 4)]);
      const credential = randomUUID();
      const { rows: [device] } = await admin.query("INSERT INTO operational.devices(clinic_id,label) VALUES($1,'boundaryTest') RETURNING id", [clinicId]);
      await admin.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [device.id, digest(credential)]);
      const server = app.listen(0, "127.0.0.1");
      await once(server, "listening");
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const json = (body: unknown) => ({ "content-type": "application/json" });
      const login: Input = { path: "/api/auth/login", method: "POST", headers: json(null), raw: JSON.stringify({ email: actor.email, password }) };
      const reset = () => admin.query("DELETE FROM operational.auth_throttles");
      const error = (r: Result, status: number, code: string) => {
        assert.equal(r.status, status, JSON.stringify(r.data));
        assert.deepEqual(Object.keys(r.data).sort(), ["code", "messageKey", "params"]);
        assert.equal(r.data.code, code);
        assert(!JSON.stringify(r.data).includes("stack"));
      };
      const rate = (r: Result, max: number) => {
        error(r, 429, "RATE_LIMITED");
        assert(Number(r.headers["retry-after"]) >= 1 && Number(r.headers["retry-after"]) <= max);
        assert.equal(Number(r.headers["retry-after"]), r.data.params.retryAfterSeconds);
      };
      const probe = async (inputs: Input[], env: Record<string, string> = {}) => {
        const child = spawn(process.execPath, ["--import", "tsx", new URL("./security-boundary.test.ts", import.meta.url).pathname],
          { env: { ...process.env, AMAL_BOUNDARY_CHILD: "1", ...env }, stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "", stderr = "";
        child.stdout.on("data", c => { stdout += c; });
        child.stderr.on("data", c => { stderr += c; });
        child.stdin.end(JSON.stringify(inputs));
        const [code] = await once(child, "close");
        assert.equal(code, 0, stderr);
        return JSON.parse(stdout);
      };
      try {
        await t.test("Helmet success/errors, no-store, CORS allowlist, login origin CSRF and JSON", async () => {
          await reset();
          for (const input of [{ path: "/api/healthz" }, { path: "/not-a-route" }, { ...login, headers: { ...login.headers, origin: "https://evil.example" } }]) {
            const r = await call(base, input);
            assert.equal(r.headers["x-content-type-options"], "nosniff");
            assert.equal(r.headers["x-frame-options"], "DENY");
            assert.equal(r.headers["cross-origin-opener-policy"], "same-origin");
            assert.equal(r.headers["referrer-policy"], "no-referrer");
            assert.match(r.headers["content-security-policy"]!, /default-src 'none'/);
            assert.equal(r.headers["cache-control"], "no-store");
            assert.equal(r.headers["x-powered-by"], undefined);
            assert.equal(r.headers["strict-transport-security"], undefined);
          }
          const missing = await fetch(base + login.path, { method: "POST", headers: json(null), body: login.raw });
          assert.equal(missing.status, 403);
          error(await call(base, { ...login, headers: { ...login.headers, origin: "null" } }), 403, "CSRF");
          error(await call(base, { ...login, headers: { ...login.headers, origin: "https://evil.example" } }), 403, "CSRF");
          error(await call(base, { path: "/api/auth/pin", method: "POST",
            headers: { ...json(null), origin: "https://evil.example", cookie: `amal_device=${credential}` },
            raw: JSON.stringify({ email: desk.email, pin: "0123" }) }), 403, "CSRF");
          const good = await call(base, login);
          assert.equal(good.status, 200, JSON.stringify(good.data));
          assert.equal(good.headers["access-control-allow-origin"], origin);
          assert.equal(good.headers["access-control-allow-credentials"], "true");
          assert.match(good.cookies.join(";"), /HttpOnly/);
          assert.match(good.cookies.join(";"), /SameSite=Strict/);
        });
        await t.test("malformed/oversize/unsupported media/encoding inputs use safe validation envelopes", async () => {
          await reset();
          for (const raw of ["{", JSON.stringify({ email: actor.email, password, ignored: true }), JSON.stringify({ x: "x".repeat(33 * 1024) })]) {
            error(await call(base, { ...login, raw }), 400, "VALIDATION");
          }
          error(await call(base, { ...login, headers: { "content-type": "text/plain" } }), 400, "VALIDATION");
          error(await call(base, { ...login, headers: { "content-type": "application/x-www-form-urlencoded" } }), 400, "VALIDATION");
          error(await call(base, { ...login, headers: { "content-type": "application/json; charset=invalid" } }), 400, "VALIDATION");
          error(await call(base, { ...login, headers: { ...login.headers, "content-encoding": "unknown" } }), 400, "VALIDATION");
        });
        await t.test("route-specific upload/map/sync parser budgets preserve larger contracts and reject oversize", async () => {
          for (const [path, inside, outside] of [
            ["/api/import/upload", 100 * 1024, 129 * 1024],
            ["/api/import/1/map", 500 * 1024, 1025 * 1024],
            ["/api/sync/push", 1024 * 1024, 2049 * 1024],
          ] as const) {
            await reset();
            const input = { path, method: "POST", headers: json(null) };
            error(await call(base, { ...input, raw: JSON.stringify({ padding: "x".repeat(inside) }) }), 401, "UNAUTHORIZED");
            error(await call(base, { ...input, raw: JSON.stringify({ padding: "x".repeat(outside) }) }), 400, "VALIDATION");
          }
        });
        await t.test("cookie mutations reject missing/forged token and disallowed origin; valid logout revokes immediately", async () => {
          await reset();
          const signed = await call(base, login);
          assert.equal(signed.status, 200);
          const cookie = signed.cookies.map(c => c.split(";")[0]).join("; ");
          const logout = { path: "/api/auth/logout", method: "POST", headers: { cookie } };
          error(await call(base, logout), 403, "CSRF");
          error(await call(base, { ...logout, headers: { cookie, "x-csrf-token": "forged" } }), 403, "CSRF");
          error(await call(base, { ...logout, headers: { cookie, "x-csrf-token": signed.data.csrfToken, origin: "https://evil.example" } }), 403, "CSRF");
          assert.equal((await call(base, { ...logout, headers: { cookie, "x-csrf-token": signed.data.csrfToken } })).status, 204);
          error(await call(base, { path: "/api/me", headers: { cookie } }), 401, "UNAUTHORIZED");
        });
        await t.test("shared clinic traffic is admitted below budget; general concurrent limit persists across restart and renews", async () => {
          await reset();
          const signed = await call(base, { path: "/api/auth/pin", method: "POST",
            headers: { ...json(null), cookie: `amal_device=${credential}` }, raw: JSON.stringify({ email: desk.email, pin: "0123" }) });
          assert.equal(signed.status, 200, JSON.stringify(signed.data));
          assert.equal(signed.data.clinicId, clinicId);
          const cookie = `amal_device=${credential}; ` + signed.cookies.map(c => c.split(";")[0]).join("; ");
          const shared = await Promise.all(Array.from({ length: 40 }, () => call(base, { path: "/api/me", headers: { cookie } })));
          assert(shared.every(r => r.status === 200), "Legitimate concurrent same-clinic requests below budget must work");
          await reset();
          const burst = await Promise.all(Array.from({ length: 90 }, () => call(base, { path: "/api/healthz" })));
          assert.equal(burst.filter(r => r.status === 200).length, 80);
          assert.equal(burst.filter(r => r.status === 429).length, 10);
          rate(burst.find(r => r.status === 429)!, 60);
          rate(await call(base, { path: "/api/healthz", headers: { "x-forwarded-for": "203.0.113.77" } }), 60);
          assert.equal((await pool.query("SELECT attempts FROM operational.auth_throttles WHERE key_digest=$1", [digest("general:127.0.0.1")])).rows[0].attempts, 81, "Rejected attempts saturate rather than overflowing");
          const restarted = await probe([{ path: "/api/healthz" }]);
          rate(restarted.results[0], 60);
          await admin.query("UPDATE operational.auth_throttles SET window_started_at=clock_timestamp()-interval '61 seconds' WHERE key_digest=$1", [digest("general:127.0.0.1")]);
          assert.equal((await call(base, { path: "/api/healthz" })).status, 200);
          assert.equal((await pool.query("SELECT attempts FROM operational.auth_throttles WHERE key_digest=$1", [digest("general:127.0.0.1")])).rows[0].attempts, 1);
        });
        await t.test("lookup/expensive/sync HTTP buckets are atomic, durable and independently renew", async () => {
          for (const [path, category, limit] of [["/api/patients", "lookup", 5], ["/api/network/health", "expensive", 4], ["/api/sync/state", "sync", 4]] as const) {
            await reset();
            const burst = await Promise.all(Array.from({ length: limit + 3 }, () => call(base, { path })));
            assert.equal(burst.filter(r => r.status === 401).length, limit);
            assert.equal(burst.filter(r => r.status === 429).length, 3);
            rate(burst.find(r => r.status === 429)!, 60);
            rate((await probe([{ path }])).results[0], 60);
            await admin.query("UPDATE operational.auth_throttles SET window_started_at=clock_timestamp()-interval '61 seconds' WHERE key_digest=$1", [digest(`${category}:127.0.0.1`)]);
            error(await call(base, { path }), 401, "UNAUTHORIZED");
          }
        });
        await t.test("sensitive actual route aliases and percent encoding cannot evade category limits", async () => {
          const { sensitiveCategory } = await import("../src/lib/security-rate");
          for (const path of ["/api/network/health", "/api/admin/developer/reset", "/api/audit", "/api/admin/audit", "/api/import/1/commit", "/api/patients/merge", "/api/clinics/1/export"])
            assert.equal(sensitiveCategory(path), "expensive", path);
          await reset();
          await admin.query("INSERT INTO operational.auth_throttles(key_digest,attempts) VALUES($1,5)", [digest("lookup:127.0.0.1")]);
          rate(await call(base, { path: "/api/%70atients" }), 60);
          error(await call(base, { path: "/api/%ZZ" }), 400, "VALIDATION");
        });
        await t.test("auth account/IP/device PostgreSQL budgets survive selectors, spoofed forwarding, concurrency and restart", async () => {
          await reset();
          const wrong = { ...login, raw: JSON.stringify({ email: actor.email, password: "wrong" }) };
          const attempts = await Promise.all(Array.from({ length: 8 }, () => call(base, wrong)));
          assert.equal(attempts.filter(r => r.status === 401).length, 4);
          assert.equal(attempts.filter(r => r.status === 429).length, 4);
          rate((await probe([login])).results[0], 900);
          await admin.query("UPDATE operational.auth_throttles SET window_started_at=clock_timestamp()-interval '901 seconds' WHERE key_digest=$1", [digest(`account:${actor.email}`)]);
          assert.equal((await call(base, login)).status, 200);
          await reset();
          await admin.query("INSERT INTO operational.auth_throttles(key_digest,attempts) VALUES($1,15)", [digest("ip:127.0.0.1")]);
          for (let i = 0; i < 3; i++) {
            const r = await call(base, { ...wrong, headers: { ...wrong.headers, "x-forwarded-for": `203.0.113.${i + 1}` }, raw: JSON.stringify({ email: `${randomUUID()}@boundary.test`, password: "wrong" }) });
            rate(r, 900);
          }
          await admin.query("UPDATE operational.auth_throttles SET window_started_at=clock_timestamp()-interval '901 seconds' WHERE key_digest=$1", [digest("ip:127.0.0.1")]);
          assert.equal((await call(base, login)).status, 200, "Expired IP window renews");
          await reset();
          const pin: Input = { path: "/api/auth/pin", method: "POST", headers: { ...json(null), cookie: `amal_device=${credential}` },
            raw: JSON.stringify({ email: desk.email, pin: "9999" }) };
          const pins = await Promise.all(Array.from({ length: 5 }, () => call(base, pin)));
          assert.equal(pins.filter(r => r.status === 401).length, 3);
          assert.equal(pins.filter(r => r.status === 429).length, 2);
          // Remove only independent account/IP buckets in the disposable copy,
          // ensuring the fresh process's denial is specifically device-bound.
          await admin.query("DELETE FROM operational.auth_throttles WHERE key_digest=ANY($1::text[])",
            [[digest("ip:127.0.0.1"), digest(`account:${desk.email}`)]]);
          rate((await probe([pin])).results[0], 900);
          await admin.query("UPDATE operational.auth_throttles SET window_started_at=clock_timestamp()-interval '901 seconds' WHERE key_digest=$1", [digest(`device:${device.id}`)]);
          assert.equal((await call(base, { ...pin, raw: JSON.stringify({ email: desk.email, pin: "0123" }) })).status, 200, "Expired device window renews without resetting PIN policy");
          assert.equal(networkKey("::ffff:127.0.0.1"), "127.0.0.1");
          assert.equal(networkKey("2001:db8:1234:5678::1"), networkKey("2001:db8:1234:5678:ffff::2"));
        });
        await t.test("production HTTPS/cookie flags and explicit proxy configuration fail closed in fresh processes", async () => {
          await reset();
          const prod = { NODE_ENV: "production", AUTH_ALLOWED_ORIGINS: "https://boundary-test.local", AUTH_PROXY_HOPS: "0", AUTH_TRUSTED_PROXIES: "" };
          const insecure = await probe([{ path: "/api/healthz", headers: { origin: "https://boundary-test.local", "x-forwarded-proto": "https" } }], prod);
          error(insecure.results[0], 403, "FORBIDDEN");
          assert.match(insecure.results[0].headers["strict-transport-security"], /max-age=31536000/);
          const secure = await probe([{ ...login, headers: { ...login.headers, origin: "https://boundary-test.local", "x-forwarded-proto": "https" } }],
            { ...prod, AUTH_TRUSTED_PROXIES: "127.0.0.1/32" });
          assert.equal(secure.results[0].status, 200, JSON.stringify(secure));
          assert.match(secure.results[0].cookies.join(";"), /Secure/);
          assert.match(secure.results[0].cookies.join(";"), /HttpOnly/);
          assert.match(secure.results[0].cookies.join(";"), /SameSite=Strict/);
          for (const env of [
            { ...prod, AUTH_PROXY_HOPS: "1" },
            { ...prod, AUTH_ALLOWED_ORIGINS: origin },
            { ...prod, AUTH_ALLOWED_ORIGINS: "" },
            { ...prod, AUTH_TRUSTED_PROXIES: "0.0.0.0/0" },
            { ...prod, AUTH_TRUSTED_PROXIES: "::ffff:127.0.0.1" },
          ]) assert((await probe([], env)).startupError, "Unsafe production config must refuse startup");
        });
        await t.test("all HTTP tests preserve copied seed fingerprints", async () => {
          assert.equal(await seedFingerprint(admin), before);
        });
      } finally { await close(server); }
    });
  });
}

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import pg from "pg";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Development tests only");
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.AUTH_ALLOWED_ORIGINS = "http://import-boundary.test";
const { default: app } = await import("../src/app");
const { pool } = await import("@workspace/db");
const { digest } = await import("../src/lib/auth");
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;
const token = randomUUID(), csrf = randomUUID();
let actorId: number;
const endpoints = [
  ["POST", "/import/upload"], ["GET", "/import/2147483647"],
  ["POST", "/import/2147483647/map"], ["POST", "/import/2147483647/commit"],
  ["GET", "/import/2147483647/report"], ["GET", "/patients/duplicates"], ["POST", "/patients/merge"],
] as const;
before(async () => {
  await admin.connect();
  actorId = (await admin.query(`INSERT INTO operational.users(email,password_hash,role)
    VALUES($1,'unused','administrator') RETURNING id`, [`${randomUUID()}@import-boundary.test`])).rows[0].id;
  await admin.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,csrf_token,absolute_expires_at)
    VALUES($1,$2,$3,now()+interval '1 hour')`, [digest(token), actorId, csrf]);
});
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  try {
    await admin.query("DELETE FROM operational.auth_sessions WHERE user_id=$1", [actorId]);
    await admin.query("DELETE FROM operational.users WHERE id=$1", [actorId]);
  } finally { await admin.end(); await pool.end(); }
});
async function request(method: string, path: string, authenticated: boolean) {
  const response = await fetch(base + path, {
    method, headers: {
      origin: process.env.AUTH_ALLOWED_ORIGINS!, "content-type": "application/json",
      ...(authenticated ? { cookie: `amal_session=${token}`, "x-csrf-token": csrf } : {}),
    }, ...(method === "POST" ? { body: "{}" } : {}),
  });
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["code", "messageKey", "params"]);
  assert.match(body.messageKey, /^error\./);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response.status;
}
test("all import and merge HTTP routes authenticate before parsing identities or exposing reports", async () => {
  for (const [method, path] of endpoints) assert.equal(await request(method, path, false), 401, path);
});
test("administrator privileges never grant patient import, duplicate or report access", async () => {
  for (const [method, path] of endpoints) assert.equal(await request(method, path, true), 403, path);
});

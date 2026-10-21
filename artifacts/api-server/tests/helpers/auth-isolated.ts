import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

/** Read-only source snapshot, disposable private Unix-socket cluster.
 * Import app/auth/db only INSIDE run(), after DATABASE_URL has been switched.
 * Run each caller in its own Node process: the workspace db pool is a singleton.
 * No source migrations, source writes or reset/population routine is invoked.
 * Pattern reused from developer-reset.test.ts, without its migration/reset.
 */
export async function withIsolatedAuthDatabase(run: (admin: pg.Client, pool: pg.Pool) => Promise<void>) {
  assert(process.env.DATABASE_URL, "Existing prerequisite DATABASE_URL is required");
  assert.notEqual(process.env.NODE_ENV, "production", "Never run auth tests in production");
  assert.notEqual(process.env.REPLIT_DEPLOYMENT, "1", "Never run auth tests in deployment");
  const original = { ...process.env };
  const dir = mkdtempSync(join(tmpdir(), "amal-auth-security-"));
  let started = false;
  let admin: pg.Client | undefined;
  let runtime: pg.Pool | undefined;
  try {
    execFileSync("initdb", ["-D", join(dir, "data"), "-A", "trust", "-U", "test_owner"], { stdio: "pipe" });
    execFileSync("pg_ctl", ["-D", join(dir, "data"), "-l", join(dir, "postgres.log"),
      "-o", `-k ${dir} -h '' -p 55441`, "-w", "start"], { stdio: "pipe" });
    started = true;
    const url = `postgresql://test_owner@localhost:55441/postgres?host=${encodeURIComponent(dir)}`;
    const dump = join(dir, "source.sql");
    const source = new URL(original.DATABASE_URL!);
    // libpq environment avoids exposing source credentials in process argv or
    // execFileSync's command/error rendering. Never print this environment.
    const sourceEnv = { ...process.env,
      PGHOST: source.searchParams.get("host") ?? source.hostname,
      PGPORT: source.port || "5432",
      PGDATABASE: decodeURIComponent(source.pathname.slice(1)),
      PGUSER: source.searchParams.get("user") ?? decodeURIComponent(source.username),
      PGPASSWORD: source.searchParams.get("password") ?? decodeURIComponent(source.password),
      PGSSLMODE: source.searchParams.get("sslmode") ?? process.env.PGSSLMODE ?? "prefer",
      PGOPTIONS: "",
    };
    execFileSync("pg_dump", ["--no-owner",
      "--schema", "public", "--schema", "seed_guard", "--schema", "operational", "--schema", "operational_meta",
      "-f", dump], { stdio: "pipe", env: sourceEnv });
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`DROP SCHEMA public; CREATE ROLE amal_app LOGIN;
      CREATE ROLE amal_demo_reset NOLOGIN; CREATE ROLE amal_reset_login LOGIN;
      CREATE ROLE amal_seed_owner NOLOGIN`);
    execFileSync("psql", ["--dbname", url, "-v", "ON_ERROR_STOP=1", "-f", dump], { stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.SESSION_SECRET = randomUUID();
    process.env.NODE_ENV = "test";
    process.env.AUTH_PIN_LOCK_MINUTES = "15";
    delete process.env.AMAL_DEVELOPER_TOOLS;
    runtime = (await import("@workspace/db")).pool;
    await run(admin, runtime);
  } finally {
    await runtime?.end();
    await admin?.end();
    if (started) execFileSync("pg_ctl", ["-D", join(dir, "data"), "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    rmSync(dir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHmac } from "node:crypto";
import pg from "pg";

// Fully disposable PostgreSQL cluster, not a rollback-only reset of the workspace.
// pg_dump reads the workspace; every migration/mutation uses a separate socket.
test("restricted reset: seeds, rollback, generation receipts, sessions and concurrent fences", {
  skip: !process.env.DATABASE_URL,
  timeout: 180_000,
}, async () => {
  const sourceUrl = process.env.DATABASE_URL!;
  const dir = mkdtempSync(join(tmpdir(), "amal-reset-test-"));
  const data = join(dir, "data");
  let started = false;
  let admin: pg.Client | undefined;
  let runtimePool: pg.Pool | undefined;
  try {
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "test_owner"], { stdio: "pipe" });
    execFileSync("pg_ctl", ["-D", data, "-l", join(dir, "postgres.log"), "-o",
      `-k ${dir} -h '' -p 55439`, "-w", "start"], { stdio: "pipe" });
    started = true;
    const url = `postgresql://test_owner@localhost:55439/postgres?host=${encodeURIComponent(dir)}`;
    const dump = join(dir, "source.sql");
    execFileSync("pg_dump", ["--dbname", sourceUrl, "--no-owner",
      "--schema", "public", "--schema", "seed_guard", "--schema", "operational", "--schema", "operational_meta", "-f", dump], { stdio: "pipe" });
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`DROP SCHEMA public; CREATE ROLE amal_app LOGIN; CREATE ROLE amal_demo_reset NOLOGIN;
      CREATE ROLE amal_reset_login LOGIN;
      CREATE ROLE amal_seed_owner NOLOGIN`);
    execFileSync("psql", ["--dbname", url, "-v", "ON_ERROR_STOP=1", "-f", dump], { stdio: "pipe" });
    // Existing allowlisted reset capability is restored without copying ACLs
    // from the source database's administrative owner.
    await admin.query(`GRANT USAGE ON SCHEMA operational TO amal_demo_reset,amal_app;
      GRANT SELECT,DELETE ON ALL TABLES IN SCHEMA operational TO amal_demo_reset;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO amal_app`);
    const { seedFingerprint } = await import("../../../scripts/src/operational-support");
    const preMigrationSeeds = await seedFingerprint(admin);
    await admin.query(readFileSync(new URL("../../../lib/db/migrations/0015_developer_tools.sql", import.meta.url), "utf8"));
    assert.equal(await seedFingerprint(admin), preMigrationSeeds, "Migration must preserve seed ACLs too");
    process.env.DATABASE_URL = url;
    process.env.SESSION_SECRET = randomUUID();
    process.env.AMAL_DEVELOPER_TOOLS = "1";
    process.env.NODE_ENV = "test";
    delete process.env.REPLIT_DEPLOYMENT;
    const password = (domain: string) => createHmac("sha256", process.env.SESSION_SECRET!)
      .update(`${domain}:/postgres`).digest("hex");
    await admin.query(`ALTER ROLE amal_app PASSWORD '${password("amal-app-database-login")}';
      ALTER ROLE amal_reset_login PASSWORD '${password("amal-reset-database-login")}'`);
    const { resetDemo, getDemoGeneration, getResetReceipt, developerToolsEnabled } = await import("../src/developer/reset");
    runtimePool = (await import("@workspace/db")).pool;
    assert.equal((await runtimePool.query("SELECT pg_has_role(current_user,'amal_demo_reset','MEMBER') allowed")).rows[0].allowed, false);
    const { resetConnectionString } = await import("@workspace/db/reset-connection");
    const restricted = new pg.Client({ connectionString: resetConnectionString() });
    await restricted.connect();
    try {
      assert.equal((await restricted.query("SELECT session_user")).rows[0].session_user, "amal_reset_login");
      for (const table of ["clinics","doctors","patients","appointments","patient_visit_history","calendar_app_export"]) {
        assert.equal((await restricted.query(`SELECT has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE') unsafe`,
          [`public.${table}`])).rows[0].unsafe, false);
        await assert.rejects(restricted.query(`DELETE FROM public.${table} WHERE false`), /permission denied/);
      }
    } finally { await restricted.end(); }
    const beforeSeeds = await seedFingerprint(admin);
    const actor = async () => {
      const { rows: [user] } = await admin!.query("SELECT id FROM operational.users WHERE role='administrator' AND disabled_at IS NULL LIMIT 1");
      assert(user);
      const sessionDigest = randomUUID();
      await admin!.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,csrf_token)
        VALUES($1,$2,'test')`, [sessionDigest, user.id]);
      return { id: user.id as number, sessionDigest };
    };
    const initialActor = await actor();
    const initial = await getDemoGeneration();
    const requestId = randomUUID();
    await admin.query(`INSERT INTO operational.developer_outages(clinic_id)
      SELECT clinic_id FROM operational.clinics LIMIT 1 ON CONFLICT DO NOTHING`);
    // Force failure late, after all operational deletes/population.
    await admin.query(`CREATE FUNCTION operational_meta.test_fail_reset() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'injected reset failure'; END $$;
      CREATE TRIGGER test_fail_reset BEFORE INSERT ON operational_meta.demo_reset_receipts
      FOR EACH ROW EXECUTE FUNCTION operational_meta.test_fail_reset()`);
    const counts = async () => (await admin!.query(`SELECT
      (SELECT count(*) FROM operational.auth_sessions)::int sessions,
      (SELECT count(*) FROM operational.developer_outages)::int outages,
      (SELECT count(*) FROM operational.appointments)::int appointments`)).rows[0];
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      const { rows } = await admin!.query(`SELECT tablename FROM pg_tables
        WHERE schemaname='operational' ORDER BY tablename`);
      for (const { tablename } of rows) {
        assert.match(tablename, /^[a-z_]+$/);
        result[tablename] = (await admin!.query(`SELECT to_jsonb(t) row FROM operational.${tablename} t
          ORDER BY to_jsonb(t)::text`)).rows;
      }
      return result;
    };
    const beforeFailure = await counts();
    const beforeRows = await snapshot();
    await assert.rejects(resetDemo({ requestId, expectedGeneration: initial, actor: initialActor }), /injected reset failure/);
    assert.deepEqual(await counts(), beforeFailure);
    assert.deepEqual(await snapshot(), beforeRows, "Failed reset rolls back every operational table");
    assert.equal(await getDemoGeneration(), initial);
    assert.equal(await getResetReceipt(requestId), null);
    assert.equal(await seedFingerprint(admin), beforeSeeds);
    await admin.query("DROP TRIGGER test_fail_reset ON operational_meta.demo_reset_receipts");

    // An ordinary writer's shared fence holds reset until commit.
    const writer = new pg.Client({ connectionString: url });
    await writer.connect();
    await writer.query("BEGIN; SELECT pg_advisory_xact_lock_shared(761930)");
    let settled = false;
    const pending = resetDemo({ requestId, expectedGeneration: initial, actor: initialActor })
      .finally(() => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(settled, false, "reset must wait behind an operational writer");
    await writer.query("COMMIT");
    await writer.end();
    const completed = await pending;
    const baselineCounts = Object.fromEntries(Object.entries(await snapshot()).map(([name, rows]) =>
      [name, (rows as unknown[]).length]));
    assert.notEqual(completed.generation, initial);
    assert.deepEqual(await getResetReceipt(requestId), completed);
    assert.equal((await counts()).sessions, 0);
    assert.equal((await counts()).outages, 0);
    assert.equal(await seedFingerprint(admin), beforeSeeds);
    assert.equal((await admin.query(`SELECT count(*)::int n FROM operational.import_rows
      WHERE review_state='review_required' AND confirmed_patient_id IS NULL
      AND confirmed_doctor_id IS NULL`)).rows[0].n, 24);
    const newActor = await actor();
    assert.deepEqual(await resetDemo({ requestId, expectedGeneration: initial, actor: newActor }), completed);
    await assert.rejects(resetDemo({ requestId: randomUUID(), expectedGeneration: initial, actor: newActor }),
      (e: any) => e.code === "DEMO_RESET_REQUIRED");
    // Concurrent resets: first invalidates the other session, no second baseline.
    const results = await Promise.allSettled([randomUUID(), randomUUID()].map(id =>
      resetDemo({ requestId: id, expectedGeneration: completed.generation, actor: newActor })));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(results.filter(r => r.status === "rejected").length, 1);
    assert.equal(await seedFingerprint(admin), beforeSeeds);
    assert.equal((await admin.query("SELECT count(*)::int n FROM operational.import_rows")).rows[0].n, 24);
    assert.deepEqual(Object.fromEntries(Object.entries(await snapshot()).map(([name, rows]) =>
      [name, (rows as unknown[]).length])), baselineCounts, "Repeated reset has identical baseline counts across all tables");
    const { exerciseDeveloperHttp } = await import("./helpers/developer-http");
    await exerciseDeveloperHttp(admin);
    process.env.NODE_ENV = "production";
    assert.equal(developerToolsEnabled(), false);
    await assert.rejects(getDemoGeneration(), (e: any) => e.code === "DEVELOPER_TOOLS_DISABLED");
  } finally {
    await runtimePool?.end();
    await admin?.end();
    if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    rmSync(dir, { recursive: true, force: true });
    process.env.DATABASE_URL = sourceUrl;
  }
});

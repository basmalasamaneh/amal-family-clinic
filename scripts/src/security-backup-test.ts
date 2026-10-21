import assert from "node:assert/strict";
import { lstat, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { tables } from "./seed-source";
import { seedFingerprint } from "./operational-support";
import { createBackup, databaseEvidence, postgresTool } from "./security-backup";
import { guardedDemoTarget, runGuardedSeed, seedConfirmation } from "./security-demo-seed";
import { withRestoredBackup } from "./security-restore-drill";

const args = ["--demo", seedConfirmation];
const original = {
  demo: process.env.AMAL_DEMO_DATABASE_URL,
  mode: process.env.NODE_ENV,
  deployment: process.env.REPLIT_DEPLOYMENT,
};
const directory = await mkdtemp("/tmp/amal-private-backup-test-");
const source = new pg.Client({ connectionString: process.env.DATABASE_URL });
let stage = "read-only source evidence";
try {
  assert(process.env.DATABASE_URL, "Source database required");
  assert(process.env.NODE_ENV !== "production" && process.env.REPLIT_DEPLOYMENT !== "1");
  await source.connect();
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await source.query("SET LOCAL TIME ZONE 'UTC'");
  const before = await seedFingerprint(source);
  for (const table of tables) {
    const result = await source.query(`SELECT has_table_privilege('amal_app',$1,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') unsafe`,
      [`public.${table.name}`]);
    assert.equal(result.rows[0].unsafe, false, "Runtime source write privileges detected");
  }
  await source.query("ROLLBACK");

  stage = "guards";
  process.env.AMAL_DEMO_DATABASE_URL = process.env.DATABASE_URL;
  assert.throws(() => guardedDemoTarget(args));
  const fakeTarget = new URL(process.env.DATABASE_URL);
  fakeTarget.pathname = "/amal_demo_guard_test";
  process.env.AMAL_DEMO_DATABASE_URL = fakeTarget.toString();
  const remoteTarget = new URL(fakeTarget);
  remoteTarget.hostname = "production.invalid";
  remoteTarget.port = "6543";
  process.env.AMAL_DEMO_DATABASE_URL = remoteTarget.toString();
  assert.throws(() => guardedDemoTarget(args));
  process.env.AMAL_DEMO_DATABASE_URL = fakeTarget.toString();
  assert.throws(() => guardedDemoTarget(["--demo"]));
  assert.throws(() => guardedDemoTarget([seedConfirmation]));
  assert.throws(() => guardedDemoTarget([...args, "--reset"]));
  process.env.NODE_ENV = "production";
  assert.throws(() => guardedDemoTarget(args));
  process.env.NODE_ENV = "development";
  process.env.REPLIT_DEPLOYMENT = "1";
  assert.throws(() => guardedDemoTarget(args));
  process.env.REPLIT_DEPLOYMENT = "0";

  stage = "partial backup cleanup";
  const entries = await readdir(directory);
  await assert.rejects(createBackup({ directory, tool: async (_cmd, toolArgs) => {
    const archive = toolArgs[toolArgs.indexOf("--file") + 1]!;
    await writeFile(archive, "incomplete private output");
    throw new Error("Injected backup failure");
  } }));
  assert.deepEqual(await readdir(directory), entries, "Failed backup left partial output");
  const insecure = join(directory, "insecure");
  await import("node:fs/promises").then(fs => fs.mkdir(insecure, { mode: 0o755 }));
  await assert.rejects(createBackup({ directory: insecure }));
  await rm(insecure, { recursive: true });

  stage = "consistent private source backup";
  const backup = await createBackup({ directory });
  for (const [path, mode] of [
    [backup.path, 0o700], [join(backup.path, "database.dump"), 0o600], [join(backup.path, "manifest.json"), 0o600],
  ] as const) assert.equal((await lstat(path)).mode & 0o777, mode);

  stage = "isolated recovery and guarded population";
  const restore = await withRestoredBackup(backup.path, async (client, connectionString, restoreEvidence) => {
    const sealed = await seedFingerprint(client);
    // Actual write-denial probes are exclusively against restored copies.
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE amal_app");
    let denied = 0;
    for (const table of tables) {
      const id = table.columns[0]!.name;
      for (const sql of [
        `INSERT INTO public.${table.name} SELECT * FROM public.${table.name} WHERE false`,
        `UPDATE public.${table.name} SET ${id}=${id} WHERE false`,
        `DELETE FROM public.${table.name} WHERE false`,
        `TRUNCATE public.${table.name}`,
      ]) {
        await client.query("SAVEPOINT denied");
        let code: string | undefined;
        try { await client.query(sql); } catch (error) { code = (error as { code: string }).code; }
        await client.query("ROLLBACK TO SAVEPOINT denied");
        assert.equal(code, "42501", "Restored source protection failed");
        denied++;
      }
    }
    await client.query("ROLLBACK");
    process.env.AMAL_DEMO_DATABASE_URL = connectionString;
    const overridden = new URL(connectionString);
    overridden.searchParams.set("host", "production.invalid");
    process.env.AMAL_DEMO_DATABASE_URL = overridden.toString();
    assert.throws(() => guardedDemoTarget(args), "Query host override accepted");
    process.env.AMAL_DEMO_DATABASE_URL = connectionString;
    const name = decodeURIComponent(new URL(connectionString).pathname.slice(1));
    assert.match(name, /^amal_demo_[a-f0-9]+$/);
    await client.query(`COMMENT ON DATABASE "${name}" IS NULL`);
    await assert.rejects(runGuardedSeed(args), "Unmarked database accepted");
    await client.query(`COMMENT ON DATABASE "${name}" IS 'AMAL_ISOLATED_DEMO_ONLY'`);
    await runGuardedSeed(args);
    const patient = (await client.query("SELECT patient_id FROM operational.patients ORDER BY patient_id LIMIT 1")).rows[0];
    await client.query("UPDATE operational.patients SET phone=$1 WHERE patient_id=$2", ["+970599000039", patient.patient_id]);
    const edited = await databaseEvidence(client);
    const counts = await runGuardedSeed(args);
    assert.deepEqual(await databaseEvidence(client), edited, "Rerun changed operational edits or credentials");
    assert.equal(await seedFingerprint(client), sealed, "Population changed immutable copies");

    stage = "transactional population rollback";
    // Remove only two disposable operational fixtures; no reset, seed DML or broad cascades.
    await client.query("DELETE FROM operational.patient_merge_candidates WHERE fixture_key='demo.distinctSameName'");
    await client.query(`DELETE FROM operational.import_rows WHERE id=(
      SELECT r.id FROM operational.import_rows r JOIN operational.import_batches b ON b.id=r.batch_id
      WHERE b.fixture_key='demo.calendar.workbook' ORDER BY r.id LIMIT 1)`);
    await client.query(`CREATE FUNCTION operational.backup_test_fail() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'injected rollback'; END $$;
      CREATE TRIGGER backup_test_failure BEFORE INSERT ON operational.import_rows
      FOR EACH ROW EXECUTE FUNCTION operational.backup_test_fail()`);
    const preFailure = await databaseEvidence(client);
    await assert.rejects(runGuardedSeed(args));
    assert.deepEqual(await databaseEvidence(client), preFailure, "Failed population committed partial rows");
    assert.equal(await seedFingerprint(client), sealed);
    await client.query(`DROP TRIGGER backup_test_failure ON operational.import_rows;
      DROP FUNCTION operational.backup_test_fail()`);
    await runGuardedSeed(args);
    assert.equal(Number((await client.query(`SELECT count(*) n FROM operational.patient_merge_candidates
      WHERE fixture_key='demo.distinctSameName'`)).rows[0].n), 1, "Shared population failed to repair missing operational fixture");

    stage = "concurrent snapshot consistency on disposable source";
    const consistent = await createBackup({ directory, connectionString, tool: async (command, toolArgs, url, signal) => {
      // Commit an operational edit AFTER pg_export_snapshot but BEFORE pg_dump.
      // Both backup manifest and dump must retain the same earlier view.
      await client.query("UPDATE operational.patients SET phone=$1 WHERE patient_id=$2", ["+970599000040", patient.patient_id]);
      await postgresTool(command, toolArgs, url, signal);
    } });
    await withRestoredBackup(consistent.path, async (snapshotClient) => {
      assert.equal((await snapshotClient.query("SELECT phone FROM operational.patients WHERE patient_id=$1", [patient.patient_id])).rows[0].phone,
        "+970599000039", "Dump did not use the manifest snapshot");
    });
    assert.equal(await seedFingerprint(client), sealed);
    return { ...restoreEvidence, sourceWriteDenialProbesOnCopies: denied,
      guardedRerunPreservesAllOperationalRows: true, rollbackPreservesAllOperationalRows: true,
      concurrentSnapshotConsistency: true, populationCounts: counts };
  });

  stage = "read-only source after-check";
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await source.query("SET LOCAL TIME ZONE 'UTC'");
  assert.equal(await seedFingerprint(source), before, "Original source changed");
  await source.query("ROLLBACK");
  console.log(JSON.stringify({ result: "PASS", ...restore, sourceSeedFingerprintBefore: before,
    sourceSeedFingerprintAfter: before, sourceWritePrivilegeChecks: 6,
    backupFailurePartialCleanup: true, privatePermissionsVerified: true,
    productionDeploymentSourceAndConfirmationGuards: true, disposableClustersRemoved: true }));
} catch (error) {
  const code = (error as { code?: string }).code;
  const safeCode = code && /^[A-Z0-9_]+$/.test(code) ? code : "unclassified";
  console.error(`Backup/seed verification failed at: ${stage}; code=${safeCode}. No source values or database diagnostics emitted.`);
  process.exitCode = 1;
} finally {
  await source.end().catch(() => {});
  for (const [key, value] of Object.entries({
    AMAL_DEMO_DATABASE_URL: original.demo, NODE_ENV: original.mode, REPLIT_DEPLOYMENT: original.deployment,
  })) value === undefined ? delete process.env[key] : process.env[key] = value;
  await rm(directory, { recursive: true, force: true });
}

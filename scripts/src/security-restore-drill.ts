import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { join } from "node:path";
import pg from "pg";
import { requireDemo, seedFingerprint } from "./operational-support";
import {
  type BackupManifest, databaseEvidence, fileSha256, inactiveRestoreTables, postgresEnvironment, postgresTool, quote,
} from "./security-backup";

async function localTool(command: string, args: string[]) {
  await new Promise<void>((done, fail) => {
    const child = spawn(command, args, { stdio: "ignore", env: postgresEnvironment("postgresql://postgres@127.0.0.1/postgres") });
    child.once("error", () => fail(new Error("Disposable PostgreSQL tool failed")));
    child.once("exit", code => code === 0 ? done() : fail(new Error("Disposable PostgreSQL tool failed")));
  });
}

async function privateFile(path: string, directory = false) {
  const stat = await lstat(path);
  assert(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile()), "Private backup file required");
  assert.equal(stat.uid, process.getuid?.(), "Backup must belong to this operator");
  assert.equal(stat.mode & 0o777, directory ? 0o700 : 0o600, "Unsafe backup permissions");
}

/** Cannot be pointed at an existing database: this routine owns the entire temporary cluster. */
export async function withRestoredBackup<T>(path: string, fn: (
  client: pg.Client, connectionString: string, evidence: Record<string, unknown>
) => Promise<T>) {
  await privateFile(path, true);
  const manifestPath = join(path, "manifest.json");
  const archive = join(path, "database.dump");
  await privateFile(manifestPath);
  await privateFile(archive);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as BackupManifest;
  assert.equal(manifest.version, 1, "Unsupported backup manifest");
  assert.equal(await fileSha256(archive), manifest.archiveSha256, "Archive digest mismatch");
  const directory = await mkdtemp("/tmp/amal-private-restore-");
  const data = join(directory, "data");
  const passwordFile = join(directory, "password");
  const password = randomBytes(32).toString("hex");
  await writeFile(passwordFile, password, { mode: 0o600 });
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
  const address = socket.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const name = `amal_demo_${randomBytes(12).toString("hex")}`;
  const connectionString = `postgresql://postgres:${password}@127.0.0.1:${port}/${name}`;
  let started = false;
  let client: pg.Client | undefined;
  try {
    await localTool("initdb", ["-D", data, "-U", "postgres", "--auth-local=trust", "--auth-host=scram-sha-256", "--pwfile", passwordFile, "--no-locale", "--encoding=UTF8"]);
    await rm(passwordFile);
    await localTool("pg_ctl", ["-D", data, "-l", join(directory, "server.log"), "-o",
      `-h 127.0.0.1 -p ${port} -k ${directory}`, "-w", "start"]);
    started = true;
    const admin = new pg.Client({ connectionString: connectionString.replace(`/${name}`, "/postgres") });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${quote(name)} TEMPLATE template0`);
      await admin.query(`REVOKE CONNECT ON DATABASE ${quote(name)} FROM PUBLIC`);
      await admin.query(`COMMENT ON DATABASE ${quote(name)} IS 'AMAL_ISOLATED_DEMO_ONLY'`);
      // Only generated maintenance identity can log in. No source role passwords copied.
      await admin.query(`CREATE ROLE amal_seed_owner NOLOGIN;
        CREATE ROLE amal_app NOLOGIN;
        CREATE ROLE amal_demo_reset NOLOGIN;
        CREATE ROLE amal_reset_login NOLOGIN INHERIT;
        GRANT amal_app,amal_demo_reset TO amal_reset_login`);
    } finally { await admin.end(); }
    client = new pg.Client({ connectionString });
    await client.connect();
    // Only the empty generated database is touched. No --clean or user target option exists.
    await client.query("DROP SCHEMA public");
    const toc = join(directory, "restore.list");
    // pg_restore list has metadata only; keep even that in a private file.
    await new Promise<void>((done, fail) => {
      const child = spawn("pg_restore", ["--list", archive], { stdio: ["ignore", "pipe", "ignore"], env: postgresEnvironment(connectionString) });
      let output = "";
      child.stdout.on("data", chunk => { output += chunk.toString(); });
      child.once("error", () => fail(new Error("Archive inventory failed")));
      child.once("exit", code => {
        if (code !== 0) return fail(new Error("Archive inventory failed"));
        const filtered = output.split("\n").filter(line =>
          !inactiveRestoreTables.some(table => {
            const [schema, name] = table.split(".");
            return line.includes(` TABLE DATA ${schema} ${name} `);
          })).join("\n");
        writeFile(toc, filtered, { mode: 0o600 }).then(() => done(), fail);
      });
    });
    await postgresTool("pg_restore", ["--no-password", "--exit-on-error", "--use-list", toc, "--dbname", name, archive], connectionString);
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const restored = await databaseEvidence(client);
    assert.equal(restored.tables.length, manifest.tables.length, "Restored table inventory differs");
    for (const actual of restored.tables) {
      const expected = manifest.tables.find(t => t.schema === actual.schema && t.table === actual.table);
      assert(expected, "Unexpected restored table");
      assert.equal(actual.definition, expected.definition, "Restored schema mismatch");
      const inactive = inactiveRestoreTables.some(t => t === `${actual.schema}.${actual.table}`);
      assert.equal(actual.count, inactive ? 0 : expected.count, "Restored count mismatch");
      if (!inactive) assert.equal(actual.content, expected.content, "Restored content mismatch");
    }
    if (restored.schemaObjectsSha256 !== manifest.schemaObjectsSha256) {
      const differing = restored.schemaObjectDigests.filter(actual =>
        manifest.schemaObjectDigests.find(expected => expected.kind === actual.kind &&
          expected.schema === actual.schema && expected.name === actual.name)?.sha256 !== actual.sha256);
      // Identifiers only, never function bodies, SQL, source rows, or credentials.
      console.error(JSON.stringify({ schemaObjectMismatches: differing.map(({ kind, schema, name }) => ({ kind, schema, name })) }));
      throw new Error("Restored schema object definitions differ");
    }
    assert.deepEqual(restored.checkConstraints, manifest.checkConstraints, "Restored CHECK constraint inventory differs");
    assert(restored.checkConstraints.every(c => c.validated), "Unvalidated CHECK constraint");
    assert.deepEqual(restored.relationships, manifest.relationships, "Restored relationship definitions differ");
    assert(restored.relationships.every(r => r.validated), "Unvalidated restored foreign key");
    await client.query("ROLLBACK");
    // Revalidate every FK against actual restored rows, not merely pg_constraint flags.
    await client.query("BEGIN");
    for (const relationship of restored.relationships) {
      const table = `${quote(relationship.schema)}.${quote(relationship.table)}`;
      await client.query(`ALTER TABLE ${table} DROP CONSTRAINT ${quote(relationship.name)}`);
      await client.query(`ALTER TABLE ${table} ADD CONSTRAINT ${quote(relationship.name)} ${relationship.definition}`);
    }
    // Preserve original definitions/OIDs. This transaction is evidence only.
    await client.query("ROLLBACK");
    const before = await seedFingerprint(client);
    await client.query("BEGIN");
    await client.query(`UPDATE operational.users SET disabled_at=clock_timestamp(),
      password_hash='disabled-'||gen_random_uuid()::text,pin_hash=NULL`);
    assert.equal(Number((await client.query(`SELECT count(*) n FROM operational.auth_sessions
      WHERE revoked_at IS NULL`)).rows[0].n), 0);
    assert.equal(Number((await client.query(`SELECT count(*) n FROM operational.auth_devices
      WHERE revoked_at IS NULL`)).rows[0].n), 0);
    assert.equal(await seedFingerprint(client), before, "Restored seeds changed during sanitization");
    await client.query("COMMIT");
    const evidence = {
      tableSchemasAndCountsVerified: restored.tables.length,
      indexesTriggersFunctionsAndKeyConstraintsVerified: true,
      validatedCheckConstraintInventory: restored.checkConstraints.length,
      contentDigestsVerifiedBeforeCredentialSanitization: true,
      foreignKeysRevalidated: restored.relationships.length,
      inactiveSessionAndDeviceTables: inactiveRestoreTables,
      activeSessions: 0, trustedDevices: 0, userCredentialsDisabled: true,
      sourceRolePasswordsCopied: false, applicationRolesCannotLogin: true,
      isolatedCluster: true, seedContentMatchedArchive: true,
    };
    return await fn(client, connectionString, evidence);
  } finally {
    await client?.end().catch(() => {});
    if (started) await localTool("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("/security-restore-drill.ts")) {
  try {
    requireDemo();
    assert.deepEqual(process.argv.slice(2).sort(), ["--confirm=RESTORE-PRIVATE-BACKUP", "--demo"].sort());
    assert(process.env.AMAL_RESTORE_BACKUP, "Explicit private backup path required");
    const result = await withRestoredBackup(process.env.AMAL_RESTORE_BACKUP, async (_client, _url, evidence) => evidence);
    console.log(JSON.stringify({ ...result, disposableClusterRemoved: true }));
  } catch {
    console.error("Isolated restore drill failed; no database diagnostics or credentials emitted.");
    process.exitCode = 1;
  }
}

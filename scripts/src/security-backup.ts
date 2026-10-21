import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import pg from "pg";
import { root } from "./seed-source";
import { seedFingerprint } from "./operational-support";

export const backupSchemas = ["public", "seed_guard", "operational", "operational_meta"] as const;
export const inactiveRestoreTables = ["operational.auth_sessions", "operational.auth_devices"] as const;
export type TableEvidence = {
  schema: string; table: string; count: number; content: string; definition: string;
};
export type BackupManifest = {
  version: 1; id: string; createdAt: string; consistency: string; schemas: readonly string[];
  archiveSha256: string; sourceSeedFingerprint: string; tables: TableEvidence[];
  schemaObjectsSha256: string;
  schemaObjectDigests: { kind: string; schema: string; name: string; sha256: string }[];
  checkConstraints: { schema: string; table: string; name: string; validated: boolean }[];
  relationships: { schema: string; table: string; name: string; definition: string; validated: boolean }[];
  restorePolicy: string;
};
export const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

export async function fileSha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** No URI/password arguments, inherited libpq overrides, stdout, or driver stderr. */
export function postgresEnvironment(connectionString: string): NodeJS.ProcessEnv {
  const url = new URL(connectionString);
  assert(["postgres:", "postgresql:"].includes(url.protocol), "PostgreSQL URL required");
  assert([...url.searchParams.keys()].every(key => key === "sslmode"), "Connection overrides prohibited");
  assert.equal(url.hash, "", "Connection fragments prohibited");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith("PG") && !/DATABASE_URL|SESSION_SECRET/.test(key)));
  return { ...env, PGHOST: url.hostname, PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: url.searchParams.get("sslmode") ?? "prefer",
    PGCONNECT_TIMEOUT: "15", PGAPPNAME: "amal-private-backup" };
}

export async function postgresTool(command: string, args: string[], connectionString: string, signal?: AbortSignal) {
  await new Promise<void>((done, fail) => {
    const child = spawn(command, args, {
      env: postgresEnvironment(connectionString), stdio: "ignore", signal,
    });
    child.once("error", () => fail(new Error("PostgreSQL tool failed; diagnostic output suppressed")));
    child.once("exit", code => code === 0 ? done() : fail(new Error("PostgreSQL tool failed; diagnostic output suppressed")));
  });
}

/** Content stays private: only counts and digests, never rows, enter the manifest. */
export async function databaseEvidence(client: pg.Client) {
  const { rows: names } = await client.query<{ schema: string; table: string }>(`
    SELECT n.nspname AS schema,c.relname AS table FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=ANY($1) AND c.relkind='r' ORDER BY 1,2`, [backupSchemas]);
  const tables: TableEvidence[] = [];
  for (const name of names) {
    const relation = `${quote(name.schema)}.${quote(name.table)}`;
    const { rows: [data] } = await client.query(`SELECT count(*)::integer AS count,
      encode(sha256(convert_to(coalesce(string_agg(row_to_json(t)::text,E'\\n'
        ORDER BY row_to_json(t)::text),''),'UTF8')),'hex') AS content
      FROM ${relation} t`);
    const { rows: columns } = await client.query(`SELECT attname,format_type(atttypid,atttypmod) AS type,
      attnotnull,attidentity,attgenerated,pg_get_expr(d.adbin,d.adrelid) AS default_value
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [relation]);
    tables.push({ ...name, ...data, definition: createHash("sha256").update(JSON.stringify(columns)).digest("hex") });
  }
  const { rows: relationships } = await client.query<BackupManifest["relationships"][number]>(`
    SELECT n.nspname AS schema,c.relname AS table,k.conname AS name,
      pg_get_constraintdef(k.oid) AS definition,k.convalidated AS validated
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE k.contype='f' AND n.nspname=ANY($1) ORDER BY 1,2,3`, [backupSchemas]);
  const { rows: objects } = await client.query(`
    SELECT 'index' AS kind,n.nspname AS schema,c.relname AS name,pg_get_indexdef(c.oid) AS definition
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind='i' AND n.nspname=ANY($1)
    UNION ALL
    SELECT 'trigger',n.nspname,c.relname||'.'||t.tgname,
      pg_get_triggerdef(t.oid)||';enabled='||t.tgenabled::text
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname=ANY($1)
    UNION ALL
    SELECT 'function',n.nspname,p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
      pg_get_functiondef(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE p.prokind='f' AND n.nspname=ANY($1)
    UNION ALL
    SELECT 'constraint',n.nspname,c.relname||'.'||k.conname,pg_get_constraintdef(k.oid)
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=ANY($1) AND k.contype<>'c'
    ORDER BY 1,2,3`, [backupSchemas]);
  // CHECK expressions containing BETWEEN can deparse with different associative
  // AND parentheses after pg_dump/restore. Do not mistake syntax for semantics:
  // pg_restore installs their original definitions before loading/validating rows.
  const { rows: checkConstraints } = await client.query<BackupManifest["checkConstraints"][number]>(`
    SELECT n.nspname AS schema,c.relname AS table,k.conname AS name,k.convalidated AS validated
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE k.contype='c' AND n.nspname=ANY($1) ORDER BY 1,2,3`, [backupSchemas]);
  return { tables, relationships, checkConstraints,
    schemaObjectDigests: objects.map(object => ({
      kind: object.kind, schema: object.schema, name: object.name,
      sha256: createHash("sha256").update(object.definition).digest("hex"),
    })),
    schemaObjectsSha256: createHash("sha256").update(JSON.stringify(objects)).digest("hex") };
}

export async function privateBackupRoot(path = "/tmp/amal-private-backups") {
  assert(isAbsolute(path), "Backup directory must be absolute");
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "Private real directory required");
  assert.equal(stat.uid, process.getuid?.(), "Backup directory must belong to this operator");
  assert.equal(stat.mode & 0o777, 0o700, "Backup directory requires mode 0700");
  const actual = await realpath(path);
  const inside = relative(await realpath(root), actual);
  assert(inside.startsWith("..") && isAbsolute(actual), "Backups must be outside the workspace and public roots");
  return actual;
}

export async function createBackup(options: {
  connectionString?: string; directory?: string;
  tool?: typeof postgresTool;
} = {}) {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  assert(connectionString, "Source database required");
  const directory = await privateBackupRoot(options.directory);
  const id = `backup-${randomUUID()}`;
  const partial = await mkdtemp(join(directory, ".partial-"));
  await chmod(partial, 0o700);
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  const client = new pg.Client({ connectionString, application_name: "amal-read-only-backup", connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL statement_timeout='120s'");
    // Fail closed if the scope no longer matches the documented application schemas.
    const { rows: schemas } = await client.query(`SELECT nspname FROM pg_namespace
      WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' ORDER BY nspname`);
    assert.deepEqual(schemas.map(r => r.nspname).sort(), [...backupSchemas].sort(), "Unexpected database schema; review backup scope");
    const evidence = await databaseEvidence(client);
    await client.query(`LOCK TABLE ${evidence.tables.map(t => `${quote(t.schema)}.${quote(t.table)}`).join(",")} IN ACCESS SHARE MODE`);
    const fingerprint = await seedFingerprint(client);
    const snapshot = (await client.query("SELECT pg_export_snapshot() AS snapshot")).rows[0].snapshot as string;
    const archive = join(partial, "database.dump");
    // Reserve with restrictive permissions before pg_dump opens it.
    await writeFile(archive, "", { mode: 0o600, flag: "wx" });
    await (options.tool ?? postgresTool)("pg_dump", [
      "--format=custom", "--no-password", "--strict-names", "--snapshot", snapshot,
      ...backupSchemas.flatMap(schema => ["--schema", schema]), "--file", archive,
    ], connectionString, controller.signal);
    assert(!controller.signal.aborted, "Backup interrupted");
    const manifest: BackupManifest = {
      version: 1, id, createdAt: new Date().toISOString(),
      consistency: "pg_export_snapshot; REPEATABLE READ READ ONLY; pg_dump --snapshot",
      schemas: backupSchemas, archiveSha256: await fileSha256(archive),
      sourceSeedFingerprint: fingerprint, ...evidence,
      restorePolicy: "Fresh isolated database only; omit auth_sessions/auth_devices data; disable user credentials; no application connections",
    };
    assert.equal(await seedFingerprint(client), fingerprint, "Source seed fingerprint changed");
    await client.query("COMMIT");
    // Separate current snapshot proves source invariance across the operation, not just within it.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert.equal(await seedFingerprint(client), fingerprint, "Source seeds changed during backup");
    await client.query("ROLLBACK");
    await writeFile(join(partial, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(partial, join(directory, id));
    return { path: join(directory, id), manifest };
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
    await client.end().catch(() => {});
    await rm(partial, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("/security-backup.ts")) {
  try {
    assert(process.argv.slice(2).length === 0, "Use environment configuration, not credential arguments");
    const result = await createBackup({ directory: process.env.AMAL_BACKUP_DIRECTORY });
    console.log(JSON.stringify({ backup: result.path, tables: result.manifest.tables.length, consistentSnapshot: true }));
  } catch {
    console.error("Backup failed; partial output removed. No database diagnostics or credentials emitted.");
    process.exitCode = 1;
  }
}

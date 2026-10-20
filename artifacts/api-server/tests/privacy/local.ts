/**
 * Explicit opt-in local preparation: copies schema only from DATABASE_URL.
 * Never copies data, runs seed import/reset, or changes the source database.
 * The whole local cluster is temporary and is stopped/removed by this owner.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, createHmac } from "node:crypto";
import net from "node:net";
import pg from "pg";

if (!process.env.DATABASE_URL || process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("A development prerequisite DATABASE_URL is required for read-only schema copying");
}
const command = process.argv[2];
if (!["test:privacy", "ci"].includes(command ?? "")) throw new Error("Expected test:privacy or ci");
const directory = mkdtempSync(join(tmpdir(), "amal-privacy-"));
const data = join(directory, "data");
const name = "amal_privacy_test_" + randomBytes(8).toString("hex");
const socket = net.createServer();
await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
const address = socket.address();
if (!address || typeof address === "string") throw new Error("Cannot reserve port");
const port = address.port;
await new Promise<void>(resolve => socket.close(() => resolve()));
let started = false;
let exitCode = 1;
const password = randomBytes(32).toString("hex");
const secret = randomBytes(32).toString("hex");
let stage = "schema dump";
try {
  // Capture errors without printing a source URL or potentially sensitive SQL.
  const source = new URL(process.env.DATABASE_URL);
  const schema = execFileSync("pg_dump", ["--schema-only", "--no-owner", "--schema=public", "--schema=operational", "--schema=seed_guard"],
    { env: { ...process.env, PGDATABASE: source.pathname.slice(1), PGHOST: source.hostname,
      PGPORT: source.port || "5432", PGUSER: decodeURIComponent(source.username), PGPASSWORD: decodeURIComponent(source.password) },
      stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
  stage = "initdb";
  execFileSync("initdb", ["-D", data, "-U", "privacy_owner", "--auth-local=trust", "--auth-host=scram-sha-256"],
    { stdio: "pipe" });
  stage = "start PostgreSQL";
  execFileSync("pg_ctl", ["-D", data, "-l", join(directory, "postgres.log"), "-o", `-k ${directory} -h 127.0.0.1 -p ${port}`, "-w", "start"],
    { stdio: "pipe" });
  started = true;
  stage = "create isolated roles";
  const owner = new pg.Client({ host: directory, port, user: "privacy_owner", database: "postgres" });
  await owner.connect();
  try {
    await owner.query("CREATE ROLE amal_seed_owner NOLOGIN; CREATE ROLE amal_demo_reset NOLOGIN; CREATE ROLE amal_app LOGIN; CREATE ROLE privacy_fixture LOGIN");
    await owner.query(`CREATE DATABASE ${name}`);
    await owner.query(`COMMENT ON DATABASE ${name} IS 'amal:disposable:privacy-tests:v1'`);
  } finally { await owner.end(); }
  const setup = new pg.Client({ host: directory, port, user: "privacy_owner", database: name });
  await setup.connect();
  try {
    // Newly created database only; empty default schema has no test/source resources.
    await setup.query("DROP SCHEMA public");
    // psql handles pg_dump's meta-commands, while ON_ERROR_STOP prevents partial setup.
    stage = "restore schema";
    execFileSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-h", directory, "-p", String(port), "-U", "privacy_owner", "-d", name],
      { input: schema, stdio: ["pipe", "pipe", "pipe"] });
    stage = "configure isolated privileges";
    const runtimePassword = createHmac("sha256", secret).update(`amal-app-database-login:/${name}`).digest("hex");
    // Values are generated hex, never external input.
    await setup.query(`ALTER ROLE privacy_fixture PASSWORD '${password}'; ALTER ROLE amal_app PASSWORD '${runtimePassword}'`);
    await setup.query(`GRANT USAGE ON SCHEMA public,operational TO privacy_fixture;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO privacy_fixture;
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA operational TO privacy_fixture;
      GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA operational TO privacy_fixture`);
  } finally { await setup.end(); }
  console.log("Prepared disposable local schema-only privacy database; no source rows copied.");
  const result = spawnSync("pnpm", ["--workspace-root", "run", command!], {
    env: { ...process.env, SESSION_SECRET: secret, NODE_ENV: "test",
      PRIVACY_TEST_DATABASE_URL: `postgresql://privacy_fixture:${password}@127.0.0.1:${port}/${name}` },
    stdio: "inherit",
  });
  exitCode = result.status ?? 1;
} catch (error) {
  if (stage === "restore schema" && error && typeof error === "object" && "stderr" in error) {
    console.error(String(error.stderr));
  }
  console.error(`Disposable privacy setup failed during ${stage}. Check local PostgreSQL tools and completed prerequisite schema. No source data was modified.`);
} finally {
  if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
  rmSync(directory, { recursive: true, force: true });
}
process.exitCode = exitCode;

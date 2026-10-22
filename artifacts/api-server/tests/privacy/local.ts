/**
 * Explicit opt-in local preparation: schema-only except approved specialized
 * audits, which initialize an isolated workbook baseline from read-only SELECTs.
 * Never copies operational/session/credential data or changes the source.
 * The whole local cluster is temporary and is stopped/removed by this owner.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHmac } from "node:crypto";
import net from "node:net";
import pg from "pg";
import { initializeWorkbookBaseline, snapshotHash, snapshotSeeds, verifySeedSeals } from "./workbook-baseline";

if (!process.env.DATABASE_URL || process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("A development prerequisite DATABASE_URL is required for read-only schema copying");
}
const command = process.argv[2];
const browserCommands = ["audit:booking", "audit:offline", "audit:performance", "audit:sync", "audit:appointments"];
const browserAudit = browserCommands.includes(command ?? "");
// Fixed filenames, not caller-provided shell fragments or arbitrary test globs.
// Keep the delivered suites' own deployment gates, assertions and fixtures.
const specializedSuites = {
  imports: ["import-validation", "import-merge-boundary", "import-db"],
  merge: ["merge-identity", "merge-db"],
  adoption: ["adoption-api", "adoption-results-api"],
  export: ["adoption-export", "adoption-export-db"],
  admin: ["admin-users", "admin-directory", "network-health"],
  kpis: ["kpis-aggregates", "kpis-api"],
  auth: ["auth"],
} as const;
type SpecializedSuite = keyof typeof specializedSuites;
const specializedCommands = Object.keys(specializedSuites).map(key => `audit:${key}`);
const specializedAudit = command === "audit:specialized" || specializedCommands.includes(command ?? "");
if (!["test:privacy", "test:doctor-calendar", "ci", ...browserCommands, ...specializedCommands, "audit:specialized"].includes(command ?? "")) {
  throw new Error(`Expected an explicitly allowlisted disposable audit command`);
}
if (specializedAudit && process.argv.length !== 3) throw new Error("Specialized audits do not accept test/filter overrides");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const evidenceDirectory = join(root, "generated-artifacts/bug-bash");
const summaryPath = specializedAudit ? join(evidenceDirectory, `specialized-${command!.slice(6)}-summary.log`) : undefined;
async function seedState(client: pg.Client) {
  return snapshotHash(await snapshotSeeds(client));
}
let sourceSeeds: string | undefined;
let baselineSnapshot: Awaited<ReturnType<typeof snapshotSeeds>> | undefined;
async function sourceSeedState() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const snapshot = await snapshotSeeds(client);
    if (!sourceSeeds) baselineSnapshot = snapshot;
    return snapshotHash(snapshot);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}
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
  if (specializedAudit) {
    stage = "read-only source seed fingerprint";
    sourceSeeds = await sourceSeedState();
  }
  stage = "schema dump";
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
    // Current operational grants also reference the developer reset identity.
    // It is inert here: never give this schema-restore placeholder LOGIN or
    // membership to the fixture/runtime users.
    await owner.query("CREATE ROLE amal_seed_owner NOLOGIN; CREATE ROLE amal_demo_reset NOLOGIN; CREATE ROLE amal_reset_login NOLOGIN; CREATE ROLE amal_app LOGIN; CREATE ROLE privacy_fixture LOGIN");
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
    if (specializedAudit) {
      stage = "initialize approved isolated workbook baseline";
      await initializeWorkbookBaseline(setup, name, baselineSnapshot!);
      baselineSnapshot!.clear();
      baselineSnapshot = undefined;
    }
    stage = "configure isolated privileges";
    const runtimePassword = createHmac("sha256", secret).update(`amal-app-database-login:/${name}`).digest("hex");
    // Values are generated hex, never external input.
    await setup.query(`ALTER ROLE privacy_fixture PASSWORD '${password}'; ALTER ROLE amal_app PASSWORD '${runtimePassword}'`);
    await setup.query(`GRANT USAGE ON SCHEMA public,operational TO privacy_fixture;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO privacy_fixture;
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA operational TO privacy_fixture;
      GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA operational TO privacy_fixture`);
    if (browserAudit || specializedAudit) {
      // Browser fixtures own scoped operational cleanup, unlike the restricted
      // privacy fixture. This identity exists only in this temporary cluster.
      await setup.query(`CREATE ROLE browser_fixture LOGIN PASSWORD '${password}';
        GRANT USAGE ON SCHEMA public,operational TO browser_fixture;
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO browser_fixture;
        GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA operational TO browser_fixture;
        GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA operational TO browser_fixture;
        GRANT amal_demo_reset TO browser_fixture`);
      if (command === "audit:sync") {
        // Failure-injection test owns its trigger only in this throwaway cluster.
        await setup.query(`GRANT CREATE ON SCHEMA operational TO browser_fixture;
          ALTER TABLE operational.sync_changes OWNER TO browser_fixture`);
      }
      if (command === "audit:appointments") {
        // Existing audit-failure injection requires a trigger on this isolated
        // table; runtime and source-database privileges remain unchanged.
        await setup.query(`GRANT CREATE ON SCHEMA operational TO browser_fixture;
          ALTER TABLE operational.audit_log OWNER TO browser_fixture`);
      }
      if (specializedAudit) {
        // Only the isolated fixture can create its delivered scratch schemas.
        // Runtime still authenticates independently as restricted amal_app.
        const selected = command === "audit:specialized" ? Object.keys(specializedSuites) : [command!.slice(6)];
        if (selected.includes("admin") || selected.includes("export")) {
          await setup.query(`GRANT CREATE ON DATABASE ${name} TO browser_fixture`);
        }
        if (selected.includes("adoption")) {
          await setup.query(`GRANT CREATE ON SCHEMA operational TO browser_fixture;
            ALTER TABLE operational.audit_log OWNER TO browser_fixture`);
        }
        if (selected.includes("admin")) {
          // Existing admin scratch-schema tests reuse this immutable-audit
          // trigger function. Only the disposable fixture needs to attach it.
          await setup.query("GRANT EXECUTE ON FUNCTION operational.guard_audit_log() TO browser_fixture");
        }
        if (selected.includes("imports")) {
          await setup.query(`GRANT CREATE ON SCHEMA operational TO browser_fixture;
            ALTER TABLE operational.import_batches OWNER TO browser_fixture`);
        }
        if (selected.includes("merge")) {
          await setup.query(`GRANT CREATE ON SCHEMA operational TO browser_fixture;
            GRANT REFERENCES ON operational.patients TO browser_fixture;
            ALTER TABLE operational.patient_visit_history OWNER TO browser_fixture`);
        }
      }
    }
  } finally { await setup.end(); }
  console.log(specializedAudit
    ? "Prepared owned disposable workbook baseline; only six read-only seed snapshots copied; fresh demo operational fixtures."
    : "Prepared disposable local schema-only privacy database; no source rows copied.");
  if (specializedAudit) {
    stage = "specialized regression audit";
    mkdirSync(evidenceDirectory, { recursive: true });
    const fixtureUrl = `postgresql://browser_fixture:${password}@127.0.0.1:${port}/${name}`;
    const fixture = new pg.Client({ connectionString: fixtureUrl });
    await fixture.connect();
    try {
      await fixture.query("SET TIME ZONE 'UTC'");
      await verifySeedSeals(fixture, ["browser_fixture", "privacy_fixture", "amal_app"]);
      const beforeSeeds = await seedState(fixture);
      if (beforeSeeds !== sourceSeeds) throw new Error("Source/target baseline hash mismatch");
      const selected = (command === "audit:specialized" ? Object.keys(specializedSuites) : [command!.slice(6)]) as SpecializedSuite[];
      let failed = false;
      const summary: string[] = [
        "Owned disposable specialized audit; approved read-only six-table workbook baseline; fresh demo population.",
        "Ordinary authorization mode; developer-generation mode is not covered.",
        "PASS pre-test byte-identical six source/target SHA-256 fingerprints and immutable seals/runtime read-only permissions.",
        "Commands: pnpm --filter @workspace/api-server exec tsx --test --test-concurrency=1 --test-reporter=tap tests/<allowlisted-file>.test.ts (serial).",
      ];
      const sanitize = (text: string) => {
        for (const value of [password, secret, fixtureUrl, process.env.DATABASE_URL!]) text = text.split(value).join("[REDACTED]");
        return text.replace(/postgres(?:ql)?:\/\/[^\s'"]+/g, "[REDACTED_DATABASE_URL]")
          .replace(/(?:amal_session|amal_device)=[^;\s'"]+/g, "[REDACTED_COOKIE]")
          .replace(/[a-f0-9]{64}/gi, "[REDACTED_DIGEST]");
      };
      for (const suite of selected) {
        const lines: string[] = [];
        for (const file of specializedSuites[suite]) {
          if (!existsSync(join(root, `artifacts/api-server/tests/${file}.test.ts`))) {
            failed = true;
            lines.push(`FAIL ${file}: delivered suite file missing`);
            continue;
          }
          const result = spawnSync("pnpm", ["--filter", "@workspace/api-server", "exec", "tsx", "--test",
            "--test-concurrency=1", "--test-reporter=tap", `tests/${file}.test.ts`], {
            cwd: root,
            env: { ...process.env, DATABASE_URL: fixtureUrl, SESSION_SECRET: secret, NODE_ENV: "test",
              AMAL_DEVELOPER_TOOLS: "0", LOG_LEVEL: "silent" },
            encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
          });
          const output = sanitize(`${result.stdout ?? ""}${result.stderr ?? ""}`);
          // TAP assertion payloads can contain records/SQL. Persist structural
          // diagnostics only, never raw test output, even on a failing assertion.
          const safeOutput = output.split("\n").filter(line =>
            /^# (?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) [\d.]+$/.test(line)
            || /^\s*(?:not ok|ok) \d+ - [a-zA-Z][a-zA-Z0-9 ,:;()/_—–.'+-]*$/.test(line)
            || /^\s*(?:type:|failureType:|code:|operator:|location:) [a-zA-Z0-9_/'":. -]+$/.test(line)
            || /^\s+(?:at .* )?\(?file:\/\/\/home\/runner\/workspace\/[a-zA-Z0-9_/.:-]+\)?$/.test(line)
          ).join("\n") + "\n" + (output.match(/\/home\/runner\/workspace\/[a-zA-Z0-9_/.-]+\.test\.ts:\d+:\d+/g) ?? []).join("\n") + "\n";
          writeFileSync(join(evidenceDirectory, `specialized-${file}.log`), safeOutput);
          // Missing/skipped/cancelled tests never count as a passing audit.
          const passed = result.status === 0 && /# tests [1-9]\d*/.test(output)
            && /# skipped 0\b/.test(output) && /# cancelled 0\b/.test(output);
          if (!passed) failed = true;
          const counts = output.match(/^# (?:tests|pass|fail|cancelled|skipped) \d+$/gm)?.join(", ") ?? "no test counts";
          lines.push(`${passed ? "PASS" : "FAIL"} ${file}: exit ${result.status ?? "not-started"}; ${counts}; see specialized-${file}.log`);
          if (await seedState(fixture) !== sourceSeeds) throw new Error("Disposable seed fingerprint changed during suite");
          await verifySeedSeals(fixture, ["browser_fixture", "privacy_fixture", "amal_app"]);
        }
        summary.push(...lines);
        console.log(lines.join("\n"));
      }
      if (await seedState(fixture) !== beforeSeeds) throw new Error("Disposable seed fingerprint changed");
      if (await sourceSeedState() !== sourceSeeds) throw new Error("Source seed fingerprint changed");
      summary.push("PASS read-only before/after fingerprints: all six source and disposable seeds unchanged.");
      summary.push("PASS post-suite immutable seed triggers, owner and read-only runtime/fixture permissions.");
      summary.push(`Overall exit ${failed ? 1 : 0}: ${failed ? "FAIL" : "PASS"}.`);
      writeFileSync(summaryPath!, summary.join("\n") + "\n");
      exitCode = failed ? 1 : 0;
    } finally { await fixture.end(); }
  } else {
  const browserConfig = command === "audit:offline" ? "playwright.offline.config.ts"
    : command === "audit:performance" ? "playwright.performance.config.ts" : "playwright.audit-booking.config.ts";
  const result = spawnSync("pnpm", command === "test:doctor-calendar"
    ? ["--filter", "@workspace/api-server", "exec", "tsx", "--test", "--test-concurrency=1",
      "--test-name-pattern=^doctor calendar:", "tests/privacy-api.test.ts"]
    : command === "audit:sync" || command === "audit:appointments"
    ? ["--filter", "@workspace/api-server", "run", command === "audit:sync" ? "sync:test" : "appointments:test"]
    : browserAudit
    ? ["--workspace-root", "exec", "playwright", "test", "--config", browserConfig, ...process.argv.slice(3)]
    : ["--workspace-root", "run", command!], {
    // This suite tests ordinary (non-demo) authorization. Its schema-only
    // database has no demo generation and requests do not carry generation
    // headers. Never inherit the workspace's optional developer-mode gate.
    // Developer reset/outage coverage remains in its separate owned suite.
    env: { ...process.env, SESSION_SECRET: secret, NODE_ENV: browserAudit ? "development" : "test", AMAL_DEVELOPER_TOOLS: "0",
      ...(browserAudit ? {
        DATABASE_URL: `postgresql://browser_fixture:${password}@127.0.0.1:${port}/${name}`,
        AMAL_BOOKING_DISPOSABLE: "1", AMAL_OFFLINE_E2E: "1",
        AUTH_ALLOWED_ORIGINS: "http://127.0.0.1:4189",
      } : {}),
      PRIVACY_TEST_DATABASE_URL: `postgresql://privacy_fixture:${password}@127.0.0.1:${port}/${name}` },
    stdio: "inherit",
  });
  exitCode = result.status ?? 1;
  }
} catch (error) {
  console.error(`Disposable privacy setup failed during ${stage}. Check local PostgreSQL tools and completed prerequisite schema. No source data was modified.`);
} finally {
  baselineSnapshot?.clear();
  if (specializedAudit && sourceSeeds) {
    try {
      if (await sourceSeedState() !== sourceSeeds) throw new Error("Source fingerprint changed");
    } catch {
      exitCode = 1;
      const failure = "FAIL final read-only source verification; no raw diagnostics retained.";
      console.error(failure);
      if (summaryPath && existsSync(summaryPath)) appendFileSync(summaryPath, failure + "\n");
    }
  }
  if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
  rmSync(directory, { recursive: true, force: true });
  if (specializedAudit) {
    const cleanup = "Cleanup: owned temporary PostgreSQL cluster stopped and directory removed.";
    console.log(cleanup);
    if (summaryPath && existsSync(summaryPath)) appendFileSync(summaryPath, cleanup + "\n");
  }
}
process.exitCode = exitCode;

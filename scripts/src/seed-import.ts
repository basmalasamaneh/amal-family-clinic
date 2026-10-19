import pg from "pg";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dbValue, readSource, root, tables, zone } from "./seed-source";
import { runtimeConnectionString } from "@workspace/db/runtime-connection";

const sheets = readSource();
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(761900)");
  const existing = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1)", [tables.map(t => t.name)]);
  assert([0, tables.length].includes(existing.rowCount!), "Partial seed installation: stop, do not replace");
  const initial = existing.rowCount === 0;
  if (initial) {
    assert(process.argv.includes("--initialize"), "Empty seeds: explicit --initialize required");
    for (const t of tables) {
      await client.query(`CREATE TABLE public.${t.name} (${t.columns.map((c, i) => `${c.name} ${c.type} NOT NULL${i === 0 ? " PRIMARY KEY" : ""}`).join(",")})`);
      for (const row of sheets[t.name]!.rows) {
        await client.query(`INSERT INTO public.${t.name} VALUES (${row.map((_, i) => `$${i + 1}`).join(",")})`,
          row.map((v, i) => dbValue(t.columns[i]!.type, v)));
      }
    }
  }
  for (const t of tables) {
    const columns = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [t.name]);
    assert.deepEqual(columns.rows, t.columns.map(c => ({column_name:c.name,data_type:c.type === "timestamptz" ? "timestamp with time zone" : c.type})));
    const expressions = t.columns.map(c => c.type === "timestamptz"
      ? `to_char(${c.name} AT TIME ZONE '${zone}', 'YYYY-MM-DD"T"HH24:MI:SS') AS ${c.name}`
      : c.type === "date" ? `to_char(${c.name}, 'YYYY-MM-DD') AS ${c.name}` : c.name);
    const actual = await client.query(`SELECT ${expressions.join(",")} FROM public.${t.name} ORDER BY ${t.columns[0]!.name}`);
    const expected = [...sheets[t.name]!.rows].sort((a,b) => Number(a[0])-Number(b[0]));
    assert.deepEqual(actual.rows.map(r => t.columns.map(c => r[c.name])), expected, `${t.name}: source mismatch; refusing changes`);
    for (const c of t.columns.filter(c=>c.type==="timestamptz")) {
      const fractional = await client.query(`SELECT count(*) AS n FROM public.${t.name} WHERE ${c.name}<>date_trunc('second',${c.name})`);
      assert.equal(fractional.rows[0].n,"0","Unexpected subsecond source difference");
    }
    console.log(`${t.name}: ${actual.rowCount} rows, every cell verified`);
  }
  if (initial) {
    await client.query(readFileSync(root + "docs/data/seed-protection.sql", "utf8"));
    // ALTER ROLE cannot bind password parameters. The derived password is
    // strictly hexadecimal, validated before interpolation, and never logged.
    const password = new URL(runtimeConnectionString()).password;
    assert.match(password, /^[a-f0-9]{64}$/);
    await client.query(`ALTER ROLE amal_app LOGIN PASSWORD '${password}'`);
    for (const t of tables) {
      await client.query(`CREATE TRIGGER immutable_seed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.${t.name} FOR EACH STATEMENT EXECUTE FUNCTION seed_guard.reject_write();
        ALTER TABLE public.${t.name} ENABLE ALWAYS TRIGGER immutable_seed;
        ALTER TABLE public.${t.name} OWNER TO amal_seed_owner;
        REVOKE ALL ON public.${t.name} FROM PUBLIC, amal_app;
        GRANT SELECT ON public.${t.name} TO amal_app;`);
    }
  } else {
    for (const t of tables) {
      const protection = await client.query(`SELECT pg_get_userbyid(c.relowner) owner, tr.tgenabled
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_trigger tr ON tr.tgrelid=c.oid AND tr.tgname='immutable_seed'
        WHERE n.nspname='public' AND c.relname=$1`, [t.name]);
      assert.deepEqual(protection.rows, [{owner:"amal_seed_owner",tgenabled:"A"}], "Seed protection missing; refusing to repair silently");
    }
  }
  const role = await client.query("SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname='amal_app'");
  assert.deepEqual(role.rows, [{rolcanlogin:true,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolbypassrls:false}]);
  await client.query("COMMIT");
  console.log(initial ? "Initial load committed and protected." : "Verification-only rerun: no seed or schema writes.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally { await client.end(); }

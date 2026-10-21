import { createHash } from "node:crypto";
import type pg from "pg";
import { populate } from "../../../../scripts/src/demo-populate";
import { transaction } from "../../../../scripts/src/operational-support";

export const seedTables = ["clinics", "doctors", "patients", "appointments", "patient_visit_history", "calendar_app_export"] as const;
type Snapshot = Map<string, string[]>;

/** Text JSON is retained only in memory; PostgreSQL, not JS, round-trips dates/numbers. */
export async function snapshotSeeds(client: pg.Client): Promise<Snapshot> {
  const snapshot: Snapshot = new Map();
  for (const table of seedTables) {
    const result = await client.query(`SELECT row_to_json(t)::text AS document
      FROM public.${table} t ORDER BY row_to_json(t)::text COLLATE "C"`);
    snapshot.set(table, result.rows.map(row => row.document as string));
  }
  return snapshot;
}

export function snapshotHash(snapshot: Snapshot) {
  // One independently comparable hash per original sheet, never printed.
  return JSON.stringify(seedTables.map(table => [table,
    createHash("sha256").update(JSON.stringify(snapshot.get(table))).digest("hex")]));
}

/**
 * Only the owner of a newly-created, marked, empty local cluster may initialize.
 * No source operational tables, sessions, passwords or devices are ever read.
 */
export async function initializeWorkbookBaseline(client: pg.Client, database: string, snapshot: Snapshot) {
  const { rows: [identity] } = await client.query(`SELECT current_database() AS name,
    current_user AS owner, inet_server_addr() IS NULL AS local_socket,
    shobj_description(oid,'pg_database') AS marker
    FROM pg_database WHERE datname=current_database()`);
  if (identity.name !== database || identity.owner !== "privacy_owner" || !identity.local_socket
    || identity.marker !== "amal:disposable:privacy-tests:v1"
    || !/^amal_privacy_test_[a-f0-9]{16}$/.test(database)) throw new Error("Not an owned disposable database");
  for (const { table_schema, table_name } of (await client.query(`SELECT table_schema,table_name
    FROM information_schema.tables WHERE table_schema IN ('public','operational')
    AND table_type='BASE TABLE'`)).rows) {
    const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
    if ((await client.query(`SELECT EXISTS(SELECT 1 FROM ${identifier(table_schema)}.${identifier(table_name)}) AS populated`)).rows[0].populated) {
      throw new Error("Disposable baseline initialization requires empty tables");
    }
  }
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    for (const table of seedTables) {
      await client.query(`ALTER TABLE public.${table} DISABLE TRIGGER immutable_seed`);
      for (const document of snapshot.get(table) ?? []) {
        await client.query(`INSERT INTO public.${table} SELECT * FROM json_populate_record(NULL::public.${table},$1::json)`, [document]);
      }
      await client.query(`ALTER TABLE public.${table} ENABLE ALWAYS TRIGGER immutable_seed;
        ALTER TABLE public.${table} OWNER TO amal_seed_owner;
        REVOKE ALL ON public.${table} FROM PUBLIC,amal_app,privacy_fixture;
        GRANT SELECT ON public.${table} TO amal_app,privacy_fixture`);
    }
    if (snapshotHash(await snapshotSeeds(client)) !== snapshotHash(snapshot)) throw new Error("Disposable baseline hash mismatch");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  // The established population path creates fresh demo accounts, not source credentials.
  await transaction(client, () => populate(client));
}

export async function verifySeedSeals(client: pg.Client, roles: string[]) {
  for (const table of seedTables) {
    const { rows: [seal] } = await client.query(`SELECT pg_get_userbyid(c.relowner) AS owner,t.tgenabled
      FROM pg_class c JOIN pg_trigger t ON t.tgrelid=c.oid AND t.tgname='immutable_seed'
      WHERE c.oid=$1::regclass`, [`public.${table}`]);
    if (seal?.owner !== "amal_seed_owner" || seal.tgenabled !== "A") throw new Error("Disposable seed seal missing");
    for (const role of roles) {
      const { rows: [permissions] } = await client.query(`SELECT
        has_table_privilege($1,$2,'SELECT') AS readable,
        has_table_privilege($1,$2,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') AS writable,
        pg_has_role($1,'amal_seed_owner','MEMBER') AS owns_seed`, [role, `public.${table}`]);
      if (!permissions.readable || permissions.writable || permissions.owns_seed) throw new Error("Unsafe isolated seed permissions");
    }
  }
}

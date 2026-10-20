import assert from "node:assert/strict";
import pg from "pg";

// Run before importing app/db modules: never fall back to the workspace database.
export async function configurePrivacyDatabase() {
  assert(process.env.NODE_ENV !== "production" && process.env.REPLIT_DEPLOYMENT !== "1",
    "Privacy tests are prohibited in deployments");
  const target = process.env.PRIVACY_TEST_DATABASE_URL;
  assert(target, "PRIVACY_TEST_DATABASE_URL is required; use an explicitly disposable database (docs/privacy-tests.md)");
  const url = new URL(target);
  assert(/^\/amal_privacy_test_[a-z0-9_]+$/.test(url.pathname), "Refusing database without amal_privacy_test_ prefix");
  assert(!url.search, "Privacy database URL must not contain connection-option overrides");
  if (process.env.DATABASE_URL) {
    const shared = new URL(process.env.DATABASE_URL);
    assert(!(shared.hostname === url.hostname && (shared.port || "5432") === (url.port || "5432")
      && shared.pathname === url.pathname), "Refusing workspace/shared database");
  }
  const client = new pg.Client({ connectionString: target });
  try {
    await client.connect();
    const { rows: [identity] } = await client.query(`SELECT current_database() AS name,
      shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()`);
    assert.equal(identity.name, url.pathname.slice(1));
    assert.equal(identity.marker, "amal:disposable:privacy-tests:v1");
    const { rows: [role] } = await client.query(`SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls
      FROM pg_roles WHERE rolname=current_user`);
    assert.deepEqual(role, { rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false },
      "Fixture connection must be restricted, not an administrator");
    const privileged = await client.query(`SELECT rolname FROM pg_roles WHERE
      (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolname IN ('amal_seed_owner','amal_demo_reset'))
      AND pg_has_role(current_user,oid,'MEMBER')`);
    assert.equal(privileged.rowCount, 0, "Fixture role cannot inherit/reset into privileged roles");
    for (const table of ["clinics", "doctors", "patients", "appointments", "patient_visit_history", "calendar_app_export"]) {
      const { rows: [r] } = await client.query(`SELECT
        has_table_privilege(current_user,$1,'SELECT') AS readable,
        has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') AS writable`, [`public.${table}`]);
      assert.deepEqual(r, { readable: true, writable: false }, `Seed permissions: ${table}`);
    }
    for (const table of ["patient_consents", "audit_log", "auth_sessions", "patient_doctor_access", "visit_alerts"]) {
      assert((await client.query("SELECT to_regclass($1) AS name", [`operational.${table}`])).rows[0].name,
        `Missing prerequisite operational.${table}; do not implement migrations in the test suite`);
    }
  } finally {
    await client.end();
  }
  process.env.DATABASE_URL = target;
}

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resetConnectionString } from "@workspace/db/reset-connection";
import { adminClient, requireDemo, transaction } from "./operational-support";
import { root } from "./seed-source";

requireDemo();
if (process.env.AMAL_DEVELOPER_TOOLS !== "1") throw new Error("AMAL_DEVELOPER_TOOLS=1 required");
const client = adminClient();
await client.connect();
try {
  await transaction(client, async () => {
    const sql = readFileSync(root + "lib/db/migrations/0015_developer_tools.sql", "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await client.query("SELECT checksum FROM operational_meta.migrations WHERE version='0015'");
    if (existing.rowCount && existing.rows[0].checksum !== checksum) throw new Error("Developer migration checksum mismatch");
    if (!existing.rowCount) {
      await client.query(sql);
      await client.query("INSERT INTO operational_meta.migrations(version,checksum) VALUES('0015',$1)", [checksum]);
    }
    const password = decodeURIComponent(new URL(resetConnectionString()).password);
    // Password is a derived hex digest, not interpolated request input.
    if (!/^[a-f0-9]{64}$/.test(password)) throw new Error("Invalid reset credential");
    await client.query(`ALTER ROLE amal_reset_login PASSWORD '${password}'`);
    const unsafe = await client.query(`SELECT 1 FROM pg_auth_members m
      WHERE m.member='amal_reset_login'::regrole
      AND m.roleid NOT IN ('amal_demo_reset'::regrole,'amal_app'::regrole)`);
    if (unsafe.rowCount) throw new Error("Reset login has unexpected role membership");
    const { rows: [roles] } = await client.query(`SELECT
      pg_has_role('amal_reset_login','amal_seed_owner','MEMBER') AS seed_owner,
      pg_has_role('amal_app','amal_demo_reset','MEMBER') AS runtime_reset`);
    if (roles.seed_owner || roles.runtime_reset) throw new Error("Unsafe reset role membership");
    for (const table of ["clinics","doctors","patients","appointments","patient_visit_history","calendar_app_export"]) {
      const { rows: [permissions] } = await client.query(`SELECT
        has_table_privilege('amal_reset_login',$1,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') AS unsafe`, [`public.${table}`]);
      if (permissions.unsafe) throw new Error("Reset login can mutate immutable source");
    }
  });
  console.log("Developer-tools migration installed; source fingerprint unchanged.");
} finally { await client.end(); }

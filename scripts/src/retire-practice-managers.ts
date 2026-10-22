/** Owner-approved retirement of the three extra practice administrator accounts. */
import assert from "node:assert/strict";
import { adminClient, requireDemo, seedFingerprint, transaction } from "./operational-support";

requireDemo();
const emails = ["manager.1@amal.example", "manager.2@amal.example", "manager.3@amal.example"];
const client = adminClient();
await client.connect();
try {
  const result = await transaction(client, async () => {
    await client.query("SELECT pg_advisory_xact_lock_shared(761930)");
    await client.query("SELECT pg_advisory_xact_lock(31030,1)");
    const before = await seedFingerprint(client);
    const users = (await client.query(`SELECT id,email,role,clinic_id,fixture_key,disabled_at
      FROM operational.users WHERE email=ANY($1) ORDER BY id FOR UPDATE`, [emails])).rows;
    assert.equal(users.length, 3, "All three explicit practice accounts must exist");
    assert(users.every(u => u.role === "administrator" && u.clinic_id !== null &&
      u.fixture_key === `practice.clinic-admin.${u.clinic_id}`), "Target identity changed; refusing");
    const ids = users.map(u => u.id);
    const otherAuthority = async () => (await client.query(`SELECT md5(COALESCE(jsonb_agg(
      jsonb_build_array(id,role,clinic_id,doctor_id,disabled_at,auth_version,password_hash,pin_hash)
      ORDER BY id)::text,'')) AS fingerprint FROM operational.users WHERE NOT(id=ANY($1))`, [ids])).rows[0].fingerprint;
    const grants = async () => (await client.query(`SELECT
      (SELECT md5(COALESCE(jsonb_agg(to_jsonb(m) ORDER BY clinic_id,user_id)::text,'')) FROM operational.clinic_managers m) managers,
      (SELECT md5(COALESCE(jsonb_agg(to_jsonb(s) ORDER BY clinic_id,user_id)::text,'')) FROM operational.network_coordinator_scope s) coordinators`)).rows[0];
    const otherBefore = await otherAuthority(), grantsBefore = await grants();
    const auditsBefore = (await client.query("SELECT id FROM operational.audit_log WHERE user_id=ANY($1) ORDER BY id", [ids])).rows;
    await client.query("UPDATE operational.users SET disabled_at=COALESCE(disabled_at,clock_timestamp()) WHERE id=ANY($1)", [ids]);
    await client.query("UPDATE operational.auth_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE user_id=ANY($1)", [ids]);
    if (users.some(u => u.disabled_at === null)) {
      await client.query(`INSERT INTO operational.audit_log(action,detail)
        VALUES('practice.managers.retired',$1::jsonb)`,
        [JSON.stringify({ targetUserIds: ids, reason: "Owner approved deactivation; preserve audit history" })]);
    }
    assert.equal((await client.query("SELECT 1 FROM operational.users WHERE id=ANY($1) AND disabled_at IS NULL", [ids])).rowCount, 0);
    assert.equal((await client.query("SELECT 1 FROM operational.auth_sessions WHERE user_id=ANY($1) AND revoked_at IS NULL", [ids])).rowCount, 0);
    assert.equal(await otherAuthority(), otherBefore);
    assert.deepEqual(await grants(), grantsBefore);
    assert.deepEqual((await client.query("SELECT id FROM operational.audit_log WHERE user_id=ANY($1) ORDER BY id", [ids])).rows, auditsBefore);
    assert.equal(await seedFingerprint(client), before);
    return { accounts: emails, disabled: 3, unrevokedSessions: 0, retainedAuditRows: auditsBefore.length,
      otherAccountsUnchanged: true, doctorDelegationsUnchanged: true, seedsUnchanged: true };
  });
  console.log(JSON.stringify(result, null, 2));
} finally { await client.end(); }

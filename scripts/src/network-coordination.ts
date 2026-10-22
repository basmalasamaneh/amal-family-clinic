/** Targeted development operator command. Never changes accounts or sessions. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { adminClient, requireDemo, seedFingerprint } from "./operational-support";
import { root } from "./seed-source";

requireDemo();
const args = process.argv.slice(2);
const action = args[0];
assert(["migrate", "grant", "revoke", "verify"].includes(action!), "Expected migrate|grant|revoke|verify");
assert(args.every((arg, i) => i === 0 || arg === "--demo" || /^(--user-id=|--email=|--clinics=)/.test(arg)), "Unknown argument");
const option = (name: string) => {
  const found = args.filter(arg => arg.startsWith(`--${name}=`));
  assert(found.length <= 1, `Duplicate ${name}`);
  return found[0]?.slice(name.length + 3);
};
const userId = option("user-id"), email = option("email"), rawClinics = option("clinics");
const client = adminClient();
await client.connect();
try {
  await client.query(action === "verify" ? "BEGIN READ ONLY" : "BEGIN");
  await client.query("SELECT pg_advisory_xact_lock_shared(761930)");
  await client.query(action === "verify" ? "SELECT pg_advisory_xact_lock_shared(160005)" : "SELECT pg_advisory_xact_lock(160005)");
  const before = await seedFingerprint(client);
  if (action === "migrate") {
    assert(!userId && !email && !rawClinics, "Migration accepts no identity/scope selectors");
    const sql = readFileSync(root + "lib/db/migrations/0018_network_coordination.sql", "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const { rows: [prior] } = await client.query("SELECT checksum FROM operational_meta.migrations WHERE version='0018'");
    assert(!prior || prior.checksum === checksum, "Migration checksum mismatch");
    if (!prior) {
      await client.query(sql);
      await client.query("INSERT INTO operational_meta.migrations(version,checksum) VALUES('0018',$1)", [checksum]);
    }
  } else {
    assert(Boolean(userId) !== Boolean(email), "Choose exactly one --user-id or --email");
    assert(!userId || /^[1-9]\d*$/.test(userId), "Invalid user ID");
    assert(rawClinics && /^[1-9]\d*(,[1-9]\d*)*$/.test(rawClinics), "Explicit --clinics=ID,ID required");
    const clinicIds = rawClinics.split(",").map(Number).sort((a,b)=>a-b);
    assert(clinicIds.every(id => Number.isSafeInteger(id) && id <= 2147483647) && new Set(clinicIds).size === clinicIds.length, "Invalid/duplicate clinic IDs");
    const { rows: [user] } = await client.query(`SELECT u.id,u.clinic_id FROM operational.users u
      JOIN operational.doctors d ON d.user_id=u.id AND d.doctor_id=u.doctor_id AND d.clinic_id=u.clinic_id
      WHERE ${userId ? "u.id=$1" : "u.email=$1"} AND u.role='doctor' AND u.disabled_at IS NULL
      ${action === "verify" ? "" : "FOR SHARE OF u"}`, [userId ?? email]);
    assert(user, "Active linked doctor required");
    assert(clinicIds.includes(user.clinic_id), "Approved scope must include local home clinic");
    assert.equal((await client.query("SELECT clinic_id FROM operational.clinics WHERE clinic_id=ANY($1::int[])", [clinicIds])).rowCount, clinicIds.length, "Unknown approved clinic");
    const current = (await client.query("SELECT clinic_id FROM operational.network_coordinator_scope WHERE user_id=$1 ORDER BY clinic_id", [user.id])).rows.map(r=>r.clinic_id);
    if (action === "grant") {
      assert(current.every(id=>clinicIds.includes(id)), "Existing broader scope; revoke explicitly before replacement");
      for (const id of clinicIds) await client.query("INSERT INTO operational.network_coordinator_scope(user_id,clinic_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [user.id,id]);
    } else if (action === "revoke") {
      assert.deepEqual(current, clinicIds, "Revoke must name exact current scope");
      await client.query("DELETE FROM operational.network_coordinator_scope WHERE user_id=$1", [user.id]);
    } else assert.deepEqual(current, clinicIds, "Scope does not match approved clinics");
    if (action !== "verify") await client.query(`INSERT INTO operational.audit_log(user_id,action,detail)
      VALUES($1,$2,$3::jsonb)`, [user.id, `network.coordinator.${action}`, JSON.stringify({ clinicIds, operator: "development-cli" })]);
    console.log(JSON.stringify({ action, userId: user.id, clinicIds }));
  }
  assert.equal(await seedFingerprint(client), before, "Immutable seed fingerprint changed");
  await client.query("COMMIT");
  console.log("Verified: immutable seeds unchanged.");
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { await client.end(); }

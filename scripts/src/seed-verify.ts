import pg from "pg";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { baseline } from "./baseline";
import { root, tables } from "./seed-source";
import { runtimeConnectionString } from "@workspace/db/runtime-connection";

// Reruns never initialize, repair, or mutate. Any mismatch is a hard error.
for (let i=0; i<2; i++) execFileSync("pnpm", ["exec","tsx","src/seed-import.ts"], {cwd: root+"scripts",stdio:"inherit"});
let client = new pg.Client({connectionString:runtimeConnectionString()});
await client.connect();
async function denied(sql: string) {
  await client.query("SAVEPOINT blocked_write");
  let code: string | undefined;
  try { await client.query(sql); } catch (e) { code = (e as {code:string}).code; }
  await client.query("ROLLBACK TO SAVEPOINT blocked_write");
  assert.equal(code, "42501", `Expected protection: ${sql}`);
}
try {
  await client.query("BEGIN");
  assert.deepEqual((await client.query("SELECT current_user, session_user")).rows,
    [{current_user:"amal_app",session_user:"amal_app"}]);
  await denied("SET ROLE postgres");
  await denied("SET SESSION AUTHORIZATION postgres");
  await denied("SET ROLE amal_seed_owner");
  await client.query("RESET ROLE");
  assert.equal((await client.query("SELECT current_user")).rows[0].current_user,"amal_app");
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  const q = await baseline(client);
  await client.query("SET LOCAL TIME ZONE 'America/Los_Angeles'");
  assert.deepEqual(await baseline(client), q, "Session timezone changes baseline");
  assert.deepEqual(q.Q01!.map(r=>Number(r.rows)), [3,5,25,102,32,24]);
  assert.deepEqual(q.Q02!.map(r=>[r.clinic_id,Number(r.appointments),Number(r.no_shows),Number(r.no_show_percent)]),
    [[1,36,8,22.2],[2,33,6,18.2],[3,33,8,24.2],[null,102,22,21.6]]);
  assert.equal(q.Q03!.length,6);
  assert.equal(new Set(q.Q03!.flatMap(r=>[r.appointment_a,r.appointment_b])).size,12);
  assert.equal(q.Q03!.filter(r=>r.both_flagged).length,1);
  assert.equal(q.Q03!.filter(r=>r.neither_flagged).length,5);
  assert.equal(q.Q03!.flatMap(r=>[r.status_a,r.status_b]).filter(s=>s==="double_booked").length,2);
  assert.deepEqual(q.Q04!.map(r=>[r.patient_id,r.local_start]),[[1,"2026-09-12 12:45"],[13,"2026-09-09 10:45"]]);
  assert.equal(q.Q05!.length,14);
  assert.deepEqual(q.Q06,[{roster_patients:"25",patients_with_visits:"16",multi_clinic_visit_patients:"6",without_visits:"9",visits:"32",first_visit:"2026-01-02",last_visit:"2026-08-27"}]);
  assert.deepEqual(q.Q07!.map(r=>[r.booking_method,Number(r.appointments),r.first_day,r.last_day,r.on_15_minute_grid]),
    [["calendar_app",33,"2026-09-08","2026-09-13",true],["phone",48,"2026-09-08","2026-09-13",true],["walk-in",21,"2026-09-08","2026-09-13",true]]);
  assert.equal(q.Q08!.length,2);
  assert(q.Q08!.every(r=>Number(r.candidate_count)===1),"Unresolved mapping ambiguity");
  assert.deepEqual(q.Q08!.map(r=>[r.doctor_email,r.doctor_ids]),[
    ["rula@amalclinics-nablusroad.example",[5]],["yasmin@amalclinics-nablusroad.example",[3]]]);
  assert.equal(q.Q09!.length,24);
  assert.equal(new Set(q.Q09!.map(r=>r.event_id)).size,24);
  assert.equal(q.Q09!.filter(r=>r.exact_name_suggestion).length,3);
  assert.equal(q.Q09!.filter(r=>r.doctor_start_match).length,5);
  assert(q.Q09!.every(r=>r.requires_manual_review && r.doctor_id!==null));
  assert.deepEqual(q.Q10,[{events:"24",all_30_minutes:true,collision_pairs:"3"}]);
  assert.deepEqual(q.Q11,[{appointment_statuses:["booked","completed","double_booked","no_show"],export_statuses:["cancelled","completed","confirmed"],born_2008_or_later:"6",doctor_clinic_mismatches:"0"}]);
  assert.equal(q.Q12!.length,3);
  const confirmedPairs = q.Q12!.filter(r=>r.status_a==="confirmed" && r.status_b==="confirmed");
  assert.equal(confirmedPairs.length,1);
  assert.equal(confirmedPairs[0]!.local_start,"2026-09-13 09:00");
  for (const t of tables) {
    const id = t.columns[0]!.name;
    // Zero-row operations exercise statement protection without targeting seed rows.
    for (const sql of [
      `INSERT INTO public.${t.name} SELECT * FROM public.${t.name} WHERE false`,
      `UPDATE public.${t.name} SET ${id}=${id} WHERE false`,
      `DELETE FROM public.${t.name} WHERE false`,
      `TRUNCATE public.${t.name}`, `DROP TABLE public.${t.name} CASCADE`,
      `ALTER TABLE public.${t.name} DISABLE TRIGGER ALL`,
    ]) await denied(sql);
  }
  await client.query("ROLLBACK");
  await client.end();
  client = new pg.Client({connectionString:process.env.DATABASE_URL});
  await client.connect();
  await client.query("BEGIN");
  // Isolated transactional fixture proves the same trigger blocks writes even
  // when privileges/ownership would otherwise allow them; never mutate seeds.
  await client.query("CREATE TEMP TABLE seed_guard_probe (id integer)");
  await client.query("INSERT INTO seed_guard_probe VALUES (1)");
  await client.query("CREATE TRIGGER immutable_seed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON seed_guard_probe FOR EACH STATEMENT EXECUTE FUNCTION seed_guard.reject_write()");
  await client.query("ALTER TABLE seed_guard_probe ENABLE ALWAYS TRIGGER immutable_seed");
  for (const sql of ["INSERT INTO seed_guard_probe VALUES (2)", "UPDATE seed_guard_probe SET id=2", "DELETE FROM seed_guard_probe", "TRUNCATE seed_guard_probe"]) await denied(sql);
  assert.deepEqual((await client.query("SELECT * FROM seed_guard_probe")).rows,[{id:1}]);
  await client.query("ROLLBACK");
  console.log("PASS: all Q01–Q12 metrics, two verification-only reruns, timezone invariance, six-table runtime protection, isolated trigger protection.");
} finally { await client.end(); }

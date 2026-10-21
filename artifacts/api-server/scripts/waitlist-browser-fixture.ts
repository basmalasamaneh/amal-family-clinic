/** Focused synthetic development fixture for the waitlist browser journey.
 * Does not read or alter seed rows or existing clinic records. Never a deployment tool.
 * The temporary session file is private, outside the repository, and expires in one hour.
 */
import pg from "pg";
import { randomUUID, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1")
  throw new Error("Development fixture only");
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock_shared(761930)");
  await client.query("SELECT pg_advisory_xact_lock(761910)");
  const tag = randomUUID().slice(0, 8);
  const clinic = (await client.query(`INSERT INTO operational.clinics(clinic_name,city,booking_method,reminders_enabled)
    VALUES($1,'Synthetic test','phone',true) RETURNING clinic_id`, [`Waitlist verification ${tag}`])).rows[0].clinic_id;
  const doctor = (await client.query(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
    VALUES('Waitlist verification doctor',$1,'Synthetic',$2) RETURNING doctor_id`, [clinic, `${tag}@example.invalid`])).rows[0].doctor_id;
  const patients: number[] = [];
  for (const name of ["Source booking", "Waiting patient one", "Waiting patient two"]) {
    patients.push((await client.query(`INSERT INTO operational.patients(patient_name,phone,dob,name_normalized,created_clinic_id)
      VALUES($1,'0590000000','1980-01-01',$2,$3) RETURNING patient_id`, [`${name} ${tag}`, name.toLowerCase(), clinic])).rows[0].patient_id);
  }
  const appointment = (await client.query(`INSERT INTO operational.appointments
    (clinic_id,doctor_id,patient_id,scheduled_at,duration_minutes,booking_method,status)
    VALUES($1,$2,$3,'2091-06-04T08:00:00Z',30,'phone','booked') RETURNING appointment_id`,
  [clinic, doctor, patients[0]])).rows[0].appointment_id;
  const user = (await client.query(`INSERT INTO operational.users(email,password_hash,role,clinic_id,locale,theme)
    VALUES($1,'unused','receptionist',$2,'en','light') RETURNING id`, [`waitlist-${tag}@example.invalid`, clinic])).rows[0].id;
  const device = (await client.query("INSERT INTO operational.devices(clinic_id,label) VALUES($1,'waitlist.verification') RETURNING id", [clinic])).rows[0].id;
  const session = randomUUID(), deviceToken = randomUUID(), csrf = randomUUID();
  await client.query("INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)", [device, digest(deviceToken)]);
  await client.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,device_id,csrf_token,absolute_expires_at,pin_verified_at)
    VALUES($1,$2,$3,$4,clock_timestamp()+interval '1 hour',clock_timestamp())`, [digest(session), user, device, csrf]);
  await client.query("COMMIT");
  await writeFile("/tmp/amal-waitlist-browser.json", JSON.stringify({
    clinicId: clinic, doctorId: doctor, patientIds: patients, appointmentId: appointment, tag, csrf,
    cookies: [{ name: "amal_session", value: session }, { name: "amal_device", value: deviceToken }],
    startsAt: "2091-06-04T08:00:00Z", endsAt: "2091-06-04T08:30:00Z",
  }), { mode: 0o600 });
  console.log("Synthetic waitlist browser fixture ready in /tmp/amal-waitlist-browser.json (private; do not print).");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally { await client.end(); }

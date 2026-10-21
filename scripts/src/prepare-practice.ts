/** Additive development-only practice setup. Never resets or writes seed tables. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { compare, hash } from "bcryptjs";
import { addDays, format } from "date-fns";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { adminClient, requireDemo, seedFingerprint, transaction } from "./operational-support";
import { demoPassword, demoPin, normalizeName } from "./demo-fixtures";
import { execFileSync } from "node:child_process";
import { root } from "./seed-source";

const names = ["ليان منصور", "يوسف عوض", "مريم ناصر", "عمر سليم", "سارة خليل", "آدم محمود",
  "نور إبراهيم", "كريم حمدان", "هبة ياسين", "رامي شاهين", "دانا مراد", "سامر حنا",
  "رنا قاسم", "مازن عيسى", "لينا فارس", "طارق زيدان", "هدى بركات", "باسم حمد",
  "سلمى رشيد", "خالد بدر", "ريما أمين", "نبيل صادق", "سناء شهاب", "علي شريف",
  "جنى بشير", "نادر يوسف", "عبير كامل", "وسيم حسين", "ملك صالح", "هادي عثمان"];

async function main() {
  requireDemo();
  const adminPassword = process.env.AMAL_PRODUCTION_DEMO_ADMIN_PASSWORD;
  const doctorPassword = process.env.AMAL_PRODUCTION_DEMO_DOCTOR_PASSWORD;
  const receptionPin = process.env.AMAL_PRODUCTION_DEMO_RECEPTION_PIN;
  for (const password of [adminPassword, doctorPassword]) {
    assert(password && password.length >= 12 && Buffer.byteLength(password) <= 72, "Private password missing or invalid");
  }
  assert(receptionPin && /^\d{4}$/.test(receptionPin), "Private PIN missing or invalid");
  const client = adminClient();
  await client.connect();
  try {
    const before = await seedFingerprint(client);
    const result = await transaction(client, async () => {
      await client.query("SELECT pg_advisory_xact_lock(31030,1)");
      await client.query("SELECT pg_advisory_xact_lock(761910)");
      const existing = await client.query("SELECT detail FROM operational.audit_log WHERE action='practice.prepared' ORDER BY id DESC LIMIT 1");
      if (existing.rowCount) return existing.rows[0].detail;
      const clinics = (await client.query("SELECT * FROM operational.clinics WHERE clinic_id IN (SELECT clinic_id FROM public.clinics) ORDER BY clinic_id")).rows;
      const doctors = (await client.query(`SELECT d.* FROM operational.doctors d JOIN public.doctors s USING(doctor_id)
        WHERE d.clinic_id=s.clinic_id ORDER BY d.doctor_id`)).rows;
      assert(clinics.length === 3 && doctors.length === 5, "Original clinic and doctor relationships required");
      const users = (await client.query("SELECT * FROM operational.users WHERE fixture_key LIKE 'demo.%' ORDER BY id")).rows;
      assert(users.length === 9, "Expected original practice accounts only");
      const owner = users.find(u => u.fixture_key === "demo.admin");
      assert(owner);
      const accounts = [];
      for (const u of users) {
        // Refuse to overwrite anyone's changed credentials or non-fixture account.
        assert(await compare(demoPassword, u.password_hash), "Built-in account credentials were changed; refusing to replace");
        if (u.role === "receptionist") assert(await compare(demoPin, u.pin_hash), "Reception PIN was changed; refusing to replace");
        assert(u.disabled_at === null, "Disabled practice account requires explicit review");
        const email = u.role === "administrator" ? "admin@amal.example"
          : u.role === "doctor" ? `doctor.${u.doctor_id}@amal.example` : `reception.${u.clinic_id}@amal.example`;
        const passwordHash = await hash(u.role === "doctor" ? doctorPassword! : adminPassword!, 12);
        const pinHash = u.role === "receptionist" ? await hash(receptionPin!, 12) : null;
        await client.query("UPDATE operational.users SET email=$2,password_hash=$3,pin_hash=$4 WHERE id=$1",
          [u.id, email, passwordHash, pinHash]);
        if (u.doctor_id) await client.query("UPDATE operational.doctors SET email=$2 WHERE doctor_id=$1 AND user_id=$3", [u.doctor_id, email, u.id]);
        await client.query(`INSERT INTO operational.audit_log(user_id,clinic_id,action,detail)
          VALUES($1,$2,'admin.user.updated',$3::jsonb)`, [owner.id, u.clinic_id, JSON.stringify({ targetId: u.id, fields: ["email", "password", ...(pinHash ? ["pin"] : [])] })]);
        accounts.push({ role: u.role, email, clinicId: u.clinic_id, doctorId: u.doctor_id });
      }
      const now = new Date(), today = formatInTimeZone(now, "Asia/Hebron", "yyyy-MM-dd");
      const patientGroups = new Map<number, number[]>();
      const patientManifest = [];
      let serial = 0;
      for (const doctor of doctors) {
        const ids: number[] = [];
        for (let i = 0; i < 6; i++) {
          const name = names[serial]!;
          const phone = `059880${String(serial + 100).padStart(4, "0")}`;
          const dob = `${1980 + serial % 25}-03-15`;
          const { rows: [p] } = await client.query(`INSERT INTO operational.patients
            (patient_name,name_normalized,phone,dob,created_clinic_id) VALUES($1,$2,$3,$4,$5) RETURNING patient_id`,
          [name, normalizeName(name), phone, dob, doctor.clinic_id]);
          ids.push(p.patient_id);
          patientManifest.push({ id: p.patient_id, name, phone, dob, clinicId: doctor.clinic_id, doctorId: doctor.doctor_id });
          await client.query("INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)", [p.patient_id, doctor.clinic_id]);
          await client.query("INSERT INTO operational.patient_doctor_access(patient_id,clinic_id,doctor_id) VALUES($1,$2,$3)", [p.patient_id, doctor.clinic_id, doctor.doctor_id]);
          if (i < 2) {
            await client.query(`INSERT INTO operational.patient_visit_history(patient_id,clinic_id,doctor_id,visit_date,diagnosis_notes)
              VALUES($1,$2,$3,$4,$5)`, [p.patient_id, doctor.clinic_id, doctor.doctor_id,
              format(addDays(new Date(`${today}T12:00:00Z`), -7 - i), "yyyy-MM-dd"),
              i === 0 ? "Patient takes amlodipine 5 mg daily. Blood pressure follow-up." : "Routine follow-up. No new symptoms reported."]);
            const reception = users.find(u => u.role === "receptionist" && u.clinic_id === doctor.clinic_id)!;
            await client.query(`INSERT INTO operational.patient_consents
              (patient_id,level,given_by,recorded_by_user,recorded_clinic_id,evidence)
              VALUES($1,$2,'patient',$3,$4,'verbal')`, [p.patient_id, i === 0 ? "clinical" : "basic", reception.id, doctor.clinic_id]);
          }
          serial++;
        }
        patientGroups.set(doctor.doctor_id, ids);
      }
      // Exact duplicate pair, isolated from consent and clinical history.
      const duplicateIds = [];
      const dc = doctors[0]!;
      for (let i = 0; i < 2; i++) {
        const { rows: [p] } = await client.query(`INSERT INTO operational.patients
          (patient_name,name_normalized,phone,dob,created_clinic_id)
          VALUES('إياد نصار',$1,'0598899001','1989-06-12',$2) RETURNING patient_id`, [normalizeName("إياد نصار"), dc.clinic_id]);
        duplicateIds.push(p.patient_id);
        await client.query("INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)", [p.patient_id, dc.clinic_id]);
        await client.query("INSERT INTO operational.patient_doctor_access(patient_id,clinic_id,doctor_id) VALUES($1,$2,$3)", [p.patient_id, dc.clinic_id, dc.doctor_id]);
      }
      const appointments = [];
      for (const doctor of doctors) {
        const clinic = clinics.find(c => c.clinic_id === doctor.clinic_id)!;
        const open = String(clinic.open_time).slice(0,5), close = String(clinic.close_time).slice(0,5);
        const startMinute = Number(open.slice(0,2)) * 60 + Number(open.slice(3,5));
        const endMinute = Number(close.slice(0,2)) * 60 + Number(close.slice(3,5));
        assert(endMinute - startMinute >= 180, "Daytime clinic window required");
        for (let day = -3; day <= 7; day++) {
          const date = format(addDays(new Date(`${today}T12:00:00Z`), day), "yyyy-MM-dd");
          const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
          if (!clinic.working_days.includes(weekday)) continue;
          for (let slot = 0; slot < 4; slot++) {
            const minutes = startMinute + 30 + slot * 45;
            const local = `${date}T${String(Math.floor(minutes/60)).padStart(2,"0")}:${String(minutes%60).padStart(2,"0")}:00`;
            const at = fromZonedTime(local, "Asia/Hebron");
            const patientId = patientGroups.get(doctor.doctor_id)![slot]!;
            const overlaps = await client.query(`SELECT 1 FROM operational.appointments WHERE
              (doctor_id=$1 OR patient_id=$2) AND status IN ('booked','double_booked')
              AND scheduled_at < $3::timestamptz+interval '30 minutes'
              AND scheduled_at+duration_minutes*interval '1 minute' > $3 LIMIT 1`, [doctor.doctor_id, patientId, at]);
            if (overlaps.rowCount) continue;
            const status = at < now ? (slot === 3 ? "no_show" : "completed") : "booked";
            const { rows: [a] } = await client.query(`INSERT INTO operational.appointments
              (clinic_id,doctor_id,patient_id,scheduled_at,booking_method,status,duration_minutes,source_ref,created_by)
              VALUES($1,$2,$3,$4,$5,$6,30,$7,$8) RETURNING appointment_id`,
            [doctor.clinic_id, doctor.doctor_id, patientId, at, slot % 2 ? "walk_in" : "phone", status,
              `practice/${today}/${doctor.doctor_id}/${day}/${slot}`, owner.id]);
            appointments.push({ id: a.appointment_id, clinicId: doctor.clinic_id, doctorId: doctor.doctor_id, patientId, local, status });
          }
        }
      }
      let waitlistCount = 0;
      for (const doctor of doctors) {
        const clinic = clinics.find(c => c.clinic_id === doctor.clinic_id)!;
        const reception = users.find(u => u.role === "receptionist" && u.clinic_id === clinic.clinic_id)!;
        for (const patientId of patientGroups.get(doctor.doctor_id)!.slice(4)) {
          await client.query(`INSERT INTO operational.waitlist_entries
            (clinic_id,doctor_id,patient_id,weekdays,window_start,window_end,created_by)
            VALUES($1,$2,$3,$4,$5,$6,$7)`, [clinic.clinic_id, doctor.doctor_id, patientId, clinic.working_days,
              String(clinic.open_time).slice(0,5), String(clinic.close_time).slice(0,5), reception.id]);
          waitlistCount++;
        }
      }
      const result = { preparedOn: today, accounts, clinics: clinics.map(c => ({ id: c.clinic_id, name: c.clinic_name, mode: c.network_mode })),
        doctors: doctors.map(d => ({ id: d.doctor_id, name: d.doctor_name, clinicId: d.clinic_id })),
        patients: patientManifest, duplicateIds, appointments, waitlistCount };
      assert.equal(await seedFingerprint(client), before, "Seed fingerprint mismatch");
      await client.query("INSERT INTO operational.audit_log(user_id,action,detail) VALUES($1,'practice.prepared',$2::jsonb)", [owner.id, JSON.stringify(result)]);
      return result;
    });
    assert.equal(await seedFingerprint(client), before, "Seed fingerprint mismatch after preparation");
    writeFileSync(`${root}/docs/SELF_TEST_DATA.json`, `${JSON.stringify(result, null, 2)}\n`);
    execFileSync("pnpm", ["--filter", "@workspace/api-server", "exec", "tsx", "scripts/prepare-practice-reminders.ts", "--practice"], { cwd: root, stdio: "inherit" });
    console.log(JSON.stringify({ preparedOn: result.preparedOn, addedPatients: result.patients.length + 2,
      appointments: result.appointments.length, waitlist: result.waitlistCount, accounts: result.accounts.length, seedsUnchanged: true }));
  } finally { await client.end(); }
}
main().catch(() => { console.error("Practice preparation refused or failed. No raw database diagnostics or credentials emitted."); process.exitCode = 1; });

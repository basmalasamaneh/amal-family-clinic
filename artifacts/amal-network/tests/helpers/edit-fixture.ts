import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';

// Reuse the server's installed driver. Credentials stay in the process, never in reports.
const require = createRequire(new URL('../../../api-server/package.json', import.meta.url));
const { Client } = require('pg');
export const editOrigin = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:80';
export async function editFixture(context: BrowserContext) {
  if (process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1') throw new Error('Development fixtures only');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const marker = randomUUID(), token = randomUUID(), csrf = randomUUID(), deviceToken = randomUUID();
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const one = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows[0];
  const seed = async () => {
    const result: Record<string, unknown> = {};
    for (const table of ['clinics', 'doctors', 'patients', 'appointments', 'patient_visit_history', 'calendar_app_export']) {
      result[table] = await one(`SELECT count(*)::integer count,md5(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text)) hash FROM public.${table} t`);
    }
    return result;
  };
  const before = await seed();
  await db.query('BEGIN');
  let clinic: number, doctor: number, user: number, device: number;
  const patients: number[] = [], ids: number[] = [];
  try {
    clinic = (await one(`INSERT INTO operational.clinics(clinic_name,city,booking_method,working_days,open_time,close_time,timezone)
      VALUES($1,'test','phone',ARRAY[0,1,2,3,4,5,6],'08:00','18:00','Asia/Hebron') RETURNING clinic_id`, [`Edit test ${marker}`])).clinic_id;
    doctor = (await one(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
      VALUES('Edit test doctor',$1,'test',$2) RETURNING doctor_id`, [clinic, `${marker}@edit.test`])).doctor_id;
    user = (await one(`INSERT INTO operational.users(email,password_hash,role,clinic_id)
      VALUES($1,'unused','receptionist',$2) RETURNING id`, [`${marker}@edit.test`, clinic])).id;
    device = (await one(`INSERT INTO operational.devices(clinic_id,label) VALUES($1,'edit-test') RETURNING id`, [clinic])).id;
    await db.query('INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)', [device, digest(deviceToken)]);
    await db.query(`INSERT INTO operational.auth_sessions(token_digest,user_id,device_id,csrf_token,absolute_expires_at,pin_verified_at)
      VALUES($1,$2,$3,$4,now()+interval '8 hours',now())`, [digest(token), user, device, csrf]);
    for (const hour of [7, 8]) {
      const patient = (await one(`INSERT INTO operational.patients(patient_name,phone,dob,name_normalized)
        VALUES($1,'test-phone','1990-01-01',$1) RETURNING patient_id`, [`Edit test ${marker}-${hour}`])).patient_id;
      patients.push(patient);
      await db.query('INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)', [patient, clinic]);
      ids.push((await one(`INSERT INTO operational.appointments(clinic_id,doctor_id,patient_id,scheduled_at,duration_minutes,booking_method,status)
        VALUES($1,$2,$3,$4,30,'phone','booked') RETURNING appointment_id`,
      [clinic, doctor, patient, `2030-01-07T0${hour}:00:00Z`])).appointment_id);
    }
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); await db.end(); throw error; }
  await context.addCookies([
    { name: 'amal_session', value: token, url: editOrigin, httpOnly: true, sameSite: 'Strict' },
    { name: 'amal_device', value: deviceToken, url: editOrigin, httpOnly: true, sameSite: 'Strict' },
  ]);
  await context.addInitScript(({ id }) => {
    localStorage.setItem(`amal.tour.v1:${encodeURIComponent(`account:${id}`)}:front-desk`, 'dismissed');
  }, { id: user });
  return {
    clinic, doctor, user, ids, csrf, before, seed,
    row: (id = ids[0]) => one('SELECT * FROM operational.appointments WHERE appointment_id=$1', [id]),
    // Simulate a separate actor between preview and save without mocking API responses.
    advanceVersion: () => db.query('UPDATE operational.appointments SET version=version+1 WHERE appointment_id=$1', [ids[0]]),
    moveBlocker: (startsAt: string) => db.query('UPDATE operational.appointments SET scheduled_at=$2 WHERE appointment_id=$1', [ids[1], startsAt]),
    async cleanup() {
      try {
        await db.query('BEGIN');
        await db.query('DELETE FROM operational.appointment_operations WHERE actor_id=$1', [user]);
        await db.query('DELETE FROM operational.appointment_holds WHERE owner_id=$1', [user]);
        await db.query('SET LOCAL ROLE amal_demo_reset');
        await db.query('DELETE FROM operational.audit_log WHERE user_id=$1 OR patient_id=ANY($2::integer[])', [user, patients]);
        await db.query('RESET ROLE');
        await db.query('DELETE FROM operational.appointments WHERE patient_id=ANY($1::integer[])', [patients]);
        await db.query('DELETE FROM operational.patient_clinic_access WHERE patient_id=ANY($1::integer[])', [patients]);
        await db.query('DELETE FROM operational.auth_sessions WHERE user_id=$1', [user]);
        await db.query('DELETE FROM operational.auth_devices WHERE device_id=$1', [device]);
        await db.query('DELETE FROM operational.devices WHERE id=$1', [device]);
        await db.query('DELETE FROM operational.users WHERE id=$1', [user]);
        await db.query('DELETE FROM operational.doctors WHERE doctor_id=$1', [doctor]);
        await db.query('DELETE FROM operational.patients WHERE patient_id=ANY($1::integer[])', [patients]);
        await db.query('DELETE FROM operational.clinics WHERE clinic_id=$1', [clinic]);
        await db.query('COMMIT');
      } finally { await db.end(); }
    },
  };
}

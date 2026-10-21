import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { fromZonedTime } from 'date-fns-tz';

const require = createRequire(new URL('../../../api-server/package.json', import.meta.url));
const { Client } = require('pg');
export const origin = process.env.AMAL_OFFLINE_E2E === '1' ? 'http://127.0.0.1:4189' :
  process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:80';
type Fingerprint = Record<string, { count: number; hash: string | null; schema?: string }>;
type Appointment = { id: number; clinicId: number; doctorId: number; patientId: number; startsAt: string; endsAt: string; source: string; status: string; version: number; clientOpId: string };
export interface BookingFixture {
  clinic: number;
  doctor: number;
  otherDoctor: number;
  user: number;
  patients: number[];
  patientNames: string[];
  ids: number[];
  before: Fingerprint;
  seed(): Promise<Fingerprint>;
  /** Accepts /appointments?... or /api/appointments?...; never accepts external URLs. */
  read<T = { items: Appointment[]; nextCursor: string | null }>(path: string, context?: BrowserContext): Promise<T>;
  /** Separate cookie jar, device and session for the SAME authorized receptionist. */
  secondContext(): Promise<BrowserContext>;
  audits(): Promise<{ action: string; detail: { reason?: string; appointmentId?: number; clientOpId?: string } }[]>;
  cleanup(): Promise<void>;
  syncEvidence(): Promise<{ receipts: Record<string, unknown>[]; conflicts: Record<string, unknown>[]; history: Record<string, unknown>[] }>;
}

export function assertDisposable() {
  if (process.env.AMAL_BOOKING_DISPOSABLE !== '1') throw new Error('Booking E2E requires AMAL_BOOKING_DISPOSABLE=1 on a disposable development database');
  if (process.env.NODE_ENV === 'production' || /^(1|true)$/i.test(process.env.REPLIT_DEPLOYMENT ?? '') ||
      process.env.REPLIT_DEPLOYMENT_ID || process.env.REPLIT_DEPLOYMENT_TYPE || process.env.REPLIT_DEPLOYMENT_URL) {
    throw new Error('Booking E2E refuses production/deployment environments');
  }
  if (!process.env.DATABASE_URL) throw new Error('Booking E2E requires the disposable development DATABASE_URL');
}

/** Use the real account preferences UI, never a fixture/demo shell. Call after navigating. */
export async function display(page: Page) {
  const project = test.info().project.use;
  const locale = project.locale?.startsWith('ar') ? 'ar' : 'en';
  const theme = project.colorScheme === 'dark' ? 'dark' : 'light';
  await page.getByTestId('button-user-menu').click();
  const dialog = page.getByTestId('dialog-user');
  await dialog.getByTestId(`button-locale-${locale}`).click();
  await dialog.getByTestId(`button-theme-${theme}`).click();
  await dialog.getByTestId('button-user-close').click();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

export const test = base.extend<{ f: BookingFixture; offlineJourney: boolean }>({
  offlineJourney: [false, { option: true }],
  // Never serialize session cookies, CSRF tokens or request headers into trace/video artifacts.
  trace: 'off',
  video: 'off',
  screenshot: 'off',
  f: async ({ context, browser, offlineJourney }, use, info) => {
    assertDisposable();
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    const query = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows;
    const one = async (sql: string, args: unknown[] = []) => (await query(sql, args))[0];
    const seed = async (): Promise<Fingerprint> => {
      const result: Fingerprint = {};
      for (const table of ['clinics', 'doctors', 'patients', 'appointments', 'patient_visit_history', 'calendar_app_export']) {
        result[table] = await one(`SELECT count(*)::integer count,md5(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text)) hash FROM public.${table} t`);
        result[table]!.schema = (await one(`SELECT md5(string_agg(row_to_json(c)::text,E'\\n' ORDER BY ordinal_position)) hash
          FROM information_schema.columns c WHERE table_schema='public' AND table_name=$1`, [table])).hash;
      }
      return result;
    };
    let before: Fingerprint;
    try { before = await seed(); } catch (error) { await db.end(); throw error; }
    const marker = randomUUID();
    const patientNames = [`Booking ${marker}`, `Booking ${marker}`, `Booking ${marker} third`];
    if (offlineJourney) patientNames.push(`Booking ${marker} competitor`);
    const patients: number[] = [], ids: number[] = [], devices: number[] = [];
    const isolated: BrowserContext[] = [];
    let clinic = 0, doctor = 0, otherDoctor = 0, user = 0, cleaned = false;
    const digest = (value: string) => createHash('sha256').update(value).digest('hex');
    const authenticate = async (target: BrowserContext) => {
      const token = randomUUID(), deviceToken = randomUUID(), csrf = randomUUID();
      const device = (await one(`INSERT INTO operational.devices(clinic_id,label) VALUES($1,'booking-e2e') RETURNING id`, [clinic])).id;
      devices.push(device);
      await query('INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)', [device, digest(deviceToken)]);
      await query(`INSERT INTO operational.auth_sessions(token_digest,user_id,device_id,csrf_token,absolute_expires_at,pin_verified_at)
        VALUES($1,$2,$3,$4,now()+interval '8 hours',now())`, [digest(token), user, device, csrf]);
      await target.addCookies([
        { name: 'amal_session', value: token, url: origin, httpOnly: true, sameSite: 'Strict' },
        { name: 'amal_device', value: deviceToken, url: origin, httpOnly: true, sameSite: 'Strict' },
      ]);
      await target.addInitScript(({ id }) => {
        // Dismiss platform preview chrome, not product content (also absent in preview iframe).
        localStorage.setItem(`replitDevBannerClosed-${location.hostname}`, 'true');
        localStorage.setItem(`amal.tour.v1:${encodeURIComponent(`account:${id}`)}:front-desk`, 'dismissed');
      }, { id: user });
    };
    const cleanup = async () => {
      if (cleaned) return;
      // Stop all clients before deletion so unmount/hold release cannot write after cleanup.
      // A failed context close must not bypass scoped SQL cleanup or leak the connection.
      const closed = await Promise.allSettled([context, ...isolated].map(target => target.close()));
      let committed = false;
      let after: Fingerprint | null = null;
      try {
        await query('BEGIN');
        // Closing Chromium does not cancel a request already executing in the
        // API. Join the existing appointment/sync transaction coordinator before
        // deleting owned rows. Earlier writes finish first; later transactions
        // reauthorize only after these sessions have been removed at COMMIT.
        await query('SELECT pg_advisory_xact_lock(761910)');
        await query('DELETE FROM operational.sync_resolution_history WHERE actor_id=$1', [user]);
        await query('DELETE FROM operational.sync_device_operations WHERE device_id=ANY($1::integer[])', [devices]);
        await query('DELETE FROM operational.sync_conflicts WHERE actor_id=$1', [user]);
        await query('DELETE FROM operational.appointment_operations WHERE clinic_id=$1 OR actor_id=$2 OR device_id=ANY($3::integer[])', [clinic, user, devices]);
        await query('DELETE FROM operational.appointment_holds WHERE clinic_id=$1 OR owner_id=$2', [clinic, user]);
        await query('SET LOCAL ROLE amal_demo_reset');
        await query('DELETE FROM operational.audit_log WHERE clinic_id=$1 OR user_id=$2 OR patient_id=ANY($3::integer[])', [clinic, user, patients]);
        await query('RESET ROLE');
        await query('DELETE FROM operational.appointments WHERE clinic_id=$1', [clinic]);
        await query('DELETE FROM operational.sync_changes WHERE clinic_id=$1', [clinic]);
        await query('DELETE FROM operational.patient_clinic_access WHERE clinic_id=$1', [clinic]);
        await query('DELETE FROM operational.auth_sessions WHERE user_id=$1', [user]);
        await query('DELETE FROM operational.auth_devices WHERE device_id=ANY($1::integer[])', [devices]);
        await query('DELETE FROM operational.devices WHERE clinic_id=$1', [clinic]);
        await query('DELETE FROM operational.users WHERE id=$1', [user]);
        await query('DELETE FROM operational.doctors WHERE clinic_id=$1', [clinic]);
        await query('DELETE FROM operational.patients WHERE patient_id=ANY($1::integer[])', [patients]);
        await query('DELETE FROM operational.clinics WHERE clinic_id=$1', [clinic]);
        await query('COMMIT');
        committed = true;
        after = await seed();
        expect(after, 'Immutable source seed fingerprint after scoped cleanup').toEqual(before);
        if (closed.some(result => result.status === 'rejected')) throw new Error('Booking browser context close failed; scoped database cleanup completed');
      } catch (error) {
        if (!committed) await query('ROLLBACK');
        throw error;
      } finally {
        cleaned = true;
        try {
          if (!after) {
            try { after = await seed(); } catch { /* Explicit null reports unavailable verification. */ }
          }
          await info.attach('booking-seed-integrity', {
            body: JSON.stringify({
              before, after, cleanupCommitted: committed,
              browserContextsClosed: closed.every(result => result.status === 'fulfilled'),
              fingerprintAvailable: after !== null,
            }),
            contentType: 'application/json',
          });
        } finally { await db.end(); }
      }
    };
    try {
      await query('BEGIN');
      clinic = (await one(`INSERT INTO operational.clinics(clinic_name,city,booking_method,working_days,open_time,close_time,timezone)
        VALUES($1,'test','phone',ARRAY[0,1,2,3,4,5,6],'08:00','18:00','Asia/Hebron') RETURNING clinic_id`, [`Booking ${marker}`])).clinic_id;
      for (let index = 0; index < 2; index++) {
        const id = (await one(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
          VALUES($1,$2,'test',$3) RETURNING doctor_id`, [`Booking doctor ${index + 1}`, clinic, `${marker}-${index}@booking.test`])).doctor_id;
        if (index === 0) doctor = id; else otherDoctor = id;
      }
      user = (await one(`INSERT INTO operational.users(email,password_hash,role,clinic_id,locale,theme)
        VALUES($1,'unused','receptionist',$2,$3,$4) RETURNING id`,
      [`${marker}@booking.test`, clinic, info.project.use.locale?.startsWith('ar') ? 'ar' : 'en', info.project.use.colorScheme === 'dark' ? 'dark' : 'light'])).id;
      for (let index = 0; index < patientNames.length; index++) {
        patients.push((await one(`INSERT INTO operational.patients(patient_name,phone,dob,name_normalized,created_clinic_id)
          VALUES($1,$2,$3,$1,$4) RETURNING patient_id`,
        [patientNames[index], `059000000${index}`, `${1990 + index}-01-01`, clinic])).patient_id);
        await query('INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)', [patients[index], clinic]);
      }
      // Main calendar topology: first two patients at 09:00 / 10:00 Asia/Hebron.
      // Additional doctor has patient 0 at 11:00, allowing a patient-only overlap on doctor 1.
      for (const [doc, patient, at] of offlineJourney ? [] : [[doctor, patients[0], '09:00'], [doctor, patients[1], '10:00'], [otherDoctor, patients[0], '11:00']] as const) {
        ids.push((await one(`INSERT INTO operational.appointments(clinic_id,doctor_id,patient_id,scheduled_at,duration_minutes,booking_method,status)
          VALUES($1,$2,$3,$4,30,'phone','booked') RETURNING appointment_id`,
        [clinic, doc, patient, fromZonedTime(`2030-01-07T${at}:00`, 'Asia/Hebron').toISOString()])).appointment_id);
      }
      await query('COMMIT');
    } catch (error) {
      try {
        await query('ROLLBACK');
        const after = await seed();
        await info.attach('booking-seed-integrity', {
          body: JSON.stringify({ before, after, setupRolledBack: true }), contentType: 'application/json',
        });
        expect(after, 'Immutable source seed fingerprint after setup rollback').toEqual(before);
      } finally { await db.end(); }
      throw error;
    }
    const f: BookingFixture = {
      clinic, doctor, otherDoctor, user, patients, patientNames, ids, before, seed, cleanup,
      async syncEvidence() {
        return {
          receipts: await query('SELECT s.client_op_id::text,s.sequence,o.payload_hash FROM operational.sync_device_operations s JOIN operational.appointment_operations o USING(client_op_id) WHERE s.device_id=ANY($1::integer[]) ORDER BY s.device_id,s.sequence', [devices]),
          conflicts: await query('SELECT id::text,client_op_id::text,status,version FROM operational.sync_conflicts WHERE actor_id=$1 ORDER BY id', [user]),
          history: await query('SELECT client_op_id::text,conflict_id::text FROM operational.sync_resolution_history WHERE actor_id=$1 ORDER BY id', [user]),
        };
      },
      async read<T>(path: string, target = context): Promise<T> {
        if (!/^\/(?:api\/)?[a-z]/i.test(path) || path.includes('://')) throw new Error('read requires a local API path');
        const response = await target.request.get(`${origin}${path.startsWith('/api/') ? path : `/api${path}`}`);
        if (!response.ok()) throw new Error(`Booking API read failed (${response.status()})`);
        return response.json() as Promise<T>;
      },
      async secondContext() {
        const project = info.project.use;
        const target = await browser.newContext({
          baseURL: origin, locale: project.locale, colorScheme: project.colorScheme,
          timezoneId: project.timezoneId, viewport: project.viewport, serviceWorkers: 'block',
        });
        isolated.push(target);
        await authenticate(target);
        return target;
      },
      audits: () => query(`SELECT action,detail FROM operational.audit_log WHERE clinic_id=$1 AND action='appointment.patient_overlap_override' ORDER BY id`, [clinic]),
    };
    try {
      await authenticate(context);
      await use(f);
    } finally {
      try {
        if (info.status !== info.expectedStatus) {
          const states: { lang: string | null; direction: string | null; theme: string | null; stateIds: string[] }[] = [];
          for (const target of [context, ...isolated]) for (const page of target.pages()) {
            if (page.isClosed()) continue;
            try {
              states.push(await page.evaluate(() => ({
                lang: document.documentElement.getAttribute('lang'),
                direction: document.documentElement.getAttribute('dir'),
                theme: document.documentElement.getAttribute('data-theme'),
                // Fixed state selectors only: no DOM/text, patient identity, input values,
                // cookies, request bodies, headers, session tokens or CSRF credentials.
                stateIds: Array.from(document.querySelectorAll<HTMLElement>(
                  '[data-testid^="status-"],[data-testid^="conflict-"],[data-testid="dialog-conflicts"],[data-testid="section-override"]',
                )).filter(element => element.getClientRects().length > 0)
                  .map(element => element.dataset.testid!)
                  .filter(id => /^(?:status-[a-z-]+|conflict-[a-z-]+|dialog-conflicts|section-override)$/.test(id)),
              })));
            } catch { /* A closed/navigating page cannot provide sanitized UI state. */ }
          }
          await info.attach('booking-failure-state', {
            body: JSON.stringify(states), contentType: 'application/json',
          });
        }
      } finally { await cleanup(); }
    }
  },
});
export { expect };

import { test, expect, type BrowserContext } from '@playwright/test';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { formatInTimeZone } from 'date-fns-tz';

const apiRequire = createRequire(resolve('artifacts/api-server/package.json'));
const { Client } = apiRequire('pg');
const origin = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:80';

test('additive live auto-sync: durable replay and explicit conflict decisions', async ({ page, context, browser }, info) => {
  if (process.env.AMAL_SYNC_ADDITIVE !== '1') throw new Error('Set AMAL_SYNC_ADDITIVE=1 to authorize isolated additive development fixtures');
  if (process.env.NODE_ENV === 'production' || /^(1|true)$/i.test(process.env.REPLIT_DEPLOYMENT ?? '') ||
      process.env.REPLIT_DEPLOYMENT_ID || process.env.REPLIT_DEPLOYMENT_TYPE || process.env.REPLIT_DEPLOYMENT_URL)
    throw new Error('Live sync test refuses deployment');
  if (!process.env.DATABASE_URL) throw new Error('Development DATABASE_URL required');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows;
  const seed = async () => {
    const result: Record<string, unknown> = {};
    for (const table of ['clinics', 'doctors', 'patients', 'appointments', 'patient_visit_history', 'calendar_app_export'])
      result[table] = (await q(`SELECT count(*)::integer count,md5(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text)) hash FROM public.${table} t`))[0];
    return result;
  };
  const before = await seed();
  const marker = randomUUID(), patients: number[] = [], devices: number[] = [];
  let clinic = 0, doctor = 0, user = 0;
  const remote = await browser.newContext();
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const authenticate = async (target: BrowserContext) => {
    const token = randomUUID(), deviceToken = randomUUID(), csrf = randomUUID();
    const device = (await q(`INSERT INTO operational.devices(clinic_id,label) VALUES($1,'sync-live-test') RETURNING id`, [clinic]))[0].id;
    devices.push(device);
    await q('INSERT INTO operational.auth_devices(device_id,credential_digest) VALUES($1,$2)', [device, digest(deviceToken)]);
    await q(`INSERT INTO operational.auth_sessions(token_digest,user_id,device_id,csrf_token,absolute_expires_at,pin_verified_at)
      VALUES($1,$2,$3,$4,now()+interval '8 hours',now())`, [digest(token), user, device, csrf]);
    await target.addCookies([
      { name: 'amal_session', value: token, url: origin, httpOnly: true, sameSite: 'Strict' },
      { name: 'amal_device', value: deviceToken, url: origin, httpOnly: true, sameSite: 'Strict' },
    ]);
    return csrf;
  };
  try {
    await q('BEGIN');
    clinic = (await q(`INSERT INTO operational.clinics(clinic_name,city,booking_method,working_days,open_time,close_time,timezone)
      VALUES($1,'test','phone',ARRAY[0,1,2,3,4,5,6],'00:00','23:59','Asia/Hebron') RETURNING clinic_id`, [`Sync ${marker}`]))[0].clinic_id;
    doctor = (await q(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
      VALUES('Synthetic sync doctor',$1,'test',$2) RETURNING doctor_id`, [clinic, `${marker}@sync.test`]))[0].doctor_id;
    user = (await q(`INSERT INTO operational.users(email,password_hash,role,clinic_id,locale,theme)
      VALUES($1,'test-unused','receptionist',$2,'en','light') RETURNING id`, [`${marker}@sync.test`, clinic]))[0].id;
    for (let n = 0; n < 4; n++) {
      const id = (await q(`INSERT INTO operational.patients(patient_name,phone,dob,name_normalized,created_clinic_id)
        VALUES($1,'0590000000','1990-01-01',$1,$2) RETURNING patient_id`, [`Synthetic sync ${marker} ${n}`, clinic]))[0].patient_id;
      patients.push(id);
      await q('INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)', [id, clinic]);
    }
    await authenticate(context);
    const csrf = await authenticate(remote);
    await q('COMMIT');
    await context.addInitScript(({ id }) => {
      localStorage.setItem(`replitDevBannerClosed-${location.hostname}`, 'true');
      localStorage.setItem(`amal.tour.v1:${encodeURIComponent(`account:${id}`)}:front-desk`, 'dismissed');
    }, { id: user });
    await page.goto('/desk/calendar');
    // Programmatic handoff through the actual application service, NOT direct IndexedDB writes.
    await page.evaluate(async () => {
      const path = '/src/offline/booking-bridge.ts';
      await (await import(/* @vite-ignore */ path)).prepareBookingCache();
    });
    await page.waitForTimeout(1100); // Permit iat uses whole seconds; never fake the browser clock.
    await page.goto('/desk/sync');
    await expect(page.getByTestId('page-sync')).toBeVisible();
    // Preload application module while online; offline import cannot fetch Vite modules.
    await page.evaluate(async () => {
      const path = '/src/offline/booking-bridge.ts';
      (window as any).__syncDemoBooking = await import(/* @vite-ignore */ path);
    });
    const day = new Date(); day.setUTCDate(day.getUTCDate() + 1); day.setUTCHours(8, 0, 0, 0);
    const inputs = patients.slice(0, 3).map((patientId, n) => ({
      clientOpId: randomUUID(), clinicId: clinic, doctorId: doctor, patientId,
      startsAt: new Date(+day + n * 3600000).toISOString(),
      endsAt: new Date(+day + n * 3600000 + 1800000).toISOString(), source: 'phone',
    }));
    await context.setOffline(true);
    await page.evaluate(async input => {
      for (const booking of input) await (window as any).__syncDemoBooking.saveLocalBooking(booking);
    }, inputs);
    await expect(page.locator('[data-testid^="row-booking-"]')).toHaveCount(3);
    const blocker = await remote.request.post(`${origin}/api/appointments`, {
      headers: { origin, 'x-csrf-token': csrf },
      data: { ...inputs[2], patientId: patients[3], clientOpId: randomUUID() },
    });
    expect(blocker.status(), 'Authorized second session claims third slot').toBe(201);
    await context.setOffline(false);
    await expect(page.getByTestId('count-acknowledged')).toHaveText('2', { timeout: 30000 });
    await expect(page.getByTestId('count-conflict')).toHaveText('1');
    const ids = inputs.map(input => input.clientOpId);
    const receipts = async () => (await q(`SELECT client_op_id::text FROM operational.sync_device_operations WHERE device_id=$1 ORDER BY sequence`, [devices[0]])).map((r: any) => r.client_op_id);
    expect(await receipts()).toEqual(ids);
    await page.reload();
    await expect(page.getByTestId('count-acknowledged')).toHaveText('2');
    await expect(page.getByTestId('count-conflict')).toHaveText('1');
    expect(await receipts()).toEqual(ids);
    await expect(page.locator('[data-testid^="row-booking-"]')).toHaveCount(3);
    for (const id of ids) await expect(page.getByTestId(`row-booking-${id}`)).toBeVisible();
    expect(Number((await q('SELECT count(*) n FROM operational.appointments WHERE clinic_id=$1', [clinic]))[0].n)).toBe(3);
    const card = page.locator('[data-testid^="card-conflict-"]').first();
    await card.locator('[data-testid^="button-call-"]').click();
    await page.getByTestId('button-confirm-ok').click();
    await expect(card.locator('[data-testid^="panel-phone-"]')).toBeVisible();
    expect((await q('SELECT status FROM operational.sync_conflicts WHERE actor_id=$1', [user]))[0].status).toBe('open');
    const firstConflictId = (await q('SELECT id FROM operational.sync_conflicts WHERE actor_id=$1', [user]))[0].id;
    const stale = await remote.request.post(`${origin}/api/sync/resolve`, {
      headers: { origin, 'x-csrf-token': csrf },
      data: { clientOpId: randomUUID(), conflictId: firstConflictId, expectedVersion: 1, action: 'call' },
    });
    expect(stale.status(), 'Competing session cannot replay a stale conflict version').toBe(409);
    await card.locator('[data-testid^="button-clear-phone-"]').click();
    await card.locator('[data-testid^="radio-move-"]').first().check();
    await card.locator('[data-testid^="button-move-"]').click();
    await page.getByTestId('button-confirm-ok').click();
    await expect.poll(async () => (await q('SELECT status FROM operational.sync_conflicts WHERE actor_id=$1', [user]))[0].status).toBe('resolved');
    expect(Number((await q('SELECT count(*) n FROM operational.appointments WHERE clinic_id=$1', [clinic]))[0].n)).toBe(4);
    await page.reload();
    await expect(page.locator('[data-testid^="row-booking-"]')).toHaveCount(3);
    for (const id of ids) await expect(page.getByTestId(`row-booking-${id}`)).toBeVisible();
    expect(await receipts()).toEqual(ids);
    expect(Number((await q('SELECT count(*) n FROM operational.appointments WHERE clinic_id=$1', [clinic]))[0].n)).toBe(4);
    // One additional focused conflict, using the same real application handoff.
    const keepInput = { ...inputs[0]!, clientOpId: randomUUID(),
      startsAt: new Date(+day + 6 * 3600000).toISOString(),
      endsAt: new Date(+day + 6 * 3600000 + 1800000).toISOString() };
    await page.evaluate(async () => {
      const path = '/src/offline/booking-bridge.ts';
      (window as any).__syncDemoBooking = await import(/* @vite-ignore */ path);
    });
    await context.setOffline(true);
    await page.evaluate(async input => (window as any).__syncDemoBooking.saveLocalBooking(input), keepInput);
    const secondBlockerResponse = await remote.request.post(`${origin}/api/appointments`, {
      headers: { origin, 'x-csrf-token': csrf },
      data: { ...keepInput, patientId: patients[3], clientOpId: randomUUID() },
    });
    expect(secondBlockerResponse.status()).toBe(201);
    const secondBlocker = await secondBlockerResponse.json();
    await context.setOffline(false);
    await expect.poll(async () => Number((await q("SELECT count(*) n FROM operational.sync_conflicts WHERE actor_id=$1 AND status='open'", [user]))[0].n)).toBe(1);
    const secondConflictId = (await q("SELECT id FROM operational.sync_conflicts WHERE actor_id=$1 AND status='open'", [user]))[0].id;
    const keepCard = page.getByTestId(`card-conflict-${secondConflictId}`);
    await expect(keepCard).toBeVisible();
    for (const locale of ['ar', 'en']) for (const theme of ['light', 'dark']) {
      await page.getByTestId('button-user-menu').click();
      const preferences = page.getByTestId('dialog-user');
      await preferences.getByTestId(`button-locale-${locale}`).click();
      await preferences.getByTestId(`button-theme-${theme}`).click();
      await preferences.getByTestId('button-user-close').click();
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(keepCard.getByTestId(`button-keep-${secondConflictId}`)).toHaveText(
        locale === 'ar' ? 'أبقِ هذا الموعد وانقل الآخر' : 'Keep this one and move the other');
      await expect(page.getByTestId('page-sync').getByText(locale === 'ar' ? 'بحاجة إلى قرار' : 'Needs a decision', { exact: false })).toBeVisible();
      const axe = await new AxeBuilder({ page }).include('[data-testid="page-sync"]').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(axe.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length })), `${locale}/${theme} sync-scoped axe`).toEqual([]);
    }
    const destination = new Date(+day + 8 * 3600000).toISOString();
    await keepCard.getByTestId(`input-dest-date-${secondConflictId}`).fill(formatInTimeZone(destination, 'Asia/Hebron', 'yyyy-MM-dd'));
    await keepCard.getByTestId(`input-dest-time-${secondConflictId}`).fill(formatInTimeZone(destination, 'Asia/Hebron', 'HH:mm'));
    const keepButton = keepCard.getByTestId(`button-keep-${secondConflictId}`);
    await expect(keepButton).toBeEnabled();
    await keepButton.focus();
    await page.keyboard.press('Enter');
    const confirm = page.getByTestId(`dialog-confirm-${secondConflictId}`);
    await expect(confirm).toBeVisible();
    expect(await confirm.evaluate(el => el.contains(document.activeElement))).toBe(true);
    // Traverse the modal with the keyboard to its explicit confirmation button.
    for (let n = 0; n < 8 && !await page.getByTestId('button-confirm-ok').evaluate(el => el === document.activeElement); n++)
      await page.keyboard.press('Tab');
    await expect(page.getByTestId('button-confirm-ok')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(confirm).not.toBeVisible();
    await expect.poll(async () => (await q('SELECT status FROM operational.sync_conflicts WHERE id=$1', [secondConflictId]))[0].status).toBe('resolved');
    const readQuery = new URLSearchParams({ clinicId: String(clinic), limit: '100',
      from: new Date(+day - 86400000).toISOString(), to: new Date(+day + 86400000).toISOString() });
    const liveAppointments = await remote.request.get(`${origin}/api/appointments?${readQuery}`);
    expect(liveAppointments.status()).toBe(200);
    const liveRows = (await liveAppointments.json()).items;
    const kept = liveRows.filter((a: any) => a.patientId === keepInput.patientId && a.startsAt === keepInput.startsAt);
    expect(kept.length, 'Real API confirms original proposal retained').toBe(1);
    const moved = liveRows.find((a: any) => a.id === secondBlocker.id);
    expect(moved.startsAt, 'Real API confirms other appointment moved').toBe(destination);
    expect(moved.version).toBe(secondBlocker.version + 1);
    expect(liveRows.length).toBe(6);
    await info.attach('counts-only', { body: JSON.stringify({ proposals: 4, appliedOnFirstReconnect: 2, conflictsOnFirstReconnect: 1, sameReceiptsAfterReload: 3, duplicates: 0, callStayedOpen: true, staleResolutionRejected: true, explicitMoveSelfResolved: true, explicitMoveOtherResolved: true, finalApiAppointments: 6, localeThemeChecks: 4, scopedAxeViolations: 0, keyboardConfirmation: true }), contentType: 'application/json' });
  } finally {
    await context.close(); await remote.close();
    try {
      await q('ROLLBACK'); await q('BEGIN');
      await q('DELETE FROM operational.sync_resolution_history WHERE actor_id=$1', [user]);
      await q('DELETE FROM operational.sync_device_operations WHERE device_id=ANY($1::integer[])', [devices]);
      await q('DELETE FROM operational.sync_conflicts WHERE actor_id=$1', [user]);
      await q('DELETE FROM operational.appointment_operations WHERE actor_id=$1', [user]);
      await q('DELETE FROM operational.appointment_holds WHERE owner_id=$1', [user]);
      await q('SET LOCAL ROLE amal_demo_reset');
      await q('DELETE FROM operational.audit_log WHERE user_id=$1 OR patient_id=ANY($2::integer[])', [user, patients]);
      await q('RESET ROLE');
      await q('DELETE FROM operational.appointments WHERE clinic_id=$1', [clinic]);
      await q('DELETE FROM operational.sync_changes WHERE clinic_id=$1', [clinic]);
      await q('DELETE FROM operational.patient_clinic_access WHERE clinic_id=$1', [clinic]);
      await q('DELETE FROM operational.auth_sessions WHERE user_id=$1', [user]);
      await q('DELETE FROM operational.auth_devices WHERE device_id=ANY($1::integer[])', [devices]);
      await q('DELETE FROM operational.devices WHERE id=ANY($1::integer[])', [devices]);
      await q('DELETE FROM operational.users WHERE id=$1', [user]);
      await q('DELETE FROM operational.doctors WHERE clinic_id=$1', [clinic]);
      await q('DELETE FROM operational.patients WHERE patient_id=ANY($1::integer[])', [patients]);
      await q('DELETE FROM operational.clinics WHERE clinic_id=$1', [clinic]);
      await q('COMMIT');
      expect(await seed(), 'Six immutable seed fingerprints unchanged').toEqual(before);
      await info.attach('seed-integrity', { body: JSON.stringify({ tablesChecked: 6, unchanged: true, scopedCleanupCommitted: true }), contentType: 'application/json' });
    } catch (error) { await q('ROLLBACK'); throw error; }
    finally { await db.end(); }
  }
});

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';

const require = createRequire(new URL('../../api-server/package.json', import.meta.url));
const { Client } = require('pg');
const origin = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:80';

test('real operational lookup: timed timeline, consent transitions and accessibility', async ({ page, context }, info) => {
  if (process.env.AMAL_NETWORK_DISPOSABLE !== '1' || process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1')
    throw new Error('Requires AMAL_NETWORK_DISPOSABLE=1 in a development workspace');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const rows = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows;
  const one = async (sql: string, args: unknown[] = []) => (await rows(sql, args))[0];
  const fingerprint = async () => {
    const result: Record<string, unknown> = {};
    for (const table of ['clinics', 'doctors', 'patients', 'appointments', 'patient_visit_history', 'calendar_app_export'])
      result[table] = await one(`SELECT count(*)::int n,md5(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text)) hash FROM public.${table} t`);
    return result;
  };
  const before = await fingerprint();
  const run = randomUUID();
  const users: number[] = [];
  try {
    const clinics: number[] = [], doctors: number[] = [];
    for (let n = 0; n < 2; n++) {
      await rows('BEGIN');
      try {
      clinics.push((await one(`INSERT INTO operational.clinics(clinic_name,city,booking_method,network_mode)
        VALUES($1,'test','phone','full') RETURNING clinic_id`, [`Network test ${n}`])).clinic_id);
      doctors.push((await one(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
        VALUES($1,$2,'test',$3) RETURNING doctor_id`, [`Test doctor ${n}`, clinics[n], `${run}-${n}@network.test`])).doctor_id);
      users.push((await one(`INSERT INTO operational.users(email,password_hash,role,clinic_id,doctor_id)
        VALUES($1,'unused','doctor',$2,$3) RETURNING id`, [`${run}-${n}@network.test`, clinics[n], doctors[n]])).id);
      await rows('UPDATE operational.doctors SET user_id=$1 WHERE doctor_id=$2', [users[n], doctors[n]]);
        await rows('COMMIT');
      } catch (e) { await rows('ROLLBACK'); throw e; }
    }
    const desk = (await one(`INSERT INTO operational.users(email,password_hash,role,clinic_id)
      VALUES($1,'unused','receptionist',$2) RETURNING id`, [`desk-${run}@network.test`, clinics[0]])).id;
    users.push(desk);
    const name = `Network ${run}`;
    const patients: number[] = [];
    for (let n = 0; n < 2; n++) {
      const id = (await one(`INSERT INTO operational.patients(patient_name,name_normalized,phone,dob,created_clinic_id)
        VALUES($1,$2,'0590000000','1990-01-01',$3) RETURNING patient_id`, [name, name.toLowerCase(), clinics[0]])).patient_id;
      patients.push(id);
      await rows('INSERT INTO operational.patient_clinic_access(patient_id,clinic_id) VALUES($1,$2)', [id, clinics[0]]);
      await rows('INSERT INTO operational.patient_doctor_access(patient_id,clinic_id,doctor_id) VALUES($1,$2,$3)', [id, clinics[0], doctors[0]]);
      for (let c = 0; c < 2; c++) {
        const visit = (await one(`INSERT INTO operational.patient_visit_history(patient_id,clinic_id,doctor_id,visit_date,diagnosis_notes)
          VALUES($1,$2,$3,$4,$5) RETURNING visit_id`, [id, clinics[c], doctors[c], c ? '2026-09-29' : '2026-10-01',
          c ? 'Synthetic remote source note' : 'Synthetic local source note'])).visit_id;
        if (c && !n) await rows(`INSERT INTO operational.visit_alerts(visit_id,patient_id,kind,label,source_note_excerpt)
          VALUES($1,$2,'allergy','alerts.allergy.penicillin','Synthetic remote source note')`, [visit, id]);
      }
    }
    const grant = async (id: number, level: string) => {
      await rows('BEGIN');
      try {
        await rows('SELECT pg_advisory_xact_lock(160005)');
        await rows(`INSERT INTO operational.patient_consents(patient_id,level,given_by,recorded_by_user,recorded_clinic_id,evidence)
          VALUES($1,$2,'patient',$3,$4,'signed')`, [id, level, desk, clinics[0]]);
        await rows('COMMIT');
      } catch (e) { await rows('ROLLBACK'); throw e; }
    };
    for (const id of patients) await grant(id, 'clinical');
    const token = randomUUID();
    await rows(`INSERT INTO operational.auth_sessions(token_digest,user_id,csrf_token,absolute_expires_at)
      VALUES($1,$2,$3,now()+interval '8 hours')`,
    [createHash('sha256').update(token).digest('hex'), users[0], randomUUID()]);
    await context.addCookies([{ name: 'amal_session', value: token, url: origin, httpOnly: true, sameSite: 'Strict' }]);
    await context.addInitScript(({ user }) => {
      localStorage.setItem(`replitDevBannerClosed-${location.hostname}`, 'true');
      localStorage.setItem(`amal.tour.v1:account%3A${user}:doctor`, 'dismissed');
    }, { user: users[0] });
    await page.goto('/doctor/network-search');
    await expect(page.getByTestId('input-network-search')).toBeVisible();
    await page.getByTestId('button-user-menu').click();
    const dialog = page.getByTestId('dialog-user');
    await dialog.getByTestId(`button-locale-${info.project.use.locale}`).click();
    await dialog.getByTestId(`button-theme-${info.project.use.colorScheme}`).click();
    await dialog.getByTestId('button-user-close').click();
    // Fixed Date only: browser timers and measured performance clock continue normally.
    await page.clock.setFixedTime(new Date('2026-10-20T12:00:00Z'));
    const start = performance.now();
    await page.getByTestId('input-network-search').fill(name);
    await expect(page.locator('[data-testid^="network-result-"]')).toHaveCount(2);
    await page.getByTestId(`button-open-patient-${patients[0]}`).click();
    await expect(page.getByTestId('network-timeline')).toBeVisible();
    if (info.project.name === 'en-light')
      await page.screenshot({ path: `generated-artifacts/network/${info.project.name}-patient-card.png` });
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(10_000);
    await info.attach('lookup-timing', { body: JSON.stringify({ elapsedMs, project: info.project.name,
      conditions: 'Real Express/Postgres, two duplicate-name operational candidates, local+remote visits, no API mocks, 350ms debounce, fixed Date, running timers, New York browser timezone / Hebron display' }), contentType: 'application/json' });
    await expect(page.getByTestId('network-timeline')).toContainText('Synthetic remote source note');
    await expect(page.getByTestId('text-alert-cross')).toBeVisible();
    expect(page.url()).not.toContain(name);
    expect(page.url()).not.toContain(String(patients[0]));
    await expect(page.getByTestId('row-visit-0')).toHaveAttribute('data-visibility', 'clinical');
    const axe = await new AxeBuilder({ page }).include('.net').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(axe.violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) }))).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await grant(patients[0], 'basic');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('row-visit-1')).toHaveAttribute('data-visibility', 'basic');
    await expect(page.getByTestId('network-timeline')).not.toContainText('Synthetic remote source note');
    await expect(page.getByTestId('network-timeline')).toContainText('Synthetic local source note');
    await grant(patients[0], 'none');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('[data-testid^="row-visit-"]')).toHaveCount(1);
    await expect(page.getByTestId('network-timeline')).toContainText('Synthetic local source note');
    await expect(page.getByTestId('network-timeline')).not.toContainText('Network test 1');
    const audited = await one(`SELECT count(*)::int n FROM operational.audit_log WHERE user_id=$1 AND action='network.lookup'`, [users[0]]);
    expect(audited.n).toBeGreaterThan(0);
    await expect(page.getByTestId('link-network-back')).toBeVisible();
    await page.getByTestId('link-network-back').click();
    await expect(page.getByTestId(`button-open-patient-${patients[0]}`)).toBeFocused();
    await page.reload();
    await expect(page.getByTestId('input-network-search')).toHaveValue('');
    await page.goto('/doctor/patient-card');
    await expect(page.getByTestId('state-card-none')).toBeVisible();
  } finally {
    // Retain audit and clinical fixture history. Disable only this run's accounts.
    await rows('UPDATE operational.auth_sessions SET revoked_at=now() WHERE user_id=ANY($1::int[])', [users]);
    expect(await fingerprint()).toEqual(before);
    await db.end();
  }
});

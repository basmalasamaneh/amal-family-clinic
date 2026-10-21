import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { bootAdmin } from './helpers/admin-fixtures';

// Synthetic presentation fixtures, NOT operational records or a manual audit.
// Reuse helper identity/preferences/clinic API; never replace the product identity.
async function fixture(page: Page, info: TestInfo, role: 'doctor' | 'admin') {
  const seed = await bootAdmin(page, {
    role, locale: info.project.use.locale, theme: info.project.use.colorScheme,
  });
  const clinic = seed.clinics[0];
  const patient = {
    id: clinic.id + 100, name: 'Synthetic keyboard patient · مريض اختبار لوحة المفاتيح',
    identityVerified: false, effectiveConsentLevel: 'clinical',
    visits: [{
      clinicId: clinic.id, doctorId: clinic.id + 101, clinicName: clinic.name,
      doctorName: 'Synthetic keyboard doctor · طبيب اختبار', seenAt: '2026-10-20T09:00:00Z',
      visibility: 'clinical', complaint: 'Synthetic keyboard-only presentation note', alerts: [], keyAlerts: [],
    }],
  };
  const appointment = { id: clinic.id + 102, startsAt: '2026-10-20T09:00:00Z', status: 'booked', patient };
  const user = {
    id: clinic.id + 103, email: 'keyboard-presentation@example.invalid', role: 'front-desk',
    clinicId: clinic.id, doctorId: null, active: true, locale: 'en', theme: 'light',
    createdAt: '2026-10-20T09:00:00Z', updatedAt: '2026-10-20T09:00:00Z',
    lastLoginAt: null,
  };
  const writes: string[] = [], reads: string[] = [];
  let failDay = true;
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    // Last registered route blocks ALL writes before bootAdmin's synthetic POST.
    if (request.method() !== 'GET') {
      writes.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 405, json: { code: 'KEYBOARD_READ_ONLY', messageKey: 'error.forbidden', params: {} } });
    }
    reads.push(path);
    const json = (body: unknown) => route.fulfill({ json: body, headers: { 'cache-control': 'no-store' } });
    if (path === '/api/demo/context') return json({ enabled: false, generation: null, clinicId: null, outage: false });
    if (path === '/api/doctor/day') return failDay
      ? route.fulfill({ status: 503, json: { code: 'INTERNAL', messageKey: 'error.internal', params: {} } })
      : json({ day: '2026-10-20', items: [appointment], nextCursor: null });
    if (path === `/api/doctor/patients/${patient.id}`) return json(patient);
    if (path === '/api/admin/users') return json({ items: [user], page: 1, pageSize: 25, total: 1 });
    // bootAdmin's closed synthetic GET router returns 503 for unknown endpoints.
    // /api/me remains exactly the helper API identity, not a product/demo identity.
    return route.fallback();
  });
  info.annotations.push({ type: 'fixture', description: 'Synthetic read-only presentation API; automated keyboard observations, not manual/AT evidence.' });
  return {
    patient, appointment, user,
    recoverDay() { failDay = false; },
    async done() {
      await info.attach('synthetic-fixture-request-safety', {
        body: JSON.stringify({ source: 'bootAdmin helper API + explicitly synthetic presentation responses', role, clinic, patientId: patient.id, writes, reads }, null, 2),
        contentType: 'application/json',
      });
      expect(writes, 'No API write may be attempted, even against mocked endpoints').toEqual([]);
      expect(seed.writes, 'Helper creation path must never be reached').toEqual([]);
    },
  };
}

// Actual Tab traversal only: no locator.focus(), click(), fill(), selectOption()
// or DOM focus injection. Bounded traversal fails rather than hiding a trap.
async function tabTo(page: Page, target: Locator, reverse = false) {
  await expect(target).toBeVisible();
  for (let i = 0; i < 100; i++) {
    if (await target.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab');
  }
  throw new Error(`Keyboard target unreachable by ${reverse ? 'Shift+Tab' : 'Tab'}: ${await target.getAttribute('data-testid')}`);
}

async function focusObservation(page: Page, info: TestInfo, label: string, target: Locator) {
  await expect(target).toBeFocused();
  const observed = await target.evaluate(el => {
    const css = getComputedStyle(el), box = el.getBoundingClientRect();
    return {
      focusVisible: el.matches(':focus-visible'), outline: css.outlineStyle,
      outlineWidth: css.outlineWidth, outlineColor: css.outlineColor, shadow: css.boxShadow,
      inViewport: box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth,
    };
  });
  await info.attach(`${label}-automated-focus-observation`, { body: JSON.stringify(observed, null, 2), contentType: 'application/json' });
  expect(observed.focusVisible, `${label}: keyboard :focus-visible`).toBe(true);
  expect(observed.inViewport, `${label}: focused target is in viewport`).toBe(true);
  expect((observed.outline !== 'none' && parseFloat(observed.outlineWidth) > 0 &&
    observed.outlineColor !== 'rgba(0, 0, 0, 0)') || observed.shadow !== 'none', `${label}: rendered focus indicator`).toBe(true);
  await info.attach(`${label}-automated-keyboard-screenshot`, { body: await page.screenshot(), contentType: 'image/png' });
}

async function presentation(page: Page, info: TestInfo) {
  await expect(page.locator('html')).toHaveAttribute('lang', info.project.use.locale!);
  await expect(page.locator('html')).toHaveAttribute('dir', info.project.use.locale === 'ar' ? 'rtl' : 'ltr');
  await expect(page.locator('html')).toHaveAttribute('data-theme', info.project.use.colorScheme!);
  const announce = page.getByTestId('status-route-announce');
  await expect(announce).toHaveAttribute('role', 'status');
  await expect(announce).toHaveAttribute('aria-live', 'polite');
  await expect(announce).not.toBeEmpty();
}

test('synthetic fixture: doctor day error recovery and patient details using keyboard only', async ({ page }, info) => {
  const api = await fixture(page, info, 'doctor');
  await page.goto('/doctor/my-day');
  await presentation(page, info);
  await expect(page.getByTestId('state-day-error')).toHaveAttribute('role', 'alert');
  const retry = page.getByTestId('button-day-retry');
  await tabTo(page, retry);
  await focusObservation(page, info, 'doctor-error-retry', retry);
  api.recoverDay();
  await page.keyboard.press('Enter');
  const open = page.getByTestId(`button-day-open-${api.appointment.id}`);
  await expect(open).toBeVisible();
  await expect(page.getByTestId('page-myDay')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByTestId('status-my-day')).toHaveAttribute('role', 'status');
  await expect(page.getByTestId('status-my-day')).toHaveAttribute('aria-live', 'polite');
  await tabTo(page, open);
  await focusObservation(page, info, 'doctor-day-open', open);
  const before = await page.getByTestId('status-route-announce').innerText();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/doctor\/patient-card$/);
  await expect(page.getByTestId(`card-patient-${api.patient.id}`)).toBeVisible();
  await expect(page.getByTestId('text-visit-note-0')).toContainText(api.patient.visits[0].complaint);
  await expect(page.getByTestId('status-patient-card')).toHaveAttribute('aria-live', 'polite');
  await expect(page.getByTestId('status-route-announce')).not.toHaveText(before);
  const back = page.getByTestId('link-myday-back');
  await tabTo(page, back);
  await focusObservation(page, info, 'doctor-details-back', back);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/doctor\/my-day$/);
  await tabTo(page, page.getByTestId('button-user-menu'));
  await api.done();
});

test('synthetic fixture: admin users table, native dropdown, validation and cancel focus', async ({ page }, info) => {
  const api = await fixture(page, info, 'admin');
  await page.goto('/admin/users-devices');
  await presentation(page, info);
  const region = page.getByTestId('region-users-table');
  await tabTo(page, region);
  await expect(region).toHaveAttribute('role', 'region');
  await expect(region).toHaveAccessibleName(/\S/);
  await focusObservation(page, info, 'admin-table-region', region);
  const edit = page.getByTestId(`button-edit-user-${api.user.id}`);
  await tabTo(page, edit);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('dialog-user')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(edit).toBeFocused();
  const add = page.getByTestId('button-add-user');
  await tabTo(page, add);
  await page.keyboard.press('Enter');
  const dialog = page.getByTestId('dialog-user');
  await expect(dialog).toHaveAttribute('role', 'dialog');
  const theme = page.getByTestId('select-user-theme');
  await tabTo(page, theme);
  await page.keyboard.press('End');
  await page.keyboard.press('Tab');
  await expect(theme).toHaveValue('dark');
  await tabTo(page, page.getByTestId('button-user-submit'));
  await page.keyboard.press('Enter'); // Empty required fields: frontend validation, no POST.
  const summary = page.getByTestId('summary-errors');
  await expect(summary).toBeFocused();
  await expect(summary).toHaveAttribute('role', 'alert');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('input-user-email')).toBeFocused();
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press(i < 12 ? 'Tab' : 'Shift+Tab');
    expect(await dialog.evaluate(el => el.contains(document.activeElement)), 'Modal keyboard focus must stay inside while open').toBe(true);
  }
  await tabTo(page, page.getByTestId('button-user-cancel'));
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(region).toBeFocused(); // Cancellation releases containment to the table.
  await api.done();
});

test('synthetic fixture: shared skip/nav, mobile dropdown Escape and dialog exit', async ({ page }, info) => {
  const api = await fixture(page, info, 'admin');
  await page.goto('/admin/users-devices');
  await presentation(page, info);
  const skip = page.getByTestId('link-skip');
  await tabTo(page, skip);
  await focusObservation(page, info, 'shared-skip', skip);
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  const nav = page.getByTestId('link-nav-side-clinicsDoctors');
  await tabTo(page, nav);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/clinics-doctors/);
  await expect(page.locator('#page-title')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  const more = page.getByTestId('button-nav-more');
  await tabTo(page, more);
  await focusObservation(page, info, 'shared-mobile-more', more);
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Home');
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem').last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(more).not.toBeFocused();
  const userMenu = page.getByTestId('button-user-menu');
  await tabTo(page, userMenu);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('dialog-user')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(userMenu).toBeFocused();
  await tabTo(page, more);
  await api.done();
});

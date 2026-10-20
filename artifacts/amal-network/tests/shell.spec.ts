import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Shell tests use the explicit DEV-only fixture (?shellDemo=...) unless they mock /api/me directly.
const demo = (role: string, path = '/') => `${path}${path.includes('?') ? '&' : '?'}shellDemo=${role}`;

const NAV: Record<string, string[]> = {
  'front-desk': ['today', 'week', 'newBooking', 'patientLookup', 'sync', 'daySheet'],
  doctor: ['myDay', 'networkSearch', 'patientCard', 'privacy'],
  admin: ['kpi', 'networkHealth', 'usersDevices', 'clinicsDoctors', 'duplicates', 'audit', 'import', 'developer'],
};
const LANDING: Record<string, string> = { 'front-desk': '/desk/today', doctor: '/doctor/my-day', admin: '/admin/kpi' };
const FOREIGN: Record<string, string> = { 'front-desk': '/admin/audit', doctor: '/desk/new-booking', admin: '/doctor/patient-card' };

async function setPrefs(page: Page, locale: 'ar' | 'en', theme: 'light' | 'dark') {
  await page.getByTestId('button-user-menu').click();
  const dialog = page.getByTestId('dialog-user');
  await dialog.getByTestId(`button-locale-${locale}`).click();
  await dialog.getByTestId(`button-theme-${theme}`).click();
  await page.keyboard.press('Escape');
}

test.describe('roles, routing and guards', () => {
  for (const role of Object.keys(NAV)) {
    test(`${role}: landing, exact nav, direct-URL denial`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(demo(role));
      await expect(page).toHaveURL(new RegExp(`${LANDING[role]}`));
      await expect(page.getByTestId('banner-fixture')).toBeVisible();
      const links = page.getByTestId('nav-sidebar').locator('[data-testid^="link-nav-side-"]');
      await expect(links).toHaveCount(NAV[role].length);
      for (const id of NAV[role]) await expect(page.getByTestId(`link-nav-side-${id}`)).toBeVisible();
      await expect(page.getByTestId(`link-nav-side-${NAV[role][0]}`)).toHaveAttribute('aria-current', 'page');

      await page.getByTestId(`link-nav-side-${NAV[role][1]}`).click();
      await expect(page.getByTestId(`page-${NAV[role][1]}`)).toBeVisible();
      await expect(page.locator('#page-title')).toBeFocused();
      await page.goBack();
      await expect(page.getByTestId(`page-${NAV[role][0]}`)).toBeVisible();
      await page.goForward();
      await expect(page.getByTestId(`page-${NAV[role][1]}`)).toBeVisible();
      await page.reload();
      await expect(page.getByTestId(`page-${NAV[role][1]}`)).toBeVisible();
      for (const id of NAV[role]) {
        await page.getByTestId(`link-nav-side-${id}`).click();
        await expect(page.getByTestId(`page-${id}`)).toBeVisible();
      }

      await page.goto(demo(role, FOREIGN[role]));
      await expect(page.getByTestId('state-forbidden')).toBeVisible();
      await page.goto(demo(role, '/nope/missing'));
      await expect(page.getByTestId('state-notFound')).toBeVisible();
    });
  }

  test('unknown and empty roles deny every destination', async ({ page }) => {
    for (const role of ['unknown', 'empty']) {
      await page.goto(demo(role, '/admin/kpi'));
      await expect(page.getByTestId('state-noRole').or(page.getByTestId('state-forbidden'))).toBeVisible();
      await expect(page.locator('[data-testid^="link-nav-"]')).toHaveCount(0);
    }
  });

  test('signed-out and error identity states offer retry', async ({ page }) => {
    await page.goto(demo('signed-out'));
    await expect(page.getByTestId('state-signedOut')).toBeVisible();
    await expect(page.getByTestId('button-retry-identity')).toBeVisible();
    await page.goto(demo('error'));
    await expect(page.getByTestId('state-error')).toBeVisible();
  });

  test('real adapter: 401 from /api/me renders signed-out state', async ({ page }) => {
    await page.route('**/api/me', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
    await page.goto('/desk/today');
    await expect(page.getByTestId('state-signedOut')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  });

  test('/ui-kit stays reachable', async ({ page }) => {
    await page.goto('/ui-kit');
    await expect(page.getByTestId('status-booked').first()).toBeVisible();
  });
});

const realUser = (id = 42) => ({
  id, email: 'synthetic@example.invalid', role: 'doctor', clinicId: 101, doctorId: 201,
  locale: 'en', theme: 'dark', csrfToken: 'test-only-csrf',
  session: { expiresAt: '2027-01-01T00:00:00Z', absoluteExpiresAt: null, idleTimeoutSeconds: 1800 },
  device: null, reauth: { required: false, validUntil: null },
});
test('real contracts filter unauthorized clinics and preserve session after logout failure', async ({ page }) => {
  await page.route('**/api/me', r => r.fulfill({ json: realUser() }));
  await page.route('**/api/clinics?*', r => r.fulfill({ json: { items: [
    { id: 101, name: 'Authorized synthetic clinic', timezone: 'Asia/Hebron', mode: 'network' },
    { id: 102, name: 'Unauthorized synthetic clinic', timezone: 'Asia/Hebron', mode: 'network' },
  ], nextCursor: null } }));
  let fail = true;
  await page.route('**/api/auth/logout', r => fail
    ? r.fulfill({ status: 500, json: { code: 'TEST_FAILURE' } })
    : r.fulfill({ status: 204 }));
  await page.goto('/doctor/my-day');
  await expect(page.getByTestId('text-clinic-single')).toContainText('Authorized synthetic clinic');
  await expect(page.getByTestId('select-clinic')).toHaveCount(0);
  await expect(page.getByText('Unauthorized synthetic clinic')).toHaveCount(0);
  // Contract profile preferences are not a browser setting: first use remains Arabic/Light.
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByTestId('button-user-menu').click();
  await page.getByTestId('button-logout').click();
  await expect(page.getByTestId('dialog-user').getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('app-shell')).toBeVisible();
  fail = false;
  await page.getByTestId('button-logout').click();
  await expect(page.getByTestId('state-signedOut')).toBeVisible();
});

test('clinic errors preserve identity; expired-session retry clears it', async ({ page }) => {
  let expired = false;
  await page.route('**/api/me', r => expired ? r.fulfill({ status: 401, json: {} }) : r.fulfill({ json: realUser() }));
  await page.route('**/api/clinics?*', r => r.fulfill({ status: 404, json: {} }));
  await page.goto('/doctor/my-day');
  await expect(page.getByTestId('status-clinic-error')).toBeVisible();
  expired = true;
  await page.getByTestId('button-clinic-retry').click();
  await expect(page.getByTestId('state-signedOut')).toBeVisible();
});

test.describe('preferences', () => {
  test('first use is Arabic, light, Latin digits; persists per user without leaking', async ({ page }) => {
    await page.goto(demo('doctor'));
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByTestId('button-user-menu').click();
    const dialog = page.getByTestId('dialog-user');
    await expect(dialog.getByTestId('text-digit-preview')).toContainText('1');
    await dialog.getByTestId('button-digits-arab').click();
    await expect(dialog.getByTestId('text-digit-preview')).toContainText('١');
    await dialog.getByTestId('button-locale-en').click();
    await dialog.getByTestId('button-theme-dark').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('button-user-menu')).toBeFocused();

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.goto(demo('admin'));
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByTestId('button-user-menu').click();
    await expect(page.getByTestId('text-digit-preview')).not.toContainText('١');
  });

  test('malformed storage falls back safely', async ({ page }) => {
    await page.addInitScript(() => { for (let i = 0; i < localStorage.length; i++) localStorage.setItem(localStorage.key(i)!, '{bad'); });
    await page.goto(demo('front-desk'));
    await expect(page.getByTestId('app-shell')).toBeVisible();
  });
});

test.describe('fixture boundaries and session', () => {
  test('fixture query survives nav and refresh but is never stored', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(demo('doctor'));
    await page.getByTestId('link-nav-side-privacy').click();
    await expect(page).toHaveURL(/\/doctor\/privacy\?shellDemo=doctor/);
    await page.reload();
    await expect(page.getByTestId('banner-fixture')).toBeVisible();
    await expect(page.getByTestId('page-privacy')).toBeVisible();
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain('shellDemo');
  });

  test('successful logout shows signed-out state', async ({ page }) => {
    await page.goto(demo('front-desk'));
    await page.getByTestId('button-user-menu').click();
    await page.getByTestId('dialog-user').getByTestId('button-logout').click();
    await expect(page.getByTestId('state-signedOut')).toBeVisible();
  });

  test('no-clinics and clinic-error states are distinct and usable', async ({ page }) => {
    await page.goto(demo('no-clinics'));
    await expect(page.getByTestId('status-clinic-none')).toBeVisible();
    await expect(page.getByTestId('status-clinic-error')).toHaveCount(0);
    await page.goto(demo('clinic-error'));
    await expect(page.getByTestId('status-clinic-error')).toBeVisible();
    await expect(page.getByTestId('status-clinic-none')).toHaveCount(0);
    await page.getByTestId('button-clinic-retry').click();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('status-clinic-error')).toBeVisible();
  });
});

test.describe('clinic, search, menus', () => {
  test('search is a labelled placeholder and clinic switch clears it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(demo('admin'));
    await page.getByTestId('input-global-search').fill('test');
    await page.getByTestId('button-global-search').click();
    await expect(page.getByTestId('status-search')).not.toBeEmpty();
    const select = page.getByTestId('select-clinic');
    if (await select.count()) {
      const values = await select.locator('option').evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
      if (values.length > 1) {
        await select.selectOption(values[1]);
        await expect(page.getByTestId('input-global-search')).toHaveValue('');
        await expect(page.getByTestId('status-search')).toBeEmpty();
      }
    }
    await expect(page.getByTestId('status-connection')).toBeVisible();
  });

  test('single-clinic users get no selector', async ({ page }) => {
    await page.goto(demo('doctor'));
    await expect(page.getByTestId('text-clinic-single')).toBeVisible();
    await expect(page.getByTestId('select-clinic')).toHaveCount(0);
  });

  test('mobile bottom nav + keyboard More menu reaches every admin route', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(demo('admin'));
    await expect(page.getByTestId('nav-bottom')).toBeVisible();
    await expect(page.getByTestId('nav-sidebar')).toBeHidden();
    const more = page.getByTestId('button-nav-more');
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('menuitem-more-developer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(more).toBeFocused();
    await more.click();
    await page.getByTestId('menuitem-more-developer').click();
    await expect(page.getByTestId('page-developer')).toBeVisible();
    const box = await more.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  });

  test('skip link moves to main', async ({ page }) => {
    await page.goto(demo('doctor'));
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('link-skip')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });
});

for (const locale of ['ar', 'en'] as const) for (const theme of ['light', 'dark'] as const) {
  for (const vp of [{ n: 'desktop', width: 1280, height: 900 }, { n: 'tablet', width: 820, height: 1180 }, { n: 'mobile', width: 390, height: 844 }]) {
    test(`axe ${locale}/${theme}/${vp.n}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(demo('admin'));
      await setPrefs(page, locale, theme);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
      await page.getByTestId('button-user-menu').click();
      expect((await new AxeBuilder({ page }).include('[data-testid="dialog-user"]').analyze()).violations).toEqual([]);
      await page.keyboard.press('Escape');
      await page.goto(demo('admin', '/doctor/privacy'));
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

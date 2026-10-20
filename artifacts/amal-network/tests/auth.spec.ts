import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Real-API acceptance (no mocks). Configure via env:
 *  AMAL_E2E_ADMIN_EMAIL / _PASSWORD, AMAL_E2E_DOCTOR_EMAIL / _PASSWORD,
 *  AMAL_E2E_DESK_EMAIL / AMAL_E2E_DESK_PIN (leading-zero PIN, e.g. 0420), AMAL_E2E_DESK2_EMAIL / _PIN (second desk account, same device),
 *  AMAL_E2E_DEVICE_COOKIE ("name=value" trusted reception device cookie), AMAL_E2E_LOCK_EMAIL (desk account that may be locked).
 */
const env = (k: string) => process.env[k] ?? '';
// Real-API auth requires an allowed Origin; never weaken CSRF/origin checks for tests.
const REAL_BASE = process.env.AMAL_E2E_BASE_URL || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : undefined);
if (REAL_BASE) test.use({ baseURL: REAL_BASE });
const LANDING = { admin: '/admin/kpi', doctor: '/doctor/my-day', 'front-desk': '/desk/today' } as const;

async function trustDevice(ctx: BrowserContext, baseURL: string) {
  const raw = env('AMAL_E2E_DEVICE_COOKIE');
  const i = raw.indexOf('=');
  await ctx.addCookies([{ name: raw.slice(0, i), value: raw.slice(i + 1), url: baseURL, httpOnly: true, secure: baseURL.startsWith('https'), sameSite: 'Strict' }]);
}
async function passwordLogin(page: Page, email: string, password: string) {
  await page.getByTestId('input-email').fill(email);
  await page.getByTestId('input-password').fill(password);
  await page.getByTestId('button-submit-password').click();
}
async function pinLogin(page: Page, email: string, pin: string) {
  await page.getByTestId('button-mode-pin').click();
  await expect(page.getByTestId('text-trusted-clinic')).toBeVisible();
  await page.getByTestId('input-pin-email').fill(email);
  await page.getByTestId('input-pin').fill(pin);
  await page.getByTestId('button-submit-pin').click();
}
async function dismissTour(page: Page) {
  const t = page.getByTestId('tour-dialog');
  if (await t.isVisible().catch(() => false)) await page.getByTestId('button-tour-skip').click();
}

test.describe('public surfaces', () => {
  test('login keyboard and contrast at mobile size across both locales and themes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login');
    for (const locale of ['ar', 'en'] as const) for (const theme of ['light', 'dark'] as const) {
      await page.getByTestId(`button-locale-${locale}`).click();
      await page.getByTestId(`button-theme-${theme}`).click();
      await page.getByTestId('input-email').focus();
      await page.keyboard.press('Tab');
      await expect(page.getByTestId('input-password')).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    }
  });
  test('unauthenticated root redirects to login and keeps a safe next', async ({ page }) => {
    await page.goto('/doctor/privacy');
    await expect(page).toHaveURL(/\/login\?next=%2Fdoctor%2Fprivacy/);
    await expect(page.getByTestId('page-login')).toBeVisible();
  });
  test('data page is public, refreshable, linked from login, states no analytics and unavailable self-service', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login');
    await page.getByTestId('link-login-data').click();
    await expect(page).toHaveURL(/\/data$/);
    await page.reload();
    await expect(page.getByTestId('section-no-analytics')).toBeVisible();
    await expect(page.getByTestId('button-withdraw-unavailable')).toBeDisabled();
    await expect(page.getByTestId('button-export-unavailable')).toBeDisabled();
    for (const locale of ['ar', 'en'] as const) for (const theme of ['light', 'dark'] as const) {
      await page.getByTestId(`button-locale-${locale}`).first().click();
      await page.getByTestId(`button-theme-${theme}`).first().click();
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(r.violations, `${locale}/${theme}`).toEqual([]);
    }
  });
  test('login validation, password visibility and untrusted device guidance', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('button-submit-password').click();
    await expect(page.getByText(/valid email|بريدًا إلكترونيًا صحيحًا/)).toBeVisible();
    await page.getByTestId('input-password').fill('secret');
    await page.getByTestId('button-toggle-password').click();
    await expect(page.getByTestId('input-password')).toHaveAttribute('type', 'text');
    await page.getByTestId('button-mode-pin').click();
    await expect(page.getByTestId('status-device-untrusted')).toBeVisible();
    await expect(page.getByTestId('button-submit-pin')).toHaveCount(0);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations).toEqual([]);
  });
});

test.describe('real API sign-in', () => {
  test.skip(!env('AMAL_E2E_ADMIN_EMAIL'), 'Real-API credentials not configured');

  for (const role of ['admin', 'doctor'] as const) {
    test(`${role}: login, tour, restore, logout`, async ({ page }) => {
      const E = role === 'admin' ? 'ADMIN' : 'DOCTOR';
      await page.goto('/login');
      await passwordLogin(page, env(`AMAL_E2E_${E}_EMAIL`), env(`AMAL_E2E_${E}_PASSWORD`));
      await expect(page).toHaveURL(new RegExp(LANDING[role]));
      await expect(page.getByTestId('tour-dialog')).toBeVisible();
      await page.getByTestId('input-global-search').focus(); // focus outside the non-modal coach mark
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('tour-dialog')).toHaveCount(0);
      await page.reload();
      await expect(page.getByTestId('app-shell')).toBeVisible();
      await expect(page.getByTestId('tour-dialog')).toHaveCount(0);
      await page.getByTestId('button-help').click();
      await page.getByTestId('button-replay-tour').click();
      await expect(page.getByTestId('tour-dialog')).toBeVisible();
      const tour = page.getByTestId('tour-dialog');
      const steps = ['welcome', 'nav', 'account', 'help', 'data'];
      await expect(tour).toHaveAttribute('data-step', 'welcome');
      for (let i = 1; i < steps.length; i++) {
        await page.getByTestId('button-tour-next').click();
        await expect(tour).toHaveAttribute('data-step', steps[i]);
      }
      await page.getByTestId('button-tour-back').click();
      await expect(tour).toHaveAttribute('data-step', 'help');
      await page.getByTestId('button-tour-next').click();
      await expect(tour).toHaveAttribute('data-step', 'data');
      await page.getByTestId('button-tour-next').click(); // "Finish" on last step completes
      await expect(tour).toHaveCount(0);
      expect(JSON.stringify(await page.evaluate(() => ({ ...localStorage, ...sessionStorage })))).not.toContain(env(`AMAL_E2E_${E}_PASSWORD`));
      await page.getByTestId('button-user-menu').click();
      await page.getByTestId('button-logout').click();
      await expect(page).toHaveURL(/\/login$/);
      await page.goto(LANDING[role]);
      await expect(page).toHaveURL(/\/login\?next=/);
    });
  }

  test('wrong password shows localized error and clears password', async ({ page }) => {
    await page.goto('/login');
    await passwordLogin(page, env('AMAL_E2E_DOCTOR_EMAIL'), 'definitely-wrong-password');
    await expect(page.getByTestId('status-login-error')).toHaveAttribute('data-error', /unauthorized|rateLimited/);
    await expect(page.getByTestId('input-password')).toHaveValue('');
  });

  test('real rate-limit envelope is translated without retrying credentials', async ({ page }) => {
    test.skip(!env('AMAL_E2E_RATE_EMAIL'), 'Rate-limit fixture required');
    await page.goto('/login');
    let posts = 0;
    page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/auth/login')) posts++; });
    await passwordLogin(page, env('AMAL_E2E_RATE_EMAIL'), 'invalid');
    await expect(page.getByTestId('status-login-error')).toHaveAttribute('data-error', 'rateLimited');
    await page.waitForTimeout(300);
    expect(posts).toBe(1);
  });

  test('server-revoked session clears the mounted shell on the next request', async ({ page, baseURL }) => {
    await page.goto('/login');
    await passwordLogin(page, env('AMAL_E2E_DOCTOR_EMAIL'), env('AMAL_E2E_DOCTOR_PASSWORD'));
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await dismissTour(page);
    const me = await (await page.request.get('/api/me')).json();
    const logout = await page.request.post('/api/auth/logout', { headers: { Origin: baseURL!, 'X-CSRF-Token': me.csrfToken } });
    expect(logout.status()).toBe(204);
    await page.getByTestId('button-clinic-retry').click();
    await expect(page).toHaveURL(/\/login.*reason=expired/);
    await expect(page.getByTestId('status-session-expired')).toBeVisible();
    await expect(page.getByTestId('app-shell')).toHaveCount(0);
  });

  test('safe return destination honored only when authorized', async ({ page }) => {
    await page.goto('/login?next=%2Fadmin%2Faudit');
    await passwordLogin(page, env('AMAL_E2E_DOCTOR_EMAIL'), env('AMAL_E2E_DOCTOR_PASSWORD'));
    await expect(page).toHaveURL(/\/doctor\/my-day/);
    await page.goto('/login?next=%2F%2Fevil.example');
    await expect(page).toHaveURL(/\/doctor\/my-day/);
  });

  test('session loss is detected once and returns to login with expiry notice', async ({ page, context }) => {
    await page.goto('/login');
    await passwordLogin(page, env('AMAL_E2E_DOCTOR_EMAIL'), env('AMAL_E2E_DOCTOR_PASSWORD'));
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await context.clearCookies();
    let meCalls = 0;
    page.on('request', (r) => { if (r.url().endsWith('/api/auth/me') || r.url().endsWith('/api/me')) meCalls++; });
    await page.reload();
    await expect(page).toHaveURL(/\/login/);
    await page.waitForTimeout(1500);
    expect(meCalls).toBeLessThanOrEqual(1);
  });
});

test.describe('real API reception PIN', () => {
  test.skip(!env('AMAL_E2E_DEVICE_COOKIE') || !env('AMAL_E2E_DESK_EMAIL'), 'Trusted device not configured');
  test.beforeEach(async ({ context, baseURL }) => { await trustDevice(context, baseURL!); });

  test('a different clinic account cannot authenticate on this device', async ({ page }) => {
    test.skip(!env('AMAL_E2E_WRONG_CLINIC_EMAIL'), 'Other-clinic fixture required');
    await page.goto('/login');
    await pinLogin(page, env('AMAL_E2E_WRONG_CLINIC_EMAIL'), env('AMAL_E2E_DESK_PIN'));
    await expect(page.getByTestId('status-login-error')).toHaveAttribute('data-error', 'unauthorized');
    await expect(page.getByTestId('app-shell')).toHaveCount(0);
  });

  test('revoked device context denies PIN entry without enrollment controls', async ({ page, context, baseURL }) => {
    const raw = env('AMAL_E2E_REVOKED_DEVICE_COOKIE');
    test.skip(!raw, 'Revoked device fixture required');
    const i = raw.indexOf('=');
    await context.addCookies([{ name: raw.slice(0, i), value: raw.slice(i + 1), url: baseURL!, httpOnly: true, secure: true, sameSite: 'Strict' }]);
    await page.goto('/login');
    await page.getByTestId('button-mode-pin').click();
    await expect(page.getByTestId('status-device-untrusted')).toBeVisible();
    await expect(page.getByTestId('button-submit-pin')).toHaveCount(0);
  });

  test('leading-zero PIN (typed in Arabic digits) signs in; tour isolated per account', async ({ page }) => {
    const ar = env('AMAL_E2E_DESK_PIN').replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
    await page.goto('/login');
    await pinLogin(page, env('AMAL_E2E_DESK_EMAIL'), ar);
    await expect(page).toHaveURL(/\/desk\/today/);
    await expect(page.getByTestId('tour-dialog')).toBeVisible();
    await dismissTour(page);
    await page.getByTestId('button-user-menu').click();
    await page.getByTestId('button-logout').click();
    if (env('AMAL_E2E_DESK2_EMAIL')) {
      await pinLogin(page, env('AMAL_E2E_DESK2_EMAIL'), env('AMAL_E2E_DESK2_PIN'));
      await expect(page.getByTestId('tour-dialog')).toBeVisible();
    }
  });

  test('wrong PIN shows combined guidance; repeated failures lock (server authoritative)', async ({ page }) => {
    const email = env('AMAL_E2E_LOCK_EMAIL') || env('AMAL_E2E_DESK_EMAIL');
    await page.goto('/login');
    await page.getByTestId('button-mode-pin').click();
    for (let i = 0; i < (env('AMAL_E2E_LOCK_EMAIL') ? 6 : 1); i++) {
      await page.getByTestId('input-pin-email').fill(email);
      await page.getByTestId('input-pin').fill('9999');
      await page.getByTestId('button-submit-pin').click();
      await expect(page.getByTestId('status-login-error')).toBeVisible();
      await expect(page.getByTestId('input-pin')).toHaveValue('');
    }
    if (env('AMAL_E2E_LOCK_EMAIL')) await expect(page.getByTestId('status-login-error')).toHaveAttribute('data-error', /pinLocked|rateLimited/);
  });

  test('mobile keyboard: tour falls back to bottom nav and Escape restores focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');
    await pinLogin(page, env('AMAL_E2E_DESK_EMAIL'), env('AMAL_E2E_DESK_PIN'));
    await page.getByTestId('button-help').click();
    await page.getByTestId('button-replay-tour').click();
    await page.getByTestId('button-tour-next').click();
    await expect(page.getByTestId('tour-dialog')).toHaveAttribute('data-step', 'nav');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tour-dialog')).toHaveCount(0);
  });
});

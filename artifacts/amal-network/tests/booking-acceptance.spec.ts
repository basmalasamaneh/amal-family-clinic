import { expect, test } from '@playwright/test';

const dayFixture = '/desk/today?date=2025-03-10&shellDemo=front-desk';
const patientName = 'فاطمة الزهراء عودة';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('amal.tour.v1:fixture%3Afront-desk:front-desk', 'dismissed');
    localStorage.setItem('amal.tour.v1:account:9876:front-desk', 'dismissed');
  });
});

async function setDisplay(page: import('@playwright/test').Page, locale: 'ar' | 'en', theme: 'light' | 'dark') {
  await page.getByTestId('button-user-menu').click();
  const settings = page.getByTestId('dialog-user');
  await settings.getByTestId(locale === 'ar' ? 'button-locale-ar' : 'button-locale-en').click();
  await settings.getByTestId(theme === 'dark' ? 'button-theme-dark' : 'button-theme-light').click();
  await settings.getByTestId('button-user-close').click();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function openPatientOverlap(page: import('@playwright/test').Page) {
  await page.goto(dayFixture);
  await page.getByTestId('link-new-booking').click();
  await page.getByTestId('input-patient-search').fill(patientName);
  await expect(page.getByTestId('option-patient-9003')).toBeVisible();
  await page.getByTestId('input-patient-search').click();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('select-booking-doctor')).toBeVisible();
  await page.getByTestId('select-booking-doctor').selectOption('9100101');
  await page.getByTestId('input-booking-date').fill('2025-03-10');
  await page.getByTestId('input-booking-time').fill('09:00');
  await expect(page.getByTestId('button-review-conflicts')).toBeVisible({ timeout: 5000 });
  await page.getByTestId('button-review-conflicts').click();
  await expect(page.getByTestId('text-no-override')).toBeVisible();
  await expect(page.getByTestId('section-override')).toHaveCount(0);
  await page.waitForTimeout(250);
}

test('drawer and patient-overlap dialog stay within desktop/mobile viewports in Arabic/English and light/dark', async ({ page }) => {
  test.setTimeout(90000);
  const viewports = [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ];
  const locales = ['ar', 'en'] as const;
  const themes = ['light', 'dark'] as const;

  for (const viewport of viewports) {
    for (const locale of locales) {
      for (const theme of themes) {
        await page.setViewportSize(viewport);
        await page.goto(dayFixture);
        await setDisplay(page, locale, theme);
        await page.getByTestId('link-new-booking').click();
        await expect(page.getByTestId('drawer-booking')).toBeVisible();
        await page.waitForTimeout(350);
        const drawer = await page.evaluate(() => {
          const r = document.querySelector('[data-testid="drawer-booking"]')!.getBoundingClientRect();
          return { left: r.left, right: r.right, width: r.width, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth };
        });
        expect.soft(drawer.left, `${viewport.width}px drawer left, ${locale}/${theme}`).toBeGreaterThanOrEqual(0);
        expect.soft(drawer.right, `${viewport.width}px drawer right, ${locale}/${theme}`).toBeLessThanOrEqual(viewport.width);
        expect.soft(drawer.scrollWidth, `${viewport.width}px drawer scrollWidth, ${locale}/${theme}`).toBeLessThanOrEqual(drawer.clientWidth);

        await page.keyboard.press('Escape');
        await openPatientOverlap(page);
        const geometry = await page.evaluate(() => {
          const dialogs = [...document.querySelectorAll('[role="dialog"]')];
          const drawer = dialogs[0].getBoundingClientRect();
          const conflict = dialogs[dialogs.length - 1].getBoundingClientRect();
          return {
            viewportWidth: innerWidth,
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            drawer: { left: drawer.left, right: drawer.right },
            conflict: { left: conflict.left, right: conflict.right, width: conflict.width },
          };
        });
        expect.soft(geometry.drawer.left, `${viewport.width}px conflict drawer left, ${locale}/${theme}`).toBeGreaterThanOrEqual(0);
        expect.soft(geometry.drawer.right, `${viewport.width}px conflict drawer right, ${locale}/${theme}`).toBeLessThanOrEqual(viewport.width);
        expect.soft(geometry.conflict.left, `${viewport.width}px conflict left, ${locale}/${theme}`).toBeGreaterThanOrEqual(0);
        expect.soft(geometry.conflict.right, `${viewport.width}px conflict right, ${locale}/${theme}`).toBeLessThanOrEqual(viewport.width);
        expect.soft(geometry.scrollWidth, `${viewport.width}px conflict scrollWidth, ${locale}/${theme}`).toBeLessThanOrEqual(geometry.clientWidth);

        const controls = page.getByTestId('dialog-conflicts').locator('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]');
        await controls.last().focus();
        await page.keyboard.press('Tab');
        await expect(controls.first()).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(controls.last()).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('button-review-conflicts')).toBeFocused();
      }
    }
  }
});

test('patient 9003 cannot proceed or acknowledge an overlap', async ({ page }) => {
  await openPatientOverlap(page);
  await expect(page.getByTestId('conflict-patient-overlap')).toBeVisible();
  await expect(page.getByTestId('checkbox-override-ack')).toHaveCount(0);
  await expect(page.getByTestId('input-override-reason')).toHaveCount(0);
  await expect(page.getByTestId('button-stage-next')).toBeDisabled();
  await page.getByTestId('button-close-conflicts').click();
  await expect(page.getByTestId('button-stage-next')).toBeDisabled();
  await expect(page.getByTestId('button-confirm-booking')).toHaveCount(0);
});

test('nonoverlapping patient fixture hold expires and can be rechecked', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(dayFixture);
  await page.getByTestId('link-new-booking').click();
  await page.getByTestId('input-patient-search').fill('محمد');
  await expect(page.getByTestId('option-patient-9001')).toBeVisible();
  await page.getByTestId('option-patient-9001').click();
  await page.getByTestId('select-booking-doctor').selectOption('9100101');
  await page.getByTestId('input-booking-date').fill('2025-03-10');
  await page.getByTestId('input-booking-time').fill('09:00');
  await expect(page.getByTestId('button-review-conflicts')).toBeVisible({ timeout: 5000 });
  await page.getByTestId('button-review-conflicts').click();
  await expect(page.getByTestId('section-override')).toHaveCount(0);
  await page.getByTestId('button-close-conflicts').click();
  await expect(page.getByTestId('button-stage-next')).toBeEnabled();
  await page.getByTestId('button-stage-next').click();
  await expect(page.getByTestId('status-hold-active')).toBeVisible();
  await expect(page.getByTestId('status-hold-expired')).toBeVisible({ timeout: 40000 });
  await page.getByTestId('button-hold-again').click();
  await expect(page.getByTestId('status-hold-active')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('status-fixture-writes')).toBeVisible();
  await expect(page.getByTestId('button-confirm-booking')).toBeEnabled();
});

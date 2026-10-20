import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { editFixture, editOrigin } from './helpers/edit-fixture';

test.use({ baseURL: editOrigin, timezoneId: 'America/New_York' });
test.skip(process.env.AMAL_EDIT_LIVE !== '1', 'Requires prepared development schema; opt in with AMAL_EDIT_LIVE=1');
test.describe.configure({ mode: 'serial' });

async function display(page: Page, locale: 'ar' | 'en', theme: 'light' | 'dark') {
  await page.getByTestId('button-user-menu').click();
  await page.getByTestId('dialog-user').getByTestId(`button-locale-${locale}`).click();
  await page.getByTestId('dialog-user').getByTestId(`button-theme-${theme}`).click();
  await page.getByTestId('button-user-close').click();
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
}
async function open(page: Page, id: number) {
  await page.getByTestId(`card-appointment-${id}`).click();
  await page.getByTestId('button-edit-appointment').click();
  await expect(page.getByTestId('input-edit-time')).toBeVisible();
}

for (const locale of ['ar', 'en'] as const) for (const theme of ['light', 'dark'] as const) {
  test(`real edit persists identity and safely rejects conflicts ${locale}/${theme}`, async ({ page, context }, info) => {
    test.setTimeout(150_000);
    const f = await editFixture(context);
    try {
      const original = await f.row();
      await page.goto('/desk/today?date=2030-01-07');
      await display(page, locale, theme);
      await open(page, f.ids[0]!);
      await expect(page.getByTestId('input-edit-date')).toHaveValue('2030-01-07');
      await expect(page.getByTestId('input-edit-time')).toHaveValue('09:00'); // Hebron, not browser's New York.
      await expect(page.getByTestId('select-edit-duration')).toHaveValue('30');
      await expect(page.getByTestId('button-edit-save')).toBeDisabled(); // Honest no-change state.
      await page.getByTestId('input-edit-time').fill('10:00');
      await expect(page.getByTestId('status-check-blocked')).toBeVisible();
      await expect(page.getByTestId('button-edit-save')).toBeDisabled();
      expect(await f.row()).toEqual(original);
      // Discarding a draft performs no appointment mutation.
      await page.getByTestId('button-edit-cancel').click();
      expect(await f.row()).toEqual(original);
      await open(page, f.ids[0]!);
      // Duration-only edit overlaps its original interval and must exclude itself.
      await page.getByTestId('select-edit-duration').selectOption('45');
      await expect(page.getByTestId('button-edit-save')).toBeEnabled();
      const patch = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().endsWith(`/appointments/${f.ids[0]}`));
      await page.getByTestId('button-edit-save').click();
      expect((await patch).status()).toBe(200);
      await expect(page.getByTestId('drawer-edit-appointment')).toHaveCount(0);
      const extended = await f.row();
      expect(extended.duration_minutes).toBe(45);
      for (const key of ['appointment_id', 'patient_id', 'doctor_id', 'clinic_id', 'booking_method', 'status', 'client_op_id']) expect(extended[key]).toEqual(original[key]);
      await page.reload();
      await open(page, f.ids[0]!);
      await expect(page.getByTestId('select-edit-duration')).toHaveValue('45');

      // Real commit-time rejection after a previously clean preview.
      await page.getByTestId('input-edit-time').fill('11:00');
      await expect(page.getByTestId('button-edit-save')).toBeEnabled();
      await f.moveBlocker('2030-01-07T09:00:00Z');
      const rejected = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().endsWith(`/appointments/${f.ids[0]}`));
      await page.getByTestId('button-edit-save').click();
      expect((await rejected).status()).toBe(409);
      expect(await f.row()).toEqual(extended);
      await expect(page.getByTestId('dialog-conflicts')).toBeVisible();
      await page.getByTestId('button-close-conflicts').click();
      await expect(page.getByTestId('input-edit-time')).toHaveValue('11:00');
      await f.moveBlocker('2030-01-07T08:00:00Z');

      await page.getByTestId('input-edit-time').fill('12:00');
      await expect(page.getByTestId('button-edit-save')).toBeEnabled();
      await f.advanceVersion();
      const stale = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().endsWith(`/appointments/${f.ids[0]}`));
      await page.getByTestId('button-edit-save').click();
      expect((await stale).status()).toBe(409);
      await expect(page.getByTestId('status-edit-stale')).toBeVisible();
      await expect(page.getByTestId('button-edit-save')).toBeDisabled();
      await expect(page.getByTestId('input-edit-time')).toHaveValue('12:00');
      await page.getByTestId('button-edit-stale-reload').click();
      await expect(page.getByTestId('button-edit-save')).toBeEnabled();
      const audit = await new AxeBuilder({ page }).include('[data-testid="drawer-edit-appointment"]').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(audit.violations).toEqual([]);
      await page.setViewportSize({ width: 390, height: 844 });
      const bounds = await page.getByTestId('drawer-edit-appointment').boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
      await info.attach(`${locale}-${theme}-edit`, { body: await page.screenshot(), contentType: 'image/png' });
      // Move outside the currently visible day; the old card must disappear.
      await page.getByTestId('input-edit-date').fill('2030-01-14');
      await expect(page.getByTestId('button-edit-save')).toBeEnabled();
      const moved = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().endsWith(`/appointments/${f.ids[0]}`));
      await page.getByTestId('button-edit-save').click();
      expect((await moved).status()).toBe(200);
      await expect(page.getByTestId(`card-appointment-${f.ids[0]}`)).toHaveCount(0);
      await page.goto('/desk/week?date=2030-01-14');
      await open(page, f.ids[0]!);
      await expect(page.getByTestId('input-edit-time')).toHaveValue('12:00');
      await expect(page.getByTestId('input-edit-date')).toHaveValue('2030-01-14');
      expect((await f.row()).scheduled_at.toISOString()).toBe('2030-01-14T10:00:00.000Z');
      expect(await f.seed()).toEqual(f.before);
      await page.getByTestId('button-edit-cancel').click();
    } finally { await page.goto('about:blank'); await f.cleanup(); }
  });
}

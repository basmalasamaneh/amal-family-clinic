import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const states = ['booked', 'completed', 'noshow', 'conflict', 'sync', 'cancelled'];
const english = ['Booked', 'Completed', 'No-show', 'Conflict', 'Waiting to sync', 'Cancelled'];

for (const locale of ['ar', 'en']) for (const theme of ['light', 'dark']) {
  test(`${locale}/${theme}: responsive, localized, interactive and accessible`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/ui-kit');
    await page.getByTestId(`button-locale-${locale}`).click();
    await page.getByTestId(`button-theme-${theme}`).click();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('16px "IBM Plex Sans Arabic"', 'شبكة Amal'))).toBeTruthy();
    expect(await page.locator('.amal-logo text').first().evaluate((el) => getComputedStyle(el).fontFamily)).toContain('IBM Plex Sans Arabic');
    expect((await page.request.get('/amal-logo-mark.svg')).ok()).toBeTruthy();
    for (const [i, state] of states.entries()) {
      const badge = page.getByTestId(`status-${state}`).first();
      await expect(badge).toBeVisible();
      await expect(badge.locator('svg')).toHaveCount(1);
      if (locale === 'en') await expect(badge).toHaveText(english[i]);
      else expect(await badge.innerText()).toMatch(/[\u0600-\u06ff]/);
    }
    await page.getByTestId('button-form-submit').click();
    await expect(page.getByTestId('input-name')).toBeFocused();
    await expect(page.getByTestId('input-name')).toHaveAttribute('aria-invalid', 'true');
    await page.getByTestId('input-name').fill(locale === 'ar' ? 'مثال' : 'Example');
    await page.getByTestId('input-phone').fill('0591234567');
    await page.getByTestId('button-form-submit').click();
    await expect(page.locator('.amal-toast')).toHaveCount(1);
    await page.locator('.amal-toast__close').click();
    await page.getByTestId('button-demo-loading').click();
    await expect(page.getByTestId('button-demo-loading')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByTestId('button-demo-loading')).not.toHaveAttribute('aria-busy', 'true');
    await page.locator('.amal-toast__close').click();
    await page.getByTestId('button-empty-add').click();
    await expect(page.getByTestId('row-item-1')).toBeVisible();
    await page.getByTestId('button-remove-1').click();
    await expect(page.getByTestId('button-empty-add')).toBeVisible();
    await page.getByTestId('button-toast-danger').click();
    await expect(page.locator('.amal-toast')).toHaveAttribute('role', 'alert');
    // Keep the actionable toast visible for the accessibility scan.
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(scan.violations, JSON.stringify(scan.violations, null, 2)).toEqual([]);
    }
    await page.locator('.amal-toast__action').click();
    await expect(page.locator('.amal-toast')).toHaveAttribute('data-tone', 'success');
    await page.locator('.amal-toast__close').click();
    await page.getByTestId('button-theme-light').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.getByTestId('button-theme-light').evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    const smallTargets = await page.locator('button,input').evaluateAll((els) => els.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.width < 44 || r.height < 44);
    }).map((el) => el.outerHTML));
    expect(smallTargets).toEqual([]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByTestId('button-demo-loading').click();
    expect(await page.locator('.amal-spin').evaluate((el) => parseFloat(getComputedStyle(el).animationDuration))).toBeLessThanOrEqual(0.001);
    expect(errors).toEqual([]);
  });
}

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Public read-only checks. No credentials, private DOM or API writes.
test.use({ trace: 'off', screenshot: 'off', video: 'off', reducedMotion: 'reduce' });
for (const locale of ['ar', 'en']) for (const theme of ['light', 'dark']) {
  test(`public keyboard regression ${locale}/${theme}`, async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.getByTestId(`button-locale-${locale}`).focus();
    await page.keyboard.press('Space');
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await page.getByTestId(`button-theme-${theme}`).focus();
    await page.keyboard.press('Space');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.goto('/data', { waitUntil: 'domcontentloaded' });
    for (const section of ['stored', 'who', 'consent', 'audit', 'choices']) {
      await page.locator(`a[href="#data-${section}"]`).focus();
      await page.keyboard.press('Enter');
      await expect(page.locator(`#data-${section}`)).toBeFocused();
    }
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    const audit = await new AxeBuilder({ page }).analyze();
    expect(audit.violations.map(v => ({ id: v.id, impact: v.impact }))).toEqual([]);
  });
}

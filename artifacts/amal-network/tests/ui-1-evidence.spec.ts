import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../../../docs/screenshots/ui-1/', import.meta.url));

async function display(page: Page, locale: 'ar' | 'en', theme: 'light' | 'dark', shell: boolean) {
  if (shell) {
    if (await page.getByTestId('tour-dialog').isVisible()) await page.getByTestId('button-tour-skip').click();
    await page.getByTestId('button-user-menu').click();
    const dialog = page.getByTestId('dialog-user');
    await dialog.getByTestId(`button-locale-${locale}`).click();
    await dialog.getByTestId(`button-theme-${theme}`).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  } else {
    await page.getByTestId(`button-locale-${locale}`).click();
    await page.getByTestId(`button-theme-${theme}`).click();
  }
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.evaluate(async () => { await document.fonts.ready; });
}

for (const surface of ['shell', 'ui-kit'] as const) {
  test(`${surface}: screenshot and axe (presentation fixture evidence only)`, async ({ page }, info) => {
    const locale = info.project.use.locale as 'ar' | 'en';
    const theme = info.project.use.colorScheme as 'light' | 'dark';
    const shell = surface === 'shell';
    const writes: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    // Neither screenshots nor axe are allowed to reach operational APIs.
    // Existing shellDemo provides identity/clinic chrome; no custom auth bypass.
    await page.route('**/api/**', route => {
      if (!['GET', 'HEAD'].includes(route.request().method())) writes.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      return route.fulfill({ status: 503, json: { code: 'INTERNAL', messageKey: 'error.internal', params: {} } });
    });
    await page.goto(shell ? '/desk/today?shellDemo=front-desk' : '/ui-kit');
    if (shell) {
      await expect(page.getByTestId('app-shell')).toBeVisible();
      // Keep this visible in the PNG: it explicitly identifies synthetic data.
      await expect(page.getByTestId('banner-fixture')).toBeVisible();
    } else await expect(page.getByTestId('text-page-title')).toBeVisible();
    await display(page, locale, theme, shell);
    await mkdir(output, { recursive: true });
    const stem = `${surface}-${locale}-${theme}${shell ? '-FIXTURE' : ''}`;
    const screenshot = `${output}${stem}.png`;
    await page.screenshot({ path: screenshot, fullPage: true });
    const axe = await new AxeBuilder({ page }).analyze();
    const evidence = {
      surface, locale, theme, url: page.url(), screenshot: `${stem}.png`,
      evidenceScope: shell
        ? 'Existing DEV shellDemo fixture; presentation ONLY, not authenticated browser verification or operational data.'
        : 'Public UI kit component gallery; presentation ONLY.',
      apiPolicy: 'All /api requests fulfilled locally with 503; no backend reads or writes.',
      writes, browserErrors: errors,
      axe: { testEngine: axe.testEngine, testEnvironment: axe.testEnvironment, violations: axe.violations,
        incomplete: axe.incomplete, passes: axe.passes.map(rule => rule.id) },
    };
    const report = `${output}${stem}.json`;
    await writeFile(report, `${JSON.stringify(evidence, null, 2)}\n`);
    await info.attach(stem, { path: screenshot, contentType: 'image/png' });
    await info.attach(`${stem}-axe`, { path: report, contentType: 'application/json' });
    expect(axe.violations.filter(issue => issue.impact === 'critical' || issue.impact === 'serious'),
      'No critical/serious axe violations; full results retained alongside screenshots').toEqual([]);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

// Focused real-Orca password validation retest; no credentials or AX snapshots.
import { chromium, expect } from '@playwright/test';
import { appendFileSync } from 'node:fs';

const mark = (step, facts = {}) => {
  appendFileSync(process.env.SR_STEPS, `${JSON.stringify({
    time: new Date().toISOString(), step, ...facts,
  })}\n`, { mode: 0o600 });
};
const browser = await chromium.launch({
  executablePath: '/repl/tools/bin/chromium',
  headless: false,
  args: ['--no-sandbox', '--force-renderer-accessibility=complete',
    '--enable-accessibility', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--password-store=basic'],
});
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let blockedWrites = 0;
  await context.route('**/*', async route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
      blockedWrites++;
      mark('blocked non-read-only request (no URL/body recorded)');
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  for (const locale of ['en', 'ar']) {
    mark(`${locale}: fresh real public password login`);
    await page.goto(`${process.env.SR_BASE_URL || 'http://localhost:80'}/login`, {
      waitUntil: 'networkidle',
    });
    await page.bringToFront();
    await page.getByTestId(`button-locale-${locale}`).focus();
    await page.keyboard.press('Space');
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await page.waitForTimeout(1800);
    await expect(page.getByTestId('input-email')).toHaveValue('');
    await expect(page.getByTestId('input-password')).toHaveValue('');
    mark(`${locale}: empty-submit button focus (no input refocus)`);
    await page.getByTestId('button-submit-password').focus();
    await page.waitForTimeout(1800);
    mark(`${locale}: keyboard Enter empty submit; automatic announcement window starts`);
    const start = Date.now();
    await page.keyboard.press('Enter');
    // Expect the app's scheduled post-commit focus, never focus the field here.
    await expect(page.getByTestId('input-email')).toBeFocused({ timeout: 1000 });
    await expect(page.getByTestId('input-email')).toHaveAttribute('aria-invalid', 'true');
    mark(`${locale}: automatic first-invalid focus assertion passed`, {
      focusedTestId: 'input-email', elapsedMs: Date.now() - start,
    });
    await page.waitForTimeout(3500);
    mark(`${locale}: automatic announcement window ends; no manual field refocus occurred`);
    // Only AFTER capturing automatic email output: normal keyboard advancement.
    mark(`${locale}: keyboard Tab from automatically focused email to password`);
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('input-password')).toBeFocused();
    await expect(page.getByTestId('input-password')).toHaveAttribute('aria-invalid', 'true');
    await page.waitForTimeout(2800);
    mark(`${locale}: password description observation ends`);
  }
  expect(blockedWrites).toBe(0);
  mark('completed focused real password retest', { blockedWrites });
} finally {
  await browser.close();
}

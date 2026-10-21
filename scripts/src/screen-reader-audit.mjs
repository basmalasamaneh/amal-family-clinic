// Real headed Chromium + Orca probes. No AX snapshot, auth, traces, or raw API logging.
import { chromium } from '@playwright/test';
import { appendFileSync } from 'node:fs';

const origin = process.env.SR_BASE_URL || 'http://localhost:80';
const steps = process.env.SR_STEPS;
const mark = (name, facts = {}) => {
  const line = JSON.stringify({ time: new Date().toISOString(), step: name, ...facts });
  appendFileSync(steps, `${line}\n`, { mode: 0o600 });
  console.log(name);
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
  // Defense in depth: this audit never sends credentials or changes server data.
  await context.route('**/*', async route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
      mark('blocked non-read-only request (no URL/body recorded)');
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  const pause = () => page.waitForTimeout(2200);
  const focus = async (testId, label) => {
    mark(label);
    await page.getByTestId(testId).focus();
    await pause();
  };
  const activate = async (testId, label) => {
    await focus(testId, `${label}: focus`);
    mark(`${label}: activate with Space`);
    await page.keyboard.press('Space');
    await pause();
  };
  mark('public login: initial Arabic page load');
  await page.goto(`${origin}/login`, { waitUntil: 'networkidle' });
  await page.bringToFront();
  await pause();
  await activate('button-locale-en', 'login locale to English');
  mark('English login skip link focus, then sequential Tab traversal');
  await page.locator('a[href="#auth-main"]').focus();
  await pause();
  for (let i = 1; i <= 11; i++) {
    mark(`English login keyboard Tab ${i}`);
    await page.keyboard.press('Tab');
    await pause();
  }
  await focus('input-email', 'English email label probe');
  await focus('input-password', 'English password label probe (empty)');
  await activate('button-toggle-password', 'English password visibility toggle (empty)');
  await focus('button-submit-password', 'English empty-submit button');
  mark('English empty form Enter: client-side dynamic validation; no auth request');
  await page.keyboard.press('Enter');
  await pause();
  await focus('input-email', 'English invalid email refocus');
  await focus('input-password', 'English invalid password refocus');
  await activate('button-mode-pin', 'English reception PIN mode: real public device-context error');
  await page.waitForTimeout(2500);
  await activate('button-locale-ar', 'login locale to Arabic with device alert mounted');
  await activate('button-mode-password', 'Arabic password mode');
  await focus('input-email', 'Arabic email label probe');
  await focus('input-password', 'Arabic password label probe (empty)');
  await focus('button-submit-password', 'Arabic empty-submit button');
  mark('Arabic empty form Enter: client-side dynamic validation; no auth request');
  await page.keyboard.press('Enter');
  await pause();
  await focus('input-email', 'Arabic invalid email refocus');
  await focus('input-password', 'Arabic invalid password refocus');
  await focus('link-login-data', 'Arabic public data link');
  mark('Arabic data navigation via keyboard Enter');
  await page.keyboard.press('Enter');
  await page.getByTestId('page-data').waitFor();
  await pause();
  for (const locale of ['ar', 'en']) {
    if (locale === 'en') await activate('button-locale-en', 'data locale to English');
    for (const section of ['stored', 'who', 'consent', 'audit', 'choices']) {
      mark(`${locale} data TOC ${section}: focus probe`);
      await page.locator(`a[href="#data-${section}"]`).focus();
      await pause();
      mark(`${locale} data TOC ${section}: keyboard Enter`);
      await page.keyboard.press('Enter');
      await pause();
      mark(`${locale} data TOC ${section}: focus result`, {
        targetFocused: await page.locator(`#data-${section}`).evaluate(el => el === document.activeElement),
      });
    }
    mark(`${locale} data visibility table region focus probe`);
    await page.locator('.data-table-wrap').focus();
    await pause();
    mark(`${locale} data Orca next-heading key h`);
    await page.keyboard.press('h');
    await pause();
    mark(`${locale} data return-to-login link label probe`);
    await page.getByTestId('link-data-back').focus();
    await pause();
  }
  mark('completed: only public read-only real pages; no authenticated fixture used');
} finally {
  await browser.close();
}

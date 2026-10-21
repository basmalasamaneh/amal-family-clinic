import { test, expect } from '@playwright/test';

// Bounded UI regression, not a screen-reader test. The PIN device context is a
// synthetic browser-only fixture; no device credentials or sessions are used.
test.use({ trace: 'off', screenshot: 'off', video: 'off', serviceWorkers: 'block' });
for (const locale of ['en', 'ar'] as const) {
  for (const mode of ['password', 'pin'] as const) {
    test(`empty ${mode} submit focuses committed invalid email (${locale})`, async ({ page }) => {
      test.setTimeout(20_000);
      let attemptedWrites = 0;
      let fixtureReads = 0;
      await page.route('**/*', async route => {
        const request = route.request();
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
          attemptedWrites++;
          return route.abort();
        }
        if (mode === 'pin' && new URL(request.url()).pathname === '/api/auth/device-context') {
          fixtureReads++;
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ clinic: { id: 1, name: 'Synthetic validation-only clinic' } }),
          });
        }
        return route.continue();
      });
      await page.goto('/login');
      await page.getByTestId(`button-locale-${locale}`).click();
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      if (mode === 'pin') {
        await page.getByTestId('button-mode-pin').click();
        await expect(page.getByTestId('text-trusted-clinic')).toBeVisible();
      }
      const email = page.getByTestId(mode === 'password' ? 'input-email' : 'input-pin-email');
      const secret = page.getByTestId(mode === 'password' ? 'input-password' : 'input-pin');
      await expect(email).toHaveValue('');
      await expect(secret).toHaveValue('');
      await page.getByTestId(`button-submit-${mode}`).focus();
      await page.keyboard.press('Enter');
      // No test-side focus: the app must move focus after committing descriptions.
      await expect(email).toBeFocused({ timeout: 1000 });
      for (const input of [email, secret]) {
        await expect(input).toHaveAttribute('aria-invalid', 'true');
        const descriptionIds = (await input.getAttribute('aria-describedby'))?.split(/\s+/) ?? [];
        const errorId = descriptionIds.find(id => id.endsWith('-error'));
        expect(errorId, 'invalid input references its committed error').toBeTruthy();
        const error = page.locator(`[id="${errorId}"]`);
        await expect(error).toBeVisible();
        await expect(error).toContainText(locale === 'en'
          ? (input === email ? /valid email/ : mode === 'password' ? /password/ : /four digits/)
          : (input === email ? /بريد/ : mode === 'password' ? /كلمة المرور/ : /أربعة أرقام/));
      }
      await page.keyboard.press('Tab');
      await expect(secret).toBeFocused();
      // Allow a bounded turn for an erroneously scheduled network write to appear.
      await page.waitForTimeout(150);
      expect(attemptedWrites, 'empty client validation sends no write request').toBe(0);
      expect(fixtureReads).toBe(mode === 'pin' ? 1 : 0);
    });
  }
}

import { test, expect, chromium, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

const origin = 'http://127.0.0.1:4178';
const mount = '/pwa-check/';

async function activated(page: Page) {
  await page.goto('login');
  await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    if (ready.active?.state !== 'activated') {
      await new Promise<void>((resolve) => ready.active?.addEventListener('statechange', () => {
        if (ready.active?.state === 'activated') resolve();
      }));
    }
  });
  // No clientsClaim: the first online document is controlled on its next load.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test('localized install manifests, approved icons and Chromium installability', async ({ page, request }) => {
  await activated(page);
  for (const locale of ['ar', 'en'] as const) {
    await page.getByTestId(`button-locale-${locale}`).click();
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', `${mount}manifest-${locale}.webmanifest`);
    const response = await request.get(`${mount}manifest-${locale}.webmanifest`);
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    expect(manifest.lang).toBe(locale);
    expect(manifest.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    expect(manifest.display).toBe('standalone');
    for (const key of ['id', 'start_url', 'scope']) {
      expect(new URL(manifest[key], `${origin}${mount}manifest-${locale}.webmanifest`).href).toBe(`${origin}${mount}`);
    }
    expect(manifest.icons.map((icon: { purpose: string }) => icon.purpose)).toContain('maskable');
    for (const icon of manifest.icons) {
      const image = await request.get(`${mount}${icon.src}`);
      expect(image.headers()['content-type']).toContain('image/png');
      const bytes = await image.body();
      const [width, height] = icon.sizes.split('x').map(Number);
      expect(bytes.readUInt32BE(16)).toBe(width);
      expect(bytes.readUInt32BE(20)).toBe(height);
    }
  }
  const apple = await request.get(`${mount}icons/apple-touch-icon.png`);
  expect((await apple.body()).readUInt32BE(16)).toBe(180);
  const cdp = await page.context().newCDPSession(page);
  const result = await cdp.send('Page.getAppManifest');
  expect(result.errors.filter((error) => error.critical)).toEqual([]);
  expect(result.data).toBeTruthy();
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors.filter(error => error.errorId !== 'in-incognito')).toEqual([]);
  // Playwright's ordinary contexts are incognito; verify actual eligibility in a fresh normal profile.
  const profile = await mkdtemp(`${tmpdir()}/amal-install-`);
  const normal = await chromium.launchPersistentContext(profile, {
    headless: true, baseURL: `${origin}${mount}`,
    ...(existsSync('/repl/tools/bin/chromium') ? { executablePath: '/repl/tools/bin/chromium' } : {}),
  });
  try {
    const tab = await normal.newPage();
    await activated(tab);
    const protocol = await normal.newCDPSession(tab);
    await protocol.send('Page.getAppManifest');
    expect((await protocol.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([]);
  } finally { await normal.close(); await rm(profile, { recursive: true, force: true }); }
});

test('activated public shell works offline; APIs and excluded surfaces never fall back or cache', async ({ page, context, request }) => {
  await activated(page);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)).toBe(`${origin}${mount}`);
  for (const path of ['/api/v1/auth/me', `${mount}api/patients`, `${mount}auth/callback`]) {
    const response = await request.get(path);
    expect(response.status()).toBe(503);
    // Also issue the API request from a controlled client, not just the test runner.
    expect(await page.evaluate(async (url) => (await fetch(url)).status, path)).toBe(503);
  }
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    }
    return urls;
  });
  expect(cached.length).toBeGreaterThan(10);
  expect(cached.some((url) => /\.(woff2?|ttf)(?:\?|$)/.test(url))).toBe(true);
  expect(cached.some((url) => /\.js(?:\?|$)/.test(url))).toBe(true);
  expect(cached.every((url) => {
    const path = new URL(url).pathname;
    return path.startsWith(mount) && /\.(html|js|css|woff2?|ttf|svg|png|webmanifest|json)$/.test(path)
      && !/(?:^|\/)(api|auth|docs|__mockup|canvas)(?:\/|$)/.test(path);
  })).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('state-error')).toBeVisible();
  await page.goto('doctor/my-day');
  // No API = locked offline shell, never an authenticated patient page.
  await expect(page.getByTestId('state-error')).toBeVisible();
  await expect(page.getByTestId('button-retry-identity')).toBeVisible();
  const failures = await page.evaluate(async () => {
    const paths = ['/api/v1/auth/me', '/pwa-check/api/patients', '/pwa-check/auth/callback', '/pwa-check/login'];
    return Promise.all(paths.map(async (path) => {
      try { await fetch(path); return false; } catch { return true; }
    }));
  });
  // Even a non-document fetch of an app document route must not get fallback HTML.
  expect(failures).toEqual([true, true, true, true]);
  for (const path of ['api/patients', 'auth/callback', 'docs', '__mockup', 'canvas/a']) {
    const probe = await context.newPage();
    await expect(probe.goto(path)).rejects.toThrow();
    await probe.close();
  }
});

for (const mode of ['success', 'deletion-failure', 'both-storage-failures']) test(`synthetic authorized context ${mode}`, async ({ page, context }) => {
  const failCleanup = mode !== 'success';
  // Isolated HTTP projections only: no real account, token, or backend mutation.
  await context.route('**/api/me', route => route.fulfill({ json: {
    id: 991, email: 'synthetic@example.test', role: 'doctor', clinicId: 992,
    session: { expiresAt: new Date(Date.now() + 600_000).toISOString() },
  } }));
  await context.route('**/api/clinics?*', route => route.fulfill({ json: {
    items: [{ id: 992, name: 'Synthetic clinic', mode: 'network', timezone: 'Asia/Hebron' }], nextCursor: null,
  } }));
  await context.route('**/api/auth/logout', route => route.fulfill({ status: 204 }));
  await page.goto('doctor/my-day');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  if (await page.getByTestId('tour-dialog').isVisible()) await page.getByTestId('button-tour-skip').click();
  await expect(page.getByTestId('status-private-storage')).toHaveCount(0);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('amal-private-cache');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const tx = db.transaction(['patients', 'outbox'], 'readwrite');
    tx.objectStore('patients').put({ userId: 'account:991', clinicId: 992, id: 993, name: 'Synthetic only', phone: '', dateOfBirth: '2000-01-01' });
    tx.objectStore('patients').put({ userId: 'account:991', clinicId: 994, id: 993, name: 'Other authorized scope', phone: '', dateOfBirth: '2000-01-01' });
    tx.objectStore('patients').put({ userId: 'account:995', clinicId: 992, id: 993, name: 'Another user', phone: '', dateOfBirth: '2000-01-01' });
    tx.objectStore('outbox').put({ userId: 'account:991', clinicId: 994, operationId: 'synthetic-pending', status: 'pending' });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  });
  for (const locale of ['ar', 'en'] as const) for (const theme of ['light', 'dark'] as const) {
    await page.getByTestId(`button-locale-${locale}`).click();
    await page.getByTestId(`button-theme-${theme}`).click();
    const pill = page.getByTestId('status-connection');
    await expect(pill).toContainText(locale === 'ar' ? 'المتصفح متصل' : 'Browser online');
    await context.setOffline(true);
    await expect(pill).toContainText(locale === 'ar' ? 'المتصفح غير متصل' : 'Browser offline');
    await context.setOffline(false);
    await expect(pill).toContainText(locale === 'ar' ? 'المتصفح متصل' : 'Browser online');
  }
  await page.getByTestId('button-user-menu').click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByTestId('button-logout').click();
  await expect(page.getByTestId('app-shell')).toBeVisible();
  if (failCleanup) {
    if (mode === 'both-storage-failures') {
      const denyMarkerStorage = () => {
        const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
        Storage.prototype.getItem = function(key) {
          if (key === 'amal-incomplete-device-cleanup') throw new DOMException('Denied', 'SecurityError');
          return get.call(this, key);
        };
        Storage.prototype.setItem = function(key, value) {
          if (key === 'amal-incomplete-device-cleanup') throw new DOMException('Denied', 'SecurityError');
          return set.call(this, key, value);
        };
      };
      await page.evaluate(denyMarkerStorage);
      await page.addInitScript(denyMarkerStorage);
    }
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function (key) {
        if (this.name === 'patients') throw new DOMException('Synthetic deletion failure', 'QuotaExceededError');
        return original.call(this, key);
      };
    });
  }
  page.once('dialog', dialog => dialog.accept());
  await page.getByTestId('button-logout').click();
  if (failCleanup) {
    await expect(page.getByTestId('state-cleanup-incomplete')).toBeVisible();
    await expect(page.getByTestId('page-login')).toHaveCount(0);
    await expect(page.getByTestId('app-shell')).toHaveCount(0);
    await page.getByTestId('button-retry-cleanup').click();
    await expect(page.getByTestId('state-cleanup-incomplete')).toBeVisible();
    if (mode === 'both-storage-failures') {
      await page.reload();
      await expect(page.getByTestId('state-cleanup-incomplete')).toBeVisible();
      await expect(page.getByTestId('page-login')).toHaveCount(0);
      await expect(page.getByTestId('app-shell')).toHaveCount(0);
      await expect(page.getByTestId('button-retry-cleanup')).toHaveCount(0);
      return; // Explicit site-data removal is needed; never claim erasure here.
    }
    expect(await page.evaluate(() => localStorage.getItem('amal-incomplete-device-cleanup'))).toBe('account:991');
    // Reload restores native IDB but must retain the warning, not imply erasure.
    await page.reload();
    await expect(page.getByTestId('state-cleanup-incomplete')).toBeVisible();
    await context.route('**/api/me', route => route.fulfill({ status: 401, json: { code: 'UNAUTHORIZED' } }));
    await page.getByTestId('button-retry-cleanup').click();
  }
  await expect(page.getByTestId('page-login')).toBeVisible();
  const counts = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('amal-private-cache'); r.onsuccess = () => resolve(r.result);
    });
    const read = (table: string) => new Promise<any[]>((resolve) => {
      const r = db.transaction(table).objectStore(table).getAll(); r.onsuccess = () => resolve(r.result);
    });
    const patients = await read('patients'), outbox = await read('outbox');
    db.close();
    return { patients: patients.map(row => row.userId), outbox: outbox.length };
  });
  expect(counts).toEqual({ patients: ['account:995'], outbox: 0 });
});

test('registration failure is translated, accessible and non-blocking in both themes/locales', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.serviceWorker, 'register', {
      value: () => Promise.reject(new Error('Synthetic registration failure')),
    });
  });
  await page.goto('login');
  await expect(page.getByTestId('page-login')).toBeVisible();
  const notice = page.getByTestId('pwa-notice');
  for (const locale of ['ar', 'en'] as const) for (const theme of ['light', 'dark'] as const) {
    await page.getByTestId(`button-locale-${locale}`).click();
    await page.getByTestId(`button-theme-${theme}`).click();
    await expect(notice.getByRole('status')).toContainText(locale === 'ar' ? 'تعذر' : 'could not');
    await expect(notice.getByRole('button')).toHaveCount(2);
    expect((await new AxeBuilder({ page }).include('[data-testid="pwa-notice"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  }
  await notice.getByRole('button', { name: 'Dismiss notice' }).click();
  await expect(notice).toHaveCount(0);
});

test('updated worker waits for all tabs; unsaved work is not reloaded', async ({ page, context }) => {
  await activated(page);
  await page.getByTestId('button-locale-en').click();
  await page.getByTestId('input-email').fill('unsaved@example.test');
  await page.evaluate(() => { document.documentElement.dataset.unsavedPwaCheck = 'preserved'; });
  const second = await context.newPage();
  await second.goto('login');
  const workerPath = new URL('../dist/pwa-verification/sw.js', import.meta.url);
  const original = await readFile(workerPath, 'utf8');
  try {
    // Real worker update via HTTP bytes, not a mocked registration or activation.
    const revision = `verification-${Date.now()}`;
    await writeFile(workerPath, `${original}\nself.addEventListener('activate', () => { self.__pwaVerificationActivated = ${JSON.stringify(revision)}; });\n`);
    await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.ready).waiting)).toBe(true);
    await expect(page.getByTestId('pwa-notice')).toContainText('Save your work');
    await expect(page.getByTestId('input-email')).toHaveValue('unsaved@example.test');
    await expect(page.locator('html')).toHaveAttribute('data-unsaved-pwa-check', 'preserved');
    await page.reload();
    expect(await page.evaluate(async () => !!(await navigator.serviceWorker.ready).waiting)).toBe(true);
    await page.close();
    expect(await second.evaluate(async () => !!(await navigator.serviceWorker.ready).waiting)).toBe(true);
    await second.close();
    // Observe the real worker, without opening a new tab that could keep the old version alive.
    await expect.poll(async () => {
      const revisions = await Promise.all(context.serviceWorkers().map((worker) =>
        worker.evaluate('self.__pwaVerificationActivated || null').catch(() => null),
      ));
      return revisions.includes(revision);
    }).toBe(true);
    const reopened = await context.newPage();
    await reopened.goto('login');
    expect(await reopened.evaluate(async () => (await navigator.serviceWorker.ready).waiting)).toBeNull();
    await expect(reopened.getByTestId('page-login')).toBeVisible();
    await reopened.close();
  } finally {
    await writeFile(workerPath, original);
    if (!second.isClosed()) await second.close();
  }
});

import { test, expect } from '@playwright/test';

const families = [
  { family: 'IBM Plex Sans Arabic', slug: 'ibm-plex-sans-arabic', text: 'شبكة أمل للرعاية الصحية' },
  { family: 'IBM Plex Sans', slug: 'ibm-plex-sans', text: 'Amal healthcare network' },
];
const weights = [400, 500, 600, 700];
const faceNames: Record<number, string> = { 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold' };
const matchesFamily = (url: string, slug: string) => url.includes(`${slug}-`)
  && (slug !== 'ibm-plex-sans' || !url.includes('ibm-plex-sans-arabic-'));

test('self-hosted IBM Plex families and all weights render after a real offline reload', async ({ page, context }, info) => {
  const fontResponses: { url: string; status: number; serviceWorker: boolean }[] = [];
  const failedRequests: { url: string; errorText: string }[] = [];
  page.on('requestfailed', request => failedRequests.push({
    url: request.url(), errorText: request.failure()?.errorText ?? '',
  }));
  page.on('response', response => {
    if (response.request().resourceType() === 'font') fontResponses.push({
      url: response.url(), status: response.status(), serviceWorker: response.fromServiceWorker(),
    });
  });
  await page.goto('login');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // Existing worker deliberately does not clientsClaim. A real navigation is
  // necessary before any offline assertion can be meaningful.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const cachedFonts = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      if (!name.includes('precache')) continue;
      for (const request of await (await caches.open(name)).keys()) {
        if (/\.woff2?(?:\?|$)/.test(request.url)) urls.push(request.url);
      }
    }
    return urls;
  });
  for (const { slug } of families) for (const weight of weights) {
    expect(cachedFonts.some(url => matchesFamily(url, slug) && url.includes(`-${weight}-normal`)),
      `${slug} ${weight} must already be in the real SW precache`).toBe(true);
  }
  const cdp = await context.newCDPSession(page);
  // Remove the HTTP cache explanation without touching CacheStorage or the SW.
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  fontResponses.length = 0;
  await context.setOffline(true);
  try {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: 'none',
    });
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    const navigation = await page.reload({ waitUntil: 'domcontentloaded' });
    expect(navigation?.fromServiceWorker()).toBe(true);
    // Chromium can reset navigator.onLine after an SW-served navigation while
    // real networking remains offline (docs/testing/offline-live.md). Prove the
    // uncached request fails before restoring the browser's own offline signal;
    // never patch navigator or substitute an API/auth response.
    const onlineAfterNavigation = await page.evaluate(() => navigator.onLine);
    const probeUrl = `/__offline-font-network-probe-${Date.now()}`;
    const probeError = await page.evaluate(async path => {
      try {
        await fetch(path, { cache: 'no-store' });
        return 'unexpected success';
      } catch (error) {
        return String(error);
      }
    }, probeUrl);
    expect(probeError).not.toBe('unexpected success');
    expect(failedRequests.some(request => request.url.includes(probeUrl)
      && request.errorText === 'net::ERR_INTERNET_DISCONNECTED'),
    'Uncached probe must fail with ERR_INTERNET_DISCONNECTED after the SW reload').toBe(true);
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: 'none',
    });
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    // No API fallback is substituted: the normal locked offline public shell.
    await expect(page.getByTestId('state-error')).toBeVisible();
    const fontEvidence = await page.evaluate(async ({ families, weights }) => {
      const records = [];
      for (const [index, { family, text }] of families.entries()) for (const weight of weights) {
        const spec = `${weight} 20px "${family}"`;
        const faces = await document.fonts.load(spec, text);
        const probe = document.createElement('span');
        probe.id = `ui-1-font-${index}-${weight}`;
        probe.textContent = text;
        probe.setAttribute('aria-hidden', 'true');
        Object.assign(probe.style, { fontFamily: `"${family}"`, fontWeight: String(weight), fontSize: '20px' });
        document.body.append(probe);
        records.push({
          id: probe.id, family, weight, checked: document.fonts.check(spec, text),
          faces: faces.map(face => ({ family: face.family.replace(/["']/g, ''), weight: face.weight, status: face.status })),
          computedFamily: getComputedStyle(probe).fontFamily,
        });
      }
      await document.fonts.ready;
      return records;
    }, { families, weights });
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const rendered = [];
    for (const evidence of fontEvidence) {
      expect(evidence.checked).toBe(true);
      expect(evidence.computedFamily).toContain(evidence.family);
      expect(evidence.faces.some(face => face.family === evidence.family && face.status === 'loaded'
        && face.weight === String(evidence.weight))).toBe(true);
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `#${evidence.id}` });
      const result = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      // document.fonts.check alone can pass on fallback. CDP confirms the glyphs
      // actually came from the downloaded custom face, not a system font. IBM's
      // 500/600 Arabic files use "Medium"/"SemiBold" internal family names, unlike
      // their shared CSS family. Verify the exact embedded PostScript face name
      // (also weight-specific) rather than equating CSS and internal families.
      const postScriptName = `${evidence.family.replace(/\s/g, '')}-${faceNames[evidence.weight]}`;
      expect(result.fonts.some(font => font.isCustomFont && font.glyphCount > 0
        && font.postScriptName === postScriptName),
      `${evidence.family} ${evidence.weight} must render custom ${postScriptName}: ${JSON.stringify(result.fonts)}`).toBe(true);
      rendered.push({ ...evidence, platformFonts: result.fonts });
    }
    const origin = new URL(page.url()).origin;
    expect(fontResponses.length).toBeGreaterThan(0);
    expect(fontResponses.every(response => new URL(response.url).origin === origin
      && response.status === 200 && response.serviceWorker)).toBe(true);
    for (const { slug } of families) expect(fontResponses.some(response => matchesFamily(response.url, slug))).toBe(true);
    await info.attach('offline-font-proof.json', {
      contentType: 'application/json',
      body: JSON.stringify({
        offlineReload: true, httpCacheDisabled: true,
        onlineAfterNavigation, probeUrl, probeError, failedRequests,
        cachedFonts, fontResponses, rendered,
      }, null, 2),
    });
  } finally {
    // Match the existing journey: detach page emulation before context reconnect
    // so two independent emulators cannot compete.
    await cdp.detach();
    await context.setOffline(false);
  }
});

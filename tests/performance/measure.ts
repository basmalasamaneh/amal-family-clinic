import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import type { BrowserContext, CDPSession, Page } from '@playwright/test';

export const output = 'generated-artifacts/bug-bash/performance';
export const profile = {
  viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1,
  cpuSlowdown: 4, latencyMs: 150,
  downloadBitsPerSecond: 1_600_000, uploadBitsPerSecond: 750_000,
  serviceWorkers: 'blocked', httpCache: 'enabled in both conditions',
  cold: 'Fresh browser context; empty HTTP cache, CacheStorage and IndexedDB; synthetic session cookies except login.',
  warm: 'Immediate full-document repeat navigation in the same context after its cold journey; HTTP cache and app storage retained; not an SPA transition.',
  observation: 'Navigation metrics stop after UI-ready + 1000ms, before first action. Actions measured separately through visible result + two animation frames.',
  limitations: [
    'Controlled lab audit, not field INP. Action latency includes Playwright dispatch/waits and paint opportunity.',
    'LCP is the latest buffered candidate at the observation cutoff, not a field page-lifecycle final value.',
    'CLS uses the maximum 5s session window with 1s gaps, excluding recent-input shifts, through the navigation cutoff only.',
    'Browser HTTP cache only: cold does not flush OS, server, database, DNS or TLS caches; browser process is shared.',
    'Service workers blocked deliberately: no installed/offline PWA or SW-warm measurements.',
    'Schema-only disposable database with a small synthetic operational fixture; not representative production data volume.',
    'API bytes are CDP encodedDataLength (wire accounting, including protocol overhead as reported by Chromium); no response bodies collected.',
    'Raw evidence contains numbers, fixed endpoint categories and fixed journey/action labels only; no DOM, URLs, queries, headers, cookies, tokens or patient data.',
    'Auth session fixtures bypass credential entry outside the explicitly measured password-login action.',
    '200ms action budget includes network/debounce/server/paint time; it is not an INP threshold assessment.',
  ],
};
export const thresholds = { lcpMs: 2500, cls: 0.1, actionMs: 200 };

type ApiSample = {
  endpoint: string; method: string; status: number | null;
  durationMs: number; encodedBytes: number; failed: boolean;
  diskCache: boolean; serviceWorker: boolean;
};
type Visual = {
  supported: string[]; lcpMs: number | null; cls: number;
  longTasks: { startMs: number; durationMs: number }[];
};
export type Sample = {
  journey: string; condition: 'cold' | 'warm'; repetition: number;
  status: 'ok' | 'failed'; failureStage?: string;
  navigationKind: string; auth: string; browser: string;
  navigationReadyMs?: number; visual?: Visual;
  actions: { name: string; latencyMs: number; missed: boolean }[];
  api: ApiSample[];
  apiInflightAtCutoff?: number;
  cache?: { serviceWorkerControlled: boolean; serviceWorkerRegistrations: number; cacheStorageCount: number };
  issues: string[];
  misses: string[];
};

/** Derive a fixed category immediately; never retain a URL or query string in evidence. */
function endpoint(raw: string) {
  const path = new URL(raw).pathname;
  if (!path.startsWith('/api/')) return null;
  const routes: [RegExp, string][] = [
    [/^\/api\/auth\/login$/, 'auth-login'], [/^\/api\/me$/, 'me'],
    [/^\/api\/auth\/offline-permit$/, 'offline-permit'],
    [/^\/api\/appointments(?:\/|$)/, 'appointments'], [/^\/api\/patients(?:\/|$)/, 'patients'],
    [/^\/api\/doctors(?:\/|$)/, 'doctors'], [/^\/api\/clinics(?:\/|$)/, 'clinics'],
    [/^\/api\/doctor\/day$/, 'doctor-day'], [/^\/api\/doctor\/patients\//, 'doctor-patient'],
    [/^\/api\/kpis$/, 'kpis'], [/^\/api\/network\/health$/, 'network-health'],
    [/^\/api\/sync(?:\/|$)/, 'sync'], [/^\/api\/telemetry(?:\/|$)/, 'telemetry'],
  ];
  return routes.find(([pattern]) => pattern.test(path))?.[1] ?? 'other-api';
}

export async function instrument(context: BrowserContext, page: Page) {
  await page.addInitScript(() => {
    const state = {
      supported: PerformanceObserver.supportedEntryTypes,
      lcpMs: null as number | null, cls: 0,
      longTasks: [] as { startMs: number; durationMs: number }[],
    };
    let sessionStart = 0, lastShift = 0, sessionValue = 0;
    const observers: PerformanceObserver[] = [];
    const consume = (type: string, entries: PerformanceEntry[]) => {
      for (const entry of entries) {
        if (type === 'largest-contentful-paint') state.lcpMs = entry.startTime;
        if (type === 'longtask') state.longTasks.push({ startMs: entry.startTime, durationMs: entry.duration });
        if (type === 'layout-shift') {
          const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
          if (shift.hadRecentInput) continue;
          if (!sessionValue || entry.startTime - lastShift > 1000 || entry.startTime - sessionStart > 5000) {
            sessionStart = entry.startTime; sessionValue = 0;
          }
          sessionValue += shift.value; lastShift = entry.startTime;
          state.cls = Math.max(state.cls, sessionValue);
        }
      }
    };
    for (const type of ['largest-contentful-paint', 'layout-shift', 'longtask']) {
      if (!state.supported.includes(type)) continue;
      const observer = new PerformanceObserver(list => consume(type, list.getEntries()));
      observer.observe({ type, buffered: true });
      observers.push(observer);
    }
    (window as typeof window & { __amalPerformance?: () => typeof state }).__amalPerformance = () => {
      // Drain pending records, then disconnect: interactions must not contaminate navigation vitals.
      observers.forEach(observer => {
        const records = observer.takeRecords();
        if (records.length) consume(records[0].entryType, records);
        observer.disconnect();
      });
      return state;
    };
  });
  const cdp: CDPSession = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuSlowdown });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: profile.latencyMs,
    downloadThroughput: profile.downloadBitsPerSecond / 8,
    uploadThroughput: profile.uploadBitsPerSecond / 8,
    connectionType: 'cellular3g',
  });
  let api: ApiSample[] = [];
  const pending = new Map<string, { start: number; sample: ApiSample }>();
  cdp.on('Network.requestWillBeSent', event => {
    const category = endpoint(event.request.url);
    if (!category) return;
    pending.set(event.requestId, {
      start: event.timestamp,
      sample: { endpoint: category, method: event.request.method, status: null,
        durationMs: 0, encodedBytes: 0, failed: false, diskCache: false, serviceWorker: false },
    });
  });
  cdp.on('Network.responseReceived', event => {
    const request = pending.get(event.requestId);
    if (!request) return;
    request.sample.status = event.response.status;
    request.sample.diskCache = !!event.response.fromDiskCache;
    request.sample.serviceWorker = !!event.response.fromServiceWorker;
  });
  cdp.on('Network.loadingFinished', event => {
    const request = pending.get(event.requestId);
    if (!request) return;
    request.sample.durationMs = (event.timestamp - request.start) * 1000;
    request.sample.encodedBytes = event.encodedDataLength;
    api.push(request.sample); pending.delete(event.requestId);
  });
  cdp.on('Network.loadingFailed', event => {
    const request = pending.get(event.requestId);
    if (!request) return;
    request.sample.durationMs = (event.timestamp - request.start) * 1000;
    request.sample.failed = true;
    api.push(request.sample); pending.delete(event.requestId);
  });
  return {
    reset() { api = []; pending.clear(); },
    snapshot() { return api.slice(); },
    pendingCount() { return pending.size; },
    async visual(): Promise<Visual> {
      return page.evaluate(() => {
        const read = (window as typeof window & { __amalPerformance?: () => Visual }).__amalPerformance;
        if (!read) throw new Error('Navigation performance observer unavailable');
        return read();
      });
    },
    async cache() {
      return page.evaluate(async () => ({
        serviceWorkerControlled: !!navigator.serviceWorker?.controller,
        serviceWorkerRegistrations: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
        cacheStorageCount: 'caches' in window ? (await caches.keys()).length : 0,
      }));
    },
    async close() { await cdp.detach(); },
  };
}

export async function paint(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

export async function action(page: Page, sample: Sample, name: string, perform: () => Promise<unknown>, ready: () => Promise<unknown>) {
  const start = await page.evaluate(() => performance.now());
  await perform();
  await ready();
  await paint(page);
  const latencyMs = await page.evaluate(() => performance.now()) - start;
  sample.actions.push({ name, latencyMs, missed: latencyMs > thresholds.actionMs });
  if (latencyMs > thresholds.actionMs) sample.misses.push(`action:${name}`);
}

function distribution(values: number[]) {
  if (!values.length) return { count: 0, median: null, min: null, max: null };
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return { count: sorted.length, median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    min: sorted[0], max: sorted.at(-1) };
}
export async function persist(sample: Sample) {
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/${sample.journey}-${sample.condition}-${sample.repetition}.json`, JSON.stringify(sample, null, 2));
  // Read sanitized numeric evidence, not worker memory: Playwright restarts a worker
  // after a failed journey. Setup removed prior-run samples before execution.
  const files = (await readdir(output)).filter(name =>
    /^(?:login|calendar-booking|patient-lookup|doctor-day|admin-kpi)-(?:cold|warm)-[123]\.json$/.test(name));
  const samples: Sample[] = await Promise.all(files.sort().map(async name =>
    JSON.parse(await readFile(`${output}/${name}`, 'utf8')) as Sample));
  const groups = [...new Set(samples.map(row => `${row.journey}/${row.condition}`))].map(key => {
    const rows = samples.filter(row => `${row.journey}/${row.condition}` === key);
    const valid = rows.filter(row => row.status === 'ok');
    const actions = [...new Set(valid.flatMap(row => row.actions.map(item => item.name)))];
    return {
      group: key, attempted: rows.length, completed: valid.length, required: 3,
      complete: valid.length === 3, thresholdMisses: rows.filter(row => row.misses.length).length,
      evidenceIssueSamples: rows.filter(row => row.issues.length).length,
      lcpMs: distribution(valid.flatMap(row => row.visual?.lcpMs == null ? [] : [row.visual.lcpMs])),
      cls: distribution(valid.flatMap(row => row.visual ? [row.visual.cls] : [])),
      navigationReadyMs: distribution(valid.flatMap(row => row.navigationReadyMs === undefined ? [] : [row.navigationReadyMs])),
      longTaskCount: distribution(valid.map(row => row.visual?.longTasks.length ?? 0)),
      longTaskTotalMs: distribution(valid.map(row => row.visual?.longTasks.reduce((sum, task) => sum + task.durationMs, 0) ?? 0)),
      apiTotalEncodedBytes: distribution(valid.map(row => row.api.reduce((sum, request) => sum + request.encodedBytes, 0))),
      apiRequestDurationMs: distribution(valid.flatMap(row => row.api.map(request => request.durationMs))),
      apiRequestCount: distribution(valid.map(row => row.api.length)),
      actions: Object.fromEntries(actions.map(name => [name, {
        ...distribution(valid.flatMap(row => row.actions.filter(item => item.name === name).map(item => item.latencyMs))),
        misses: valid.flatMap(row => row.actions.filter(item => item.name === name && item.missed)).length,
      }])),
    };
  });
  await writeFile(`${output}/summary.json`, JSON.stringify({
    profile, thresholds, expected: { journeys: 5, coldPerJourney: 3, warmPerJourney: 3, totalSamples: 30 },
    attempted: samples.length, complete: samples.length === 30 && samples.every(row => row.status === 'ok'),
    thresholdMissSamples: samples.filter(row => row.misses.length).length,
    evidenceIssueSamples: samples.filter(row => row.issues.length).length, groups,
  }, null, 2));
}

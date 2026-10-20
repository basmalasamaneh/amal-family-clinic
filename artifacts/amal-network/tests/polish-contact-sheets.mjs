// Offline image indexing only. Never launches a browser or changes source captures.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve('../../generated-artifacts/polish');
const out = path.join(root, 'inspection');
await fs.mkdir(out, { recursive: true });
const runs = ['results', 'targeted/results', 'targeted-ui/results', 'targeted-ui-recovery/results', 'week-label/results'];
const index = new Map();
for (const run of runs) {
  for (const folder of await fs.readdir(path.join(root, run))) {
    const cell = folder.match(/(ar|en)-(light|dark)-(360|768|1024|1440)$/)?.[0];
    if (!cell) continue;
    const dir = path.join(root, run, folder);
    if (!(await fs.stat(dir)).isDirectory()) continue;
    for (const file of await fs.readdir(dir)) {
      if (file.endsWith('.png') && !file.startsWith('test-failed-'))
        index.set(`${cell}/${file}`, path.join(dir, file));
    }
  }
}
const groups = {
  admin: ['admin-kpi', 'admin-health', 'admin-users', 'admin-clinics-doctors', 'admin-audit', 'admin-developer'],
  delivered: ['desk-day', 'desk-week', 'desk-booking', 'desk-patients', 'desk-consent-guard', 'desk-sync', 'desk-print-locked', 'doctor-day', 'doctor-network', 'doctor-card-unselected', 'doctor-privacy', 'adoption-doctor', 'adoption-readonly', 'import-upload', 'import-doctor', 'duplicates-empty', 'duplicates-doctor', 'public-login', 'public-data-privacy', 'public-ui-kit'],
  states: ['calendar-standard', 'calendar-empty', 'calendar-error', 'admin-devices', 'wizard-details', 'wizard-schedule', 'wizard-review', 'patient-selected', 'consent-form', 'booking-schedule', 'network-results', 'clinical-card', 'doctor-empty', 'doctor-error', 'doctor-forbidden', 'offline-locked', 'role-forbidden', 'duplicates-error', 'print-unauthorized'],
};
const manifest = [];
for (const locale of ['ar', 'en']) for (const theme of ['light', 'dark']) for (const width of [360, 768, 1024, 1440]) {
  const cell = `${locale}-${theme}-${width}`;
  for (const [group, labels] of Object.entries(groups)) {
    const columns = group === 'admin' ? 3 : 5;
    const tw = group === 'admin' ? 450 : 290;
    const th = group === 'admin' ? 400 : 250;
    const composites = [];
    for (const [i, label] of labels.entries()) {
      const source = index.get(`${cell}/${label}.png`);
      const x = (i % columns) * tw, y = Math.floor(i / columns) * th;
      const caption = Buffer.from(`<svg width="${tw}" height="25"><rect width="100%" height="100%" fill="white"/><text x="6" y="17" font-size="13">${label} ${width}</text></svg>`);
      composites.push({ input: caption, left: x, top: y });
      if (!source) { manifest.push({ cell, label, missing: true }); continue; }
      const meta = await sharp(source).metadata();
      const cropHeight = Math.min(meta.height, group === 'admin' ? 1050 : 900);
      const buffer = await sharp(source).extract({ left: 0, top: 0, width: meta.width, height: cropHeight })
        .resize(tw - 4, th - 29, { fit: 'contain', background: '#c9c9c9' }).png().toBuffer();
      composites.push({ input: buffer, left: x + 2, top: y + 27 });
      manifest.push({ cell, label, source: path.relative(root, source), cropHeight, fullHeight: meta.height });
    }
    await sharp({ create: { width: tw * columns, height: th * Math.ceil(labels.length / columns), channels: 3, background: '#c9c9c9' } })
      .composite(composites).jpeg({ quality: 90 }).toFile(path.join(out, `${cell}-${group}.jpg`));
  }
}
// KPI is much longer than one viewport: retain a full-height, four-width sheet.
for (const locale of ['ar', 'en']) for (const theme of ['light', 'dark']) {
  const tiles = [];
  let height = 0;
  for (const [i, width] of [360, 768, 1024, 1440].entries()) {
    const source = index.get(`${locale}-${theme}-${width}/admin-kpi.png`);
    const buffer = await sharp(source).resize({ width: 360 }).png().toBuffer();
    const meta = await sharp(buffer).metadata();
    height = Math.max(height, meta.height);
    tiles.push({ input: buffer, left: i * 360, top: 0 });
  }
  await sharp({ create: { width: 1440, height, channels: 3, background: '#c9c9c9' } }).composite(tiles)
    .jpeg({ quality: 90 }).toFile(path.join(out, `${locale}-${theme}-kpi-full.jpg`));
}
await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ entries: manifest.length, missing: manifest.filter(x => x.missing), out }));

// Supplementary presentation runs are separate from (and never replace) the 624.
const supplementRuns = ['supplement', 'supplement-import-check', 'supplement-gaps',
  'supplement-middle-widths', 'supplement-native-zoom', 'supplement-native-recovery',
  'supplement-extra-check', 'supplement-extra', 'supplement-pagination',
  'supplement-overflow-doctors', 'supplement-overflow-devices', 'sheet-focus',
  'supplement-native-viewport', 'supplement-native-display', 'supplement-native-full-display'];
const cases = new Map();
const supplementIndex = new Map();
for (const run of supplementRuns) {
  const report = JSON.parse(await fs.readFile(path.join(root, run, 'results.json'), 'utf8'));
  const walk = suite => {
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
      const result = test.results.at(-1);
      cases.set(`${test.projectName}/${spec.title}`, {
        project: test.projectName, title: spec.title, status: result.status, run,
        errors: (result.errors ?? []).map(e => e.message?.replace(/\u001b\[[0-9;]*m/g, '')),
      });
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  walk(report);
  for (const folder of await fs.readdir(path.join(root, run, 'results'))) {
    const dir = path.join(root, run, 'results', folder);
    if (!(await fs.stat(dir)).isDirectory()) continue;
    const cell = folder.match(/(ar|en)-(light|dark)-(360|768|1024|1440)$/)?.[0] ??
      (folder.endsWith('native-zoom') ? 'native-zoom' : null);
    if (!cell) continue;
    for (const file of await fs.readdir(dir)) if (file.endsWith('.png') && !file.startsWith('test-failed-'))
      supplementIndex.set(`${cell}/${file}`, path.join(dir, file));
  }
}
const summary = [...cases.values()];
await fs.writeFile(path.join(out, 'supplement-latest.json'), JSON.stringify({
  total: summary.length, passed: summary.filter(t => t.status === 'passed').length,
  failed: summary.filter(t => t.status === 'failed').length, cases: summary,
}, null, 2));
const supplementalGroups = {
  dialogs: ['registration-empty', 'registration-minor-validation', 'consent-access-pin',
    'doctor-create-dialog', 'doctor-edit-dialog', 'user-create-dialog', 'consent-minor-history',
    'consent-withdraw-confirmation', 'consent-withdraw-pin', 'devices-populated',
    'device-enrollment-dialog', 'device-revoke-confirmation'],
  imports: ['import-doctors', 'import-patients-open', 'import-identity-review', 'import-new-identity',
    'import-status', 'import-conflicts', 'import-commit-preview', 'import-committed-report-entry',
    'import-file-invalid', 'import-file-parsed-not-staged'],
  offline: ['authorized-offline-sheet', 'authorized-populated-print', 'authorized-offline-empty-sheet'],
};
const supplementManifest = [];
for (const locale of ['ar', 'en']) for (const theme of ['light', 'dark']) for (const width of [360, 768, 1024, 1440]) {
  const cell = `${locale}-${theme}-${width}`;
  for (const [group, labels] of Object.entries(supplementalGroups)) {
    const tw = group === 'offline' ? 450 : 300, th = group === 'offline' ? 500 : 300;
    const columns = group === 'offline' ? 3 : 4;
    const layers = [];
    for (const [i, label] of labels.entries()) {
      const source = supplementIndex.get(`${cell}/${label}.png`);
      if (!source) throw new Error(`Missing supplementary image ${cell}/${label}`);
      const x = (i % columns) * tw, y = Math.floor(i / columns) * th;
      const meta = await sharp(source).metadata();
      const cropHeight = Math.min(meta.height, 1050);
      const image = await sharp(source).extract({ left: 0, top: 0, width: meta.width, height: cropHeight })
        .resize(tw - 4, th - 28, { fit: 'contain', background: '#c9c9c9' }).png().toBuffer();
      layers.push({ input: Buffer.from(`<svg width="${tw}" height="24"><rect width="100%" height="100%" fill="white"/><text x="3" y="16" font-size="11">${label}</text></svg>`), left: x, top: y });
      layers.push({ input: image, left: x + 2, top: y + 26 });
      supplementManifest.push({ cell, label, source: path.relative(root, source), cropHeight, fullHeight: meta.height });
    }
    await sharp({ create: { width: tw * columns, height: th * Math.ceil(labels.length / columns), channels: 3, background: '#c9c9c9' } })
      .composite(layers).jpeg({ quality: 92 }).toFile(path.join(out, `supplement-${cell}-${group}.jpg`));
  }
}
await fs.writeFile(path.join(out, 'supplement-manifest.json'), JSON.stringify(supplementManifest, null, 2));
// Readable first viewport at real 200% zoom; full originals remain beside reports.
for (const [key, source] of supplementIndex) if (key.startsWith('native-zoom/')) {
  const meta = await sharp(source).metadata();
  await sharp(source).extract({ left: 0, top: 0, width: meta.width, height: Math.min(meta.height, 1000) })
    .jpeg({ quality: 92 }).toFile(path.join(out, key.replace('native-zoom/', '').replace('.png', '.jpg')));
}
console.log(JSON.stringify({ supplementaryCases: summary.length,
  passed: summary.filter(t => t.status === 'passed').length, failed: summary.filter(t => t.status === 'failed').length }));

// Native-resolution crops for actual bilingual/below-fold review, not thumbnails.
const readable = path.join(out, 'readable');
await fs.mkdir(readable, { recursive: true });
const readableManifest = [];
async function readableCrop(cell, label, source, top, height, suffix = '', left = 0, width) {
  const meta = await sharp(source).metadata();
  const actualTop = Math.max(0, Math.min(top, meta.height - 1));
  const actualHeight = Math.min(height, meta.height - actualTop);
  const filename = `${cell}-${label}${suffix}.png`;
  const actualWidth = width ?? meta.width;
  await sharp(source).extract({ left, top: actualTop, width: actualWidth, height: actualHeight })
    .toFile(path.join(readable, filename));
  readableManifest.push({ file: filename, source: path.relative(root, source),
    left, top: actualTop, width: actualWidth, height: actualHeight, resized: false });
}
for (const locale of ['ar', 'en']) for (const theme of ['light', 'dark']) for (const width of [360, 768, 1024, 1440]) {
  const cell = `${locale}-${theme}-${width}`;
  const kpi = index.get(`${cell}/admin-kpi.png`);
  const km = await sharp(kpi).metadata();
  await readableCrop(cell, 'kpi-definitions', kpi, km.height - 1100, 1100);
  if (width === 360) {
    for (const label of ['doctor-edit-dialog', 'registration-minor-validation']) {
      const source = supplementIndex.get(`${cell}/${label}.png`);
      const meta = await sharp(source).metadata();
      await readableCrop(cell, label, source, meta.height - 1200, 1200);
    }
    for (const label of ['doctor-empty', 'duplicates-empty', 'desk-sync'])
      await readableCrop(cell, label, index.get(`${cell}/${label}.png`), 0, 1200);
  } else if (width === 768) {
    await readableCrop(cell, 'clinical-card', index.get(`${cell}/clinical-card.png`), 0, 1200);
  } else if (width === 1440) {
    const source = index.get(`${cell}/public-data-privacy.png`);
    const meta = await sharp(source).metadata();
    for (let top = 0; top < meta.height; top += 1000)
      await readableCrop(cell, 'privacy', source, top, 1000, `-${top}`,
        top === 0 ? (locale === 'ar' ? 400 : 100) : (locale === 'ar' ? 140 : 400), 1000);
  }
}
await fs.writeFile(path.join(readable, 'manifest.json'), JSON.stringify(readableManifest, null, 2));

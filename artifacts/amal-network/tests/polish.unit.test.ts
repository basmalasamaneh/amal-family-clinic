import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { admAr, admEn } from '../src/admin/strings';
import { importAr, importEn } from '../src/imports/strings';
import { doctorAr, doctorEn } from '../src/doctor/strings';
import { formatLocalDate } from '../src/calendar/dates';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('P2-11 empty-state explanations exist in both languages', () => {
  const pairs: Array<[string, string]> = [
    [admEn.users.emptyDesc, admAr.users.emptyDesc], [admEn.devices.emptyDesc, admAr.devices.emptyDesc],
    [admEn.audit.emptyDesc, admAr.audit.emptyDesc], [admEn.clinics.doctorsEmptyDesc, admAr.clinics.doctorsEmptyDesc],
    [importEn.dup.emptyDesc, importAr.dup.emptyDesc],
  ];
  for (const [en, ar] of pairs) { assert.ok(en.trim() && ar.trim()); assert.notEqual(en, ar); assert.match(ar, /[\u0600-\u06FF]/); }
});

test('admin Empty and duplicates empty reuse the shared gold EmptyState; error stays distinct', () => {
  const common = src('admin/common.tsx');
  assert.match(common, /export function Empty[\s\S]*?<EmptyState/);
  assert.match(common, /export function LoadError[\s\S]*?role="alert"[\s\S]*?AlertTriangle/);
  assert.match(src('duplicates/DuplicatesPage.tsx'), /state-dup-empty"><EmptyState/);
});

test('P2-11 genuine empties across app use shared EmptyState; errors keep their own treatment', () => {
  const cases: Array<[string, RegExp]> = [
    ['reception/PatientsPage.tsx', /status-upcoming-empty"><EmptyState/],
    ['consent/ConsentPage.tsx', /status-access-empty"><EmptyState/],
    ['sync/SyncQueuePanel.tsx', /empty-queue"><EmptyState/],
    ['sync/SyncQueuePanel.tsx', /empty-conflicts"><EmptyState/],
    ['imports/ImportPage.tsx', /state-batch-empty"><EmptyState/],
    ['network/NetworkSearchPage.tsx', /testId="state-network-empty" gold/],
    ['doctor/MyDayPage.tsx', /testId="state-day-empty" gold/],
    ['doctor/PrivacyPage.tsx', /testId="state-audit-empty" gold/],
  ];
  for (const [f, re] of cases) assert.match(src(f), re, f);
  const net = src('network/NetworkSearchPage.tsx');
  assert.match(net, /if \(gold && !alert\)/);
  assert.doesNotMatch(net, /state-network-\$\{state\.why\}`\} alert[^\n]*gold/);
  // Genuine KPI empty collections use the shared state; missing telemetry stays a non-gold line.
  const charts = src('kpi/charts.tsx');
  assert.match(charts, /state-sources-empty"><EmptyState/);
  assert.match(src('kpi/Adoption.tsx'), /state-adoption-empty"><EmptyState/);
  assert.match(charts, /<p className="kpi-why" data-testid="state-lookup-empty">/);
  assert.equal((charts.match(/<EmptyState/g) ?? []).length, 1);
  assert.match(src('admin/DeveloperToolsPage.tsx'), /state-outage-empty"><EmptyState/);
});

test('P2-11 safe error copy: no blind retry or invented certainty', () => {
  const en = JSON.parse(readFileSync(new URL('../src/locales/en.json', import.meta.url), 'utf8'));
  const ar = JSON.parse(readFileSync(new URL('../src/locales/ar.json', import.meta.url), 'utf8'));
  const flat = (o: unknown): string[] => typeof o === 'string' ? [o] : o && typeof o === 'object' ? Object.values(o).flatMap(flat) : [];
  for (const s of [...flat(en), ...flat(importEn.err), ...flat(admEn.err)]) {
    assert.doesNotMatch(s, /Something went wrong/i, s);
    assert.doesNotMatch(s, /server (failed|had a problem)[^.]*\. Nothing was (saved|changed)/i, s);
  }
  assert.ok(flat(ar).every((s) => !/حدث خطأ ما/.test(s)));
  assert.ok([...flat(importAr.err), ...flat(admAr.err)].every((s) => !/حدث خطأ/.test(s)));
});

test('P2-11 failure/guard states override gold art with a hidden semantic icon', () => {
  const shell = src('shell/AppShell.tsx'), root = src('shell/ShellRoot.tsx'), cal = src('calendar/CalendarPage.tsx');
  assert.ok(shell.includes('illustration={<span className={`shell-state__icon shell-state__icon--${kind}`} aria-hidden="true">'));
  assert.equal((root.match(/<EmptyState/g) ?? []).length, (root.match(/illustration=\{<span className="shell-state__icon[^"]*" aria-hidden="true">/g) ?? []).length);
  assert.match(cal, /illustration=\{<span className="shell-state__icon" aria-hidden="true"><Building2/);
});

test('P2-11 admin scrollable tables are focusable named regions', () => {
  for (const f of ['admin/AuditPage.tsx', 'admin/ClinicsDoctorsPage.tsx', 'admin/UsersDevicesPage.tsx']) {
    const s = src(f);
    const all = s.match(/<div className="adm-table-wrap"[^>]*>/g) ?? [];
    assert.ok(all.length > 0, f);
    for (const w of all) { assert.match(w, /role="region"/); assert.match(w, /tabIndex=\{0\}/); assert.match(w, /aria-label=\{/); }
  }
  assert.match(readFileSync(new URL('../src/admin/admin.css', import.meta.url), 'utf8'), /\.adm-table-wrap:focus-visible \{ outline: 3px/);
});

test('P2-11 KPI empty copy present in both languages', async () => {
  const k = await import('../src/kpi/strings');
  const vals = Object.values(k) as Array<Record<string, Record<string, string>>>;
  const tables = vals.filter((v) => v && typeof v === 'object' && v.sources && v.adoption);
  assert.equal(tables.length, 2);
  for (const v of tables) { assert.ok(v.sources.emptyTitle.trim()); assert.ok(v.adoption.emptyDesc.trim()); }
});

// Source/formatting contracts complement browser-computed accessibility checks;
// these do not claim to render components or measure actual CSS contrast.
function openingTag(text: string, marker: string) {
  const at = text.indexOf(marker);
  assert.ok(at >= 0, `Missing source marker: ${marker}`);
  return text.slice(text.lastIndexOf('<', at), text.indexOf('>', at) + 1);
}

test('P2-11 doctor open-card names include exact visible wording in both languages', () => {
  for (const strings of [doctorEn, doctorAr]) {
    assert.ok(strings.day.open.includes(strings.day.openShort));
    assert.ok(strings.day.open.includes('{{name}}'));
  }
  const component = src('doctor/MyDayPage.tsx');
  assert.match(component, /aria-label=\{t\('doc\.day\.open', \{ name: p\.name \}\)\}/);
  assert.ok(component.includes("{t('doc.day.openShort')}"));
});

test('P2-11 week accessible date matches visible weekday, day and month', () => {
  const component = src('calendar/CalendarPage.tsx');
  const link = openingTag(component, 'className="cal-week__link"');
  assert.ok(link.includes("date: formatLocalDate(d, locale, digitPreference, 'EEEE d MMM')"));
  // JSX line breaks between elements do not insert a text separator. Matching
  // format strings alone can still produce "Saturday17 Oct" inside the link.
  assert.ok(
    /<\/span>\s*\{['"] ['"]\}\s*<span className="cal-week__num"/.test(component) || /\baria-labelledby=/.test(link),
    'Week date parts need an explicit text separator or a composed aria-labelledby name',
  );
  for (const locale of ['ar', 'en'] as const) for (const digits of ['latn', 'arab'] as const) {
    const date = '2026-10-20';
    const visible = `${formatLocalDate(date, locale, digits, 'EEEE')} ${formatLocalDate(date, locale, digits, 'd MMM')}`;
    assert.equal(formatLocalDate(date, locale, digits, 'EEEE d MMM'), visible);
  }
});

test('P2-11 cancelled calendar parent preserves child token contrast, retaining strike-through', () => {
  const css = src('index.css');
  const declarations = [...css.matchAll(/\.cal-card--cancelled\s*\{([^}]*)\}/g)];
  assert.ok(declarations.length > 0);
  for (const [, declaration] of declarations) assert.doesNotMatch(declaration, /\bopacity\s*:/);
  assert.match(css, /\.cal-card--cancelled\s+\.cal-card__name\s*\{[^}]*text-decoration:\s*line-through/);
});

test('P2-11 network result inherits visible name and separately describes its action', () => {
  const component = src('network/NetworkSearchPage.tsx');
  const button = openingTag(component, 'className="net-hit"');
  assert.doesNotMatch(button, /\baria-label=/);
  assert.ok(button.includes('aria-describedby={`open-patient-description-${p.id}`}'));
  assert.ok(component.includes('className="amal-sr-only" id={`open-patient-description-${p.id}`}'));
  assert.ok(component.includes("{t('net.result.open', { name: p.name })}"));
});

test('P2-11 named day-sheet and sync loading skeletons have status semantics', () => {
  const daySheet = openingTag(src('day-sheet/DaySheet.tsx'), 'className="ds-skel ds-screen"');
  const namedSync = [...src('sync/SyncQueuePanel.tsx').matchAll(/<div\b[^>]*className="sync-skels"[^>]*aria-label=[^>]*>/g)];
  assert.equal(namedSync.length, 1);
  for (const tag of [daySheet, namedSync[0][0]]) {
    assert.match(tag, /\brole="status"/);
    assert.match(tag, /\baria-busy="true"/);
    assert.match(tag, /\baria-label=/);
  }
});

test('P2-11 public privacy logo inherits its name and separately describes destination', () => {
  const component = src('pages/data/DataPage.tsx');
  const link = openingTag(component, 'className="data-top__brand"');
  assert.doesNotMatch(link, /\baria-label=/);
  assert.match(link, /\baria-describedby="data-home-destination"/);
  assert.match(component, /<span id="data-home-destination" className="amal-sr-only">/);
  assert.ok(component.includes("signedIn ? t('data.backApp') : t('data.backLogin')"));
});

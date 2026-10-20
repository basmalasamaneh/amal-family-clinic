import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { KpiResult } from '@workspace/api-client-react';
import {
  addDays, clinicPairs, inclusiveEnd, isEmptyWindow, lossStatus, matchesSelection, meetsLookupTarget, noShowRows, partialItems, pct,
  preventionSeries, resolveDesignation, sourceSlices, topRate, weekdayName, weekdayRows,
} from '../src/kpi/model';
import { kpiAr, kpiEn } from '../src/kpi/strings';

const rate = (n: number, d: number) => ({ numerator: n, denominator: d, ratio: d ? n / d : null, percent: d ? Math.round((n / d) * 1000) / 10 : null });
const src = (o: Partial<Record<'phone' | 'walk-in' | 'calendar' | 'amal-network' | 'unknown', number>> = {}) => ({ phone: 0, 'walk-in': 0, calendar: 0, 'amal-network': 0, unknown: 0, ...o });
const defs = { collisions: 'd', clinicAttribution: 'a', noShow: 'n', sources: 's', weekday: 'w' };
const clinic = (id: number, name: string, same: number, cross: number, ns = rate(0, 0)) => ({ clinicId: id, clinicName: name, totalAppointments: ns.denominator, completed: 0, collisions: { sameDoctorSameStartPairs: same, samePatientSameStartCrossClinicPairs: cross }, noShow: ns, bookingsBySource: src() });
const metrics = (clinics: ReturnType<typeof clinic>[], extra: Record<string, unknown> = {}) => ({ totalAppointments: 0, completed: 0, collisions: { sameDoctorSameStartPairs: 3, samePatientSameStartCrossClinicPairs: 1 }, noShow: rate(0, 0), bookingsBySource: src(), clinics, weekdays: [], definitions: defs, ...extra });
const period = (startDate: string, days: number) => ({ startDate, endDateExclusive: addDays(startDate, days), start: '', end: '', days, timezone: 'Asia/Hebron' as const });

export function fixture(o: { daily?: KpiResult['after']['telemetry']['conflicts']['daily']; afterClinics?: ReturnType<typeof clinic>[]; afterExtra?: Record<string, unknown> } = {}): KpiResult {
  return {
    range: 'week', appointments: 0, completed: 0, noShowRate: null, periodStart: '', periodEnd: '', calculationVersion: 'v1', generatedAt: '2026-10-01T09:00:00Z', scope: { clinicId: null },
    comparison: { equalExposure: false, note: 'n' },
    before: { period: period('2026-09-08', 6), provenance: 'seed', metrics: metrics([clinic(7, 'Synthetic North', 2, 1), clinic(3, 'Synthetic South', 1, 1)]) },
    after: {
      period: period('2026-10-05', 7), provenance: 'ops', metrics: metrics(o.afterClinics ?? [clinic(3, 'Synthetic South', 0, 0, rate(1, 8)), clinic(9, 'Synthetic East', 4, 0)], o.afterExtra),
      telemetry: {
        conflicts: { daily: o.daily ?? [], cumulative: { blocked: 5, warnings: 2, overrides: 1 }, coverage: 'c' },
        lookupTime: { available: false, reason: 'LOOKUP_DURATION_PRODUCER_UNAVAILABLE', medianSeconds: null, sampleCount: null, measurementBoundaries: 'b' },
        networkActivity: { available: false, reason: 'LOGICAL_NETWORK_LOOKUP_PRODUCER_UNAVAILABLE', daily: null },
        downtime: { receivedCreates: 0, synced: 0, conflicted: 0, rejected: 0, pending: 0, queued: { available: false, reason: 'CLIENT_QUEUE_NOT_OBSERVED', value: null }, lost: { available: false, reason: 'CLIENT_LOSS_NOT_OBSERVED', value: null }, coverage: 'c' },
      },
    },
    adoption: { clinics: [], counts: { trial: null, lite: 0, full: 0 }, history: { available: false, reason: 'ADOPTION_TRANSITION_HISTORY_UNAVAILABLE' }, coverage: 'c' },
  } as KpiResult;
}
const day = (date: string, blocked: number, cum: number) => ({ date, blocked, warnings: 1, overrides: 0, cumulativeBlocked: cum, cumulativeWarnings: 0, cumulativeOverrides: 0 });

test('every English KPI string has a non-empty Arabic counterpart', () => {
  const walk = (en: Record<string, unknown>, ar: Record<string, unknown>, path: string) => {
    for (const k of Object.keys(en)) {
      if (typeof en[k] === 'string') assert.ok(typeof ar[k] === 'string' && (ar[k] as string).trim() && ar[k] !== en[k] || k === 'window', `${path}.${k}`);
      else walk(en[k] as Record<string, unknown>, ar[k] as Record<string, unknown>, `${path}.${k}`);
    }
  };
  walk(kpiEn, kpiAr, 'kpi');
});
test('date-only arithmetic is DST-safe and inclusive end preserved', () => {
  assert.equal(addDays('2026-03-27', 1), '2026-03-28');
  assert.equal(addDays('2026-10-24', 1), '2026-10-25');
  assert.equal(inclusiveEnd({ endDateExclusive: '2026-11-01' }), '2026-10-31');
});
test('grouped bar unions clinics by ID with null (not 0) for absent side; dynamic identities', () => {
  const p = clinicPairs(fixture(), 'sameDoctorSameStartPairs');
  assert.deepEqual(p.map((x) => [x.clinicId, x.before, x.after]), [[3, 1, 0], [7, 2, null], [9, null, 4]]);
  assert.equal(p[0].clinicName, 'Synthetic South');
});
test('prevention series keeps gaps, never zero-fills, chooses daily vs cumulative', () => {
  const f = fixture({ daily: [day('2026-10-07', 2, 3), day('2026-10-05', 1, 1), day('2026-10-08', 2, 5)] });
  const d = preventionSeries(f.after.period, f.after.telemetry.conflicts.daily, 'daily');
  assert.equal(d.observed, 3);
  assert.deepEqual(d.segments.map((s) => s.map((p) => p.index)), [[0], [2, 3]]);
  assert.equal(d.rows.length, 7);
  assert.equal(d.rows[1].row, null);
  assert.equal(d.peak!.value, 2);
  const c = preventionSeries(f.after.period, f.after.telemetry.conflicts.daily, 'cumulative');
  assert.equal(c.max, 5);
});
test('sources: total, shares, unknown included, empty total is zero', () => {
  const s = sourceSlices(src({ phone: 3, unknown: 1 }));
  assert.equal(s.total, 4); assert.equal(s.slices.find((x) => x.key === 'unknown')!.share, 0.25);
  assert.equal(sourceSlices(src()).total, 0);
});
test('no-show: empty denominators unavailable, not 0%', () => {
  const rows = noShowRows(fixture().after.metrics.clinics);
  assert.equal(rows.find((r) => r.id === 9)!.rate.percent, null);
  assert.equal(topRate(rows)!.id, 3);
  assert.equal(pct(null, 'en', 'latn'), null);
  assert.equal(pct(12.5, 'en', 'latn'), '12.5%');
  assert.match(pct(12.5, 'ar', 'arab')!, /١٢٫٥/);
});
test('weekday: seven Sunday-first buckets from API, missing stay null', () => {
  const f = fixture({ afterExtra: { weekdays: [{ weekday: 6, noShow: rate(1, 2), bookingsBySource: src() }] } });
  const w = weekdayRows(f);
  assert.equal(w.length, 7); assert.equal(w[6].rate.percent, 50); assert.equal(w[6].missing, false);
  assert.equal(w[0].missing, true); assert.equal(w[0].rate.numerator, null); assert.equal(w[0].rate.denominator, null);
  assert.equal(weekdayName(0, 'en'), 'Sunday');
});
test('targets: lookup strictly under 10 s, loss null is unavailable not success', () => {
  assert.equal(meetsLookupTarget(9.99), true); assert.equal(meetsLookupTarget(10), false); assert.equal(meetsLookupTarget(null), null);
  assert.equal(lossStatus(null), 'unavailable'); assert.equal(lossStatus(0), 'met'); assert.equal(lossStatus(1), 'missed');
});
test('designation is unavailable; no ID/name guess', () => {
  assert.deepEqual(resolveDesignation(fixture()), { kind: 'unavailable' });
  const srcCode = readFileSync(new URL('../src/kpi/model.ts', import.meta.url), 'utf8') + readFileSync(new URL('../src/kpi/Adoption.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(srcCode, /includes\(['"]|clinicId === \d/);
});
test('partial and empty states, stale-range guard', () => {
  const f = fixture();
  assert.deepEqual(partialItems(f), ['lookup', 'loss', 'network', 'adoptionHistory', 'designation']);
  const empty = fixture({ daily: Array.from({ length: 7 }, (_, i) => ({
    date: addDays('2026-10-05', i), blocked: 0, warnings: 0, overrides: 0,
    cumulativeBlocked: 0, cumulativeWarnings: 0, cumulativeOverrides: 0,
  })) });
  empty.after.telemetry.conflicts.cumulative = { blocked: 0, warnings: 0, overrides: 0 };
  assert.equal(isEmptyWindow(empty), true);
  for (const key of ['blocked', 'warnings', 'overrides'] as const) {
    empty.after.telemetry.conflicts.cumulative[key] = 1;
    assert.equal(isEmptyWindow(empty), false);
    empty.after.telemetry.conflicts.cumulative[key] = 0;
  }
  empty.after.telemetry.downtime.receivedCreates = 1;
  assert.equal(isEmptyWindow(empty), false);
  assert.equal(matchesSelection(f, 'week'), true); assert.equal(matchesSelection(f, 'month'), false); assert.equal(matchesSelection(undefined, 'week'), false);
});
test('KPI CSS uses logical properties only', () => {
  const css = readFileSync(new URL('../src/kpi/kpi.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /(margin|padding|border|inset)-(left|right|top|bottom)|\b(left|right|top|bottom)\s*:|text-align:\s*(left|right)|float:/);
  // Shorthands with more than one value are physical (top/right/bottom/left); only single-value shorthands allowed.
  assert.doesNotMatch(css, /(?:^|[\s;{])(margin|padding|inset|border-width|border-style|border-color):\s*[^\s;}]+\s+[^\s;}]/);
});

test('targets and other numbers are interpolated, not literal digits in strings', () => {
  const walk = (o: Record<string, unknown>, path: string) => { for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string') assert.doesNotMatch(v.replace(/\{\{[^}]+\}\}/g, ''), /[0-9\u0660-\u0669]/, path + '.' + k); else walk(v as Record<string, unknown>, path + '.' + k);
  } };
  walk(kpiEn, 'en'); walk(kpiAr, 'ar');
  assert.ok(kpiEn.lookup.target.includes('{{target}}') && kpiAr.loss.target.includes('{{target}}'));
});
test('auth failure clears figures; refresh failure shows notice with retry', () => {
  const page = readFileSync(new URL('../src/kpi/KpiPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /err === 'forbidden' \|\| err === 'unauthorized' \? \(/);
  assert.match(page, /state-kpi-refresh-error/);
});

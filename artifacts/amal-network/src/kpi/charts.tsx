import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, Segmented } from '@workspace/amal-ui';
import type { KpiResult } from '@workspace/api-client-react';
import { CalendarDays, Clock, GitCompareArrows, PieChart, ShieldCheck, UserX, WifiOff } from 'lucide-react';
import { ChartFrame, Unavail, iso, useFmt } from './ChartFrame';
import {
  LOOKUP_TARGET_SECONDS, LOSS_TARGET, clinicPairs, inclusiveEnd, lookupView, noShowRows, pct, preventionSeries, shortDate, sourceSlices, topRate, weekdayName, weekdayRows,
  type CollisionMetric, type SeriesMode, type SourceKey,
} from './model';
import { formatDateOnly } from '@/shell/formatting';

/* ---------- Grouped bar: collisions before vs after per clinic ---------- */
export function CollisionsChart({ data }: { data: KpiResult }) {
  const { t } = useTranslation(); const f = useFmt();
  const [metric, setMetric] = useState<CollisionMetric>('sameDoctorSameStartPairs');
  const pairs = clinicPairs(data, metric);
  const mLabel = t(metric === 'sameDoctorSameStartPairs' ? 'kpi.conflicts.sameDoctor' : 'kpi.conflicts.crossClinic');
  const max = Math.max(1, ...pairs.flatMap((p) => [p.before ?? 0, p.after ?? 0]));
  const nb = data.before.metrics.collisions[metric], na = data.after.metrics.collisions[metric];
  const top = pairs.filter((p) => p.after !== null).reduce<(typeof pairs)[number] | null>((m, p) => (!m || p.after! > m.after! ? p : m), null);
  const val = (v: number | null) => (v === null ? <Unavail label={t('kpi.states.notApplicable')} /> : f.n(v));
  const summary = top && top.after! > 0
    ? t('kpi.conflicts.summary', { metric: mLabel, before: f.n(nb), after: f.n(na), top: `${iso(top.clinicName)} (${f.n(top.after!)})` })
    : t('kpi.conflicts.summaryNone', { metric: mLabel, before: f.n(nb), after: f.n(na) });
  return (
    <ChartFrame id="collisions" className="kpi-card--wide" icon={<GitCompareArrows size={20} aria-hidden="true" />} title={t('kpi.conflicts.title')} summary={summary}
      caption={t('kpi.conflicts.caption', { metric: mLabel })}
      head={[t('kpi.conflicts.colClinic'), t('kpi.conflicts.colBefore'), t('kpi.conflicts.colAfter')]}
      rows={[...pairs.map((p) => [<bdi key="n">{p.clinicName}</bdi>, val(p.before), val(p.after)]), [t('kpi.conflicts.networkRow'), f.n(nb), f.n(na)]]}
      notes={<>
        <p><strong>{t('kpi.conflicts.definition')}:</strong> <span dir="auto">{data.after.metrics.definitions.collisions}</span></p>
        <p className="kpi-warn-note">{t('kpi.conflicts.nonAdditive')}</p>
      </>}>
      <Segmented label={t('kpi.conflicts.metric')} value={metric} onChange={(v) => setMetric(v as CollisionMetric)} options={[
        { value: 'sameDoctorSameStartPairs', label: t('kpi.conflicts.sameDoctor'), testId: 'button-metric-same-doctor' },
        { value: 'samePatientSameStartCrossClinicPairs', label: t('kpi.conflicts.crossClinic'), testId: 'button-metric-cross-clinic' },
      ]} />
      <ul className="kpi-legend" aria-hidden="true">
        <li><span className="kpi-swatch kpi-swatch--before" />{t('kpi.conflicts.legendBefore')}</li>
        <li><span className="kpi-swatch kpi-swatch--after" />{t('kpi.conflicts.legendAfter')}</li>
      </ul>
      {pairs.length === 0 ? <p className="kpi-empty-line">{t('kpi.conflicts.empty')}</p> : (
        <ul className="kpi-gbar" aria-hidden="true">
          {pairs.map((p) => (
            <li key={p.clinicId} className="kpi-gbar__row" data-testid={`bar-collisions-${p.clinicId}`}>
              <bdi className="kpi-gbar__name">{p.clinicName}</bdi>
              <div className="kpi-gbar__bars">
                {(['before', 'after'] as const).map((side) => (
                  <div key={side} className="kpi-bar-line">
                    <span className={`kpi-bar kpi-bar--${side}`} style={{ inlineSize: `${((p[side] ?? 0) / max) * 100}%` }} />
                    <span className="kpi-bar__val">{p[side] === null ? t('kpi.states.notApplicable') : f.n(p[side]!)}</span>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartFrame>
  );
}

/* ---------- Line: blocked commits over time (daily or cumulative) ---------- */
export function PreventionChart({ data }: { data: KpiResult }) {
  const { t } = useTranslation(); const f = useFmt();
  const [mode, setMode] = useState<SeriesMode>('daily');
  const c = data.after.telemetry.conflicts; const period = data.after.period;
  const s = preventionSeries(period, c.daily, mode);
  const modeLabel = t(`kpi.prevention.${mode}`);
  const W = 600, H = 200, PAD = 28;
  const yMax = Math.max(1, s.max);
  const xOf = (i: number) => { const span = Math.max(1, period.days - 1); const x = PAD + (i / span) * (W - 2 * PAD); return f.rtl ? W - x : x; };
  const yOf = (v: number) => H - PAD - (v / yMax) * (H - 2 * PAD);
  const summary = s.observed === 0
    ? t('kpi.prevention.summaryEmpty', { days: f.n(period.days) })
    : t('kpi.prevention.summary', { mode: modeLabel, total: f.n(c.cumulative.blocked), observed: f.n(s.observed), days: f.n(period.days), peak: f.n(s.peak!.value), peakDate: formatDateOnly(s.peak!.date, f.locale, f.digits), warnings: f.n(c.cumulative.warnings), overrides: f.n(c.cumulative.overrides) });
  const startLbl = shortDate(period.startDate, f.locale, f.digits), endLbl = shortDate(inclusiveEnd(period), f.locale, f.digits);
  return (
    <ChartFrame id="prevention" className="kpi-card--wide" icon={<ShieldCheck size={20} aria-hidden="true" />} title={t('kpi.prevention.title')} summary={summary}
      caption={t('kpi.prevention.caption')}
      head={[t('kpi.prevention.colDate'), t('kpi.prevention.colBlocked'), t('kpi.prevention.colCumBlocked'), t('kpi.prevention.colWarnings'), t('kpi.prevention.colOverrides')]}
      rows={s.rows.map((r) => [formatDateOnly(r.date, f.locale, f.digits), ...(r.row
        ? [f.n(r.row.blocked), f.n(r.row.cumulativeBlocked), f.n(r.row.warnings), f.n(r.row.overrides)]
        : [0, 1, 2, 3].map((k) => <Unavail key={k} label={t('kpi.states.noObservation')} />))])}
      notes={<>
        <p>{t('kpi.prevention.definition')}</p>
        <p>{t('kpi.prevention.gaps')} {t(f.rtl ? 'kpi.prevention.rtlNote' : 'kpi.prevention.ltrNote')}</p>
        <p><strong>{t('kpi.prevention.coverage')}:</strong> <span dir="auto">{c.coverage}</span></p>
      </>}>
      <Segmented label={t('kpi.prevention.mode')} value={mode} onChange={(v) => setMode(v as SeriesMode)} options={[
        { value: 'daily', label: t('kpi.prevention.daily'), testId: 'button-series-daily' },
        { value: 'cumulative', label: t('kpi.prevention.cumulative'), testId: 'button-series-cumulative' },
      ]} />
      <p className="kpi-showing" data-testid="text-series-mode">{t('kpi.prevention.showing', { mode: modeLabel })}</p>
      <svg className="kpi-line" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} data-testid="svg-prevention">
        <line className="kpi-axis" x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} />
        <line className="kpi-grid" x1={PAD} x2={W - PAD} y1={yOf(yMax)} y2={yOf(yMax)} />
        <text className="kpi-tick" x={f.rtl ? W - 4 : 4} y={yOf(yMax) + 4} textAnchor={f.rtl ? 'end' : 'start'}>{f.n(yMax)}</text>
        <text className="kpi-tick" x={xOf(0)} y={H - 8} textAnchor="middle">{startLbl}</text>
        {period.days > 1 && <text className="kpi-tick" x={xOf(period.days - 1)} y={H - 8} textAnchor="middle">{endLbl}</text>}
        {s.segments.map((seg, i) => seg.length > 1 && (
          <polyline key={i} className="kpi-line__path" points={seg.map((p) => `${xOf(p.index)},${yOf(p.value)}`).join(' ')} />
        ))}
        {s.points.map((p) => <rect key={p.date} className="kpi-line__dot" x={xOf(p.index) - 4} y={yOf(p.value) - 4} width={8} height={8} data-testid={`point-${p.date}`} />)}
      </svg>
    </ChartFrame>
  );
}

/* ---------- Exact range lookup percentiles ---------- */
export function LookupCard({ data }: { data: KpiResult }) {
  const { t } = useTranslation(); const f = useFmt();
  const v = lookupView(data);
  const unav = t('kpi.states.unavailable');
  return (
    <ChartFrame id="lookup" icon={<Clock size={20} aria-hidden="true" />} title={t('kpi.lookup.title')} summary={v.available ? t('kpi.lookup.measuredSummary', { median: f.n(v.median!, 4), percentile: f.n(v.p90!, 3), count: f.n(v.samples!) }) : t('kpi.lookup.empty')}
      caption={t('kpi.lookup.caption')}
      head={[t('kpi.lookup.colMeasure'), t('kpi.lookup.colValue')]}
      rows={[
        [t('kpi.lookup.rowMedian'), v.median === null ? <Unavail /> : f.n(v.median, 4)],
        [t('kpi.lookup.rowP90'), v.p90 === null ? <Unavail /> : f.n(v.p90, 3)],
        [t('kpi.lookup.rowSamples'), v.samples === null ? <Unavail /> : f.n(v.samples)],
        [t('kpi.lookup.rowTarget'), t('kpi.lookup.targetValue', { target: f.n(LOOKUP_TARGET_SECONDS) })],
      ]}
      notes={<><p><strong>{t('kpi.lookup.boundaries')}:</strong> {t('kpi.lookup.boundaryText')}</p><p><strong>{t('kpi.lookup.coverage')}:</strong> {t('kpi.lookup.coverageText')}</p><p>{t('kpi.lookup.method')}</p></>}>
      <div className="kpi-big" data-status={v.available ? (v.meetsTarget ? 'met' : 'missed') : 'unavailable'} data-testid="value-lookup">
        <span className="kpi-big__value">{v.median === null ? '—' : f.n(v.median, 4)}</span>
        <span className="kpi-big__badge">{t(v.available ? 'kpi.lookup.rowMedian' : 'kpi.lookup.unavailable')}</span>
      </div>
      <p className="kpi-target" data-testid="text-lookup-target">{t('kpi.lookup.target', { target: f.n(LOOKUP_TARGET_SECONDS) })}</p>
      <dl className="kpi-dl">
        <div><dt>{t('kpi.lookup.rowP90')}</dt><dd data-testid="value-lookup-p90">{v.p90 === null ? unav : f.n(v.p90, 3)}</dd></div>
        <div><dt>{t('kpi.lookup.samples')}</dt><dd data-testid="text-lookup-samples">{v.samples === null ? unav : f.n(v.samples)}</dd></div>
      </dl>
      {!v.available && <p className="kpi-why" data-testid="state-lookup-empty">{t('kpi.lookup.empty')}</p>}
    </ChartFrame>
  );
}

/* ---------- Big number: lost appointments (target 0) ---------- */
export function LossCard({ data }: { data: KpiResult }) {
  const { t } = useTranslation(); const f = useFmt();
  const d = data.after.telemetry.downtime;
  const ctx: [string, number][] = [['received', d.receivedCreates], ['synced', d.synced], ['conflicted', d.conflicted], ['rejected', d.rejected], ['pending', d.pending]];
  return (
    <ChartFrame id="loss" icon={<WifiOff size={20} aria-hidden="true" />} title={t('kpi.loss.title')}
      summary={t('kpi.loss.summary', { target: f.n(LOSS_TARGET), received: f.n(d.receivedCreates), synced: f.n(d.synced), conflicted: f.n(d.conflicted), rejected: f.n(d.rejected), pending: f.n(d.pending) })}
      caption={t('kpi.loss.caption')} head={[t('kpi.loss.colMeasure'), t('kpi.loss.colValue')]}
      rows={[[t('kpi.loss.rowLost'), <Unavail key="l" />], [t('kpi.loss.rowQueued'), <Unavail key="q" />], ...ctx.map(([k, v]) => [t(`kpi.loss.${k}`), f.n(v)])]}
      notes={<p><strong>{t('kpi.prevention.coverage')}:</strong> <span dir="auto">{d.coverage}</span></p>}>
      <div className="kpi-big" data-status="unavailable" data-testid="value-loss">
        <span className="kpi-big__value">—</span>
        <span className="kpi-big__badge">{t('kpi.loss.unavailable')}</span>
      </div>
      <p className="kpi-target" data-testid="text-loss-target">{t('kpi.loss.target', { target: f.n(LOSS_TARGET) })}</p>
      <p className="kpi-why">{t('kpi.loss.why')}</p>
      <dl className="kpi-dl kpi-dl--grid">
        {ctx.map(([k, v]) => <div key={k}><dt>{t(`kpi.loss.${k}`)}</dt><dd data-testid={`text-loss-${k}`}>{f.n(v)}</dd></div>)}
      </dl>
      <p className="kpi-warn-note">{t('kpi.loss.notLoss')}</p>
    </ChartFrame>
  );
}

/* ---------- Donut: bookings by normalized source ---------- */
const SHAPES: Record<SourceKey, string> = { phone: 'circle', 'walk-in': 'square', calendar: 'triangle', 'amal-network': 'diamond', unknown: 'ring' };
function Glyph({ k }: { k: SourceKey }) {
  return <svg className={`kpi-glyph kpi-src--${k}`} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    {SHAPES[k] === 'circle' && <circle cx="7" cy="7" r="6" />}
    {SHAPES[k] === 'square' && <rect x="1" y="1" width="12" height="12" />}
    {SHAPES[k] === 'triangle' && <polygon points="7,1 13,13 1,13" />}
    {SHAPES[k] === 'diamond' && <polygon points="7,0 14,7 7,14 0,7" />}
    {SHAPES[k] === 'ring' && <circle cx="7" cy="7" r="5" fill="none" strokeWidth="3" />}
  </svg>;
}
export function SourcesChart({ data }: { data: KpiResult }) {
  const { t } = useTranslation(); const f = useFmt();
  const [win, setWin] = useState<'after' | 'before'>('after');
  const { total, slices } = sourceSlices(data[win].metrics.bookingsBySource);
  const top = slices.reduce((m, s) => (s.count > m.count ? s : m), slices[0]);
  const share = (x: number) => pct(Math.round(x * 1000) / 10, f.locale, f.digits)!;
  const R = 70, C = 2 * Math.PI * R; let acc = 0;
  return (
    <ChartFrame id="sources" icon={<PieChart size={20} aria-hidden="true" />} title={t('kpi.sources.title')}
      summary={total === 0 ? t('kpi.sources.empty') : t('kpi.sources.summary', { total: f.n(total), top: t(`kpi.sources.${top.key}`), count: f.n(top.count), pct: share(top.share) })}
      caption={t('kpi.sources.caption')} head={[t('kpi.sources.colSource'), t('kpi.sources.colCount'), t('kpi.sources.colShare')]}
      rows={[...slices.map((s) => [t(`kpi.sources.${s.key}`), f.n(s.count), total ? share(s.share) : <Unavail key="u" />]), [t('kpi.sources.total'), f.n(total), total ? share(1) : <Unavail key="t" />]]}
      notes={<p dir="auto">{data[win].metrics.definitions.sources}</p>}>
      <Segmented label={t('kpi.sources.window')} value={win} onChange={(v) => setWin(v as 'after' | 'before')} options={[
        { value: 'after', label: t('kpi.meta.after'), testId: 'button-sources-after' },
        { value: 'before', label: t('kpi.meta.before'), testId: 'button-sources-before' },
      ]} />
      {total === 0 ? <div data-testid="state-sources-empty"><EmptyState className="amal-empty--compact" headingLevel={4} title={t('kpi.sources.emptyTitle')} description={t('kpi.sources.empty')} /></div> : (
        <div className="kpi-donut">
          <svg viewBox="0 0 180 180" aria-hidden="true" className="kpi-donut__svg">
            <g transform="rotate(-90 90 90)">
              {slices.filter((s) => s.count > 0).map((s) => {
                const len = s.share * C; const el = <circle key={s.key} className={`kpi-donut__seg kpi-src--${s.key}`} cx="90" cy="90" r={R} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} />;
                acc += len; return el;
              })}
            </g>
            <text x="90" y="88" textAnchor="middle" className="kpi-donut__total">{f.n(total)}</text>
            <text x="90" y="108" textAnchor="middle" className="kpi-donut__unit">{t('kpi.sources.centre')}</text>
          </svg>
          <ul className="kpi-legend kpi-legend--col">
            {slices.map((s) => <li key={s.key} data-testid={`legend-source-${s.key}`}><Glyph k={s.key} /><span>{t(`kpi.sources.${s.key}`)}</span><span className="kpi-legend__val">{f.n(s.count)} · {share(s.share)}</span></li>)}
          </ul>
        </div>
      )}
    </ChartFrame>
  );
}

/* ---------- Bar: no-show by clinic ---------- */
export function NoShowChart({ data }: { data: KpiResult }) {
  const { t } = useTranslation(); const f = useFmt();
  const rows = noShowRows(data.after.metrics.clinics);
  const net = data.after.metrics.noShow;
  const top = topRate(rows);
  const unavail = rows.filter((r) => r.rate.percent === null).length;
  const rate = (p: number | null) => pct(p, f.locale, f.digits);
  const maxP = Math.max(1, ...rows.map((r) => r.rate.percent ?? 0));
  return (
    <ChartFrame id="noshow" icon={<UserX size={20} aria-hidden="true" />} title={t('kpi.noShow.title')}
      summary={top ? t('kpi.noShow.summary', { rate: rate(net.percent) ?? t('kpi.states.unavailable'), num: f.n(net.numerator), den: f.n(net.denominator), top: iso(top.label), topRate: rate(top.rate.percent), unavail: f.n(unavail) }) : t('kpi.noShow.summaryNone')}
      caption={t('kpi.noShow.caption')} head={[t('kpi.noShow.colClinic'), t('kpi.noShow.colRate'), t('kpi.noShow.colNum'), t('kpi.noShow.colDen')]}
      rows={rows.map((r) => [<bdi key="n">{r.label}</bdi>, rate(r.rate.percent) ?? <Unavail key="u" />, f.n(r.rate.numerator), f.n(r.rate.denominator)])}
      notes={<p>{t('kpi.noShow.definition')}</p>}>
      {rows.length === 0 ? <p className="kpi-empty-line">{t('kpi.noShow.summaryNone')}</p> : (
        <ul className="kpi-gbar" aria-hidden="true">
          {rows.map((r) => (
            <li key={r.id} className="kpi-gbar__row" data-testid={`bar-noshow-${r.id}`}>
              <bdi className="kpi-gbar__name">{r.label}</bdi>
              <div className="kpi-bar-line">
                {r.rate.percent === null ? <span className="kpi-unavail">{t('kpi.states.unavailable')}</span> : <>
                  <span className="kpi-bar kpi-bar--after" style={{ inlineSize: `${(r.rate.percent / maxP) * 100}%` }} />
                  <span className="kpi-bar__val">{rate(r.rate.percent)} <small>({t('kpi.noShow.of', { num: f.n(r.rate.numerator), den: f.n(r.rate.denominator) })})</small></span>
                </>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartFrame>
  );
}

/* ---------- Heat strip: no-show by Hebron weekday ---------- */
export function WeekdayStrip({ data }: { data: KpiResult }) {
  const { t } = useTranslation(); const f = useFmt();
  const rows = weekdayRows(data).map((w) => ({ ...w, label: weekdayName(w.weekday, f.locale) }));
  const top = topRate(rows);
  const unavail = rows.filter((r) => r.rate.percent === null).length;
  const maxP = Math.max(0.0001, ...rows.map((r) => r.rate.percent ?? 0));
  const rate = (p: number | null) => pct(p, f.locale, f.digits);
  return (
    <ChartFrame id="weekday" className="kpi-card--wide" icon={<CalendarDays size={20} aria-hidden="true" />} title={t('kpi.weekday.title')}
      summary={top ? t('kpi.weekday.summary', { top: top.label, rate: rate(top.rate.percent), unavail: f.n(unavail) }) : t('kpi.weekday.summaryNone')}
      caption={t('kpi.weekday.caption')} head={[t('kpi.weekday.colDay'), t('kpi.noShow.colRate'), t('kpi.noShow.colNum'), t('kpi.noShow.colDen')]}
      rows={rows.map((r) => [r.label, rate(r.rate.percent) ?? <Unavail key="u" />, r.missing ? <Unavail key="n" /> : f.n(r.rate.numerator), r.missing ? <Unavail key="d" /> : f.n(r.rate.denominator)])}
      notes={<p>{t('kpi.weekday.definition')} {t('kpi.weekday.darker')}</p>}>
      <ol className="kpi-heat" aria-hidden="true">
        {rows.map((r) => {
          const level = r.rate.percent === null ? null : Math.min(4, Math.ceil((r.rate.percent / maxP) * 4));
          return (
            <li key={r.weekday} className="kpi-heat__cell" data-level={level ?? 'none'} data-testid={`cell-weekday-${r.weekday}`}>
              <span className="kpi-heat__day">{r.label}</span>
              <span className="kpi-heat__val">{rate(r.rate.percent) ?? t('kpi.states.unavailable')}</span>
              <span className="kpi-heat__den" data-missing={r.missing || undefined}>{r.missing ? t('kpi.states.noObservation') : t('kpi.noShow.of', { num: f.n(r.rate.numerator), den: f.n(r.rate.denominator) })}</span>
            </li>
          );
        })}
      </ol>
    </ChartFrame>
  );
}

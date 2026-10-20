import { flushSync } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CircleCheck, CircleDashed, FileWarning, Printer, RotateCw } from 'lucide-react';
import { useAmalPreferences, type AmalLocale } from '@workspace/amal-ui';
import { i18n } from '@/i18n';
import { localCache } from '@/offline';
import { appointmentWindow } from '@/offline/calendar';
import { getBookingSnapshot, getLocalCalendar } from '@/offline/booking-bridge';
import type { CalendarAppointment } from '@/calendar/adapter';
import type { CachedSnapshot } from '@/offline/types';
import type { ShellClinic } from '@/shell/identity';
import { formatDateOnly, formatInstant, formatNumber } from '@/shell/formatting';
import { buildRows, clampDay, countRows, dayBounds, dayCoverage, formatLocalTime, parseScope, sameTicket, selectableDays, ticketMatchesScope, type Coverage, type SheetRow, type TicketLike } from './model';
import './messages';
import './day-sheet.css';
import { observeSheetStorage } from './storage-observer';

interface Props { clinic: ShellClinic | null; scope: string; title: string }
type Digits = 'latn' | 'arab';
type Load =
  | { kind: 'loading' } | { kind: 'locked' } | { kind: 'error' }
  | { kind: 'ready'; scope: string; ticket: TicketLike; snapshot: CachedSnapshot; appts: CalendarAppointment[] };
interface PrintSnap {
  ticket: TicketLike; rows: SheetRow[]; coverage: Coverage; day: string; doctorLabel: string; doctorFiltered: boolean;
  generatedAt: string | null; refreshedAt: string | null; clinicName: string; locale: AmalLocale; digits: Digits;
}

function currentTicket(): TicketLike | null {
  const r = localCache.captureScope();
  return r.ok ? r.value : null;
}
async function waitTicket(): Promise<TicketLike | null> {
  for (let n = 0; n < 40; n++) {
    const t = currentTicket();
    if (t) return t;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return null;
}

export function DaySheet({ clinic, scope, title }: Props) {
  const { t } = useTranslation('daySheet');
  const { locale, digitPreference } = useAmalPreferences();
  const expected = useMemo(() => parseScope(scope), [scope]);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [day, setDay] = useState<string | null>(null);
  const [doctorId, setDoctorId] = useState<number | null>(null);
  const [frozen, setFrozen] = useState<PrintSnap | null>(null);
  const [announce, setAnnounce] = useState('');
  const req = useRef(0);
  const frozenRef = useRef<PrintSnap | null>(null); frozenRef.current = frozen;
  const deferred = useRef(false);

  /** A ticket is valid for private display/print only if it is still the exact live grant for this scope. */
  const stillValid = useCallback((ticket: TicketLike) => {
    const live = currentTicket();
    return ticketMatchesScope(live, expected) && sameTicket(live, ticket);
  }, [expected]);

  const clear = useCallback(() => {
    req.current++; deferred.current = false; frozenRef.current = null;
    flushSync(() => { setFrozen(null); setLoad({ kind: 'locked' }); });
  }, []);

  const read = useCallback(async () => {
    if (frozenRef.current) { deferred.current = true; return; }
    const id = ++req.current;
    if (!clinic || !expected || expected.clinicId !== clinic.id) return;
    setLoad({ kind: 'loading' });
    try {
      const t0 = await waitTicket();
      if (id !== req.current) return;
      if (!t0 || !ticketMatchesScope(t0, expected)) { setLoad({ kind: 'locked' }); return; }
      const snapshot = await getBookingSnapshot();
      if (id !== req.current) return;
      const appts = snapshot.metadata
        ? await getLocalCalendar({ clinicId: clinic.id, from: snapshot.window.startUtc, to: snapshot.window.endUtc })
        : [];
      if (id !== req.current) return;
      // Commit only if the grant did not change during any await.
      if (!stillValid(t0) || (snapshot.metadata && (snapshot.metadata.userId !== t0.userId || snapshot.metadata.clinicId !== t0.clinicId))) {
        setLoad({ kind: 'locked' }); return;
      }
      setLoad({ kind: 'ready', scope, ticket: { userId: t0.userId, clinicId: t0.clinicId, generation: t0.generation }, snapshot, appts });
    } catch (e) {
      if (id !== req.current) return;
      const unauthorized = !currentTicket() || /unauthorized|stale-context/.test(String((e as Error)?.message ?? ''));
      setLoad(unauthorized ? { kind: 'locked' } : { kind: 'error' });
    }
  }, [clinic, expected, scope, stillValid]);

  useEffect(() => { void read(); return () => { req.current++; }; }, [read]);
  useEffect(() => localCache.subscribeContext(clear), [clear]);
  // Reads remain controller-authorized. While printing, read() defers updates;
  // invalidation above still clears immediately regardless of that snapshot.
  useEffect(() => observeSheetStorage(() => { void read(); }), [read]);
  // A grant only emits a storage 'ready' transition; re-read once if locked/errored and a matching ticket now exists.
  const loadKind = useRef(load.kind); loadKind.current = load.kind;
  useEffect(() => localCache.subscribeStorage(() => {
    if (localCache.getStorageStatus().state !== 'ready') return;
    if ((loadKind.current === 'locked' || loadKind.current === 'error') && ticketMatchesScope(currentTicket(), expected)) void read();
  }), [read, expected]);
  useEffect(() => {
    const on = () => void read();
    window.addEventListener('amal:appointments-changed', on);
    let localDay = appointmentWindow().localStartDate;
    const timer = setInterval(() => {
      const next = appointmentWindow().localStartDate;
      if (next !== localDay) { localDay = next; void read(); }
    }, 1000);
    return () => { clearInterval(timer); window.removeEventListener('amal:appointments-changed', on); };
  }, [read]);

  const ready = load.kind === 'ready' && load.scope === scope ? load : null;
  const hasCache = !!ready?.snapshot.metadata;
  const days = useMemo(() => ready ? selectableDays(ready.snapshot.window) : [], [ready]);
  const selected = clampDay(day, days);
  const doctors = useMemo(() => ready ? [...ready.snapshot.doctors].sort((a, b) => a.name.localeCompare(b.name, locale)) : [], [ready, locale]);
  const doctorFilter = doctorId !== null && doctors.some(d => d.id === doctorId) ? doctorId : null;
  const coverage: Coverage = ready && selected ? dayCoverage(selected, ready.snapshot) : 'missing';
  const rows = useMemo(() => ready && selected ? buildRows(ready.appts, doctors, dayBounds(selected), doctorFilter) : [], [ready, selected, doctors, doctorFilter]);
  const canPrint = !!ready && hasCache && !!selected && !!clinic && coverage !== 'missing';
  const fmtN = (n: number, d: Digits = digitPreference, l: AmalLocale = locale) => formatNumber(n, l, d);

  useEffect(() => {
    if (ready && selected) setAnnounce(t('announce', { count: rows.length, n: formatNumber(rows.length, locale, digitPreference) }));
  }, [ready, selected, rows.length, t, locale, digitPreference]);

  const freeze = useCallback((): PrintSnap | null => {
    if (!canPrint || !ready || !selected || !clinic || !stillValid(ready.ticket)) return null;
    const window = appointmentWindow();
    if (selected < window.localStartDate || selected >= window.localEndDate) return null;
    const doc = doctors.find(d => d.id === doctorFilter);
    return {
      ticket: ready.ticket, rows, coverage, day: selected, doctorLabel: doc ? doc.name : t('allDoctors'), doctorFiltered: !!doc,
      generatedAt: new Date().toISOString(), refreshedAt: ready.snapshot.metadata?.refreshedAt ?? null, clinicName: clinic.name,
      locale, digits: digitPreference,
    };
  }, [canPrint, ready, selected, clinic, doctors, doctorFilter, rows, coverage, t, locale, digitPreference, stillValid]);
  const freezeRef = useRef(freeze); freezeRef.current = freeze;
  const validRef = useRef(stillValid); validRef.current = stillValid;
  const readRef = useRef(read); readRef.current = read;

  useEffect(() => {
    const before = () => {
      const existing = frozenRef.current;
      const window = appointmentWindow();
      const next = existing && validRef.current(existing.ticket) && existing.day >= window.localStartDate && existing.day < window.localEndDate ? existing : freezeRef.current();
      frozenRef.current = next;
      flushSync(() => setFrozen(next));
    };
    const after = () => {
      frozenRef.current = null;
      setFrozen(null);
      if (deferred.current) { deferred.current = false; void readRef.current(); }
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); };
  }, []);

  const doPrint = () => {
    const snap = freeze();
    if (!snap) return;
    frozenRef.current = snap;
    setFrozen(snap);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const cur = frozenRef.current;
      if (cur && validRef.current(cur.ticket)) window.print();
      else { frozenRef.current = null; setFrozen(null); }
    }));
  };

  const view: PrintSnap | null = frozen ?? (ready && selected && clinic ? {
    ticket: ready.ticket, rows, coverage, day: selected, doctorLabel: doctors.find(d => d.id === doctorFilter)?.name ?? t('allDoctors'),
    doctorFiltered: doctorFilter !== null, generatedAt: null, refreshedAt: ready.snapshot.metadata?.refreshedAt ?? null,
    clinicName: clinic.name, locale, digits: digitPreference,
  } : null);
  const vLocale = view?.locale ?? locale, vDigits = view?.digits ?? digitPreference;
  const vt = i18n.getFixedT(vLocale, 'daySheet');
  const fmtDay = (d: string, l: AmalLocale = locale, g: Digits = digitPreference) => formatDateOnly(d, l, g);
  const fmtAt = (iso: string) => { try { return formatInstant(iso, vLocale, vDigits); } catch { return null; } };
  const vCounts = view ? countRows(view.rows) : null;

  return (
    <article className="ds" data-testid="page-day-sheet" data-print-allowed={frozen ? 'true' : 'false'}>
      <header className="ds-head ds-screen">
        <p className="ds-eyebrow">{t('eyebrow')}</p>
        <h1 id="page-title" tabIndex={-1} className="ds-title"><Printer size={28} aria-hidden="true" />{title}</h1>
        <p className="ds-lede">{t('lede')}</p>
      </header>
      <p className="shell-sr" role="status" aria-live="polite" data-testid="status-day-sheet">{announce}</p>

      {!clinic ? <Notice icon="info" text={t('noClinic')} testId="state-day-sheet-no-clinic" /> :
       load.kind === 'locked' ? <Notice icon="warn" text={t('locked')} testId="state-day-sheet-locked" action={<button type="button" className="amal-btn amal-btn--secondary amal-btn--sm" onClick={() => void read()} data-testid="button-day-sheet-retry"><RotateCw size={16} aria-hidden="true" />{t('retry')}</button>} /> :
       load.kind === 'error' ? <Notice icon="warn" text={t('error')} testId="state-day-sheet-error" action={<button type="button" className="amal-btn amal-btn--secondary amal-btn--sm" onClick={() => void read()} data-testid="button-day-sheet-retry"><RotateCw size={16} aria-hidden="true" />{t('retry')}</button>} /> :
       load.kind === 'loading' ? <div className="ds-skel ds-screen" aria-busy="true" aria-label={t('loading')} data-testid="state-day-sheet-loading"><span /><span /><span /><span /></div> :
       !hasCache ? <Notice icon="warn" text={t('notCached')} testId="state-day-sheet-uncached" /> : (
        <>
          <div className="ds-controls ds-screen" role="group" aria-label={t('eyebrow')}>
            <label className="ds-field"><span>{t('day')}</span>
              <select value={selected ?? ''} onChange={e => setDay(e.target.value)} disabled={!!frozen} data-testid="select-day-sheet-day">
                {days.map(d => <option key={d} value={d}>{fmtDay(d)}</option>)}
              </select>
            </label>
            <label className="ds-field"><span>{t('doctor')}</span>
              <select value={doctorFilter ?? ''} onChange={e => setDoctorId(e.target.value ? Number(e.target.value) : null)} disabled={!!frozen} data-testid="select-day-sheet-doctor">
                <option value="">{t('allDoctors')}</option>
                {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <div className="ds-actions">
              <button type="button" className="amal-btn amal-btn--secondary" onClick={() => void read()} data-testid="button-day-sheet-reload"><RotateCw size={18} aria-hidden="true" />{t('reload')}</button>
              <button type="button" className="amal-btn amal-btn--primary" onClick={doPrint} disabled={!canPrint} aria-describedby={canPrint ? undefined : 'ds-print-note'} data-testid="button-day-sheet-print"><Printer size={18} aria-hidden="true" />{t('print')}</button>
            </div>
            {!canPrint && <p id="ds-print-note" className="ds-note">{t('printBlocked')}</p>}
          </div>

          {view && (
            <section className="ds-sheet" lang={vLocale} aria-labelledby="ds-sheet-title" data-testid="day-sheet-preview">
              <div className="ds-sheet__head">
                <div>
                  <p className="ds-sheet__clinic"><span>{vt('clinic')}:</span> <bdi data-testid="text-day-sheet-clinic">{view.clinicName}</bdi></p>
                  <h2 id="ds-sheet-title" className="ds-sheet__date" data-testid="text-day-sheet-date">{fmtDay(view.day, vLocale, vDigits)}</h2>
                  <p className="ds-sheet__doctor"><span>{vt('doctor')}:</span> <bdi>{view.doctorLabel}</bdi></p>
                </div>
                <div className="ds-stamps">
                  <p data-testid="text-day-sheet-refreshed">{view.refreshedAt && fmtAt(view.refreshedAt) ? vt('refreshed', { time: fmtAt(view.refreshedAt) }) : vt('refreshedUnknown')}</p>
                  {view.generatedAt && <p data-testid="text-day-sheet-generated">{vt('generated', { time: fmtAt(view.generatedAt) })}</p>}
                </div>
              </div>
              <p className={`ds-cov ds-cov--${view.coverage}`} role={view.coverage === 'complete' ? undefined : 'alert'} data-testid={`status-day-sheet-coverage-${view.coverage}`}>
                {view.coverage === 'complete' ? <CircleCheck size={18} aria-hidden="true" /> : <FileWarning size={18} aria-hidden="true" />}
                <strong>{vt(`coverage.${view.coverage}`)}</strong>
              </p>
              <p className="ds-summary" data-testid="text-day-sheet-summary">{vt('summary', { total: fmtN(vCounts!.total, vDigits, vLocale), provisional: fmtN(vCounts!.provisional, vDigits, vLocale), attention: fmtN(vCounts!.attention, vDigits, vLocale) })}</p>
              {view.rows.length === 0 ? (
                view.coverage === 'complete' ? <p className="ds-empty" data-testid="state-day-sheet-empty">{view.doctorFiltered ? vt('emptyDoctor') : vt('emptyDay')}</p> : null
              ) : (
                <table className="ds-table" data-testid="table-day-sheet">
                  <thead><tr>
                    <th scope="col">{vt('columns.time')}</th><th scope="col">{vt('columns.doctor')}</th><th scope="col">{vt('columns.patient')}</th>
                    <th scope="col">{vt('columns.status')}</th><th scope="col">{vt('columns.notes')}</th>
                  </tr></thead>
                  <tbody>
                    {view.rows.map(r => (
                      <tr key={r.key} className={`${r.provisional ? 'is-provisional' : ''}${r.lifecycle === 'cancelled' ? ' is-cancelled' : ''}`} data-testid={`row-day-sheet-${r.key}`}>
                        <td className="ds-time"><bdi>{formatLocalTime(r.startsAt, vDigits)}–{formatLocalTime(r.endsAt, vDigits)}</bdi></td>
                        <td><bdi>{r.doctorName ?? vt('unknownDoctor')}</bdi></td>
                        <td><bdi>{r.patientName ?? vt('unknownPatient')}</bdi></td>
                        <td>{vt(`status.${r.lifecycle}`)}</td>
                        <td className="ds-flags">
                          {r.attention && <span className="ds-flag ds-flag--attn"><AlertTriangle size={14} aria-hidden="true" />{vt('attention')}</span>}
                          {r.provisional && <span className="ds-flag ds-flag--prov"><CircleDashed size={14} aria-hidden="true" />{vt('provisional')}</span>}
                          {!r.provisional && !r.attention && <span className="ds-flag">{vt('serverRecord')}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {vCounts!.provisional > 0 && <p className="ds-foot">{vt('footer')}</p>}
            </section>
          )}
        </>
      )}
    </article>
  );
}

function Notice({ icon, text, testId, action }: { icon: 'info' | 'warn'; text: string; testId: string; action?: React.ReactNode }) {
  return (
    <div className={`ds-notice ds-notice--${icon}`} role={icon === 'warn' ? 'alert' : 'status'} data-testid={testId}>
      {icon === 'warn' ? <AlertTriangle size={20} aria-hidden="true" /> : <CircleDashed size={20} aria-hidden="true" />}
      <p>{text}</p>{action}
    </div>
  );
}

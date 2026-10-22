import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Database, Download, FileJson, FileUp, FolderOpen, Loader2, Lock, RefreshCw } from 'lucide-react';
import {
  commitImport, downloadImportReport, getGetImportBatchQueryKey, getImportBatch, getListDoctorsQueryKey, useGetImportBatch, useListDoctors, useUploadImport,
  type ImportBatch, type ImportRow,
} from '@workspace/api-client-react';
import { EmptyState, useAmalPreferences } from '@workspace/amal-ui';
import type { ShellClinic } from '@/shell/identity';
import { formatInstant, formatNumber } from '@/shell/formatting';
import { newOpId } from '@/booking/ops';
import {
  STEPS, canEnter, commitBody, commitReady, conflictSeverity, counts, effectiveDoctor, emailGroups, failure, groupConflicts, isPatientOverlap, isUncertain, openConflicts, parseExport,
  readLastBatch, readPending, rowState, srcEmail, srcName, srcStart, statusSummary, stepOpen, writeLastBatch, writePending, type DoctorChoices, type StepId,
} from './model';
import { errorText, issueText } from './i18n';
import { RowDialog, type Memory } from './RowDialog';
import { Iso, Modal, Msg, Skeleton } from './ui';
import '@/booking/i18n';
import '@/booking/booking.css';
import './imports.css';

export function ImportPage({ clinic, title, scope }: { clinic: ShellClinic | null; title: string; scope: string }) {
  const { t } = useTranslation();
  if (!clinic) return (
    <section className="im" data-testid="page-import">
      <h1 id="page-title" tabIndex={-1} className="im-h1"><FileUp size={28} aria-hidden="true" />{title}</h1>
      <div className="im-empty"><Lock size={28} aria-hidden="true" /><p>{t('im.common.noClinic')}</p></div>
    </section>
  );
  // Remount per user/role/clinic so no selection or batch crosses clinic context.
  return <ImportWorkspace key={scope} clinic={clinic} title={title} scope={scope} />;
}

const choiceKey = (scope: string, id: number) => `amal.import.doctors.${scope}.${id}`;
const readChoices = (scope: string, id: number): DoctorChoices => { try { return JSON.parse(sessionStorage.getItem(choiceKey(scope, id)) ?? '{}') ?? {}; } catch { return {}; } };

function ImportWorkspace({ clinic, title, scope }: { clinic: ShellClinic; title: string; scope: string }) {
  const { t } = useTranslation();
  const { locale, digitPreference: dp } = useAmalPreferences();
  const n = (v: number) => formatNumber(v, locale, dp);
  const qc = useQueryClient();
  const search = useSearch();
  const [location, navigate] = useLocation();
  const urlBatch = Number(new URLSearchParams(search).get('batch'));
  const batchId = Number.isInteger(urlBatch) && urlBatch > 0 ? urlBatch : null;
  const setBatchId = (id: number | null) => {
    const p = new URLSearchParams(search); if (id) p.set('batch', String(id)); else p.delete('batch');
    writeLastBatch(scope, id);
    navigate(`${location}${p.toString() ? `?${p}` : ''}`, { replace: true });
  };
  const key = getGetImportBatchQueryKey(batchId ?? 0);
  const batchQ = useGetImportBatch(batchId ?? 0, { query: { enabled: !!batchId, queryKey: key } });
  const batch = batchId ? batchQ.data ?? null : null;
  const doctorsQ = useListDoctors({ clinicId: clinic.id, limit: 100 }, { query: { queryKey: getListDoctorsQueryKey({ clinicId: clinic.id, limit: 100 }) } });
  // Only doctors returned for THIS clinic are selectable; never hard-coded.
  const doctors = useMemo(() => (doctorsQ.data?.items ?? []).filter((d) => d.clinicId === clinic.id), [doctorsQ.data, clinic.id]);
  const allowed = useMemo(() => new Set(doctors.map((d) => d.id)), [doctors]);
  const doctorName = (id: number | null) => doctors.find((d) => d.id === id)?.name ?? null;

  const [choices, setChoices] = useState<DoctorChoices>({});
  useEffect(() => { setChoices(batchId ? readChoices(scope, batchId) : {}); }, [batchId, scope]);
  const groups = useMemo(() => (batch ? emailGroups(batch) : []), [batch]);
  /** Saved include reviews also imply the reviewed doctor for their email after reopening. */
  const implied = useMemo(() => {
    const m: DoctorChoices = {};
    for (const r of batch?.rows ?? []) if (r.review?.action === 'include' && r.mapping && !m[srcEmail(r)]) m[srcEmail(r)] = r.mapping.doctorId;
    return m;
  }, [batch]);
  const doctorFor = (email: string) => {
    const g = groups.find((x) => x.email === email);
    return g ? effectiveDoctor(g, { ...implied, ...choices }, allowed) : null;
  };
  const chooseDoctor = (email: string, id: number) => {
    const next = { ...choices, [email]: id }; setChoices(next);
    if (batchId) try { sessionStorage.setItem(choiceKey(scope, batchId), JSON.stringify(next)); } catch { /* ignore */ }
  };

  const open = stepOpen(batch, groups, doctorFor);
  const [step, setStep] = useState(0);
  useEffect(() => { if (batch && step === 0 && batch.status === 'committed') setStep(5); }, [batch, step]);
  const headRef = useRef<HTMLHeadingElement>(null);
  const [announce, setAnnounce] = useState('');
  const go = (i: number) => {
    if (!canEnter(i, open, !!batch)) return;
    setStep(i);
    setAnnounce(t('im.wizard.announce', { n: n(i + 1), name: t(`im.wizard.steps.${STEPS[i]}`), open: n(open[STEPS[i]!]) }));
    requestAnimationFrame(() => headRef.current?.focus());
  };
  const memory = useRef(new Map<number, Memory>());
  const [editing, setEditing] = useState<{ row: ImportRow; schedule?: boolean } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'block'; text: string } | null>(null);
  const applyBatch = (b: ImportBatch) => qc.setQueryData(getGetImportBatchQueryKey(b.id), b);
  const refetch = () => void qc.invalidateQueries({ queryKey: key });

  const id = STEPS[step]!;
  const stepTitle = t(`im.wizard.steps.${id}`);

  return (
    <section className="im" data-testid="page-import" aria-labelledby="page-title">
      <header className="im-head">
        <p className="im-eyebrow">{t('im.wizard.eyebrow')} · <Iso>{clinic.name}</Iso></p>
        <h1 id="page-title" tabIndex={-1} className="im-h1"><FileUp size={28} aria-hidden="true" />{title}</h1>
        <p className="im-lede">{t('im.wizard.lede')}</p>
        {batch && (
          <p className="im-batch" data-testid="text-batch-line">
            <span>{t('im.wizard.batchLine', { id: batch.id, version: batch.version, source: '\u2068' + (batch.sourceName ?? batch.adapter ?? '') + '\u2069' })}</span>
            <span className={`im-pill im-pill--${batch.status}`} data-testid="status-batch">{t(`im.wizard.batchStatus.${batch.status}`)}</span>
            {batch.status !== 'committed' && <span className="im-pill im-pill--staging">{t('im.wizard.stagingNote')}</span>}
          </p>
        )}
      </header>

      <nav aria-label={t('im.wizard.stepsLabel')} className="im-steps-nav" tabIndex={0}>
        <ol className="im-steps">
          {STEPS.map((s, i) => {
            const enter = canEnter(i, open, !!batch);
            const done = !!batch && open[s] === 0 && i !== step;
            const state = i === step ? 'current' : !enter ? 'blocked' : done ? 'done' : 'todo';
            return (
              <li key={s}>
                <button type="button" className={`im-step is-${state}`} aria-current={i === step ? 'step' : undefined} aria-disabled={!enter}
                  onClick={() => go(i)} data-testid={`step-${s}`}>
                  <span className="im-step__n" aria-hidden="true">{state === 'done' ? <CheckCircle2 size={18} /> : state === 'blocked' ? <Lock size={14} /> : n(i + 1)}</span>
                  <span className="im-step__txt">
                    <span className="im-step__label">{t(`im.wizard.steps.${s}`)}</span>
                    <span className="im-step__meta">{batch && open[s] > 0 && s !== 'upload' ? t('im.wizard.openCount', { count: n(open[s]) }) : t(`im.wizard.stepStatus.${state}`)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <p className="im-sr" aria-live="polite" data-testid="status-step-announce">{announce}</p>

      <div className="im-panel">
        <p className="im-eyebrow">{t('im.wizard.stepOf', { n: n(step + 1) })}</p>
        <h2 ref={headRef} tabIndex={-1} className="im-h2" data-testid="text-step-title">{stepTitle}</h2>
        {notice && <Msg tone={notice.tone} testId="status-notice">{notice.text}</Msg>}

        {batchId && batchQ.isLoading && <Skeleton lines={6} label={t('im.common.loading')} />}
        {batchId && batchQ.isError && (
          <Msg tone="block" testId="status-batch-error">
            {errorText(t, batchQ.error)}{' '}
            <span className="im-row-actions">
              <button type="button" className="bk-btn bk-btn--sm" onClick={() => void batchQ.refetch()} data-testid="button-batch-retry"><RefreshCw size={16} aria-hidden="true" />{t('im.common.retry')}</button>
              <button type="button" className="bk-btn bk-btn--sm" onClick={() => { setBatchId(null); setStep(0); }} data-testid="button-batch-clear">{t('im.wizard.startOver')}</button>
            </span>
          </Msg>
        )}

        {id === 'upload' && <UploadStep scope={scope} batch={batch} onBatch={(b) => { applyBatch(b); setBatchId(b.id); setNotice({ tone: 'ok', text: t('im.upload.staged', { count: b.rows.length }) }); }} onOpen={(bid) => { setNotice(null); setBatchId(bid); }} onReset={() => { setBatchId(null); setNotice(null); }} />}
        {batch && id === 'doctors' && <DoctorsStep batch={batch} groups={groups} doctors={doctors} doctorsQ={doctorsQ} doctorFor={doctorFor} onChoose={chooseDoctor} onEdit={(row) => setEditing({ row })} />}
        {batch && id === 'patients' && <PatientsStep batch={batch} doctorFor={doctorFor} doctorName={doctorName} onEdit={(row) => setEditing({ row })} />}
        {batch && id === 'status' && <StatusStep batch={batch} onEdit={(row) => setEditing({ row })} />}
        {batch && id === 'conflicts' && <ConflictsStep batch={batch} onEdit={(row) => setEditing({ row, schedule: true })} onRefresh={refetch} refreshing={batchQ.isFetching} />}
        {batch && id === 'commit' && <CommitStep scope={scope} batch={batch} open={open} doctorFor={doctorFor} onBatch={applyBatch} />}

        <div className="im-nav">
          <button type="button" className="bk-btn" disabled={step === 0} onClick={() => go(step - 1)} data-testid="button-step-back"><ChevronLeft size={18} className="im-flip" aria-hidden="true" />{t('im.common.back')}</button>
          {step < 5 && (
            <>
              {batch && open[id] > 0 && id !== 'upload' && <p className="im-hint" role="status">{t('im.wizard.nextBlocked')}</p>}
              <button type="button" className="bk-btn bk-btn--primary" disabled={!canEnter(step + 1, open, !!batch)} onClick={() => go(step + 1)} data-testid="button-step-next">
                {t('im.common.next')}<ChevronRight size={18} className="im-flip" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>

      {batch && editing && (
        <RowDialog
          key={`${editing.row.id}:${batch.version}`}
          batch={batch} row={batch.rows.find((r) => r.id === editing.row.id) ?? editing.row}
          doctorId={doctorFor(srcEmail(editing.row))} doctorName={doctorName(doctorFor(srcEmail(editing.row)))}
          memory={memory.current.get(editing.row.id)} focusSchedule={editing.schedule}
          onClose={() => setEditing(null)}
          onStale={refetch}
          onSaved={(b, m) => { memory.current.set(editing.row.id, m); applyBatch(b); setEditing(null); setNotice({ tone: 'ok', text: t('im.review.saved', { id: editing.row.id }) }); }}
        />
      )}
    </section>
  );
}

/* ---------------- Step 1 ---------------- */
function UploadStep({ scope, batch, onBatch, onOpen, onReset }: { scope: string; batch: ImportBatch | null; onBatch: (b: ImportBatch) => void; onOpen: (id: number) => void; onReset: () => void }) {
  const { t } = useTranslation();
  const upload = useUploadImport();
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [rows, setRows] = useState<{ name: string; rows: Record<string, unknown>[] } | null>(null);
  const [reopen, setReopen] = useState('');
  const [reopenErr, setReopenErr] = useState(false);
  const last = readLastBatch(scope);
  const opRef = useRef<{ sig: string; id: string } | null>(null);
  const opFor = (sig: string) => { if (!opRef.current || opRef.current.sig !== sig) opRef.current = { sig, id: newOpId() }; return opRef.current.id; };
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; setRows(null); setFileErr(null);
    if (!f) return;
    const r = parseExport(f.name, f.size > 131072 ? '' : await f.text(), f.size);
    if (!r.ok) setFileErr(t(`im.upload.${r.error}`)); else setRows({ name: f.name.slice(0, 100), rows: r.rows });
  };
  const errorCount = batch ? batch.rows.filter((r) => r.errors.length).length : 0;
  const stage = (body: Parameters<typeof upload.mutate>[0]['data']) => upload.mutate({ data: body }, { onSuccess: (b) => { opRef.current = null; onBatch(b); } });

  if (batch) return (
    <div className="im-stack">
      <Msg tone="info" testId="status-staged">{t('im.upload.staged', { count: batch.rows.length })}</Msg>
      {errorCount > 0 && <Msg tone="warn">{t('im.upload.rowErrors', { count: errorCount })}</Msg>}
      <div><button type="button" className="bk-btn" onClick={onReset} data-testid="button-start-over">{t('im.wizard.startOver')}</button></div>
    </div>
  );
  return (
    <div className="im-sources">
      <article className="im-card im-card--hero">
        <Database size={24} aria-hidden="true" />
        <h3 className="im-h3">{t('im.upload.seedTitle')}</h3>
        <p className="im-hint">{t('im.upload.seedBody')}</p>
        <button type="button" className="bk-btn bk-btn--primary" disabled={upload.isPending} aria-busy={upload.isPending}
          onClick={() => stage({ source: 'seed', clientOpId: opFor('seed') })} data-testid="button-stage-seed">
          {upload.isPending && <Loader2 size={18} className="im-spin" aria-hidden="true" />}{t('im.upload.seedBtn')}
        </button>
      </article>
      <article className="im-card">
        <FileJson size={24} aria-hidden="true" />
        <h3 className="im-h3">{t('im.upload.fileTitle')}</h3>
        <p className="im-hint">{t('im.upload.fileBody')}</p>
        <label className="im-label" htmlFor="imp-file">{t('im.upload.fileLabel')}</label>
        <input id="imp-file" type="file" accept=".json,application/json" className="im-input" onChange={(e) => void onFile(e)} aria-invalid={!!fileErr} data-testid="input-import-file" />
        {fileErr && <p className="im-field-err" role="alert" data-testid="error-file">{fileErr}</p>}
        <button type="button" className="bk-btn" disabled={!rows || upload.isPending}
          onClick={() => rows && stage({ source: 'json', sourceName: rows.name, rows: rows.rows, clientOpId: opFor(`json:${rows.name}:${JSON.stringify(rows.rows).length}`) })} data-testid="button-stage-file">
          {t('im.upload.fileBtn')}
        </button>
      </article>
      <article className="im-card">
        <FolderOpen size={24} aria-hidden="true" />
        <h3 className="im-h3">{t('im.upload.reopenTitle')}</h3>
        {last && <button type="button" className="bk-btn bk-btn--sm" onClick={() => onOpen(last)} data-testid="button-reopen-last">{t('im.upload.lastBatch', { id: last })}</button>}
        <form className="im-inline" onSubmit={(e) => { e.preventDefault(); const v = Number(reopen); if (!Number.isInteger(v) || v < 1) { setReopenErr(true); return; } setReopenErr(false); onOpen(v); }}>
          <label className="im-label" htmlFor="reopen">{t('im.upload.reopenLabel')}</label>
          <input id="reopen" className="im-input" inputMode="numeric" dir="ltr" value={reopen} onChange={(e) => setReopen(e.target.value)} aria-invalid={reopenErr} data-testid="input-reopen-batch" />
          <button type="submit" className="bk-btn bk-btn--sm" data-testid="button-reopen">{t('im.upload.reopenBtn')}</button>
          {reopenErr && <p className="im-field-err" role="alert">{t('im.upload.errBatchId')}</p>}
        </form>
      </article>
      {upload.isError && <div className="im-span-all"><Msg tone="block" testId="status-upload-error">{errorText(t, upload.error)}</Msg></div>}
    </div>
  );
}

/* ---------------- Step 2 ---------------- */
function DoctorsStep({ batch, groups, doctors, doctorsQ, doctorFor, onChoose, onEdit }: {
  batch: ImportBatch; groups: ReturnType<typeof emailGroups>; doctors: { id: number; name: string }[]; doctorsQ: { isLoading: boolean; isError: boolean; refetch: () => unknown };
  doctorFor: (e: string) => number | null; onChoose: (email: string, id: number) => void; onEdit: (row: ImportRow) => void;
}) {
  const { t } = useTranslation();
  const committed = batch.status === 'committed';
  if (doctorsQ.isLoading) return <Skeleton lines={3} label={t('im.common.loading')} />;
  if (doctorsQ.isError) return <Msg tone="block">{t('im.doctors.doctorsFailed')} <button type="button" className="bk-btn bk-btn--sm" onClick={() => void doctorsQ.refetch()}>{t('im.common.retry')}</button></Msg>;
  return (
    <div className="im-stack">
      <p className="im-lede">{t('im.doctors.lede')}</p>
      {doctors.length === 0 && <Msg tone="warn">{t('im.doctors.noDoctors')}</Msg>}
      {!committed && batch.rows.filter((row) => !doctorFor(srcEmail(row)) && row.review?.action !== 'skip').map((row) => (
        <div className="im-inline" key={row.id}>
          <span className="im-mono">#{row.id}</span><Iso>{srcName(row)}</Iso>
          <button type="button" className="bk-btn bk-btn--sm" onClick={() => onEdit(row)} data-testid={`button-unmapped-review-${row.id}`}>
            {t('im.review.title', { id: row.id })}
          </button>
        </div>
      ))}
      <div className="im-table-wrap" tabIndex={0}>
        <table className="im-table">
          <thead><tr><th scope="col">{t('im.doctors.email')}</th><th scope="col">{t('im.doctors.rows')}</th><th scope="col">{t('im.doctors.serverMatch')}</th><th scope="col">{t('im.doctors.choose')}</th></tr></thead>
          <tbody>
            {groups.map((g) => {
              const current = doctorFor(g.email);
              const stale = batch.rows.filter((r) => g.rowIds.includes(r.id) && r.review?.action === 'include' && r.mapping && current !== null && r.mapping.doctorId !== current).length;
              return (
                <tr key={g.email} data-testid={`row-email-${g.email}`}>
                  <th scope="row" data-label={t('im.doctors.email')}><Iso ltr>{g.email || '—'}</Iso></th>
                  <td data-label={t('im.doctors.rows')}>{g.rowIds.length}</td>
                  <td data-label={t('im.doctors.serverMatch')}>
                    {g.issue ? <span className="im-tag im-tag--warn"><AlertTriangle size={14} aria-hidden="true" />{issueText(t, g.issue)}</span>
                      : <span className="im-tag im-tag--ok"><CheckCircle2 size={14} aria-hidden="true" />{t('im.doctors.matched')}</span>}
                  </td>
                  <td data-label={t('im.doctors.choose')}>
                    <select className="im-input" value={current ?? ''} disabled={committed} aria-label={`${t('im.doctors.choose')} ${g.email}`}
                      aria-invalid={current === null} onChange={(e) => e.target.value && onChoose(g.email, Number(e.target.value))} data-testid={`select-doctor-${g.email}`}>
                      <option value="">{t('im.doctors.choosePlaceholder')}</option>
                      {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    {current === null && <p className="im-field-err">{t('im.doctors.needsChoice')}</p>}
                    {stale > 0 && <p className="im-field-err" role="status" data-testid={`status-stale-${g.email}`}>{t('im.doctors.changedStale', { count: stale })}</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Step 3 ---------------- */
function PatientsStep({ batch, doctorFor, doctorName, onEdit }: { batch: ImportBatch; doctorFor: (e: string) => number | null; doctorName: (id: number | null) => string | null; onEdit: (r: ImportRow) => void }) {
  const { t } = useTranslation();
  const { locale, digitPreference: dp } = useAmalPreferences();
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('all');
  const c = counts(batch, doctorFor);
  const committed = batch.status === 'committed';
  const rows = batch.rows.filter((r) => { const s = rowState(r, doctorFor); return filter === 'all' || (filter === 'open' ? s === 'open' || s === 'stale' : s === 'include' || s === 'skip'); });
  return (
    <div className="im-stack">
      <p className="im-lede">{t('im.patients.lede')}</p>
      <dl className="im-stats" data-testid="stats-patients">
        {([['total', c.total], ['open', c.open], ['approved', c.include], ['skipped', c.skip], ['stale', c.stale], ['autoLinked', c.autoLinked]] as const).map(([k, v]) => (
          <div key={k} className={`im-stat im-stat--${k}`}><dt>{t(`im.patients.${k}`)}</dt><dd data-testid={`count-${k}`}>{formatNumber(v, locale, dp)}</dd></div>
        ))}
      </dl>
      <div className="im-inline">
        <label className="im-label" htmlFor="pf">{t('im.patients.filter')}</label>
        <select id="pf" className="im-input im-input--auto" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} data-testid="select-row-filter">
          {(['all', 'open', 'done'] as const).map((f) => <option key={f} value={f}>{t(`im.patients.filters.${f}`)}</option>)}
        </select>
      </div>
      {batch.rows.length === 0 ? <div data-testid="state-batch-empty"><EmptyState className="amal-empty--compact" title={t('im.patients.empty')} description={t('im.patients.emptyDesc')} /></div> : (
        <div className="im-table-wrap" tabIndex={0}>
          <table className="im-table">
            <thead><tr>
              <th scope="col">{t('im.patients.row')}</th><th scope="col">{t('im.patients.source')}</th><th scope="col">{t('im.patients.when')}</th>
              <th scope="col">{t('im.patients.candidates')}</th><th scope="col">{t('im.patients.decision')}</th><th scope="col"><span className="im-sr">{t('im.patients.review')}</span></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const s = rowState(r, doctorFor);
                const d = r.mapping?.doctorId ?? doctorFor(srcEmail(r));
                return (
                  <tr key={r.id} className={`is-${s}`} data-testid={`row-import-${r.id}`}>
                    <th scope="row" data-label={t('im.patients.row')}><span className="im-mono">#{r.id}</span><small className="im-sub">event <Iso ltr>{String(r.source.event_id ?? '—')}</Iso></small></th>
                    <td data-label={t('im.patients.source')}><Iso testId={`text-source-name-${r.id}`}>{srcName(r) || '—'}</Iso>{d && <small className="im-sub"><Iso>{doctorName(d) ?? `#${d}`}</Iso></small>}</td>
                    <td data-label={t('im.patients.when')}>{r.mapping ? formatInstant(r.mapping.startsAt, locale, dp) : <Iso ltr>{srcStart(r)}</Iso>}
                      {r.errors.length > 0 && <ul className="im-issues">{r.errors.map((e, i) => <li key={i}>{issueText(t, e.code)}</li>)}</ul>}</td>
                    <td data-label={t('im.patients.candidates')}>{r.suggestedPatientIds.length ? <span className="im-tag">{t('im.patients.candidatesCount', { count: r.suggestedPatientIds.length })} · {t('im.common.notVerified')}</span> : <span className="im-muted">{t('im.patients.none')}</span>}</td>
                    <td data-label={t('im.patients.decision')}>
                      <span className={`im-state im-state--${s}`} data-testid={`status-row-${r.id}`}>{t(`im.patients.state.${s}`)}</span>
                      {r.review?.action === 'include' && <small className="im-sub">{r.review.identityAction === 'create' ? t('im.patients.identity.create') : t('im.patients.identity.existing', { method: t(`im.review.methods.${r.review.verificationMethod === 'dob' ? 'dob' : 'phone'}`) })}{r.confirmedPatientId ? ` · #${r.confirmedPatientId}` : ''}</small>}
                      {r.review?.action === 'skip' && r.review.reason && <small className="im-sub"><Iso>{r.review.reason}</Iso></small>}
                    </td>
                    <td>{!committed && <button type="button" className={`bk-btn bk-btn--sm${s === 'open' || s === 'stale' ? ' bk-btn--primary' : ''}`} onClick={() => onEdit(r)} data-testid={`button-review-${r.id}`}
                      aria-label={`${t(s === 'open' ? 'im.patients.review' : s === 'stale' ? 'im.patients.reReview' : 'im.patients.change')} #${r.id}`}>
                      {t(s === 'open' ? 'im.patients.review' : s === 'stale' ? 'im.patients.reReview' : 'im.patients.change')}</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------- Step 4 ---------------- */
function StatusStep({ batch, onEdit }: { batch: ImportBatch; onEdit: (r: ImportRow) => void }) {
  const { t } = useTranslation();
  const sum = statusSummary(batch);
  const openRows = batch.rows.filter((r) => !sum.find((s) => s.source === String(r.source.event_status ?? ''))?.target && r.review?.action !== 'skip');
  return (
    <div className="im-stack">
      <p className="im-lede">{t('im.status.lede')}</p>
      <div className="im-table-wrap" tabIndex={0}>
        <table className="im-table">
          <thead><tr><th scope="col">{t('im.status.source')}</th><th scope="col" aria-hidden="true" /><th scope="col">{t('im.status.target')}</th><th scope="col">{t('im.status.rows')}</th></tr></thead>
          <tbody>
            {sum.map((s) => (
              <tr key={s.source} data-testid={`row-status-${s.source}`}>
                <th scope="row" data-label={t('im.status.source')}><Iso ltr>{s.source || '—'}</Iso></th>
                <td aria-hidden="true"><ChevronRight size={16} className="im-flip" /></td>
                <td data-label={t('im.status.target')}>{s.target ? <span className="im-tag im-tag--ok"><CheckCircle2 size={14} aria-hidden="true" />{t(`im.statusName.${s.target}`)}</span>
                  : <span className={`im-tag ${s.open ? 'im-tag--block' : 'im-tag--ok'}`}>{s.open ? <AlertTriangle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}{t(s.open ? 'im.status.unsupported' : 'im.status.resolved')}</span>}</td>
                <td data-label={t('im.status.rows')}>{s.rows}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {openRows.length > 0 && (
        <Msg tone="warn">{t('im.status.open', { count: openRows.length })}
          <span className="im-row-actions">{openRows.map((r) => <button key={r.id} type="button" className="bk-btn bk-btn--sm" onClick={() => onEdit(r)} data-testid={`button-status-skip-${r.id}`}>{t('im.conflicts.resolve', { id: r.id })}</button>)}</span>
        </Msg>
      )}
    </div>
  );
}

/* ---------------- Step 5 ---------------- */
function ConflictsStep({ batch, onEdit, onRefresh, refreshing }: { batch: ImportBatch; onEdit: (r: ImportRow) => void; onRefresh: () => void; refreshing: boolean }) {
  const { t } = useTranslation();
  const g = groupConflicts(batch.conflicts);
  const open = openConflicts(batch.conflicts).length;
  const row = (id: number) => batch.rows.find((r) => r.id === id);
  const committed = batch.status === 'committed';
  return (
    <div className="im-stack">
      <p className="im-lede">{t('im.conflicts.lede')}</p>
      <div className="im-inline">
        <p className="im-hint" data-testid="text-conflict-counts">{t('im.conflicts.counts', { pairs: batch.totals.intraExportPairs, overlaps: batch.totals.existingOverlaps, coinc: batch.totals.existingCoincidences })}</p>
        <button type="button" className="bk-btn bk-btn--sm" onClick={onRefresh} disabled={refreshing} aria-busy={refreshing} data-testid="button-conflicts-refresh"><RefreshCw size={16} className={refreshing ? 'im-spin' : ''} aria-hidden="true" />{t('im.conflicts.refresh')}</button>
      </div>
      {open > 0 && <Msg tone="warn" testId="status-conflicts-open">{t('im.conflicts.open', { count: open })}</Msg>}
      {(['intra', 'existing', 'policy', 'coincidence'] as const).map((k) => (
        <section key={k} className="im-group" aria-labelledby={`cg-${k}`}>
          <h3 id={`cg-${k}`} className="im-h3">{t(`im.conflicts.${k}`)} <span className="im-count">{g[k].length}</span></h3>
          {g[k].length === 0 ? <p className="im-muted">{t('im.conflicts.none')}</p> : (
            <ul className="im-conflicts">
              {g[k].map((c, i) => (
                <li key={`${c.code}-${c.rowIds.join('-')}-${i}`} className={`im-conflict im-conflict--${conflictSeverity(c)}`} data-testid={`conflict-${k}-${i}`}>
                  <div className="im-conflict__head">
                    <span className={`im-sev im-sev--${conflictSeverity(c)}`}>{conflictSeverity(c) === 'blocking' || conflictSeverity(c) === 'warning' ? <AlertTriangle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}{t(`im.conflicts.sev.${conflictSeverity(c)}`)}</span>
                    <strong>{issueText(t, c.code)}</strong>
                  </div>
                  <ul className="im-conflict__rows">
                    {c.rowIds.map((rid) => { const r = row(rid); return r ? (
                      <li key={rid}>
                        <span className="im-mono">#{rid}</span> <Iso>{srcName(r)}</Iso> · {r.mapping ? <TimeCell iso={r.mapping.startsAt} /> : <Iso ltr>{srcStart(r)}</Iso>}
                        {!committed && (conflictSeverity(c) === 'blocking' || conflictSeverity(c) === 'warning') && <button type="button" className="bk-btn bk-btn--sm" onClick={() => onEdit(r)} data-testid={`button-resolve-${rid}`}>{t('im.conflicts.resolve', { id: rid })}</button>}
                      </li>) : null; })}
                    {c.appointmentId && !isPatientOverlap(c) && <li className="im-muted">{t('im.conflicts.appt', { id: c.appointmentId })}</li>}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
function TimeCell({ iso }: { iso: string }) {
  const { locale, digitPreference: dp } = useAmalPreferences();
  return <time dateTime={iso} data-testid="text-hebron-time">{formatInstant(iso, locale, dp)}</time>;
}

/* ---------------- Step 6 ---------------- */
type CommitUi = { kind: 'idle' } | { kind: 'busy' } | { kind: 'checking' } | { kind: 'uncertain' } | { kind: 'unknown' } | { kind: 'error'; text: string };
function CommitStep({ scope, batch, open, doctorFor, onBatch }: { scope: string; batch: ImportBatch; open: Record<StepId, number>; doctorFor: (e: string) => number | null; onBatch: (b: ImportBatch) => void }) {
  const { t } = useTranslation();
  const { locale, digitPreference: dp } = useAmalPreferences();
  const qc = useQueryClient();
  // An unresolved attempt from earlier (reload/reopen) must be reconciled before any new commit is possible.
  const [ui, setUi] = useState<CommitUi>(() => (readPending(scope, batch.id) && batch.status !== 'committed' ? { kind: 'checking' } : { kind: 'idle' }));
  const [memOnly, setMemOnly] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const inflight = useRef(false);
  const c = counts(batch, doctorFor);
  const committed = batch.status === 'committed';
  const hasPending = !!readPending(scope, batch.id);
  const ready = commitReady(batch, open) && !hasPending;
  const batchIdRef = useRef(batch.id); batchIdRef.current = batch.id;
  const onBatchRef = useRef(onBatch); onBatchRef.current = onBatch;
  const reconcile = async (): Promise<void> => {
    const id = batchIdRef.current;
    setUi({ kind: 'checking' });
    try {
      const fresh = await qc.fetchQuery({ queryKey: getGetImportBatchQueryKey(id), queryFn: () => getImportBatch(id), staleTime: 0 });
      if (fresh.status === 'committed') { writePending(scope, id, null); onBatchRef.current(fresh); setUi({ kind: 'idle' }); return; }
      setUi({ kind: 'uncertain' }); // server reached; not committed; keep the exact pending body
    } catch { setUi({ kind: 'unknown' }); }
  };
  const reconcileRef = useRef(reconcile); reconcileRef.current = reconcile;
  useEffect(() => { if (readPending(scope, batchIdRef.current) && !committed) void reconcileRef.current(); else if (committed) writePending(scope, batchIdRef.current, null); }, [scope, committed]);
  const run = async () => {
    if (inflight.current) return;
    inflight.current = true; setConfirm(false); setUi({ kind: 'busy' });
    // Unresolved pending body is reused exactly, even if the batch version moved since.
    const { body, durable } = commitBody(scope, batch.id, batch.version, newOpId);
    setMemOnly(!durable);
    try {
      const res = await commitImport(batch.id, body);
      writePending(scope, batch.id, null); onBatch(res); setUi({ kind: 'idle' });
    } catch (e) {
      if (isUncertain(e)) await reconcile();
      else {
        const f = failure(e);
        writePending(scope, batch.id, null);
        setUi({ kind: 'error', text: errorText(t, e) });
        if (f.kind === 'stale' || f.kind === 'conflict') void qc.invalidateQueries({ queryKey: getGetImportBatchQueryKey(batch.id) });
      }
    } finally { inflight.current = false; }
  };
  const busy = ui.kind === 'busy' || ui.kind === 'checking';
  const blocked = batch.rows.filter((r) => r.errors.length && r.review?.action !== 'skip').length + c.open + c.stale;
  const sum: [string, number][] = committed
    ? [['rows', batch.totals.sourceRows], ['created', batch.totals.created], ['linked', batch.totals.linked], ['skipped', batch.totals.skipped]]
    : [['rows', batch.rows.length], ['included', c.include], ['reviewed', c.include + c.skip], ['skipped', c.skip], ['blocked', blocked]];
  return (
    <div className="im-stack">
      <p className="im-lede">{t('im.commit.lede')}</p>
      <dl className="im-stats" data-testid="stats-commit">
        {sum.map(([k, v]) => <div key={k} className={`im-stat im-stat--${k}`}><dt>{t(`im.commit.sum.${k}`)}</dt><dd data-testid={`count-commit-${k}`}>{formatNumber(v, locale, dp)}</dd></div>)}
      </dl>
      {committed ? (
        <>
          <Msg tone="ok" testId="status-commit-success">{t('im.commit.success', { created: batch.totals.created, linked: batch.totals.linked, skipped: batch.totals.skipped })}
            {batch.committedAt && <> {t('im.commit.committedAt', { at: formatInstant(batch.committedAt, locale, dp) })}</>}</Msg>
          <ReportDownload batchId={batch.id} />
          <h3 className="im-h3">{t('im.commit.outcome')}</h3>
          <ul className="im-outcomes" data-testid="list-outcomes">
            {batch.rows.map((r) => <li key={r.id}><span className="im-mono">#{r.id}</span> <Iso>{srcName(r)}</Iso> <span className={`im-state im-state--${r.outcome}`}>{t(`im.outcome.${r.outcome}`)}</span></li>)}
          </ul>
        </>
      ) : (
        <>
          {!ready && !hasPending && <Msg tone="warn" testId="status-commit-blocked">{t('im.commit.blocked')}</Msg>}
          {ui.kind === 'checking' && <Msg tone="info" testId="status-commit-checking">{t('im.commit.checking')}</Msg>}
          {ui.kind === 'uncertain' && <Msg tone="warn" testId="status-commit-uncertain">{t('im.commit.uncertain')}</Msg>}
          {ui.kind === 'unknown' && <Msg tone="warn" testId="status-commit-unknown">{t('im.commit.unknown')}</Msg>}
          {memOnly && hasPending && <Msg tone="warn" testId="status-commit-memonly">{t('im.commit.memOnly')}</Msg>}
          {ui.kind === 'error' && <Msg tone="block" testId="status-commit-error">{ui.text}</Msg>}
          <div className="im-row-actions">
            {(ui.kind === 'uncertain' || ui.kind === 'unknown')
              ? <button type="button" className="bk-btn bk-btn--primary" disabled={busy} onClick={() => void run()} data-testid="button-commit-retry">{t('im.commit.retrySame')}</button>
              : <button type="button" className="bk-btn bk-btn--primary" disabled={!ready || busy} aria-busy={busy} onClick={() => setConfirm(true)} data-testid="button-commit">
                {busy && <Loader2 size={18} className="im-spin" aria-hidden="true" />}{busy ? t('im.commit.busy') : t('im.commit.btn')}</button>}
          </div>
          <Modal open={confirm} onOpenChange={setConfirm} title={t('im.commit.btn')} testId="dialog-commit-confirm">
            <p>{t('im.commit.confirm', { count: c.include })}</p>
            <div className="im-foot">
              <button type="button" className="bk-btn" onClick={() => setConfirm(false)} data-testid="button-commit-cancel">{t('im.common.cancel')}</button>
              <button type="button" className="bk-btn bk-btn--primary" disabled={busy} onClick={() => void run()} data-testid="button-commit-confirm">{t('im.commit.btn')}</button>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}

function ReportDownload({ batchId }: { batchId: number }) {
  const { t } = useTranslation();
  const { locale } = useAmalPreferences();
  const [lang, setLang] = useState<'ar' | 'en'>(locale === 'ar' ? 'ar' : 'en');
  const [state, setState] = useState<'idle' | 'busy' | 'fail'>('idle');
  const get = async () => {
    setState('busy');
    try {
      const report = await downloadImportReport(batchId, { locale: lang });
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = `import-${batchId}-${lang}.json`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setState('idle');
    } catch { setState('fail'); }
  };
  return (
    <div className="im-inline">
      <label className="im-label" htmlFor="rl">{t('im.commit.reportLang')}</label>
      <select id="rl" className="im-input im-input--auto" value={lang} onChange={(e) => setLang(e.target.value as 'ar' | 'en')} data-testid="select-report-locale">
        <option value="ar">{t('language.ar')}</option><option value="en">{t('language.en')}</option>
      </select>
      <button type="button" className="bk-btn bk-btn--primary" disabled={state === 'busy'} onClick={() => void get()} data-testid="button-download-report">
        {state === 'busy' ? <Loader2 size={18} className="im-spin" aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}{state === 'busy' ? t('im.commit.reportBusy') : t('im.commit.report')}
      </button>
      {state === 'fail' && <p className="im-field-err" role="alert">{t('im.commit.reportFailed')}</p>}
    </div>
  );
}

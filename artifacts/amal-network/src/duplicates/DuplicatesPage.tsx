import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

/** True while a merge attempt is busy or its outcome unknown: every selection is frozen. */
const LockCtx = createContext<{ locked: boolean; setLocked: (b: boolean) => void }>({ locked: false, setLocked: () => undefined });
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Copy, GitMerge, Loader2, Lock, Search, ShieldCheck, XCircle } from 'lucide-react';
import {
  getGetPatientQueryKey, getListPatientDuplicatesQueryKey, getListPatientsQueryKey, mergePatients, useGetPatient, useListPatientDuplicates, useListPatients, usePreviewPatientMerge,
  type PatientMergeRequest, type PatientDuplicatePair, type PatientMergePreview,
} from '@workspace/api-client-react';
import { useAmalPreferences } from '@workspace/amal-ui';
import type { ShellClinic } from '@/shell/identity';
import { formatDateOnly } from '@/shell/formatting';
import { createOpKeeper } from '@/booking/ops';
import { errorText } from '@/imports/i18n';
import { failure, isUncertain } from '@/imports/model';
import { Iso, Modal, Msg, Skeleton } from '@/imports/ui';
import { diff, pairKey, verdict, type Person } from './model';
import '@/booking/booking.css';
import '@/imports/imports.css';

export function DuplicatesPage({ clinic, title, scope }: { clinic: ShellClinic | null; title: string; scope: string }) {
  const { t } = useTranslation();
  if (!clinic) return (
    <section className="im" data-testid="page-duplicates">
      <h1 id="page-title" tabIndex={-1} className="im-h1"><Copy size={28} aria-hidden="true" />{title}</h1>
      <div className="im-empty"><Lock size={28} aria-hidden="true" /><p>{t('im.common.noClinic')}</p></div>
    </section>
  );
  return <DuplicatesWorkspace key={scope} clinic={clinic} title={title} />;
}

function DuplicatesWorkspace({ clinic, title }: { clinic: ShellClinic; title: string }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'candidates' | 'compare'>('candidates');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [pages, setPages] = useState<PatientDuplicatePair[][]>([]);
  const params = { limit: 25, ...(cursor ? { cursor } : {}) };
  const dupQ = useListPatientDuplicates(params, { query: { queryKey: getListPatientDuplicatesQueryKey(params) } });
  const pairs = useMemo(() => {
    const all = [...pages.flat(), ...(dupQ.data?.items ?? [])];
    const seen = new Set<string>();
    return all.filter((p) => { const k = pairKey(p.source.id, p.target.id); if (seen.has(k)) return false; seen.add(k); return true; });
  }, [pages, dupQ.data]);
  const listed = useMemo(() => new Map(pairs.map((p) => [pairKey(p.source.id, p.target.id), p])), [pairs]);
  const [selected, setSelected] = useState<PatientDuplicatePair | null>(null);
  const [locked, setLocked] = useState(false);
  const lockValue = useMemo(() => ({ locked, setLocked }), [locked]);
  const reset = () => { setPages([]); setCursor(undefined); setSelected(null); };
  const tabs = ['candidates', 'compare'] as const;

  return (
    <LockCtx.Provider value={lockValue}>
    <section className="im" data-testid="page-duplicates" aria-labelledby="page-title">
      <header className="im-head">
        <p className="im-eyebrow">{t('im.dup.eyebrow')} · <Iso>{clinic.name}</Iso></p>
        <h1 id="page-title" tabIndex={-1} className="im-h1"><Copy size={28} aria-hidden="true" />{title}</h1>
        <p className="im-lede">{t('im.dup.lede')}</p>
      </header>
      <div role="tablist" aria-label={t('im.dup.tabsLabel')} className="im-tabs" onKeyDown={(e) => {
        if (locked || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        const next = tab === 'candidates' ? 'compare' : 'candidates'; setTab(next);
        requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus());
      }}>
        {tabs.map((k) => (
          <button key={k} id={`tab-${k}`} role="tab" type="button" aria-selected={tab === k} aria-controls={`panel-${k}`} tabIndex={tab === k ? 0 : -1}
            disabled={locked && tab !== k} className={`im-tab${tab === k ? ' is-on' : ''}`} onClick={() => setTab(k)} data-testid={`tab-${k}`}>{t(`im.dup.tabs.${k}`)}</button>
        ))}
      </div>

      {tab === 'candidates' && (
        <div id="panel-candidates" role="tabpanel" aria-labelledby="tab-candidates" className="im-dup-layout">
          <div className="im-panel">
            {dupQ.isLoading && pairs.length === 0 ? <Skeleton lines={4} label={t('im.common.loading')} />
              : dupQ.isError ? <Msg tone="block" testId="status-dup-error">{errorText(t, dupQ.error)} <button type="button" className="bk-btn bk-btn--sm" onClick={() => void dupQ.refetch()} data-testid="button-dup-retry">{t('im.common.retry')}</button></Msg>
              : pairs.length === 0 ? <div className="im-empty" data-testid="state-dup-empty"><ShieldCheck size={28} aria-hidden="true" /><p>{t('im.dup.empty')}</p></div>
              : (
                <>
                  <p className="im-hint" data-testid="text-pair-count">{t('im.dup.pairs', { count: pairs.length })}</p>
                  <ul className="im-pairs">
                    {pairs.map((p) => {
                      const on = selected && pairKey(selected.source.id, selected.target.id) === pairKey(p.source.id, p.target.id);
                      return (
                        <li key={pairKey(p.source.id, p.target.id)}>
                          <button type="button" className={`im-pair${on ? ' is-on' : ''}`} aria-pressed={!!on} disabled={locked && !on} onClick={() => setSelected(p)} data-testid={`button-pair-${p.source.id}-${p.target.id}`}
                            aria-label={t('im.dup.pairLabel', { a: `#${p.source.id}`, b: `#${p.target.id}` })}>
                            <span><Iso>{p.source.name}</Iso> <small className="im-mono">#{p.source.id}</small></span>
                            <span><Iso>{p.target.name}</Iso> <small className="im-mono">#{p.target.id}</small></span>
                            <span className="im-chip">{on ? t('im.dup.selected') : t('im.dup.open')}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {dupQ.data?.nextCursor && <button type="button" className="bk-btn bk-btn--sm" onClick={() => { setPages([...pages, dupQ.data!.items]); setCursor(dupQ.data!.nextCursor!); }} data-testid="button-dup-more">{t('im.dup.loadMore')}</button>}
                </>
              )}
          </div>
          <div className="im-panel">
            {selected ? <Comparison key={pairKey(selected.source.id, selected.target.id)} aId={selected.source.id} bId={selected.target.id} pair={selected} onMerged={reset} />
              : <p className="im-muted">{t('im.dup.compareHint')}</p>}
          </div>
        </div>
      )}

      {tab === 'compare' && (
        <div id="panel-compare" role="tabpanel" aria-labelledby="tab-compare" className="im-panel">
          <ArbitraryCompare listed={listed} onMerged={reset} />
        </div>
      )}
    </section>
    </LockCtx.Provider>
  );
}

function ArbitraryCompare({ listed, onMerged }: { listed: Map<string, PatientDuplicatePair>; onMerged: () => void }) {
  const { t } = useTranslation();
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  return (
    <div className="im-stack">
      <p className="im-hint">{t('im.dup.compareHint')}</p>
      <div className="im-grid2">
        <PatientPicker label={t('im.dup.pickA')} value={a} onChange={setA} testId="a" />
        <PatientPicker label={t('im.dup.pickB')} value={b} onChange={setB} testId="b" />
      </div>
      {a && b && <Comparison key={`${a}-${b}`} aId={a} bId={b} pair={listed.get(pairKey(a, b)) ?? null} onMerged={onMerged} />}
    </div>
  );
}

function PatientPicker({ label, value, onChange, testId }: { label: string; value: number | null; onChange: (id: number | null) => void; testId: string }) {
  const { t } = useTranslation();
  const { locked } = useContext(LockCtx);
  const [q, setQ] = useState('');
  const params = { q: q.trim(), limit: 10 };
  const res = useListPatients(params, { query: { enabled: q.trim().length >= 2 && !value, queryKey: getListPatientsQueryKey(params) } });
  const id = `pick-${testId}`;
  if (value) return (
    <div><span className="im-label">{label}</span>
      <div className="im-inline"><span className="im-chip im-mono" data-testid={`text-picked-${testId}`}>#{value}</span>
        <button type="button" className="bk-btn bk-btn--sm" disabled={locked} onClick={() => onChange(null)} data-testid={`button-clear-${testId}`}>{t('im.dup.clear')}</button></div>
    </div>
  );
  return (
    <div>
      <label className="im-label" htmlFor={id}>{label}</label>
      <div className="im-search"><Search size={16} aria-hidden="true" /><input id={id} className="im-input" value={q} placeholder={t('im.dup.searchPh')} onChange={(e) => setQ(e.target.value)} data-testid={`input-pick-${testId}`} /></div>
      {q.trim().length >= 2 && (res.isLoading ? <p className="im-hint">{t('im.common.loading')}</p> : res.isError ? <p className="im-field-err">{errorText(t, res.error)}</p>
        : (res.data?.items.length ?? 0) === 0 ? <p className="im-hint">{t('im.review.noResults')}</p> : (
          <ul className="im-cands">{res.data!.items.map((p) => (
            <li key={p.id}><button type="button" className="im-cand" onClick={() => onChange(p.id)} data-testid={`button-pick-${testId}-${p.id}`}>
              <span className="im-cand__main"><Iso>{p.name}</Iso><small className="im-mono">#{p.id}</small></span><span className="im-chip">{t('im.review.pick')}</span>
            </button></li>))}</ul>
        ))}
    </div>
  );
}

/** Side-by-side identity comparison from authorized patient detail; merge only for server-listed pairs. */
function Comparison({ aId, bId, pair, onMerged }: { aId: number; bId: number; pair: PatientDuplicatePair | null; onMerged: () => void }) {
  const { t } = useTranslation();
  const { locale, digitPreference: dp } = useAmalPreferences();
  const aQ = useGetPatient(aId, { query: { queryKey: getGetPatientQueryKey(aId) } });
  const bQ = useGetPatient(bId, { query: { queryKey: getGetPatientQueryKey(bId) } });
  if (aQ.isLoading || bQ.isLoading) return <Skeleton lines={4} label={t('im.common.loading')} />;
  if (aQ.isError || bQ.isError || !aQ.data || !bQ.data) return <Msg tone="block" testId="status-compare-error">{t('im.dup.detailFailed')} {errorText(t, aQ.error ?? bQ.error)}</Msg>;
  const A: Person = aQ.data, B: Person = bQ.data;
  const d = diff(A, B);
  const v = verdict(A, B, !!pair);
  const dob = (s: string) => { try { return formatDateOnly(s, locale, dp); } catch { return s; } };
  const rows: { k: 'name' | 'dob' | 'phone'; a: string; b: string; ltr?: boolean; differs: boolean }[] = [
    { k: 'name', a: A.name, b: B.name, differs: d.name },
    { k: 'dob', a: dob(A.dateOfBirth), b: dob(B.dateOfBirth), differs: d.dob },
    { k: 'phone', a: A.phone, b: B.phone, ltr: true, differs: d.phone },
  ];
  return (
    <div className="im-stack" data-testid={`comparison-${aId}-${bId}`}>
      <div className={`im-verdict im-verdict--${v.kind}`} role="status" data-testid="status-verdict">
        {v.kind === 'notMatch' ? <XCircle size={22} aria-hidden="true" /> : v.kind === 'eligible' ? <CheckCircle2 size={22} aria-hidden="true" /> : <AlertTriangle size={22} aria-hidden="true" />}
        <div>
          <strong data-testid="text-verdict">{t(`im.dup.verdict.${v.kind}`)}</strong>
          {v.kind === 'notMatch' && <ul className="im-reasons">{v.reasons.map((r) => <li key={r} data-testid={`text-reason-${r}`}>{t(`im.dup.reasons.${r}`)}</li>)}</ul>}
          {v.kind === 'unlisted' && <p className="im-hint">{t('im.dup.unlistedHint')}</p>}
        </div>
      </div>
      <div className="im-table-wrap">
        <table className="im-table im-compare">
          <thead><tr><th scope="col">{t('im.dup.field')}</th><th scope="col">{t('im.dup.id')} #{A.id}</th><th scope="col">{t('im.dup.id')} #{B.id}</th><th scope="col"><span className="im-sr">{t('im.dup.differs')}</span></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.k} className={r.differs ? 'is-diff' : ''} data-testid={`row-compare-${r.k}`}>
                <th scope="row">{t(`im.dup.${r.k}`)}</th>
                <td data-label={`#${A.id}`}><Iso ltr={r.ltr}>{r.a}</Iso></td>
                <td data-label={`#${B.id}`}><Iso ltr={r.ltr}>{r.b}</Iso></td>
                <td>{r.differs ? <span className="im-tag im-tag--block"><XCircle size={14} aria-hidden="true" />{t('im.dup.differs')}</span> : <span className="im-tag im-tag--ok"><CheckCircle2 size={14} aria-hidden="true" />{t('im.dup.same')}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {v.kind === 'eligible' && pair && <MergeFlow a={A} b={B} onMerged={onMerged} />}
    </div>
  );
}

type MergeRequest = PatientMergeRequest;
type MergeUi = { kind: 'idle' } | { kind: 'busy' } | { kind: 'uncertain' } | { kind: 'error'; text: string } | { kind: 'done'; source: number; target: number };
function MergeFlow({ a, b, onMerged }: { a: Person; b: Person; onMerged: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [targetId, setTargetId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [ui, setUi] = useState<MergeUi>({ kind: 'idle' });
  const [preview, setPreview] = useState<PatientMergePreview | null>(null);
  const previewM = usePreviewPatientMerge();
  const ops = useRef(createOpKeeper());
  /** Exact request of the last attempt whose outcome is unknown; retried byte-for-byte, never recomputed. */
  const frozen = useRef<MergeRequest | null>(null);
  const inflight = useRef(false);
  const source = targetId === a.id ? b : targetId === b.id ? a : null;
  const target = targetId === a.id ? a : targetId === b.id ? b : null;
  const doPreview = (tid: number) => {
    if (frozen.current) return;
    const sid = tid === a.id ? b.id : a.id;
    setPreview(null);
    previewM.mutate({ data: { sourceId: sid, targetId: tid } }, { onSuccess: setPreview });
  };
  const refreshLists = () => {
    void qc.invalidateQueries({ queryKey: getListPatientDuplicatesQueryKey().slice(0, 1) });
    void qc.invalidateQueries({ queryKey: getGetPatientQueryKey(a.id) });
    void qc.invalidateQueries({ queryKey: getGetPatientQueryKey(b.id) });
    void qc.invalidateQueries({ queryKey: getListPatientsQueryKey().slice(0, 1) });
  };
  const send = async (req: MergeRequest) => {
    if (inflight.current) return;
    inflight.current = true; setConfirm(false); setUi({ kind: 'busy' });
    frozen.current = req;
    try {
      const res = await mergePatients(req);
      frozen.current = null; ops.current.reset(); setUi({ kind: 'done', source: res.sourceId, target: res.targetId }); refreshLists();
    } catch (e) {
      if (isUncertain(e)) { setUi({ kind: 'uncertain' }); return; } // keep frozen request
      const f = failure(e);
      frozen.current = null; ops.current.reset();
      if (f.kind === 'notFound') {
        setUi({ kind: 'error', text: t('im.dup.inaccessible') }); setPreview(null); setTargetId(null); refreshLists();
      } else if (f.kind === 'stale' || f.kind === 'conflict') {
        setUi({ kind: 'error', text: t('im.dup.staleSelection') }); refreshLists(); doPreview(req.targetId);
      } else setUi({ kind: 'error', text: errorText(t, e) });
    } finally { inflight.current = false; }
  };
  const run = () => {
    if (frozen.current) { void send(frozen.current); return; }
    if (!preview || !preview.canMerge) return;
    const payload = { sourceId: preview.sourceId, targetId: preview.targetId, sourceVersion: preview.sourceVersion, targetVersion: preview.targetVersion, confirmed: true as const, reason: reason.trim() };
    void send({ ...payload, clientOpId: ops.current.idFor(payload) });
  };
  const locked = ui.kind === 'busy' || ui.kind === 'uncertain';
  const { setLocked } = useContext(LockCtx);
  useEffect(() => { setLocked(locked); }, [locked, setLocked]);
  useEffect(() => () => setLocked(false), [setLocked]);
  if (ui.kind === 'done') return (
    <Msg tone="ok" testId="status-merge-success">{t('im.dup.success', { source: ui.source, target: ui.target })}
      <span className="im-row-actions"><button type="button" className="bk-btn bk-btn--sm" onClick={onMerged} data-testid="button-merge-done">{t('im.common.close')}</button></span></Msg>
  );
  const busy = locked;
  return (
    <section className="im-merge" aria-labelledby="merge-h">
      <h3 id="merge-h" className="im-h3"><GitMerge size={18} aria-hidden="true" /> {t('im.dup.survivor')}</h3>
      <div className="im-seg" role="radiogroup" aria-labelledby="merge-h">
        {[a, b].map((p) => (
          <label key={p.id} className={`im-seg__opt${targetId === p.id ? ' is-on' : ''}`}>
            <input type="radio" name="survivor" checked={targetId === p.id} disabled={locked} onChange={() => { setUi({ kind: 'idle' }); setTargetId(p.id); doPreview(p.id); }} data-testid={`radio-survivor-${p.id}`} />
            {t('im.dup.keep', { id: p.id })}
          </label>
        ))}
      </div>
      {source && <p className="im-hint">{t('im.dup.source', { id: source.id })}</p>}
      {previewM.isPending && <Skeleton lines={2} label={t('im.dup.previewBusy')} />}
      {previewM.isError && <Msg tone="block" testId="status-preview-error">{errorText(t, previewM.error)} <button type="button" className="bk-btn bk-btn--sm" disabled={locked} onClick={() => targetId && doPreview(targetId)}>{t('im.common.retry')}</button></Msg>}
      {preview && target && source && (
        <div className="im-impact" data-testid="panel-merge-impact">
          <h4 className="im-h3">{t('im.dup.impact')}</h4>
          <ul>
            <li>{t('im.dup.apptCounts', { source: preview.references.appointments.sourceCount, target: preview.references.appointments.targetCount })} <small className="im-muted">{t('im.dup.apptScope')}</small></li>
            <li>{t('im.dup.clinical')}</li>
            <li>{t('im.dup.audit')}</li>
          </ul>
          {preview.canMerge ? <Msg tone="ok">{t('im.dup.canMerge')}</Msg> : (
            <Msg tone="block" testId="status-merge-blocked">{t('im.dup.cannotMerge')}<ul className="im-reasons">{preview.blockers.map((x) => <li key={x}>{t(`im.err.${x}`)}</li>)}</ul></Msg>
          )}
          {preview.canMerge && (
            <>
              <label className="im-label" htmlFor="mr">{t('im.dup.reason')} <span className="im-req">({t('im.common.required')})</span></label>
              <textarea id="mr" className="im-input im-textarea" maxLength={1000} value={reason} readOnly={locked} aria-readonly={locked} onChange={(e) => setReason(e.target.value)} aria-invalid={reasonErr} aria-describedby="mr-hint" data-testid="input-merge-reason" />
              <p className="im-hint" id="mr-hint">{t('im.dup.reasonHint')}</p>
              {reasonErr && <p className="im-field-err" role="alert">{t('im.review.errReason')}</p>}
              {ui.kind === 'uncertain' && <Msg tone="warn" testId="status-merge-uncertain">{t('im.dup.uncertain')} {t('im.dup.frozen')}</Msg>}
              {ui.kind === 'error' && <Msg tone="block" testId="status-merge-error">{ui.text}</Msg>}
              <div className="im-row-actions">
                {ui.kind === 'uncertain'
                  ? <button type="button" className="bk-btn bk-btn--primary" onClick={run} data-testid="button-merge-retry">{t('im.dup.retrySame')}</button>
                  : <button type="button" className="bk-btn bk-btn--primary" disabled={busy} onClick={() => { if (!reason.trim()) { setReasonErr(true); return; } setReasonErr(false); setConfirm(true); }} data-testid="button-merge-review">
                    {busy && <Loader2 size={18} className="im-spin" aria-hidden="true" />}{busy ? t('im.dup.busy') : t('im.dup.review')}</button>}
              </div>
            </>
          )}
        </div>
      )}
      <Modal open={confirm} onOpenChange={setConfirm} title={t('im.dup.confirmTitle')} testId="dialog-merge-confirm">
        {target && source && <p>{t('im.dup.confirmBody', { target: target.id, targetName: '\u2068' + target.name + '\u2069', source: source.id, sourceName: '\u2068' + source.name + '\u2069' })}</p>}
        <div className="im-foot">
          <button type="button" className="bk-btn" onClick={() => setConfirm(false)} data-testid="button-merge-cancel">{t('im.common.cancel')}</button>
          <button type="button" className="bk-btn bk-btn--primary" disabled={busy} onClick={run} data-testid="button-merge-confirm">{t('im.dup.confirmBtn')}</button>
        </div>
      </Modal>
    </section>
  );
}

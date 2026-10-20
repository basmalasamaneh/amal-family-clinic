import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueries } from '@tanstack/react-query';
import { Loader2, Search, ShieldQuestion } from 'lucide-react';
import { getGetPatientQueryOptions, getListPatientsQueryKey, useListPatients, useMapImport, type ImportBatch, type ImportRow } from '@workspace/api-client-react';
import { useAmalPreferences } from '@workspace/amal-ui';
import { formatInstant } from '@/shell/formatting';
import {
  BLOCKING_SOURCE_ISSUES, buildReview, failure, hasIssue, nameConfidence, rowAssociations, rowWarnings, srcEnd, srcName, srcStart, srcStatus, validate,
  type Draft, type DraftError, type Extras,
} from './model';
import { errorText, issueText } from './i18n';
import { Iso, Modal, Msg } from './ui';

export interface Memory { draft: Draft; extras: Extras }
const EMPTY_EXTRAS: Extras = { startLocal: '', endLocal: '', associateAppointmentId: null, overrideReason: '' };

/** Draft from in-memory session (incl. typed verification) or, after reopen, from the saved server review. Verification values are never persisted. */
export function initialMemory(row: ImportRow, mem: Memory | undefined): Memory {
  if (mem) return mem;
  const r = row.review;
  const extras: Extras = { ...EMPTY_EXTRAS, associateAppointmentId: r?.associateAppointmentId ?? null, overrideReason: r?.overrideReason ?? '' };
  if (r?.action === 'skip') return { draft: { kind: 'skip', reason: r.reason ?? '' }, extras };
  if (r?.identityAction === 'existing') return { draft: { kind: 'existing', patientId: row.confirmedPatientId, method: r.verificationMethod === 'dob' ? 'dob' : 'phone', value: '' }, extras };
  if (r?.identityAction === 'create' || r?.verificationMethod === 'new') return { draft: { kind: 'create', name: srcName(row), phone: '', dob: '', guardianName: '', guardianRelation: '' }, extras };
  return { draft: { kind: 'existing', patientId: null, method: 'phone', value: '' }, extras };
}

const mask = (phone: string) => (phone.length > 2 ? '•'.repeat(Math.max(phone.length - 2, 0)) + phone.slice(-2) : '••');

export function RowDialog({ batch, row, doctorId, doctorName, memory, focusSchedule, onClose, onSaved, onStale }: {
  batch: ImportBatch; row: ImportRow; doctorId: number | null; doctorName: string | null; memory: Memory | undefined; focusSchedule?: boolean;
  onClose: () => void; onSaved: (b: ImportBatch, m: Memory) => void; onStale: () => void;
}) {
  const { t } = useTranslation();
  const { locale, digitPreference: dp } = useAmalPreferences();
  const init = useMemo(() => initialMemory(row, memory), [row, memory]);
  const [draft, setDraft] = useState<Draft>(init.draft);
  const [extras, setExtras] = useState<Extras>(init.extras);
  const [errors, setErrors] = useState<DraftError[]>([]);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const map = useMapImport();
  const includeBlocked = hasIssue(row, BLOCKING_SOURCE_ISSUES);
  const blockReason = row.errors.filter((e) => BLOCKING_SOURCE_ISSUES.includes(e.code)).map((e) => issueText(t, e.code)).join(' ');
  const kind = includeBlocked ? 'skip' : draft.kind;

  const search = useListPatients({ q: q.trim(), limit: 10 }, { query: { enabled: q.trim().length >= 2 && kind === 'existing', queryKey: getListPatientsQueryKey({ q: q.trim(), limit: 10 }) } });
  const ids = useMemo(() => [...new Set([...row.suggestedPatientIds, ...(draft.kind === 'existing' && draft.patientId ? [draft.patientId] : [])])], [row.suggestedPatientIds, draft]);
  const details = useQueries({ queries: ids.map((id) => ({ ...getGetPatientQueryOptions(id), staleTime: 30_000 })) });
  const candidates = ids.map((id, i) => ({ id, data: details[i]?.data, loading: details[i]?.isLoading, error: details[i]?.isError, suggested: row.suggestedPatientIds.includes(id) }));
  const searchHits = (search.data?.items ?? []).filter((p) => !ids.includes(p.id));
  const warnings = rowWarnings(batch, row.id);
  const assoc = rowAssociations(batch, row.id);
  const err = (k: DraftError) => errors.includes(k) ? <p className="im-field-err" id={`err-${k}`} data-testid={`error-${k}`}>{t(`im.review.${k}`)}</p> : null;
  const setKind = (k: Draft['kind']) => setDraft(k === 'skip' ? { kind: 'skip', reason: draft.kind === 'skip' ? draft.reason : '' }
    : k === 'existing' ? { kind: 'existing', patientId: draft.kind === 'existing' ? draft.patientId : null, method: draft.kind === 'existing' ? draft.method : 'phone', value: '' }
    : { kind: 'create', name: srcName(row), phone: '', dob: '', guardianName: '', guardianRelation: '' });

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (map.isPending) return;
    const d: Draft = includeBlocked && draft.kind !== 'skip' ? { kind: 'skip', reason: '' } : draft;
    const es = validate(d, extras, doctorId);
    setErrors(es); setServerErr(null);
    if (es.length) return;
    map.mutate({ id: batch.id, data: { expectedVersion: batch.version, rows: [buildReview(row.id, d, extras, doctorId)] } }, {
      onSuccess: (b) => onSaved(b, { draft: d, extras }),
      onError: (e) => { setServerErr(errorText(t, e)); if (failure(e).kind === 'stale') onStale(); },
    });
  };

  return (
    <Modal open onOpenChange={(o) => { if (!o && !map.isPending) onClose(); }} title={t('im.review.title', { id: row.id })} wide testId="dialog-row-review">
      <form onSubmit={submit} noValidate className="im-form">
        <section className="im-source" aria-labelledby="src-h">
          <h3 id="src-h" className="im-h3">{t('im.review.sourceTitle')}</h3>
          <dl className="im-dl">
            <dt>{t('im.patients.source')}</dt><dd><Iso testId="text-dialog-source-name">{srcName(row)}</Iso></dd>
            <dt>{t('im.patients.when')}</dt><dd><Iso ltr>{srcStart(row)} → {srcEnd(row)}</Iso></dd>
            <dt>{t('im.status.source')}</dt><dd><Iso ltr>{srcStatus(row)}</Iso></dd>
            {row.mapping && <><dt>{t('im.status.target')}</dt><dd>{t(`im.statusName.${row.mapping.status}`)} · {formatInstant(row.mapping.startsAt, locale, dp)}</dd></>}
          </dl>
          <p className="im-hint">{doctorId ? t('im.review.doctorLine', { doctor: '\u2068' + (doctorName ?? `#${doctorId}`) + '\u2069' }) : <span className="im-field-err">{t('im.review.doctorMissing')}</span>}</p>
          {row.errors.length > 0 && <ul className="im-issues">{row.errors.map((e, i) => <li key={i}>{issueText(t, e.code)}</li>)}</ul>}
        </section>

        {includeBlocked && <Msg tone="warn">{t('im.review.unsupportedOnly', { reason: blockReason })}</Msg>}

        <fieldset className="im-fieldset">
          <legend className="im-h3">{t('im.review.choice')}</legend>
          <div className="im-seg" role="radiogroup">
            {(['existing', 'create', 'skip'] as const).map((k) => (
              <label key={k} className={`im-seg__opt${kind === k ? ' is-on' : ''}${includeBlocked && k !== 'skip' ? ' is-off' : ''}`}>
                <input type="radio" name="kind" value={k} checked={kind === k} disabled={includeBlocked && k !== 'skip'} onChange={() => setKind(k)} data-testid={`radio-kind-${k}`} />
                {t(`im.review.choose.${k}`)}
              </label>
            ))}
          </div>
        </fieldset>

        {kind === 'existing' && draft.kind === 'existing' && (
          <div className="im-stack">
            <fieldset className="im-fieldset">
              <legend className="im-h3">{t('im.review.candidates')}</legend>
              <p className="im-hint"><ShieldQuestion size={16} aria-hidden="true" /> {t('im.confidence.why')}</p>
              {candidates.length === 0 && <p className="im-hint">{t('im.patients.none')}</p>}
              <ul className="im-cands">
                {candidates.map((c) => {
                  const conf = c.data ? nameConfidence(srcName(row), c.data.name) : null;
                  return (
                    <li key={c.id}>
                      <label className={`im-cand${draft.patientId === c.id ? ' is-on' : ''}`}>
                        <input type="radio" name="cand" checked={draft.patientId === c.id} onChange={() => setDraft({ ...draft, patientId: c.id, value: '' })} data-testid={`radio-candidate-${c.id}`} />
                        <span className="im-cand__main">
                          {c.loading ? t('im.common.loading') : c.error || !c.data ? t('im.dup.detailFailed') : <Iso>{c.data.name}</Iso>}
                          <small>#{c.id}{c.data ? <> · {c.data.dateOfBirth.slice(0, 4)} · <Iso ltr>{mask(c.data.phone)}</Iso></> : null}</small>
                        </span>
                        {conf && c.suggested && <span className={`im-conf im-conf--${conf}`} data-testid={`badge-confidence-${c.id}`}>{t(`im.confidence.${conf}`)} · {t('im.common.notVerified')}</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
              <label className="im-label" htmlFor="cand-search">{t('im.review.search')}</label>
              <div className="im-search"><Search size={16} aria-hidden="true" /><input id="cand-search" className="im-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('im.review.searchHint')} data-testid="input-candidate-search" /></div>
              {q.trim().length >= 2 && (search.isLoading ? <p className="im-hint">{t('im.common.loading')}</p> : search.isError ? <p className="im-field-err">{errorText(t, search.error)}</p> : searchHits.length === 0 ? <p className="im-hint">{t('im.review.noResults')}</p> : (
                <ul className="im-cands">{searchHits.map((p) => (
                  <li key={p.id}><button type="button" className="im-cand" onClick={() => setDraft({ ...draft, patientId: p.id, value: '' })} data-testid={`button-pick-${p.id}`}>
                    <span className="im-cand__main"><Iso>{p.name}</Iso><small>#{p.id} · {p.dateOfBirth.slice(0, 4)}</small></span><span className="im-chip">{t('im.review.pick')}</span>
                  </button></li>
                ))}</ul>
              ))}
              {err('errPick')}
            </fieldset>
            <fieldset className="im-fieldset">
              <legend className="im-h3">{t('im.review.method')}</legend>
              <div className="im-seg" role="radiogroup">
                {(['phone', 'dob'] as const).map((m) => (
                  <label key={m} className={`im-seg__opt${draft.method === m ? ' is-on' : ''}`}>
                    <input type="radio" name="method" checked={draft.method === m} onChange={() => setDraft({ ...draft, method: m, value: '' })} data-testid={`radio-method-${m}`} />{t(`im.review.methods.${m}`)}
                  </label>
                ))}
              </div>
              <label className="im-label" htmlFor="verify">{t(draft.method === 'phone' ? 'im.review.verifyPhone' : 'im.review.verifyDob')}</label>
              <input id="verify" className="im-input" dir="ltr" type={draft.method === 'dob' ? 'date' : 'tel'} autoComplete="off" value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })} aria-invalid={errors.includes('errVerify')} aria-describedby="verify-hint" data-testid="input-verify" />
              <p className="im-hint" id="verify-hint">{t('im.review.verifyHint')}</p>
              {err('errVerify')}
            </fieldset>
          </div>
        )}

        {kind === 'create' && draft.kind === 'create' && (
          <div className="im-grid2">
            <div><label className="im-label" htmlFor="nn">{t('im.review.newName')} <span className="im-req">({t('im.common.required')})</span></label>
              <input id="nn" className="im-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-invalid={errors.includes('errName')} data-testid="input-new-name" />{err('errName')}</div>
            <div><label className="im-label" htmlFor="np">{t('im.review.newPhone')} <span className="im-req">({t('im.common.required')})</span></label>
              <input id="np" className="im-input" dir="ltr" type="tel" required value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} aria-invalid={errors.includes('errPhone')} data-testid="input-new-phone" />{err('errPhone')}</div>
            <div><label className="im-label" htmlFor="nd">{t('im.review.newDob')} <span className="im-req">({t('im.common.required')})</span></label>
              <input id="nd" className="im-input" dir="ltr" type="date" required value={draft.dob} onChange={(e) => setDraft({ ...draft, dob: e.target.value })} aria-invalid={errors.includes('errDob')} aria-describedby="nd-hint" data-testid="input-new-dob" />
              <p className="im-hint" id="nd-hint">{t('im.review.newDobHint')}</p>{err('errDob')}</div>
            <fieldset className="im-fieldset im-span2">
              <legend className="im-label">{t('im.review.guardian')}</legend>
              <div className="im-grid2">
                <div><label className="im-label" htmlFor="gn">{t('im.review.guardianName')}</label><input id="gn" className="im-input" value={draft.guardianName} onChange={(e) => setDraft({ ...draft, guardianName: e.target.value })} data-testid="input-guardian-name" /></div>
                <div><label className="im-label" htmlFor="gr">{t('im.review.guardianRelation')}</label><input id="gr" className="im-input" value={draft.guardianRelation} onChange={(e) => setDraft({ ...draft, guardianRelation: e.target.value })} data-testid="input-guardian-relation" /></div>
              </div>
            </fieldset>
          </div>
        )}

        {kind === 'skip' && (
          <div>
            <label className="im-label" htmlFor="sr">{t('im.review.skipReason')} <span className="im-req">({t('im.common.required')})</span></label>
            <textarea id="sr" className="im-input im-textarea" value={draft.kind === 'skip' ? draft.reason : ''} maxLength={1000}
              onChange={(e) => setDraft({ kind: 'skip', reason: e.target.value })} aria-invalid={errors.includes('errReason')} aria-describedby="sr-hint" data-testid="input-skip-reason" />
            <p className="im-hint" id="sr-hint">{t('im.review.skipHint')}</p>{err('errReason')}
          </div>
        )}

        {kind !== 'skip' && (
          <details className="im-details" open={focusSchedule || !!extras.startLocal || !!extras.associateAppointmentId || !!extras.overrideReason}>
            <summary>{t('im.review.schedule')}</summary>
            <p className="im-hint">{t('im.review.scheduleHint')}</p>
            <div className="im-grid2">
              <div><label className="im-label" htmlFor="sl">{t('im.review.startLocal')}</label><input id="sl" className="im-input" dir="ltr" type="datetime-local" step={1} value={extras.startLocal} onChange={(e) => setExtras({ ...extras, startLocal: e.target.value })} data-testid="input-start-local" /></div>
              <div><label className="im-label" htmlFor="el">{t('im.review.endLocal')}</label><input id="el" className="im-input" dir="ltr" type="datetime-local" step={1} value={extras.endLocal} onChange={(e) => setExtras({ ...extras, endLocal: e.target.value })} data-testid="input-end-local" /></div>
            </div>
            {err('errTimes')}
            {assoc.length > 0 && kind === 'existing' && (
              <div><label className="im-label" htmlFor="as">{t('im.review.associate')}</label>
                <select id="as" className="im-input" value={extras.associateAppointmentId ?? ''} onChange={(e) => setExtras({ ...extras, associateAppointmentId: e.target.value ? Number(e.target.value) : null })} data-testid="select-associate">
                  <option value="">{t('im.review.associateNone')}</option>
                  {assoc.map((id) => <option key={id} value={id}>{t('im.review.associateOpt', { id })}</option>)}
                </select><p className="im-hint">{t('im.review.associateHint')}</p></div>
            )}
            {warnings.some((w) => w.code === 'patient-overlap' || w.code === 'same-day-other-clinic') && (
              <div><label className="im-label" htmlFor="ov">{t('im.review.override')}</label>
                <textarea id="ov" className="im-input im-textarea" maxLength={1000} value={extras.overrideReason} onChange={(e) => setExtras({ ...extras, overrideReason: e.target.value })} data-testid="input-override-reason" />
                <p className="im-hint">{t('im.review.overrideHint')}</p></div>
            )}
          </details>
        )}

        {serverErr && <Msg tone="block" testId="status-row-error">{serverErr}</Msg>}
        <div className="im-foot">
          <button type="button" className="bk-btn" onClick={onClose} disabled={map.isPending} data-testid="button-row-cancel">{t('im.common.cancel')}</button>
          <button type="submit" className="bk-btn bk-btn--primary" disabled={map.isPending} aria-busy={map.isPending} data-testid="button-row-save">
            {map.isPending && <Loader2 size={18} className="im-spin" aria-hidden="true" />}{t('im.common.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

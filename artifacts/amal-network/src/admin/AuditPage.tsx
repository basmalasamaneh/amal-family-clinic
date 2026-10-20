import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { fromZonedTime } from 'date-fns-tz';
import { RotateCcw } from 'lucide-react';
import { Button, TextField } from '@workspace/amal-ui';
import { AdminAuditAction, getListAdminAuditQueryKey, useListAdminAudit, type AdminAuditEvent, type ListAdminAuditParams } from '@workspace/api-client-react';
import { isAuthFailure } from '@/auth/errors';
import { classify, isAccessFailure, Empty, ErrorSummary, LoadError, PageHead, SelectField, Skeleton, clinicLabel, useAllClinics, useInstant } from './common';
import './admin.css';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACTIONS = Object.values(AdminAuditAction);
const actionKey = (a: string) => a.replace(/\./g, '_');
/** Hebron calendar day → UTC instant; `to` is the exclusive start of the following day. */
function dayStart(date: string, plus = 0): string {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + plus);
  return fromZonedTime(`${d.toISOString().slice(0, 10)}T00:00:00`, 'Asia/Hebron').toISOString();
}
interface Filters { clinicId: string; actorId: string; action: string; outcome: string; from: string; to: string }
const EMPTY: Filters = { clinicId: '', actorId: '', action: '', outcome: '', from: '', to: '' };

export function AuditPage({ title }: { title: string }) {
  const { t } = useTranslation();
  const fmt = useInstant();
  const clinics = useAllClinics();
  const clinicMap = useMemo(() => new Map((clinics.data ?? []).map(c => [c.id, c.name])), [clinics.data]);
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [stack, setStack] = useState<number[]>([]);
  const [errors, setErrors] = useState<{ id: string; text: string }[]>([]);
  const beforeId = stack[stack.length - 1];
  const params: ListAdminAuditParams = {
    limit: 25,
    ...(beforeId ? { beforeId } : {}),
    ...(applied.clinicId ? { clinicId: Number(applied.clinicId) } : {}),
    ...(applied.actorId ? { actorId: Number(applied.actorId) } : {}),
    ...(applied.action ? { action: applied.action as AdminAuditAction } : {}),
    ...(applied.outcome ? { outcome: applied.outcome as 'success' | 'denied' } : {}),
    ...(applied.from ? { from: dayStart(applied.from) } : {}),
    ...(applied.to ? { to: dayStart(applied.to, 1) } : {}),
  };
  const q = useListAdminAudit(params, { query: { queryKey: getListAdminAuditQueryKey(params), retry: (n, e) => !isAuthFailure(e) && n < 1, placeholderData: (p) => p } });

  const apply = (e: FormEvent) => {
    e.preventDefault();
    const errs: { id: string; text: string }[] = [];
    if (draft.actorId && !/^[1-9]\d{0,9}$/.test(draft.actorId)) errs.push({ id: 'audit-actor', text: t('adm.audit.idInvalid') });
    if (draft.from && draft.to && DATE_RE.test(draft.from) && DATE_RE.test(draft.to) && draft.from > draft.to) errs.push({ id: 'audit-from', text: t('adm.audit.rangeInvalid') });
    setErrors(errs);
    if (errs.length) return;
    setApplied({ ...draft, from: DATE_RE.test(draft.from) ? draft.from : '', to: DATE_RE.test(draft.to) ? draft.to : '' });
    setStack([]);
  };
  const target = (ev: AdminAuditEvent) => ev.targetType && ev.targetId !== null ? t(`adm.audit.targets.${ev.targetType}`, { id: ev.targetId }) : t('adm.audit.targets.none');

  return (
    <section className="adm" data-testid="page-audit" aria-busy={q.isFetching}>
      <PageHead id="audit" title={title} lede={t('adm.audit.lede')} actions={
        <Button variant="secondary" startIcon={<RotateCcw size={16} aria-hidden="true" />} loading={q.isFetching} onClick={() => void q.refetch()} data-testid="button-audit-refresh">{t('adm.common.refresh')}</Button>} />
      <form className="adm-filters adm-filters--audit" aria-label={t('adm.common.filters')} onSubmit={apply} noValidate>
        <ErrorSummary errors={errors} testId="summary-audit-errors" />
        <SelectField id="audit-clinic" label={t('adm.audit.clinic')} value={draft.clinicId} onChange={(v) => setDraft(d => ({ ...d, clinicId: v }))} testId="select-audit-clinic">
          <option value="">{t('adm.common.allClinics')}</option>
          {(clinics.data ?? []).map(c => <option key={c.id} value={String(c.id)}>{c.name} (#{c.id})</option>)}
        </SelectField>
        <SelectField id="audit-action" label={t('adm.audit.action')} value={draft.action} onChange={(v) => setDraft(d => ({ ...d, action: v }))} testId="select-audit-action">
          <option value="">{t('adm.audit.allActions')}</option>
          {ACTIONS.map(a => <option key={a} value={a}>{t(`adm.audit.actions.${actionKey(a)}`, { defaultValue: a })}</option>)}
        </SelectField>
        <SelectField id="audit-outcome" label={t('adm.audit.outcome')} value={draft.outcome} onChange={(v) => setDraft(d => ({ ...d, outcome: v }))} testId="select-audit-outcome">
          <option value="">{t('adm.audit.allOutcomes')}</option><option value="success">{t('adm.audit.success')}</option><option value="denied">{t('adm.audit.denied')}</option>
        </SelectField>
        <TextField id="audit-actor" label={t('adm.audit.actorId')} inputMode="numeric" value={draft.actorId} onChange={(e) => setDraft(d => ({ ...d, actorId: e.target.value.trim() }))} error={errors.find(x => x.id === 'audit-actor')?.text} data-testid="input-audit-actor" />
        <TextField id="audit-from" type="date" label={t('adm.audit.from')} value={draft.from} onChange={(e) => setDraft(d => ({ ...d, from: e.target.value }))} error={errors.find(x => x.id === 'audit-from')?.text} data-testid="input-audit-from" />
        <TextField id="audit-to" type="date" label={t('adm.audit.to')} value={draft.to} onChange={(e) => setDraft(d => ({ ...d, to: e.target.value }))} data-testid="input-audit-to" />
        <div className="adm-filters__btns">
          <Button type="submit" data-testid="button-audit-apply">{t('adm.common.apply')}</Button>
          <Button type="button" variant="ghost" onClick={() => { setDraft(EMPTY); setApplied(EMPTY); setStack([]); setErrors([]); }} data-testid="button-audit-reset">{t('adm.common.reset')}</Button>
        </div>
      </form>
      <p className="adm-foot">{t('adm.common.hebron')} · {t('adm.audit.newest')}</p>
      {q.isPending ? <Skeleton rows={6} /> : q.isError && (!q.data || isAccessFailure(q.error)) ? <LoadError error={q.error} onRetry={() => void q.refetch()} />
        : !q.data || q.data.items.length === 0 ? <Empty testId="state-audit-empty" title={t('adm.audit.empty')} />
        : <>
          {q.isError && <p className="adm-notice adm-notice--warn" role="alert">{t('adm.common.loadError')} {t(classify(q.error).key)}</p>}
          <div className="adm-table-wrap"><table className="adm-table adm-table--audit" data-testid="table-audit">
            <thead><tr><th>{t('adm.audit.when')}</th><th>{t('adm.audit.action')}</th><th>{t('adm.audit.outcome')}</th><th>{t('adm.audit.actor')}</th><th>{t('adm.audit.clinic')}</th><th>{t('adm.audit.target')}</th></tr></thead>
            <tbody>{q.data.items.map(ev => (
              <tr key={ev.id} data-testid={`row-audit-${ev.id}`}>
                <td className="adm-nowrap">{fmt(ev.eventTime)}</td>
                <td>{t(`adm.audit.actions.${actionKey(ev.action)}`, { defaultValue: ev.action })}</td>
                <td><span className={`adm-outcome adm-outcome--${ev.outcome}`} data-testid={`status-audit-${ev.id}`}>{t(`adm.audit.${ev.outcome}`)}</span></td>
                <td className="adm-mono">{ev.actorId !== null ? t('adm.audit.account', { id: ev.actorId }) : t('adm.audit.system')}</td>
                <td><bdi>{ev.clinicId !== null ? clinicLabel(clinicMap, ev.clinicId, t) : t('adm.audit.system')}</bdi></td>
                <td className="adm-mono">{target(ev)}</td>
              </tr>))}
            </tbody>
          </table></div>
          <nav className="adm-pager" aria-label={t('adm.audit.pageN', { n: stack.length + 1 })}>
            <Button variant="secondary" size="sm" disabled={stack.length === 0} onClick={() => setStack(s => s.slice(0, -1))} data-testid="button-audit-prev">{t('adm.common.prev')}</Button>
            <span data-testid="text-audit-page">{t('adm.audit.pageN', { n: stack.length + 1 })}</span>
            <Button variant="secondary" size="sm" disabled={!q.data.nextBeforeId} onClick={() => { const n = q.data?.nextBeforeId; if (n) setStack(s => [...s, n]); }} data-testid="button-audit-next">{t('adm.common.nextPage')}</Button>
          </nav>
        </>}
    </section>
  );
}

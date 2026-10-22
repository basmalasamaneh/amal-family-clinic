import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, FlaskConical, MessageSquareText, RotateCcw, Building2, Clock3, CircleCheck, CircleX } from 'lucide-react';
import {
  getGetReminderClinicPreferenceQueryKey, getListReminderLogQueryKey, useGetReminderClinicPreference, useListReminderLog, useSetReminderClinicPreference,
  type ReminderLogEntry,
} from '@workspace/api-client-react';
import { EmptyState, PageHeader, useAmalPreferences } from '@workspace/amal-ui';
import type { ShellClinic, ShellIdentity } from '@/shell/identity';
import { formatInstant, formatNumber } from '@/shell/formatting';
import { EMPTY_FILTERS, STATUSES, errorStatus, messagesClinicFor, reasonKey, toParams, validateFilters, type LogFilters, type StatusFilter } from './model';
import { REMINDER_REVOKED } from './use-reminder-access';
import { PhonePreview } from './PhonePreview';
import { previewText } from './phone-preview-model';
import './strings';
import './reminders.css';

export { messagesClinicFor } from './model';

export function MessagesPage({ identity, clinic, title, canManageReminders = false }: { identity: ShellIdentity; clinic: ShellClinic | null; title: string; canManageReminders?: boolean }) {
  const { t } = useTranslation('rem');
  const own = messagesClinicFor(identity, clinic);
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  return (
    <div className="rem-page" data-testid="page-messages">
      <PageHeader icon={MessageSquareText} section="reception" eyebrow={t('eyebrow')} title={title} description={t('lede')} />
      {!online || (identity.role === 'doctor' && !canManageReminders) ? (
        <EmptyState headingLevel={2} title={t('error.title')} description={t(online ? 'error.forbidden' : 'error.generic')} />
      ) : !own ? (
        <div data-testid="status-messages-no-clinic"><EmptyState headingLevel={2} title={t('noClinic.title')} description={t('noClinic.body')} /></div>
      ) : (
        // Keyed by clinic: filters, cursors and cached view reset on any clinic change.
        <ClinicMessages key={`${identity.id}:${identity.role}:${own.id}:${clinic?.id}:${canManageReminders}`} clinicId={own.id} clinicName={own.name} isAdmin={identity.role === 'admin' || canManageReminders} accountId={identity.id} />
      )}
    </div>
  );
}

function ClinicMessages({ clinicId, clinicName, isAdmin, accountId }: { clinicId: number; clinicName: string | null; isAdmin: boolean; accountId: string }) {
  const { t } = useTranslation('rem');
  return (
    <>
      <p className="rem-scope" data-testid="text-messages-clinic"><Building2 size={16} aria-hidden="true" />{clinicName ? t('scope', { name: clinicName }) : t('scopeUnknown')}</p>
      <p className="rem-channel"><FlaskConical size={16} aria-hidden="true" />{t('channel')}</p>
      {isAdmin ? <ClinicToggle clinicId={clinicId} accountId={accountId} /> : <ClinicStatus clinicId={clinicId} accountId={accountId} />}
      <LogView clinicId={clinicId} accountId={accountId} />
    </>
  );
}

/** Front-desk: read-only clinic enablement so an empty log under the default-off setting is explained. */
function ClinicStatus({ clinicId, accountId }: { clinicId: number; accountId: string }) {
  const { t } = useTranslation('rem');
  const pref = useGetReminderClinicPreference(clinicId, { query: {
    queryKey: [...getGetReminderClinicPreferenceQueryKey(clinicId), accountId],
    gcTime: 0, staleTime: 0, retry: false, refetchOnMount: 'always',
  } });
  if (pref.isLoading) return <div className="rem-skel rem-skel--line" role="status" aria-label={t('loading')} />;
  if (pref.isError || !pref.data) return <p className="rem-scope rem-muted" data-testid="status-clinic-reminders-readonly">{t('clinicStatus.unavailable')}</p>;
  const on = pref.data.enabled;
  return (
    <p className="rem-toggle__state" data-testid="status-clinic-reminders-readonly">
      <span className={`rem-badge rem-badge--${on ? 'sent' : 'cancelled'}`}>{t(on ? 'clinic.on' : 'clinic.off')}</span>
      <span>{t(on ? 'clinicStatus.on' : 'clinicStatus.off')}</span>
    </p>
  );
}

function ClinicToggle({ clinicId, accountId }: { clinicId: number; accountId: string }) {
  const { t } = useTranslation('rem');
  const qc = useQueryClient();
  const preferenceKey = [...getGetReminderClinicPreferenceQueryKey(clinicId), accountId];
  const pref = useGetReminderClinicPreference(clinicId, { query: {
    queryKey: preferenceKey, gcTime: 0, staleTime: 0, retry: false,
    refetchOnMount: 'always', refetchOnWindowFocus: 'always', refetchInterval: 45_000,
  } });
  useEffect(() => {
    if ([401, 403].includes(errorStatus(pref.error) ?? 0) || (pref.isSuccess && pref.data?.canManage === false)) {
      window.dispatchEvent(new Event(REMINDER_REVOKED));
    }
  }, [pref.error, pref.isSuccess, pref.data?.canManage]);
  const save = useSetReminderClinicPreference();
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const enabled = pref.data?.enabled ?? false;

  const commit = (next: boolean) => {
    if (pref.isError || !pref.data?.canManage) return;
    setConfirming(false); setMsg(null);
    save.mutate({ clinicId, data: { enabled: next } }, {
      onSuccess: (res) => {
        qc.setQueryData(preferenceKey, res);
        void qc.invalidateQueries({ queryKey: ['/api/reminders/log'] });
        setMsg({ ok: true, text: t('clinic.saved') });
      },
      onError: (error) => {
        if ([401, 403].includes(errorStatus(error) ?? 0)) window.dispatchEvent(new Event(REMINDER_REVOKED));
        setMsg({ ok: false, text: t('clinic.saveError') });
      },
    });
  };

  return (
    <section className="rem-card rem-toggle" aria-labelledby="rem-clinic-h" data-testid="section-clinic-reminders">
      <div className="rem-toggle__main">
        <h2 id="rem-clinic-h" className="rem-h2">{t('clinic.title')}</h2>
        {pref.isLoading && <div className="rem-skel rem-skel--line" role="status" aria-label={t('loading')} />}
        {pref.isError && (
          <p className="rem-inline-err" role="alert" data-testid="status-clinic-reminders-error">{t('clinic.loadError')}{' '}
            <button type="button" className="rem-link" onClick={() => void pref.refetch()} data-testid="button-clinic-reminders-retry">{t('retry')}</button></p>
        )}
        {pref.data && !pref.isError && (
          <p className="rem-toggle__state">
            <span className={`rem-badge rem-badge--${enabled ? 'sent' : 'cancelled'}`} data-testid="status-clinic-reminders">{t(enabled ? 'clinic.on' : 'clinic.off')}</span>
            <span>{t(enabled ? 'clinic.bodyOn' : 'clinic.bodyOff')}</span>
          </p>
        )}
        {confirming && (
          <div className="rem-confirm" role="alertdialog" aria-labelledby="rem-confirm-t" data-testid="dialog-confirm-disable">
            <p id="rem-confirm-t">{t('clinic.confirmOff')}</p>
            <div className="rem-row">
              <button type="button" className="bk-btn bk-btn--sm bk-btn--primary" onClick={() => commit(false)} data-testid="button-confirm-disable">{t('clinic.confirm')}</button>
              <button type="button" className="bk-btn bk-btn--sm" onClick={() => setConfirming(false)} data-testid="button-cancel-disable">{t('clinic.cancel')}</button>
            </div>
          </div>
        )}
        <p className={msg && !msg.ok ? 'rem-inline-err' : 'rem-opt__msg'} role="status" aria-live="polite" data-testid="text-clinic-reminders-result">{msg?.text ?? ''}</p>
      </div>
      {pref.data?.canManage && !pref.isError && !confirming && (
        <button type="button" role="switch" aria-checked={enabled} aria-labelledby="rem-clinic-h" className={`rem-switch${enabled ? ' is-on' : ''}`}
          disabled={save.isPending} onClick={() => (enabled ? setConfirming(true) : commit(true))} data-testid="switch-clinic-reminders">
          <span className="rem-switch__knob" aria-hidden="true" />
          <span className="rem-switch__text">{save.isPending ? t('clinic.saving') : t(enabled ? 'clinic.turnOff' : 'clinic.turnOn')}</span>
        </button>
      )}
    </section>
  );
}

function LogView({ clinicId, accountId }: { clinicId: number; accountId: string }) {
  const { t } = useTranslation('rem');
  const qc = useQueryClient();
  const [selected, setSelected] = useState<{ id: number; trigger: HTMLButtonElement } | null>(null);
  const [revoked, setRevoked] = useState(false);
  const { locale, digitPreference: dp } = useAmalPreferences();
  const [draft, setDraft] = useState<LogFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<LogFilters>(EMPTY_FILTERS);
  const [cursors, setCursors] = useState<(number | null)[]>([null]);
  const [formErr, setFormErr] = useState<string | null>(null);
  const cursor = cursors[cursors.length - 1];
  const params = toParams(clinicId, applied, cursor);
  const log = useListReminderLog(params, { query: {
    queryKey: [...getListReminderLogQueryKey(params), accountId],
    gcTime: 0, staleTime: 0, refetchOnMount: 'always', retry: false,
  } });
  const data = !log.isError && log.isFetchedAfterMount ? log.data : undefined;
  // Cache invalidation closes the portal immediately, even before the refetch settles.
  // Keep only an ID, not a private text copy, in selection state.
  const queryIdentity = JSON.stringify([...getListReminderLogQueryKey(params), accountId]);
  useEffect(() => {
    setSelected(null);
    const unsubscribe = qc.getQueryCache().subscribe((event) => {
      if (JSON.stringify(event.query.queryKey) !== queryIdentity) return;
      if (event.type === 'removed' || (event.type === 'updated' && event.action.type === 'success') || event.query.state.isInvalidated || event.query.state.fetchStatus !== 'idle' || event.query.state.status === 'error') setSelected(null);
    });
    const revoke = () => { setSelected(null); setRevoked(true); };
    const close = () => setSelected(null);
    window.addEventListener(REMINDER_REVOKED, revoke);
    window.addEventListener('offline', close);
    return () => {
      unsubscribe();
      window.removeEventListener(REMINDER_REVOKED, revoke);
      window.removeEventListener('offline', close);
    };
  }, [qc, queryIdentity]);
  const previewAllowed = !!data && !log.isFetching && !revoked && navigator.onLine;
  const previewEntry = previewAllowed ? data?.items.find((item) => item.id === selected?.id) : undefined;
  useEffect(() => {
    if ([401, 403].includes(errorStatus(log.error) ?? 0)) window.dispatchEvent(new Event(REMINDER_REVOKED));
  }, [log.error]);
  const filtered = applied.status !== '' || applied.from !== '' || applied.to !== '';

  const apply = (e: FormEvent) => {
    e.preventDefault();
    const err = validateFilters(draft);
    if (err) { setFormErr(t(`filters.${err}`)); return; }
    setFormErr(null); setApplied(draft); setCursors([null]);
  };
  const clear = () => { setDraft(EMPTY_FILTERS); setApplied(EMPTY_FILTERS); setCursors([null]); setFormErr(null); };
  const status = errorStatus(log.error);

  return (
    <section className="rem-log" aria-labelledby="rem-log-h">
      <h2 id="rem-log-h" className="shell-sr">{t('eyebrow')}</h2>
      {data && <dl className="rem-summary" aria-label={t('summary.label')}>
        <div><dt>{t('summary.total')}</dt><dd>{formatNumber(data.items.length, locale, dp)}</dd></div>
        {STATUSES.map((s) => <div key={s}><dt>{t(`status.${s}`)} · {t('summary.page')}</dt><dd>{formatNumber(data.items.filter((m) => m.status === s).length, locale, dp)}</dd></div>)}
      </dl>}
      <form className="rem-card rem-filters" onSubmit={apply} noValidate aria-describedby="rem-filter-hint" data-testid="form-messages-filters">
        <fieldset className="rem-filters__set">
          <legend className="shell-sr">{t('filters.legend')}</legend>
          <label className="rem-field"><span>{t('filters.status')}</span>
            <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as StatusFilter })} data-testid="select-messages-status">
              <option value="">{t('status.all')}</option>
              {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
            </select></label>
          <label className="rem-field"><span>{t('filters.from')}</span>
            <input type="date" dir="ltr" value={draft.from} max={draft.to || undefined} onChange={(e) => setDraft({ ...draft, from: e.target.value })} aria-invalid={!!formErr} data-testid="input-messages-from" /></label>
          <label className="rem-field"><span>{t('filters.to')}</span>
            <input type="date" dir="ltr" value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft({ ...draft, to: e.target.value })} aria-invalid={!!formErr} data-testid="input-messages-to" /></label>
          <div className="rem-row rem-filters__actions">
            <button type="submit" className="bk-btn bk-btn--sm bk-btn--primary" data-testid="button-messages-apply">{t('filters.apply')}</button>
            <button type="button" className="bk-btn bk-btn--sm" onClick={clear} data-testid="button-messages-clear">{t('filters.clear')}</button>
            <button type="button" className="bk-btn bk-btn--sm" onClick={() => void log.refetch()} disabled={log.isFetching} data-testid="button-messages-refresh">
              <RotateCcw size={16} aria-hidden="true" className={log.isFetching ? 'rem-spin' : undefined} />{log.isFetching ? t('refreshing') : t('refresh')}
            </button>
          </div>
        </fieldset>
        <p id="rem-filter-hint" className="rem-hint">{t('filters.hint')}</p>
        {formErr && <p className="rem-inline-err" role="alert" data-testid="text-messages-filter-error">{formErr}</p>}
      </form>

      <p className="shell-sr" role="status" aria-live="polite">{log.isLoading ? t('loading') : data ? t('count', { count: data.items.length }) : ''}</p>

      {log.isLoading && <div className="rem-list" aria-hidden="true" data-testid="status-messages-loading">{[0, 1, 2].map((i) => <div key={i} className="rem-skel rem-skel--item" />)}</div>}

      {log.isError && (
        <div className="bk-msg bk-msg--block rem-error" role="alert" data-testid="status-messages-error">
          <AlertTriangle size={20} aria-hidden="true" />
          <div className="bk-msg__body"><p><strong>{t('error.title')}</strong></p><p>{status === 403 ? t('error.forbidden') : t('error.generic')}</p>
            <button type="button" className="bk-btn bk-btn--sm" onClick={() => void log.refetch()} data-testid="button-messages-retry"><RotateCcw size={16} aria-hidden="true" />{t('retry')}</button></div>
        </div>
      )}

      {data && data.items.length === 0 && (
        <div data-testid="status-messages-empty">
          <EmptyState title={t(filtered || cursors.length > 1 ? 'emptyFiltered.title' : 'empty.title')} description={t(filtered || cursors.length > 1 ? 'emptyFiltered.body' : 'empty.body')} />
        </div>
      )}

      {data && data.items.length > 0 && (
        <ol className="rem-list" data-testid="list-messages">
          {data.items.map((m) => <LogItem key={m.id} m={m} locale={locale} dp={dp} previewDisabled={!previewAllowed} onPreview={(trigger) => {
            const current = qc.getQueryState([...getListReminderLogQueryKey(params), accountId]);
            if (!previewAllowed || !navigator.onLine || !current || current.isInvalidated || current.fetchStatus !== 'idle' || current.status !== 'success') return;
            setSelected({ id: m.id, trigger });
          }} />)}
        </ol>
      )}

      {data && (cursors.length > 1 || data.nextCursor !== null) && (
        <nav className="rem-pager" aria-label={t('page', { n: formatNumber(cursors.length, locale, dp) })} data-testid="nav-messages-pager">
          <button type="button" className="bk-btn bk-btn--sm" disabled={cursors.length <= 1 || log.isFetching} onClick={() => setCursors((c) => c.slice(0, -1))} data-testid="button-messages-prev">
            <ChevronRight size={16} aria-hidden="true" className="rem-dir" />{t('prev')}</button>
          <span className="rem-pager__n" data-testid="text-messages-page">{t('page', { n: formatNumber(cursors.length, locale, dp) })}</span>
          <button type="button" className="bk-btn bk-btn--sm" disabled={data.nextCursor === null || log.isFetching}
            onClick={() => { const n = log.data?.nextCursor; if (n) setCursors((c) => [...c, n]); }} data-testid="button-messages-next">
            {t('next')}<ChevronLeft size={16} aria-hidden="true" className="rem-dir" /></button>
        </nav>
      )}
      {selected && previewEntry && <PhonePreview key={`${previewEntry.id}:${locale}`} text={previewText(previewEntry, locale)} language={locale} trigger={selected.trigger} onClose={() => setSelected(null)} />}
    </section>
  );
}

function safeInstant(v: string | null, locale: Parameters<typeof formatInstant>[1], dp: Parameters<typeof formatInstant>[2]): string | null {
  if (!v) return null;
  try { return formatInstant(v, locale, dp); } catch { return null; }
}

function LogItem({ m, locale, dp, onPreview, previewDisabled }: { m: ReminderLogEntry; locale: Parameters<typeof formatInstant>[1]; dp: Parameters<typeof formatInstant>[2]; onPreview: (trigger: HTMLButtonElement) => void; previewDisabled: boolean }) {
  const { t } = useTranslation('rem');
  const known = (STATUSES as readonly string[]).includes(m.status);
  const r = reasonKey(m.cancellationReason);
  const due = safeInstant(m.scheduledAt, locale, dp);
  const sent = safeInstant(m.sentAt, locale, dp);
  const cancelled = safeInstant(m.cancelledAt, locale, dp);
  const StatusIcon = m.status === 'sent' ? CircleCheck : m.status === 'cancelled' ? CircleX : Clock3;
  return (
    <li className={`rem-item rem-item--${known ? m.status : 'unknown'}`} data-testid={`row-message-${m.id}`}>
      <div className="rem-item__meta">
        <span className={`rem-badge rem-badge--${known ? m.status : 'unknown'}`} data-testid={`status-message-${m.id}`}><StatusIcon size={15} aria-hidden="true" />{t(known ? `status.${m.status}` : 'status.unknown')}</span>
        <dl className="rem-times">
          <div><dt>{t('field.due')}</dt><dd><time dateTime={m.scheduledAt} data-testid={`text-message-due-${m.id}`}>{due ?? '—'}</time></dd></div>
          {m.status === 'sent' && <div><dt>{t('field.sentAt')}</dt><dd>{sent ? <time dateTime={m.sentAt!} data-testid={`text-message-sent-${m.id}`}>{sent}</time> : '—'}</dd></div>}
          {m.status === 'cancelled' && <div><dt>{t('field.cancelledAt')}</dt><dd>{cancelled ? <time dateTime={m.cancelledAt!} data-testid={`text-message-cancelled-${m.id}`}>{cancelled}</time> : '—'}</dd></div>}
          {m.status === 'scheduled' && <div><dt>{t('field.sentAt')}</dt><dd className="rem-muted">{t('pending')}</dd></div>}
          {m.status === 'cancelled' && <div><dt>{t('field.reason')}</dt><dd data-testid={`text-message-reason-${m.id}`}>{t(r)}</dd></div>}
        </dl>
        <button type="button" className="bk-btn bk-btn--sm" disabled={previewDisabled} onClick={(event) => onPreview(event.currentTarget)} data-testid={`button-message-preview-${m.id}`}>{t('phone.open')}</button>
      </div>
      <div className="rem-bodies">
        <figure className="rem-text" lang="ar" dir="rtl"><figcaption>{t('field.ar')}</figcaption><blockquote data-testid={`text-message-ar-${m.id}`}>{m.textAr}</blockquote></figure>
        <figure className="rem-text" lang="en" dir="ltr"><figcaption>{t('field.en')}</figcaption><blockquote data-testid={`text-message-en-${m.id}`}>{m.textEn}</blockquote></figure>
      </div>
    </li>
  );
}

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { AlertTriangle, WifiOff, X } from 'lucide-react';
import { Button, EmptyState, useAmalPreferences } from '@workspace/amal-ui';
import {
  getGetKpisQueryKey, getGetNetworkHealthQueryKey, getListAdminClinicsQueryKey, getListAdminDevicesQueryKey, getListAdminDoctorsQueryKey, getListAdminUsersQueryKey, getListClinicsQueryKey,
  listAdminClinics, listAdminDoctors, type AdminClinic, type AdminDoctor,
} from '@workspace/api-client-react';
import { reportUnauthorized } from '@/auth/session-events';
import { formatInstant } from '@/shell/formatting';
import { i18n } from '../i18n';
import { admAr, admEn } from './strings';

let registered = false;
export function registerAdminStrings(): void {
  if (registered) return; registered = true;
  // Audit action keys are authored with '_' in place of '.' so i18next key separators stay intact.
  i18n.addResourceBundle('en', 'translation', { adm: admEn }, true, false);
  i18n.addResourceBundle('ar', 'translation', { adm: admAr }, true, false);
}
registerAdminStrings();

export { OfflineError, classify, EMAIL_RE, TIME_RE, LABEL_RE, validTimezone, type AdminFailure } from './model';
import { OfflineError, classify } from './model';

/** Admin writes are online-only: never queued, never retried. 401 ends the session (no success shown). */
export async function adminWrite<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new OfflineError();
  try { return await fn(); }
  catch (e) {
    if (classify(e).session) reportUnauthorized();
    throw e;
  }
}

const subOnline = (cb: () => void) => { window.addEventListener('online', cb); window.addEventListener('offline', cb); return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb); }; };
/** Auth/permission failures mean previously cached private data must not be shown. */
export function isAccessFailure(e: unknown): boolean { const s = e && typeof e === 'object' && 'status' in e ? (e as { status: unknown }).status : null; return s === 401 || s === 403; }

export function useOnline(): boolean { return useSyncExternalStore(subOnline, () => navigator.onLine, () => true); }

/** Guards late async results after unmount (logout, role or scope change remounts the page). */
export function useAlive() {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return alive;
}

export function useSharedInvalidate() {
  const qc = useQueryClient();
  return (opts: { clinics?: boolean; doctors?: boolean; users?: boolean; devices?: boolean } = {}) => {
    const keys: unknown[] = [getGetNetworkHealthQueryKey()[0], getGetKpisQueryKey()[0]];
    if (opts.clinics) keys.push(getListAdminClinicsQueryKey()[0], getListClinicsQueryKey()[0]);
    if (opts.doctors) keys.push(getListAdminDoctorsQueryKey()[0]);
    if (opts.users) keys.push(getListAdminUsersQueryKey()[0]);
    if (opts.devices) keys.push(getListAdminDevicesQueryKey()[0]);
    for (const k of keys) void qc.invalidateQueries({ queryKey: [k] });
  };
}

/* ---------- dynamic selectors (all pages, stable IDs) ---------- */
async function drain<T>(page: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>): Promise<T[]> {
  const out: T[] = []; const seen = new Set<string>(); let cursor: string | undefined;
  do {
    const p = await page(cursor);
    out.push(...p.items);
    cursor = p.nextCursor ?? undefined;
    if (cursor && seen.has(cursor)) throw new Error('Repeated cursor');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return out;
}
export function fetchAllClinics(): Promise<AdminClinic[]> { return drain(c => listAdminClinics({ limit: 100, ...(c ? { cursor: c } : {}) })); }
export function useAllClinics() {
  return useQuery({ queryKey: [getListAdminClinicsQueryKey()[0], { all: true }], queryFn: fetchAllClinics, staleTime: 30_000 });
}
export function useClinicDoctors(clinicId: number | null) {
  return useQuery({
    queryKey: [getListAdminDoctorsQueryKey()[0], { all: true, clinicId }], enabled: clinicId !== null, staleTime: 30_000,
    queryFn: (): Promise<AdminDoctor[]> => drain(c => listAdminDoctors({ limit: 100, clinicId: clinicId!, ...(c ? { cursor: c } : {}) })),
  });
}
export function clinicLabel(map: Map<number, string>, id: number | null, t: (k: string, o: { id: number }) => string) {
  if (id === null) return '—';
  return map.get(id) ?? t('adm.common.clinicRef', { id });
}

/* ---------- presentation ---------- */
export function useInstant() {
  const { locale, digitPreference } = useAmalPreferences();
  return (iso: string | null | undefined, fallback = '—') => {
    if (!iso) return fallback;
    try { return formatInstant(iso, locale, digitPreference); } catch { return fallback; }
  };
}

export function PageHead({ id, title, lede, actions }: { id: string; title: string; lede: string; actions?: ReactNode }) {
  const { t } = useTranslation();
  const online = useOnline();
  return (
    <header className="adm-head">
      <div className="adm-head__text">
        <p className="adm-eyebrow">{t('adm.common.eyebrow')}</p>
        <h1 id="page-title" tabIndex={-1} className="adm-h1" data-testid={`heading-${id}`}>{title}</h1>
        <p className="adm-lede">{lede}</p>
      </div>
      <div className="adm-head__actions">
        {!online && <span className="adm-offline" role="status" data-testid="status-admin-offline"><WifiOff size={16} aria-hidden="true" />{t('adm.common.offlineBadge')}</span>}
        {actions}
      </div>
    </header>
  );
}

export function Notice({ tone = 'info', children, testId }: { tone?: 'info' | 'success' | 'danger' | 'warn'; children: ReactNode; testId?: string }) {
  return <div className={`adm-notice adm-notice--${tone}`} role={tone === 'danger' ? 'alert' : 'status'} data-testid={testId}>
    {tone !== 'success' && tone !== 'info' && <AlertTriangle size={18} aria-hidden="true" />}<div>{children}</div>
  </div>;
}

/** A live status line that survives dialog close; cleared by the caller. */
export function useFlash() {
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const node = msg ? <Notice tone={msg.tone} testId="status-admin-flash">{msg.text}</Notice> : <div role="status" className="shell-sr" />;
  return { set: setMsg, node };
}

export function Modal({ open, onOpenChange, title, description, children, testId, busy, wide }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; children: ReactNode; testId: string; busy?: boolean; wide?: boolean;
}) {
  const { t } = useTranslation();
  const returnFocus = useRef(typeof document !== 'undefined' ? document.activeElement : null);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="shell-overlay" />
        <Dialog.Content className={`shell-dialog adm-dialog${wide ? ' adm-dialog--wide' : ''}`} data-testid={testId}
          onCloseAutoFocus={(e) => { const target = returnFocus.current; if (target instanceof HTMLElement && target.isConnected) { e.preventDefault(); target.focus(); } }}
          onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }} onPointerDownOutside={(e) => e.preventDefault()}
          {...(description ? {} : { 'aria-describedby': undefined })}>
          <div className="shell-dialog__head">
            <Dialog.Title className="shell-dialog__title">{title}</Dialog.Title>
            <Dialog.Close asChild><Button variant="ghost" iconOnly aria-label={t('adm.common.close')} className="shell-dialog__x" disabled={busy} data-testid={`${testId}-close`}><X size={20} aria-hidden="true" /></Button></Dialog.Close>
          </div>
          {description && <Dialog.Description className="adm-dialog__desc">{description}</Dialog.Description>}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Confirm({ open, onOpenChange, title, body, confirmLabel, onConfirm, busy, error, testId, tone = 'danger' }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void; busy?: boolean; error?: string | null; testId: string; tone?: 'danger' | 'primary';
}) {
  const { t } = useTranslation();
  const returnFocus = useRef<Element | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== 'undefined') returnFocus.current = document.activeElement;
  wasOpen.current = open;
  return (
    <AlertDialog.Root open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="shell-overlay" />
        <AlertDialog.Content className="shell-dialog adm-dialog" data-testid={testId} onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
          onCloseAutoFocus={(e) => { const target = returnFocus.current; if (target instanceof HTMLElement && target.isConnected) { e.preventDefault(); target.focus(); } }}>
          <AlertDialog.Title className="shell-dialog__title">{title}</AlertDialog.Title>
          <AlertDialog.Description className="adm-dialog__desc">{body}</AlertDialog.Description>
          {error && <Notice tone="danger" testId={`${testId}-error`}>{error}</Notice>}
          <div className="adm-actions">
            <AlertDialog.Cancel asChild><Button variant="secondary" disabled={busy} data-testid={`${testId}-cancel`}>{t('adm.common.cancel')}</Button></AlertDialog.Cancel>
            <Button variant={tone} loading={busy} onClick={(e) => { e.preventDefault(); onConfirm(); }} data-testid={`${testId}-confirm`}>{confirmLabel}</Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function SelectField({ label, value, onChange, children, testId, id, error, required, disabled, hint }: {
  label: string; value: string; onChange: (v: string) => void; children: ReactNode; testId: string; id: string; error?: string | null; required?: boolean; disabled?: boolean; hint?: string;
}) {
  const desc = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="amal-field">
      <label className="amal-field__label" htmlFor={id}>{label}{required && <span className="amal-field__req" aria-hidden="true">*</span>}</label>
      <select id={id} className="amal-input adm-select" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}
        aria-invalid={error ? true : undefined} aria-describedby={desc} required={required} disabled={disabled}>{children}</select>
      {hint && <p id={`${id}-hint`} className="amal-field__hint">{hint}</p>}
      {error && <p id={`${id}-error`} className="adm-field-error">{error}</p>}
    </div>
  );
}

/** Focuses itself when shown; each item links to the invalid field. */
export function ErrorSummary({ errors, testId = 'summary-errors' }: { errors: { id: string; text: string }[]; testId?: string }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const sig = errors.map(e => e.id).join('|');
  useEffect(() => { if (sig) ref.current?.focus(); }, [sig]);
  if (!errors.length) return null;
  return (
    <div ref={ref} tabIndex={-1} className="adm-notice adm-notice--danger adm-summary" role="alert" data-testid={testId}>
      <AlertTriangle size={18} aria-hidden="true" />
      <div><p className="adm-summary__title">{t('adm.common.errorsTitle')}</p>
        <ul>{errors.map(e => <li key={e.id}><a href={`#${e.id}`} onClick={(ev) => { ev.preventDefault(); document.getElementById(e.id)?.focus(); }}>{e.text}</a></li>)}</ul>
      </div>
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return <div className="adm-skel" aria-hidden="true" data-testid="state-admin-loading">{Array.from({ length: rows }, (_, i) => <span key={i} className="shell-skel" />)}</div>;
}
export function LoadError({ onRetry, text, error }: { onRetry: () => void; text?: string; error?: unknown }) {
  const { t } = useTranslation();
  const detail = error !== undefined && error !== null ? t(classify(error).key) : null;
  return <div className="adm-empty" role="alert" data-testid="state-admin-error"><AlertTriangle size={28} aria-hidden="true" /><p className="adm-empty__title">{text ?? t('adm.common.loadError')}</p>
    {detail && <p data-testid="text-admin-error-reason">{detail}</p>}
    <Button variant="secondary" onClick={onRetry} data-testid="button-admin-retry">{t('adm.common.retry')}</Button></div>;
}
export function Empty({ title, desc, testId, action }: { title: string; desc?: string; testId: string; action?: ReactNode }) {
  // Genuine empty collection or no-filter-match only; errors/forbidden/loading keep their own treatments.
  return <div className="adm-empty-wrap" data-testid={testId}><EmptyState headingLevel={2} title={title} description={desc} actions={action} /></div>;
}


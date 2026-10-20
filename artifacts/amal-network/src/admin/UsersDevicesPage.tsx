import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, MonitorSmartphone, Pencil, Plus, Power, ShieldOff, UserCheck } from 'lucide-react';
import { Button, Segmented, TextField } from '@workspace/amal-ui';
import {
  createAdminUser, getListAdminDevicesQueryKey, getListAdminUsersQueryKey, resetAdminUserPin, updateAdminUser,
  useDeactivateAdminUser, useEnrollDevice, useListAdminDevices, useListAdminUsers, useRevokeDevice,
  type AdminDevice, type AdminUser, type AdminUserInput, type AdminUserUpdate, type ListAdminDevicesParams, type ListAdminUsersParams,
} from '@workspace/api-client-react';
import { isAuthFailure } from '@/auth/errors';
import {
  Confirm, EMAIL_RE, isAccessFailure, Empty, ErrorSummary, LABEL_RE, LoadError, Modal, Notice, PageHead, SelectField, Skeleton,
  adminWrite, classify, clinicLabel, useAlive, useAllClinics, useClinicDoctors, useFlash, useInstant, useOnline, useSharedInvalidate,
} from './common';
import './admin.css';

type Role = 'admin' | 'doctor' | 'front-desk';
const PAGE_SIZE = 25;

export function UsersDevicesPage({ title }: { title: string }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'users' | 'devices'>('users');
  return (
    <section className="adm" data-testid="page-usersDevices">
      <PageHead id="usersDevices" title={title} lede={t('adm.users.lede')} />
      <Segmented label={title} value={tab} onChange={(v) => setTab(v as 'users' | 'devices')}
        options={[{ value: 'users', label: t('adm.users.tabUsers'), testId: 'tab-users' }, { value: 'devices', label: t('adm.users.tabDevices'), testId: 'tab-devices' }]} />
      {tab === 'users' ? <UsersPanel /> : <DevicesPanel />}
    </section>
  );
}

function Pager({ page, total, onPage, prefix }: { page: number; total: number; onPage: (p: number) => void; prefix: string }) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <nav className="adm-pager" aria-label={t('adm.common.page', { page, pages })}>
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid={`button-${prefix}-prev`}>{t('adm.common.prev')}</Button>
      <span data-testid={`text-${prefix}-page`}>{t('adm.common.page', { page, pages })} · {t('adm.common.total', { count: total })}</span>
      <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid={`button-${prefix}-next`}>{t('adm.common.nextPage')}</Button>
    </nav>
  );
}

/* ================= Users ================= */
function UsersPanel() {
  const { t } = useTranslation();
  const fmt = useInstant();
  const online = useOnline();
  const flash = useFlash();
  const clinics = useAllClinics();
  const clinicMap = useMemo(() => new Map((clinics.data ?? []).map(c => [c.id, c.name])), [clinics.data]);
  const [page, setPage] = useState(1);
  const [role, setRole] = useState('');
  const [clinicId, setClinicId] = useState('');
  const [active, setActive] = useState('');
  const [qText, setQText] = useState('');
  const [q, setQ] = useState('');
  const params: ListAdminUsersParams = { page, pageSize: PAGE_SIZE, ...(role ? { role: role as Role } : {}), ...(clinicId ? { clinicId: Number(clinicId) } : {}),
    ...(active ? { active: active as 'true' | 'false' } : {}), ...(q ? { q } : {}) };
  const list = useListAdminUsers(params, { query: { queryKey: getListAdminUsersQueryKey(params), retry: (n, e) => !isAuthFailure(e) && n < 1, placeholderData: (p) => p } });
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null);
  const [deact, setDeact] = useState<AdminUser | null>(null);
  const [pinFor, setPinFor] = useState<AdminUser | null>(null);
  const [reactivating, setReactivating] = useState<AdminUser | null>(null);
  const filter = (fn: () => void) => { fn(); setPage(1); };

  return (
    <div className="adm-panel" data-testid="panel-users">
      <form className="adm-filters" aria-label={t('adm.common.filters')} onSubmit={(e) => { e.preventDefault(); filter(() => setQ(qText.trim())); }}>
        <TextField label={t('adm.users.search')} value={qText} maxLength={254} onChange={(e) => setQText(e.target.value)} data-testid="input-users-search" />
        <SelectField id="f-user-role" label={t('adm.users.role')} value={role} onChange={(v) => filter(() => setRole(v))} testId="select-users-role">
          <option value="">{t('adm.common.all')}</option>
          {(['admin', 'doctor', 'front-desk'] as const).map(r => <option key={r} value={r}>{t(`adm.users.roles.${r}`)}</option>)}
        </SelectField>
        <ClinicSelect id="f-user-clinic" value={clinicId} onChange={(v) => filter(() => setClinicId(v))} testId="select-users-clinic" allowAll />
        <SelectField id="f-user-active" label={t('adm.users.status')} value={active} onChange={(v) => filter(() => setActive(v))} testId="select-users-active">
          <option value="">{t('adm.common.all')}</option><option value="true">{t('adm.users.active')}</option><option value="false">{t('adm.users.inactive')}</option>
        </SelectField>
        <Button type="submit" variant="secondary" data-testid="button-users-search">{t('adm.common.apply')}</Button>
        <span className="adm-filters__spacer" />
        <Button startIcon={<Plus size={16} aria-hidden="true" />} disabled={!online} onClick={() => { flash.set(null); setEditing('new'); }} data-testid="button-add-user">{t('adm.users.add')}</Button>
      </form>
      {flash.node}
      {list.isPending ? <Skeleton /> : list.isError && (!list.data || isAccessFailure(list.error)) ? <LoadError error={list.error} onRetry={() => void list.refetch()} />
        : !list.data || list.data.items.length === 0 ? <Empty testId="state-users-empty" title={t('adm.users.empty')} desc={t('adm.users.emptyDesc')} />
        : <>
          <div className="adm-table-wrap" role="region" tabIndex={0} aria-label={t('adm.users.tabUsers')} data-testid="region-users-table"><table className="adm-table" data-testid="table-users">
            <thead><tr><th>{t('adm.users.email')}</th><th>{t('adm.users.role')}</th><th>{t('adm.users.clinic')}</th><th>{t('adm.users.status')}</th><th>{t('adm.users.lastLogin')}</th><th><span className="shell-sr">{t('adm.common.edit')}</span></th></tr></thead>
            <tbody>{list.data.items.map(u => (
              <tr key={u.id} data-testid={`row-user-${u.id}`} className={u.active ? '' : 'is-muted'}>
                <td><bdi className="adm-strong">{u.email}</bdi><span className="adm-sub adm-mono">#{u.id}</span></td>
                <td><span className={`adm-role adm-role--${u.role}`}>{t(`adm.users.roles.${u.role}`)}</span>{u.doctorId !== null && <span className="adm-sub">{t('adm.audit.targets.doctor', { id: u.doctorId })}</span>}</td>
                <td><bdi>{clinicLabel(clinicMap, u.clinicId, t)}</bdi></td>
                <td data-testid={`status-user-${u.id}`}>{u.active ? t('adm.users.active') : t('adm.users.inactive')}</td>
                <td>{fmt(u.lastLogin, t('adm.common.never'))}</td>
                <td className="adm-rowact">
                  <Button size="sm" variant="ghost" startIcon={<Pencil size={14} aria-hidden="true" />} disabled={!online} onClick={() => { flash.set(null); setEditing(u); }} data-testid={`button-edit-user-${u.id}`}>{t('adm.common.edit')}</Button>
                  {u.role === 'front-desk' && u.active && <Button size="sm" variant="ghost" startIcon={<KeyRound size={14} aria-hidden="true" />} disabled={!online} onClick={() => { flash.set(null); setPinFor(u); }} data-testid={`button-reset-pin-${u.id}`}>{t('adm.users.resetPin')}</Button>}
                  {u.active
                    ? <Button size="sm" variant="ghost" className="adm-danger-text" startIcon={<Power size={14} aria-hidden="true" />} disabled={!online} onClick={() => { flash.set(null); setDeact(u); }} data-testid={`button-deactivate-user-${u.id}`}>{t('adm.users.deactivate')}</Button>
                    : <Button size="sm" variant="ghost" startIcon={<UserCheck size={14} aria-hidden="true" />} disabled={!online} onClick={() => { flash.set(null); setReactivating(u); }} data-testid={`button-reactivate-user-${u.id}`}>{t('adm.users.reactivate')}</Button>}
                </td>
              </tr>))}
            </tbody>
          </table></div>
          <Pager page={list.data.page} total={list.data.total} onPage={setPage} prefix="users" />
        </>}
      <p className="adm-foot">{t('adm.users.secretsNote')}</p>
      {editing && <UserDialog user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={(m) => flash.set({ tone: 'success', text: m })} />}
      {deact && <DeactivateDialog user={deact} onClose={() => setDeact(null)} onDone={(m) => flash.set({ tone: 'success', text: m })} />}
      {reactivating && <ReactivateDialog user={reactivating} onClose={() => setReactivating(null)} onDone={(m) => flash.set({ tone: 'success', text: m })} />}
      {pinFor && <PinDialog user={pinFor} onClose={() => setPinFor(null)} onDone={(m) => flash.set({ tone: 'success', text: m })} />}
    </div>
  );
}

function ClinicSelect({ id, value, onChange, testId, allowAll, error, required, label }: { id: string; value: string; onChange: (v: string) => void; testId: string; allowAll?: boolean; error?: string | null; required?: boolean; label?: string }) {
  const { t } = useTranslation();
  const clinics = useAllClinics();
  return (
    <SelectField id={id} label={label ?? t('adm.users.clinic')} value={value} onChange={onChange} testId={testId} error={error} required={required}
      disabled={clinics.isPending} hint={clinics.isError ? t('adm.common.clinicsUnavailable') : undefined}>
      {allowAll ? <option value="">{t('adm.common.allClinics')}</option> : <option value="">{clinics.isPending ? t('adm.common.clinicLoading') : t('adm.common.none')}</option>}
      {(clinics.data ?? []).map(c => <option key={c.id} value={String(c.id)}>{c.name} (#{c.id})</option>)}
    </SelectField>
  );
}

function UserDialog({ user, onClose, onDone }: { user: AdminUser | null; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useTranslation();
  const alive = useAlive();
  const invalidate = useSharedInvalidate();
  const [email, setEmail] = useState(user?.email ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'front-desk');
  const [clinicId, setClinicId] = useState(user?.clinicId ? String(user.clinicId) : '');
  const [doctorId, setDoctorId] = useState(user?.doctorId ? String(user.doctorId) : '');
  const [locale, setLocale] = useState<'ar' | 'en'>(user?.locale ?? 'ar');
  const [theme, setTheme] = useState<'light' | 'dark'>(user?.theme ?? 'light');
  const [active, setActive] = useState(user?.active ?? true);
  // Secrets live only in this component's memory and are wiped after every attempt.
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [errors, setErrors] = useState<{ id: string; text: string }[]>([]);
  const [server, setServer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const doctors = useClinicDoctors(role === 'doctor' && clinicId ? Number(clinicId) : null);
  const wasFrontDesk = user?.role === 'front-desk';
  const needPassword = role !== 'front-desk' && (!user || wasFrontDesk);
  const needPin = role === 'front-desk' && (!user || !wasFrontDesk);
  const showPassword = role !== 'front-desk';
  const showPin = role === 'front-desk' && needPin;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: { id: string; text: string }[] = [];
    if (!EMAIL_RE.test(email.trim()) || email.length > 254) errs.push({ id: 'u-email', text: t('adm.users.reqEmail') });
    if (role !== 'admin' && !clinicId) errs.push({ id: 'u-clinic', text: t('adm.users.reqClinic') });
    const pwBytes = new TextEncoder().encode(password).length;
    if ((needPassword || password) && showPassword && (password.length < 12 || pwBytes > 72)) errs.push({ id: 'u-password', text: t('adm.users.reqPassword') });
    if (showPin && !/^[0-9]{4}$/.test(pin)) errs.push({ id: 'u-pin', text: t('adm.users.reqPin') });
    setErrors(errs); setServer(null);
    if (errs.length) return;
    const base = { email: email.trim(), role, clinicId: clinicId ? Number(clinicId) : null, doctorId: role === 'doctor' && doctorId ? Number(doctorId) : null, locale, theme, active };
    const secret: { password?: string; pin?: string } = {};
    if (showPassword && password) secret.password = password;
    if (showPin) secret.pin = pin;
    setBusy(true);
    try {
      const saved = user
        ? await adminWrite(() => updateAdminUser(user.id, { ...base, ...secret } as AdminUserUpdate))
        : await adminWrite(() => createAdminUser({ ...base, ...secret } as AdminUserInput));
      invalidate({ users: true, doctors: true });
      if (!alive.current) return;
      onDone(t(user ? 'adm.users.updated' : 'adm.users.created', { email: saved.email }));
      onClose();
    } catch (err) {
      if (alive.current) setServer(t(classify(err).key));
    } finally {
      setPassword(''); setPin('');
      if (alive.current) setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => { if (!o) { setPassword(''); setPin(''); onClose(); } }} busy={busy} wide
      title={user ? t('adm.users.editTitle', { email: user.email }) : t('adm.users.createTitle')} testId="dialog-user"
      description={user ? t('adm.users.editWarn') : t('adm.users.secretsNote')}>
      <form className="adm-form" onSubmit={submit} noValidate autoComplete="off">
        <ErrorSummary errors={errors} />
        {server && <Notice tone="danger" testId="status-user-error">{server}</Notice>}
        <TextField id="u-email" label={t('adm.users.email')} type="email" required value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} error={errors.find(x => x.id === 'u-email')?.text} data-testid="input-user-email" />
        <div className="adm-form__row">
          <SelectField id="u-role" label={t('adm.users.role')} value={role} onChange={(v) => { setRole(v as Role); setDoctorId(''); setPin(''); setPassword(''); }} testId="select-user-role" required>
            {(['admin', 'doctor', 'front-desk'] as const).map(r => <option key={r} value={r}>{t(`adm.users.roles.${r}`)}</option>)}
          </SelectField>
          <ClinicSelect id="u-clinic" value={clinicId} onChange={(v) => { setClinicId(v); setDoctorId(''); }} testId="select-user-clinic" required={role !== 'admin'} error={errors.find(x => x.id === 'u-clinic')?.text} />
        </div>
        {role === 'doctor' && (
          <SelectField id="u-doctor" label={t('adm.users.doctor')} value={doctorId} onChange={setDoctorId} testId="select-user-doctor" disabled={!clinicId || doctors.isPending}
            hint={!clinicId ? t('adm.users.pickClinicFirst') : doctors.isPending ? t('adm.users.doctorsLoading') : doctors.data?.length === 0 ? t('adm.users.doctorsNone') : undefined}>
            <option value="">{t('adm.users.noDoctor')}</option>
            {(doctors.data ?? []).map(d => <option key={d.id} value={String(d.id)} disabled={d.userId !== null && d.userId !== user?.id}>{d.name} · {d.specialty} (#{d.id})</option>)}
          </SelectField>
        )}
        <div className="adm-form__row">
          <SelectField id="u-locale" label={t('adm.users.locale')} value={locale} onChange={(v) => setLocale(v as 'ar' | 'en')} testId="select-user-locale">
            <option value="ar">{t('adm.users.localeAr')}</option><option value="en">{t('adm.users.localeEn')}</option>
          </SelectField>
          <SelectField id="u-theme" label={t('adm.users.theme')} value={theme} onChange={(v) => setTheme(v as 'light' | 'dark')} testId="select-user-theme">
            <option value="light">{t('adm.users.themeLight')}</option><option value="dark">{t('adm.users.themeDark')}</option>
          </SelectField>
        </div>
        {showPassword && <TextField id="u-password" type="password" autoComplete="new-password" label={needPassword ? t('adm.users.password') : t('adm.users.newPassword')} required={needPassword}
          hint={t('adm.users.passwordHint')} value={password} maxLength={72} onChange={(e) => setPassword(e.target.value)} error={errors.find(x => x.id === 'u-password')?.text} data-testid="input-user-password" />}
        {showPin && <TextField id="u-pin" type="password" inputMode="numeric" autoComplete="off" label={t('adm.users.pin')} required hint={t('adm.users.pinHint')}
          value={pin} maxLength={4} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} error={errors.find(x => x.id === 'u-pin')?.text} data-testid="input-user-pin" />}
        <label className="adm-check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} data-testid="checkbox-user-active" />{t('adm.users.activeLabel')}</label>
        <div className="adm-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => { setPassword(''); setPin(''); onClose(); }} data-testid="button-user-cancel">{t('adm.common.cancel')}</Button>
          <Button type="submit" loading={busy} data-testid="button-user-submit">{busy ? t('adm.common.saving') : t('adm.common.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

function DeactivateDialog({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useTranslation();
  const alive = useAlive();
  const invalidate = useSharedInvalidate();
  const m = useDeactivateAdminUser();
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setErr(null);
    try {
      await adminWrite(() => m.mutateAsync({ id: user.id }));
      invalidate({ users: true, doctors: true });
      if (alive.current) { onDone(t('adm.users.deactivated', { email: user.email })); onClose(); }
    } catch (e) { if (alive.current) setErr(t(classify(e).key)); }
  };
  return <Confirm open onOpenChange={(o) => !o && onClose()} testId="dialog-deactivate-user" title={t('adm.users.deactivateTitle', { email: user.email })}
    body={t('adm.users.deactivateBody')} confirmLabel={t('adm.users.deactivate')} onConfirm={run} busy={m.isPending} error={err} />;
}

function ReactivateDialog({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useTranslation();
  const alive = useAlive();
  const invalidate = useSharedInvalidate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setErr(null); setBusy(true);
    try {
      await adminWrite(() => updateAdminUser(user.id, { active: true }));
      invalidate({ users: true });
      if (alive.current) { onDone(t('adm.users.reactivated', { email: user.email })); onClose(); }
    } catch (e) { if (alive.current) setErr(t(classify(e).key)); }
    finally { if (alive.current) setBusy(false); }
  };
  return <Confirm open tone="primary" onOpenChange={(o) => !o && onClose()} testId="dialog-reactivate-user" title={t('adm.users.reactivate') + ' · ' + user.email}
    body={t('adm.users.editWarn')} confirmLabel={t('adm.users.reactivate')} onConfirm={run} busy={busy} error={err} />;
}

function PinDialog({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useTranslation();
  const alive = useAlive();
  const invalidate = useSharedInvalidate();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const close = () => { setPin(''); onClose(); };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[0-9]{4}$/.test(pin)) { setFieldErr(t('adm.users.reqPin')); document.getElementById('pin-new')?.focus(); return; }
    setFieldErr(null); setErr(null); setBusy(true);
    const value = pin;
    setPin('');
    try {
      await adminWrite(() => resetAdminUserPin(user.id, { pin: value }));
      invalidate({ users: true });
      if (alive.current) { onDone(t('adm.users.pinDone', { email: user.email })); onClose(); }
    } catch (e2) { if (alive.current) setErr(t(classify(e2).key)); }
    finally { if (alive.current) setBusy(false); }
  };
  return (
    <Modal open onOpenChange={(o) => !o && close()} busy={busy} title={t('adm.users.pinTitle', { email: user.email })} description={t('adm.users.pinBody')} testId="dialog-reset-pin">
      <form className="adm-form" onSubmit={submit} noValidate autoComplete="off">
        {err && <Notice tone="danger" testId="status-pin-error">{err}</Notice>}
        <TextField id="pin-new" type="password" inputMode="numeric" label={t('adm.users.pin')} required hint={t('adm.users.pinHint')} value={pin} maxLength={4}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} error={fieldErr} data-testid="input-reset-pin" />
        <div className="adm-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={close} data-testid="button-pin-cancel">{t('adm.common.cancel')}</Button>
          <Button type="submit" loading={busy} data-testid="button-pin-submit">{t('adm.users.resetPin')}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ================= Devices ================= */
function DevicesPanel() {
  const { t } = useTranslation();
  const fmt = useInstant();
  const online = useOnline();
  const flash = useFlash();
  const clinics = useAllClinics();
  const clinicMap = useMemo(() => new Map((clinics.data ?? []).map(c => [c.id, c.name])), [clinics.data]);
  const [page, setPage] = useState(1);
  const [clinicId, setClinicId] = useState('');
  const [revoked, setRevoked] = useState('');
  const params: ListAdminDevicesParams = { page, pageSize: PAGE_SIZE, ...(clinicId ? { clinicId: Number(clinicId) } : {}), ...(revoked ? { revoked: revoked as 'true' | 'false' } : {}) };
  const list = useListAdminDevices(params, { query: { queryKey: getListAdminDevicesQueryKey(params), retry: (n, e) => !isAuthFailure(e) && n < 1, placeholderData: (p) => p } });
  const [enrolling, setEnrolling] = useState(false);
  const [revoking, setRevoking] = useState<AdminDevice | null>(null);
  return (
    <div className="adm-panel" data-testid="panel-devices">
      <div className="adm-filters">
        <ClinicSelect id="f-dev-clinic" value={clinicId} onChange={(v) => { setClinicId(v); setPage(1); }} testId="select-devices-clinic" allowAll />
        <SelectField id="f-dev-revoked" label={t('adm.devices.status')} value={revoked} onChange={(v) => { setRevoked(v); setPage(1); }} testId="select-devices-revoked">
          <option value="">{t('adm.devices.filterAll')}</option><option value="false">{t('adm.devices.filterActive')}</option><option value="true">{t('adm.devices.filterRevoked')}</option>
        </SelectField>
        <span className="adm-filters__spacer" />
        <Button startIcon={<MonitorSmartphone size={16} aria-hidden="true" />} disabled={!online} onClick={() => { flash.set(null); setEnrolling(true); }} data-testid="button-enroll-device">{t('adm.devices.enroll')}</Button>
      </div>
      {flash.node}
      {list.isPending ? <Skeleton /> : list.isError && (!list.data || isAccessFailure(list.error)) ? <LoadError error={list.error} onRetry={() => void list.refetch()} />
        : !list.data || list.data.items.length === 0 ? <Empty testId="state-devices-empty" title={t('adm.devices.empty')} desc={t('adm.devices.emptyDesc')} />
        : <>
          <div className="adm-table-wrap" role="region" tabIndex={0} aria-label={t('adm.users.tabDevices')} data-testid="region-devices-table"><table className="adm-table" data-testid="table-devices">
            <thead><tr><th>{t('adm.devices.label')}</th><th>{t('adm.devices.clinic')}</th><th>{t('adm.devices.registered')}</th><th>{t('adm.devices.status')}</th><th><span className="shell-sr">{t('adm.devices.revoke')}</span></th></tr></thead>
            <tbody>{list.data.items.map(d => (
              <tr key={d.id} data-testid={`row-device-${d.id}`} className={d.revokedAt ? 'is-muted' : ''}>
                <td><span className="adm-mono adm-strong">{d.label}</span><span className="adm-sub adm-mono">#{d.id}</span></td>
                <td><bdi>{clinicLabel(clinicMap, d.clinicId, t)}</bdi></td>
                <td>{fmt(d.registeredAt)}</td>
                <td data-testid={`status-device-${d.id}`}>{d.revokedAt ? t('adm.devices.revokedStatus', { time: fmt(d.revokedAt) }) : t('adm.devices.activeStatus')}</td>
                <td className="adm-rowact">{!d.revokedAt && <Button size="sm" variant="ghost" className="adm-danger-text" startIcon={<ShieldOff size={14} aria-hidden="true" />} disabled={!online} onClick={() => { flash.set(null); setRevoking(d); }} data-testid={`button-revoke-device-${d.id}`}>{t('adm.devices.revoke')}</Button>}</td>
              </tr>))}
            </tbody>
          </table></div>
          <Pager page={list.data.page} total={list.data.total} onPage={setPage} prefix="devices" />
        </>}
      {enrolling && <EnrollDialog onClose={() => setEnrolling(false)} onDone={(m) => flash.set({ tone: 'success', text: m })} />}
      {revoking && <RevokeDialog device={revoking} onClose={() => setRevoking(null)} onDone={(m) => flash.set({ tone: 'success', text: m })} />}
    </div>
  );
}

function EnrollDialog({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useTranslation();
  const alive = useAlive();
  const invalidate = useSharedInvalidate();
  const m = useEnrollDevice();
  const [clinicId, setClinicId] = useState('');
  const [label, setLabel] = useState('');
  const [errors, setErrors] = useState<{ id: string; text: string }[]>([]);
  const [server, setServer] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: { id: string; text: string }[] = [];
    if (!clinicId) errs.push({ id: 'dev-clinic', text: t('adm.users.reqClinic') });
    if (!LABEL_RE.test(label) || label.length > 100) errs.push({ id: 'dev-label', text: t('adm.devices.labelInvalid') });
    setErrors(errs); setServer(null);
    if (errs.length) return;
    try {
      const d = await adminWrite(() => m.mutateAsync({ data: { clinicId: Number(clinicId), label } }));
      invalidate({ devices: true });
      if (alive.current) { onDone(t('adm.devices.enrolled', { label: d.label })); onClose(); }
    } catch (err) { if (alive.current) setServer(t(classify(err).key)); }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} busy={m.isPending} title={t('adm.devices.enrollTitle')} description={t('adm.devices.enrollBody')} testId="dialog-enroll-device">
      <form className="adm-form" onSubmit={submit} noValidate>
        <ErrorSummary errors={errors} />
        {server && <Notice tone="danger" testId="status-enroll-error">{server}</Notice>}
        <ClinicSelect id="dev-clinic" value={clinicId} onChange={setClinicId} testId="select-device-clinic" required error={errors.find(x => x.id === 'dev-clinic')?.text} />
        <TextField id="dev-label" label={t('adm.devices.label')} required hint={t('adm.devices.labelHint')} value={label} maxLength={100} dir="ltr"
          onChange={(e) => setLabel(e.target.value)} error={errors.find(x => x.id === 'dev-label')?.text} data-testid="input-device-label" />
        <div className="adm-actions">
          <Button type="button" variant="secondary" disabled={m.isPending} onClick={onClose} data-testid="button-enroll-cancel">{t('adm.common.cancel')}</Button>
          <Button type="submit" loading={m.isPending} data-testid="button-enroll-submit">{t('adm.devices.enroll')}</Button>
        </div>
      </form>
    </Modal>
  );
}

function RevokeDialog({ device, onClose, onDone }: { device: AdminDevice; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useTranslation();
  const alive = useAlive();
  const invalidate = useSharedInvalidate();
  const m = useRevokeDevice();
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setErr(null);
    try {
      await adminWrite(() => m.mutateAsync({ id: device.id }));
      invalidate({ devices: true });
      if (alive.current) { onDone(t('adm.devices.revoked', { label: device.label })); onClose(); }
    } catch (e) { if (alive.current) setErr(t(classify(e).key)); }
  };
  return <Confirm open onOpenChange={(o) => !o && onClose()} testId="dialog-revoke-device" title={t('adm.devices.revokeTitle', { label: device.label })}
    body={t('adm.devices.revokeBody')} confirmLabel={t('adm.devices.revoke')} onConfirm={run} busy={m.isPending} error={err} />;
}

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Pencil, Plus, Stethoscope, UserRound } from 'lucide-react';
import { Button, TextField } from '@workspace/amal-ui';
import {
  getListAdminClinicsQueryKey, getListAdminDoctorsQueryKey, useCreateDoctor, useListAdminClinics, useListAdminDoctors, useUpdateClinic, useUpdateDoctor,
  type AdminClinic, type AdminDoctor, type ListAdminClinicsParams, type ListAdminDoctorsParams,
} from '@workspace/api-client-react';
import { isAuthFailure } from '@/auth/errors';
import {
  isAccessFailure, EMAIL_RE, Empty, ErrorSummary, LoadError, Modal, Notice, PageHead, SelectField, Skeleton,
  adminWrite, classify, clinicLabel, useAlive, useAllClinics, useFlash, useInstant, useOnline, useSharedInvalidate,
} from './common';
import { DetailsFields, ScheduleFields, toPayload, validateDetails, validateSchedule, type ClinicDraft, type FieldErr } from './ClinicForm';
import { AddClinicWizard } from './AddClinicWizard';
import './admin.css';

const LIMIT = 25;

function useCursorPager() {
  const [stack, setStack] = useState<string[]>([]);
  const cursor = stack[stack.length - 1];
  return { cursor, index: stack.length, next: (c: string) => setStack(s => [...s, c]), prev: () => setStack(s => s.slice(0, -1)), reset: () => setStack([]) };
}

function CursorNav({ pager, nextCursor, prefix }: { pager: ReturnType<typeof useCursorPager>; nextCursor: string | null; prefix: string }) {
  const { t } = useTranslation();
  if (pager.index === 0 && !nextCursor) return null;
  return (
    <nav className="adm-pager" aria-label={t('adm.audit.pageN', { n: pager.index + 1 })}>
      <Button variant="secondary" size="sm" disabled={pager.index === 0} onClick={pager.prev} data-testid={`button-${prefix}-prev`}>{t('adm.common.prev')}</Button>
      <span data-testid={`text-${prefix}-page`}>{t('adm.audit.pageN', { n: pager.index + 1 })}</span>
      <Button variant="secondary" size="sm" disabled={!nextCursor} onClick={() => nextCursor && pager.next(nextCursor)} data-testid={`button-${prefix}-next`}>{t('adm.common.nextPage')}</Button>
    </nav>
  );
}

export function ClinicsDoctorsPage({ title, accountKey, onClinicsChanged }: { title: string; accountKey: string; onClinicsChanged: () => Promise<void> }) {
  const { t } = useTranslation();
  const fmt = useInstant();
  const online = useOnline();
  const flash = useFlash();
  const all = useAllClinics();
  const clinicMap = useMemo(() => new Map((all.data ?? []).map(c => [c.id, c.name])), [all.data]);
  const cp = useCursorPager();
  const cParams: ListAdminClinicsParams = { limit: LIMIT, ...(cp.cursor ? { cursor: cp.cursor } : {}) };
  const clinics = useListAdminClinics(cParams, { query: { queryKey: getListAdminClinicsQueryKey(cParams), retry: (n, e) => !isAuthFailure(e) && n < 1, placeholderData: (p) => p } });
  const [wizard, setWizard] = useState(false);
  const previousWizard = useRef(false);
  useEffect(() => {
    if (previousWizard.current && !wizard)
      document.querySelector<HTMLButtonElement>('[data-testid="button-add-clinic"]')?.focus();
    previousWizard.current = wizard;
  }, [wizard]);
  const [editClinic, setEditClinic] = useState<AdminClinic | null>(null);

  const [docClinic, setDocClinic] = useState('');
  const dp = useCursorPager();
  const dParams: ListAdminDoctorsParams = { limit: LIMIT, ...(docClinic ? { clinicId: Number(docClinic) } : {}), ...(dp.cursor ? { cursor: dp.cursor } : {}) };
  const doctors = useListAdminDoctors(dParams, { query: { queryKey: getListAdminDoctorsQueryKey(dParams), retry: (n, e) => !isAuthFailure(e) && n < 1, placeholderData: (p) => p } });
  const [doctorDlg, setDoctorDlg] = useState<{ doctor: AdminDoctor | null; clinicId: number | null } | null>(null);

  return (
    <section className="adm" data-testid="page-clinicsDoctors">
      <PageHead id="clinicsDoctors" title={title} lede={t('adm.clinics.lede')} actions={!wizard &&
        <Button startIcon={<Plus size={16} aria-hidden="true" />} disabled={!online} onClick={() => { flash.set(null); setWizard(true); }} data-testid="button-add-clinic">{t('adm.clinics.add')}</Button>} />
      {flash.node}
      {wizard && <AddClinicWizard accountKey={accountKey} knownIds={all.data ? all.data.map(c => c.id) : null} onClose={() => setWizard(false)}
        onCreated={async () => { await onClinicsChanged(); }}
        onAddDoctor={(c) => { setWizard(false); setDoctorDlg({ doctor: null, clinicId: c.id }); }} />}

      <div className="adm-section">
        <h2 className="adm-h2"><Building2 size={20} aria-hidden="true" />{title}</h2>
        {clinics.isPending ? <Skeleton /> : clinics.isError && (!clinics.data || isAccessFailure(clinics.error)) ? <LoadError error={clinics.error} onRetry={() => void clinics.refetch()} />
          : !clinics.data || (clinics.data.items.length === 0 && cp.index === 0) ? <Empty testId="state-clinics-empty" title={t('adm.clinics.empty')} desc={t('adm.clinics.emptyDesc')} />
          : <>
            <ul className="adm-clinic-list" data-testid="list-clinics">
              {clinics.data.items.map(c => (
                <li key={c.id} className="adm-clinic" data-testid={`card-clinic-${c.id}`}>
                  <div className="adm-clinic__main">
                    <p className="adm-clinic__name"><bdi data-testid={`text-clinic-name-${c.id}`}>{c.name}</bdi><bdi dir="ltr" className="adm-sub adm-mono">#{c.id}</bdi></p>
                    <p className="adm-sub"><bdi>{c.city}</bdi> · <bdi>{c.bookingMethod}</bdi></p>
                  </div>
                  <dl className="adm-clinic__facts">
                    <div><dt>{t('adm.clinics.mode')}</dt><dd><span className={`adm-pill adm-pill--${c.mode}`}><Building2 size={14} aria-hidden="true" />{t(`adm.wizard.${c.mode}`)}</span></dd></div>
                    <div><dt>{t('adm.clinics.slot')}</dt><dd>{t('adm.clinics.slotMin', { n: c.slotMinutes })}</dd></div>
                    <div><dt>{t('adm.clinics.days')}</dt><dd>{[...c.workingDays].sort().map(n => t(`adm.days.${n}`)).join(' ')}</dd></div>
                    <div><dt>{t('adm.clinics.hours')}</dt><dd className="adm-mono" dir="ltr">{c.openTime}–{c.closeTime}</dd></div>
                    <div><dt>{t('adm.clinics.timezone')}</dt><dd className="adm-mono" dir="ltr">{c.timezone}</dd></div>
                    <div><dt>{t('adm.clinics.joined')}</dt><dd>{fmt(c.joinedAt)}</dd></div>
                  </dl>
                  <div className="adm-clinic__act">
                    <Button size="sm" variant="secondary" startIcon={<Pencil size={14} aria-hidden="true" />} disabled={!online} onClick={() => { flash.set(null); setEditClinic(c); }} data-testid={`button-edit-clinic-${c.id}`}>{t('adm.common.edit')}</Button>
                    <Button size="sm" variant="ghost" startIcon={<Stethoscope size={14} aria-hidden="true" />} disabled={!online} onClick={() => { flash.set(null); setDoctorDlg({ doctor: null, clinicId: c.id }); }} data-testid={`button-add-doctor-clinic-${c.id}`}>{t('adm.clinics.addDoctor')}</Button>
                  </div>
                </li>))}
            </ul>
            <CursorNav pager={cp} nextCursor={clinics.data.nextCursor} prefix="clinics" />
          </>}
      </div>

      <div className="adm-section">
        <div className="adm-section__head">
          <h2 className="adm-h2"><Stethoscope size={20} aria-hidden="true" />{t('adm.clinics.doctors')}</h2>
          <div className="adm-filters">
            <SelectField id="f-doc-clinic" label={t('adm.users.clinic')} value={docClinic} onChange={(v) => { setDocClinic(v); dp.reset(); }} testId="select-doctors-clinic">
              <option value="">{t('adm.common.allClinics')}</option>
              {(all.data ?? []).map(c => <option key={c.id} value={String(c.id)}>{c.name} (#{c.id})</option>)}
            </SelectField>
            <Button startIcon={<Plus size={16} aria-hidden="true" />} disabled={!online} onClick={() => { flash.set(null); setDoctorDlg({ doctor: null, clinicId: docClinic ? Number(docClinic) : null }); }} data-testid="button-add-doctor">{t('adm.clinics.addDoctor')}</Button>
          </div>
        </div>
        <p className="adm-foot">{t('adm.clinics.doctorNote')}</p>
        {doctors.isPending ? <Skeleton /> : doctors.isError && (!doctors.data || isAccessFailure(doctors.error)) ? <LoadError error={doctors.error} onRetry={() => void doctors.refetch()} />
          : !doctors.data || doctors.data.items.length === 0 ? <Empty testId="state-doctors-empty" title={t('adm.clinics.doctorsEmpty')} desc={t('adm.clinics.doctorsEmptyDesc')} />
          : <>
            <div className="adm-table-wrap" role="region" tabIndex={0} aria-label={t('adm.clinics.doctors')} data-testid="region-doctors-table"><table className="adm-table" data-testid="table-doctors">
              <thead><tr><th>{t('adm.clinics.doctorName')}</th><th>{t('adm.clinics.specialty')}</th><th>{t('adm.users.clinic')}</th><th>{t('adm.clinics.email')}</th><th>{t('adm.clinics.login')}</th><th><span className="shell-sr">{t('adm.common.edit')}</span></th></tr></thead>
              <tbody>{doctors.data.items.map(d => (
                <tr key={d.id} data-testid={`row-doctor-${d.id}`}>
                  <td><bdi className="adm-strong">{d.name}</bdi><bdi dir="ltr" className="adm-sub adm-mono">#{d.id}</bdi></td>
                  <td><bdi>{d.specialty}</bdi></td>
                  <td><bdi>{clinicLabel(clinicMap, d.clinicId, t)}</bdi></td>
                  <td><bdi dir="ltr">{d.email || '—'}</bdi></td>
                  <td data-testid={`status-doctor-login-${d.id}`}><span className="adm-state-chip adm-state-chip--neutral"><UserRound size={14} aria-hidden="true" />{d.userId !== null ? t('adm.clinics.linked', { id: d.userId }) : t('adm.clinics.notLinked')}</span></td>
                  <td className="adm-rowact"><Button size="sm" variant="ghost" startIcon={<Pencil size={14} aria-hidden="true" />} disabled={!online} onClick={() => { flash.set(null); setDoctorDlg({ doctor: d, clinicId: d.clinicId }); }} data-testid={`button-edit-doctor-${d.id}`}>{t('adm.common.edit')}</Button></td>
                </tr>))}
              </tbody>
            </table></div>
            <CursorNav pager={dp} nextCursor={doctors.data.nextCursor} prefix="doctors" />
          </>}
      </div>

      {editClinic && <ClinicEditDialog clinic={editClinic} onClose={() => setEditClinic(null)} onDone={async (m) => { flash.set({ tone: 'success', text: m }); await onClinicsChanged(); }} />}
      {doctorDlg && <DoctorDialog doctor={doctorDlg.doctor} presetClinic={doctorDlg.clinicId} onClose={() => setDoctorDlg(null)} onDone={(m) => flash.set({ tone: 'success', text: m })} />}
    </section>
  );
}

function ClinicEditDialog({ clinic, onClose, onDone }: { clinic: AdminClinic; onClose: () => void; onDone: (m: string) => void | Promise<void> }) {
  const { t } = useTranslation();
  const alive = useAlive();
  const invalidate = useSharedInvalidate();
  const m = useUpdateClinic();
  const [d, setD] = useState<ClinicDraft>({ name: clinic.name, city: clinic.city, bookingMethod: clinic.bookingMethod, slotMinutes: String(clinic.slotMinutes),
    workingDays: clinic.workingDays, openTime: clinic.openTime, closeTime: clinic.closeTime, mode: clinic.mode, timezone: clinic.timezone });
  const [errors, setErrors] = useState<FieldErr[]>([]);
  const [server, setServer] = useState<string | null>(null);
  const set = (p: Partial<ClinicDraft>) => setD(x => ({ ...x, ...p }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = [...validateDetails(d, t), ...validateSchedule(d, t)];
    setErrors(errs); setServer(null);
    if (errs.length) return;
    try {
      const saved = await adminWrite(() => m.mutateAsync({ id: clinic.id, data: toPayload(d) }));
      invalidate({ clinics: true });
      if (!alive.current) return;
      onClose();
      await onDone(t('adm.clinics.updated', { name: saved.name }));
    } catch (err) { if (alive.current) setServer(t(classify(err).key)); }
  };
  return (
    <Modal open wide onOpenChange={(o) => !o && onClose()} busy={m.isPending} title={t('adm.clinics.editTitle', { name: clinic.name })} testId="dialog-edit-clinic">
      <form className="adm-form" onSubmit={submit} noValidate>
        <ErrorSummary errors={errors} />
        {server && <Notice tone="danger" testId="status-clinic-error">{server}</Notice>}
        <DetailsFields d={d} set={set} errors={errors} />
        <ScheduleFields d={d} set={set} errors={errors} />
        <div className="adm-actions">
          <Button type="button" variant="secondary" disabled={m.isPending} onClick={onClose} data-testid="button-clinic-cancel">{t('adm.common.cancel')}</Button>
          <Button type="submit" loading={m.isPending} data-testid="button-clinic-submit">{m.isPending ? t('adm.common.saving') : t('adm.common.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

function DoctorDialog({ doctor, presetClinic, onClose, onDone }: { doctor: AdminDoctor | null; presetClinic: number | null; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useTranslation();
  const alive = useAlive();
  const invalidate = useSharedInvalidate();
  const all = useAllClinics();
  const createM = useCreateDoctor();
  const updateM = useUpdateDoctor();
  const busy = createM.isPending || updateM.isPending;
  const [name, setName] = useState(doctor?.name ?? '');
  const [clinicId, setClinicId] = useState(presetClinic ? String(presetClinic) : '');
  const [specialty, setSpecialty] = useState(doctor?.specialty ?? '');
  const [email, setEmail] = useState(doctor?.email ?? '');
  const [errors, setErrors] = useState<FieldErr[]>([]);
  const [server, setServer] = useState<string | null>(null);
  const err = (id: string) => errors.find(e => e.id === id)?.text;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: FieldErr[] = [];
    if (!name.trim() || name.trim().length > 200) errs.push({ id: 'doc-name', text: t('adm.wizard.nameReq') });
    if (!clinicId) errs.push({ id: 'doc-clinic', text: t('adm.users.reqClinic') });
    if (!specialty.trim() || specialty.trim().length > 200) errs.push({ id: 'doc-specialty', text: t('adm.common.required') });
    if (!EMAIL_RE.test(email.trim()) || email.length > 254) errs.push({ id: 'doc-email', text: t('adm.users.reqEmail') });
    setErrors(errs); setServer(null);
    if (errs.length) return;
    const data = { name: name.trim(), clinicId: Number(clinicId), specialty: specialty.trim(), email: email.trim() };
    try {
      const saved = doctor
        ? await adminWrite(() => updateM.mutateAsync({ id: doctor.id, data }))
        : await adminWrite(() => createM.mutateAsync({ data }));
      invalidate({ doctors: true });
      if (alive.current) { onDone(t(doctor ? 'adm.clinics.doctorUpdated' : 'adm.clinics.doctorCreated', { name: saved.name })); onClose(); }
    } catch (e2) { if (alive.current) setServer(t(classify(e2).key)); }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} busy={busy} title={doctor ? t('adm.clinics.doctorEditTitle', { name: doctor.name }) : t('adm.clinics.doctorCreateTitle')}
      description={doctor?.userId ? t('adm.clinics.moveWarn') : t('adm.clinics.doctorNote')} testId="dialog-doctor">
      <form className="adm-form" onSubmit={submit} noValidate>
        <ErrorSummary errors={errors} />
        {server && <Notice tone="danger" testId="status-doctor-error">{server}</Notice>}
        <TextField id="doc-name" name="name" label={t('adm.clinics.doctorName')} required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} error={err('doc-name')} data-testid="input-doctor-name" />
        <SelectField id="doc-clinic" label={t('adm.users.clinic')} value={clinicId} onChange={setClinicId} testId="select-doctor-clinic" required error={err('doc-clinic')} disabled={all.isPending}>
          <option value="">{all.isPending ? t('adm.common.clinicLoading') : t('adm.common.none')}</option>
          {(all.data ?? []).map(c => <option key={c.id} value={String(c.id)}>{c.name} (#{c.id})</option>)}
        </SelectField>
        <TextField id="doc-specialty" name="specialty" label={t('adm.clinics.specialty')} required maxLength={200} value={specialty} onChange={(e) => setSpecialty(e.target.value)} error={err('doc-specialty')} data-testid="input-doctor-specialty" />
        <TextField id="doc-email" name="email" type="email" label={t('adm.clinics.email')} required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} error={err('doc-email')} data-testid="input-doctor-email" />
        <div className="adm-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose} data-testid="button-doctor-cancel">{t('adm.common.cancel')}</Button>
          <Button type="submit" loading={busy} data-testid="button-doctor-submit">{busy ? t('adm.common.saving') : t('adm.common.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

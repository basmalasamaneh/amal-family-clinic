import { useTranslation } from 'react-i18next';
import { TextField } from '@workspace/amal-ui';
import type { ClinicDraft, FieldErr } from './model';
export { EMPTY_DRAFT, validateDetails, validateSchedule, toPayload, type ClinicDraft, type FieldErr } from './model';

export function DetailsFields({ d, set, errors }: { d: ClinicDraft; set: (p: Partial<ClinicDraft>) => void; errors: FieldErr[] }) {
  const { t } = useTranslation();
  const err = (id: string) => errors.find(e => e.id === id)?.text;
  return <>
    <TextField id="clinic-name" name="name" label={t('adm.clinics.name')} required maxLength={200} value={d.name} onChange={(e) => set({ name: e.target.value })} error={err('clinic-name')} data-testid="input-clinic-name" />
    <TextField id="clinic-city" name="city" label={t('adm.clinics.city')} required maxLength={200} value={d.city} onChange={(e) => set({ city: e.target.value })} error={err('clinic-city')} data-testid="input-clinic-city" />
    <TextField id="clinic-booking" name="bookingMethod" label={t('adm.clinics.booking')} hint={t('adm.wizard.bookingHint')} required maxLength={200} value={d.bookingMethod} onChange={(e) => set({ bookingMethod: e.target.value })} error={err('clinic-booking')} data-testid="input-clinic-booking" />
  </>;
}

export function ScheduleFields({ d, set, errors }: { d: ClinicDraft; set: (p: Partial<ClinicDraft>) => void; errors: FieldErr[] }) {
  const { t } = useTranslation();
  const err = (id: string) => errors.find(e => e.id === id)?.text;
  const dayErr = err('clinic-day-0');
  const toggle = (n: number) => set({ workingDays: d.workingDays.includes(n) ? d.workingDays.filter(x => x !== n) : [...d.workingDays, n] });
  return <>
    <TextField id="clinic-slot" name="slotMinutes" type="number" inputMode="numeric" min={1} max={1440} step={1} label={t('adm.clinics.slot')} hint={t('adm.wizard.slotHint')} required
      value={d.slotMinutes} onChange={(e) => set({ slotMinutes: e.target.value })} error={err('clinic-slot')} data-testid="input-clinic-slot" />
    <fieldset className="adm-fieldset" aria-describedby={dayErr ? 'clinic-days-error' : 'clinic-days-hint'} aria-invalid={dayErr ? true : undefined}>
      <legend className="amal-field__label">{t('adm.clinics.days')}<span className="amal-field__req" aria-hidden="true">*</span></legend>
      <div className="adm-days">
        {[0, 1, 2, 3, 4, 5, 6].map(n => (
          <label key={n} className={`adm-day${d.workingDays.includes(n) ? ' is-on' : ''}`}>
            <input id={`clinic-day-${n}`} name="workingDays" type="checkbox" checked={d.workingDays.includes(n)} onChange={() => toggle(n)} data-testid={`checkbox-clinic-day-${n}`} />
            <span>{t(`adm.days.${n}`)}</span>
          </label>))}
      </div>
      <p id="clinic-days-hint" className="amal-field__hint">{t('adm.wizard.daysHint')}</p>
      {dayErr && <p id="clinic-days-error" className="adm-field-error">{dayErr}</p>}
    </fieldset>
    <div className="adm-form__row">
      <TextField id="clinic-open" name="openTime" type="time" label={t('adm.wizard.openTime')} required value={d.openTime} onChange={(e) => set({ openTime: e.target.value })} error={err('clinic-open')} data-testid="input-clinic-open" />
      <TextField id="clinic-close" name="closeTime" type="time" label={t('adm.wizard.closeTime')} required value={d.closeTime} onChange={(e) => set({ closeTime: e.target.value })} error={err('clinic-close')} data-testid="input-clinic-close" />
    </div>
    <p className="amal-field__hint adm-tight">{t('adm.wizard.hoursHint')}</p>
    <p className="amal-field__hint" data-testid="text-clinic-adoption-policy">{t('adm.clinics.adoptionPolicy')}</p>
    <TextField id="clinic-tz" name="timezone" label={t('adm.clinics.timezone')} hint={t('adm.wizard.tzHint')} required dir="ltr" maxLength={100} value={d.timezone} onChange={(e) => set({ timezone: e.target.value })} error={err('clinic-tz')} data-testid="input-clinic-timezone" />
  </>;
}

export function ClinicSummary({ d }: { d: ClinicDraft }) {
  const { t } = useTranslation();
  const days = [...d.workingDays].sort((a, b) => a - b).map(n => t(`adm.days.${n}`)).join(' · ');
  return (
    <dl className="adm-review" data-testid="list-clinic-review">
      <div><dt>{t('adm.clinics.name')}</dt><dd data-testid="text-review-name"><bdi>{d.name.trim()}</bdi></dd></div>
      <div><dt>{t('adm.clinics.city')}</dt><dd><bdi>{d.city.trim()}</bdi></dd></div>
      <div><dt>{t('adm.clinics.booking')}</dt><dd><bdi>{d.bookingMethod.trim()}</bdi></dd></div>
      <div><dt>{t('adm.clinics.slot')}</dt><dd>{t('adm.clinics.slotMin', { n: d.slotMinutes })}</dd></div>
      <div><dt>{t('adm.clinics.days')}</dt><dd>{days}</dd></div>
      <div><dt>{t('adm.clinics.hours')}</dt><dd className="adm-mono" dir="ltr">{d.openTime}–{d.closeTime}</dd></div>
      <div><dt>{t('adm.clinics.mode')}</dt><dd>{t(`adm.wizard.${d.mode}`)}</dd></div>
      <div><dt>{t('adm.clinics.timezone')}</dt><dd className="adm-mono" dir="ltr">{d.timezone.trim()}</dd></div>
    </dl>
  );
}

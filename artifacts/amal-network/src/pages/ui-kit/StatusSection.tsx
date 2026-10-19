import { useTranslation } from 'react-i18next';
import { APPOINTMENT_STATUSES, StatusBadge } from '@workspace/amal-ui';
import { Section } from './Section';

export function StatusSection({ index }: { index: number }) {
  const { t } = useTranslation();
  return (
    <Section id="status" index={index} intro={t('kit.status.intro')}>
      <ul className="kit-row kit-plain" aria-label={t('kit.sections.status')}>
        {APPOINTMENT_STATUSES.map((s) => <li key={s}><StatusBadge status={s} /></li>)}
      </ul>
      <h3 className="kit-sub">{t('kit.status.large')}</h3>
      <ul className="kit-row kit-plain">
        {APPOINTMENT_STATUSES.map((s) => <li key={s}><StatusBadge status={s} size="lg" /></li>)}
      </ul>
      <h3 className="kit-sub">{t('kit.status.inline')}</h3>
      <ul className="kit-rows kit-plain">
        {APPOINTMENT_STATUSES.map((s, i) => (
          <li key={s} className="kit-rowitem">
            <span className="kit-rowitem__time" dir="ltr">{`${String(9 + i).padStart(2, '0')}:30`}</span>
            <span className="kit-rowitem__label">{t('kit.status.rowLabel')} {i + 1}</span>
            <StatusBadge status={s} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

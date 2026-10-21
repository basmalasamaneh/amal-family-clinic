import { useTranslation } from 'react-i18next';
import { AMAL_UI_NS } from '../i18n';
import { useAmalPreferences } from '../preferences/PreferencesProvider';
import type { Density } from '../preferences/account-storage';
import { Segmented } from './Segmented';

/** Compact / Comfortable / Large. Stored per user; applies instantly. */
export function DensitySwitch() {
  const { t } = useTranslation(AMAL_UI_NS);
  const { density, setDensity } = useAmalPreferences();
  return (
    <Segmented label={t('density.groupLabel')} value={density} onChange={(v: Density) => setDensity(v)}
      options={(['compact', 'comfortable', 'large'] as const).map((d) => ({ value: d, label: t(`density.${d}`), testId: `button-density-${d}` }))} />
  );
}

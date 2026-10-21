import { useTranslation } from 'react-i18next';
import { AMAL_UI_NS } from '../i18n';

const mark = new URL('../assets/amal-logo-mark.svg', import.meta.url).href;
const horizontal = new URL('../assets/amal-logo-horizontal.svg', import.meta.url).href;
const horizontalDark = new URL('../assets/amal-logo-horizontal-dark.svg', import.meta.url).href;
const compact = new URL('../assets/amal-logo-afc.svg', import.meta.url).href;
const compactDark = new URL('../assets/amal-logo-afc-dark.svg', import.meta.url).href;

export function AmalMark({ size = 40, className }: { size?: number; className?: string }) {
  const { t } = useTranslation(AMAL_UI_NS);
  return <img src={mark} width={size} height={size} alt={t('brand.markLabel')} className={className} />;
}

/** Supplied outlined artwork; presentation selects the lockup and theme. */
export function AmalLogo({ className }: { className?: string }) {
  const { t } = useTranslation(AMAL_UI_NS);
  return (
    <span className="amal-logo-island" data-testid="img-logo" role="img" aria-label={t('brand.logoLabel')}>
      <img src={horizontal} alt="" aria-hidden="true" className={`${className ?? 'amal-logo'} amal-logo-art amal-logo-art--horizontal amal-logo-art--light`} />
      <img src={horizontalDark} alt="" aria-hidden="true" className={`${className ?? 'amal-logo'} amal-logo-art amal-logo-art--horizontal amal-logo-art--dark`} />
      <img src={compact} alt="" aria-hidden="true" className={`${className ?? 'amal-logo'} amal-logo-art amal-logo-art--compact amal-logo-art--light`} />
      <img src={compactDark} alt="" aria-hidden="true" className={`${className ?? 'amal-logo'} amal-logo-art amal-logo-art--compact amal-logo-art--dark`} />
    </span>
  );
}

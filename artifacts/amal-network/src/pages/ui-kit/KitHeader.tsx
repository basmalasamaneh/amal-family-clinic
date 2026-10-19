import { useTranslation } from 'react-i18next';
import { AmalLogo, LanguageSwitch, ThemeSwitch } from '@workspace/amal-ui';

export function KitHeader() {
  const { t } = useTranslation();
  return (
    <header className="kit-header">
      <div className="kit-header__inner">
        <div className="kit-header__brand">
          <AmalLogo />
          <span className="kit-header__crumb">{t('app.name')} · {t('app.kitTitle')}</span>
        </div>
        <div className="kit-header__controls">
          <LanguageSwitch />
          <ThemeSwitch />
        </div>
      </div>
    </header>
  );
}

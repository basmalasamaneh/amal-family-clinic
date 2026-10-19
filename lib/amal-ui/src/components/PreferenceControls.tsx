import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AMAL_UI_NS, type AmalLocale } from '../i18n';
import { useAmalPreferences } from '../preferences/PreferencesProvider';
import type { AmalTheme } from '../preferences/storage';
import { Segmented } from './Segmented';

export function LanguageSwitch() {
  const { t } = useTranslation(AMAL_UI_NS);
  const { locale, setLocale } = useAmalPreferences();
  return (
    <Segmented
      label={t('language.groupLabel')}
      value={locale}
      onChange={(value: AmalLocale) => setLocale(value)}
      options={[
        { value: 'ar', label: t('language.ar'), lang: 'ar', testId: 'button-locale-ar' },
        { value: 'en', label: t('language.en'), lang: 'en', testId: 'button-locale-en' },
      ]}
    />
  );
}

export function ThemeSwitch() {
  const { t } = useTranslation(AMAL_UI_NS);
  const { theme, setTheme } = useAmalPreferences();
  return (
    <Segmented
      label={t('theme.groupLabel')}
      value={theme}
      onChange={(value: AmalTheme) => setTheme(value)}
      options={[
        { value: 'light', label: t('theme.light'), icon: <Sun size={16} aria-hidden="true" />, testId: 'button-theme-light' },
        { value: 'dark', label: t('theme.dark'), icon: <Moon size={16} aria-hidden="true" />, testId: 'button-theme-dark' },
      ]}
    />
  );
}

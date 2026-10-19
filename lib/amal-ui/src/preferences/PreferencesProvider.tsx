import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import type { i18n as I18n } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { directionFor, type AmalLocale } from '../i18n';
import { applyDocumentPreferences, LOCALE_KEY, readStoredLocale, readStoredTheme, safeSet, THEME_KEY, type AmalTheme } from './storage';

interface PreferencesValue {
  locale: AmalLocale;
  dir: 'rtl' | 'ltr';
  theme: AmalTheme;
  setLocale: (l: AmalLocale) => void;
  setTheme: (t: AmalTheme) => void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

/** Owns locale + theme; keeps <html lang/dir/data-theme>, i18next and localStorage in sync. */
export function AmalPreferencesProvider({ i18n, children }: { i18n: I18n; children: ReactNode }) {
  const [locale, setLocaleState] = useState<AmalLocale>(readStoredLocale);
  const [theme, setThemeState] = useState<AmalTheme>(readStoredTheme);

  useLayoutEffect(() => {
    if (i18n.language !== locale) void i18n.changeLanguage(locale);
    applyDocumentPreferences(locale, theme);
  }, [i18n, locale, theme]);

  const setLocale = useCallback((l: AmalLocale) => { safeSet(LOCALE_KEY, l); setLocaleState(l); }, []);
  const setTheme = useCallback((t: AmalTheme) => { safeSet(THEME_KEY, t); setThemeState(t); }, []);

  const value = useMemo(() => ({ locale, dir: directionFor(locale), theme, setLocale, setTheme }), [locale, theme, setLocale, setTheme]);
  return (
    <I18nextProvider i18n={i18n}>
      <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
    </I18nextProvider>
  );
}

export function useAmalPreferences(): PreferencesValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('useAmalPreferences must be used inside <AmalPreferencesProvider>');
  return ctx;
}

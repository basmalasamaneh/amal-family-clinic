import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import type { i18n as I18n } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { directionFor, type AmalLocale } from '../i18n';
import { applyDocumentPreferences, LOCALE_KEY, readStoredLocale, readStoredTheme, safeSet, THEME_KEY, type AmalTheme } from './storage';
import { browserPreferenceStorage, DEFAULT_DISPLAY, type DigitPreference, type PreferenceStorage } from './account-storage';

interface PreferencesValue {
  locale: AmalLocale;
  dir: 'rtl' | 'ltr';
  theme: AmalTheme;
  setLocale: (l: AmalLocale) => void;
  setTheme: (t: AmalTheme) => void;
  digitPreference: DigitPreference;
  setDigitPreference: (d: DigitPreference) => void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

/** Owns locale + theme; keeps <html lang/dir/data-theme>, i18next and localStorage in sync. */
export function AmalPreferencesProvider({ i18n, children, userId, storage = browserPreferenceStorage }: { i18n: I18n; children: ReactNode; userId?: string | null; storage?: PreferenceStorage }) {
  // Remount the state owner on account changes, including callers that omit a React key.
  return <PreferencesState key={userId === undefined ? 'showcase' : userId === null ? 'anonymous' : `user:${userId}`} i18n={i18n} userId={userId} storage={storage}>{children}</PreferencesState>;
}

function PreferencesState({ i18n, children, userId, storage }: { i18n: I18n; children: ReactNode; userId?: string | null; storage: PreferenceStorage }) {
  const [preferences, setPreferences] = useState(() => userId === undefined
    ? { locale: readStoredLocale(), theme: readStoredTheme(), digitPreference: 'latn' as DigitPreference }
    : userId === null ? { ...DEFAULT_DISPLAY } : storage.read(userId));
  const { locale, theme, digitPreference } = preferences;

  useLayoutEffect(() => {
    if (i18n.language !== locale) void i18n.changeLanguage(locale);
    applyDocumentPreferences(locale, theme);
  }, [i18n, locale, theme]);

  useLayoutEffect(() => {
    if (typeof userId === 'string') storage.write(userId, preferences);
  }, [userId, preferences, storage]);
  const setLocale = useCallback((l: AmalLocale) => { if (userId === undefined) safeSet(LOCALE_KEY, l); setPreferences(p => ({ ...p, locale: l })); }, [userId]);
  const setTheme = useCallback((t: AmalTheme) => { if (userId === undefined) safeSet(THEME_KEY, t); setPreferences(p => ({ ...p, theme: t })); }, [userId]);
  const setDigitPreference = useCallback((d: DigitPreference) => { setPreferences(p => ({ ...p, digitPreference: d })); }, []);

  const value = useMemo(() => ({ locale, dir: directionFor(locale), theme, setLocale, setTheme, digitPreference, setDigitPreference }), [locale, theme, setLocale, setTheme, digitPreference, setDigitPreference]);
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

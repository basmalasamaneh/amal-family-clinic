import { DEFAULT_LOCALE, directionFor, type AmalLocale } from '../i18n';

export type AmalTheme = 'light' | 'dark';
export const LOCALE_KEY = 'amal.locale';
export const THEME_KEY = 'amal.theme';

const safeGet = (k: string): string | null => {
  try { return window.localStorage.getItem(k); } catch { return null; }
};
export const safeSet = (k: string, v: string): void => {
  try { window.localStorage.setItem(k, v); } catch { /* storage unavailable */ }
};

export function readStoredLocale(): AmalLocale {
  const v = typeof window === 'undefined' ? null : safeGet(LOCALE_KEY);
  return v === 'en' || v === 'ar' ? v : DEFAULT_LOCALE;
}
export function readStoredTheme(): AmalTheme {
  if (typeof window === 'undefined') return 'light';
  const v = safeGet(THEME_KEY);
  return v === 'dark' || v === 'light' ? v : 'light';
}

/** Applies language, direction and theme to <html> in one step. */
export function applyDocumentPreferences(locale: AmalLocale, theme: AmalTheme): void {
  const el = document.documentElement;
  el.lang = locale;
  el.dir = directionFor(locale);
  el.dataset.theme = theme;
  el.classList.toggle('dark', theme === 'dark');
}

/** Applies display density to <html data-density>; type scale tokens follow instantly. */
export function applyDocumentDensity(density: 'compact' | 'comfortable' | 'large'): void {
  document.documentElement.dataset.density = density;
}

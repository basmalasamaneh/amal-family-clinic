import type { AmalLocale } from '../i18n';
import type { AmalTheme } from './storage';

export type DigitPreference = 'latn' | 'arab';
export interface DisplayPreferences { locale: AmalLocale; theme: AmalTheme; digitPreference: DigitPreference }
export const DEFAULT_DISPLAY: DisplayPreferences = { locale: 'ar', theme: 'light', digitPreference: 'latn' };
export interface PreferenceStorage {
  read(userId: string): DisplayPreferences;
  write(userId: string, preferences: DisplayPreferences): void;
}
const keyFor = (id: string) => `amal.display.v1:${encodeURIComponent(id)}`;
/** Browser-local, stable-identity scoped. Never persists credentials or source data. */
export const browserPreferenceStorage: PreferenceStorage = {
  read(id) {
    try {
      const value: unknown = JSON.parse(window.localStorage.getItem(keyFor(id)) ?? 'null');
      if (!value || typeof value !== 'object') return { ...DEFAULT_DISPLAY };
      const p = value as Partial<DisplayPreferences>;
      return {
        locale: p.locale === 'en' ? 'en' : 'ar',
        theme: p.theme === 'dark' ? 'dark' : 'light',
        digitPreference: p.digitPreference === 'arab' ? 'arab' : 'latn',
      };
    } catch { return { ...DEFAULT_DISPLAY }; }
  },
  write(id, preferences) {
    try { window.localStorage.setItem(keyFor(id), JSON.stringify(preferences)); } catch { /* browser storage may be disabled */ }
  },
};

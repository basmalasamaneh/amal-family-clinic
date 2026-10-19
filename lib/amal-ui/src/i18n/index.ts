import i18next, { type i18n as I18n, type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './ar.json';
import en from './en.json';

/** Namespace used by every Amal UI component. App strings stay in `translation`. */
export const AMAL_UI_NS = 'amalUi';
export type AmalLocale = 'ar' | 'en';
export const AMAL_LOCALES: readonly AmalLocale[] = ['ar', 'en'];
export const DEFAULT_LOCALE: AmalLocale = 'ar';

export const amalUiResources = { ar: { [AMAL_UI_NS]: ar }, en: { [AMAL_UI_NS]: en } } as const;

export const directionFor = (locale: AmalLocale): 'rtl' | 'ltr' => (locale === 'ar' ? 'rtl' : 'ltr');

/**
 * Creates the shared i18next instance. Pass app catalogs as
 * `{ ar: { translation: {...} }, en: { translation: {...} } }`.
 */
export function createAmalI18n(appResources: Resource = {}, initialLocale: AmalLocale = DEFAULT_LOCALE): I18n {
  const instance = i18next.createInstance();
  const resources: Resource = {};
  for (const lng of AMAL_LOCALES) {
    resources[lng] = { ...(appResources[lng] ?? {}), ...amalUiResources[lng] };
  }
  void instance.use(initReactI18next).init({
    resources,
    lng: initialLocale,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...AMAL_LOCALES],
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return instance;
}

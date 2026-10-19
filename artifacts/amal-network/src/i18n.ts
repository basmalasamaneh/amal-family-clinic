import { createAmalI18n, readStoredLocale } from '@workspace/amal-ui';
import ar from './locales/ar.json';
import en from './locales/en.json';

export const i18n = createAmalI18n({ ar: { translation: ar }, en: { translation: en } }, readStoredLocale());

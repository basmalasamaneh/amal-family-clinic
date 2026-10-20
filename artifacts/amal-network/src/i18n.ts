import { createAmalI18n } from '@workspace/amal-ui';
import ar from './locales/ar.json';
import en from './locales/en.json';

// Account identity is not yet known: never initialize from showcase/another account's settings.
export const i18n = createAmalI18n({ ar: { translation: ar }, en: { translation: en } }, 'ar');

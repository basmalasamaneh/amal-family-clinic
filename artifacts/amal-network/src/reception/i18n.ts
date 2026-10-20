import { i18n } from '../i18n';
import { receptionAr, receptionEn } from './strings';

let done = false;
/** Registers reception strings under "rx" without editing shared locale files. Idempotent. */
export function registerReceptionStrings(): void {
  if (done) return; done = true;
  i18n.addResourceBundle('en', 'translation', { rx: receptionEn }, true, false);
  i18n.addResourceBundle('ar', 'translation', { rx: receptionAr }, true, false);
}
registerReceptionStrings();

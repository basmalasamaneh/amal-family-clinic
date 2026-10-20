import { i18n } from '../i18n';
import { consentAr, consentEn } from './strings';

let done = false;
/** Registers consent strings under "cs" without editing shared locale files. Idempotent. */
export function registerConsentStrings(): void {
  if (done) return; done = true;
  i18n.addResourceBundle('en', 'translation', { cs: consentEn }, true, false);
  i18n.addResourceBundle('ar', 'translation', { cs: consentAr }, true, false);
}
registerConsentStrings();

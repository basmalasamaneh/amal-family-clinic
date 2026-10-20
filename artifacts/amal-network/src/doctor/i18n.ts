import { i18n } from '../i18n';
import { doctorAr, doctorEn } from './strings';

let done = false;
/** Registers doctor strings under "doc" without editing shared locale files. Idempotent. */
export function registerDoctorStrings(): void {
  if (done) return; done = true;
  i18n.addResourceBundle('en', 'translation', { doc: doctorEn }, true, false);
  i18n.addResourceBundle('ar', 'translation', { doc: doctorAr }, true, false);
}
registerDoctorStrings();

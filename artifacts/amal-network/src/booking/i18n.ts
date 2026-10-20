import { i18n } from '../i18n';
import { bookingAr, bookingEn } from './strings';

/** Registers booking strings without editing the shared locale files. Idempotent. */
let done = false;
export function registerBookingStrings(): void {
  if (done) return; done = true;
  i18n.addResourceBundle('en', 'translation', { bk: bookingEn }, true, false);
  i18n.addResourceBundle('ar', 'translation', { bk: bookingAr }, true, false);
}
registerBookingStrings();

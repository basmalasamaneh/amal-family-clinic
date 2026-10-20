import { i18n } from '../i18n';
import { alertLabelsAr, alertLabelsEn, networkAr, networkEn } from './strings';

let done = false;
/** Registers network strings under "net" without editing shared locale files. Idempotent. */
export function registerNetworkStrings(): void {
  if (done) return; done = true;
  i18n.addResourceBundle('en', 'translation', { net: networkEn, alerts: alertLabelsEn }, true, false);
  i18n.addResourceBundle('ar', 'translation', { net: networkAr, alerts: alertLabelsAr }, true, false);
}
registerNetworkStrings();

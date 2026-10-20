import { i18n } from '../i18n';
import { adoptionAr, adoptionEn } from './strings';

let done = false;
export function registerAdoptionStrings(): void {
  if (done) return; done = true;
  i18n.addResourceBundle('en', 'translation', { adoption: adoptionEn, shell: { nav: { adoption: adoptionEn.nav } } }, true, false);
  i18n.addResourceBundle('ar', 'translation', { adoption: adoptionAr, shell: { nav: { adoption: adoptionAr.nav } } }, true, false);
}
registerAdoptionStrings();

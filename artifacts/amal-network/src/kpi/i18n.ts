import { i18n } from '../i18n';
import { kpiAr, kpiEn } from './strings';

let done = false;
/** Registers KPI strings under "kpi" without editing shared locale files. Idempotent. */
export function registerKpiStrings(): void {
  if (done) return; done = true;
  i18n.addResourceBundle('en', 'translation', { kpi: kpiEn }, true, false);
  i18n.addResourceBundle('ar', 'translation', { kpi: kpiAr }, true, false);
}
registerKpiStrings();

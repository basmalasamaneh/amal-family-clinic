import type { TFunction } from 'i18next';
import { i18n } from '../i18n';
import { importAr, importEn } from './strings';
import { failure } from './model';

let done = false;
/** Registers import/duplicate strings under "im" without editing shared locale files. Idempotent. */
export function registerImportStrings(): void {
  if (done) return; done = true;
  i18n.addResourceBundle('en', 'translation', { im: importEn }, true, false);
  i18n.addResourceBundle('ar', 'translation', { im: importAr }, true, false);
}
registerImportStrings();

/** Localized message for an API failure; server text is never shown. */
export function errorText(t: TFunction, e: unknown): string {
  const f = failure(e);
  if (f.code && i18n.exists(`im.err.${f.code}`)) return t(`im.err.${f.code}`, { row: String(f.params.row ?? '') });
  const k = f.kind === 'stale' ? 'conflict' : f.kind;
  return t(`im.err.${k}`);
}
/** Localized issue label; unknown codes stay readable without becoming translation keys. */
export function issueText(t: TFunction, code: string): string {
  return i18n.exists(`im.issue.${code}`) ? t(`im.issue.${code}`) : t('im.issue.unknown', { code });
}

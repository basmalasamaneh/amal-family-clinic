/** Search-only normalization. Never used to rewrite or link a stored patient name. */
const MARKS = /[\u0300-\u036f\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g;
const AR_DIGITS = /[\u0660-\u0669\u06f0-\u06f9]/g;
export function toAsciiDigits(s: string): string {
  return s.replace(AR_DIGITS, (c) => String((c.charCodeAt(0) & 0xf) % 10));
}
export function normalizeForSearch(input: string): string {
  return toAsciiDigits(input)
    .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0649/g, '\u064a')
    .normalize('NFKD')
    .replace(MARKS, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
export const digitsOnly = (s: string) => toAsciiDigits(s).replace(/\D/g, '');
/** True when the query matches by normalized name substring, or by 3+ phone digits. */
export function matchesPatient(p: { name: string; phone: string | null }, query: string): boolean {
  const q = normalizeForSearch(query);
  if (!q) return false;
  if (normalizeForSearch(p.name).includes(q)) return true;
  const d = digitsOnly(query);
  return d.length >= 3 && d.length === q.replace(/[\s+()-]/g, '').length && digitsOnly(p.phone ?? "").includes(d);
}

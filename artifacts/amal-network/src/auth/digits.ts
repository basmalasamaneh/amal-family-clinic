const MAP: Record<string, string> = {};
'٠١٢٣٤٥٦٧٨٩'.split('').forEach((d, i) => { MAP[d] = String(i); });
'۰۱۲۳۴۵۶۷۸۹'.split('').forEach((d, i) => { MAP[d] = String(i); });
/** PIN only: Arabic-Indic / Persian digits to ASCII, non-digits dropped, kept as a string (leading zeros survive). Never used for passwords. */
export function normalizePin(raw: string, max = 4): string {
  let out = '';
  for (const ch of raw) {
    const d = MAP[ch] ?? (ch >= '0' && ch <= '9' ? ch : '');
    if (d) out += d;
    if (out.length >= max) break;
  }
  return out;
}
export const isValidPin = (pin: string) => /^[0-9]{4}$/.test(pin);
export const isPlausibleEmail = (v: string) => v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

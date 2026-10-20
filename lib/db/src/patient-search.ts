/** Search suggestions only, never an identity or merge decision.
 * NFKD also folds compatibility forms; tatweel is decoration and is removed.
 */
export function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/ـ/g, "").trim().replace(/\s+/gu, " ").toLowerCase();
}

/** ASCII digits, optional leading +; only visual separators are removed.
 * No numeric conversion, country inference, trunk removal or transliteration.
 */
export function canonicalPhone(value: string): string | null {
  const phone = value.trim().replace(/[\s().-]/gu, "");
  return /^\+?[0-9]{3,20}$/.test(phone) ? phone : null;
}

function distance(a: string, b: string, bound: number): number {
  const x = Array.from(a), y = Array.from(b);
  if (Math.abs(x.length - y.length) > bound) return bound + 1;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) {
      row[j] = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + Number(x[i - 1] !== y[j - 1]));
    }
    if (Math.min(...row) > bound) return bound + 1;
    prev = row;
  }
  return prev[y.length]!;
}

/** Lower is better: exact 0, substring 100, fuzzy 201/202.
 * Fuzzy: whole-name Levenshtein, >=4 chars, <=64 chars, max 1 edit
 * for lengths 4–7, max 2 for >=8, and similarity >=75%.
 */
export function searchScore(query: string, name: string, phone: string): number | null {
  const q = normalizeName(query), n = normalizeName(name);
  if (!q) return 0;
  const qp = canonicalPhone(query), p = canonicalPhone(phone);
  if (q === n || (qp !== null && qp === p)) return 0;
  if (q.length >= 2 && (n.includes(q) || (qp !== null && p?.includes(qp)))) return 100;
  const ql = Array.from(q).length, nl = Array.from(n).length;
  if (ql < 4 || ql > 64 || nl > 64 || !/\p{L}/u.test(q)) return null;
  const bound = ql < 8 ? 1 : 2;
  const edits = distance(q, n, bound);
  return edits <= bound && edits / Math.max(ql, nl) <= 0.25 ? 200 + edits : null;
}

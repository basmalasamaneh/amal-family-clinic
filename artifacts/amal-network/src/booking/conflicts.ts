import type { ConflictItem, ConflictItemSuggestedSlotsItem, ConflictPreview } from '@workspace/api-client-react';

export interface ConflictSummary {
  blocking: ConflictItem[]; warnings: ConflictItem[]; info: ConflictItem[];
  /** Patient warnings only: may be committed with a trimmed nonblank reason. */
  overrideable: boolean;
  /** Up to three server-provided slots, server order preserved, deduplicated. */
  suggestions: ConflictItemSuggestedSlotsItem[];
}
const ALWAYS_BLOCKING = new Set(['doctor-overlap', 'outside-hours', 'slot-held']);
/** Fail-closed classification: only patient-overlap warnings are overrideable; only same-day notices are informational. */
export function classify(c: ConflictItem): 'blocking' | 'warning' | 'info' {
  if (ALWAYS_BLOCKING.has(c.type)) return 'blocking';
  if (c.type === 'patient-overlap') return c.severity === 'blocking' ? 'blocking' : 'warning';
  if (c.type === 'same-day-other-clinic' && c.severity === 'info') return 'info';
  return 'blocking';
}
export function summarize(p: ConflictPreview): ConflictSummary {
  const blocking = p.conflicts.filter((c) => classify(c) === 'blocking');
  const warnings = p.conflicts.filter((c) => classify(c) === 'warning');
  const info = p.conflicts.filter((c) => classify(c) === 'info');
  const seen = new Set<string>(); const suggestions: ConflictItemSuggestedSlotsItem[] = [];
  for (const c of p.conflicts) for (const s of c.suggestedSlots ?? []) {
    const k = s.startsAt + '|' + s.endsAt;
    if (seen.has(k) || suggestions.length >= 3) continue;
    seen.add(k); suggestions.push(s);
  }
  return { blocking, warnings, info, overrideable: blocking.length === 0 && warnings.length > 0, suggestions };
}
export const cleanReason = (r: string) => r.trim();
/** Client gate only (fails closed); the server decides authoritatively at commit. */
export function commitAllowed(p: ConflictPreview | null, reason: string): boolean {
  if (!p) return false;
  const s = summarize(p);
  if (s.blocking.length) return false;
  if (s.warnings.length) { const r = cleanReason(reason); return r.length > 0 && r.length <= 2000; }
  return p.ok === true;
}

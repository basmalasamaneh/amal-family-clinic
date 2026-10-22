/** Deliberately transport-free. These states never represent delivery. */
export type PreviewPhase = 'ready' | 'animating' | 'simulated';
export type PreviewAction = 'simulate' | 'finish' | 'reset';
export function previewReducer(phase: PreviewPhase, action: PreviewAction): PreviewPhase {
  if (action === 'reset') return 'ready';
  if (action === 'simulate' && phase === 'ready') return 'animating';
  if (action === 'finish' && phase === 'animating') return 'simulated';
  return phase;
}
export function previewText(entry: { textAr: string; textEn: string }, language: string): string {
  return language.startsWith('ar') ? entry.textAr : entry.textEn;
}

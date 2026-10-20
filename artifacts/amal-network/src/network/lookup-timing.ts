/** Ephemeral, monotonic attempt state. No query, patient or identity enters telemetry. */
export class LookupTiming {
  private started: number | null = null;
  private generation = 0;
  constructor(private now: () => number, private send: (body: { durationMs: number }) => Promise<unknown>) {}
  input(nonempty: boolean) {
    this.generation++;
    if (!nonempty) this.cancel();
    else if (this.started === null) this.started = this.now();
  }
  submit() { if (this.started === null) this.started = this.now(); }
  request() { return this.started === null ? null : ++this.generation; }
  cancel() { this.started = null; this.generation++; }
  complete(token: number) {
    if (this.started === null || token !== this.generation) return;
    const durationMs = Math.round(this.now() - this.started);
    this.cancel(); // Consume before transport; failures and duplicate effects never retry.
    if (!Number.isSafeInteger(durationMs) || durationMs < 0) return;
    try { void this.send({ durationMs }).catch(() => {}); } catch { /* Best effort, never affects clinical results. */ }
  }
}

/** A conservative visible-card milestone: entry animations finish, then two visible frames.
 * IntersectionObserver accounts for viewport and clipping; hit testing excludes overlays.
 * Nothing is measured while hidden; callers also cancel on visibility changes.
 */
export function observePaintedCard(root: HTMLElement, complete: () => void): () => void {
  let stopped = false, frame = 0, visibleFrames = 0;
  const intersecting = new Set<Element>();
  const cards = Array.from(root.querySelectorAll<HTMLElement>('.net-card'));
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0) intersecting.add(entry.target);
      else intersecting.delete(entry.target);
    }
  });
  cards.forEach(card => observer.observe(card));
  const visible = (card: HTMLElement) => {
    if (!intersecting.has(card) || !card.isConnected) return false;
    for (let el: HTMLElement | null = card; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) < 1) return false;
      if (el.getAnimations().some(a => a.playState === 'running' || a.pending)) return false;
    }
    const r = card.getBoundingClientRect();
    const left = Math.max(0, r.left), right = Math.min(innerWidth, r.right);
    const top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
    if (right <= left || bottom <= top) return false;
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return !!hit && card.contains(hit);
  };
  const tick = () => {
    if (stopped) return;
    if (document.visibilityState !== 'visible') { stop(); return; }
    visibleFrames = cards.some(visible) ? visibleFrames + 1 : 0;
    if (visibleFrames >= 2) { stop(); complete(); return; }
    frame = requestAnimationFrame(tick);
  };
  const stop = () => { stopped = true; cancelAnimationFrame(frame); observer.disconnect(); };
  frame = requestAnimationFrame(tick);
  return stop;
}

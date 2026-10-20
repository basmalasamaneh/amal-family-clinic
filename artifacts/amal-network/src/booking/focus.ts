import type { BookingContext } from '../calendar/booking';
import { localMinutesOf } from '../calendar/dates';

/** Ordered focus targets on the calendar after the drawer route closes. */
export function returnFocusTargets(ctx: BookingContext | null, createdId: number | null): string[] {
  const out: string[] = [];
  if (createdId) out.push(`[data-testid="card-appointment-${createdId}"]`);
  if (ctx?.startsAt && ctx.doctorId) out.push(`[data-testid="slot-${ctx.doctorId}-${localMinutesOf(ctx.startsAt)}"]`);
  out.push(ctx?.source === 'walk-in' ? '[data-testid="link-walk-in"]' : '[data-testid="link-new-booking"]');
  out.push('#page-title');
  return out;
}
/** Polls briefly while the calendar route mounts/loads, then focuses the first present target. */
export function focusAfterNavigation(selectors: string[], doc: Document = document, tries = 40, delay = 50): void {
  let n = 0;
  const attempt = () => {
    // The specific targets win while data loads; the heading is the last resort.
    const specific = selectors.slice(0, -1);
    for (const s of n < tries - 1 ? specific : selectors) {
      const el = doc.querySelector<HTMLElement>(s);
      if (el) { el.focus(); return; }
    }
    if (++n < tries) setTimeout(attempt, delay);
  };
  setTimeout(attempt, 0);
}

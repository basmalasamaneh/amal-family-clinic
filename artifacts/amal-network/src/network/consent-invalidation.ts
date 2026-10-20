import { CONSENT_CHANGED_EVENT } from './model';

// Memory-only invalidation: no patient identifiers or consent data leave this tab.
const pending = new Set<string>();
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('amal-consent-invalidation') : null;
const notify = () => {
  if (typeof document !== 'undefined') document.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
};
if (channel) channel.onmessage = ({ data }: MessageEvent<unknown>) => {
  if (!data || typeof data !== 'object') return;
  const { token, phase } = data as { token?: unknown; phase?: unknown };
  if (typeof token !== 'string' || token.length > 100) return;
  if (phase === 'begin') pending.add(token);
  else if (phase === 'end') pending.delete(token);
  else return;
  notify();
};

export function clinicalDataBlocked(): boolean { return pending.size > 0; }

/** Clear and suspend protected reads before sending a write, not just after it. */
export function invalidateClinicalData(): string {
  const token = crypto.randomUUID();
  pending.add(token);
  notify();
  channel?.postMessage({ phase: 'begin', token });
  return token;
}

/** Only after the write outcome and authoritative consent have been reconciled. */
export function completeClinicalInvalidation(token: string): void {
  pending.delete(token);
  notify();
  channel?.postMessage({ phase: 'end', token });
}

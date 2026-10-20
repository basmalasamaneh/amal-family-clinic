import type { OutboxRecord } from '../offline/types';

export type QueueSummary = { waiting: number; attention: number };
/** Presentation only: acknowledged evidence is never removed from storage here. */
export function summarizeQueue(rows: OutboxRecord[]): QueueSummary {
  const active = rows.filter(row => row.status !== 'succeeded');
  return {
    waiting: active.length,
    attention: active.filter(row => row.status === 'conflict' || row.errorCode === 'rejected').length,
  };
}
export function connectionState(online: boolean, state: 'loading' | 'locked' | 'error' | 'ready', counts: QueueSummary | null) {
  if (state !== 'ready' || !counts) return state === 'ready' ? 'error' : state;
  if (counts.attention) return 'attention';
  return online ? 'online' : 'offline';
}

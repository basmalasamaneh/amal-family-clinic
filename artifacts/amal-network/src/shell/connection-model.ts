import type { BookingProposal, OutboxRecord } from '../offline/types';

export type QueueSummary = {
  /** Legacy total: all unacknowledged work, including attention and held rows. */
  waiting: number;
  /** Queued/in-flight/retryable work, not evidence of server confirmation or readiness. */
  pending: number;
  attention: number;
  held: number;
};
/** Presentation only: acknowledged evidence is never removed from storage here. */
export function summarizeQueue(rows: OutboxRecord[], proposals: Pick<BookingProposal, 'userId' | 'clinicId' | 'operationId' | 'outcome'>[] = []): QueueSummary {
  const active = rows.filter(row => row.status !== 'succeeded');
  const outcomes = new Map(proposals.map(p => [JSON.stringify([p.userId, p.clinicId, p.operationId]), p.outcome]));
  const kind = (row: OutboxRecord) => {
    const outcome = outcomes.get(JSON.stringify([row.userId, row.clinicId, row.operationId]));
    if (row.status === 'conflict' || outcome === 'conflict') return 'attention';
    // Older clients stored blocked acknowledgements as rejected. Only matching
    // proposal evidence can distinguish them; ambiguous rejections need attention.
    if (outcome === 'blocked' || row.errorCode === 'blocked') return 'held';
    if (outcome === 'rejected' || row.errorCode === 'rejected' || row.errorCode === 'conflict') return 'attention';
    return 'pending';
  };
  const blockers = active.filter(row => kind(row) !== 'pending');
  let pending = 0, attention = 0, held = 0;
  for (const row of active) {
    const category = kind(row);
    if (category === 'attention') attention++;
    else if (category === 'held' || (row.booking && blockers.some(prior =>
      prior.booking?.deviceId === row.booking!.deviceId && prior.booking.sequence < row.booking!.sequence))) held++;
    else pending++;
  }
  return {
    waiting: active.length,
    pending, attention, held,
  };
}
export function connectionState(online: boolean, state: 'loading' | 'locked' | 'error' | 'ready', counts: QueueSummary | null) {
  if (state !== 'ready' || !counts) return state === 'ready' ? 'error' : state;
  if (counts.attention || counts.held) return 'attention';
  return online ? 'online' : 'offline';
}

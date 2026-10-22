/** Hide confirmed cancellations from schedules, without changing stored history. */
export function visibleOnSchedule(status: string): boolean {
  return status !== 'cancelled';
}

export interface CancellationTarget { id: number; clinicId: number; version: number }
export interface PendingCancellation {
  target: CancellationTarget; operationId: string; deadline: number;
  state: 'pending' | 'sending' | 'failed';
}

/** Memory-only deferred writes. At the exact deadline Undo loses to cancellation. */
export class CancellationStore {
  private entries = new Map<number, PendingCancellation>();
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();
  private snapshot: PendingCancellation[] = [];
  private generation = 0;
  constructor(
    private commit: (entry: PendingCancellation) => Promise<void>,
    private changed: () => void,
    private acknowledged: () => void,
    private now = Date.now,
    private uuid: () => string = () => crypto.randomUUID(),
  ) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private emit() { this.snapshot = [...this.entries.values()]; this.listeners.forEach((f) => f()); }
  schedule(target: CancellationTarget) {
    if (this.entries.has(target.id)) return;
    this.entries.set(target.id, { target, operationId: this.uuid(), deadline: this.now() + 10000, state: 'pending' });
    this.timers.set(target.id, setTimeout(() => this.expire(target.id), 10000));
    this.emit();
  }
  undo(id: number): boolean {
    const item = this.entries.get(id);
    if (!item || item.state !== 'pending') return false;
    if (this.now() >= item.deadline) { this.expire(id); return false; }
    clearTimeout(this.timers.get(id)); this.timers.delete(id); this.entries.delete(id); this.emit();
    return true;
  }
  private expire(id: number) {
    const item = this.entries.get(id);
    if (!item || item.state !== 'pending') return;
    const remaining = item.deadline - this.now();
    if (remaining > 0) { this.timers.set(id, setTimeout(() => this.expire(id), remaining)); return; }
    clearTimeout(this.timers.get(id)); this.timers.delete(id);
    void this.send(item);
  }
  retry(id: number) {
    const item = this.entries.get(id);
    if (item?.state === 'failed') void this.send(item);
  }
  dismiss(id: number) {
    if (this.entries.get(id)?.state !== 'failed') return;
    this.entries.delete(id); this.emit();
  }
  private async send(item: PendingCancellation) {
    const generation = this.generation;
    item.state = 'sending'; this.emit();
    try {
      await this.commit(item);
      if (generation !== this.generation) return;
      this.entries.delete(item.target.id); this.acknowledged();
    } catch {
      if (generation !== this.generation) return;
      item.state = 'failed';
    }
    if (generation !== this.generation) return;
    this.changed(); this.emit();
  }
  /** Logout/full reload discard unsent work. Already-sent requests remain server authoritative. */
  clear() {
    ++this.generation;
    this.timers.forEach(clearTimeout); this.timers.clear(); this.entries.clear(); this.emit();
  }
}

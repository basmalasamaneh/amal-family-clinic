import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CancellationStore } from '../../artifacts/amal-network/src/calendar/cancellation-store';

describe('deferred operational cancellation', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());
  const target = { id: 7, clinicId: 5, version: 2 };
  function setup(commit = vi.fn(async () => {})) {
    const changed = vi.fn(); const acknowledged = vi.fn();
    const store = new CancellationStore(commit, changed, acknowledged, Date.now, () => 'fixed-operation');
    return { store, commit, changed, acknowledged };
  }
  it('retains the server appointment and supports undo until just before the deadline', async () => {
    const { store, commit } = setup();
    store.schedule(target);
    await vi.advanceTimersByTimeAsync(9999);
    expect(commit).not.toHaveBeenCalled();
    expect(store.undo(7)).toBe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(commit).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toEqual([]);
  });
  it('deadline is exclusive even when timeout delivery is delayed', async () => {
    const { store, commit } = setup();
    store.schedule(target);
    vi.setSystemTime(10000);
    expect(store.undo(7)).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(commit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it('cannot schedule duplicate clicks or undo an in-flight mutation', async () => {
    const commit = vi.fn(() => new Promise<void>(() => {}));
    const { store } = setup(commit);
    store.schedule(target); store.schedule(target);
    await vi.advanceTimersByTimeAsync(10000);
    expect(store.undo(7)).toBe(false);
    store.retry(7);
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it('failure restores authoritative presentation and retry reuses the identical operation', async () => {
    const commit = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce();
    const { store, changed, acknowledged } = setup(commit);
    store.schedule(target);
    await vi.advanceTimersByTimeAsync(10000);
    expect(store.getSnapshot()[0].state).toBe('failed');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(acknowledged).not.toHaveBeenCalled();
    store.retry(7); await vi.advanceTimersByTimeAsync(0);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit.mock.calls[0]).toEqual(commit.mock.calls[1]);
    expect(acknowledged).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual([]);
  });
  it('unsubscribing transient views does not lose undo; logout discards unsent work', async () => {
    const { store, commit } = setup();
    const unsubscribe = store.subscribe(vi.fn());
    store.schedule(target); unsubscribe();
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.getSnapshot()[0].state).toBe('pending');
    store.clear();
    await vi.advanceTimersByTimeAsync(10000);
    expect(commit).not.toHaveBeenCalled();
  });
  it('discard suppresses late responses belonging to an ended session', async () => {
    let finish!: () => void;
    const { store, acknowledged, changed } = setup(vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })));
    store.schedule(target);
    await vi.advanceTimersByTimeAsync(10000);
    store.clear(); finish(); await vi.advanceTimersByTimeAsync(0);
    expect(acknowledged).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toEqual([]);
  });
});

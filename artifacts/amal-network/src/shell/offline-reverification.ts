/** A background /me retry never changes the signed continuation deadline. */
export const ONLINE_REVERIFY_INTERVAL = 30_000;
export type ReverificationThrottle = { nextAttemptAt: number; inFlight: boolean };

export function startOfflineReverification<T>(options: {
  expiresAt: number;
  throttle: ReverificationThrottle;
  canVerify: () => boolean;
  /** Responses may revoke authority themselves, so request eligibility can change
   * during /me. Still deliver that denial to the current session owner. */
  isCurrent?: () => boolean;
  verify: () => Promise<T>;
  onVerified: (value: T) => void;
  onError: (error: unknown) => void;
  clock?: {
    now: () => number;
    setTimeout: (callback: () => void, delay: number) => number;
    clearTimeout: (timer: number) => void;
  };
}): () => void {
  const clock = options.clock ?? {
    now: Date.now,
    setTimeout: (callback: () => void, delay: number) => window.setTimeout(callback, delay),
    clearTimeout: (timer: number) => window.clearTimeout(timer),
  };
  let cancelled = false;
  let timer: number | undefined;
  const eligible = () => !cancelled && Number.isFinite(options.expiresAt) &&
    clock.now() < options.expiresAt && options.canVerify();
  const current = () => !cancelled && clock.now() < options.expiresAt &&
    (options.isCurrent ?? options.canVerify)();
  const schedule = () => {
    if (!eligible()) return;
    const delay = Math.max(0, options.throttle.nextAttemptAt - clock.now());
    // Expiry belongs to the session owner, not to this retry mechanism.
    if (clock.now() + delay >= options.expiresAt) return;
    timer = clock.setTimeout(attempt, delay);
  };
  const attempt = async () => {
    timer = undefined;
    if (!eligible()) return;
    if (options.throttle.inFlight) {
      options.throttle.nextAttemptAt = Math.max(options.throttle.nextAttemptAt, clock.now() + ONLINE_REVERIFY_INTERVAL);
      schedule();
      return;
    }
    options.throttle.inFlight = true;
    options.throttle.nextAttemptAt = clock.now() + ONLINE_REVERIFY_INTERVAL;
    try {
      const result = await options.verify();
      if (current()) options.onVerified(result);
    } catch (error) {
      if (current()) options.onError(error);
    } finally {
      options.throttle.inFlight = false;
      options.throttle.nextAttemptAt = Math.max(options.throttle.nextAttemptAt, clock.now() + ONLINE_REVERIFY_INTERVAL);
      schedule();
    }
  };
  schedule();
  return () => {
    cancelled = true;
    if (timer !== undefined) clock.clearTimeout(timer);
  };
}

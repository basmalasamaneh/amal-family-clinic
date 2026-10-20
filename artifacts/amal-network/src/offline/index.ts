import { browserInvalidationTransport, LocalCacheController } from './controller';

/** One lifecycle owner per browser tab. Import has no private context and never unlocks cached data. */
export const localCache = new LocalCacheController({
  transport: browserInvalidationTransport(),
  proactiveProbe: typeof window !== 'undefined',
});

export { LocalCacheController, browserInvalidationTransport } from './controller';
export type { InvalidationTransport, LocalCacheOptions } from './controller';
export { appointmentWindow, formatHebronInstant, CACHE_TIME_ZONE } from './calendar';
export type * from './types';

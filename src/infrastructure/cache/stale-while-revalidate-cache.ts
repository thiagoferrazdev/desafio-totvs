import { Clock } from '../../application/ports/clock';
import { cacheLookups, cacheRefreshDuration } from '../../shared/metrics';

export type CacheResult = 'hit' | 'stale' | 'miss' | 'stale_if_error';

export interface StaleWhileRevalidateCacheOptions {
  name: string;
  freshForMs: number;
  serveStaleWhileRefreshingForMs: number;
  serveStaleOnErrorForMs: number;
  ttlJitterRatio: number;
  clock: Clock;
  onBackgroundRefreshFailed: (error: unknown) => void;
}

export interface CachedValue<T> {
  value: T;
  result: CacheResult;
  ageMs: number;
}

interface CacheEntry<T> {
  value: T;
  storedAt: number;
  freshForMs: number;
}

export class StaleWhileRevalidateCache<T> {
  private readonly entriesByKey = new Map<string, CacheEntry<T>>();
  private readonly loadsInProgressByKey = new Map<string, Promise<T>>();

  constructor(
    private readonly options: StaleWhileRevalidateCacheOptions,
    private readonly random: () => number = Math.random,
  ) {}

  async getOrLoad(key: string, loadFromSource: () => Promise<T>): Promise<CachedValue<T>> {
    const entry = this.entriesByKey.get(key);
    if (!entry) return this.loadMissingValue(key, loadFromSource);

    const ageMs = this.options.clock.now() - entry.storedAt;
    if (ageMs < entry.freshForMs) return this.respond('hit', entry.value, ageMs);
    if (ageMs < entry.freshForMs + this.options.serveStaleWhileRefreshingForMs) {
      this.refreshInBackground(key, loadFromSource);
      return this.respond('stale', entry.value, ageMs);
    }
    return this.reloadExpiredValue(key, loadFromSource, entry, ageMs);
  }

  private async loadMissingValue(key: string, loadFromSource: () => Promise<T>): Promise<CachedValue<T>> {
    const loadedValue = await this.loadOnce(key, loadFromSource);
    return this.respond('miss', loadedValue, 0);
  }

  private async reloadExpiredValue(
    key: string,
    loadFromSource: () => Promise<T>,
    entry: CacheEntry<T>,
    ageMs: number,
  ): Promise<CachedValue<T>> {
    try {
      const loadedValue = await this.loadOnce(key, loadFromSource);
      return this.respond('miss', loadedValue, 0);
    } catch (error) {
      if (ageMs >= this.options.serveStaleOnErrorForMs) throw error;
      this.options.onBackgroundRefreshFailed(error);
      return this.respond('stale_if_error', entry.value, ageMs);
    }
  }

  private refreshInBackground(key: string, loadFromSource: () => Promise<T>): void {
    this.loadOnce(key, loadFromSource).catch((error) => this.options.onBackgroundRefreshFailed(error));
  }

  private loadOnce(key: string, loadFromSource: () => Promise<T>): Promise<T> {
    const loadInProgress = this.loadsInProgressByKey.get(key);
    if (loadInProgress) return loadInProgress;

    const stopTimer = cacheRefreshDuration.startTimer();
    const load = loadFromSource()
      .then((value) => this.store(key, value))
      .finally(() => {
        stopTimer();
        this.loadsInProgressByKey.delete(key);
      });
    this.loadsInProgressByKey.set(key, load);
    return load;
  }

  private store(key: string, value: T): T {
    this.entriesByKey.set(key, { value, storedAt: this.options.clock.now(), freshForMs: this.freshnessWithJitter() });
    return value;
  }

  private freshnessWithJitter(): number {
    const randomBetweenMinusOneAndOne = this.random() * 2 - 1;
    return this.options.freshForMs * (1 + randomBetweenMinusOneAndOne * this.options.ttlJitterRatio);
  }

  private respond(result: CacheResult, value: T, ageMs: number): CachedValue<T> {
    cacheLookups.inc({ cache: this.options.name, result });
    return { value, result, ageMs };
  }
}

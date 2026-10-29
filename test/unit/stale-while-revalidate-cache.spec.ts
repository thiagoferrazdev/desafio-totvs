import { StaleWhileRevalidateCache } from '../../src/infrastructure/cache/stale-while-revalidate-cache';
import { sleep } from '../../src/shared/timing';

function createCacheWithManualClock(clock: { now: number }, onBackgroundRefreshFailed = jest.fn()) {
  return new StaleWhileRevalidateCache<string>({
    name: 'test',
    freshForMs: 1_000,
    serveStaleWhileRefreshingForMs: 2_000,
    serveStaleOnErrorForMs: 10_000,
    ttlJitterRatio: 0,
    clock: { now: () => clock.now },
    onBackgroundRefreshFailed,
  });
}

const failingSource = async (): Promise<string> => {
  throw new Error('erp down');
};

describe('StaleWhileRevalidateCache', () => {
  it('serves from cache while fresh and loads from the source only once', async () => {
    const clock = { now: 0 };
    const cache = createCacheWithManualClock(clock);
    let sourceCalls = 0;
    const loadFromSource = async () => `value-${++sourceCalls}`;

    expect((await cache.getOrLoad('key', loadFromSource)).result).toBe('miss');
    clock.now = 999;
    expect(await cache.getOrLoad('key', loadFromSource)).toMatchObject({ value: 'value-1', result: 'hit' });
    expect(sourceCalls).toBe(1);
  });

  it('collapses 100 concurrent misses into a single source call (cache stampede protection)', async () => {
    const cache = createCacheWithManualClock({ now: 0 });
    let sourceCalls = 0;
    const slowSource = async () => {
      sourceCalls += 1;
      await sleep(20);
      return 'value';
    };

    const results = await Promise.all(Array.from({ length: 100 }, () => cache.getOrLoad('key', slowSource)));

    expect(sourceCalls).toBe(1);
    expect(results.every((cached) => cached.value === 'value')).toBe(true);
  });

  it('serves the stale value immediately after expiry and refreshes in the background', async () => {
    const clock = { now: 0 };
    const cache = createCacheWithManualClock(clock);
    let sourceCalls = 0;
    const loadFromSource = async () => `value-${++sourceCalls}`;
    await cache.getOrLoad('key', loadFromSource);

    clock.now = 1_500;
    expect(await cache.getOrLoad('key', loadFromSource)).toMatchObject({ value: 'value-1', result: 'stale' });
    await sleep(5);
    expect(await cache.getOrLoad('key', loadFromSource)).toMatchObject({ value: 'value-2', result: 'hit' });
  });

  it('reloads synchronously once the value is past the stale window', async () => {
    const clock = { now: 0 };
    const cache = createCacheWithManualClock(clock);
    await cache.getOrLoad('key', async () => 'value-1');

    clock.now = 5_000;

    expect(await cache.getOrLoad('key', async () => 'value-2')).toMatchObject({ value: 'value-2', result: 'miss' });
  });

  it('serves stale data when the source fails, but only up to the configured limit', async () => {
    const clock = { now: 0 };
    const onBackgroundRefreshFailed = jest.fn();
    const cache = createCacheWithManualClock(clock, onBackgroundRefreshFailed);
    await cache.getOrLoad('key', async () => 'value-1');

    clock.now = 5_000;
    expect(await cache.getOrLoad('key', failingSource)).toMatchObject({ value: 'value-1', result: 'stale_if_error' });
    expect(onBackgroundRefreshFailed).toHaveBeenCalledTimes(1);

    clock.now = 20_000;
    await expect(cache.getOrLoad('key', failingSource)).rejects.toThrow('erp down');
  });

  it('fails when the source fails and nothing was cached yet', async () => {
    const cache = createCacheWithManualClock({ now: 0 });

    await expect(cache.getOrLoad('key', failingSource)).rejects.toThrow('erp down');
  });

  it('keeps the current value and reports the error when a background refresh fails', async () => {
    const clock = { now: 0 };
    const onBackgroundRefreshFailed = jest.fn();
    const cache = createCacheWithManualClock(clock, onBackgroundRefreshFailed);
    await cache.getOrLoad('key', async () => 'value-1');

    clock.now = 1_500;
    await cache.getOrLoad('key', failingSource);
    await sleep(5);

    expect(onBackgroundRefreshFailed).toHaveBeenCalledWith(expect.objectContaining({ message: 'erp down' }));
    expect((await cache.getOrLoad('key', async () => 'value-2')).value).toBe('value-1');
  });

  it('spreads expirations with jitter so keys do not all expire together', async () => {
    const clock = { now: 0 };
    const withJitter = new StaleWhileRevalidateCache<string>(
      {
        name: 'test',
        freshForMs: 1_000,
        serveStaleWhileRefreshingForMs: 0,
        serveStaleOnErrorForMs: 0,
        ttlJitterRatio: 0.1,
        clock: { now: () => clock.now },
        onBackgroundRefreshFailed: jest.fn(),
      },
      () => 1,
    );
    await withJitter.getOrLoad('key', async () => 'value');

    clock.now = 1_050;

    expect((await withJitter.getOrLoad('key', async () => 'other')).result).toBe('hit');
  });
});

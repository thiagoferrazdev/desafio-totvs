import { CachedErpProductCatalog } from '../../../src/infrastructure/erp/cached-erp-product-catalog';
import { SystemClock } from '../../../src/infrastructure/clock/system-clock';
import { loadConfigFromEnvironment } from '../../../src/infrastructure/config/app-config';
import { PinoNestLogger } from '../../../src/infrastructure/logging/pino-nest-logger';
import { logger } from '../../../src/shared/logger';
import { sleep } from '../../../src/shared/timing';

describe('loadConfigFromEnvironment', () => {
  afterEach(() => {
    delete process.env.PORT;
  });

  it('uses the value from the environment when it is set', () => {
    process.env.PORT = '8080';

    expect(loadConfigFromEnvironment().port).toBe(8080);
  });

  it('falls back to the default when it is not set', () => {
    expect(loadConfigFromEnvironment().port).toBe(3000);
  });
});

describe('SystemClock', () => {
  it('returns the current time', () => {
    const before = Date.now();

    expect(new SystemClock().now()).toBeGreaterThanOrEqual(before);
  });
});

describe('CachedErpProductCatalog', () => {
  it('logs a warning and keeps serving the old catalog when the background refresh fails', async () => {
    const clock = { now: 0 };
    const listProducts = jest
      .fn()
      .mockResolvedValueOnce([{ sku: 'A', name: 'Capinha', priceInCents: 1_000 }])
      .mockRejectedValue(new Error('ERP returned 503'));
    const catalog = new CachedErpProductCatalog(
      { listProducts },
      { freshForMs: 10, serveStaleWhileRefreshingForMs: 1_000, serveStaleOnErrorForMs: 1_000, ttlJitterRatio: 0 },
      { now: () => clock.now },
    );
    const warn = jest.spyOn(logger, 'warn');
    await catalog.loadSnapshot();

    clock.now = 50;
    const snapshot = await catalog.loadSnapshot();
    await sleep(5);

    expect(snapshot.freshness).toBe('stale');
    expect(warn).toHaveBeenCalledWith(expect.anything(), 'catalog refresh failed, serving stale data');
    warn.mockRestore();
  });
});

describe('PinoNestLogger', () => {
  it('forwards every Nest log level to pino', () => {
    const nestLogger = new PinoNestLogger();
    const spies = (['info', 'error', 'warn', 'debug', 'trace'] as const).map((level) => jest.spyOn(logger, level));

    nestLogger.log('started', 'App');
    nestLogger.error('boom', 'stack', 'App');
    nestLogger.warn('careful', 'App');
    nestLogger.debug('details', 'App');
    nestLogger.verbose('more details', 'App');

    for (const spy of spies) {
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    }
  });
});

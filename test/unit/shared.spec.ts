import { logLevelFor, requestContextFields } from '../../src/shared/logger';
import {
  addOrderIdToRequestContext,
  currentRequestContext,
  getRequestContext,
  RequestContext,
  runWithRequestContext,
} from '../../src/shared/request-context';
import {
  buildTraceparentHeader,
  clearRecentSpans,
  getRecentSpans,
  parseTraceparentHeader,
  runInSpan,
} from '../../src/shared/tracing';

describe('logger configuration', () => {
  it('uses LOG_LEVEL when it is set, otherwise silent in tests and info everywhere else', () => {
    expect(logLevelFor({ LOG_LEVEL: 'debug' })).toBe('debug');
    expect(logLevelFor({ NODE_ENV: 'test' })).toBe('silent');
    expect(logLevelFor({ NODE_ENV: 'production' })).toBe('info');
  });

  it('adds the request context to every log line, and nothing outside a request', () => {
    const context: RequestContext = { correlationId: 'c-1', traceId: 't-1', spanId: 's-1', orderId: 'o-1' };

    expect(requestContextFields()).toEqual({});
    expect(runWithRequestContext(context, requestContextFields)).toEqual({
      correlationId: 'c-1',
      traceId: 't-1',
      spanId: 's-1',
      orderId: 'o-1',
    });
  });
});

describe('request context', () => {
  it('fails loudly when someone asks for the context outside a request', () => {
    expect(() => currentRequestContext()).toThrow('No request context');
  });

  it('ignores an order id when there is no request going on', () => {
    expect(() => addOrderIdToRequestContext('order-1')).not.toThrow();
    expect(getRequestContext()).toBeUndefined();
  });

  it('copies the order id to the root of the request so the access log shows it', () => {
    const root: RequestContext = { correlationId: 'c-1', traceId: 't-1' };
    const child: RequestContext = { correlationId: 'c-1', traceId: 't-1', requestRoot: root };

    runWithRequestContext(child, () => addOrderIdToRequestContext('order-1'));
    runWithRequestContext(root, () => addOrderIdToRequestContext('order-1'));

    expect(child.orderId).toBe('order-1');
    expect(root.orderId).toBe('order-1');
  });
});

describe('tracing', () => {
  beforeEach(() => clearRecentSpans());

  it('starts a new trace when there is no parent span', async () => {
    await runInSpan('standalone', {}, () => 'done');

    const [span] = getRecentSpans();
    expect(span).toMatchObject({ name: 'standalone', parentSpanId: undefined });
    expect(span!.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('records the error message whether the failure is an Error or not', async () => {
    await expect(runInSpan('fails-with-error', {}, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(runInSpan('fails-with-string', {}, () => Promise.reject('plain failure'))).rejects.toBe('plain failure');

    expect(getRecentSpans().map((span) => span.errorMessage)).toEqual(['boom', 'plain failure']);
  });

  it('keeps only the most recent spans in memory', async () => {
    for (let index = 0; index < 1_001; index += 1) await runInSpan(`span-${index}`, {}, () => index);

    expect(getRecentSpans()).toHaveLength(1_000);
    expect(getRecentSpans()[0]!.name).toBe('span-1');
  });

  it('builds a traceparent only inside a span', async () => {
    expect(buildTraceparentHeader()).toBeUndefined();

    const header = await runInSpan('parent', {}, () => buildTraceparentHeader());

    expect(header).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it('accepts only valid W3C traceparent headers', () => {
    expect(parseTraceparentHeader(undefined)).toBeUndefined();
    expect(parseTraceparentHeader('not-a-trace')).toBeUndefined();
    expect(parseTraceparentHeader('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')).toEqual({
      traceId: '0af7651916cd43dd8448eb211c80319c',
      parentSpanId: 'b7ad6b7169203331',
    });
  });
});

import { ArgumentsHost, HttpException, NotFoundException } from '@nestjs/common';
import { PricingUnavailableError } from '../../src/application/orders/place-order.command';
import { PlaceOrderHandler } from '../../src/application/orders/place-order.handler';
import { ApiErrorFilter } from '../../src/interfaces/http/errors/api-error.filter';
import { CheckoutController } from '../../src/interfaces/http/orders/checkout.controller';
import { describeValidationErrors } from '../../src/interfaces/http/request-validation';
import { PeriodicJob } from '../../src/interfaces/jobs/periodic-job';
import { logger } from '../../src/shared/logger';
import { runWithRequestContext } from '../../src/shared/request-context';
import { aCheckoutRequest } from '../support/builders';

function fakeHttpHost() {
  const response = { status: jest.fn(), json: jest.fn(), getHeader: jest.fn().mockReturnValue('correlation-1') };
  response.status.mockReturnValue(response);
  const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
  return { host, response };
}

describe('ApiErrorFilter', () => {
  it('uses the HTTP status name as the code for framework errors', () => {
    const { host, response } = fakeHttpHost();

    new ApiErrorFilter().catch(new NotFoundException('Cannot GET /nowhere'), host);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      error: { code: 'NOT_FOUND', message: 'Cannot GET /nowhere' },
      correlationId: 'correlation-1',
    });
  });

  it('falls back to a generic code for a status Nest does not name', () => {
    const { host, response } = fakeHttpHost();

    new ApiErrorFilter().catch(new HttpException('client closed', 499), host);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: 'HTTP_ERROR' }) }));
  });

  it('hides unexpected errors behind a 500 without leaking details', () => {
    for (const unexpected of [new Error('database exploded'), 'not even an Error']) {
      const { host, response } = fakeHttpHost();

      new ApiErrorFilter().catch(unexpected, host);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } }),
      );
    }
  });
});

describe('CheckoutController', () => {
  const request = aCheckoutRequest().withItem('CASE-IPH15-BLK').build();
  const response = { setHeader: jest.fn() } as never;
  const inRequest = <T>(operation: () => T) => runWithRequestContext({ correlationId: 'c-1', traceId: 't-1' }, operation);

  it('turns a pricing failure into a 503', async () => {
    const placeOrder = { execute: jest.fn().mockRejectedValue(new PricingUnavailableError()) } as unknown as PlaceOrderHandler;

    await expect(
      inRequest(() => new CheckoutController(placeOrder).startCheckout('key-0001', request, response)),
    ).rejects.toMatchObject({ code: 'PRICING_UNAVAILABLE' });
  });

  it('lets any other error reach the global error filter untouched', async () => {
    const unexpected = new Error('bug');
    const placeOrder = { execute: jest.fn().mockRejectedValue(unexpected) } as unknown as PlaceOrderHandler;

    await expect(inRequest(() => new CheckoutController(placeOrder).startCheckout('key-0001', request, response))).rejects.toBe(
      unexpected,
    );
  });
});

describe('describeValidationErrors', () => {
  it('lists the problems of fields that have no nested errors', () => {
    expect(describeValidationErrors([{ property: 'customerId', constraints: { isNotEmpty: 'must not be empty' } }])).toEqual([
      { field: 'customerId', problems: ['must not be empty'] },
    ]);
  });
});

describe('PeriodicJob', () => {
  afterEach(() => jest.useRealTimers());

  it('runs on every interval until the application shuts down', async () => {
    jest.useFakeTimers();
    const run = jest.fn().mockResolvedValue(undefined);
    const job = new PeriodicJob('test', 100, run);

    job.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(250);
    job.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(500);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('stays off when the interval is zero', async () => {
    jest.useFakeTimers();
    const run = jest.fn();
    const job = new PeriodicJob('disabled', 0, run);

    job.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(1_000);
    job.onApplicationShutdown();

    expect(run).not.toHaveBeenCalled();
  });

  it('logs a failed run and keeps going', async () => {
    const error = jest.spyOn(logger, 'error');
    const job = new PeriodicJob('flaky', 100, () => Promise.reject(new Error('ERP down')));

    await job.runOnce();

    expect(error).toHaveBeenCalledWith({ err: 'Error: ERP down', job: 'flaky' }, 'periodic job failed');
    error.mockRestore();
  });
});

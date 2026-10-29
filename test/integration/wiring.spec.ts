import { OUTBOX_PUBLISHING_JOB, RECONCILIATION_JOB } from '../../src/app.module';
import { PeriodicJob } from '../../src/interfaces/jobs/periodic-job';
import { startTestApplication, TestApplication } from '../support/test-application';

let testApp: TestApplication;

afterEach(() => testApp.close());

describe('application wiring', () => {
  it('publishes saved orders through the outbox job', async () => {
    testApp = await startTestApplication();
    testApp.database.reserveStockAndCreateOrder({
      customerId: 'customer-1',
      items: [{ sku: 'CASE-IPH15-BLK', quantity: 1 }],
      findPriceInCents: () => 7990,
      idempotencyKey: 'wiring-key-0001',
      correlationId: 'correlation-1',
      now: Date.now(),
    });

    await testApp.app.get<PeriodicJob>(OUTBOX_PUBLISHING_JOB).runOnce();

    expect(testApp.database.listUnpublishedOutboxEvents()).toHaveLength(0);
  });

  it('runs the reconciliation through its job', async () => {
    testApp = await startTestApplication();
    const isStockConsistent = jest.spyOn(testApp.database, 'isStockConsistent');

    await testApp.app.get<PeriodicJob>(RECONCILIATION_JOB).runOnce();

    expect(isStockConsistent).toHaveBeenCalled();
  });
});

describe('request handling', () => {
  it('uses x-request-id as the correlation id when there is no x-correlation-id', async () => {
    testApp = await startTestApplication();

    const response = await testApp.http.get('/products').set('x-request-id', 'request-42');

    expect(response.headers['x-correlation-id']).toBe('request-42');
  });

  it('answers unknown routes with the same error envelope', async () => {
    testApp = await startTestApplication();

    const response = await testApp.http.get('/nowhere');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND' }, correlationId: expect.any(String) });
  });
});

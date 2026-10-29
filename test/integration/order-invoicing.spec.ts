import { aCheckoutRequest } from '../support/builders';
import { postCheckout, startTestApplication, TestApplication } from '../support/test-application';

let testApp: TestApplication;

afterEach(() => testApp.close());

function findOrder(orderId: string) {
  return testApp.database.findOrderById(orderId)!;
}

async function placeOrder(sku: string, quantity = 1): Promise<string> {
  const response = await postCheckout(testApp, aCheckoutRequest().withItem(sku, quantity).build());
  return response.body.orderId;
}

describe('order invoicing', () => {
  it('retries temporary ERP failures and ends up CONFIRMED', async () => {
    testApp = await startTestApplication();
    testApp.erp.failNextInvoiceRequests = 2;

    const orderId = await placeOrder('CASE-IPH15-BLK');
    await testApp.queue.waitUntilEmpty();

    expect(findOrder(orderId)).toMatchObject({ status: 'CONFIRMED', invoicingAttempts: 3 });
    expect(testApp.erp.countInvoicesForOrder(orderId)).toBe(1);
  });

  it('does not invoice twice when the same message is delivered twice at the same time', async () => {
    testApp = await startTestApplication();
    testApp.queue.unsubscribe();
    const orderId = await placeOrder('CASE-IPH15-BLK');
    const duplicatedMessage = { messageId: 'duplicate', orderId, attempt: 1, correlationId: 'c', enqueuedAt: Date.now() };

    await Promise.all([testApp.consumer.handleMessage(duplicatedMessage), testApp.consumer.handleMessage(duplicatedMessage)]);

    expect(testApp.erp.countInvoicesForOrder(orderId)).toBe(1);
    expect(findOrder(orderId).status).toBe('CONFIRMED');
  });

  it('lets only one of two workers that read the same order state claim the invoicing attempt', async () => {
    testApp = await startTestApplication();
    testApp.queue.unsubscribe();
    const orderId = await placeOrder('CASE-IPH15-BLK');
    const attemptsSeenByBothWorkers = findOrder(orderId).invoicingAttempts;

    const firstWorkerClaimed = testApp.database.claimInvoicingAttempt(orderId, attemptsSeenByBothWorkers);
    const secondWorkerClaimed = testApp.database.claimInvoicingAttempt(orderId, attemptsSeenByBothWorkers);

    expect([firstWorkerClaimed, secondWorkerClaimed]).toEqual([true, false]);
  });

  it('fails the order and returns the stock when the ERP rejects it', async () => {
    testApp = await startTestApplication();
    testApp.erp.rejectNextInvoiceRequests = 1;

    const orderId = await placeOrder('CASE-S24-CLR', 2);
    expect(testApp.database.getAvailableUnits('CASE-S24-CLR')).toBe(1);
    await testApp.queue.waitUntilEmpty();

    expect(findOrder(orderId).status).toBe('FAILED');
    expect(testApp.database.getAvailableUnits('CASE-S24-CLR')).toBe(3);
    expect(testApp.database.isStockConsistent()).toBe(true);
  });

  it('moves the message to the DLQ after all retries and keeps the stock reserved', async () => {
    testApp = await startTestApplication();
    testApp.erp.failNextInvoiceRequests = 99;

    const orderId = await placeOrder('CASE-S24-CLR');
    await testApp.queue.waitUntilEmpty();

    expect(findOrder(orderId).status).toBe('NEEDS_RECONCILIATION');
    expect(testApp.queue.deadLetterMessages).toHaveLength(1);
    expect(testApp.database.getAvailableUnits('CASE-S24-CLR')).toBe(2);
  });

  it('checks the ERP database before retrying, so a lost response does not create a second invoice', async () => {
    testApp = await startTestApplication();
    testApp.erp.loseResponseOfNextCommittedInvoices = 1;

    const orderId = await placeOrder('CASE-IPH15-BLK');
    await testApp.queue.waitUntilEmpty();

    expect(findOrder(orderId).status).toBe('CONFIRMED');
    expect(testApp.erp.countInvoicesForOrder(orderId)).toBe(1);
  });
});

describe('order reconciliation', () => {
  it('confirms an order from the DLQ that the ERP had actually invoiced', async () => {
    testApp = await startTestApplication();
    testApp.erp.loseResponseOfNextCommittedInvoices = 1;
    testApp.erp.failInvoiceLookups = true;

    const orderId = await placeOrder('CASE-IPH15-BLK');
    await testApp.queue.waitUntilEmpty();
    expect(findOrder(orderId).status).toBe('NEEDS_RECONCILIATION');

    testApp.erp.failInvoiceLookups = false;
    await testApp.reconcileOpenOrders();

    expect(findOrder(orderId).status).toBe('CONFIRMED');
    expect(testApp.erp.countInvoicesForOrder(orderId)).toBe(1);
  });

  it('sends the order back to invoicing, then gives up and releases the stock after the deadline', async () => {
    const clock = { now: Date.now() };
    testApp = await startTestApplication({ now: () => clock.now });
    testApp.erp.failNextInvoiceRequests = 99;

    const orderId = await placeOrder('CASE-S24-CLR');
    await testApp.queue.waitUntilEmpty();

    clock.now += 2_000;
    await testApp.reconcileOpenOrders();
    await testApp.queue.waitUntilEmpty();
    expect(findOrder(orderId).status).toBe('NEEDS_RECONCILIATION');

    clock.now += 20_000;
    await testApp.reconcileOpenOrders();
    expect(findOrder(orderId).status).toBe('FAILED');
    expect(testApp.database.getAvailableUnits('CASE-S24-CLR')).toBe(3);
  });

  it('recovers an order whose message was lost while no worker was consuming', async () => {
    const clock = { now: Date.now() };
    testApp = await startTestApplication({ now: () => clock.now });
    testApp.queue.unsubscribe();

    const orderId = await placeOrder('CASE-IPH15-BLK');
    testApp.consumer.startConsuming();
    clock.now += 5_000;
    await testApp.reconcileOpenOrders();
    await testApp.queue.waitUntilEmpty();

    expect(findOrder(orderId).status).toBe('CONFIRMED');
  });
});

describe('transactional outbox', () => {
  it('publishes an order that was saved but never published (crash between commit and publish)', async () => {
    testApp = await startTestApplication();
    const result = testApp.database.reserveStockAndCreateOrder({
      customerId: 'customer-1',
      items: [{ sku: 'CASE-IPH15-BLK', quantity: 1 }],
      findPriceInCents: () => 100,
      idempotencyKey: 'crash-key-0001',
      correlationId: 'correlation-1',
      now: Date.now(),
    });
    expect(result.outcome).toBe('order_created');
    expect(testApp.database.listUnpublishedOutboxEvents()).toHaveLength(1);

    await testApp.publishPendingOutboxEvents();
    await testApp.queue.waitUntilEmpty();

    expect(testApp.database.listUnpublishedOutboxEvents()).toHaveLength(0);
    if (result.outcome === 'order_created') expect(findOrder(result.order.id).status).toBe('CONFIRMED');
  });
});

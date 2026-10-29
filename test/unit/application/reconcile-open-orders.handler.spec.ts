import { ReconcileOpenOrdersCommand } from '../../../src/application/reconciliation/reconcile-open-orders.command';
import { ReconcileOpenOrdersHandler } from '../../../src/application/reconciliation/reconcile-open-orders.handler';
import { Order } from '../../../src/domain/order';
import { anOrder } from '../../support/builders';
import { fakeInvoicingGateway, fakeOrderQueue, fakeOrderRepository, fakeStockLevels, fixedClock } from '../../support/fakes';

const NOW = 100_000;
const settings = { considerStuckAfterMs: 1_000, giveUpAfterMs: 10_000 };

function createHandler(openOrders: Order[]) {
  const orders = fakeOrderRepository();
  const stock = fakeStockLevels();
  const invoicing = fakeInvoicingGateway();
  const queue = fakeOrderQueue();
  orders.findOrdersByStatus.mockReturnValue(openOrders);
  const handler = new ReconcileOpenOrdersHandler(orders, stock, invoicing, queue, fixedClock(NOW), settings);
  return { orders, stock, invoicing, queue, handler };
}

function orderWaitingForReconciliation(createdAt = NOW - 2_000): Order {
  return { ...anOrder().withStatus('NEEDS_RECONCILIATION').build(), createdAt, updatedAt: createdAt };
}

const reconcile = (handler: ReconcileOpenOrdersHandler) => handler.execute(new ReconcileOpenOrdersCommand());

describe('ReconcileOpenOrdersHandler', () => {
  it('leaves alone open orders that are neither stuck nor waiting for reconciliation', async () => {
    const recentOrder = { ...anOrder().withStatus('PROCESSING').build(), updatedAt: NOW - 10 };
    const { invoicing, handler } = createHandler([recentOrder]);

    await reconcile(handler);

    expect(invoicing.findInvoiceInErpDatabaseByOrderId).not.toHaveBeenCalled();
  });

  it('confirms the order when the ERP already invoiced it', async () => {
    const { orders, invoicing, handler } = createHandler([orderWaitingForReconciliation()]);
    invoicing.findInvoiceInErpDatabaseByOrderId.mockResolvedValue({ invoiceId: 'INV-9' });

    await reconcile(handler);

    expect(orders.changeOrderStatus).toHaveBeenCalledWith(
      'order-1',
      expect.any(Array),
      'CONFIRMED',
      { invoiceId: 'INV-9' },
      NOW,
    );
  });

  it('sends the order back to invoicing while it is still inside the deadline', async () => {
    const { queue, handler } = createHandler([orderWaitingForReconciliation()]);

    await reconcile(handler);

    expect(queue.publish).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-1', attempt: 1 }));
  });

  it('gives up and releases the stock after the deadline', async () => {
    const { orders, queue, handler } = createHandler([orderWaitingForReconciliation(NOW - 20_000)]);

    await reconcile(handler);

    expect(orders.changeOrderStatus).toHaveBeenCalledWith('order-1', expect.any(Array), 'FAILED', expect.anything(), NOW);
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it('does nothing more when another process changed the order first', async () => {
    const confirmed = createHandler([orderWaitingForReconciliation()]);
    confirmed.invoicing.findInvoiceInErpDatabaseByOrderId.mockResolvedValue({ invoiceId: 'INV-9' });
    const givenUp = createHandler([orderWaitingForReconciliation(NOW - 20_000)]);
    const requeued = createHandler([orderWaitingForReconciliation()]);
    for (const scenario of [confirmed, givenUp, requeued]) scenario.orders.changeOrderStatus.mockReturnValue(false);

    await Promise.all([reconcile(confirmed.handler), reconcile(givenUp.handler), reconcile(requeued.handler)]);

    expect(requeued.queue.publish).not.toHaveBeenCalled();
  });

  it('skips the order when the ERP cannot be reached, without changing anything', async () => {
    const { orders, invoicing, handler } = createHandler([orderWaitingForReconciliation()]);
    invoicing.findInvoiceInErpDatabaseByOrderId.mockRejectedValue(new Error('ERP read replica unavailable'));

    await reconcile(handler);

    expect(orders.changeOrderStatus).not.toHaveBeenCalled();
  });

  it('checks the stock invariant on every run', async () => {
    const { stock, handler } = createHandler([]);
    stock.isStockConsistent.mockReturnValue(false);

    await reconcile(handler);

    expect(stock.isStockConsistent).toHaveBeenCalled();
  });
});

import { InvoiceOrderCommand } from '../../../src/application/invoicing/invoice-order.command';
import { InvoiceOrderHandler } from '../../../src/application/invoicing/invoice-order.handler';
import { InvoicingFailureHandler } from '../../../src/application/invoicing/invoicing-failure-chain';
import { OrderMessage } from '../../../src/application/ports/order-queue';
import { anOrder } from '../../support/builders';
import { fakeInvoicingGateway, fakeOrderRepository } from '../../support/fakes';

const message: OrderMessage = { messageId: 'm-1', orderId: 'order-1', attempt: 1, correlationId: 'c-1', enqueuedAt: 0 };

function createHandler() {
  const orders = fakeOrderRepository();
  const invoicing = fakeInvoicingGateway();
  const failureChain: jest.Mocked<InvoicingFailureHandler> = { handle: jest.fn() };
  const handler = new InvoiceOrderHandler(orders, invoicing, failureChain);
  return { orders, invoicing, failureChain, handler };
}

describe('InvoiceOrderHandler', () => {
  it('ignores a message for an order that does not exist', async () => {
    const { orders, invoicing, handler } = createHandler();
    orders.findOrderById.mockReturnValue(undefined);

    await handler.execute(new InvoiceOrderCommand(message));

    expect(invoicing.createInvoice).not.toHaveBeenCalled();
  });

  it('ignores a message for an order that is already settled', async () => {
    const { orders, invoicing, handler } = createHandler();
    orders.findOrderById.mockReturnValue(anOrder().withStatus('CONFIRMED').build());

    await handler.execute(new InvoiceOrderCommand(message));

    expect(orders.claimInvoicingAttempt).not.toHaveBeenCalled();
    expect(invoicing.createInvoice).not.toHaveBeenCalled();
  });

  it('ignores a message when another delivery already claimed the attempt', async () => {
    const { orders, invoicing, handler } = createHandler();
    orders.findOrderById.mockReturnValue(anOrder().build());
    orders.claimInvoicingAttempt.mockReturnValue(false);

    await handler.execute(new InvoiceOrderCommand(message));

    expect(invoicing.createInvoice).not.toHaveBeenCalled();
  });

  it('creates the invoice on the first attempt without looking it up first', async () => {
    const { orders, invoicing, handler } = createHandler();
    orders.findOrderById.mockReturnValue(anOrder().withInvoicingAttempts(0).build());

    await handler.execute(new InvoiceOrderCommand(message));

    expect(invoicing.findInvoiceInErpDatabaseByOrderId).not.toHaveBeenCalled();
    expect(orders.changeOrderStatus).toHaveBeenCalledWith('order-1', ['PROCESSING'], 'CONFIRMED', { invoiceId: 'INV-NEW' });
  });

  it('reuses the invoice the ERP already created in a previous attempt', async () => {
    const { orders, invoicing, handler } = createHandler();
    orders.findOrderById.mockReturnValue(anOrder().withInvoicingAttempts(1).build());
    invoicing.findInvoiceInErpDatabaseByOrderId.mockResolvedValue({ invoiceId: 'INV-OLD' });

    await handler.execute(new InvoiceOrderCommand(message));

    expect(invoicing.createInvoice).not.toHaveBeenCalled();
    expect(orders.changeOrderStatus).toHaveBeenCalledWith('order-1', ['PROCESSING'], 'CONFIRMED', { invoiceId: 'INV-OLD' });
  });

  it('creates the invoice on a retry when the ERP has none yet', async () => {
    const { orders, invoicing, handler } = createHandler();
    orders.findOrderById.mockReturnValue(anOrder().withInvoicingAttempts(2).build());

    await handler.execute(new InvoiceOrderCommand(message));

    expect(invoicing.findInvoiceInErpDatabaseByOrderId).toHaveBeenCalledWith('order-1');
    expect(invoicing.createInvoice).toHaveBeenCalledTimes(1);
  });

  it('does nothing else when the order was confirmed by someone else in the meantime', async () => {
    const { orders, failureChain, handler } = createHandler();
    orders.findOrderById.mockReturnValue(anOrder().build());
    orders.changeOrderStatus.mockReturnValue(false);

    await handler.execute(new InvoiceOrderCommand(message));

    expect(failureChain.handle).not.toHaveBeenCalled();
  });

  it('hands any ERP failure to the failure chain', async () => {
    const { orders, invoicing, failureChain, handler } = createHandler();
    const order = anOrder().build();
    const error = new Error('timeout');
    orders.findOrderById.mockReturnValue(order);
    invoicing.createInvoice.mockRejectedValue(error);

    await handler.execute(new InvoiceOrderCommand(message));

    expect(failureChain.handle).toHaveBeenCalledWith({ order, message, error });
  });
});

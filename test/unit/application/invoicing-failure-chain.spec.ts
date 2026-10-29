import { createInvoicingFailureChain, InvoicingFailure } from '../../../src/application/invoicing/invoicing-failure-chain';
import { InvoiceRejectedError } from '../../../src/application/ports/invoicing-gateway';
import { RetryPolicy } from '../../../src/application/retry/retry-policy';
import { anOrder } from '../../support/builders';
import { fakeOrderQueue, fakeOrderRepository } from '../../support/fakes';

function createChain(maxAttempts = 3) {
  const orders = fakeOrderRepository();
  const queue = fakeOrderQueue();
  const retryPolicy = new RetryPolicy(maxAttempts, { delayBeforeRetryingAttempt: () => 50 });
  const chain = createInvoicingFailureChain(orders, queue, retryPolicy);
  return { orders, queue, chain };
}

function failureOnAttempt(attempt: number, error: unknown): InvoicingFailure {
  return {
    order: anOrder().build(),
    message: { messageId: 'm-1', orderId: 'order-1', attempt, correlationId: 'c-1', enqueuedAt: 0 },
    error,
  };
}

describe('invoicing failure chain', () => {
  it('fails the order and releases the stock when the ERP rejects it, without retrying', () => {
    const { orders, queue, chain } = createChain();

    chain.handle(failureOnAttempt(1, new InvoiceRejectedError('customer blocked')));

    expect(orders.changeOrderStatus).toHaveBeenCalledWith('order-1', ['PROCESSING'], 'FAILED', {
      failureReason: 'customer blocked',
    });
    expect(queue.publish).not.toHaveBeenCalled();
  });

  it('schedules the next attempt while there are attempts left', () => {
    const { orders, queue, chain } = createChain();

    chain.handle(failureOnAttempt(1, new Error('timeout')));

    expect(queue.publish).toHaveBeenCalledWith(expect.objectContaining({ attempt: 2 }), 50);
    expect(orders.changeOrderStatus).not.toHaveBeenCalled();
  });

  it('sends the message to the DLQ and keeps the stock reserved when attempts run out', () => {
    const { orders, queue, chain } = createChain(3);
    const failure = failureOnAttempt(3, 'something that is not an Error');

    chain.handle(failure);

    expect(queue.moveToDeadLetterQueue).toHaveBeenCalledWith(failure.message);
    expect(orders.changeOrderStatus).toHaveBeenCalledWith('order-1', ['PROCESSING'], 'NEEDS_RECONCILIATION', {
      failureReason: 'something that is not an Error',
    });
  });
});

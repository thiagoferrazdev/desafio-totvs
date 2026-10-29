import { Order } from '../../domain/order';
import { logger } from '../../shared/logger';
import { deadLetteredMessages, finishedOrders, invoicingAttempts } from '../../shared/metrics';
import { InvoiceRejectedError } from '../ports/invoicing-gateway';
import { OrderMessage, OrderQueue } from '../ports/order-queue';
import { OrderRepository } from '../ports/order-repository';
import { RetryPolicy } from '../retry/retry-policy';
import { InvoicingMessageFactory } from './invoicing-message.factory';

export interface InvoicingFailure {
  order: Order;
  message: OrderMessage;
  error: unknown;
}

export interface InvoicingFailureHandler {
  handle(failure: InvoicingFailure): void;
}

export class RejectedByErpHandler implements InvoicingFailureHandler {
  constructor(
    private readonly orders: OrderRepository,
    private readonly next: InvoicingFailureHandler,
  ) {}

  handle(failure: InvoicingFailure): void {
    if (!(failure.error instanceof InvoiceRejectedError)) return this.next.handle(failure);

    const reason = failure.error.message;
    this.orders.changeOrderStatus(failure.order.id, ['PROCESSING'], 'FAILED', { failureReason: reason });
    finishedOrders.inc({ status: 'FAILED' });
    invoicingAttempts.inc({ outcome: 'permanent_failure' });
    logger.warn({ err: reason }, 'order rejected by the ERP, stock released');
  }
}

export class RetryLaterHandler implements InvoicingFailureHandler {
  constructor(
    private readonly queue: OrderQueue,
    private readonly retryPolicy: RetryPolicy,
    private readonly next: InvoicingFailureHandler,
  ) {}

  handle(failure: InvoicingFailure): void {
    const { message } = failure;
    if (!this.retryPolicy.hasAttemptsLeftAfter(message.attempt)) return this.next.handle(failure);

    const retryDelayMs = this.retryPolicy.delayBeforeRetryingAttempt(message.attempt);
    this.queue.publish(InvoicingMessageFactory.nextAttemptOf(message), retryDelayMs);
    invoicingAttempts.inc({ outcome: 'retry_scheduled' });
    logger.warn(
      { err: describe(failure.error), nextAttempt: message.attempt + 1, retryDelayMs },
      'ERP call failed, retry scheduled',
    );
  }
}

export class SendToDeadLetterQueueHandler implements InvoicingFailureHandler {
  constructor(
    private readonly queue: OrderQueue,
    private readonly orders: OrderRepository,
  ) {}

  handle(failure: InvoicingFailure): void {
    const { message } = failure;
    const reason = describe(failure.error);
    this.queue.moveToDeadLetterQueue(message);
    this.orders.changeOrderStatus(message.orderId, ['PROCESSING'], 'NEEDS_RECONCILIATION', { failureReason: reason });
    deadLetteredMessages.inc();
    invoicingAttempts.inc({ outcome: 'dead_lettered' });
    logger.error({ err: reason, attempts: message.attempt }, 'retries exhausted, message moved to DLQ');
  }
}

export function createInvoicingFailureChain(
  orders: OrderRepository,
  queue: OrderQueue,
  retryPolicy: RetryPolicy,
): InvoicingFailureHandler {
  const sendToDeadLetterQueue = new SendToDeadLetterQueueHandler(queue, orders);
  const retryLater = new RetryLaterHandler(queue, retryPolicy, sendToDeadLetterQueue);
  return new RejectedByErpHandler(orders, retryLater);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

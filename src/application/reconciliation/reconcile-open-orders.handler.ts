import { isWaitingForReconciliation, OPEN_ORDER_STATUSES, Order } from '../../domain/order';
import { logger } from '../../shared/logger';
import { finishedOrders, reconciliationActions } from '../../shared/metrics';
import { runWithRequestContext } from '../../shared/request-context';
import { generateTraceId, runInSpan } from '../../shared/tracing';
import { CommandHandler } from '../command-handler';
import { InvoicingMessageFactory } from '../invoicing/invoicing-message.factory';
import { Clock } from '../ports/clock';
import { Invoice, InvoicingGateway } from '../ports/invoicing-gateway';
import { OrderQueue } from '../ports/order-queue';
import { OrderRepository } from '../ports/order-repository';
import { StockLevels } from '../ports/stock-levels';
import { ReconcileOpenOrdersCommand } from './reconcile-open-orders.command';

export interface ReconciliationSettings {
  considerStuckAfterMs: number;
  giveUpAfterMs: number;
}

export class ReconcileOpenOrdersHandler implements CommandHandler<ReconcileOpenOrdersCommand> {
  constructor(
    private readonly orders: OrderRepository,
    private readonly stock: StockLevels,
    private readonly invoicing: InvoicingGateway,
    private readonly queue: OrderQueue,
    private readonly clock: Clock,
    private readonly settings: ReconciliationSettings,
  ) {}

  async execute(_command: ReconcileOpenOrdersCommand): Promise<void> {
    const now = this.clock.now();
    if (!this.stock.isStockConsistent()) logger.error('stock invariant violated');

    for (const order of this.ordersNeedingAttention(now)) {
      const orderContext = { correlationId: order.correlationId, orderId: order.id, traceId: generateTraceId() };
      await runWithRequestContext(orderContext, () =>
        runInSpan('reconciliation.order', {}, () => this.reconcileOrder(order, now)),
      );
    }
  }

  private ordersNeedingAttention(now: number): Order[] {
    return this.orders
      .findOrdersByStatus(OPEN_ORDER_STATUSES)
      .filter((order) => isWaitingForReconciliation(order) || this.isStuck(order, now));
  }

  private async reconcileOrder(order: Order, now: number): Promise<void> {
    let invoice: Invoice | null;
    try {
      invoice = await this.invoicing.findInvoiceInErpDatabaseByOrderId(order.id);
    } catch (error) {
      logger.warn({ err: String(error) }, 'reconciliation skipped because the ERP is unavailable');
      return;
    }

    if (invoice) return this.confirmOrderAlreadyInvoicedByErp(order, invoice, now);
    if (this.hasPassedGiveUpDeadline(order, now)) return this.giveUpAndReleaseStock(order, now);
    this.sendOrderBackToInvoicing(order, now);
  }

  private isStuck(order: Order, now: number): boolean {
    return now - order.updatedAt > this.settings.considerStuckAfterMs;
  }

  private hasPassedGiveUpDeadline(order: Order, now: number): boolean {
    return now - order.createdAt > this.settings.giveUpAfterMs;
  }

  private confirmOrderAlreadyInvoicedByErp(order: Order, invoice: Invoice, now: number): void {
    const changes = { invoiceId: invoice.invoiceId };
    if (!this.orders.changeOrderStatus(order.id, OPEN_ORDER_STATUSES, 'CONFIRMED', changes, now)) return;

    finishedOrders.inc({ status: 'CONFIRMED' });
    reconciliationActions.inc({ action: 'confirmed_from_erp' });
    logger.info({ invoiceId: invoice.invoiceId }, 'reconciled: ERP had already invoiced this order');
  }

  private giveUpAndReleaseStock(order: Order, now: number): void {
    const changes = { failureReason: 'erp_never_invoiced_before_give_up' };
    if (!this.orders.changeOrderStatus(order.id, OPEN_ORDER_STATUSES, 'FAILED', changes, now)) return;

    finishedOrders.inc({ status: 'FAILED' });
    reconciliationActions.inc({ action: 'failed_and_released' });
    logger.error('reconciled: gave up on the order and released its stock');
  }

  private sendOrderBackToInvoicing(order: Order, now: number): void {
    if (!this.orders.changeOrderStatus(order.id, OPEN_ORDER_STATUSES, 'ACCEPTED', {}, now)) return;

    this.queue.publish(
      InvoicingMessageFactory.firstAttempt({
        messageId: `${order.id}:reconciliation:${now}`,
        orderId: order.id,
        correlationId: order.correlationId,
        enqueuedAt: now,
      }),
    );
    reconciliationActions.inc({ action: 'requeued' });
    logger.info('reconciled: ERP has no invoice yet, order sent back to invoicing');
  }
}

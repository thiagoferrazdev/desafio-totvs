import { canBeInvoiced, hasBeenSentToTheErpBefore, Order } from '../../domain/order';
import { logger } from '../../shared/logger';
import { finishedOrders, invoicingAttempts, orderConfirmationDuration } from '../../shared/metrics';
import { CommandHandler } from '../command-handler';
import { Invoice, InvoicingGateway } from '../ports/invoicing-gateway';
import { OrderRepository } from '../ports/order-repository';
import { InvoiceOrderCommand } from './invoice-order.command';
import { InvoicingFailureHandler } from './invoicing-failure-chain';

export class InvoiceOrderHandler implements CommandHandler<InvoiceOrderCommand> {
  constructor(
    private readonly orders: OrderRepository,
    private readonly invoicing: InvoicingGateway,
    private readonly failureChain: InvoicingFailureHandler,
  ) {}

  async execute({ message }: InvoiceOrderCommand): Promise<void> {
    const order = this.orders.findOrderById(message.orderId);
    if (!order || !canBeInvoiced(order)) {
      return this.ignoreMessage('message ignored because the order is already settled', order);
    }
    if (!this.orders.claimInvoicingAttempt(order.id, order.invoicingAttempts)) {
      return this.ignoreMessage('message ignored because another delivery is already invoicing this order', order);
    }

    try {
      const invoice = await this.findOrCreateInvoice(order);
      this.confirmOrder(order, invoice.invoiceId, message.attempt);
    } catch (error) {
      this.failureChain.handle({ order, message, error });
    }
  }

  private async findOrCreateInvoice(order: Order): Promise<Invoice> {
    if (hasBeenSentToTheErpBefore(order)) {
      const invoiceFromPreviousAttempt = await this.invoicing.findInvoiceInErpDatabaseByOrderId(order.id);
      if (invoiceFromPreviousAttempt) return invoiceFromPreviousAttempt;
    }
    return this.invoicing.createInvoice({ orderId: order.id, items: order.items, totalInCents: order.totalInCents });
  }

  private confirmOrder(order: Order, invoiceId: string, attempt: number): void {
    const wasConfirmedNow = this.orders.changeOrderStatus(order.id, ['PROCESSING'], 'CONFIRMED', { invoiceId });
    invoicingAttempts.inc({ outcome: 'ok' });
    if (!wasConfirmedNow) return;

    finishedOrders.inc({ status: 'CONFIRMED' });
    orderConfirmationDuration.observe((Date.now() - order.createdAt) / 1000);
    logger.info({ invoiceId, attempt }, 'order confirmed');
  }

  private ignoreMessage(reason: string, order: Order | undefined): void {
    invoicingAttempts.inc({ outcome: 'duplicate_ignored' });
    logger.info({ status: order?.status }, reason);
  }
}

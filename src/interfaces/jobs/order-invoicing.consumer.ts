import { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { CommandHandler } from '../../application/command-handler';
import { InvoiceOrderCommand } from '../../application/invoicing/invoice-order.command';
import { OrderMessage, OrderQueue } from '../../application/ports/order-queue';
import { RequestContext, runWithRequestContext } from '../../shared/request-context';
import { generateTraceId, parseTraceparentHeader, runInSpan } from '../../shared/tracing';

export class OrderInvoicingConsumer implements OnModuleInit, OnApplicationShutdown {
  constructor(
    private readonly queue: OrderQueue,
    private readonly invoiceOrder: CommandHandler<InvoiceOrderCommand>,
  ) {}

  onModuleInit(): void {
    this.startConsuming();
  }

  onApplicationShutdown(): void {
    this.queue.unsubscribe();
  }

  startConsuming(): void {
    this.queue.subscribe((message) => this.handleMessage(message));
  }

  async handleMessage(message: OrderMessage): Promise<void> {
    const spanAttributes = { 'messaging.message_id': message.messageId, 'messaging.attempt': message.attempt };
    await runWithRequestContext(contextOf(message), () =>
      runInSpan('worker.process_order', spanAttributes, () => this.invoiceOrder.execute(new InvoiceOrderCommand(message))),
    );
  }
}

function contextOf(message: OrderMessage): RequestContext {
  const producerTrace = parseTraceparentHeader(message.traceparent);
  return {
    correlationId: message.correlationId,
    orderId: message.orderId,
    traceId: producerTrace?.traceId ?? generateTraceId(),
    spanId: producerTrace?.parentSpanId,
  };
}

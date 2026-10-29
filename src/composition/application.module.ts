import { Module } from '@nestjs/common';
import { ListCatalogHandler } from '../application/catalog/list-catalog.query';
import { InvoiceOrderHandler } from '../application/invoicing/invoice-order.handler';
import { createInvoicingFailureChain } from '../application/invoicing/invoicing-failure-chain';
import { GetOrderStatusHandler } from '../application/orders/get-order-status.query';
import { PlaceOrderHandler } from '../application/orders/place-order.handler';
import { PublishOutboxEventsHandler } from '../application/outbox/publish-outbox-events.handler';
import { Clock } from '../application/ports/clock';
import { InvoicingGateway } from '../application/ports/invoicing-gateway';
import { OrderQueue } from '../application/ports/order-queue';
import { OrderRepository } from '../application/ports/order-repository';
import { OutboxRepository } from '../application/ports/outbox-repository';
import { ProductCatalog } from '../application/ports/product-catalog';
import { StockLevels } from '../application/ports/stock-levels';
import { ReconcileOpenOrdersHandler } from '../application/reconciliation/reconcile-open-orders.handler';
import { ExponentialBackoffWithFullJitter } from '../application/retry/backoff-strategy';
import { RetryPolicy } from '../application/retry/retry-policy';
import { APP_CONFIG, AppConfig } from '../infrastructure/config/app-config';

function createInvoiceOrderHandler(
  orders: OrderRepository,
  invoicing: InvoicingGateway,
  queue: OrderQueue,
  config: AppConfig,
): InvoiceOrderHandler {
  const { maxAttempts, retryBaseDelayMs, retryMaxDelayMs } = config.invoicingWorker;
  const backoff = new ExponentialBackoffWithFullJitter({ baseDelayMs: retryBaseDelayMs, maxDelayMs: retryMaxDelayMs });
  const failureChain = createInvoicingFailureChain(orders, queue, new RetryPolicy(maxAttempts, backoff));
  return new InvoiceOrderHandler(orders, invoicing, failureChain);
}

@Module({
  providers: [
    {
      provide: PublishOutboxEventsHandler,
      inject: [OutboxRepository, OrderQueue],
      useFactory: (outbox: OutboxRepository, queue: OrderQueue) => new PublishOutboxEventsHandler(outbox, queue),
    },
    {
      provide: PlaceOrderHandler,
      inject: [OrderRepository, ProductCatalog, PublishOutboxEventsHandler, Clock],
      useFactory: (
        orders: OrderRepository,
        catalog: ProductCatalog,
        publishOutboxEvents: PublishOutboxEventsHandler,
        clock: Clock,
      ) => new PlaceOrderHandler(orders, catalog, publishOutboxEvents, clock),
    },
    {
      provide: ListCatalogHandler,
      inject: [ProductCatalog, StockLevels],
      useFactory: (catalog: ProductCatalog, stock: StockLevels) => new ListCatalogHandler(catalog, stock),
    },
    {
      provide: GetOrderStatusHandler,
      inject: [OrderRepository],
      useFactory: (orders: OrderRepository) => new GetOrderStatusHandler(orders),
    },
    {
      provide: InvoiceOrderHandler,
      inject: [OrderRepository, InvoicingGateway, OrderQueue, APP_CONFIG],
      useFactory: createInvoiceOrderHandler,
    },
    {
      provide: ReconcileOpenOrdersHandler,
      inject: [OrderRepository, StockLevels, InvoicingGateway, OrderQueue, Clock, APP_CONFIG],
      useFactory: (
        orders: OrderRepository,
        stock: StockLevels,
        invoicing: InvoicingGateway,
        queue: OrderQueue,
        clock: Clock,
        config: AppConfig,
      ) => new ReconcileOpenOrdersHandler(orders, stock, invoicing, queue, clock, config.reconciliation),
    },
  ],
  exports: [
    PublishOutboxEventsHandler,
    PlaceOrderHandler,
    ListCatalogHandler,
    GetOrderStatusHandler,
    InvoiceOrderHandler,
    ReconcileOpenOrdersHandler,
  ],
})
export class ApplicationModule {}

import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { InvoiceOrderHandler } from './application/invoicing/invoice-order.handler';
import { PublishOutboxEventsCommand } from './application/outbox/publish-outbox-events.command';
import { PublishOutboxEventsHandler } from './application/outbox/publish-outbox-events.handler';
import { OrderQueue } from './application/ports/order-queue';
import { ReconcileOpenOrdersCommand } from './application/reconciliation/reconcile-open-orders.command';
import { ReconcileOpenOrdersHandler } from './application/reconciliation/reconcile-open-orders.handler';
import { ApplicationModule } from './composition/application.module';
import { InfrastructureModule } from './composition/infrastructure.module';
import { APP_CONFIG, AppConfig } from './infrastructure/config/app-config';
import { ProductsController } from './interfaces/http/catalog/products.controller';
import { ApiErrorFilter } from './interfaces/http/errors/api-error.filter';
import { MetricsController } from './interfaces/http/observability/metrics.controller';
import { CheckoutController } from './interfaces/http/orders/checkout.controller';
import { OrderStatusController } from './interfaces/http/orders/order-status.controller';
import { RequestContextMiddleware } from './interfaces/http/request-context.middleware';
import { requestBodyValidation } from './interfaces/http/request-validation';
import { OrderInvoicingConsumer } from './interfaces/jobs/order-invoicing.consumer';
import { PeriodicJob } from './interfaces/jobs/periodic-job';

export const OUTBOX_PUBLISHING_JOB = Symbol('OUTBOX_PUBLISHING_JOB');
export const RECONCILIATION_JOB = Symbol('RECONCILIATION_JOB');

@Module({
  imports: [InfrastructureModule, ApplicationModule],
  controllers: [ProductsController, CheckoutController, OrderStatusController, MetricsController],
  providers: [
    { provide: APP_PIPE, useValue: requestBodyValidation },
    { provide: APP_FILTER, useClass: ApiErrorFilter },
    {
      provide: OrderInvoicingConsumer,
      inject: [OrderQueue, InvoiceOrderHandler],
      useFactory: (queue: OrderQueue, invoiceOrder: InvoiceOrderHandler) => new OrderInvoicingConsumer(queue, invoiceOrder),
    },
    {
      provide: OUTBOX_PUBLISHING_JOB,
      inject: [PublishOutboxEventsHandler, APP_CONFIG],
      useFactory: (publishOutboxEvents: PublishOutboxEventsHandler, config: AppConfig) =>
        new PeriodicJob('outbox-publishing', config.outbox.publishIntervalMs, () =>
          publishOutboxEvents.execute(new PublishOutboxEventsCommand()),
        ),
    },
    {
      provide: RECONCILIATION_JOB,
      inject: [ReconcileOpenOrdersHandler, APP_CONFIG],
      useFactory: (reconcileOpenOrders: ReconcileOpenOrdersHandler, config: AppConfig) =>
        new PeriodicJob('reconciliation', config.reconciliation.intervalMs, () =>
          reconcileOpenOrders.execute(new ReconcileOpenOrdersCommand()),
        ),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}

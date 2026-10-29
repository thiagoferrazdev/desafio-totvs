import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PublishOutboxEventsCommand } from '../../src/application/outbox/publish-outbox-events.command';
import { PublishOutboxEventsHandler } from '../../src/application/outbox/publish-outbox-events.handler';
import { Clock } from '../../src/application/ports/clock';
import { ReconcileOpenOrdersCommand } from '../../src/application/reconciliation/reconcile-open-orders.command';
import { ReconcileOpenOrdersHandler } from '../../src/application/reconciliation/reconcile-open-orders.handler';
import { APP_CONFIG, AppConfig, loadConfigFromEnvironment } from '../../src/infrastructure/config/app-config';
import { SimulatedErp } from '../../src/infrastructure/erp/simulated-erp';
import { InMemoryQueue } from '../../src/infrastructure/messaging/in-memory-queue';
import { InMemoryStoreDatabase } from '../../src/infrastructure/persistence/in-memory-store-database';
import { OrderInvoicingConsumer } from '../../src/interfaces/jobs/order-invoicing.consumer';

export interface TestApplication {
  app: INestApplication;
  http: ReturnType<typeof request>;
  database: InMemoryStoreDatabase;
  erp: SimulatedErp;
  queue: InMemoryQueue;
  consumer: OrderInvoicingConsumer;
  reconcileOpenOrders(): Promise<void>;
  publishPendingOutboxEvents(): Promise<number>;
  close(): Promise<void>;
}

export function fastTestConfig(): AppConfig {
  const config = loadConfigFromEnvironment();
  return {
    ...config,
    erp: { timeoutMs: 40, simulatedLatencyMs: 0 },
    invoicingWorker: { concurrency: 8, maxAttempts: 3, retryBaseDelayMs: 1, retryMaxDelayMs: 5 },
    outbox: { publishIntervalMs: 0 },
    reconciliation: { intervalMs: 0, considerStuckAfterMs: 1_000, giveUpAfterMs: 10_000 },
  };
}

export async function startTestApplication(options: { now?: () => number } = {}): Promise<TestApplication> {
  let moduleBuilder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(fastTestConfig());
  if (options.now) moduleBuilder = moduleBuilder.overrideProvider(Clock).useValue({ now: options.now });

  const testingModule = await moduleBuilder.compile();
  const app = testingModule.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');

  return {
    app,
    http: request(app.getHttpServer()),
    database: app.get(InMemoryStoreDatabase),
    erp: app.get(SimulatedErp),
    queue: app.get(InMemoryQueue),
    consumer: app.get(OrderInvoicingConsumer),
    reconcileOpenOrders: () => app.get(ReconcileOpenOrdersHandler).execute(new ReconcileOpenOrdersCommand()),
    publishPendingOutboxEvents: () => app.get(PublishOutboxEventsHandler).execute(new PublishOutboxEventsCommand()),
    close: () => app.close(),
  };
}

export function uniqueIdempotencyKey(): string {
  return `key-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export function postCheckout(
  testApp: TestApplication,
  body: object,
  idempotencyKey = uniqueIdempotencyKey(),
  extraHeaders: Record<string, string> = {},
) {
  return testApp.http
    .post('/checkout')
    .set({ 'idempotency-key': idempotencyKey, ...extraHeaders })
    .send(body);
}

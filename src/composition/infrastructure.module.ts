import { Global, Module } from '@nestjs/common';
import { Clock } from '../application/ports/clock';
import { InvoicingGateway } from '../application/ports/invoicing-gateway';
import { OrderQueue } from '../application/ports/order-queue';
import { OrderRepository } from '../application/ports/order-repository';
import { OutboxRepository } from '../application/ports/outbox-repository';
import { ProductCatalog } from '../application/ports/product-catalog';
import { StockLevels } from '../application/ports/stock-levels';
import { SystemClock } from '../infrastructure/clock/system-clock';
import { APP_CONFIG, AppConfig, loadConfigFromEnvironment } from '../infrastructure/config/app-config';
import { SEED_PRODUCTS } from '../infrastructure/config/seed-products';
import { CachedErpProductCatalog } from '../infrastructure/erp/cached-erp-product-catalog';
import { SimulatedErp } from '../infrastructure/erp/simulated-erp';
import { InMemoryQueue } from '../infrastructure/messaging/in-memory-queue';
import { InMemoryStoreDatabase } from '../infrastructure/persistence/in-memory-store-database';

function createSeededStoreDatabase(): InMemoryStoreDatabase {
  const database = new InMemoryStoreDatabase();
  for (const product of SEED_PRODUCTS) database.addProductStock(product.sku, product.stockUnits);
  return database;
}

function createSimulatedErp(config: AppConfig): SimulatedErp {
  const catalogItems = SEED_PRODUCTS.map(({ sku, name, priceInCents }) => ({ sku, name, priceInCents }));
  return new SimulatedErp(catalogItems, {
    responseDelayMs: config.erp.simulatedLatencyMs,
    timeoutMs: config.erp.timeoutMs,
  });
}

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfigFromEnvironment },
    { provide: Clock, useClass: SystemClock },
    { provide: InMemoryStoreDatabase, useFactory: createSeededStoreDatabase },
    { provide: OrderRepository, useExisting: InMemoryStoreDatabase },
    { provide: OutboxRepository, useExisting: InMemoryStoreDatabase },
    { provide: StockLevels, useExisting: InMemoryStoreDatabase },
    { provide: SimulatedErp, inject: [APP_CONFIG], useFactory: createSimulatedErp },
    { provide: InvoicingGateway, useExisting: SimulatedErp },
    {
      provide: ProductCatalog,
      inject: [SimulatedErp, APP_CONFIG, Clock],
      useFactory: (erp: SimulatedErp, config: AppConfig, clock: Clock) =>
        new CachedErpProductCatalog(erp, config.catalogCache, clock),
    },
    {
      provide: InMemoryQueue,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new InMemoryQueue('orders', config.invoicingWorker.concurrency),
    },
    { provide: OrderQueue, useExisting: InMemoryQueue },
  ],
  exports: [
    APP_CONFIG,
    Clock,
    InMemoryStoreDatabase,
    OrderRepository,
    OutboxRepository,
    StockLevels,
    SimulatedErp,
    InvoicingGateway,
    ProductCatalog,
    InMemoryQueue,
    OrderQueue,
  ],
})
export class InfrastructureModule {}

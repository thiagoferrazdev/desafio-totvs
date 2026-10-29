import { NewOrderRequest } from '../../../src/application/ports/order-repository';
import { InMemoryStoreDatabase } from '../../../src/infrastructure/persistence/in-memory-store-database';

function databaseWithStock(sku: string, units: number): InMemoryStoreDatabase {
  const database = new InMemoryStoreDatabase();
  database.addProductStock(sku, units);
  return database;
}

function orderRequest(overrides: Partial<NewOrderRequest> = {}): NewOrderRequest {
  return {
    customerId: 'customer-1',
    items: [{ sku: 'A', quantity: 1 }],
    findPriceInCents: () => 1_000,
    idempotencyKey: 'key-0001',
    correlationId: 'correlation-1',
    now: 0,
    ...overrides,
  };
}

describe('InMemoryStoreDatabase', () => {
  it('treats a product with stock but no price as an unknown sku', () => {
    const database = databaseWithStock('A', 5);

    const result = database.reserveStockAndCreateOrder(orderRequest({ findPriceInCents: () => undefined }));

    expect(result).toEqual({ outcome: 'unknown_sku', sku: 'A' });
  });

  it('adds up repeated lines of the same sku before checking the stock', () => {
    const database = databaseWithStock('A', 3);

    const result = database.reserveStockAndCreateOrder(
      orderRequest({
        items: [
          { sku: 'A', quantity: 2 },
          { sku: 'A', quantity: 2 },
        ],
      }),
    );

    expect(result).toMatchObject({ outcome: 'out_of_stock', sku: 'A', availableUnits: 3 });
  });

  it('refuses to change or claim an order that does not exist', () => {
    const database = new InMemoryStoreDatabase();

    expect(database.changeOrderStatus('missing', ['ACCEPTED'], 'CONFIRMED', {})).toBe(false);
    expect(database.claimInvoicingAttempt('missing', 0)).toBe(false);
  });

  it('ignores a request to publish an outbox event it does not know', () => {
    const database = new InMemoryStoreDatabase();

    expect(() => database.markOutboxEventAsPublished('missing')).not.toThrow();
  });

  it('catches an invalid transition that would return stock that was already sold', () => {
    const database = databaseWithStock('A', 1);
    const created = database.reserveStockAndCreateOrder(orderRequest());
    const orderId = created.outcome === 'order_created' ? created.order.id : '';
    database.changeOrderStatus(orderId, ['ACCEPTED'], 'CONFIRMED', {});

    database.changeOrderStatus(orderId, ['CONFIRMED'], 'FAILED', {});

    expect(database.isStockConsistent()).toBe(false);
  });
});

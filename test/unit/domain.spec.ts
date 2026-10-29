import { canBeInvoiced, hasBeenSentToTheErpBefore, isWaitingForReconciliation } from '../../src/domain/order';
import { OrderFactory } from '../../src/domain/order-factory';
import { ProductStock } from '../../src/domain/product-stock';
import { anOrder } from '../support/builders';

describe('ProductStock', () => {
  it('moves units from available to reserved and back when released', () => {
    const stock = ProductStock.withUnits(5);

    stock.reserve(2);
    expect(stock.unitsAvailable()).toBe(3);
    stock.release(2);

    expect(stock.unitsAvailable()).toBe(5);
    expect(stock.isConsistent()).toBe(true);
  });

  it('keeps sold units out of the available stock after the sale is confirmed', () => {
    const stock = ProductStock.withUnits(5);

    stock.reserve(2);
    stock.confirmSale(2);

    expect(stock.unitsAvailable()).toBe(3);
    expect(stock.isConsistent()).toBe(true);
  });

  it('only allows reserving what is available', () => {
    const stock = ProductStock.withUnits(2);

    expect(stock.canReserve(2)).toBe(true);
    expect(stock.canReserve(3)).toBe(false);
  });

  it('reports an inconsistent stock when units go negative or above the total', () => {
    const negativeReservation = ProductStock.withUnits(1);
    negativeReservation.release(1);
    const negativeAvailable = ProductStock.withUnits(1);
    negativeAvailable.reserve(2);

    expect(negativeReservation.isConsistent()).toBe(false);
    expect(negativeAvailable.isConsistent()).toBe(false);
  });
});

describe('Order rules', () => {
  it('can be invoiced only while accepted or processing', () => {
    expect(canBeInvoiced(anOrder().withStatus('ACCEPTED').build())).toBe(true);
    expect(canBeInvoiced(anOrder().withStatus('PROCESSING').build())).toBe(true);
    expect(canBeInvoiced(anOrder().withStatus('CONFIRMED').build())).toBe(false);
    expect(canBeInvoiced(anOrder().withStatus('NEEDS_RECONCILIATION').build())).toBe(false);
  });

  it('knows when it is waiting for reconciliation', () => {
    expect(isWaitingForReconciliation(anOrder().withStatus('NEEDS_RECONCILIATION').build())).toBe(true);
    expect(isWaitingForReconciliation(anOrder().withStatus('FAILED').build())).toBe(false);
  });

  it('knows when it was already sent to the ERP', () => {
    expect(hasBeenSentToTheErpBefore(anOrder().withInvoicingAttempts(0).build())).toBe(false);
    expect(hasBeenSentToTheErpBefore(anOrder().withInvoicingAttempts(1).build())).toBe(true);
  });
});

describe('OrderFactory', () => {
  it('creates an accepted order with the total of its items', () => {
    const order = OrderFactory.createAccepted({
      id: 'order-1',
      customerId: 'customer-1',
      items: [
        { sku: 'A', quantity: 2, unitPriceInCents: 1_000 },
        { sku: 'B', quantity: 1, unitPriceInCents: 500 },
      ],
      correlationId: 'correlation-1',
      createdAt: 42,
    });

    expect(order).toMatchObject({ status: 'ACCEPTED', totalInCents: 2_500, invoicingAttempts: 0, updatedAt: 42 });
  });
});

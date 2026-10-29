import { InvoicingGateway } from '../../src/application/ports/invoicing-gateway';
import { OrderQueue } from '../../src/application/ports/order-queue';
import { OrderRepository } from '../../src/application/ports/order-repository';
import { StockLevels } from '../../src/application/ports/stock-levels';

export function fakeOrderRepository(): jest.Mocked<OrderRepository> {
  return {
    findOrderById: jest.fn(),
    findOrdersByStatus: jest.fn().mockReturnValue([]),
    reserveStockAndCreateOrder: jest.fn(),
    changeOrderStatus: jest.fn().mockReturnValue(true),
    claimInvoicingAttempt: jest.fn().mockReturnValue(true),
  };
}

export function fakeInvoicingGateway(): jest.Mocked<InvoicingGateway> {
  return {
    createInvoice: jest.fn().mockResolvedValue({ invoiceId: 'INV-NEW' }),
    findInvoiceInErpDatabaseByOrderId: jest.fn().mockResolvedValue(null),
  };
}

export function fakeOrderQueue(): jest.Mocked<OrderQueue> {
  return {
    publish: jest.fn(),
    moveToDeadLetterQueue: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
  };
}

export function fakeStockLevels(availableUnits?: number): jest.Mocked<StockLevels> {
  return {
    getAvailableUnits: jest.fn().mockReturnValue(availableUnits),
    isStockConsistent: jest.fn().mockReturnValue(true),
  };
}

export function fixedClock(now: number) {
  return { now: () => now };
}

import { Order, OrderStatus } from '../../domain/order';

export interface NewOrderRequest {
  customerId: string;
  items: { sku: string; quantity: number }[];
  findPriceInCents: (sku: string) => number | undefined;
  idempotencyKey: string;
  correlationId: string;
  traceparent?: string;
  now: number;
}

export type CheckoutRejection =
  | { outcome: 'idempotency_key_reused_with_different_payload' }
  | { outcome: 'out_of_stock'; sku: string; availableUnits: number }
  | { outcome: 'unknown_sku'; sku: string };

export type ReserveStockAndCreateOrderResult =
  | { outcome: 'order_created'; order: Order }
  | { outcome: 'order_already_exists_for_key'; order: Order }
  | CheckoutRejection;

export type OrderChanges = Partial<Pick<Order, 'invoiceId' | 'failureReason'>>;

export abstract class OrderRepository {
  abstract findOrderById(orderId: string): Order | undefined;

  abstract findOrdersByStatus(statuses: readonly OrderStatus[]): Order[];

  abstract reserveStockAndCreateOrder(request: NewOrderRequest): ReserveStockAndCreateOrderResult;

  abstract changeOrderStatus(
    orderId: string,
    allowedCurrentStatuses: readonly OrderStatus[],
    newStatus: OrderStatus,
    changes: OrderChanges,
    now?: number,
  ): boolean;

  abstract claimInvoicingAttempt(orderId: string, attemptsSeenByCaller: number): boolean;
}

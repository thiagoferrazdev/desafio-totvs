import { Order, OrderItem } from './order';

export interface NewOrderDetails {
  id: string;
  customerId: string;
  items: OrderItem[];
  correlationId: string;
  traceparent?: string;
  createdAt: number;
}

export class OrderFactory {
  static createAccepted(details: NewOrderDetails): Order {
    return {
      id: details.id,
      status: 'ACCEPTED',
      customerId: details.customerId,
      items: details.items,
      totalInCents: totalOf(details.items),
      invoicingAttempts: 0,
      correlationId: details.correlationId,
      traceparent: details.traceparent,
      createdAt: details.createdAt,
      updatedAt: details.createdAt,
    };
  }
}

function totalOf(items: OrderItem[]): number {
  return items.reduce((total, item) => total + item.unitPriceInCents * item.quantity, 0);
}

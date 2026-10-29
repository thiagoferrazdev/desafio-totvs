import { Order, OrderItem, OrderStatus } from '../../src/domain/order';

interface CheckoutRequestBody {
  customerId: string;
  items: { sku: string; quantity: number }[];
}

export class CheckoutRequestBuilder {
  private customerId = 'customer-1';
  private readonly items: { sku: string; quantity: number }[] = [];

  forCustomer(customerId: string): this {
    this.customerId = customerId;
    return this;
  }

  withItem(sku: string, quantity = 1): this {
    this.items.push({ sku, quantity });
    return this;
  }

  build(): CheckoutRequestBody {
    return { customerId: this.customerId, items: [...this.items] };
  }
}

export function aCheckoutRequest(): CheckoutRequestBuilder {
  return new CheckoutRequestBuilder();
}

export class OrderBuilder {
  private order: Order = {
    id: 'order-1',
    status: 'ACCEPTED',
    customerId: 'customer-1',
    items: [{ sku: 'CASE-IPH15-BLK', quantity: 1, unitPriceInCents: 7990 }],
    totalInCents: 7990,
    invoicingAttempts: 0,
    correlationId: 'correlation-1',
    createdAt: 0,
    updatedAt: 0,
  };

  withId(id: string): this {
    this.order = { ...this.order, id };
    return this;
  }

  withStatus(status: OrderStatus): this {
    this.order = { ...this.order, status };
    return this;
  }

  withInvoicingAttempts(invoicingAttempts: number): this {
    this.order = { ...this.order, invoicingAttempts };
    return this;
  }

  withItems(items: OrderItem[]): this {
    this.order = { ...this.order, items };
    return this;
  }

  build(): Order {
    return { ...this.order, items: this.order.items.map((item) => ({ ...item })) };
  }
}

export function anOrder(): OrderBuilder {
  return new OrderBuilder();
}

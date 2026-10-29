import { ReserveStockAndCreateOrderResult } from '../ports/order-repository';

export interface PlaceOrderDetails {
  customerId: string;
  items: { sku: string; quantity: number }[];
  idempotencyKey: string;
  correlationId: string;
  traceparent?: string;
}

export class PlaceOrderCommand {
  readonly customerId: string;
  readonly items: { sku: string; quantity: number }[];
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly traceparent?: string;

  constructor(details: PlaceOrderDetails) {
    this.customerId = details.customerId;
    this.items = details.items;
    this.idempotencyKey = details.idempotencyKey;
    this.correlationId = details.correlationId;
    this.traceparent = details.traceparent;
  }
}

export type PlaceOrderResult = ReserveStockAndCreateOrderResult;

export class PricingUnavailableError extends Error {
  constructor() {
    super('Cannot price the order right now, retry later');
  }
}

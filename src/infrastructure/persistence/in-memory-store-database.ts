import { createHash, randomUUID } from 'node:crypto';
import {
  CheckoutRejection,
  NewOrderRequest,
  OrderChanges,
  OrderRepository,
  ReserveStockAndCreateOrderResult,
} from '../../application/ports/order-repository';
import { OutboxEvent, OutboxRepository } from '../../application/ports/outbox-repository';
import { StockLevels } from '../../application/ports/stock-levels';
import { canBeInvoiced, Order, OrderItem, OrderStatus } from '../../domain/order';
import { OrderFactory } from '../../domain/order-factory';
import { ProductStock } from '../../domain/product-stock';
import { availableStockUnits, rejectedStockReservations, stockInvariantViolations } from '../../shared/metrics';

interface IdempotencyRecord {
  payloadFingerprint: string;
  orderId: string;
}

export class InMemoryStoreDatabase implements OrderRepository, OutboxRepository, StockLevels {
  private readonly stockBySku = new Map<string, ProductStock>();
  private readonly ordersById = new Map<string, Order>();
  private readonly idempotencyRecordsByKey = new Map<string, IdempotencyRecord>();
  private readonly outboxEvents: OutboxEvent[] = [];

  addProductStock(sku: string, units: number): void {
    this.stockBySku.set(sku, ProductStock.withUnits(units));
    this.updateAvailableStockMetric();
  }

  getAvailableUnits(sku: string): number | undefined {
    return this.stockBySku.get(sku)?.unitsAvailable();
  }

  findOrderById(orderId: string): Order | undefined {
    const order = this.ordersById.get(orderId);
    return order ? copyOf(order) : undefined;
  }

  findOrdersByStatus(statuses: readonly OrderStatus[]): Order[] {
    return [...this.ordersById.values()].filter((order) => statuses.includes(order.status)).map(copyOf);
  }

  reserveStockAndCreateOrder(request: NewOrderRequest): ReserveStockAndCreateOrderResult {
    const payloadFingerprint = fingerprintOf(request);
    const existingRecord = this.idempotencyRecordsByKey.get(request.idempotencyKey);
    if (existingRecord) return this.replayPreviousRequest(existingRecord, payloadFingerprint);

    const requestedUnitsBySku = sumQuantitiesBySku(request.items);
    const rejection = this.findReasonToReject(requestedUnitsBySku, request.findPriceInCents);
    if (rejection) return rejection;

    const items = this.reserveUnits(requestedUnitsBySku, request.findPriceInCents);
    const order = this.createOrder(request, items);
    this.idempotencyRecordsByKey.set(request.idempotencyKey, { payloadFingerprint, orderId: order.id });
    this.addOrderAcceptedToOutbox(order);
    return { outcome: 'order_created', order: copyOf(order) };
  }

  changeOrderStatus(
    orderId: string,
    allowedCurrentStatuses: readonly OrderStatus[],
    newStatus: OrderStatus,
    changes: OrderChanges,
    now = Date.now(),
  ): boolean {
    const order = this.ordersById.get(orderId);
    if (!order || !allowedCurrentStatuses.includes(order.status)) return false;

    order.status = newStatus;
    order.updatedAt = now;
    Object.assign(order, changes);
    if (newStatus === 'CONFIRMED') this.turnReservationIntoSale(order);
    if (newStatus === 'FAILED') this.returnReservedUnitsToStock(order);
    return true;
  }

  claimInvoicingAttempt(orderId: string, attemptsSeenByCaller: number): boolean {
    const order = this.ordersById.get(orderId);
    if (!order || !canBeInvoiced(order)) return false;
    if (order.invoicingAttempts !== attemptsSeenByCaller) return false;

    order.status = 'PROCESSING';
    order.invoicingAttempts += 1;
    order.updatedAt = Date.now();
    return true;
  }

  listUnpublishedOutboxEvents(): OutboxEvent[] {
    return this.outboxEvents.filter((event) => !event.publishedAt).map((event) => ({ ...event }));
  }

  markOutboxEventAsPublished(eventId: string): void {
    const event = this.outboxEvents.find((candidate) => candidate.id === eventId);
    if (event) event.publishedAt = Date.now();
  }

  isStockConsistent(): boolean {
    const everyProductIsConsistent = [...this.stockBySku.values()].every((stock) => stock.isConsistent());
    if (!everyProductIsConsistent) stockInvariantViolations.inc();
    return everyProductIsConsistent;
  }

  private replayPreviousRequest(record: IdempotencyRecord, payloadFingerprint: string): ReserveStockAndCreateOrderResult {
    if (record.payloadFingerprint !== payloadFingerprint) {
      return { outcome: 'idempotency_key_reused_with_different_payload' };
    }
    return { outcome: 'order_already_exists_for_key', order: this.findOrderById(record.orderId)! };
  }

  private findReasonToReject(
    requestedUnitsBySku: Map<string, number>,
    findPriceInCents: NewOrderRequest['findPriceInCents'],
  ): CheckoutRejection | undefined {
    for (const [sku, requestedUnits] of requestedUnitsBySku) {
      const stock = this.stockBySku.get(sku);
      if (!stock || findPriceInCents(sku) === undefined) return { outcome: 'unknown_sku', sku };
      if (!stock.canReserve(requestedUnits)) {
        rejectedStockReservations.inc();
        return { outcome: 'out_of_stock', sku, availableUnits: stock.unitsAvailable() };
      }
    }
    return undefined;
  }

  private reserveUnits(
    requestedUnitsBySku: Map<string, number>,
    findPriceInCents: NewOrderRequest['findPriceInCents'],
  ): OrderItem[] {
    const items: OrderItem[] = [];
    for (const [sku, requestedUnits] of requestedUnitsBySku) {
      this.stockBySku.get(sku)!.reserve(requestedUnits);
      items.push({ sku, quantity: requestedUnits, unitPriceInCents: findPriceInCents(sku)! });
    }
    this.updateAvailableStockMetric();
    return items;
  }

  private createOrder(request: NewOrderRequest, items: OrderItem[]): Order {
    const order = OrderFactory.createAccepted({
      id: randomUUID(),
      customerId: request.customerId,
      items,
      correlationId: request.correlationId,
      traceparent: request.traceparent,
      createdAt: request.now,
    });
    this.ordersById.set(order.id, order);
    return order;
  }

  private addOrderAcceptedToOutbox(order: Order): void {
    this.outboxEvents.push({
      id: randomUUID(),
      type: 'order.accepted',
      orderId: order.id,
      correlationId: order.correlationId,
      traceparent: order.traceparent,
    });
  }

  private turnReservationIntoSale(order: Order): void {
    for (const item of order.items) this.stockBySku.get(item.sku)!.confirmSale(item.quantity);
    this.updateAvailableStockMetric();
  }

  private returnReservedUnitsToStock(order: Order): void {
    for (const item of order.items) this.stockBySku.get(item.sku)!.release(item.quantity);
    this.updateAvailableStockMetric();
  }

  private updateAvailableStockMetric(): void {
    let totalAvailableUnits = 0;
    for (const stock of this.stockBySku.values()) totalAvailableUnits += stock.unitsAvailable();
    availableStockUnits.set(totalAvailableUnits);
  }
}

function sumQuantitiesBySku(items: NewOrderRequest['items']): Map<string, number> {
  const quantitiesBySku = new Map<string, number>();
  for (const item of items) {
    quantitiesBySku.set(item.sku, (quantitiesBySku.get(item.sku) ?? 0) + item.quantity);
  }
  return quantitiesBySku;
}

function fingerprintOf(request: NewOrderRequest): string {
  const itemsInStableOrder = [...request.items].sort((first, second) => first.sku.localeCompare(second.sku));
  return createHash('sha256').update(JSON.stringify([request.customerId, itemsInStableOrder])).digest('hex');
}

function copyOf(order: Order): Order {
  return { ...order, items: order.items.map((item) => ({ ...item })) };
}

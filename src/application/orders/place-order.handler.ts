import { checkoutOutcomes } from '../../shared/metrics';
import { CommandHandler } from '../command-handler';
import { PublishOutboxEventsCommand } from '../outbox/publish-outbox-events.command';
import { Clock } from '../ports/clock';
import { OrderRepository } from '../ports/order-repository';
import { ProductCatalog } from '../ports/product-catalog';
import { PlaceOrderCommand, PlaceOrderResult, PricingUnavailableError } from './place-order.command';

const METRIC_OUTCOME_BY_RESULT: Record<PlaceOrderResult['outcome'], string> = {
  order_created: 'accepted',
  order_already_exists_for_key: 'replayed',
  out_of_stock: 'out_of_stock',
  unknown_sku: 'unknown_sku',
  idempotency_key_reused_with_different_payload: 'idempotency_key_reused',
};

export class PlaceOrderHandler implements CommandHandler<PlaceOrderCommand, PlaceOrderResult> {
  constructor(
    private readonly orders: OrderRepository,
    private readonly catalog: ProductCatalog,
    private readonly publishOutboxEvents: CommandHandler<PublishOutboxEventsCommand, number>,
    private readonly clock: Clock,
  ) {}

  async execute(command: PlaceOrderCommand): Promise<PlaceOrderResult> {
    const pricesBySku = await this.loadPricesOrFail();
    const result = this.orders.reserveStockAndCreateOrder({
      customerId: command.customerId,
      items: command.items,
      findPriceInCents: (sku) => pricesBySku.get(sku),
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      traceparent: command.traceparent,
      now: this.clock.now(),
    });

    checkoutOutcomes.inc({ outcome: METRIC_OUTCOME_BY_RESULT[result.outcome] });
    if (result.outcome === 'order_created') await this.publishOutboxEvents.execute(new PublishOutboxEventsCommand());
    return result;
  }

  private async loadPricesOrFail(): Promise<Map<string, number>> {
    try {
      const snapshot = await this.catalog.loadSnapshot();
      return new Map(snapshot.items.map((item) => [item.sku, item.priceInCents]));
    } catch {
      checkoutOutcomes.inc({ outcome: 'pricing_unavailable' });
      throw new PricingUnavailableError();
    }
  }
}

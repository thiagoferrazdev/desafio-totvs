export interface OutboxEvent {
  id: string;
  type: 'order.accepted';
  orderId: string;
  correlationId: string;
  traceparent?: string;
  publishedAt?: number;
}

export abstract class OutboxRepository {
  abstract listUnpublishedOutboxEvents(): OutboxEvent[];

  abstract markOutboxEventAsPublished(eventId: string): void;
}

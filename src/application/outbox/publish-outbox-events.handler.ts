import { logger } from '../../shared/logger';
import { CommandHandler } from '../command-handler';
import { InvoicingMessageFactory } from '../invoicing/invoicing-message.factory';
import { OrderQueue } from '../ports/order-queue';
import { OutboxEvent, OutboxRepository } from '../ports/outbox-repository';
import { PublishOutboxEventsCommand } from './publish-outbox-events.command';

export class PublishOutboxEventsHandler implements CommandHandler<PublishOutboxEventsCommand, number> {
  constructor(
    private readonly outbox: OutboxRepository,
    private readonly queue: OrderQueue,
  ) {}

  async execute(_command: PublishOutboxEventsCommand): Promise<number> {
    const pendingEvents = this.outbox.listUnpublishedOutboxEvents();
    for (const event of pendingEvents) this.publish(event);
    if (pendingEvents.length > 0) logger.debug({ publishedEvents: pendingEvents.length }, 'outbox events published');
    return pendingEvents.length;
  }

  private publish(event: OutboxEvent): void {
    this.queue.publish(
      InvoicingMessageFactory.firstAttempt({
        messageId: event.id,
        orderId: event.orderId,
        correlationId: event.correlationId,
        traceparent: event.traceparent,
        enqueuedAt: Date.now(),
      }),
    );
    this.outbox.markOutboxEventAsPublished(event.id);
  }
}

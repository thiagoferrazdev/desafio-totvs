import { OrderMessage, OrderMessageHandler, OrderQueue } from '../../application/ports/order-queue';
import { queueDepth, queueOldestMessageAge } from '../../shared/metrics';
import { sleep } from '../../shared/timing';

interface WaitingMessage {
  message: OrderMessage;
  deliverAfter: number;
}

const REDELIVERY_DELAY_AFTER_HANDLER_CRASH_MS = 1_000;

export class InMemoryQueue implements OrderQueue {
  readonly deadLetterMessages: OrderMessage[] = [];

  private waitingMessages: WaitingMessage[] = [];
  private messagesBeingHandled = 0;
  private nextDeliveryTimer?: NodeJS.Timeout;
  private handler?: OrderMessageHandler;

  constructor(
    readonly name: string,
    private readonly maxConcurrentHandlers: number,
  ) {}

  publish(message: OrderMessage, delayMs = 0): void {
    this.waitingMessages.push({ message, deliverAfter: Date.now() + delayMs });
    this.reportMetrics();
    this.deliverReadyMessages();
  }

  moveToDeadLetterQueue(message: OrderMessage): void {
    this.deadLetterMessages.push(message);
  }

  subscribe(handler: OrderMessageHandler): void {
    this.handler = handler;
    this.deliverReadyMessages();
  }

  unsubscribe(): void {
    this.handler = undefined;
    if (this.nextDeliveryTimer) clearTimeout(this.nextDeliveryTimer);
  }

  pendingCount(): number {
    return this.waitingMessages.length + this.messagesBeingHandled;
  }

  async waitUntilEmpty(timeoutMs = 5_000): Promise<void> {
    const startedAt = Date.now();
    while (this.pendingCount() > 0) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`queue ${this.name} still has ${this.pendingCount()} messages`);
      }
      await sleep(2);
    }
  }

  private deliverReadyMessages(): void {
    const handler = this.handler;
    if (!handler) return;

    let readyMessage = this.takeNextReadyMessage();
    while (readyMessage) {
      this.deliver(readyMessage, handler);
      readyMessage = this.takeNextReadyMessage();
    }
    this.scheduleNextDelayedDelivery();
  }

  private takeNextReadyMessage(): OrderMessage | undefined {
    if (this.messagesBeingHandled >= this.maxConcurrentHandlers) return undefined;
    const now = Date.now();
    const readyIndex = this.waitingMessages.findIndex((waiting) => waiting.deliverAfter <= now);
    if (readyIndex < 0) return undefined;
    const [ready] = this.waitingMessages.splice(readyIndex, 1);
    return ready?.message;
  }

  private deliver(message: OrderMessage, handler: OrderMessageHandler): void {
    this.messagesBeingHandled += 1;
    handler(message)
      .catch(() => this.publish(message, REDELIVERY_DELAY_AFTER_HANDLER_CRASH_MS))
      .finally(() => {
        this.messagesBeingHandled -= 1;
        this.reportMetrics();
        this.deliverReadyMessages();
      });
  }

  private scheduleNextDelayedDelivery(): void {
    if (this.nextDeliveryTimer) clearTimeout(this.nextDeliveryTimer);
    if (this.waitingMessages.length === 0) return;
    const earliestDelivery = Math.min(...this.waitingMessages.map((waiting) => waiting.deliverAfter));
    this.nextDeliveryTimer = setTimeout(() => this.deliverReadyMessages(), Math.max(1, earliestDelivery - Date.now()));
  }

  private reportMetrics(): void {
    queueDepth.set({ queue: this.name }, this.pendingCount());
    queueOldestMessageAge.set({ queue: this.name }, this.oldestWaitingMessageAgeSeconds());
  }

  private oldestWaitingMessageAgeSeconds(): number {
    if (this.waitingMessages.length === 0) return 0;
    const oldestEnqueuedAt = Math.min(...this.waitingMessages.map((waiting) => waiting.message.enqueuedAt));
    return (Date.now() - oldestEnqueuedAt) / 1000;
  }
}

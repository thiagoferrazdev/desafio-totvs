export interface OrderMessage {
  messageId: string;
  orderId: string;
  attempt: number;
  correlationId: string;
  traceparent?: string;
  enqueuedAt: number;
}

export type OrderMessageHandler = (message: OrderMessage) => Promise<void>;

export abstract class OrderQueue {
  abstract publish(message: OrderMessage, delayMs?: number): void;

  abstract moveToDeadLetterQueue(message: OrderMessage): void;

  abstract subscribe(handler: OrderMessageHandler): void;

  abstract unsubscribe(): void;
}

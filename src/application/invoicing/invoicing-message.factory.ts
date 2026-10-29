import { OrderMessage } from '../ports/order-queue';

export type FirstAttemptDetails = Omit<OrderMessage, 'attempt'>;

export class InvoicingMessageFactory {
  static firstAttempt(details: FirstAttemptDetails): OrderMessage {
    return { ...details, attempt: 1 };
  }

  static nextAttemptOf(message: OrderMessage): OrderMessage {
    return { ...message, attempt: message.attempt + 1 };
  }
}

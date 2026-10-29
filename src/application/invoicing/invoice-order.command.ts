import { OrderMessage } from '../ports/order-queue';

export class InvoiceOrderCommand {
  constructor(readonly message: OrderMessage) {}
}

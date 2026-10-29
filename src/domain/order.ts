export type OrderStatus = 'ACCEPTED' | 'PROCESSING' | 'CONFIRMED' | 'FAILED' | 'NEEDS_RECONCILIATION';

export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = ['ACCEPTED', 'PROCESSING', 'NEEDS_RECONCILIATION'];
export const STATUSES_READY_FOR_INVOICING: readonly OrderStatus[] = ['ACCEPTED', 'PROCESSING'];

export interface OrderItem {
  sku: string;
  quantity: number;
  unitPriceInCents: number;
}

export interface Order {
  id: string;
  status: OrderStatus;
  customerId: string;
  items: OrderItem[];
  totalInCents: number;
  invoicingAttempts: number;
  invoiceId?: string;
  failureReason?: string;
  correlationId: string;
  traceparent?: string;
  createdAt: number;
  updatedAt: number;
}

export function isWaitingForReconciliation(order: Order): boolean {
  return order.status === 'NEEDS_RECONCILIATION';
}

export function canBeInvoiced(order: Order): boolean {
  return STATUSES_READY_FOR_INVOICING.includes(order.status);
}

export function hasBeenSentToTheErpBefore(order: Order): boolean {
  return order.invoicingAttempts > 0;
}

export interface InvoiceRequest {
  orderId: string;
  items: { sku: string; quantity: number; unitPriceInCents: number }[];
  totalInCents: number;
}

export interface Invoice {
  invoiceId: string;
}

export class InvoiceRejectedError extends Error {}

export abstract class InvoicingGateway {
  abstract createInvoice(request: InvoiceRequest): Promise<Invoice>;

  abstract findInvoiceInErpDatabaseByOrderId(orderId: string): Promise<Invoice | null>;
}

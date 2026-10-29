import { Invoice, InvoiceRejectedError, InvoiceRequest, InvoicingGateway } from '../../application/ports/invoicing-gateway';
import { CatalogItem } from '../../application/ports/product-catalog';
import { erpCallDuration, erpCalls } from '../../shared/metrics';
import { failIfSlowerThan, sleep } from '../../shared/timing';
import { runInSpan } from '../../shared/tracing';
import { ErpProductSource } from './erp-product-source';

export class ErpUnavailableError extends Error {}

export interface SimulatedErpOptions {
  responseDelayMs: number;
  timeoutMs: number;
}

interface CreatedInvoice {
  invoiceId: string;
  orderId: string;
  request: InvoiceRequest;
}

export class SimulatedErp implements InvoicingGateway, ErpProductSource {
  failProductListing = false;
  failNextInvoiceRequests = 0;
  rejectNextInvoiceRequests = 0;
  loseResponseOfNextCommittedInvoices = 0;
  failInvoiceLookups = false;
  productListRequestCount = 0;
  readonly createdInvoices: CreatedInvoice[] = [];

  constructor(
    private readonly products: readonly CatalogItem[],
    private readonly options: SimulatedErpOptions,
  ) {}

  listProducts(): Promise<CatalogItem[]> {
    return this.callErp('list_products', async () => {
      this.productListRequestCount += 1;
      if (this.failProductListing) throw new ErpUnavailableError('ERP returned 503');
      return this.products.map((product) => ({ ...product }));
    });
  }

  createInvoice(request: InvoiceRequest): Promise<Invoice> {
    return this.callErp('create_invoice', async () => {
      this.failIfAskedTo();
      const invoice = { invoiceId: `INV-${this.createdInvoices.length + 1}`, orderId: request.orderId, request };
      this.createdInvoices.push(invoice);
      await this.loseResponseIfAskedTo();
      return { invoiceId: invoice.invoiceId };
    });
  }

  findInvoiceInErpDatabaseByOrderId(orderId: string): Promise<Invoice | null> {
    return this.callErp('find_invoice_in_database', async () => {
      if (this.failInvoiceLookups) throw new ErpUnavailableError('ERP read replica unavailable');
      const invoice = this.createdInvoices.find((candidate) => candidate.orderId === orderId);
      return invoice ? { invoiceId: invoice.invoiceId } : null;
    });
  }

  countInvoicesForOrder(orderId: string): number {
    return this.createdInvoices.filter((invoice) => invoice.orderId === orderId).length;
  }

  private failIfAskedTo(): void {
    if (this.failNextInvoiceRequests > 0) {
      this.failNextInvoiceRequests -= 1;
      throw new ErpUnavailableError('ERP returned 503');
    }
    if (this.rejectNextInvoiceRequests > 0) {
      this.rejectNextInvoiceRequests -= 1;
      throw new InvoiceRejectedError('ERP returned 422: customer blocked');
    }
  }

  private async loseResponseIfAskedTo(): Promise<void> {
    if (this.loseResponseOfNextCommittedInvoices === 0) return;
    this.loseResponseOfNextCommittedInvoices -= 1;
    await sleep(this.options.timeoutMs + 20);
  }

  private callErp<T>(operation: string, erpWork: () => Promise<T>): Promise<T> {
    return runInSpan(`erp.${operation}`, { 'peer.service': 'erp' }, async () => {
      const stopTimer = erpCallDuration.startTimer({ operation });
      try {
        const result = await failIfSlowerThan(
          sleep(this.options.responseDelayMs).then(erpWork),
          this.options.timeoutMs,
          () => new ErpUnavailableError(`ERP timed out after ${this.options.timeoutMs}ms`),
        );
        erpCalls.inc({ operation, outcome: 'ok' });
        return result;
      } catch (error) {
        erpCalls.inc({ operation, outcome: outcomeOf(error) });
        throw error;
      } finally {
        stopTimer();
      }
    });
  }
}

function outcomeOf(error: unknown): string {
  return error instanceof InvoiceRejectedError ? 'rejected' : 'unavailable';
}

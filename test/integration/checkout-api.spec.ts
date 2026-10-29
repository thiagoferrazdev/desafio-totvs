import { clearRecentSpans, getRecentSpans } from '../../src/shared/tracing';
import { aCheckoutRequest } from '../support/builders';
import { postCheckout, startTestApplication, TestApplication } from '../support/test-application';

let testApp: TestApplication;

afterEach(() => testApp.close());

async function waitForOrderStatus(orderId: string, expectedStatus: string) {
  await testApp.queue.waitUntilEmpty();
  const response = await testApp.http.get(`/orders/${orderId}/status`);
  expect(response.body.status).toBe(expectedStatus);
  return response.body;
}

function findProduct(products: { sku: string; available: number }[], sku: string) {
  return products.find((product) => product.sku === sku)!;
}

describe('GET /products', () => {
  it('loads the catalog from the ERP once and then serves it from cache', async () => {
    testApp = await startTestApplication();

    const firstResponse = await testApp.http.get('/products');
    const secondResponse = await testApp.http.get('/products');

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers['x-cache']).toBe('miss');
    expect(secondResponse.headers['x-cache']).toBe('hit');
    expect(testApp.erp.productListRequestCount).toBe(1);
    expect(findProduct(secondResponse.body.items, 'CASE-PX8-BLU')).toMatchObject({ available: 0, inStock: false });
  });

  it('shows live availability even when the price comes from cache', async () => {
    testApp = await startTestApplication();
    await testApp.http.get('/products');

    await postCheckout(testApp, aCheckoutRequest().withItem('CASE-S24-CLR', 2).build());
    const response = await testApp.http.get('/products');

    expect(response.headers['x-cache']).toBe('hit');
    expect(findProduct(response.body.items, 'CASE-S24-CLR').available).toBe(1);
  });

  it('returns 503 with the error envelope when the ERP is down and nothing is cached', async () => {
    testApp = await startTestApplication();
    testApp.erp.failProductListing = true;

    const response = await testApp.http.get('/products');

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('CATALOG_UNAVAILABLE');
    expect(response.body.correlationId).toEqual(expect.any(String));
  });
});

describe('POST /checkout', () => {
  it('returns 202 with orderId and the order is confirmed asynchronously', async () => {
    testApp = await startTestApplication();

    const response = await postCheckout(testApp, aCheckoutRequest().withItem('CASE-IPH15-BLK', 2).build());

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ status: 'ACCEPTED', total: 2 * 7990 });
    expect(response.headers.location).toBe(`/orders/${response.body.orderId}/status`);
    const finalStatus = await waitForOrderStatus(response.body.orderId, 'CONFIRMED');
    expect(finalStatus.invoiceId).toMatch(/^INV-/);
  });

  it('never oversells: 100 buyers at the same time for 3 units means exactly 3 orders', async () => {
    testApp = await startTestApplication();

    const responses = await Promise.all(
      Array.from({ length: 100 }, () => postCheckout(testApp, aCheckoutRequest().withItem('CASE-S24-CLR').build())),
    );
    const statusCodes = responses.map((response) => response.status);

    expect(statusCodes.filter((status) => status === 202)).toHaveLength(3);
    expect(statusCodes.filter((status) => status === 409)).toHaveLength(97);
    expect(testApp.database.getAvailableUnits('CASE-S24-CLR')).toBe(0);
    expect(testApp.database.isStockConsistent()).toBe(true);
  });

  it('reserves nothing when one item of the cart is out of stock', async () => {
    testApp = await startTestApplication();

    const response = await postCheckout(testApp, {
      customerId: 'customer-1',
      items: [
        { sku: 'CASE-IPH15-BLK', quantity: 1 },
        { sku: 'CASE-PX8-BLU', quantity: 1 },
      ],
    });

    expect(response.status).toBe(409);
    expect(testApp.database.getAvailableUnits('CASE-IPH15-BLK')).toBe(50);
  });

  it('creates a single order and a single invoice for repeated requests with the same idempotency key', async () => {
    testApp = await startTestApplication();
    const sameKey = 'double-click-key-1';

    const responses = await Promise.all([
      postCheckout(testApp, aCheckoutRequest().withItem('CASE-IPH15-BLK', 2).build(), sameKey),
      postCheckout(testApp, aCheckoutRequest().withItem('CASE-IPH15-BLK', 2).build(), sameKey),
      postCheckout(testApp, aCheckoutRequest().withItem('CASE-IPH15-BLK', 2).build(), sameKey),
    ]);

    expect(new Set(responses.map((response) => response.body.orderId)).size).toBe(1);
    expect(responses.filter((response) => response.headers['idempotent-replayed'] === 'true')).toHaveLength(2);
    expect(testApp.database.getAvailableUnits('CASE-IPH15-BLK')).toBe(48);
    await testApp.queue.waitUntilEmpty();
    expect(testApp.erp.createdInvoices).toHaveLength(1);
  });

  it('rejects an idempotency key reused with a different payload', async () => {
    testApp = await startTestApplication();
    await postCheckout(testApp, aCheckoutRequest().withItem('CASE-IPH15-BLK', 1).build(), 'same-key-abcdef');

    const response = await postCheckout(testApp, aCheckoutRequest().withItem('CASE-IPH15-BLK', 2).build(), 'same-key-abcdef');

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('requires the Idempotency-Key header', async () => {
    testApp = await startTestApplication();

    const response = await testApp.http.post('/checkout').send(aCheckoutRequest().withItem('CASE-IPH15-BLK').build());

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('validates the request body', async () => {
    testApp = await startTestApplication();

    const emptyCart = await postCheckout(testApp, { customerId: '', items: [] });
    const zeroQuantity = await postCheckout(testApp, aCheckoutRequest().withItem('CASE-IPH15-BLK', 0).build());
    const unknownSku = await postCheckout(testApp, aCheckoutRequest().withItem('DOES-NOT-EXIST').build());

    expect(emptyCart.status).toBe(400);
    expect(emptyCart.body.error.code).toBe('VALIDATION_ERROR');
    expect(zeroQuantity.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'items.0.quantity' })]),
    );
    expect(unknownSku.status).toBe(422);
    expect(unknownSku.body.error.code).toBe('UNKNOWN_SKU');
  });

  it('fails with 503 and reserves nothing when the order cannot be priced', async () => {
    testApp = await startTestApplication();
    testApp.erp.failProductListing = true;

    const response = await postCheckout(testApp, aCheckoutRequest().withItem('CASE-IPH15-BLK').build());

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('PRICING_UNAVAILABLE');
    expect(testApp.database.getAvailableUnits('CASE-IPH15-BLK')).toBe(50);
  });

  it('carries correlation id and trace from the request to the worker through the queue', async () => {
    testApp = await startTestApplication();
    clearRecentSpans();
    const incomingTraceId = '0af7651916cd43dd8448eb211c80319c';

    const response = await postCheckout(testApp, aCheckoutRequest().withItem('CASE-IPH15-BLK').build(), undefined, {
      'x-correlation-id': 'correlation-123',
      traceparent: `00-${incomingTraceId}-b7ad6b7169203331-01`,
    });
    await testApp.queue.waitUntilEmpty();

    expect(response.headers['x-correlation-id']).toBe('correlation-123');
    expect(testApp.database.findOrderById(response.body.orderId)!.correlationId).toBe('correlation-123');
    const workerSpan = getRecentSpans().find((span) => span.name === 'worker.process_order')!;
    const erpSpan = getRecentSpans().find((span) => span.name === 'erp.create_invoice')!;
    expect(workerSpan.traceId).toBe(incomingTraceId);
    expect(erpSpan.parentSpanId).toBe(workerSpan.spanId);
  });
});

describe('GET /orders/:orderId/status', () => {
  it('returns 404 with the error envelope for an unknown order', async () => {
    testApp = await startTestApplication();

    const response = await testApp.http.get('/orders/unknown/status');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ORDER_NOT_FOUND');
  });
});

describe('GET /metrics', () => {
  it('exposes cache and request metrics for scraping', async () => {
    testApp = await startTestApplication();
    await testApp.http.get('/products');

    const metrics = await testApp.http.get('/metrics');

    expect(metrics.text).toContain('cache_requests_total');
    expect(metrics.text).toContain('http_request_duration_seconds_bucket{le="0.005",route="/products"');
  });
});

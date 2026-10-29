import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export const metricsRegistry = new Registry();

const registers = [metricsRegistry];

export const cacheLookups = new Counter({
  name: 'cache_requests_total',
  help: 'Catalog cache lookups by result (hit, stale, miss, stale_if_error)',
  labelNames: ['cache', 'result'] as const,
  registers,
});

export const cacheRefreshDuration = new Histogram({
  name: 'cache_refresh_duration_seconds',
  help: 'Time spent reloading the catalog from the ERP',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers,
});

export const cacheSnapshotAge = new Gauge({
  name: 'cache_entry_age_seconds',
  help: 'Age of the catalog snapshot served in the last request',
  labelNames: ['cache'] as const,
  registers,
});

export const erpCalls = new Counter({
  name: 'erp_calls_total',
  help: 'ERP calls by operation and outcome',
  labelNames: ['operation', 'outcome'] as const,
  registers,
});

export const erpCallDuration = new Histogram({
  name: 'erp_call_duration_seconds',
  help: 'ERP call latency',
  labelNames: ['operation'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers,
});

export const checkoutOutcomes = new Counter({
  name: 'checkout_requests_total',
  help: 'Checkout business outcomes',
  labelNames: ['outcome'] as const,
  registers,
});

export const finishedOrders = new Counter({
  name: 'orders_terminal_total',
  help: 'Orders that reached a final status',
  labelNames: ['status'] as const,
  registers,
});

export const orderConfirmationDuration = new Histogram({
  name: 'order_confirmation_seconds',
  help: 'Time from order accepted to order confirmed by the ERP',
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers,
});

export const rejectedStockReservations = new Counter({
  name: 'stock_reservation_rejected_total',
  help: 'Reservations rejected because there was not enough stock',
  registers,
});

export const availableStockUnits = new Gauge({
  name: 'stock_available_units',
  help: 'Sum of units available for sale across all products',
  registers,
});

export const stockInvariantViolations = new Counter({
  name: 'oversell_invariant_violations_total',
  help: 'Times the stock was found negative or above the total. Must always be zero',
  registers,
});

export const queueDepth = new Gauge({
  name: 'queue_depth',
  help: 'Messages waiting or being processed',
  labelNames: ['queue'] as const,
  registers,
});

export const queueOldestMessageAge = new Gauge({
  name: 'queue_oldest_message_age_seconds',
  help: 'Age of the oldest message still waiting in the queue',
  labelNames: ['queue'] as const,
  registers,
});

export const invoicingAttempts = new Counter({
  name: 'worker_attempts_total',
  help: 'Invoicing worker attempts by outcome',
  labelNames: ['outcome'] as const,
  registers,
});

export const deadLetteredMessages = new Counter({
  name: 'dlq_messages_total',
  help: 'Messages moved to the dead letter queue',
  registers,
});

export const reconciliationActions = new Counter({
  name: 'reconciliation_actions_total',
  help: 'Actions taken by the reconciliation job',
  labelNames: ['action'] as const,
  registers,
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency by route pattern',
  labelNames: ['route', 'method', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers,
});

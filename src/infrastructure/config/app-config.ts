export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  port: number;
  catalogCache: {
    freshForMs: number;
    serveStaleWhileRefreshingForMs: number;
    serveStaleOnErrorForMs: number;
    ttlJitterRatio: number;
  };
  erp: {
    timeoutMs: number;
    simulatedLatencyMs: number;
  };
  invoicingWorker: {
    concurrency: number;
    maxAttempts: number;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
  };
  outbox: {
    publishIntervalMs: number;
  };
  reconciliation: {
    intervalMs: number;
    considerStuckAfterMs: number;
    giveUpAfterMs: number;
  };
}

function readNumberFromEnvironment(name: string, defaultValue: number): number {
  const value = process.env[name];
  return value === undefined ? defaultValue : Number(value);
}

export function loadConfigFromEnvironment(): AppConfig {
  return {
    port: readNumberFromEnvironment('PORT', 3000),
    catalogCache: {
      freshForMs: readNumberFromEnvironment('CATALOG_CACHE_FRESH_FOR_MS', 30_000),
      serveStaleWhileRefreshingForMs: readNumberFromEnvironment('CATALOG_CACHE_STALE_WHILE_REFRESHING_MS', 60_000),
      serveStaleOnErrorForMs: readNumberFromEnvironment('CATALOG_CACHE_STALE_ON_ERROR_MS', 10 * 60_000),
      ttlJitterRatio: 0.1,
    },
    erp: {
      timeoutMs: readNumberFromEnvironment('ERP_TIMEOUT_MS', 2_000),
      simulatedLatencyMs: readNumberFromEnvironment('ERP_LATENCY_MS', 300),
    },
    invoicingWorker: {
      concurrency: readNumberFromEnvironment('INVOICING_WORKER_CONCURRENCY', 4),
      maxAttempts: readNumberFromEnvironment('INVOICING_MAX_ATTEMPTS', 5),
      retryBaseDelayMs: readNumberFromEnvironment('INVOICING_RETRY_BASE_DELAY_MS', 500),
      retryMaxDelayMs: 30_000,
    },
    outbox: {
      publishIntervalMs: readNumberFromEnvironment('OUTBOX_PUBLISH_INTERVAL_MS', 1_000),
    },
    reconciliation: {
      intervalMs: readNumberFromEnvironment('RECONCILIATION_INTERVAL_MS', 30_000),
      considerStuckAfterMs: readNumberFromEnvironment('RECONCILIATION_STUCK_AFTER_MS', 60_000),
      giveUpAfterMs: readNumberFromEnvironment('RECONCILIATION_GIVE_UP_AFTER_MS', 15 * 60_000),
    },
  };
}

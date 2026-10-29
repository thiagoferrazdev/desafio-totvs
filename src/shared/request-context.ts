import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  correlationId: string;
  traceId: string;
  spanId?: string;
  orderId?: string;
  requestRoot?: RequestContext;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, operation: () => T): T {
  return requestContextStorage.run(context, operation);
}

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function currentRequestContext(): RequestContext {
  const context = requestContextStorage.getStore();
  if (!context) throw new Error('No request context: run this inside runWithRequestContext');
  return context;
}

export function addOrderIdToRequestContext(orderId: string): void {
  const context = requestContextStorage.getStore();
  if (!context) return;
  context.orderId = orderId;
  if (context.requestRoot) context.requestRoot.orderId = orderId;
}

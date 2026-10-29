import { randomBytes } from 'node:crypto';
import { logger } from './logger';
import { getRequestContext, RequestContext, runWithRequestContext } from './request-context';

export interface FinishedSpan {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  durationMs: number;
  attributes: Record<string, unknown>;
  errorMessage?: string;
}

const MAX_RECENT_SPANS = 1000;
const recentSpans: FinishedSpan[] = [];

export function getRecentSpans(): readonly FinishedSpan[] {
  return recentSpans;
}

export function clearRecentSpans(): void {
  recentSpans.length = 0;
}

export function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

function recordFinishedSpan(span: FinishedSpan): void {
  recentSpans.push(span);
  if (recentSpans.length > MAX_RECENT_SPANS) recentSpans.shift();
  logger.debug({ span }, 'span finished');
}

export async function runInSpan<T>(
  spanName: string,
  attributes: Record<string, unknown>,
  operation: () => Promise<T> | T,
): Promise<T> {
  const parentContext = getRequestContext();
  const traceId = parentContext?.traceId ?? generateTraceId();
  const spanId = generateSpanId();
  const spanContext: RequestContext = {
    correlationId: parentContext?.correlationId ?? traceId,
    traceId,
    spanId,
    orderId: parentContext?.orderId,
    requestRoot: parentContext?.requestRoot ?? parentContext,
  };
  const startedAt = performance.now();
  let errorMessage: string | undefined;
  try {
    return await runWithRequestContext(spanContext, operation);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    recordFinishedSpan({
      name: spanName,
      traceId,
      spanId,
      parentSpanId: parentContext?.spanId,
      durationMs: performance.now() - startedAt,
      attributes,
      errorMessage,
    });
  }
}

export function buildTraceparentHeader(): string | undefined {
  const context = getRequestContext();
  if (!context?.spanId) return undefined;
  return `00-${context.traceId}-${context.spanId}-01`;
}

export function parseTraceparentHeader(header?: string): { traceId: string; parentSpanId: string } | undefined {
  const match = header?.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-0[01]$/);
  if (!match) return undefined;
  return { traceId: match[1]!, parentSpanId: match[2]! };
}

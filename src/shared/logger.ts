import pino from 'pino';
import { getRequestContext } from './request-context';

export function logLevelFor(environment: NodeJS.ProcessEnv): string {
  if (environment.LOG_LEVEL) return environment.LOG_LEVEL;
  return environment.NODE_ENV === 'test' ? 'silent' : 'info';
}

export function requestContextFields(): Record<string, string | undefined> {
  const context = getRequestContext();
  if (!context) return {};
  return {
    correlationId: context.correlationId,
    traceId: context.traceId,
    spanId: context.spanId,
    orderId: context.orderId,
  };
}

export const logger = pino({
  level: logLevelFor(process.env),
  base: { service: 'casecellshop-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  mixin: requestContextFields,
});

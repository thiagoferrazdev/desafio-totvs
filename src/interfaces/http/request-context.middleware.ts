import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { logger } from '../../shared/logger';
import { httpRequestDuration } from '../../shared/metrics';
import { RequestContext, runWithRequestContext } from '../../shared/request-context';
import { generateTraceId, parseTraceparentHeader } from '../../shared/tracing';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const incomingTrace = parseTraceparentHeader(request.header('traceparent'));
    const correlationId = request.header(CORRELATION_ID_HEADER) || request.header('x-request-id') || randomUUID();
    const requestContext: RequestContext = {
      correlationId,
      traceId: incomingTrace?.traceId ?? generateTraceId(),
      spanId: incomingTrace?.parentSpanId,
    };
    const startedAt = performance.now();

    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    response.on('finish', () =>
      runWithRequestContext(requestContext, () => this.recordCompletedRequest(request, response, startedAt)),
    );
    runWithRequestContext(requestContext, next);
  }

  private recordCompletedRequest(request: Request, response: Response, startedAt: number): void {
    const routePattern: string = request.route?.path ?? 'unmatched';
    const durationSeconds = (performance.now() - startedAt) / 1000;
    httpRequestDuration.observe(
      { route: routePattern, method: request.method, status: String(response.statusCode) },
      durationSeconds,
    );
    logger.info(
      {
        route: routePattern,
        method: request.method,
        status: response.statusCode,
        durationMs: Math.round(durationSeconds * 1000),
      },
      'request completed',
    );
  }
}

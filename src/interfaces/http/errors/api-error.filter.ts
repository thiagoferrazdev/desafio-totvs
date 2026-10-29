import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ApiError } from './api-error';
import { logger } from '../../../shared/logger';
import { CORRELATION_ID_HEADER } from '../request-context.middleware';

interface ErrorResponse {
  status: number;
  error: { code: string; message: string; details?: unknown };
}

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, error } = this.toErrorResponse(exception);
    response.status(status).json({ error, correlationId: response.getHeader(CORRELATION_ID_HEADER) });
  }

  private toErrorResponse(exception: unknown): ErrorResponse {
    if (exception instanceof ApiError) {
      return {
        status: exception.getStatus(),
        error: { code: exception.code, message: exception.message, details: exception.details },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return { status, error: { code: HttpStatus[status] ?? 'HTTP_ERROR', message: exception.message } };
    }
    logger.error({ err: exception instanceof Error ? exception.stack : String(exception) }, 'unexpected error');
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } };
  }
}
